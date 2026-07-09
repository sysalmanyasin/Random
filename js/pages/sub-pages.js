import { Store } from '../store.js';
import { Actions, Bus } from '../actions.js';
import { Components } from '../components.js';

/* ══════════════════════════════════════════════════════════════
   FLOOR 5 — PAGES / sub-pages.js
   Sub-Auditor side of the "Team Audit" tab. After a real login,
   Actions.loadMyAssignments() fetches exactly the rows Postgres
   RLS allows for this person — this file just renders whichever
   one they open and lets them count + submit. No pairing payload,
   no link, no PIN screen; login already handled all of that.
   ══════════════════════════════════════════════════════════════ */

const $ = (id) => document.getElementById(id);
let countingSearchToken = ''; // ephemeral UI-only filter state
let countingFilterMode = 'all'; // all | shorts | overs | unverified
let countingSortAscending = true;
let collapsedCompanyGroups = new Set(); // company names currently collapsed in the counting table
let countingGroupByCompany = true; // whether multi-company assignments show company headers at all
let subDashboardOpen = false; // "Your Assignment" card — collapsed by default

// Renders the assignment-picker + counting workspace. Originally
// Sub-Auditor-only; now also used by the Main Auditor whenever they
// have self-assigned work of their own (see engagement-pages.js's
// "My Assigned Work" entry point) — hence no role check here anymore.
export function renderTeamTabForSubAuditor() {
  const container = $('team-tab-root');
  if (!container) return;
  const { myAssignments, activeAssignmentId } = Store.getState();

  if (!activeAssignmentId) {
    container.innerHTML = renderAssignmentPickerHTML(myAssignments);
    return;
  }

  const assignment = myAssignments.find(a => a.id === activeAssignmentId);
  if (!assignment) { container.innerHTML = renderAssignmentPickerHTML(myAssignments); return; }
  const isLocked = assignment.status === 'submitted';

  const dash = Actions.subAuditorDashboard();
  container.innerHTML = `
    <button class="sort-btn" data-action="sub-back-to-list" style="margin-bottom:10px;">← My Assignments</button>
    <div id="sub-dashboard-holder">${Components.subDashboardHTML(dash, countingFilterMode, countingSortAscending, isLocked, subDashboardOpen, countingGroupByCompany)}</div>
    ${isLocked
      ? '<div class="card" style="margin:12px 0; background:#EFF6FF; border:1px solid #BFDBFE; text-align:center; font-size:12px; font-weight:700; color:var(--navy); padding:10px;">✓ Submitted — ask the Main Auditor to reopen this if you need to make changes</div>'
      : `<div class="no-print" style="display:flex; gap:8px; margin:12px 0;">
          <button class="btn btn-primary btn-sm" style="flex:1;" data-action="sub-submit-assignment">✓ Submit Assignment</button>
        </div>`}
    <input type="text" id="sub-counting-search-input" class="settings-input" placeholder="🔍 Search items…"
      data-input-action="filter-counting-items" style="margin-bottom:10px;">
    <div style="background:white; border-radius:var(--radius); box-shadow:var(--shadow); overflow:hidden;">
      <table class="audit-table">
        <thead><tr>
          <th style="padding-left:10px; width:52%;">Medicine</th>
          <th style="text-align:right; width:13%;">Sys</th>
          <th style="text-align:right; width:20%;">Count</th>
          <th style="text-align:right; padding-right:10px; width:15%;">Var</th>
        </tr></thead>
        <tbody id="sub-counting-rows"></tbody>
      </table>
    </div>`;
  renderCountingRows();
}

function renderAssignmentPickerHTML(myAssignments) {
  const { role } = Store.getState();
  const backLink = role === 'main'
    ? '<button class="sort-btn" data-action="team-back-to-manage" style="margin-bottom:10px;">← Back to Team Audit</button>'
    : '';
  if (myAssignments.length === 0) {
    return backLink + `<div class="card" style="text-align:center; padding:32px 20px;"><span style="font-size:40px;">📋</span><div style="font-weight:800; color:var(--navy); margin-top:10px;">No assignments yet.</div><div style="font-size:12px; color:var(--grey); margin-top:4px;">Ask the Main Auditor to assign you to a round.</div></div>`;
  }
  const cards = myAssignments.map(a => `
    <div class="card assignment-card" data-action="sub-open-assignment" data-assignment-id="${a.id}" style="cursor:pointer;">
      <div style="display:flex; justify-content:space-between; align-items:center;">
        <div>
          <div style="font-weight:800; color:var(--navy); font-size:13px;">${Components.esc(a.companies.join(', ') || (a.items.length + ' items'))}</div>
          <div style="font-size:11px; color:var(--grey); margin-top:2px;">${a.items.length} item line(s)</div>
        </div>
        <span class="val-badge ${a.status === 'submitted' ? 'val-green' : 'val-gold'}">${Components.esc(a.status)}</span>
      </div>
    </div>`).join('');
  return backLink + `<div class="card-title">My Assignments</div>${cards}`;
}

