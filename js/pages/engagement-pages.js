import { Store } from '../store.js';
import { Actions, Bus } from '../actions.js';
import { Components } from '../components.js';

/* ══════════════════════════════════════════════════════════════
   FLOOR 5 — PAGES / engagement-pages.js
   Main-Auditor side of the "Team Audit" tab. One continuously-
   updating workspace (Engagement → Round → Assignment →
   Compile/Difference → Dashboard → Reports) rather than separate
   full-screen pages.

   Access no longer travels through a pairing link — a staff
   member simply logs in (Staff tab creates their login) and, the
   moment they're assigned, Postgres RLS lets them see exactly
   their own row. Nothing to generate or send per-assignment here.
   ══════════════════════════════════════════════════════════════ */

const $ = (id) => document.getElementById(id);

// Local, ephemeral UI-only state — same pattern as legacy-pages' pinBuffer.
let currentSubView = 'list';      // 'list' | 'detail'
let openRoundId = null;
let selectedStaffIds = [];
let showSubRoundPicker = false;
let subRoundSelectedCompanies = new Set();

// ── Root render dispatcher for the whole Team tab ──
export function renderTeamTab() {
  const container = $('team-tab-root');
  if (!container) return;
  const { role } = Store.getState();
  if (role !== 'main') return; // sub-pages.js owns rendering for a Sub-Auditor

  const { engagements, currentEngagementId, myAssignments } = Store.getState();
  const myWorkBanner = myWorkBannerHTML(myAssignments);
  if (!currentEngagementId || currentSubView === 'list') {
    _stopProgressPoll();
    container.innerHTML = myWorkBanner + renderEngagementListHTML(engagements);
    refreshEngagementCards();
    return;
  }
  const engagement = engagements.find(e => e.id === currentEngagementId);
  if (!engagement) { currentSubView = 'list'; return renderTeamTab(); }
  container.innerHTML = myWorkBanner + renderEngagementDetailHTML(engagement);
  refreshRoundList();
}

// Self-assigning yourself companies in a round only creates the
// assignment row — it doesn't put you anywhere to actually count.
// This banner is the entry point into that counting workspace,
// reusing the exact same UI a Sub-Auditor gets (search, sort,
// company grouping, Short/Over/Match filters, Mark Remaining as
// Match — see sub-pages.js).
function myWorkBannerHTML(myAssignments) {
  const active = (myAssignments || []).filter(a => a.status !== 'revoked' && a.status !== 'submitted');
  if (active.length === 0) return '';
  const itemCount = active.reduce((s, a) => s + a.items.length, 0);
  return `
    <button class="btn btn-primary btn-block" style="margin-bottom:10px; padding:12px; font-weight:700;" data-action="team-view-my-work">
      🧮 My Assigned Work — ${active.length} assignment(s), ${itemCount} item line(s)
    </button>`;
}

// ── §Engagement + §Scope Selection ──
let scopeSelectedCompanies = new Set();
let scopeSearchToken = '';
let scopeSortAscending = true;

function renderEngagementListHTML(engagements) {
  const cardsHtml = engagements.length === 0
    ? '<div class="card" style="text-align:center; padding:30px 16px;"><span style="font-size:36px;">🗂️</span><div style="font-weight:700; margin-top:8px; color:var(--navy);">No engagements yet.</div><div style="font-size:12px; color:var(--grey); margin-top:4px;">Create one to start a multi-auditor cycle.</div></div>'
    : '<div id="engagement-cards-holder"></div>';

  scopeSelectedCompanies = new Set();
  scopeSearchToken = '';
  scopeSortAscending = true;

  return `
    <div class="card-title">Engagements</div>
    ${cardsHtml}
    <div class="card-title">New Engagement</div>
    <div class="card">
      <label class="settings-label">Engagement Name</label>
      <input type="text" id="new-engagement-name" class="settings-input" placeholder="e.g. Q3 2026 Full Audit">
      <label class="settings-label">Scope</label>
      <select id="new-engagement-scope-type" class="settings-input" data-change-action="scope-type-changed">
        <option value="full">Full Inventory (every company)</option>
        <option value="selected">Selected Companies</option>
        <option value="single">Single Company</option>
      </select>
      <div id="scope-picker-wrap" style="display:none;">
        <div style="display:flex; gap:6px; margin-bottom:8px;">
          <input type="text" id="scope-company-search" class="settings-input" placeholder="🔍 Search company…" style="margin:0; flex:1;" data-input-action="filter-scope-companies">
          <button class="sort-btn" data-action="toggle-scope-sort">↕️ <span id="scope-sort-label">A-Z</span></button>
        </div>
        <div style="display:flex; gap:6px; margin-bottom:8px;">
          <button class="btn" style="flex:1; font-size:11px; padding:8px; background:var(--light); color:var(--text);" data-action="scope-select-all">Select All (filtered)</button>
          <button class="btn" style="flex:1; font-size:11px; padding:8px; background:var(--light); color:var(--text);" data-action="scope-clear-all">Clear All</button>
        </div>
        <div id="scope-company-picker" style="max-height:260px; overflow:auto; margin-bottom:6px;"></div>
        <div id="scope-selected-count" style="font-size:11px; color:var(--grey); margin-bottom:10px;"></div>
      </div>
      <button class="btn btn-primary btn-block" data-action="create-engagement">Create Engagement</button>
    </div>`;
}

