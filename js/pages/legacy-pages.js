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
   gate, Settings, inventory import (CSV + Dropbox PULL — Dropbox
   PUSH was retired along with the rest), full backup/restore, and
   the PWA install banner.
   ══════════════════════════════════════════════════════════════ */

const $ = (id) => document.getElementById(id);

function toast(message, kind = 'success') { Bus.emit('toast', { msg: message, kind }); }

// ── Navigation (shared — every page module calls this to switch tabs) ──
export function executeViewNavigation(viewIdentifierToken) {
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.tab-btn').forEach(b => { b.classList.remove('active'); b.removeAttribute('aria-current'); });
  const pageEl = $('page-' + viewIdentifierToken);
  if (pageEl) pageEl.classList.add('active');
  const tabNode = $('tab-' + viewIdentifierToken)
    // "Inventory" and "Tools" are sub-pages of the "Sync" sidebar icon,
    // same as "settings" always has been, and "Staff"/"Individual" are
    // sub-pages of "Team" — keep the right bottom tab highlighted for
    // all of them instead of leaving the sidebar with nothing active.
    || (['inventory', 'settings'].includes(viewIdentifierToken) ? $('tab-import') : null)
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

// ── Import inventory (CSV / Dropbox PULL) ──
// Dropbox is pull-only now — see individual-actions.js/engagement data
// for where staff work actually lives (Supabase), not Dropbox.
function handleMasterCSVFile(element) {
  const file = element.files[0];
  if (!file) return;
  Actions.importCSVFile(file).catch(() => toast('File interpretation aborted', 'error'));
  element.value = '';
}
function fetchInventoryFromDropbox() { Actions.importInventoryFromDropbox(false); }

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
  $('dbx-fetch-status').textContent = 'Connecting to Dropbox…';
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
  const isMissing = msg.includes('not_found') || msg.includes('409') || msg.includes('404');
  $('dbx-fetch-status').textContent = isMissing ? '✗ No inventory on Dropbox yet — run POS-SYNC first' : '✗ ' + msg;
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
Bus.on('inventoryHub:changed', updateInventorySyncHubVisibility);
Bus.on('settings:dropboxStatusChanged', updateInventorySyncHubVisibility);
function updateInventorySyncHubVisibility() {
  const linked = !!(Actions.getDropboxToken() && Store.getState().dbxClient);
  const notEl = $('inv-not-linked');
  const yesEl = $('inv-linked');
  if (notEl) notEl.style.display = linked ? 'none' : 'block';
  if (yesEl) yesEl.style.display = linked ? 'block' : 'none';
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
function saveDropboxAppKey() { Actions.saveDropboxAppKey($('settings-dropbox-key').value); }

function importConnectionToken() {
  $('conn-import-row').style.display = 'block';
  $('conn-link-row').style.display = 'none';
  $('conn-token-row').style.display = 'none';
  $('conn-token-input').value = '';
  setTimeout(() => $('conn-token-input').focus(), 100);
}
function cancelImportToken() {
  $('conn-import-row').style.display = 'none';
  const linked = !!Actions.getDropboxToken();
  $('conn-link-row').style.display = linked ? 'none' : 'block';
  $('conn-token-row').style.display = linked ? 'block' : 'none';
}
async function exportConnectionToken() {
  const pin = prompt('Set a 4-digit PIN to protect this token:\n(Receiving device will need this PIN)');
  if (!pin || pin.length < 4) { toast('PIN must be at least 4 digits', 'error'); return; }
  const b64 = await Actions.exportConnectionToken(pin);
  if (b64) prompt('Connection token (also copied to clipboard):\nShare this + your PIN with the other device.', b64);
}
async function applyImportedToken() {
  const b64 = $('conn-token-input').value.trim();
  if (!b64) { toast('Paste a connection token first', 'error'); return; }
  const pin = prompt('Enter the PIN set by the exporting device:');
  if (!pin) return;
  await Actions.applyImportedToken(b64, pin);
  $('conn-token-input').value = '';
  cancelImportToken();
}

Bus.on('cloud:state', ({ state, text }) => {
  const bar = $('cloud-sync-bar');
  const lbl = $('cloud-bar-text');
  if (bar) bar.className = 'state-' + state;
  if (lbl) lbl.textContent = text;
});

Bus.on('settings:dropboxStatusChanged', () => {
  const el = $('settings-dropbox-status');
  const dot = $('conn-dot');
  if (!el) return;
  const keyInput = $('settings-dropbox-key');
  if (keyInput) keyInput.value = Actions.getEffectiveDropboxAppKey();

  const linked = !!Actions.getDropboxToken();
  if (linked) {
    el.textContent = 'Connected securely'; el.style.color = 'var(--green-ink)';
    if (dot) { dot.style.background = 'var(--green)'; dot.style.boxShadow = '0 0 5px var(--green)'; }
  } else {
    el.textContent = 'Not linked'; el.style.color = 'var(--grey)';
    if (dot) { dot.style.background = 'var(--grey)'; dot.style.boxShadow = 'none'; }
  }
  const autosyncToggle = $('settings-autosync-toggle');
  if (autosyncToggle) autosyncToggle.checked = Actions.isAutoSyncEnabled();

  const linkRow = $('conn-link-row');
  const tokenRow = $('conn-token-row');
  const importRow = $('conn-import-row');
  if (linkRow) linkRow.style.display = linked ? 'none' : 'block';
  if (tokenRow) tokenRow.style.display = linked ? 'block' : 'none';
  if (importRow) importRow.style.display = 'none';
});
Bus.on('settings:autoSyncRejected', () => {
  const t = $('settings-autosync-toggle');
  if (t) t.checked = false;
});

// ── PWA install banner ──
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
    'goto-settings-pin-gate': () => { executeViewNavigation('settings'); openSettingsPinGate(); },
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
    'unlink-dropbox': () => Actions.unlinkDropbox(),
    'save-dropbox-key': () => saveDropboxAppKey(),
    'import-connection-token': () => importConnectionToken(),
    'export-connection-token': () => exportConnectionToken(),
    'apply-imported-token': () => applyImportedToken(),
    'cancel-import-token': () => cancelImportToken(),
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
    'toggle-autosync': (el) => Actions.toggleAutoSync(el.checked),
    'handle-csv-file': (el) => handleMasterCSVFile(el),
    'restore-backup': (el) => { const file = el.files[0]; if (file) Actions.restoreFullBackup(file); el.value = ''; },
  };

  const keydownHandlers = {};

  return { clickHandlers, inputHandlers, changeHandlers, keydownHandlers };
}