// Applies the search token, Short/Over/Unverified filter, and sort
// order, then groups by company when the assignment spans more than
// one company — mirroring what the (single-auditor) Verify Stock tab
// already offered.
function _visibleItemGroups() {
  const { myAssignments, activeAssignmentId, myCounts } = Store.getState();
  const assignment = myAssignments.find(a => a.id === activeAssignmentId);
  if (!assignment) return [];
  const token = countingSearchToken.toLowerCase().trim();
  let items = assignment.items.filter(it => {
    if (token && !(it.name.toLowerCase().includes(token) || (it.code && it.code.toLowerCase().includes(token)) || it.company.toLowerCase().includes(token))) return false;
    const c = myCounts[it.itemKey];
    if (countingFilterMode === 'unverified') return c === undefined;
    if (countingFilterMode === 'shorts') return c !== undefined && c < it.qty;
    if (countingFilterMode === 'overs') return c !== undefined && c > it.qty;
    return true;
  });
  items = items.slice().sort((a, b) => countingSortAscending ? a.name.localeCompare(b.name) : b.name.localeCompare(a.name));

  const multiCompany = countingGroupByCompany && new Set(assignment.items.map(it => it.company)).size > 1;
  if (!multiCompany) return [{ company: null, items }];
  const companies = [...new Set(items.map(it => it.company))].sort();
  return companies.map(company => ({ company, items: items.filter(it => it.company === company) }));
}

function _refreshGroupHeaderImpact(company) {
  const tbody = $('sub-counting-rows');
  if (!tbody) return;
  const headerTr = tbody.querySelector(`tr[data-action="toggle-company-group"][data-company="${CSS.escape(company)}"]`);
  if (!headerTr) return;
  const { myAssignments, activeAssignmentId, myCounts } = Store.getState();
  const assignment = myAssignments.find(a => a.id === activeAssignmentId);
  if (!assignment) return;
  const companyItems = assignment.items.filter(it => it.company === company);
  const impact = companyItems.reduce((sum, it) => {
    const c = myCounts[it.itemKey];
    return c === undefined ? sum : sum + (c - it.qty) * it.price;
  }, 0);
  const collapsed = collapsedCompanyGroups.has(company);
  const fresh = Components.companyGroupHeaderRow(company, impact, collapsed);
  headerTr.innerHTML = fresh.innerHTML;
}

function renderCountingRows() {
  const tbody = $('sub-counting-rows');
  if (!tbody) return;
  const { myCounts, myNotes, myConfirms, myAssignments, activeAssignmentId } = Store.getState();
  const activeAssignment = myAssignments.find(a => a.id === activeAssignmentId);
  const readOnly = !!activeAssignment && activeAssignment.status === 'submitted';
  const groups = _visibleItemGroups();
  tbody.innerHTML = '';
  const totalItems = groups.reduce((s, g) => s + g.items.length, 0);
  if (totalItems === 0) {
    tbody.innerHTML = '<tr><td colspan="4" style="text-align:center; color:var(--grey); padding:24px; font-weight:600;">No matching items found.</td></tr>';
    return;
  }
  groups.forEach(group => {
    if (group.company) {
      // Running variance value for the WHOLE company (from the
      // assignment's full item list), not just the currently-visible/
      // filtered subset in `group.items` — otherwise applying a search
      // or Shorts/Overs filter would silently change the displayed
      // total, and it would visibly jump the moment you type (since the
      // per-keystroke updater below already used the full list).
      const companyItems = activeAssignment ? activeAssignment.items.filter(it => it.company === group.company) : group.items;
      const companyImpact = companyItems.reduce((sum, it) => {
        const c = myCounts[it.itemKey];
        return c === undefined ? sum : sum + (c - it.qty) * it.price;
      }, 0);
      const collapsed = collapsedCompanyGroups.has(group.company);
      tbody.appendChild(Components.companyGroupHeaderRow(group.company, companyImpact, collapsed));
      if (collapsed) return;
    }
    group.items.forEach(item => tbody.appendChild(Components.countingRow(item, myCounts[item.itemKey], (myNotes || {})[item.itemKey], readOnly, !!(myConfirms || {})[item.itemKey])));
  });
}