function renderScopeCompanyPicker() {
  const holder = $('scope-company-picker');
  const countLabel = $('scope-selected-count');
  if (!holder) return;
  const { products } = Store.getState();
  const totals = {};
  products.forEach(p => {
    const t = totals[p.company] || { skus: 0, units: 0, value: 0 };
    t.skus += 1; t.units += (p.qty || 0); t.value += (p.qty || 0) * (p.price || 0);
    totals[p.company] = t;
  });
  let companies = Object.keys(totals);
  const query = scopeSearchToken.toLowerCase().trim();
  if (query) companies = companies.filter(c => c.toLowerCase().includes(query));
  companies.sort((a, b) => scopeSortAscending ? a.localeCompare(b) : b.localeCompare(a));

  holder.innerHTML = '';
  if (companies.length === 0) {
    holder.innerHTML = '<div style="text-align:center; color:var(--grey); padding:16px; font-size:12px;">No companies match.</div>';
  } else {
    companies.forEach(c => {
      const t = totals[c];
      holder.appendChild(Components.scopeCompanyCheckboxRow(c, scopeSelectedCompanies.has(c), t.skus, t.value));
    });
  }
  if (countLabel) countLabel.textContent = scopeSelectedCompanies.size + ' compan' + (scopeSelectedCompanies.size === 1 ? 'y' : 'ies') + ' selected';
}

function refreshEngagementCards() {
  const holder = $('engagement-cards-holder');
  if (!holder) return;
  const { engagements } = Store.getState();
  holder.innerHTML = '';
  engagements.slice().sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt)).forEach(e => holder.appendChild(Components.engagementCard(e)));
}
Bus.on('engagements:changed', () => { if (currentSubView === 'list') refreshEngagementCards(); });

function renderSubRoundSection(engagement) {
  const { products } = Store.getState();
  const allCompanies = [...new Set(products.map(p => p.company))];
  const newCompanies = allCompanies.filter(c => !engagement.scope.companies.includes(c)).sort((a, b) => a.localeCompare(b));

  if (!showSubRoundPicker) {
    return `<button class="sort-btn" style="width:100%; margin-bottom:14px;" data-action="toggle-subround-picker">➕ Add New Companies (Sub-Round)</button>`;
  }
  const rows = newCompanies.length === 0
    ? `<div style="font-size:12px; color:var(--grey); padding:8px 0;">Every company in the current inventory is already in this engagement's scope.</div>`
    : newCompanies.map(c => `
      <label class="scope-company-row">
        <input type="checkbox" class="custom-checkbox" data-action="toggle-subround-company" data-company="${c.replace(/"/g, '&quot;')}" ${subRoundSelectedCompanies.has(c) ? 'checked' : ''}>
        <span class="scope-company-name-wrap"><span class="scope-company-name">${c}</span></span>
      </label>`).join('');
  return `
    <div class="card" style="margin-bottom:14px;">
      <div class="card-title" style="margin:0 0 8px;">Add New Companies — creates a lettered sub-round (e.g. 1A) scoped to just these companies, without touching existing rounds. Compile it along with the rest of the round-1 family before Round 2 can start.</div>
      <div style="max-height:220px; overflow:auto; margin-bottom:8px;">${rows}</div>
      <div style="display:flex; gap:8px;">
        <button class="btn btn-primary" style="flex:1;" data-action="create-subround" ${newCompanies.length === 0 ? 'disabled' : ''}>Create Sub-Round</button>
        <button class="btn" style="flex:1; background:var(--light); color:var(--text);" data-action="toggle-subround-picker">Cancel</button>
      </div>
    </div>`;
}

// ── Engagement detail: Round Management + Assignment + Compile + Dashboard + Reports ──
function renderEngagementDetailHTML(engagement) {
  const { rounds } = Store.getState();
  const hasRounds = rounds.some(r => r.engagementId === engagement.id);
  return `
    <button class="sort-btn" data-action="team-back-to-list" style="margin-bottom:10px;">← All Engagements</button>
    ${Components.engagementHeaderHTML(engagement)}
    <div style="display:flex; gap:6px; margin:10px 0;">
      <button class="btn" style="flex:1; font-size:11px; padding:8px; background:var(--light); color:var(--text);" data-action="team-archive-engagement" data-engagement-id="${engagement.id}">${engagement.status === 'archived' ? 'Reopen' : 'Archive'}</button>
      <button class="btn btn-danger" style="flex:1; font-size:11px; padding:8px;" data-action="team-close-engagement" data-engagement-id="${engagement.id}">Close Permanently</button>
    </div>
    <button class="btn btn-danger" style="width:100%; font-size:11px; padding:8px; margin-bottom:10px; background:#7a1212;" data-action="team-delete-engagement" data-engagement-id="${engagement.id}">🗑️ Delete Engagement Forever</button>
    <div class="card-title">Rounds</div>
    <div id="round-list-holder"></div>
    ${hasRounds
      ? '<div style="font-size:11px; color:var(--grey); margin-bottom:14px; text-align:center;">To start Round 2+, compile the current round below, then use "Generate Next Round" — it builds the right item list for you.</div>'
      : '<button class="btn btn-primary btn-block" style="margin-bottom:14px;" data-action="team-create-round">➕ Create Round 1</button>'}
    <div id="subround-section-holder">${hasRounds ? renderSubRoundSection(engagement) : ''}</div>
    <div id="round-workspace-holder"></div>
    <div class="card-title">Dashboard</div>
    <div id="dashboard-holder"></div>
    <div class="card-title">Reports</div>
    <div style="font-size:11px; color:var(--grey); margin:-4px 0 8px;">Tap a report to see what it includes, or tap Export to download it right away.</div>
    ${Components.reportButtonsHTML()}
    <div id="final-snapshot-holder"></div>
  `;
}

