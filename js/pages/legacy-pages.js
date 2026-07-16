import { Store } from '../store.js';
import { Actions, Bus } from '../actions.js';
import { Components } from '../components.js';

/* ══════════════════════════════════════════════════════════════
   FLOOR 5 — PAGES / legacy-pages.js
   What's left after retiring the original single-auditor app
   (Verify Stock table, History ledger, WhatsApp/PDF sign-off,
   Dropbox push) — Individual Assignments (individual-actions.js)
   and Team Audit now cover that whole workflow, backed by
   Supabase instead of on-device state.

   Still genuinely shared, general-purpose infrastructure that
   happens to have always lived in this file: navigation, the PIN
   gate, Settings, inventory import (CSV + the Supabase-synced
   Dropbox pull — see legacy-actions.js triggerInventorySync),
   full backup/restore, and the PWA install banner.
   ══════════════════════════════════════════════════════════════ */

const $ = (id) => document.getElementById(id);

function toast(message, kind = 'success') { Bus.emit('toast', { msg: message, kind }); }

// ── Navigation (shared — every page module calls this to switch tabs) ──
// A Sub-Auditor is only ever allowed onto the Team Audit surface (and
// its own sub-views) — everything else (inventory, sync/import,
// settings, staff) reads Supabase tables RLS wouldn't return to them
// anyway, so letting them *arrive* at those pages is confusing at best.
// This check is the single chokepoint every navigation path goes
// through (home tiles, bottom nav, deep links, Bus 'nav:goto' events),
// so gating it here — rather than just hiding buttons — closes the gap
// where a fast tap on a still-visible tile could land before any other
// check ran.
const SUB_AUDITOR_ALLOWED_VIEWS = new Set(['team']);
export function executeViewNavigation(viewIdentifierToken) {
  const { role } = Store.getState();
  if (role === 'sub' && !SUB_AUDITOR_ALLOWED_VIEWS.has(viewIdentifierToken)) {
    viewIdentifierToken = 'team';
  }
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.tab-btn').forEach(b => { b.classList.remove('active'); b.removeAttribute('aria-current'); });
  const pageEl = $('page-' + viewIdentifierToken);
  if (pageEl) pageEl.classList.add('active');
  const tabNode = $('tab-' + viewIdentifierToken)
    // "Tools" is a sub-page of the "Sync" bottom-nav icon (same as it
    // always has been), and "Staff"/"Individual" are sub-pages of
    // "Team" — keep the right bottom tab highlighted for those instead
    // of leaving the sidebar with nothing active. "Inventory" is now
    // its own top-level section (reached from the home screen), not a
    // Sync & Tools sub-page, so it's deliberately left out here.
    || (viewIdentifierToken === 'settings' ? $('tab-import') : null)
    || (['staff', 'individual'].includes(viewIdentifierToken) ? $('tab-team') : null);
  if (tabNode) { tabNode.classList.add('active'); tabNode.setAttribute('aria-current', 'page'); }
  Bus.emit('view:activated', viewIdentifierToken);
}

// ── Font scale widget ──
function applyFontScaleAdjustment(scaleValue, buttonElement) {
  const zoomMap = { '100%': 1, '112%': 1.12, '125%': 1.25 };
  $('app').style.zoom = zoomMap[scaleValue] || 1;
  document.querySelectorAll('.font-btn').forEach(btn => btn.classList.remove('active'));
  buttonElement.classList.add('active');
}

// Shared row-highlight behavior for the Sub-Auditor counting table
// (.audit-count-input) — kept here since counting-related row focus
// styling has always lived in this file, even though the table itself
// (Verify Stock) that originally used it is gone.
export function highlightAuditRow(inputEl) {
  document.querySelectorAll('.audit-row-focused').forEach(r => r.classList.remove('audit-row-focused'));
  const row = inputEl.closest('tr');
  if (row) { row.classList.add('audit-row-focused'); row.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); }
}
export function unhighlightAuditRow(inputEl) {
  const row = inputEl.closest('tr');
  if (row) row.classList.remove('audit-row-focused');
}

