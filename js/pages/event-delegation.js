import { Store } from '../store.js';
import { Bus } from '../actions.js';
import { initLegacyPages, highlightAuditRow, unhighlightAuditRow } from './legacy-pages.js';
import { initEngagementPages, renderTeamTab } from './engagement-pages.js';
import { initSubPages, renderTeamTabForSubAuditor } from './sub-pages.js';
import { initAuthPages, renderAuthRoot } from './auth-pages.js';
import { initStaffPages, renderStaffTab } from './staff-pages.js';
import { initInventoryPages } from './inventory-pages.js';
import { Components } from '../components.js';

/* ══════════════════════════════════════════════════════════════
   FLOOR 5 — PAGES / event-delegation.js
   EVENT DELEGATION — the only place DOM listeners are attached.
   Exactly one addEventListener per event type on #app, same
   contract as the original single-file Pages module — the
   handler *maps* now come from every page module (legacy +
   engagement + sub + auth + staff) merged together here.
   ══════════════════════════════════════════════════════════════ */

const $ = (id) => document.getElementById(id);

// ── Toasts (cross-cutting — every floor emits 'toast' via Bus) ──
Bus.on('toast', ({ msg, kind }) => {
  const node = Components.toastNode(msg, kind);
  document.body.appendChild(node);
  setTimeout(() => node.remove(), 2600);
});

let mainAuditorViewingOwnWork = false;
function renderTeamRoot() {
  const { role } = Store.getState();
  if (role === 'sub' || (role === 'main' && mainAuditorViewingOwnWork)) renderTeamTabForSubAuditor();
  else renderTeamTab();
}
Bus.on('team:viewMyWork', () => { mainAuditorViewingOwnWork = true; renderTeamRoot(); });
Bus.on('team:viewManage', () => { mainAuditorViewingOwnWork = false; renderTeamRoot(); });
// A fresh tap on the Team Audit bottom-nav tab always starts back at
// management view — "My Assigned Work" is a sub-view you opt into each
// visit, not something that should silently persist (and confusingly
// resurface for a totally different engagement) after switching tabs
// away and back.
Bus.on('view:activated', (page) => { if (page === 'team') { mainAuditorViewingOwnWork = false; renderTeamRoot(); } });
// myAssignments reloads in the background any time assignments change
// anywhere (e.g. the Main Auditor just opening a round to manage it) —
// only re-render the self-counting workspace if that's actually the
// view on screen right now, otherwise this would silently blow away
// whatever the Main Auditor was managing.
Bus.on('myAssignments:changed', () => {
  const { role } = Store.getState();
  if (role === 'sub' || (role === 'main' && mainAuditorViewingOwnWork)) renderTeamTabForSubAuditor();
});
Bus.on('engagement:opened', renderTeamRoot);
Bus.on('engagement:closed', renderTeamRoot);

// Auth state changes always re-render the root gate, and once logged in
// as Main Auditor, also refresh the Team/Staff tabs with whatever just loaded.
Bus.on('auth:loggedIn', () => { renderAuthRoot(); renderTeamRoot(); renderStaffTab(); });
Bus.on('auth:loggedOut', renderAuthRoot);
Bus.on('auth:needsLogin', renderAuthRoot);
Bus.on('auth:needsConfig', renderAuthRoot);