function refreshSubRoundSection() {
  const holder = $('subround-section-holder');
  if (!holder) return;
  const { engagements, currentEngagementId } = Store.getState();
  const engagement = engagements.find(e => e.id === currentEngagementId);
  if (!engagement) return;
  holder.innerHTML = renderSubRoundSection(engagement);
}

function refreshRoundList() {
  const holder = $('round-list-holder');
  if (!holder) return;
  const { rounds } = Store.getState();
  const sorted = rounds.slice().sort((a, b) => a.roundNumber - b.roundNumber);
  holder.innerHTML = '';
  if (sorted.length === 0) { holder.appendChild(Components.noRoundsEmptyState()); return; }
  const latest = sorted[sorted.length - 1];
  sorted.forEach(r => holder.appendChild(Components.roundCard(r, r.id === latest.id)));
  refreshDashboard();
}
Bus.on('rounds:changed', () => { if (currentSubView === 'detail') refreshRoundList(); });

let _progressPollTimer = null;
function _stopProgressPoll() { clearInterval(_progressPollTimer); _progressPollTimer = null; }
function _startProgressPollIfNeeded(round) {
  _stopProgressPoll();
  if (!round || (round.state !== 'locked' && round.state !== 'counting')) return;
  // Lightweight — just re-fetches assignment rows (progress_count/status),
  // not the whole round. Only runs while this exact round's workspace is
  // on screen, and stops the moment the Main Auditor navigates away.
  _progressPollTimer = setInterval(async () => {
    if (!openRoundId || openRoundId !== round.id) { _stopProgressPoll(); return; }
    await Actions.loadAssignmentsForRound(round.id);
    refreshAssignmentCards();
  }, 15000);
}

async function openRound(roundId) {
  openRoundId = roundId;
  selectedStaffIds = [];
  pendingSplitPreview = null;
  pendingSplitStaffList = null;
  resetVarianceControls();
  await Actions.loadAssignmentsForRound(roundId);
  await Actions.noteAssignmentActivity(roundId);
  await Actions.loadSubmissionsForRound(roundId);
  await Actions.loadCompiledRoundsForEngagement(Store.getState().currentEngagementId);
  renderRoundWorkspace();
}

function renderRoundWorkspace() {
  const holder = $('round-workspace-holder');
  if (!holder || !openRoundId) { if (holder) holder.innerHTML = ''; _stopProgressPoll(); return; }
  const { rounds } = Store.getState();
  const round = rounds.find(r => r.id === openRoundId);
  if (!round) { holder.innerHTML = ''; _stopProgressPoll(); return; }
  _startProgressPollIfNeeded(round);

  let body = '';
  if (round.state === 'draft') {
    body = renderDraftAssignmentUI(round);
  } else if (round.state === 'locked' || round.state === 'counting') {
    body = renderLockedAssignmentsUI(round);
  } else if (round.state === 'compiled') {
    body = renderCompiledRoundUI(round);
  } else if (round.state === 'final') {
    body = '<div class="card">This round is final. See Reports below for the full snapshot.</div>';
  }

  holder.innerHTML = `
    <div class="card-title">Round ${round.roundNumber}${round.roundSuffix || ''} Workspace</div>
    <div class="card">${Components.roundStateStrip(round)}</div>
    ${body}
  `;
  if (round.state === 'draft') refreshStaffChips();
  if (round.state === 'draft' && (round.unit === 'company' || round.unit === 'item')) renderSplitPreview();
  if (['draft', 'locked', 'counting'].includes(round.state)) refreshAssignmentCards();
  if (round.state === 'locked' || round.state === 'counting') refreshCompileStatus();
}