// ── Import inventory (CSV / Supabase-synced Dropbox pull) ──
// Live inventory now comes from a Supabase Edge Function that pulls
// Dropbox server-side and replaces the shared table — see
// legacy-actions.js triggerInventorySync. No client ever talks to
// Dropbox directly anymore.
function handleMasterCSVFile(element) {
  const file = element.files[0];
  if (!file) return;
  Actions.importCSVFile(file).catch(() => toast('File interpretation aborted', 'error'));
  element.value = '';
}
function fetchInventoryFromDropbox() { Actions.triggerInventorySync(false); }

Bus.on('products:changed', () => {
  const { products } = Store.getState();
  $('file-status-report').style.display = 'block';
  $('file-status-report').innerHTML = `✅ Dataset Storage Online: ${products.length.toLocaleString()} Operational Items`;
});

Bus.on('branding:changed', ({ branchName }) => {
  const headerEl = $('header-branch-label');
  const settingsInput = $('settings-branch-name');
  if (headerEl) headerEl.textContent = branchName;
  if (settingsInput) settingsInput.value = branchName;
});

Bus.on('nav:goto', (page) => executeViewNavigation(page));

Bus.on('dbxInventoryFetch:start', () => {
  $('dbx-fetch-btn').disabled = true;
  $('dbx-fetch-status').textContent = 'Syncing inventory…';
  $('dbx-fetch-status').style.color = 'var(--grey)';
  const bg = $('dbx-bar-bg'); if (bg) bg.style.display = 'block';
  const fill = $('dbx-bar-fill'); if (fill) fill.style.width = '50%';
});
Bus.on('dbxInventoryFetch:success', ({ count, fetchedAt }) => {
  $('dbx-fetch-btn').disabled = false;
  $('dbx-fetch-status').textContent = '✓ ' + count.toLocaleString() + ' products loaded';
  $('dbx-fetch-status').style.color = 'var(--green-ink)';
  const fill = $('dbx-bar-fill'); if (fill) { fill.style.width = '100%'; fill.style.background = 'var(--green)'; }
  updateLastFetchedLabel(fetchedAt);
  setTimeout(() => { const bg = $('dbx-bar-bg'); if (bg) bg.style.display = 'none'; }, 1800);
});
Bus.on('dbxInventoryFetch:error', ({ msg }) => {
  $('dbx-fetch-btn').disabled = false;
  const bg = $('dbx-bar-bg'); if (bg) bg.style.display = 'none';
  const isMissing = msg.includes('not_found') || msg.includes('409') || msg.includes('404') || msg.includes('empty');
  $('dbx-fetch-status').textContent = isMissing ? '✗ No inventory file on Dropbox yet — run POS-SYNC first' : '✗ ' + msg;
  $('dbx-fetch-status').style.color = 'var(--red)';
});
Bus.on('dbxInventoryFetch:lastKnown', ({ fetchedAt }) => updateLastFetchedLabel(fetchedAt));
function updateLastFetchedLabel(ts) {
  const el = $('dbx-last-fetched');
  const lbl = $('dbx-last-fetched-time');
  if (!el || !lbl) return;
  const d = new Date(ts);
  lbl.textContent = d.toLocaleDateString('en-PK', { day: '2-digit', month: 'short' }) + ' @ ' + d.toLocaleTimeString('en-PK', { hour: '2-digit', minute: '2-digit' });
  el.style.display = 'block';
}

// ── PIN gate ──
let pinBuffer = '';
function openSettingsPinGate() {
  pinBuffer = '';
  updatePinDots();
  $('pin-error').textContent = '';
  $('pin-gate-overlay').style.display = 'flex';
}
function closePinGate() {
  pinBuffer = '';
  updatePinDots();
  $('pin-gate-overlay').style.display = 'none';
}
function pinKeyPress(key) {
  if (key === 'back') { pinBuffer = pinBuffer.slice(0, -1); updatePinDots(); $('pin-error').textContent = ''; return; }
  if (pinBuffer.length >= 4) return;
  pinBuffer += key;
  updatePinDots();
  if (pinBuffer.length === 4) {
    if (Actions.verifyPin(pinBuffer)) {
      closePinGate();
      executeViewNavigation('settings');
    } else {
      $('pin-error').textContent = '❌ Incorrect PIN';
      setTimeout(() => { pinBuffer = ''; updatePinDots(); $('pin-error').textContent = ''; }, 900);
    }
  }
}
function updatePinDots() {
  for (let i = 0; i < 4; i++) {
    const dot = $('pd' + i);
    if (dot) dot.classList.toggle('filled', i < pinBuffer.length);
  }
}