// ── Modal dialogs — focus management ──────────────────────────
// Centralized here (rather than repeated in every place that opens one
// of these overlays across engagement-pages.js/legacy-pages.js/etc.) by
// watching each overlay's own `style` attribute instead: the moment one
// flips to visible, focus moves inside it and Escape/Tab start behaving
// like a dialog; the moment it's hidden again, focus returns to
// whatever was focused before it opened. New overlays just need adding
// to this list — no per-handler wiring required.
const DIALOG_OVERLAY_IDS = ['pin-gate-overlay', 'live-snapshot-overlay', 'force-submit-overlay', 'report-overview-overlay'];
// Maps each overlay to the click-handler name that closes it, so Escape
// can reuse the exact same close logic as its own visible "✕"/Cancel
// button rather than just hiding the element and leaving app state
// (e.g. which assignment the popup was open for) stale.
const DIALOG_CLOSE_ACTION = {
  'pin-gate-overlay': 'close-pin-gate',
  'live-snapshot-overlay': 'close-live-snapshot',
  'force-submit-overlay': 'close-force-submit',
  'report-overview-overlay': 'close-report-overview',
};
let _lastFocusedBeforeDialog = null;
function _isVisible(el) { return el && el.style.display !== 'none' && el.style.display !== ''; }
function _focusableIn(el) {
  return Array.from(el.querySelectorAll('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'))
    .filter(n => !n.disabled && n.offsetParent !== null);
}
function _setUpDialogFocusManagement(clickHandlers) {
  DIALOG_OVERLAY_IDS.forEach(id => {
    const overlay = $(id);
    if (!overlay) return;
    let wasVisible = _isVisible(overlay);
    const observer = new MutationObserver(() => {
      const nowVisible = _isVisible(overlay);
      if (nowVisible && !wasVisible) {
        _lastFocusedBeforeDialog = document.activeElement;
        const focusables = _focusableIn(overlay);
        (focusables[0] || overlay).focus();
      } else if (!nowVisible && wasVisible) {
        if (_lastFocusedBeforeDialog && document.body.contains(_lastFocusedBeforeDialog)) _lastFocusedBeforeDialog.focus();
        _lastFocusedBeforeDialog = null;
      }
      wasVisible = nowVisible;
    });
    observer.observe(overlay, { attributes: true, attributeFilter: ['style'] });
  });

  document.addEventListener('keydown', (e) => {
    const openId = DIALOG_OVERLAY_IDS.find(id => { const el = $(id); return el && _isVisible(el); });
    if (!openId) return;
    const overlay = $(openId);
    if (e.key === 'Escape') {
      const handler = clickHandlers[DIALOG_CLOSE_ACTION[openId]];
      if (handler) handler(overlay);
      return;
    }
    if (e.key === 'Tab') {
      // Basic focus trap: Tab/Shift+Tab wrap within the open dialog
      // instead of escaping to whatever's underneath it.
      const focusables = _focusableIn(overlay);
      if (focusables.length === 0) return;
      const first = focusables[0], last = focusables[focusables.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    }
  });
}

export function initPages() {
  const app = $('app');
  const legacy = initLegacyPages();
  const engagement = initEngagementPages();
  const sub = initSubPages();
  const auth = initAuthPages();
  const staff = initStaffPages();
  const inventory = initInventoryPages();

  const clickHandlers = { ...legacy.clickHandlers, ...engagement.clickHandlers, ...sub.clickHandlers, ...auth.clickHandlers, ...staff.clickHandlers, ...inventory.clickHandlers };
  const inputHandlers = { ...legacy.inputHandlers, ...engagement.inputHandlers, ...sub.inputHandlers, ...auth.inputHandlers, ...staff.inputHandlers, ...inventory.inputHandlers };
  const changeHandlers = { ...legacy.changeHandlers, ...engagement.changeHandlers, ...sub.changeHandlers, ...auth.changeHandlers, ...staff.changeHandlers, ...inventory.changeHandlers };
  const keydownHandlers = { ...legacy.keydownHandlers, ...engagement.keydownHandlers, ...sub.keydownHandlers, ...auth.keydownHandlers, ...staff.keydownHandlers, ...inventory.keydownHandlers };

  _setUpDialogFocusManagement(clickHandlers);

  app.addEventListener('click', (e) => {
    const el = e.target.closest('[data-action]');
    if (!el || !app.contains(el)) return;
    const handler = clickHandlers[el.dataset.action];
    if (handler) handler(el);
  });

  // Safety net for the clickable divs/rows across the app that stand in
  // for a button (assignment cards, accordion headers, company/engagement
  // cards, etc.) — each of those already gets tabindex="0" at render time,
  // but Enter/Space activation isn't native on a non-<button> element, so
  // it has to be wired up once, here, rather than repeated in every
  // component that renders one.
  app.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    const el = e.target.closest('[data-action]');
    if (!el || !app.contains(el)) return;
    // Must be pressed directly on the data-action element itself, not
    // bubbled up from some nested interactive child of it (e.g. a
    // search input or a real <button> sitting inside a card that also
    // carries its own data-action) — otherwise typing Enter in a
    // nested field would wrongly trigger the card's own action instead
    // of whatever the field itself does.
    if (e.target !== el) return;
    const nativelyHandlesItsOwnKeys = ['BUTTON', 'A', 'INPUT', 'SELECT', 'TEXTAREA'].includes(el.tagName);
    if (nativelyHandlesItsOwnKeys) return;
    if (el.dataset.action === 'noop') return;
    e.preventDefault(); // stop Space from also scrolling the page
    const handler = clickHandlers[el.dataset.action];
    if (handler) handler(el);
  });

  app.addEventListener('input', (e) => {
    const el = e.target.closest('[data-input-action]');
    if (!el) return;
    const handler = inputHandlers[el.dataset.inputAction];
    if (handler) handler(el);
  });

  app.addEventListener('change', (e) => {
    const el = e.target.closest('[data-change-action]');
    if (!el) return;
    const handler = changeHandlers[el.dataset.changeAction];
    if (handler) handler(el);
  });

  app.addEventListener('keydown', (e) => {
    const el = e.target.closest('[data-keydown-action]');
    if (!el) return;
    const handler = keydownHandlers[el.dataset.keydownAction];
    if (handler) handler(e, el);
  });

  // Shared row-highlight behavior for both the legacy audit table and the
  // sub-auditor counting table, which intentionally reuse the same class
  // (.audit-count-input) for identical styling/UX.
  app.addEventListener('focusin', (e) => {
    if (e.target.matches && e.target.matches('.audit-count-input')) {
      highlightAuditRow(e.target);
      // Select the existing value on focus (tap or Tab/Next into the
      // field) so typing a new count replaces it immediately instead of
      // requiring a manual delete first.
      e.target.select();
    }
  });
  app.addEventListener('focusout', (e) => {
    if (e.target.matches && e.target.matches('.audit-count-input')) unhighlightAuditRow(e.target);
  });
}