// ── §Assignment Engine (draft round) ──
function renderDraftAssignmentUI(round) {
  if (round.unit === 'item') {
    return `
      <div class="card-title">Staff</div>
      <div class="card">
        <div id="auditor-chip-holder" style="display:flex; flex-wrap:wrap; gap:6px; margin-bottom:10px;"></div>
        <div style="font-size:11px; color:var(--grey);">No staff yet? Create logins in the Staff tab first. Tick yourself too if you want to count alongside them.</div>
      </div>
      <div class="card-title">Split ${round.itemSnapshot.length} Item(s)</div>
      <div class="card" style="display:flex; gap:8px;">
        <button class="btn btn-primary" style="flex:1; font-size:11px; padding:10px;" data-action="team-auto-split-count" data-round-id="${round.id}">By Count</button>
        <button class="btn btn-gold" style="flex:1; font-size:11px; padding:10px;" data-action="team-auto-split-volume" data-round-id="${round.id}">By Value</button>
      </div>
      <div id="split-preview-holder"></div>
      <div class="card-title">Assignments</div>
      <div id="assignment-cards-holder"></div>
      <button class="btn" style="width:100%; margin:10px 0; background:var(--green); color:white; padding:12px; font-weight:700;" data-action="team-lock-round" data-round-id="${round.id}">🔒 Lock Round</button>
    `;
  }
  return `
    <div class="card-title">Staff</div>
    <div class="card">
      <div id="auditor-chip-holder" style="display:flex; flex-wrap:wrap; gap:6px; margin-bottom:10px;"></div>
      <div style="font-size:11px; color:var(--grey);">No staff yet? Create logins in the Staff tab first. Tick yourself too if you want to count alongside them.</div>
    </div>
    <div class="card-title">Split Companies</div>
    <div class="card" style="display:flex; gap:8px;">
      <button class="btn btn-primary" style="flex:1; font-size:11px; padding:10px;" data-action="team-auto-split-count" data-round-id="${round.id}">By Count</button>
      <button class="btn btn-gold" style="flex:1; font-size:11px; padding:10px;" data-action="team-auto-split-volume" data-round-id="${round.id}">By Item Volume</button>
    </div>
    <div id="split-preview-holder"></div>
    <div class="card-title">Assignments</div>
    <div id="assignment-cards-holder"></div>
    <button class="btn" style="width:100%; margin:10px 0; background:var(--green); color:white; padding:12px; font-weight:700;" data-action="team-lock-round" data-round-id="${round.id}">🔒 Lock Round</button>
  `;
}

function refreshStaffChips() {
  const holder = $('auditor-chip-holder');
  if (!holder) return;
  const { staff, currentAuditorId, currentAuditorName } = Store.getState();
  holder.innerHTML = '';
  const self = { id: currentAuditorId, name: currentAuditorName + ' (You)' };
  holder.appendChild(Components.auditorChip(self, selectedStaffIds.includes(self.id)));
  staff.filter(s => s.role === 'sub').forEach(s => holder.appendChild(Components.auditorChip(s, selectedStaffIds.includes(s.id))));
}
Bus.on('staff:changed', () => { if (openRoundId) refreshStaffChips(); });

function refreshAssignmentCards() {
  const holder = $('assignment-cards-holder');
  if (!holder || !openRoundId) return;
  const { assignments, rounds } = Store.getState();
  const round = rounds.find(r => r.id === openRoundId);
  const roundAssignments = assignments.filter(a => a.roundId === openRoundId && a.status !== 'revoked');
  holder.innerHTML = '';
  if (roundAssignments.length === 0) { holder.appendChild(Components.noAssignmentsEmptyState()); return; }
  roundAssignments.forEach(a => holder.appendChild(Components.assignmentCard(a, roundAssignments, round?.state)));
}
Bus.on('assignments:changed', () => {
  if (openRoundId) refreshAssignmentCards();
  pendingSplitPreview = null;
  pendingSplitStaffList = null;
  renderSplitPreview();
  const { role } = Store.getState();
  if (role === 'main') Actions.loadMyAssignments();
  refreshDashboard(); // re-render company coverage whenever assignment data changes (including on refresh)
});

// ── Split preview (show before committing an auto-split) ──
let pendingSplitPreview = null;
let pendingSplitStaffList = null; // the exact staff list the preview was built from — confirm reuses this, not a fresh selectedStaff() read

function renderSplitPreview() {
  const holder = $('split-preview-holder');
  if (!holder) return;
  holder.innerHTML = pendingSplitPreview ? Components.splitPreviewHTML(pendingSplitPreview) : '';
}

function clearSplitPreview() {
  pendingSplitPreview = null;
  pendingSplitStaffList = null;
  renderSplitPreview();
}

function selectedStaff() {
  const { staff, currentAuditorId, currentAuditorName } = Store.getState();
  return selectedStaffIds.map(id => {
    if (id === currentAuditorId) return { id, name: currentAuditorName, isSelfPairing: true };
    return staff.find(s => s.id === id);
  }).filter(Boolean);
}

