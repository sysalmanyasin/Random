import { Store } from '../store.js';
import { Bus } from '../actions.js';
import { initLegacyPages, highlightAuditRow, unhighlightAuditRow } from './legacy-pages.js';
import { initEngagementPages, renderTeamTab } from './engagement-pages.js';
import { initSubPages, renderTeamTabForSubAuditor } from './sub-pages.js';
import { initAuthPages, renderAuthRoot } from './auth-pages.js';
import { initStaffPages, renderStaffTab } from './staff-pages.js';
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

export function initPages() {
  const app = $('app');
  const legacy = initLegacyPages();
  const engagement = initEngagementPages();
  const sub = initSubPages();
  const auth = initAuthPages();
  const staff = initStaffPages();

  const clickHandlers = { ...legacy.clickHandlers, ...engagement.clickHandlers, ...sub.clickHandlers, ...auth.clickHandlers, ...staff.clickHandlers };
  const inputHandlers = { ...legacy.inputHandlers, ...engagement.inputHandlers, ...sub.inputHandlers, ...auth.inputHandlers, ...staff.inputHandlers };
  const changeHandlers = { ...legacy.changeHandlers, ...engagement.changeHandlers, ...sub.changeHandlers, ...auth.changeHandlers, ...staff.changeHandlers };
  const keydownHandlers = { ...legacy.keydownHandlers, ...engagement.keydownHandlers, ...sub.keydownHandlers, ...auth.keydownHandlers, ...staff.keydownHandlers };

  app.addEventListener('click', (e) => {
    const el = e.target.closest('[data-action]');
    if (!el || !app.contains(el)) return;
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
    if (e.target.matches && e.target.matches('.audit-count-input')) highlightAuditRow(e.target);
  });
  app.addEventListener('focusout', (e) => {
    if (e.target.matches && e.target.matches('.audit-count-input')) unhighlightAuditRow(e.target);
  });
}