function refreshDashboardCard() {
  const dash = Actions.subAuditorDashboard();
  const { myAssignments, activeAssignmentId } = Store.getState();
  const activeAssignment = myAssignments.find(a => a.id === activeAssignmentId);
  const isLocked = !!activeAssignment && activeAssignment.status === 'submitted';
  const holder = $('sub-dashboard-holder');
  if (holder) holder.innerHTML = Components.subDashboardHTML(dash, countingFilterMode, countingSortAscending, isLocked, subDashboardOpen, countingGroupByCompany);
}

// NOTE: no unconditional Bus.on('myAssignments:changed', ...) here on
// purpose — that data reloads in the background any time assignments
// change anywhere (e.g. the Main Auditor just opening a round), and
// re-rendering this view on that alone would blow away whatever the
// Main Auditor was actually looking at. See event-delegation.js, which
// only re-renders this view when it's the one actually on screen.
Bus.on('counting:sessionStarted', () => renderTeamTabForSubAuditor());
Bus.on('counting:checkpointRestored', () => renderCountingRows());
Bus.on('counting:bulkMarked', () => { renderCountingRows(); refreshDashboardCard(); });
Bus.on('counting:sameApplied', () => { renderCountingRows(); refreshDashboardCard(); });
Bus.on('counting:countChanged', refreshDashboardCard);

export function initSubPages() {
  const clickHandlers = {
    'sub-open-assignment': async (el) => {
      collapsedCompanyGroups = new Set();
      subDashboardOpen = false;
      await Actions.openMyAssignment(el.dataset.assignmentId);
    },
    'sub-back-to-list': () => {
      Actions.closeMyAssignment();
      countingSearchToken = ''; countingFilterMode = 'all'; countingSortAscending = true; collapsedCompanyGroups = new Set();
      subDashboardOpen = false; countingGroupByCompany = true;
      renderTeamTabForSubAuditor();
    },
    'team-back-to-manage': () => Bus.emit('team:viewManage'),
    'sub-submit-assignment': async () => {
      await Actions.submitMyAssignment();
      await Actions.loadMyAssignments();
      renderTeamTabForSubAuditor();
    },
    'mark-remaining-match-counting': () => Actions.markRemainingAsMatch(),
    'apply-same-variance': (el) => Actions.applySameVariance(el.dataset.itemKey),
    'set-counting-filter': (el) => { countingFilterMode = el.dataset.mode; renderTeamTabForSubAuditor(); },
    'toggle-counting-sort': () => { countingSortAscending = !countingSortAscending; renderCountingRows(); refreshDashboardCard(); },
    'toggle-company-group': (el) => {
      const company = el.dataset.company;
      if (collapsedCompanyGroups.has(company)) collapsedCompanyGroups.delete(company);
      else collapsedCompanyGroups.add(company);
      renderCountingRows();
    },
    'toggle-sub-dashboard-card': () => { subDashboardOpen = !subDashboardOpen; refreshDashboardCard(); },
    'toggle-counting-group-by-company': () => { countingGroupByCompany = !countingGroupByCompany; collapsedCompanyGroups = new Set(); renderCountingRows(); },
  };

  const inputHandlers = {
    'filter-counting-items': (el) => { countingSearchToken = el.value; renderCountingRows(); },
    'record-assignment-count': (el) => {
      Actions.recordMyCount(el.dataset.itemKey, el.value.trim());
      const { myAssignments, activeAssignmentId, myCounts } = Store.getState();
      const assignment = myAssignments.find(a => a.id === activeAssignmentId);
      const item = assignment && assignment.items.find(it => it.itemKey === el.dataset.itemKey);
      const varianceCell = el.parentElement.nextElementSibling;
      if (item && varianceCell) varianceCell.innerHTML = Components.varianceCellHTML(myCounts[el.dataset.itemKey], item.qty, item.price);
      if (item) _refreshGroupHeaderImpact(item.company);
    },
    'record-assignment-note': (el) => Actions.recordMyNote(el.dataset.itemKey, el.value),
  };

  const keydownHandlers = {
    'counting-input-enter-next': (e, el) => {
      if (e.key !== 'Enter') return;
      e.preventDefault();
      const allInputs = Array.from(document.querySelectorAll('#sub-counting-rows input[type="number"]'));
      const idx = allInputs.indexOf(el);
      if (idx >= 0 && idx < allInputs.length - 1) { allInputs[idx + 1].focus(); allInputs[idx + 1].select(); }
    },
  };

  return { clickHandlers, inputHandlers, keydownHandlers, changeHandlers: {} };
}