// ── §Pairing System, replaced: access is automatic on login now ──
function renderLockedAssignmentsUI(round) {
  return `
    <div class="card-title">Assignments — visible to each person the moment they log in</div>
    <div id="assignment-cards-holder"></div>
    <div class="card-title">Compile</div>
    <div id="compile-status-holder"></div>
    <button class="btn btn-primary btn-block" style="margin-top:8px;" data-action="team-compile-round" data-round-id="${round.id}">⚙️ Compile Round</button>
  `;
}
function refreshCompileStatus() {
  const holder = $('compile-status-holder');
  if (!holder || !openRoundId) return;
  const list = Actions.assignmentSubmissionStatus(openRoundId);
  holder.innerHTML = '';
  const card = document.createElement('div');
  card.className = 'card';
  list.forEach(entry => card.appendChild(Components.submissionStatusRow(entry)));
  holder.appendChild(card);
}
Bus.on('submissions:changed', () => { if (openRoundId) refreshCompileStatus(); });
Bus.on('compile:missingAssignments', ({ missing }) => {
  const holder = $('compile-status-holder');
  if (!holder) return;
  holder.insertAdjacentHTML('beforeend', Components.missingAssignmentsWarningHTML(missing));
});

// ── §Difference Engine — variance table sort + filter ──
// "Impact" = financial value of the discrepancy (qty variance × unit price),
// which is a much more useful default ordering for a Main Auditor triaging
// results than "whatever order compileRound happened to produce."
let varianceSortDesc = true;   // true = biggest impact first
let varianceFilterMin = null;  // absolute rupee impact, inclusive
let varianceFilterMax = null;

function _varianceImpact(row) { return (row.countedQty - row.systemQty) * (row.price || 0); }

function _visibleVariances(variances) {
  let list = variances;
  if (varianceFilterMin !== null) list = list.filter(row => Math.abs(_varianceImpact(row)) >= varianceFilterMin);
  if (varianceFilterMax !== null) list = list.filter(row => Math.abs(_varianceImpact(row)) <= varianceFilterMax);
  list = list.slice().sort((a, b) => {
    const diff = Math.abs(_varianceImpact(b)) - Math.abs(_varianceImpact(a));
    return varianceSortDesc ? diff : -diff;
  });
  return list;
}

function resetVarianceControls() {
  varianceSortDesc = true;
  varianceFilterMin = null;
  varianceFilterMax = null;
}

// ── §Compilation Engine + §Difference Engine (compiled round) ──
function renderCompiledRoundUI(round) {
  const { compiledRounds, rounds } = Store.getState();
  const compiled = compiledRounds.filter(c => c.roundId === round.id).pop();
  if (!compiled) return '<div class="card">Compiling…</div>';
  const familyReady = Actions.isFamilyFullyCompiled(rounds, round.roundNumber);
  const visible = _visibleVariances(compiled.variances);
  const varianceRows = visible.map(Components.varianceRowHTML).join('') || '<tr><td colspan="4" style="text-align:center; padding:16px; color:var(--grey);">No variances match this filter.</td></tr>';
  const filtered = visible.length !== compiled.variances.length;

  return `
    ${Components.compileSummaryCardHTML(compiled)}
    <div class="card" style="display:flex; gap:6px; align-items:center; flex-wrap:wrap; margin-bottom:10px;">
      <button class="sort-btn" data-action="toggle-variance-sort">↕️ Impact ${varianceSortDesc ? '↓ (biggest first)' : '↑ (smallest first)'}</button>
      <input type="number" id="variance-filter-min" class="search-input" placeholder="Min impact (Rs)" style="flex:1; min-width:100px;" value="${varianceFilterMin ?? ''}">
      <input type="number" id="variance-filter-max" class="search-input" placeholder="Max impact (Rs)" style="flex:1; min-width:100px;" value="${varianceFilterMax ?? ''}">
      <button class="btn btn-primary" style="font-size:11px; padding:10px;" data-action="apply-variance-filter">Apply</button>
      ${filtered ? '<button class="sort-btn" data-action="clear-variance-filter">Clear filter</button>' : ''}
      ${filtered ? `<div style="width:100%; font-size:10px; color:var(--grey);">Showing ${visible.length} of ${compiled.variances.length} variance(s)</div>` : ''}
    </div>
    <div style="background:white; border-radius:var(--radius); box-shadow:var(--shadow); overflow:hidden; margin-bottom:14px;">
      <table class="audit-table">
        <thead><tr><th style="padding-left:10px;">Item</th><th style="text-align:right;">Sys</th><th style="text-align:right;">Counted</th><th style="text-align:right; padding-right:10px;">Var</th></tr></thead>
        <tbody>${varianceRows}</tbody>
      </table>
    </div>
    <div class="card-title">Difference Engine — send the next round out</div>
    <div class="card">
      <label style="display:flex; align-items:center; gap:8px; margin-bottom:8px; cursor:pointer;">
        <input type="radio" name="diff-mode" value="differences" checked> Differences Only (${compiled.variances.length} lines)
      </label>
      <label style="display:flex; align-items:center; gap:8px; margin-bottom:8px; cursor:pointer;">
        <input type="radio" name="diff-mode" value="full"> Full Company Recount
      </label>
      <label style="display:flex; align-items:center; gap:8px; margin-bottom:10px; cursor:pointer;">
        <input type="radio" name="diff-mode" value="spotcheck"> Random Spot-Check (10 items)
      </label>
      <div style="font-size:11px; color:var(--grey); margin-bottom:10px;">After generating, you'll pick staff and preview the split before it's assigned — same as Round 1.</div>
      ${!familyReady ? `<div style="font-size:11px; color:var(--red); margin-bottom:8px;">⚠️ Compile every Round ${Actions.familyLabel(rounds, round.roundNumber)} sub-round (including any lettered ones) before starting the next round.</div>` : ''}
      <button class="btn btn-gold btn-block" data-action="team-generate-diff-round" data-compiled-id="${compiled.id}" ${!familyReady ? 'disabled' : ''}>Generate Next Round</button>
    </div>
    <button class="btn btn-block" style="background:var(--green); color:white; padding:12px; font-weight:700;" data-action="team-finalize-engagement">✅ Generate Final Snapshot (stop here)</button>
  `;
}