// ── Settings page ──
function saveBranchName() { Actions.saveBranchName($('settings-branch-name').value); }
function saveSettingsPin() {
  const currentEl = $('settings-pin-current');
  const newEl = $('settings-pin-new');
  const confirmEl = $('settings-pin-confirm');
  const ok = Actions.saveSettingsPin(currentEl.value.trim(), newEl.value.trim(), confirmEl.value.trim());
  if (ok) { currentEl.value = ''; newEl.value = ''; confirmEl.value = ''; }
}

Bus.on('cloud:state', ({ state, text }) => {
  const bar = $('cloud-sync-bar');
  const lbl = $('cloud-bar-text');
  if (bar) bar.className = 'state-' + state;
  if (lbl) lbl.textContent = text;
});

// ── PWA install banner ──
// The two window-level listeners below are browser-mandated PWA
// lifecycle hooks (same carve-out as the service worker registration
// in main.js) — they cannot be dispatched through #app's data-action
// delegation because the browser fires them on `window` itself, not
// on any element in the document. The "exactly one addEventListener
// per event type" golden rule is scoped to #app; these two event
// types never fire there at all.
function initPwaInstallBanner() {
  let deferredInstallPrompt = null;
  const banner = $('pwa-install-banner');

  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredInstallPrompt = e;
    if (!Actions.isPwaInstallDismissed()) {
      setTimeout(() => banner && banner.classList.add('visible'), 2000);
    }
  });

  window.addEventListener('appinstalled', () => {
    banner && banner.classList.remove('visible');
    deferredInstallPrompt = null;
  });

  return {
    install() {
      if (!deferredInstallPrompt) return;
      deferredInstallPrompt.prompt();
      deferredInstallPrompt.userChoice.then(() => {
        deferredInstallPrompt = null;
        banner && banner.classList.remove('visible');
      });
    },
    dismiss() {
      banner && banner.classList.remove('visible');
      Actions.dismissPwaInstall();
    },
  };
}

/* ── Handler maps, consumed by pages/event-delegation.js ── */
export function initLegacyPages() {
  const pwaBanner = initPwaInstallBanner();

  const clickHandlers = {
    'noop': () => {},
    'cloud-bar-tapped': () => Actions.cloudBarTapped(),
    'font-scale': (el) => applyFontScaleAdjustment(el.dataset.scale, el),
    'fetch-dropbox-inventory': () => fetchInventoryFromDropbox(),
    'trigger-file-input': (el) => { const t = $(el.dataset.target); if (t) t.click(); },
    // Shared with the Reports list (report-components.js) and the
    // Main Auditor dashboard's collapsible sections — not legacy-only.
    'toggle-accordion': (el) => {
      const item = el.closest('.history-item');
      if (!item) return;
      item.classList.toggle('open');
      el.setAttribute('aria-expanded', item.classList.contains('open') ? 'true' : 'false');
    },
    'save-branch-name': () => saveBranchName(),
    'save-settings-pin': () => saveSettingsPin(),
    'export-full-backup': () => Actions.exportFullBackup(),
    'navigate': (el) => executeViewNavigation(el.dataset.view),
    'open-pin-gate': () => openSettingsPinGate(),
    'close-pin-gate': () => closePinGate(),
    'pin-key': (el) => pinKeyPress(el.dataset.key),
    'pwa-install': () => pwaBanner.install(),
    'pwa-dismiss': () => pwaBanner.dismiss(),
  };

  const inputHandlers = {};

  const changeHandlers = {
    'handle-csv-file': (el) => handleMasterCSVFile(el),
    'restore-backup': (el) => { const file = el.files[0]; if (file) Actions.restoreFullBackup(file); el.value = ''; },
  };

  const keydownHandlers = {};

  return { clickHandlers, inputHandlers, changeHandlers, keydownHandlers };
}
