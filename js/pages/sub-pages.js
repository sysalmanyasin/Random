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
let pickerSubmittedOpen = false; // "Submitted" section on the assignment picker — collapsed by default
let extraNoteOpen = false; // "Items not in inventory" note block — collapsed by default

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
    if (showIndividualPicker && individualPickerSource === 'companies') renderIndividualCompanyPicker();
    return;
  }

  const assignment = myAssignments.find(a => a.id === activeAssignmentId);
  if (!assignment) {
    container.innerHTML = renderAssignmentPickerHTML(myAssignments);
    if (showIndividualPicker && individualPickerSource === 'companies') renderIndividualCompanyPicker();
    return;
  }
  const isLocked = assignment.status === 'submitted';

  const dash = Actions.subAuditorDashboard();
  const { myExtraNote } = Store.getState();
  const hasNote = !!(myExtraNote && myExtraNote.trim());
  container.innerHTML = `
    <button class="sort-btn" data-action="sub-back-to-list" style="margin-bottom:10px;">← My Assignments</button>
    <div id="sub-dashboard-holder">${Components.subDashboardHTML(dash, countingFilterMode, countingSortAscending, isLocked, subDashboardOpen, countingGroupByCompany)}</div>
    ${isLocked
      ? '<div class="card" style="margin:12px 0; background:#EFF6FF; border:1px solid #BFDBFE; text-align:center; font-size:12px; font-weight:700; color:var(--navy); padding:10px;">✓ Submitted — ask the Main Auditor to reopen this if you need to make changes</div>'
      : `<div class="no-print" style="display:flex; gap:8px; margin:12px 0;">
          <button class="btn btn-primary btn-sm" style="flex:1;" data-action="sub-submit-assignment">✓ Submit Assignment</button>
        </div>`}
    <div style="display:flex; justify-content:flex-start; margin-bottom:${extraNoteOpen || hasNote ? '4' : '10'}px;">
      <button class="sort-btn" data-action="toggle-extra-note" style="font-size:11px;">📝 ${hasNote ? 'Edit note' : 'Found something not in inventory?'}</button>
    </div>
    ${extraNoteOpen || hasNote ? `
    <div class="card" style="margin-bottom:10px;">
      <div id="sub-extra-note-desc" style="font-size:11px; font-weight:700; color:var(--grey); margin-bottom:4px;">Items you found but that aren't in the system — this is informational only, not counted as a variance.</div>
      <textarea id="sub-extra-note-input" class="settings-input" data-input-action="record-assignment-extra-note"
        aria-labelledby="sub-extra-note-desc"
        placeholder="e.g. Panadol Extra 10s — found 6 units on shelf, not in inventory list"
        style="width:100%; min-height:44px; resize:none; overflow:hidden; box-sizing:border-box;"
        oninput="this.style.height='auto'; this.style.height=this.scrollHeight+'px';"
        ${isLocked ? 'disabled' : ''}>${Components.esc(myExtraNote || '')}</textarea>
    </div>` : ''}
    <input type="text" id="sub-counting-search-input" class="settings-input" placeholder="🔍 Search items…" aria-label="Search items in this assignment"
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
  const noteEl = $('sub-extra-note-input');
  if (noteEl) { noteEl.style.height = 'auto'; noteEl.style.height = noteEl.scrollHeight + 'px'; }
}

// Sub-Auditor-facing label for a self-pick assignment: the saved
// Template name if that's how it was started (so "many companies"
// collapses to the one meaningful name instead of a long comma list —
// see individual-actions.js startIndividualAssignment/templateName),
// else the picked companies, else a plain item count as a last resort.
function _individualAssignmentLabel(a) {
  if (a.templateName) return a.templateName;
  return (a.companies && a.companies.join(', ')) || (a.items.length + ' items');
}

// qty × price summed across every item — same total shown on the
// Main Auditor's round card (IndividualActions.summarizeIndividualRounds).
function _assignmentTotalValue(a) {
  return (a.items || []).reduce((sum, it) => sum + (Number(it.qty) || 0) * (Number(it.price) || 0), 0);
}

let showIndividualPicker = false;
let individualPickerSource = 'template'; // 'template' | 'companies'
let individualSelectedCompanies = new Set();
let individualSearchToken = '';
let individualSortAscending = true;

// ── Fresh-inventory gate ──────────────────────────────────────────
// Sits between the "Start a Random Audit" button and the actual
// template/company picker. A Random Audit freezes whatever's in
// Store.products the instant it's created (individual-actions.js
// startIndividualAssignment) — and Store.products only refreshes at
// login or a manual sync tap, never continuously in the background —
// so this forces one real sync right at launch, and shows the person
// it happened, instead of silently launching against however old the
// device's copy happens to be. See LegacyActions.ensureFreshInventoryForAudit.
let individualSyncGateOpen = false;
let individualSyncGateStatus = 'idle'; // 'idle' | 'syncing' | 'error'
let individualSyncGateError = '';

function _formatSyncedAt(ts) {
  if (!ts) return 'never';
  return new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function renderSyncGateHTML() {
  const { inventoryLastSyncedAt } = Store.getState();
  const lastSyncedLabel = _formatSyncedAt(inventoryLastSyncedAt);

  if (individualSyncGateStatus === 'syncing') {
    return `<div class="card" style="margin-bottom:14px; text-align:center; padding:20px;">
      <div style="font-weight:800; color:var(--navy); font-size:13px;">⟳ Syncing latest inventory…</div>
      <div style="font-size:11px; color:var(--grey); margin-top:6px;">Checking Supabase for anything newer before you start counting.</div>
    </div>`;
  }

  if (individualSyncGateStatus === 'error') {
    return `<div class="card" style="margin-bottom:14px; padding:16px; background:var(--gold-bg); border:1px solid var(--gold);">
      <div style="font-weight:800; color:var(--navy); font-size:13px;">⚠️ Could not confirm the latest inventory</div>
      <div style="font-size:11px; color:var(--grey); margin-top:4px;">${Components.esc(individualSyncGateError)}. Last known sync: ${lastSyncedLabel}.</div>
      <div style="display:flex; gap:8px; margin-top:10px;">
        <button class="btn btn-primary" style="flex:1;" data-action="retry-individual-sync-gate">Retry Sync</button>
        <button class="btn" style="flex:1; background:var(--light); color:var(--text);" data-action="skip-individual-sync-gate">Continue with cached data</button>
      </div>
    </div>`;
  }

  return `<div class="card" style="margin-bottom:14px; padding:16px;">
    <div style="font-weight:800; color:var(--navy); font-size:13px;">🔄 Confirm latest inventory first</div>
    <div style="font-size:11px; color:var(--grey); margin-top:4px;">Last synced: ${lastSyncedLabel}. A Random Audit freezes whatever inventory is current the moment it starts — sync now so you're not counting against an old number.</div>
    <div style="display:flex; gap:8px; margin-top:10px;">
      <button class="btn btn-primary" style="flex:1;" data-action="run-individual-sync-gate">🔄 Sync Now</button>
      <button class="btn" style="flex:1; background:var(--light); color:var(--text);" data-action="cancel-individual-sync-gate">Cancel</button>
    </div>
  </div>`;
}

function renderIndividualPickerHTML() {
  const { role, myAssignments, templates } = Store.getState();
  if (role !== 'sub') return ''; // self-service is for staff picking their own work — the Main Auditor already has the full Team Audit picker
  // Rule #1: one open self-pick at a time, submit-first. Checked
  // against whatever's already loaded (myAssignments spans every
  // engagement this auditor has work in, individual or Team-assigned —
  // only a prior SELF-PICK blocks a new self-pick; being on a Team
  // round doesn't).
  const openSelfPick = (myAssignments || []).find(a => a.method === 'individual-self-pick' && (a.status === 'assigned' || a.status === 'counting'));
  if (openSelfPick) {
    const label = _individualAssignmentLabel(openSelfPick);
    const detail = openSelfPick.templateName
      ? `Total value: Rs ${Math.round(_assignmentTotalValue(openSelfPick)).toLocaleString()}`
      : `${openSelfPick.items.length} item line(s)`;
    return `<div class="card" style="margin-bottom:14px; background:var(--gold-bg); border:1px solid var(--gold);">
      <div style="font-size:12.5px; font-weight:700; color:var(--navy);">🎲 You have an open random audit — submit it first</div>
      <div style="font-size:11px; color:var(--grey); margin-top:2px;">${Components.esc(label)} · ${Components.esc(detail)}. Open it below to finish, then you can start another.</div>
    </div>`;
  }

  if (individualSyncGateOpen) {
    return renderSyncGateHTML();
  }

  if (!showIndividualPicker) {
    return `<button class="sort-btn" style="width:100%; margin-bottom:14px;" data-action="open-individual-sync-gate">🎲 Start a Random Audit</button>`;
  }

  const templateOptions = (templates || []).map(t => `<option value="${t.id}">${Components.esc(t.name)} (${t.codes.length} codes)</option>`).join('');
  return `
    <div class="card" style="margin-bottom:14px;">
      <div class="card-title" style="margin:0 0 8px;">🎲 Start a Random Audit</div>
      <div style="display:flex; gap:6px; margin-bottom:10px;">
        <button class="filter-btn${individualPickerSource === 'template' ? ' filter-btn-active' : ''}" data-action="set-individual-source" data-source="template" style="flex:1;">From a Template</button>
        <button class="filter-btn${individualPickerSource === 'companies' ? ' filter-btn-active' : ''}" data-action="set-individual-source" data-source="companies" style="flex:1;">Pick Companies</button>
      </div>
      ${individualPickerSource === 'template' ? `
        ${templates && templates.length > 0 ? `
        <select id="individual-template-select" class="settings-input" aria-label="Choose a template" style="margin-bottom:10px;">
          <option value="">— choose a template —</option>
          ${templateOptions}
        </select>` : `<div style="font-size:12px; color:var(--grey); margin-bottom:10px;">No saved templates yet — ask the Main Auditor to save one, or pick companies instead.</div>`}
      ` : `
        <div style="display:flex; gap:6px; margin-bottom:8px;">
          <input type="text" id="individual-company-search" class="settings-input" placeholder="🔍 Search company…" style="margin:0; flex:1;" data-input-action="filter-individual-companies">
          <button class="sort-btn" data-action="toggle-individual-sort">↕️ <span id="individual-sort-label">${individualSortAscending ? 'A-Z' : 'Z-A'}</span></button>
        </div>
        <div style="display:flex; gap:6px; margin-bottom:8px;">
          <button class="btn" style="flex:1; font-size:11px; padding:8px; background:var(--light); color:var(--text);" data-action="individual-select-all">Select All (filtered)</button>
          <button class="btn" style="flex:1; font-size:11px; padding:8px; background:var(--light); color:var(--text);" data-action="individual-clear-all">Clear All</button>
        </div>
        <div id="individual-company-picker" style="max-height:200px; overflow:auto; margin-bottom:6px;"></div>
        <div id="individual-selected-count" style="font-size:11px; color:var(--grey); margin-bottom:8px;"></div>
      `}
      <div style="display:flex; gap:8px;">
        <button class="btn btn-primary" style="flex:1;" data-action="confirm-start-individual">Start Counting</button>
        <button class="btn" style="flex:1; background:var(--light); color:var(--text);" data-action="close-individual-picker">Cancel</button>
      </div>
    </div>`;
}

function renderIndividualCompanyPicker() {
  const holder = $('individual-company-picker');
  const countLabel = $('individual-selected-count');
  if (!holder) return;
  const { products } = Store.getState();
  // Same per-company SKU count + total value math as the Main Auditor's
  // scope picker (renderScopeCompanyPicker in engagement-pages.js).
  const totals = {};
  products.forEach(p => {
    const t = totals[p.company] || { skus: 0, value: 0 };
    t.skus += 1; t.value += (p.qty || 0) * (p.price || 0);
    totals[p.company] = t;
  });
  let companies = Object.keys(totals);
  const query = individualSearchToken.toLowerCase().trim();
  if (query) companies = companies.filter(c => c.toLowerCase().includes(query));
  companies.sort((a, b) => individualSortAscending ? a.localeCompare(b) : b.localeCompare(a));

  holder.innerHTML = '';
  if (companies.length === 0) {
    holder.innerHTML = '<div style="text-align:center; color:var(--grey); padding:16px; font-size:12px;">No companies match.</div>';
  } else {
    companies.forEach(c => {
      const t = totals[c];
      holder.appendChild(Components.scopeCompanyCheckboxRow(c, individualSelectedCompanies.has(c), t.skus, t.value, 'toggle-individual-company'));
    });
  }
  if (countLabel) countLabel.textContent = individualSelectedCompanies.size + ' compan' + (individualSelectedCompanies.size === 1 ? 'y' : 'ies') + ' selected';
}

function renderAssignmentPickerHTML(myAssignments) {
  const { role } = Store.getState();
  const backLink = role === 'main'
    ? '<button class="sort-btn" data-action="team-back-to-manage" style="margin-bottom:10px;">← Back to Team Audit</button>'
    : '';
  const individualSection = renderIndividualPickerHTML();
  if (myAssignments.length === 0) {
    return backLink + individualSection + `<div class="card" style="text-align:center; padding:32px 20px;"><span style="font-size:40px;">📋</span><div style="font-weight:800; color:var(--navy); margin-top:10px;">No assignments yet.</div><div style="font-size:12px; color:var(--grey); margin-top:4px;">${role === 'sub' ? 'Start a random audit above, or ask the Main Auditor to assign you to a round.' : 'Ask the Main Auditor to assign you to a round.'}</div></div>`;
  }
  const openWork = myAssignments.filter(a => a.status === 'assigned' || a.status === 'counting');
  // "Past" folds in submitted AND revoked, so nothing a Sub-Auditor once
  // had just silently vanishes from their history without explanation.
  const past = myAssignments.filter(a => a.status === 'submitted' || a.status === 'revoked');

  const card = (a) => {
    const label = a.method === 'individual-self-pick' ? _individualAssignmentLabel(a) : (a.companies.join(', ') || (a.items.length + ' items'));
    // Template picks: total value only (matches the Main Auditor's
    // round card — the item-line count is exactly the noisy detail
    // the template name is meant to replace). Everything else keeps
    // the plain item-line count as before.
    const subLine = (a.method === 'individual-self-pick' && a.templateName)
      ? `💰 Total value: Rs ${Math.round(_assignmentTotalValue(a)).toLocaleString()}`
      : `${a.items.length} item line(s)`;
    return `
    <div class="card assignment-card" data-action="sub-open-assignment" data-assignment-id="${a.id}" style="cursor:pointer;${a.status === 'revoked' ? ' opacity:0.6;' : ''}" role="button" tabindex="0" aria-label="Open assignment — ${Components.esc(label)}, status ${Components.esc(a.status)}">
      <div style="display:flex; justify-content:space-between; align-items:center;">
        <div>
          <div style="font-weight:800; color:var(--navy); font-size:13px;">${Components.esc(label)}</div>
          <div style="font-size:11px; color:var(--grey); margin-top:2px;">${Components.esc(subLine)}</div>
        </div>
        <span class="val-badge ${a.status === 'submitted' ? 'val-green' : a.status === 'revoked' ? 'val-red' : 'val-gold'}">${Components.esc(a.status)}</span>
      </div>
    </div>`;
  };

  const openCards = openWork.map(card).join('') || '<div style="font-size:12px; color:var(--grey); padding:10px 0;">Nothing open right now.</div>';
  // If there's no open work, the Submitted section is all there is to
  // see — auto-expand it so the screen doesn't look empty on landing.
  const pastIsOpen = pickerSubmittedOpen || openWork.length === 0;
  const pastSection = past.length > 0 ? `
    <div class="history-item${pastIsOpen ? ' open' : ''}" style="margin-top:14px;">
      <div class="history-header" data-action="toggle-picker-submitted" role="button" tabindex="0" aria-expanded="${pastIsOpen ? 'true' : 'false'}">
        <div style="display:flex; align-items:center; gap:8px;">
          <span class="arrow-toggle" aria-hidden="true">&#9658;</span>
          <strong style="color:var(--navy); font-size:12.5px;">Submitted (${past.length})</strong>
        </div>
      </div>
      <div class="history-content">${past.map(card).join('')}</div>
    </div>` : '';

  return backLink + individualSection + `<div class="card-title">My Assignments</div>${openCards}${pastSection}`;
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
  const { myCounts, myNotes, myConfirms, myAutoMatched, myAssignments, activeAssignmentId } = Store.getState();
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
      //
      // Under the uncounted=0 rule, an untouched item contributes its
      // FULL system qty as an assumed shortage here, same as it would
      // in the final compiled report — this is what makes the running
      // total start at "full company variance" and visibly shrink as
      // items get counted, rather than starting at Rs 0 and only
      // growing as discrepancies are found.
      const companyItems = activeAssignment ? activeAssignment.items.filter(it => it.company === group.company) : group.items;
      const companyImpact = companyItems.reduce((sum, it) => {
        const c = myCounts[it.itemKey];
        const effectiveQty = c === undefined ? 0 : c;
        return sum + (effectiveQty - it.qty) * it.price;
      }, 0);
      const collapsed = collapsedCompanyGroups.has(group.company);
      tbody.appendChild(Components.companyGroupHeaderRow(group.company, companyImpact, collapsed));
      if (collapsed) return;
    }
    group.items.forEach(item => tbody.appendChild(Components.countingRow(
      item, myCounts[item.itemKey], (myNotes || {})[item.itemKey], readOnly,
      !!(myConfirms || {})[item.itemKey], !!(myAutoMatched || {})[item.itemKey]
    )));
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
      extraNoteOpen = false;
      await Actions.openMyAssignment(el.dataset.assignmentId);
    },
    'sub-back-to-list': () => {
      Actions.closeMyAssignment();
      countingSearchToken = ''; countingFilterMode = 'all'; countingSortAscending = true; collapsedCompanyGroups = new Set();
      subDashboardOpen = false; countingGroupByCompany = true; extraNoteOpen = false;
      renderTeamTabForSubAuditor();
    },
    'toggle-picker-submitted': () => { pickerSubmittedOpen = !pickerSubmittedOpen; renderTeamTabForSubAuditor(); },
    // Tapping "Start a Random Audit" opens the fresh-inventory gate
    // first, not the picker itself — see the block comment above
    // individualSyncGateOpen for why.
    'open-individual-sync-gate': () => {
      individualSyncGateOpen = true;
      individualSyncGateStatus = 'idle';
      individualSyncGateError = '';
      renderTeamTabForSubAuditor();
    },
    'run-individual-sync-gate': async () => {
      individualSyncGateStatus = 'syncing';
      renderTeamTabForSubAuditor();
      const result = await Actions.ensureFreshInventoryForAudit();
      if (result.ok) {
        // Sync landed — close the gate and open straight into the
        // real picker, exactly as if the person had tapped the old
        // button directly.
        individualSyncGateOpen = false;
        individualSyncGateStatus = 'idle';
        showIndividualPicker = true;
        individualPickerSource = 'template';
        individualSelectedCompanies = new Set();
        individualSearchToken = '';
        individualSortAscending = true;
      } else {
        individualSyncGateStatus = 'error';
        individualSyncGateError = result.error || 'Sync failed';
      }
      renderTeamTabForSubAuditor();
    },
    'retry-individual-sync-gate': async () => {
      await clickHandlers['run-individual-sync-gate']();
    },
    // Offline/edge-case escape hatch — proceeds with whatever's
    // already cached locally rather than blocking someone who
    // genuinely has no connection right now. Logged so a variance
    // that traces back to this is explainable after the fact.
    'skip-individual-sync-gate': () => {
      individualSyncGateOpen = false;
      individualSyncGateStatus = 'idle';
      showIndividualPicker = true;
      individualPickerSource = 'template';
      individualSelectedCompanies = new Set();
      individualSearchToken = '';
      individualSortAscending = true;
      Actions.logAudit('individual:startedWithoutFreshSync', { reason: individualSyncGateError });
      renderTeamTabForSubAuditor();
    },
    'cancel-individual-sync-gate': () => {
      individualSyncGateOpen = false;
      individualSyncGateStatus = 'idle';
      renderTeamTabForSubAuditor();
    },
    'close-individual-picker': () => {
      showIndividualPicker = false;
      individualPickerSource = 'template';
      individualSelectedCompanies = new Set();
      individualSearchToken = '';
      individualSortAscending = true;
      renderTeamTabForSubAuditor();
    },
    'set-individual-source': (el) => { individualPickerSource = el.dataset.source; renderTeamTabForSubAuditor(); },
    'toggle-individual-company': (el) => {
      const c = el.dataset.company;
      if (individualSelectedCompanies.has(c)) individualSelectedCompanies.delete(c);
      else individualSelectedCompanies.add(c);
      const countLabel = $('individual-selected-count');
      if (countLabel) countLabel.textContent = individualSelectedCompanies.size + ' compan' + (individualSelectedCompanies.size === 1 ? 'y' : 'ies') + ' selected';
    },
    'toggle-individual-sort': () => {
      individualSortAscending = !individualSortAscending;
      const lbl = $('individual-sort-label');
      if (lbl) lbl.textContent = individualSortAscending ? 'A-Z' : 'Z-A';
      renderIndividualCompanyPicker();
    },
    'individual-select-all': () => {
      const { products } = Store.getState();
      let companies = [...new Set(products.map(p => p.company))];
      const query = individualSearchToken.toLowerCase().trim();
      if (query) companies = companies.filter(c => c.toLowerCase().includes(query));
      companies.forEach(c => individualSelectedCompanies.add(c));
      renderIndividualCompanyPicker();
    },
    'individual-clear-all': () => { individualSelectedCompanies.clear(); renderIndividualCompanyPicker(); },
    'confirm-start-individual': async (el) => {
      // Guards against the double-tap this button had no protection
      // against before: on a slow connection a person taps once, sees
      // no immediate feedback, taps again — and without this, both
      // taps would fire their own startIndividualAssignment() call
      // before the first one's DB round-trip finished, each passing
      // the "do I already have one open" check and creating its own
      // round+assignment (see individual-actions.js for the DB-level
      // backstop for the same race). This is the cheap first line of
      // defense: block re-entry for the duration of this one call.
      if (el.disabled) return;
      el.disabled = true;
      let selection;
      if (individualPickerSource === 'template') {
        const select = $('individual-template-select');
        const templateId = select && select.value;
        if (!templateId) { Bus.emit('toast', { msg: 'Choose a template first', kind: 'error' }); el.disabled = false; return; }
        const { templates } = Store.getState();
        const template = templates.find(t => t.id === templateId);
        if (!template) { el.disabled = false; return; }
        selection = { source: 'template', codes: template.codes, name: template.name };
      } else {
        if (individualSelectedCompanies.size === 0) { Bus.emit('toast', { msg: 'Pick at least one company first', kind: 'error' }); el.disabled = false; return; }
        selection = { source: 'companies', companies: Array.from(individualSelectedCompanies) };
      }
      // Gate 3: a slow picker session (deliberating over template/
      // company choices) can let the gate's sync go stale again
      // before the snapshot is actually taken. Silent, best-effort —
      // skips the round-trip entirely if the sync that opened this
      // picker is still recent enough (see AUDIT_SYNC_STALE_MS), and
      // never blocks Start Counting even if it fails (the snapshot
      // still proceeds with whatever's cached, same as before this
      // gate existed) — this is a safety net, not a second hard stop.
      await Actions.ensureFreshInventoryForAudit({ skipIfSyncedWithinMs: Actions.AUDIT_SYNC_STALE_MS });
      const assignment = await Actions.startIndividualAssignment(selection);
      if (assignment) {
        showIndividualPicker = false;
        individualSelectedCompanies = new Set();
        await Actions.loadMyAssignments();
        await Actions.openMyAssignment(assignment.id);
        renderTeamTabForSubAuditor(); // rebuilds the button fresh, so no need to re-enable `el` here
      } else {
        el.disabled = false; // failed/blocked — let them retry (e.g. after the "finish your open one first" toast)
      }
    },
    'toggle-extra-note': () => { extraNoteOpen = !extraNoteOpen; renderTeamTabForSubAuditor(); },
    'team-back-to-manage': () => Bus.emit('team:viewManage'),
    'sub-submit-assignment': async () => {
      const submission = await Actions.submitMyAssignment();
      if (submission) {
        const { myAssignments } = Store.getState();
        const assignment = myAssignments.find(a => a.id === submission.assignmentId);
        await Actions.autoCompileIfIndividual(assignment);
      }
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
    'record-assignment-extra-note': (el) => Actions.recordMyExtraNote(el.value),
    'filter-individual-companies': (el) => { individualSearchToken = el.value; renderIndividualCompanyPicker(); },
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