// ── §Dashboard ──
function refreshDashboard() {
  const holder = $('dashboard-holder');
  if (!holder) return;
  const { currentEngagementId } = Store.getState();
  const dash = Actions.mainAuditorDashboard(currentEngagementId, openRoundId);
  holder.innerHTML = Components.mainDashboardHTML(dash);
}

// ── §Reporting ──
Bus.on('snapshot:generated', (snapshot) => {
  const holder = $('final-snapshot-holder');
  if (holder) holder.innerHTML = Components.finalSnapshotCardHTML(snapshot);
});

/* ── Handler maps, consumed by pages/event-delegation.js ── */
export function initEngagementPages() {
  const clickHandlers = {
    'open-engagement': async (el) => {
      await Actions.openEngagement(el.dataset.engagementId);
      currentSubView = 'detail'; openRoundId = null;
      renderTeamTab();
    },
    'team-back-to-list': () => { Actions.closeEngagementView(); currentSubView = 'list'; openRoundId = null; renderTeamTab(); },
    'team-view-my-work': () => Bus.emit('team:viewMyWork'),
    'create-engagement': async () => {
      const name = $('new-engagement-name').value;
      const type = $('new-engagement-scope-type').value;
      const companies = Array.from(scopeSelectedCompanies);
      const engagement = await Actions.createEngagement(name, { type, companies });
      if (engagement) { currentSubView = 'detail'; renderTeamTab(); }
    },
    'toggle-scope-company': (el) => {
      if (el.checked) scopeSelectedCompanies.add(el.dataset.company);
      else scopeSelectedCompanies.delete(el.dataset.company);
      const countLabel = $('scope-selected-count');
      if (countLabel) countLabel.textContent = scopeSelectedCompanies.size + ' compan' + (scopeSelectedCompanies.size === 1 ? 'y' : 'ies') + ' selected';
    },
    'toggle-scope-sort': () => {
      scopeSortAscending = !scopeSortAscending;
      const lbl = $('scope-sort-label');
      if (lbl) lbl.textContent = scopeSortAscending ? 'A-Z' : 'Z-A';
      renderScopeCompanyPicker();
    },
    'scope-select-all': () => {
      const { products } = Store.getState();
      let companies = [...new Set(products.map(p => p.company))];
      const query = scopeSearchToken.toLowerCase().trim();
      if (query) companies = companies.filter(c => c.toLowerCase().includes(query));
      companies.forEach(c => scopeSelectedCompanies.add(c));
      renderScopeCompanyPicker();
    },
    'scope-clear-all': () => { scopeSelectedCompanies.clear(); renderScopeCompanyPicker(); },
    'team-archive-engagement': async (el) => {
      const { engagements } = Store.getState();
      const eng = engagements.find(e => e.id === el.dataset.engagementId);
      if (eng && eng.status === 'archived') await Actions.reopenEngagement(eng.id); else await Actions.archiveEngagement(el.dataset.engagementId);
      renderTeamTab();
    },
    'team-close-engagement': async (el) => { await Actions.closeEngagementPermanently(el.dataset.engagementId); renderTeamTab(); },
    'team-delete-engagement': async (el) => {
      const deleted = await Actions.deleteEngagementForever(el.dataset.engagementId);
      if (deleted) { currentSubView = 'list'; openRoundId = null; }
      renderTeamTab();
    },
    'team-create-round': async () => { const r = await Actions.createRound(); if (r) openRound(r.id); },
    'view-live-snapshot': async (el) => {
      const overlay = $('live-snapshot-overlay');
      const content = $('live-snapshot-content');
      if (!overlay || !content) return;
      content.innerHTML = '<div style="text-align:center; padding:30px 0; color:var(--grey); font-size:13px;">Loading…</div>';
      overlay.style.display = 'flex';
      const assignment = await Actions.fetchLiveAssignmentSnapshot(el.dataset.assignmentId);
      content.innerHTML = Components.liveSnapshotModalHTML(assignment);
    },
    'refresh-live-snapshot': async (el) => {
      const content = $('live-snapshot-content');
      if (!content) return;
      const assignment = await Actions.fetchLiveAssignmentSnapshot(el.dataset.assignmentId);
      content.innerHTML = Components.liveSnapshotModalHTML(assignment);
      Bus.emit('toast', { msg: 'Refreshed', kind: 'success' });
    },
    'close-live-snapshot': () => {
      const overlay = $('live-snapshot-overlay');
      if (overlay) overlay.style.display = 'none';
    },
    'toggle-subround-picker': () => { showSubRoundPicker = !showSubRoundPicker; subRoundSelectedCompanies = new Set(); refreshSubRoundSection(); },
    'toggle-subround-company': (el) => {
      const c = el.dataset.company;
      if (subRoundSelectedCompanies.has(c)) subRoundSelectedCompanies.delete(c);
      else subRoundSelectedCompanies.add(c);
    },
    'create-subround': async () => {
      const { currentEngagementId } = Store.getState();
      const companies = Array.from(subRoundSelectedCompanies);
      if (companies.length === 0) { Bus.emit('toast', { msg: 'Select at least one company', kind: 'error' }); return; }
      const eng = await Actions.addCompaniesToEngagementScope(currentEngagementId, companies);
      if (!eng) return;
      const round = await Actions.createSubRound(companies);
      showSubRoundPicker = false;
      subRoundSelectedCompanies = new Set();
      if (round) { await openRound(round.id); } else { renderTeamTab(); }
    },
    'open-round': (el) => openRound(el.dataset.roundId),
    'toggle-auditor-select': (el) => {
      const id = el.dataset.auditorId;
      if (selectedStaffIds.includes(id)) selectedStaffIds = selectedStaffIds.filter(x => x !== id);
      else selectedStaffIds.push(id);
      if (pendingSplitPreview) clearSplitPreview();
      refreshStaffChips();
    },
    'team-auto-split-count': async (el) => {
      const { rounds } = Store.getState();
      const round = rounds.find(r => r.id === el.dataset.roundId);
      if (!round) return;
      const staffList = selectedStaff();
      pendingSplitPreview = round.unit === 'item'
        ? Actions.previewSplitItems(round, round.itemSnapshot, staffList, false)
        : Actions.previewSplitByCompanyCount(round, staffList);
      pendingSplitStaffList = pendingSplitPreview ? staffList : null;
      renderSplitPreview();
    },
    'team-auto-split-volume': async (el) => {
      const { rounds } = Store.getState();
      const round = rounds.find(r => r.id === el.dataset.roundId);
      if (!round) return;
      const staffList = selectedStaff();
      pendingSplitPreview = round.unit === 'item'
        ? Actions.previewSplitItems(round, round.itemSnapshot, staffList, true)
        : Actions.previewSplitByItemVolume(round, staffList);
      pendingSplitStaffList = pendingSplitPreview ? staffList : null;
      renderSplitPreview();
    },
    'confirm-split-preview': async () => {
      const { rounds } = Store.getState();
      const round = rounds.find(r => r.id === openRoundId);
      if (!round || !pendingSplitPreview || !pendingSplitStaffList) return;
      if (round.unit === 'item') await Actions.commitItemSplitPreview(round, pendingSplitStaffList, pendingSplitPreview);
      else await Actions.commitSplitPreview(round, pendingSplitStaffList, pendingSplitPreview);
      // 'assignments:changed' (emitted by commit on success) already
      // clears the pending preview and re-renders it — nothing more to do here.
    },
    'cancel-split-preview': () => clearSplitPreview(),
    'toggle-variance-sort': () => { varianceSortDesc = !varianceSortDesc; renderRoundWorkspace(); },
    'apply-variance-filter': () => {
      const minEl = $('variance-filter-min'), maxEl = $('variance-filter-max');
      const minRaw = minEl ? minEl.value.trim() : '';
      const maxRaw = maxEl ? maxEl.value.trim() : '';
      const minParsed = minRaw === '' ? null : Number(minRaw);
      const maxParsed = maxRaw === '' ? null : Number(maxRaw);
      if ((minParsed !== null && isNaN(minParsed)) || (maxParsed !== null && isNaN(maxParsed))) {
        Bus.emit('toast', { msg: 'Impact filter must be a number', kind: 'error' });
        return;
      }
      if (minParsed !== null && maxParsed !== null && minParsed > maxParsed) {
        Bus.emit('toast', { msg: 'Min impact can\'t be greater than max impact', kind: 'error' });
        return;
      }
      varianceFilterMin = minParsed === null ? null : Math.abs(minParsed);
      varianceFilterMax = maxParsed === null ? null : Math.abs(maxParsed);
      renderRoundWorkspace();
    },
    'clear-variance-filter': () => { varianceFilterMin = null; varianceFilterMax = null; renderRoundWorkspace(); },
    'revoke-assignment': (el) => Actions.revokeAssignment(el.dataset.assignmentId),
    'reopen-assignment': (el) => Actions.reopenAssignment(el.dataset.assignmentId),
    'team-lock-round': async (el) => { await Actions.lockRound(el.dataset.roundId); renderRoundWorkspace(); },
    'team-compile-round': async (el) => { await Actions.compileRound(el.dataset.roundId); renderRoundWorkspace(); },
    'compile-with-missing': async () => { if (openRoundId) { await Actions.compileRoundWithMissingOverride(openRoundId); renderRoundWorkspace(); } },
    'team-generate-diff-round': async (el) => {
      const mode = (document.querySelector('input[name="diff-mode"]:checked') || {}).value || 'differences';
      const { compiledRounds, engagements } = Store.getState();
      const compiled = compiledRounds.find(c => c.id === el.dataset.compiledId);
      if (!compiled) return;
      const engagement = engagements.find(e => e.id === compiled.engagementId);
      const { rounds } = Store.getState();
      const sourceRound = rounds.find(r => r.id === compiled.roundId);
      const sourceRoundLabel = sourceRound ? (sourceRound.roundNumber + (sourceRound.roundSuffix || '')) : null;
      const items = Actions.buildItemsForMode(compiled, mode, { companies: engagement.scope.companies, sampleSize: 10, sourceRoundNumber: sourceRoundLabel });
      if (items.length === 0) { Bus.emit('toast', { msg: 'Nothing to send — no variances found', kind: 'error' }); return; }
      const round = await Actions.createItemRound(compiled.roundId, items);
      if (!round) return;
      selectedStaffIds = [];
      Actions.logDifferenceRoundGenerated(round.id, mode, items.length);
      await openRound(round.id);
    },
    'team-finalize-engagement': async () => {
      const { currentEngagementId } = Store.getState();
      const snapshot = await Actions.generateFinalSnapshot(currentEngagementId);
      if (snapshot) { openRoundId = null; renderTeamTab(); return; }
      // generateFinalSnapshot may have loaded a DIFFERENT sibling round's
      // assignments/submissions into the Store while checking the round
      // family (see snapshot-actions.js) — if it then failed partway and
      // this workspace is still on screen, restore its own round's data
      // so a follow-up action here (e.g. Compile Round) isn't silently
      // working off the wrong round's cached rows.
      if (openRoundId) {
        await Actions.loadAssignmentsForRound(openRoundId);
        await Actions.loadSubmissionsForRound(openRoundId);
        renderRoundWorkspace();
      }
    },
    'export-final-audit-report': () => {
      const { finalSnapshots, engagements, currentEngagementId } = Store.getState();
      const snap = finalSnapshots.filter(s => s.engagementId === currentEngagementId).pop();
      const eng = engagements.find(e => e.id === currentEngagementId);
      if (snap && eng) Actions.exportFinalAuditReportXLSX(snap, eng.name);
      else Bus.emit('toast', { msg: 'Generate the Final Snapshot first', kind: 'error' });
    },
    'export-variance-report': () => {
      const { rounds, compiledRounds, currentEngagementId } = Store.getState();
      const engRounds = rounds.filter(r => r.engagementId === currentEngagementId).sort((a, b) => a.roundNumber - b.roundNumber);
      const latestRound = engRounds[engRounds.length - 1];
      const compiled = latestRound ? compiledRounds.filter(c => c.roundId === latestRound.id).pop() : null;
      if (compiled) Actions.exportVarianceReportXLSX(compiled, 'Round ' + latestRound.roundNumber + (latestRound.roundSuffix || ''));
      else Bus.emit('toast', { msg: 'Compile the round first — there\'s nothing to report on yet', kind: 'error' });
    },
    'export-round-history': () => {
      const { rounds, engagements, currentEngagementId } = Store.getState();
      const eng = engagements.find(e => e.id === currentEngagementId);
      if (eng) Actions.exportRoundHistoryXLSX(eng, rounds);
    },
    'export-submission-history': () => {
      const { submissions, assignments, engagements, currentEngagementId } = Store.getState();
      const eng = engagements.find(e => e.id === currentEngagementId);
      if (eng) Actions.exportSubmissionHistoryXLSX(eng, submissions, assignments);
    },
    'export-audit-trail': () => {
      const { auditLog, engagements, currentEngagementId } = Store.getState();
      const eng = engagements.find(e => e.id === currentEngagementId);
      if (eng) Actions.exportAuditTrailXLSX(eng, auditLog);
    },
  };

  const changeHandlers = {
    'scope-type-changed': () => {
      const type = $('new-engagement-scope-type').value;
      const wrap = $('scope-picker-wrap');
      if (wrap) wrap.style.display = (type === 'full') ? 'none' : 'block';
      if (type !== 'full') renderScopeCompanyPicker();
    },
    // Manual Rebalance — the "Move to…" select next to each company/item row.
    'move-target-selected': async (el) => {
      const toAssignmentId = el.value;
      if (!toAssignmentId) return;
      const fromAssignmentId = el.dataset.fromAssignment;
      if (el.dataset.moveKind === 'company') await Actions.manualMoveCompany(fromAssignmentId, toAssignmentId, el.dataset.moveValue);
      else await Actions.manualMoveItem(fromAssignmentId, toAssignmentId, el.dataset.moveValue);
      el.value = '';
    },
  };

  const inputHandlers = {
    'filter-scope-companies': (el) => { scopeSearchToken = el.value; renderScopeCompanyPicker(); },
  };

  return { clickHandlers, changeHandlers, inputHandlers, keydownHandlers: {} };
}
