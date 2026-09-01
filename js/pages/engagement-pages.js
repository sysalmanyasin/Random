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

// ── Individual Assignments (grouped-by-staff view) ─────────────
let individualExpandedStaff = new Set(); // auditor names currently expanded
let individualSelectedRounds = new Set(); // roundIds picked for recompile

async function renderIndividualDashboard() {
  const holder = $('individual-tab-root');
  if (!holder) return;
  holder.innerHTML = '<div class="card" style="text-align:center; padding:24px; color:var(--grey);">Loading…</div>';

  const engagement = await Actions.getOrCreateCurrentIndividualEngagement();
  if (!engagement) { holder.innerHTML = '<div class="card">Could not load Individual Assignments.</div>'; return; }

  // loadIndividualDashboardData (individual-actions.js) now also syncs
  // this fetch into the global Store — see that function for why: the
  // Reports tab's _buildReportOverview reads Store.getState() directly,
  // and Individual Assignments rounds are auto-compiled via a
  // security-definer RPC that never went through compileRound()'s
  // Store.setState, so Reports never saw them as compiled even though
  // this dashboard (which fetches fresh from the DB) always did.
  const { rounds, assignments, compiledRounds } = await Actions.loadIndividualDashboardData(engagement);
  holder.innerHTML = _renderIndividualDashboardBody(engagement, rounds, assignments, compiledRounds);
}

function _renderIndividualDashboardBody(engagement, rounds, assignments, compiledRounds) {
  const grouped = Actions.groupIndividualAssignmentsByStaff(rounds, assignments, compiledRounds);
  const isCurrent = Actions.isCurrentIndividualMonth(engagement);

  const staffSections = grouped.map(({ auditorName, items }) => {
    const isOpen = individualExpandedStaff.has(auditorName);
    const rows = items.map(it => `
      <div class="movable-row">
        <label style="display:flex; align-items:center; gap:8px; flex:1; min-width:0; cursor:pointer;">
          <input type="checkbox" class="custom-checkbox" data-action="toggle-individual-round-select" data-round-id="${it.roundId}" ${individualSelectedRounds.has(it.roundId) ? 'checked' : ''} ${it.status !== 'compiled' ? 'disabled' : ''}>
          <span style="min-width:0;">
            <div style="font-size:12.5px; font-weight:700; color:var(--navy);">${Components.esc(it.label)}</div>
            <div style="font-size:10.5px; color:var(--grey);">${new Date(it.date).toLocaleDateString('en-PK')}</div>
          </span>
        </label>
        <span class="val-badge ${it.status === 'compiled' ? (it.varianceCount > 0 ? 'val-red' : 'val-green') : 'val-gold'}">
          ${it.status === 'compiled' ? it.varianceCount + ' variance(s)' : it.status}
        </span>
      </div>`).join('');
    return `
      <div class="history-item${isOpen ? ' open' : ''}">
        <div class="history-header" data-action="toggle-individual-staff" data-auditor="${Components.esc(auditorName)}" role="button" tabindex="0" aria-expanded="${isOpen ? 'true' : 'false'}">
          <div style="display:flex; align-items:center; gap:8px;">
            <span class="arrow-toggle" aria-hidden="true">&#9658;</span>
            <strong style="color:var(--navy); font-size:13px;">${Components.esc(auditorName)}</strong>
          </div>
          <span style="font-size:11px; color:var(--grey);">${items.length} audit(s)</span>
        </div>
        <div class="history-content">${rows}</div>
      </div>`;
  }).join('') || '<div class="card" style="text-align:center; padding:24px; color:var(--grey);">No staff have started a random audit yet this month.</div>';

  return `
    <div class="card" style="margin-bottom:14px;">
      <div style="display:flex; justify-content:space-between; align-items:center;">
        <div>
          <div style="font-weight:800; color:var(--navy); font-size:14px;">${Components.esc(engagement.name)}</div>
          <div style="font-size:11px; color:var(--grey); margin-top:2px;">${grouped.reduce((s, g) => s + g.items.length, 0)} audit(s) from ${grouped.length} staff member(s)</div>
        </div>
        <span class="val-badge ${isCurrent ? 'val-green' : 'val-grey'}">${isCurrent ? 'this month' : 'closed'}</span>
      </div>
    </div>
    ${staffSections}
    ${individualSelectedRounds.size > 0 ? `
    <div class="card" style="margin-top:14px; position:sticky; bottom:12px; box-shadow:var(--shadow-md);">
      <div style="font-size:12px; font-weight:700; color:var(--navy); margin-bottom:8px;">${individualSelectedRounds.size} round(s) selected for recompile</div>
      <input type="text" id="individual-recompile-name" class="settings-input" placeholder="Name for the new template" style="margin-bottom:8px;">
      <button class="btn btn-primary btn-block" data-action="confirm-recompile-individual">Recompile → Save as Template</button>
    </div>` : ''}
  `;
}


let currentSubView = 'list';      // 'list' | 'detail'
let openRoundId = null;
let selectedStaffIds = [];
let showSubRoundPicker = false;
let subRoundSelectedCompanies = new Set();
let subRoundSearchToken = '';
let subRoundSortAscending = true;
// Which Main-Auditor dashboard sections (Auditor Progress / Company
// Coverage / Compile Status) are expanded — all start collapsed. Kept
// here rather than read off the DOM because refreshDashboard() replaces
// the holder's innerHTML wholesale on every live update.
let dashboardOpenSections = new Set();
// Whether item-unit assignment cards show a flat item list or grouped
// by company — page-local UI state, not worth putting in the store.
let assignmentGroupByCompany = false;
// Live Snapshot popup state — reset each time it's opened for a
// (possibly different) assignment, same lifecycle as the sub-dashboard's
// filterMode/sortAscending.
let liveSnapshotAssignmentId = null;
let liveSnapshotFilterMode = 'all';
let liveSnapshotSortMode = 'name-asc';
const LIVE_SNAPSHOT_SORT_CYCLE = ['name-asc', 'name-desc', 'variance-desc', 'variance-asc', 'time-desc'];

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
      <label class="settings-label" for="new-engagement-name">Engagement Name</label>
      <input type="text" id="new-engagement-name" class="settings-input" placeholder="e.g. Q3 2026 Full Audit">
      <label class="settings-label" for="new-engagement-scope-type">Scope</label>
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

  const sorted = engagements
    .slice()
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

  const active = sorted.filter(e => e.status !== 'closed');
  const closed = sorted.filter(e => e.status === 'closed');

  // Keep open/archived engagements visible normally.
  active.forEach(e => holder.appendChild(Components.engagementCard(e)));

  // Keep all closed engagements together in one collapsed section.
  if (closed.length > 0) {
    const details = document.createElement('details');
    details.className = 'closed-engagements-section';
    details.style.cssText = 'margin-top:10px;';

    const summary = document.createElement('summary');
    summary.style.cssText = `
      cursor:pointer;
      padding:10px 12px;
      border-radius:8px;
      background:var(--light);
      color:var(--navy);
      font-size:12px;
      font-weight:700;
      user-select:none;
    `;
    summary.textContent = `Closed engagements (${closed.length})`;

    const closedHolder = document.createElement('div');
    closedHolder.style.cssText = 'margin-top:8px;';

    closed.forEach(e => {
      closedHolder.appendChild(Components.engagementCard(e));
    });

    details.appendChild(summary);
    details.appendChild(closedHolder);
    holder.appendChild(details);
  }
}
Bus.on('engagements:changed', () => { if (currentSubView === 'list') refreshEngagementCards(); });
Bus.on('view:activated', (page) => { if (page === 'individual') renderIndividualDashboard(); });

function renderSubRoundSection(engagement) {
  const { products } = Store.getState();
  const allCompanies = [...new Set(products.map(p => p.company))];
  const newCompanies = allCompanies.filter(c => !engagement.scope.companies.includes(c));

  if (!showSubRoundPicker) {
    return `<button class="sort-btn" style="width:100%; margin-bottom:14px;" data-action="toggle-subround-picker">➕ Add New Companies (Sub-Round)</button>`;
  }
  return `
    <div class="card" style="margin-bottom:14px;">
      <div class="card-title" style="margin:0 0 8px;">Add New Companies — creates a lettered sub-round (e.g. 1A) scoped to just these companies, without touching existing rounds. Compile it along with the rest of the round-1 family before Round 2 can start.</div>
      ${newCompanies.length === 0 ? `
      <div style="font-size:12px; color:var(--grey); padding:8px 0;">Every company in the current inventory is already in this engagement's scope.</div>
      ` : `
      <div style="display:flex; gap:6px; margin-bottom:8px;">
        <input type="text" id="subround-company-search" class="settings-input" placeholder="🔍 Search company…" style="margin:0; flex:1;" data-input-action="filter-subround-companies">
        <button class="sort-btn" data-action="toggle-subround-sort">↕️ <span id="subround-sort-label">${subRoundSortAscending ? 'A-Z' : 'Z-A'}</span></button>
      </div>
      <div style="display:flex; gap:6px; margin-bottom:8px;">
        <button class="btn" style="flex:1; font-size:11px; padding:8px; background:var(--light); color:var(--text);" data-action="subround-select-all">Select All (filtered)</button>
        <button class="btn" style="flex:1; font-size:11px; padding:8px; background:var(--light); color:var(--text);" data-action="subround-clear-all">Clear All</button>
      </div>
      <div id="subround-company-picker" style="max-height:220px; overflow:auto; margin-bottom:6px;"></div>
      <div id="subround-selected-count" style="font-size:11px; color:var(--grey); margin-bottom:8px;"></div>
      `}
      <div style="display:flex; gap:8px;">
        <button class="btn btn-primary" style="flex:1;" data-action="create-subround" ${newCompanies.length === 0 ? 'disabled' : ''}>Create Sub-Round</button>
        <button class="btn" style="flex:1; background:var(--light); color:var(--text);" data-action="toggle-subround-picker">Cancel</button>
      </div>
    </div>`;
}

function renderSubRoundCompanyPicker(engagement) {
  const holder = $('subround-company-picker');
  const countLabel = $('subround-selected-count');
  if (!holder) return;
  const { products } = Store.getState();
  const totals = {};
  products.forEach(p => {
    const t = totals[p.company] || { skus: 0, units: 0, value: 0 };
    t.skus += 1; t.units += (p.qty || 0); t.value += (p.qty || 0) * (p.price || 0);
    totals[p.company] = t;
  });
  let companies = Object.keys(totals).filter(c => !engagement.scope.companies.includes(c));
  const query = subRoundSearchToken.toLowerCase().trim();
  if (query) companies = companies.filter(c => c.toLowerCase().includes(query));
  companies.sort((a, b) => subRoundSortAscending ? a.localeCompare(b) : b.localeCompare(a));

  holder.innerHTML = '';
  if (companies.length === 0) {
    holder.innerHTML = '<div style="text-align:center; color:var(--grey); padding:16px; font-size:12px;">No companies match.</div>';
  } else {
    companies.forEach(c => {
      const t = totals[c];
      holder.appendChild(Components.scopeCompanyCheckboxRow(c, subRoundSelectedCompanies.has(c), t.skus, t.value, 'toggle-subround-company'));
    });
  }
  if (countLabel) countLabel.textContent = subRoundSelectedCompanies.size + ' compan' + (subRoundSelectedCompanies.size === 1 ? 'y' : 'ies') + ' selected';
}

// ── Engagement detail: Round Management + Assignment + Compile + Dashboard + Reports ──
// Rounds / Dashboard / Reports are swipeable panels (scroll-snap) rather
// than one long vertical stack — see .swipe-track / .swipe-panel in
// app.css. The pill row mirrors the existing .section-sub-tab look used
// for the Engagements/Staff/Individual tabs, so it stays visually
// consistent while acting as tap-to-jump shortcuts for the swipe.
let engagementSwipeTab = 'rounds';
// Closed by default: the two irreversible actions (Close Permanently,
// Delete Forever) used to sit — full-width, high-contrast red — as the
// very first tappable elements on an engagement screen a Main Auditor
// opens every day. They're now tucked behind an explicit disclosure
// below the actual workflow (Rounds/Dashboard/Reports), so a daily
// glance/tap pattern never lands anywhere near them by accident.
// Archive is reversible (see Actions.reopenEngagement) so it stays up
// near the header as an ordinary secondary action, visually separated
// from the destructive pair by no longer sharing a row or a color.
let engagementDangerZoneOpen = false;

function renderEngagementDetailHTML(engagement) {
  const { rounds } = Store.getState();
  const hasRounds = rounds.some(r => r.engagementId === engagement.id);
  const tab = (key) => engagementSwipeTab === key ? 'section-sub-tab active' : 'section-sub-tab';
  return `
    <button class="sort-btn" data-action="team-back-to-list" style="margin-bottom:10px;">← All Engagements</button>
    ${Components.engagementHeaderHTML(engagement)}
    <button class="btn" style="width:100%; font-size:11px; padding:8px; margin:10px 0; background:var(--light); color:var(--text);" data-action="team-archive-engagement" data-engagement-id="${engagement.id}">${engagement.status === 'archived' ? '↩️ Reopen Engagement' : '🗄️ Archive (keeps everything, hides from the open list)'}</button>

    <div class="section-nav-card" style="margin-bottom:10px;">
      <div class="section-sub-tabs">
        <button class="${tab('rounds')}" data-action="team-swipe-tab" data-swipe="rounds">Rounds</button>
        <button class="${tab('dashboard')}" data-action="team-swipe-tab" data-swipe="dashboard">Dashboard</button>
        <button class="${tab('reports')}" data-action="team-swipe-tab" data-swipe="reports">Reports</button>
      </div>
    </div>

    <div class="swipe-track" id="engagement-swipe-track" data-action-scroll="team-swipe-scroll">
      <div class="swipe-panel" id="swipe-panel-rounds">
        <div class="card-title" style="margin-top:0;">Rounds</div>
        <div id="round-list-holder"></div>
        ${hasRounds
          ? '<div style="font-size:11px; color:var(--grey); margin-bottom:14px; text-align:center;">To start Round 2+, compile the current round below, then use "Generate Next Round" — it builds the right item list for you.</div>'
          : '<button class="btn btn-primary btn-block" style="margin-bottom:14px;" data-action="team-create-round">➕ Create Round 1</button>'}
        <div id="subround-section-holder">${hasRounds ? renderSubRoundSection(engagement) : ''}</div>
        <div id="round-workspace-holder"></div>
      </div>
      <div class="swipe-panel" id="swipe-panel-dashboard">
        <div class="card-title" style="margin-top:0;">Dashboard</div>
        <div id="dashboard-holder"></div>
      </div>
      <div class="swipe-panel" id="swipe-panel-reports">
        <div class="card-title" style="margin-top:0;">Reports</div>
        <div style="font-size:11px; color:var(--grey); margin:-4px 0 8px;">Tap a report to see what it includes, or tap Export to download it right away.</div>
        ${Components.reportButtonsHTML()}
        <div id="final-snapshot-holder"></div>
      </div>
    </div>

    <div class="history-header" data-action="toggle-engagement-danger-zone" role="button" tabindex="0" aria-expanded="${engagementDangerZoneOpen}" style="margin-top:18px;">
      <span style="font-size:11px; font-weight:700; color:var(--grey);">⚠️ Advanced — close or delete this engagement</span>
      <span class="arrow-toggle" style="transform:rotate(${engagementDangerZoneOpen ? '90deg' : '0deg'});">›</span>
    </div>
    ${engagementDangerZoneOpen ? `
      <div style="border:1.5px solid var(--red-bg); border-radius:12px; padding:10px; margin-top:8px; background:var(--red-bg);">
        <div style="font-size:11px; color:var(--red-ink); margin-bottom:10px;">These actions are rare, hard to reverse, and separate from day-to-day workflow on purpose.</div>
        <button class="btn btn-danger" style="width:100%; font-size:11px; padding:8px; margin-bottom:8px;" data-action="team-close-engagement" data-engagement-id="${engagement.id}">Close Permanently</button>
        <button class="btn btn-danger" style="width:100%; font-size:11px; padding:8px; background:#7a1212;" data-action="team-delete-engagement" data-engagement-id="${engagement.id}">🗑️ Delete Engagement Forever</button>
      </div>
    ` : ''}
  `;
}

// Scrolls the swipe track to the requested panel and syncs the pill
// row's active state. Called both from the pill tap handler and from
// the scroll-sync listener in event-delegation.js (so a manual swipe
// keeps the pills honest too).
function setEngagementSwipeTab(key, { scroll = true } = {}) {
  engagementSwipeTab = key;
  const track = $('engagement-swipe-track');
  const panel = $('swipe-panel-' + key);
  if (scroll && track && panel) track.scrollTo({ left: panel.offsetLeft, behavior: 'smooth' });
  document.querySelectorAll('.section-sub-tab[data-swipe]')
    .forEach(btn => btn.classList.toggle('active', btn.dataset.swipe === key));
}

// Called on scroll of #engagement-swipe-track (delegated once in
// event-delegation.js) to keep the pill row in sync during a manual swipe.
export function syncEngagementSwipeFromScroll(track) {
  const panels = ['rounds', 'dashboard', 'reports'];
  const idx = Math.round(track.scrollLeft / track.clientWidth);
  const key = panels[Math.max(0, Math.min(panels.length - 1, idx))];
  if (key !== engagementSwipeTab) setEngagementSwipeTab(key, { scroll: false });
}

function refreshSubRoundSection() {
  const holder = $('subround-section-holder');
  if (!holder) return;
  const { engagements, currentEngagementId } = Store.getState();
  const engagement = engagements.find(e => e.id === currentEngagementId);
  if (!engagement) return;
  holder.innerHTML = renderSubRoundSection(engagement);
  if (showSubRoundPicker) renderSubRoundCompanyPicker(engagement);
}

async function refreshRoundList() {
  const holder = $('round-list-holder');
  if (!holder) return;
  const { rounds, engagements, currentEngagementId } = Store.getState();
  const sorted = rounds.slice().sort((a, b) => a.roundNumber - b.roundNumber);
  holder.innerHTML = '';
  if (sorted.length === 0) { holder.appendChild(Components.noRoundsEmptyState()); return; }
  const latest = sorted[sorted.length - 1];

  // Individual Assignments pool: each round is one auditor's self-pick,
  // so enrich every round card with who picked it, which company(ies),
  // and their top companies by counted value — see
  // IndividualActions.summarizeIndividualRounds.
  const engagement = engagements.find(e => e.id === currentEngagementId);
  let individualSummary = null;
  if (engagement && engagement.scope && engagement.scope.type === 'individual') {
    // Uses the same read-only loader as the grouped-by-staff view
    // (Actions.loadIndividualDashboardData) rather than
    // loadAssignmentsForRound, since that one overwrites Store's
    // shared `assignments` (used by the currently-open round's
    // workspace) as a side effect — this is a display-only summary.
    const { assignments } = await Actions.loadIndividualDashboardData(engagement);
    individualSummary = Actions.summarizeIndividualRounds(sorted, assignments);
  }

  sorted.forEach(r => holder.appendChild(Components.roundCard(r, r.id === latest.id, individualSummary ? individualSummary.get(r.id) : null)));
  refreshDashboard();
}
Bus.on('rounds:changed', () => { if (currentSubView === 'detail') refreshRoundList(); });
// If the round just deleted was the one open in the workspace below the
// list, close that workspace out rather than leaving it pointing at a
// round that no longer exists (renderRoundWorkspace already no-ops
// gracefully, but explicitly clearing openRoundId also stops its
// progress-poll timer and the now-stale subround section).
Bus.on('round:deleted', ({ roundId }) => {
  if (openRoundId === roundId) { openRoundId = null; _stopProgressPoll(); renderRoundWorkspace(); }
  if (currentSubView === 'detail') refreshSubRoundSection();
});

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
  if (['draft', 'locked', 'counting', 'compiled'].includes(round.state)) refreshAssignmentCards();
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
      <div style="display:flex; justify-content:space-between; align-items:center;">
        <div class="card-title" style="margin-bottom:0;">Assignments</div>
        <label style="display:flex; align-items:center; gap:5px; font-size:11px; font-weight:700; color:var(--grey); cursor:pointer;">
          <input type="checkbox" class="custom-checkbox" data-action="toggle-assignment-grouping" ${assignmentGroupByCompany ? 'checked' : ''}> Group by company
        </label>
      </div>
      <div id="assignment-cards-holder"></div>
      <button class="btn" style="width:100%; margin:10px 0; background:var(--green-ink); color:white; padding:12px; font-weight:700;" data-action="team-lock-round" data-round-id="${round.id}">🔒 Lock Round</button>
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
    <button class="btn" style="width:100%; margin:10px 0; background:var(--green-ink); color:white; padding:12px; font-weight:700;" data-action="team-lock-round" data-round-id="${round.id}">🔒 Lock Round</button>
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
  roundAssignments.forEach(a => holder.appendChild(Components.assignmentCard(a, roundAssignments, round?.state, assignmentGroupByCompany)));
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
let varianceSortMode = 'impact'; // 'impact' | 'alpha' — cycled via toggle-variance-sort
let varianceFilterMin = null;  // absolute rupee impact, inclusive
let varianceFilterMax = null;

function _varianceImpact(row) { return (row.countedQty - row.systemQty) * (row.price || 0); }

function _visibleVariances(variances) {
  let list = variances;
  if (varianceFilterMin !== null) list = list.filter(row => Math.abs(_varianceImpact(row)) >= varianceFilterMin);
  if (varianceFilterMax !== null) list = list.filter(row => Math.abs(_varianceImpact(row)) <= varianceFilterMax);
  list = list.slice().sort((a, b) => {
    if (varianceSortMode === 'alpha') return (a.name || '').localeCompare(b.name || '');
    const diff = Math.abs(_varianceImpact(b)) - Math.abs(_varianceImpact(a));
    return varianceSortDesc ? diff : -diff;
  });
  return list;
}

function _varianceSortLabel() {
  if (varianceSortMode === 'alpha') return '🔤 A → Z (product name)';
  return varianceSortDesc ? '↕️ Impact ↓ (biggest first)' : '↕️ Impact ↑ (smallest first)';
}

function resetVarianceControls() {
  varianceSortDesc = true;
  varianceSortMode = 'impact';
  varianceFilterMin = null;
  varianceFilterMax = null;
}

// ── §Reporting — shared meta + printable/previewable reports ──
function _reportMeta() {
  const { engagements, currentEngagementId, currentAuditorName } = Store.getState();
  const eng = engagements.find(e => e.id === currentEngagementId);
  return {
    engagementName: eng ? eng.name : '',
    mainAuditorName: currentAuditorName || '',
    branchName: Actions.getBranchName ? Actions.getBranchName() : '',
  };
}

// ── Generic pdf-* building blocks (see app.css for the pdf-* classes) —
//    every report's branded body is assembled from these three, so the
//    Overview popup and the printed page are always pixel-identical. ──
function _pdfHeader({ branchName, title, subtitle, rightLines }) {
  const esc = Components.esc;
  return `
    <div class="pdf-meta-box">
      <div>
        <div class="pdf-brand-title">${esc(branchName || 'Pharmacy Audit')}</div>
        <div style="font-size:13px; font-weight:700; color:#475569; margin-top:2px;">${esc(title)}</div>
        ${subtitle ? `<div style="font-size:12px; color:#64748B; margin-top:1px;">${esc(subtitle)}</div>` : ''}
      </div>
      <div style="text-align:right; font-size:12px; color:#475569; line-height:1.6;">
        ${rightLines.map(l => `<div>${l}</div>`).join('')}
      </div>
    </div>`;
}

function _pdfStatGrid(stats) {
  return `<div class="pdf-summary-grid">${stats.map(s => `
      <div class="pdf-stat-card" style="border-top:4px solid ${s.color};${s.span ? ' grid-column: span ' + s.span + ';' : ''}">
        <div class="pdf-stat-val">${s.val}</div><div class="pdf-stat-lbl">${s.label}</div>
      </div>`).join('')}</div>`;
}

function _pdfTable(headers, rows) {
  return `<table class="pdf-table">
      <thead><tr>${headers.map(h => `<th>${h}</th>`).join('')}</tr></thead>
      <tbody>${rows.length ? rows.map(r => `<tr>${r.map(c => `<td>${c}</td>`).join('')}</tr>`).join('') : `<tr><td colspan="${headers.length}" style="text-align:center; color:#94A3B8; padding:16px;">No data</td></tr>`}</tbody>
    </table>`;
}

// Same three-band severity used in the live variance table
// (see compile-components.js) applied here as a colored, bolded cell
// so the printed/exported Variance Report also lets a reader triage
// by rupee impact at a glance instead of reading every row's number.
function _severityStyledAmount(valueVariance) {
  const abs = Math.abs(valueVariance);
  const color = abs >= 5000 ? '#DC2626' : (abs >= 500 ? '#B45309' : '#64748B');
  const text = 'Rs ' + valueVariance.toLocaleString();
  return `<span style="color:${color}; font-weight:800;">${text}</span>`;
}

// Same #printable-report-canvas / @media-print trick used by the
// Inventory Snapshot Report (see inventory-pages.js) and the legacy
// audit-history PDFs — reuses the app's one print stylesheet instead
// of introducing a second PDF pipeline.
let _originalReportCanvasHTML = null;
function _printHTMLToCanvas(html) {
  const canvas = $('printable-report-canvas');
  if (_originalReportCanvasHTML === null) _originalReportCanvasHTML = canvas.innerHTML;
  canvas.innerHTML = html;
  window.print();
  setTimeout(() => { canvas.innerHTML = _originalReportCanvasHTML; }, 500);
}

// ── Variance Report body (used by both the round-workspace Print PDF
//    button and the Reports-tab Overview popup) ──
function _varianceReportBodyHTML(round, compiled, meta) {
  const esc = Components.esc;
  const varianceRows = Actions.buildVarianceReportRows(compiled);
  const roundLabel = 'Round ' + round.roundNumber + (round.roundSuffix || '');
  const totalQtyVar = varianceRows.reduce((s, r) => s + r.variance, 0);
  const totalValueVar = varianceRows.reduce((s, r) => s + r.valueVariance, 0);

  const header = _pdfHeader({
    branchName: meta.branchName, title: 'Variance Report — ' + roundLabel, subtitle: meta.engagementName,
    rightLines: [
      `<strong>Generated:</strong> ${esc(new Date().toLocaleString('en-PK'))}`,
      `<strong>Main Auditor:</strong> ${esc(meta.mainAuditorName || '—')}`,
      `<strong>Items:</strong> ${varianceRows.length.toLocaleString()}`,
    ],
  });
  const stats = _pdfStatGrid([
    { val: varianceRows.length.toLocaleString(), label: 'Variances', color: '#1B3A6B' },
    { val: (totalQtyVar > 0 ? '+' : '') + totalQtyVar.toLocaleString(), label: 'Net Qty Variance', color: '#D97706' },
    { val: 'Rs ' + totalValueVar.toLocaleString(), label: 'Net Value Variance', color: '#DC2626', span: 2 },
  ]);
  const table = _pdfTable(
    ['Product Code', 'Product Name', 'Unit Price', 'System Qty', 'Physical Qty', 'Variance', 'Variance Amount', 'Sub Auditor'],
    varianceRows.map(r => [
      esc(r.code || '—'), esc(r.name), 'Rs ' + Number(r.price || 0).toLocaleString(),
      r.systemQty, r.countedQty, (r.variance > 0 ? '+' : '') + r.variance,
      _severityStyledAmount(r.valueVariance), esc(r.auditorName || ''),
    ]));
  const footer = `<div style="margin-top:14px; font-size:10px; color:#64748B;">Sorted alphabetically by product name · Sign-off: Main Auditor — ${esc(meta.mainAuditorName || '_______________')}</div>`;
  return header + stats + table + footer;
}

function printVarianceReportPDF(round, compiled, meta) {
  if (compiled.variances.length === 0) { Bus.emit('toast', { msg: 'No variances to report for this round', kind: 'error' }); return; }
  _printHTMLToCanvas(_varianceReportBodyHTML(round, compiled, meta));
}

// ── Combined Variance Report body (all compiled rounds, one sheet) ──
function _combinedVarianceReportBodyHTML(roundsWithCompiled, meta) {
  const esc = Components.esc;
  const combinedRows = Actions.buildCombinedVarianceReportRows(roundsWithCompiled);
  const totalQtyVar = combinedRows.reduce((s, r) => s + r.variance, 0);
  const totalValueVar = combinedRows.reduce((s, r) => s + r.valueVariance, 0);
  const duplicateCount = new Set(combinedRows.filter(r => r.isDuplicate).map(r => r.dupKey)).size;

  const header = _pdfHeader({
    branchName: meta.branchName, title: 'Combined Variance Report — All Rounds', subtitle: meta.engagementName,
    rightLines: [
      `<strong>Generated:</strong> ${esc(new Date().toLocaleString('en-PK'))}`,
      `<strong>Main Auditor:</strong> ${esc(meta.mainAuditorName || '—')}`,
      `<strong>Rounds Included:</strong> ${roundsWithCompiled.length}`,
    ],
  });
  const stats = _pdfStatGrid([
    { val: combinedRows.length.toLocaleString(), label: 'Variance Lines', color: '#1B3A6B' },
    { val: duplicateCount.toLocaleString(), label: 'Duplicate Products', color: '#D97706' },
    { val: 'Rs ' + totalValueVar.toLocaleString(), label: 'Net Value Variance', color: '#DC2626', span: 2 },
  ]);
  const table = _pdfTable(
    ['Product Code', 'Product Name', 'Company', 'Unit Price', 'System Qty', 'Physical Qty', 'Variance', 'Variance Amount', 'Round', 'Duplicate'],
    combinedRows.map(r => [
      esc(r.code || '—'), esc(r.name), esc(r.company), 'Rs ' + Number(r.price || 0).toLocaleString(),
      r.systemQty, r.countedQty, (r.variance > 0 ? '+' : '') + r.variance,
      _severityStyledAmount(r.valueVariance), esc(r.roundAndAuditor), r.isDuplicate ? '⚠️ Yes' : '',
    ]));
  const footer = `<div style="margin-top:14px; font-size:10px; color:#64748B;">Grouped by product (recounted items adjacent) · Sign-off: Main Auditor — ${esc(meta.mainAuditorName || '_______________')}</div>`;
  return header + stats + table + footer;
}

// ── Final Audit Report body — capped inventory preview (a Final
//    Snapshot can carry thousands of SKUs; the popup/print stay
//    responsive, the full list is always still in the xlsx). ──
const _FINAL_AUDIT_PREVIEW_CAP = 500;
function _finalAuditReportBodyHTML(snap, meta) {
  const esc = Components.esc;
  const header = _pdfHeader({
    branchName: meta.branchName, title: 'Final Audit Report', subtitle: meta.engagementName,
    rightLines: [
      `<strong>Generated:</strong> ${esc(new Date(snap.generatedAt).toLocaleString('en-PK'))}`,
      `<strong>Main Auditor:</strong> ${esc(meta.mainAuditorName || '—')}`,
      `<strong>Items:</strong> ${snap.report.totalItems.toLocaleString()}`,
    ],
  });
  const stats = _pdfStatGrid([
    { val: snap.report.totalCompanies, label: 'Companies', color: '#1B3A6B' },
    { val: snap.report.totalItems.toLocaleString(), label: 'Items In Scope', color: '#059669' },
    { val: 'Rs ' + Number(snap.report.totalVarianceValue).toLocaleString(), label: 'Net Variance Value', color: '#D97706', span: 2 },
  ]);
  const roundsTable = _pdfTable(['Round #', 'State', 'Items', 'Variances', 'Compiled At'], snap.report.roundsSummary.map(r => [
    esc(String(r.roundNumber + (r.roundSuffix || ''))), esc(r.state), r.itemCount, r.varianceCount,
    r.compiledAt ? esc(new Date(r.compiledAt).toLocaleString('en-PK')) : '—',
  ]));
  const previewRows = snap.finalInventory.slice(0, _FINAL_AUDIT_PREVIEW_CAP);
  const invTable = _pdfTable(['Company', 'Code', 'Name', 'Book Qty', 'Final Qty', 'Variance', 'Price', 'Variance Value'], previewRows.map(p => {
    const variance = p.qty - (p.systemQty !== undefined ? p.systemQty : p.qty);
    return [
      esc(p.company), esc(p.code || ''), esc(p.name), p.systemQty !== undefined ? p.systemQty : p.qty, p.qty,
      (variance > 0 ? '+' : '') + variance, 'Rs ' + Number(p.price || 0).toLocaleString(),
      'Rs ' + Number((variance * p.price).toFixed(2)).toLocaleString(),
    ];
  }));
  const cappedNote = snap.finalInventory.length > _FINAL_AUDIT_PREVIEW_CAP
    ? `<div style="font-size:10px; color:#64748B; margin:4px 0 10px;">Showing first ${_FINAL_AUDIT_PREVIEW_CAP.toLocaleString()} of ${snap.finalInventory.length.toLocaleString()} SKUs — the full list is included in the exported Excel file.</div>` : '';
  return header + stats
    + `<div style="font-weight:700; color:#1B3A6B; margin:14px 0 6px; font-size:12px;">Round Summary</div>` + roundsTable
    + `<div style="font-weight:700; color:#1B3A6B; margin:14px 0 6px; font-size:12px;">Final Inventory (${snap.finalInventory.length.toLocaleString()} SKUs)</div>` + cappedNote + invTable;
}

// ── Round History body ──
function _roundHistoryBodyHTML(rounds, meta) {
  const esc = Components.esc;
  const header = _pdfHeader({
    branchName: meta.branchName, title: 'Round History', subtitle: meta.engagementName,
    rightLines: [
      `<strong>Generated:</strong> ${esc(new Date().toLocaleString('en-PK'))}`,
      `<strong>Main Auditor:</strong> ${esc(meta.mainAuditorName || '—')}`,
      `<strong>Rounds:</strong> ${rounds.length}`,
    ],
  });
  const table = _pdfTable(['Round #', 'Unit', 'State', 'Created', 'Locked', 'Compiled', 'Finalized'], rounds.map(r => [
    esc(String(r.roundNumber + (r.roundSuffix || ''))), esc(r.unit), esc(r.state),
    esc(new Date(r.createdAt).toLocaleString('en-PK')),
    r.lockedAt ? esc(new Date(r.lockedAt).toLocaleString('en-PK')) : '—',
    r.compiledAt ? esc(new Date(r.compiledAt).toLocaleString('en-PK')) : '—',
    r.finalizedAt ? esc(new Date(r.finalizedAt).toLocaleString('en-PK')) : '—',
  ]));
  return header + table;
}

// ── Submission History body ──
function _submissionHistoryBodyHTML(submissions, assignments, meta) {
  const esc = Components.esc;
  const header = _pdfHeader({
    branchName: meta.branchName, title: 'Submission History', subtitle: meta.engagementName,
    rightLines: [
      `<strong>Generated:</strong> ${esc(new Date().toLocaleString('en-PK'))}`,
      `<strong>Main Auditor:</strong> ${esc(meta.mainAuditorName || '—')}`,
      `<strong>Submissions:</strong> ${submissions.length}`,
    ],
  });
  const table = _pdfTable(['Auditor', 'Assignment', 'Companies', 'Item Count', 'Submitted At', 'Time Taken', 'Force Submitted By'], submissions.map(s => {
    const a = assignments.find(x => x.id === s.assignmentId);
    const timeTaken = (a && a.startedAt) ? Actions.formatDuration((new Date(s.submittedAt) - new Date(a.startedAt)) / 1000) : '—';
    return [
      esc(s.auditorName), esc(s.assignmentId), esc(a ? a.companies.join(', ') : ''),
      Object.keys(s.counts || {}).length, esc(new Date(s.submittedAt).toLocaleString('en-PK')),
      esc(timeTaken), esc(s.forceSubmittedBy || '—'),
    ];
  }));
  return header + table;
}

// ── Audit Trail body ──
function _auditTrailBodyHTML(auditLog, meta) {
  const esc = Components.esc;
  const header = _pdfHeader({
    branchName: meta.branchName, title: 'Audit Trail', subtitle: meta.engagementName,
    rightLines: [
      `<strong>Generated:</strong> ${esc(new Date().toLocaleString('en-PK'))}`,
      `<strong>Main Auditor:</strong> ${esc(meta.mainAuditorName || '—')}`,
      `<strong>Entries:</strong> ${auditLog.length}`,
    ],
  });
  const table = _pdfTable(['Timestamp', 'Actor', 'Role', 'Action', 'Details'], auditLog.map(e => [
    esc(new Date(e.ts).toLocaleString('en-PK')), esc(e.actor), esc(e.role), esc(e.action), esc(JSON.stringify(e.details)),
  ]));
  return header + table;
}

// ── Reports tab Overview popup — one dispatcher per report `key`,
//    each returning { title, bodyHTML, exportFn } or null when there's
//    nothing to preview yet (e.g. Final Audit before the engagement is
//    locked to Final, or Variance before any round is compiled). ──
let reportOverviewKey = null;
function _buildReportOverview(key) {
  const meta = _reportMeta();
  const { finalSnapshots, rounds, compiledRounds, engagements, submissions, assignments, auditLog, currentEngagementId } = Store.getState();
  const eng = engagements.find(e => e.id === currentEngagementId);
  if (!eng) return null;

  if (key === 'final-audit') {
    const snap = finalSnapshots.filter(s => s.engagementId === currentEngagementId).pop();
    if (!snap) return { title: 'Final Audit Report', empty: 'Generate the Final Snapshot first — see the Difference Engine screen for the current round.' };
    return { title: 'Final Audit Report', bodyHTML: _finalAuditReportBodyHTML(snap, meta), exportFn: () => Actions.exportFinalAuditReportXLSX(snap, eng.name) };
  }
  if (key === 'variance') {
    const engRounds = rounds.filter(r => r.engagementId === currentEngagementId).sort((a, b) => a.roundNumber - b.roundNumber);
    const latestRound = engRounds[engRounds.length - 1];
    const compiled = latestRound ? compiledRounds.filter(c => c.roundId === latestRound.id).pop() : null;
    if (!compiled) return { title: 'Variance Report', empty: 'Compile a round first — there\'s nothing to report on yet.' };
    const roundLabel = 'Round ' + latestRound.roundNumber + (latestRound.roundSuffix || '');
    return { title: 'Variance Report — ' + roundLabel, bodyHTML: _varianceReportBodyHTML(latestRound, compiled, meta), exportFn: () => Actions.exportVarianceReportXLSX(compiled, roundLabel, meta) };
  }
  if (key === 'combined-variance') {
    const engRounds = rounds.filter(r => r.engagementId === currentEngagementId).sort((a, b) => a.roundNumber - b.roundNumber);
    // One compiled row per round (latest compile of each, same "pop()"
    // convention as the single-round Variance Report above), skipping
    // any round that hasn't been compiled yet.
    const roundsWithCompiled = engRounds
      .map(round => ({ round, compiled: compiledRounds.filter(c => c.roundId === round.id).pop() }))
      .filter(rc => rc.compiled);
    if (roundsWithCompiled.length === 0) return { title: 'Combined Variance Report', empty: 'Compile at least one round first — there\'s nothing to report on yet.' };
    return {
      title: 'Combined Variance Report — All Rounds',
      bodyHTML: _combinedVarianceReportBodyHTML(roundsWithCompiled, meta),
      exportFn: () => Actions.exportCombinedVarianceReportXLSX(roundsWithCompiled, meta),
    };
  }
  if (key === 'round-history') {
    const engRounds = rounds.filter(r => r.engagementId === currentEngagementId).sort((a, b) => a.roundNumber - b.roundNumber);
    if (engRounds.length === 0) return { title: 'Round History', empty: 'No rounds yet for this engagement.' };
    return { title: 'Round History', bodyHTML: _roundHistoryBodyHTML(engRounds, meta), exportFn: () => Actions.exportRoundHistoryXLSX(eng, engRounds) };
  }
  if (key === 'submission-history') {
    if (submissions.length === 0) return { title: 'Submission History', empty: 'No submissions yet for this engagement.' };
    return { title: 'Submission History', bodyHTML: _submissionHistoryBodyHTML(submissions, assignments, meta), exportFn: () => Actions.exportSubmissionHistoryXLSX(eng, submissions, assignments) };
  }
  if (key === 'audit-trail') {
    if (auditLog.length === 0) return { title: 'Audit Trail', empty: 'Nothing logged yet for this engagement.' };
    return { title: 'Audit Trail', bodyHTML: _auditTrailBodyHTML(auditLog, meta), exportFn: () => Actions.exportAuditTrailXLSX(eng, auditLog) };
  }
  return null;
}

function renderReportOverview() {
  const content = $('report-overview-content');
  if (!content || !reportOverviewKey) return;
  const built = _buildReportOverview(reportOverviewKey);
  if (!built) { content.innerHTML = Components.reportOverviewEmptyHTML('Report', 'Open an engagement first.'); return; }
  content.innerHTML = built.empty
    ? Components.reportOverviewEmptyHTML(built.title, built.empty)
    : Components.reportOverviewShellHTML(built.title, built.bodyHTML);
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

  // The Difference Engine has to generate the next round from EVERY
  // compiled sub-round in this family combined (Round 1 + 1A + 1B...),
  // not just whichever one happens to be open on screen — otherwise
  // generating Round 2 from Round 1A would silently drop Round 1's own
  // variances. The variance table above still shows just this round's
  // own results (useful on its own), but the counts/buttons below are
  // family-wide once every sub-round is compiled.
  const family = Actions.familyRounds(rounds, round.roundNumber);
  const familyRoundIds = family.map(r => r.id);
  const familyMerged = familyReady ? Actions.mergeFamilyCompiled(familyRoundIds, compiledRounds) : { variances: compiled.variances, mergedItems: compiled.mergedItems, memberCount: 1 };
  const familyNote = family.length > 1
    ? `<div style="font-size:11px; color:var(--grey); margin-bottom:8px;">Combining ${familyMerged.memberCount} compiled sub-round(s) in Round ${Actions.familyLabel(rounds, round.roundNumber)} — company-wise, deduplicated.</div>`
    : '';

  return `
    ${Components.compileSummaryCardHTML(compiled)}
    <div class="card-title">Assignments — Reopen, Reassign, or Revoke</div>
    <div id="assignment-cards-holder"></div>
    <div class="card" style="margin-bottom:10px;">
      <div style="font-size:11px; color:var(--grey); margin-bottom:8px;">Reopened or reassigned someone above and they've resubmitted? Recompile to pull their new counts into the variance report below — nothing recalculates on its own.</div>
      <button class="btn btn-primary btn-block" data-action="team-compile-round" data-round-id="${round.id}">🔄 Recompile Round</button>
    </div>
    <div class="card" style="display:flex; gap:6px; align-items:center; flex-wrap:wrap; margin-bottom:10px;">
      <button class="sort-btn" data-action="toggle-variance-sort">${_varianceSortLabel()}</button>
      <input type="number" id="variance-filter-min" class="search-input" placeholder="Min impact (Rs)" aria-label="Minimum variance impact in Rupees" style="flex:1; min-width:100px;" value="${varianceFilterMin ?? ''}">
      <input type="number" id="variance-filter-max" class="search-input" placeholder="Max impact (Rs)" aria-label="Maximum variance impact in Rupees" style="flex:1; min-width:100px;" value="${varianceFilterMax ?? ''}">
      <button class="btn btn-primary" style="font-size:11px; padding:10px;" data-action="apply-variance-filter">Apply</button>
      ${filtered ? '<button class="sort-btn" data-action="clear-variance-filter">Clear filter</button>' : ''}
      ${filtered ? `<div style="width:100%; font-size:10px; color:var(--grey);">Showing ${visible.length} of ${compiled.variances.length} variance(s)</div>` : ''}
    </div>
    <div class="card" style="display:flex; gap:8px; align-items:center; flex-wrap:wrap; margin-bottom:10px;">
      <div style="font-size:11px; font-weight:700; color:var(--navy);">Variance Report — Round ${round.roundNumber}${round.roundSuffix || ''}</div>
      <div style="flex:1;"></div>
      <button class="btn btn-primary" style="font-size:11px; padding:8px 12px;" data-action="print-variance-report-round" data-round-id="${round.id}">🖨️ Print PDF</button>
      <button class="btn" style="font-size:11px; padding:8px 12px; background:var(--green-ink); color:white;" data-action="export-variance-report-round" data-round-id="${round.id}">📊 Export xlsx</button>
    </div>
    <div style="background:white; border-radius:var(--radius); box-shadow:var(--shadow); overflow:hidden; margin-bottom:14px;">
      <table class="audit-table">
        <thead><tr><th style="padding-left:10px;">Item</th><th style="text-align:right;">Sys</th><th style="text-align:right;">Counted</th><th style="text-align:right; padding-right:10px;">Var</th></tr></thead>
        <tbody>${varianceRows}</tbody>
      </table>
    </div>
    <div class="card-title">Difference Engine — send the next round out</div>
    <div class="card">
      ${familyNote}
      <label style="display:flex; align-items:center; gap:8px; margin-bottom:8px; cursor:pointer;">
        <input type="radio" name="diff-mode" value="differences" checked> Differences Only (${familyMerged.variances.length} lines)
      </label>
      <label style="display:flex; align-items:center; gap:8px; margin-bottom:8px; cursor:pointer;">
        <input type="radio" name="diff-mode" value="full"> Full Company Recount
      </label>
      <label style="display:flex; align-items:center; gap:8px; margin-bottom:10px; cursor:pointer;">
        <input type="radio" name="diff-mode" value="spotcheck"> Random Spot-Check (10 items)
      </label>
      <div style="font-size:11px; color:var(--grey); margin-bottom:10px;">After generating, you'll pick staff and preview the split before it's assigned — same as Round 1.</div>
      ${!familyReady ? `<div style="font-size:11px; color:var(--red); margin-bottom:8px;">⚠️ Compile every Round ${Actions.familyLabel(rounds, round.roundNumber)} sub-round (including any lettered ones) before starting the next round.</div>` : ''}
      <button class="btn btn-gold btn-block" data-action="team-generate-diff-round" data-round-number="${round.roundNumber}" data-source-round-id="${compiled.roundId}" ${!familyReady ? 'disabled' : ''}>Generate Next Round</button>
    </div>
    <button class="btn btn-block" style="background:var(--green-ink); color:white; padding:12px; font-weight:700;" data-action="team-finalize-engagement">✅ Generate Final Snapshot (stop here)</button>
  `;
}

// ── §Dashboard ──
let _liveSnapshotAssignmentCache = null;
async function _refreshLiveSnapshotContent(opts) {
  const content = $('live-snapshot-content');
  if (!content || !liveSnapshotAssignmentId) return;
  const assignment = (opts && opts.skipFetch && _liveSnapshotAssignmentCache && _liveSnapshotAssignmentCache.id === liveSnapshotAssignmentId)
    ? _liveSnapshotAssignmentCache
    : await Actions.fetchLiveAssignmentSnapshot(liveSnapshotAssignmentId);
  _liveSnapshotAssignmentCache = assignment;
  const rows = assignment
    ? Actions.sortLiveSnapshotRows(Actions.filterLiveSnapshotRows(Actions.buildLiveSnapshotRows(assignment), liveSnapshotFilterMode), liveSnapshotSortMode)
    : [];
  content.innerHTML = Components.liveSnapshotModalHTML(assignment, rows, liveSnapshotFilterMode, liveSnapshotSortMode);
}

function refreshDashboard() {
  const holder = $('dashboard-holder');
  if (!holder) return;
  const { currentEngagementId } = Store.getState();
  const dash = Actions.mainAuditorDashboard(currentEngagementId, openRoundId);
  holder.innerHTML = Components.mainDashboardHTML(dash, dashboardOpenSections);
}

// ── §Reporting ──
Bus.on('snapshot:generated', (snapshot) => {
  const holder = $('final-snapshot-holder');
  if (holder) holder.innerHTML = Components.finalSnapshotCardHTML(snapshot);
});

// Lets other page modules (Inventory tab's "Add to Existing Engagement")
// jump straight into this engagement's detail view, same as tapping its
// card would — rather than only opening it in Store and leaving
// currentSubView on 'list'.
export async function openEngagementDetailView(engagementId) {
  await Actions.openEngagement(engagementId);
  currentSubView = 'detail'; openRoundId = null;
}

/* ── Handler maps, consumed by pages/event-delegation.js ── */
export function initEngagementPages() {
  const clickHandlers = {
    'open-engagement': async (el) => {
      await Actions.openEngagement(el.dataset.engagementId);
      currentSubView = 'detail'; openRoundId = null; engagementSwipeTab = 'rounds';
      renderTeamTab();
    },
    'team-back-to-list': () => { Actions.closeEngagementView(); currentSubView = 'list'; openRoundId = null; dashboardOpenSections = new Set(); engagementSwipeTab = 'rounds'; engagementDangerZoneOpen = false; renderTeamTab(); },
    'toggle-engagement-danger-zone': () => { engagementDangerZoneOpen = !engagementDangerZoneOpen; renderTeamTab(); },
    'team-swipe-tab': (el) => setEngagementSwipeTab(el.dataset.swipe),
    'toggle-dashboard-section': (el) => {
      const key = el.dataset.section;
      dashboardOpenSections.has(key) ? dashboardOpenSections.delete(key) : dashboardOpenSections.add(key);
      refreshDashboard();
    },
    'toggle-assignment-grouping': () => { assignmentGroupByCompany = !assignmentGroupByCompany; refreshAssignmentCards(); },
    'team-view-my-work': () => Bus.emit('team:viewMyWork'),
    'create-engagement': async () => {
      const name = $('new-engagement-name').value;
      const type = $('new-engagement-scope-type').value;
      const companies = Array.from(scopeSelectedCompanies);
      const engagement = await Actions.createEngagement(name, { type, companies });
      if (engagement) { currentSubView = 'detail'; renderTeamTab(); }
    },
    'toggle-individual-staff': (el) => {
      const name = el.dataset.auditor;
      if (individualExpandedStaff.has(name)) individualExpandedStaff.delete(name);
      else individualExpandedStaff.add(name);
      renderIndividualDashboard();
    },
    'toggle-individual-round-select': (el) => {
      const id = el.dataset.roundId;
      if (individualSelectedRounds.has(id)) individualSelectedRounds.delete(id);
      else individualSelectedRounds.add(id);
      renderIndividualDashboard();
    },
    'confirm-recompile-individual': async () => {
      const nameInput = $('individual-recompile-name');
      const name = nameInput ? nameInput.value.trim() : '';
      if (!name) { Bus.emit('toast', { msg: 'Give the new template a name first', kind: 'error' }); return; }
      const template = await Actions.recompileIndividualRounds(Array.from(individualSelectedRounds), name);
      if (template) {
        individualSelectedRounds = new Set();
        renderIndividualDashboard();
      }
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
      liveSnapshotAssignmentId = el.dataset.assignmentId;
      liveSnapshotFilterMode = 'all';
      liveSnapshotSortMode = 'name-asc';
      content.innerHTML = '<div style="text-align:center; padding:30px 0; color:var(--grey); font-size:13px;">Loading…</div>';
      overlay.style.display = 'flex';
      await _refreshLiveSnapshotContent();
    },
    'refresh-live-snapshot': async () => {
      await _refreshLiveSnapshotContent();
      Bus.emit('toast', { msg: 'Refreshed', kind: 'success' });
    },
    'set-live-snapshot-filter': async (el) => {
      liveSnapshotFilterMode = el.dataset.mode;
      await _refreshLiveSnapshotContent({ skipFetch: true });
    },
    'cycle-live-snapshot-sort': async () => {
      const i = LIVE_SNAPSHOT_SORT_CYCLE.indexOf(liveSnapshotSortMode);
      liveSnapshotSortMode = LIVE_SNAPSHOT_SORT_CYCLE[(i + 1) % LIVE_SNAPSHOT_SORT_CYCLE.length];
      await _refreshLiveSnapshotContent({ skipFetch: true });
    },
    'close-live-snapshot': () => {
      const overlay = $('live-snapshot-overlay');
      if (overlay) overlay.style.display = 'none';
      liveSnapshotAssignmentId = null;
    },
    'open-force-submit': async (el) => {
      const overlay = $('force-submit-overlay');
      const content = $('force-submit-content');
      if (!overlay || !content) return;
      const assignment = await Actions.fetchLiveAssignmentSnapshot(el.dataset.assignmentId);
      content.innerHTML = Components.forceSubmitModalHTML(assignment);
      overlay.style.display = 'flex';
    },
    'close-force-submit': () => {
      const overlay = $('force-submit-overlay');
      if (overlay) overlay.style.display = 'none';
    },
    'confirm-force-submit': async (el) => {
      const { currentAuditorName, assignments } = Store.getState();
      const submission = await Actions.forceSubmitAssignment(el.dataset.assignmentId, el.dataset.mode, currentAuditorName);
      const overlay = $('force-submit-overlay');
      if (overlay) overlay.style.display = 'none';
      if (submission) {
        const assignment = assignments.find(a => a.id === el.dataset.assignmentId);
        await Actions.autoCompileIfIndividual(assignment);
        const liveOverlay = $('live-snapshot-overlay');
        if (liveOverlay) liveOverlay.style.display = 'none';
        liveSnapshotAssignmentId = null;
        refreshDashboard();
      }
    },
    'resolve-cross-round-conflict': async (el) => {
      const { currentAuditorName } = Store.getState();
      await Actions.resolveCrossRoundConflict(el.dataset.compiledRoundId, parseInt(el.dataset.conflictIndex, 10), el.dataset.side, currentAuditorName);
      refreshDashboard();
    },
    'toggle-subround-picker': () => {
      showSubRoundPicker = !showSubRoundPicker;
      subRoundSelectedCompanies = new Set();
      subRoundSearchToken = '';
      subRoundSortAscending = true;
      refreshSubRoundSection();
    },
    'toggle-subround-company': (el) => {
      const c = el.dataset.company;
      if (subRoundSelectedCompanies.has(c)) subRoundSelectedCompanies.delete(c);
      else subRoundSelectedCompanies.add(c);
      const countLabel = $('subround-selected-count');
      if (countLabel) countLabel.textContent = subRoundSelectedCompanies.size + ' compan' + (subRoundSelectedCompanies.size === 1 ? 'y' : 'ies') + ' selected';
    },
    'toggle-subround-sort': () => {
      subRoundSortAscending = !subRoundSortAscending;
      const { engagements, currentEngagementId } = Store.getState();
      const engagement = engagements.find(e => e.id === currentEngagementId);
      const lbl = $('subround-sort-label');
      if (lbl) lbl.textContent = subRoundSortAscending ? 'A-Z' : 'Z-A';
      if (engagement) renderSubRoundCompanyPicker(engagement);
    },
    'subround-select-all': () => {
      const { engagements, currentEngagementId, products } = Store.getState();
      const engagement = engagements.find(e => e.id === currentEngagementId);
      if (!engagement) return;
      const query = subRoundSearchToken.toLowerCase().trim();
      const companies = [...new Set(products.map(p => p.company))]
        .filter(c => !engagement.scope.companies.includes(c))
        .filter(c => !query || c.toLowerCase().includes(query));
      companies.forEach(c => subRoundSelectedCompanies.add(c));
      renderSubRoundCompanyPicker(engagement);
    },
    'subround-clear-all': () => {
      subRoundSelectedCompanies.clear();
      const { engagements, currentEngagementId } = Store.getState();
      const engagement = engagements.find(e => e.id === currentEngagementId);
      if (engagement) renderSubRoundCompanyPicker(engagement);
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
      subRoundSearchToken = '';
      subRoundSortAscending = true;
      if (round) { await openRound(round.id); } else { renderTeamTab(); }
    },
    'open-round': (el) => openRound(el.dataset.roundId),
    'delete-round': async (el) => { await Actions.deleteRound(el.dataset.roundId); },
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
    'toggle-variance-sort': () => {
      // Cycle: Impact ↓ (biggest first) → Impact ↑ (smallest first) → A-Z → back to Impact ↓
      if (varianceSortMode === 'impact' && varianceSortDesc) { varianceSortDesc = false; }
      else if (varianceSortMode === 'impact' && !varianceSortDesc) { varianceSortMode = 'alpha'; }
      else { varianceSortMode = 'impact'; varianceSortDesc = true; }
      renderRoundWorkspace();
    },
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
    'open-reassign': (el) => {
      const overlay = $('reassign-overlay');
      const content = $('reassign-content');
      if (!overlay || !content) return;
      const { assignments, staff, currentAuditorId, currentAuditorName } = Store.getState();
      const assignment = assignments.find(a => a.id === el.dataset.assignmentId);
      if (!assignment) return;
      const mainAuditor = currentAuditorId ? { id: currentAuditorId, name: currentAuditorName } : null;
      content.innerHTML = Components.reassignModalHTML(assignment, staff, mainAuditor);
      overlay.style.display = 'flex';
    },
    'close-reassign': () => {
      const overlay = $('reassign-overlay');
      if (overlay) overlay.style.display = 'none';
    },
    'confirm-reassign': async (el) => {
      await Actions.reassignAssignment(el.dataset.assignmentId, el.dataset.newAuditorId, el.dataset.newAuditorName);
      const overlay = $('reassign-overlay');
      if (overlay) overlay.style.display = 'none';
      renderRoundWorkspace();
    },
    'team-lock-round': async (el) => { await Actions.lockRound(el.dataset.roundId); renderRoundWorkspace(); },
    'team-compile-round': async (el) => { await Actions.compileRound(el.dataset.roundId); renderRoundWorkspace(); },
    'compile-with-missing': async () => { if (openRoundId) { await Actions.compileRoundWithMissingOverride(openRoundId); renderRoundWorkspace(); } },
    'team-generate-diff-round': async (el) => {
      const mode = (document.querySelector('input[name="diff-mode"]:checked') || {}).value || 'differences';
      const { compiledRounds, engagements, rounds, products } = Store.getState();
      const roundNumber = parseInt(el.dataset.roundNumber, 10);
      const sourceRound = rounds.find(r => r.id === el.dataset.sourceRoundId);
      if (!sourceRound) return;
      const engagement = engagements.find(e => e.id === sourceRound.engagementId);
      const family = Actions.familyRounds(rounds, roundNumber);
      const familyRoundIds = family.map(r => r.id);
      // Family-wide merge — see mergeFamilyCompiled in compile-actions.js —
      // so generating Round 2 from a family with sub-rounds (1, 1A, 1B...)
      // combines all of their compiled variances/items company-wise
      // instead of silently only using whichever one was open on screen.
      const familyCompiled = Actions.mergeFamilyCompiled(familyRoundIds, compiledRounds);
      const sourceRoundLabel = Actions.familyLabel(rounds, roundNumber);
      const items = Actions.buildItemsForMode(familyCompiled, mode, { companies: engagement.scope.companies, sampleSize: 10, sourceRoundNumber: sourceRoundLabel, liveProducts: products });
      if (items.length === 0) { Bus.emit('toast', { msg: 'Nothing to send — no variances found', kind: 'error' }); return; }
      const round = await Actions.createItemRound(sourceRound.id, items);
      if (!round) return;
      selectedStaffIds = [];
      Actions.logDifferenceRoundGenerated(round.id, mode, items.length);
      const newSkuCount = items.filter(it => it.isNewSinceLastRound).length;
      if (newSkuCount > 0) Bus.emit('toast', { msg: newSkuCount + ' newly-stocked item(s) since the last round were pulled into this recount too', kind: 'success' });
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
    'export-variance-report-round': (el) => {
      const { rounds, compiledRounds } = Store.getState();
      const round = rounds.find(r => r.id === el.dataset.roundId);
      const compiled = round ? compiledRounds.filter(c => c.roundId === round.id).pop() : null;
      if (round && compiled) Actions.exportVarianceReportXLSX(compiled, 'Round ' + round.roundNumber + (round.roundSuffix || ''), _reportMeta());
      else Bus.emit('toast', { msg: 'Compile the round first — there\'s nothing to report on yet', kind: 'error' });
    },
    'print-variance-report-round': (el) => {
      const { rounds, compiledRounds } = Store.getState();
      const round = rounds.find(r => r.id === el.dataset.roundId);
      const compiled = round ? compiledRounds.filter(c => c.roundId === round.id).pop() : null;
      if (round && compiled) printVarianceReportPDF(round, compiled, _reportMeta());
      else Bus.emit('toast', { msg: 'Compile the round first — there\'s nothing to report on yet', kind: 'error' });
    },
    // Reports tab — Overview popup replaces immediate download. Tapping
    // "Overview" opens a branded preview (identical markup to the printed
    // page); Print/Export live inside the popup itself.
    'open-report-overview': (el) => {
      reportOverviewKey = el.dataset.report;
      renderReportOverview();
      const overlay = $('report-overview-overlay');
      if (overlay) overlay.style.display = 'flex';
      // Auto-dismiss the "swipe sideways" hint the first time the
      // reader actually scrolls the table — it's only useful before
      // they've discovered the gesture, and left on-screen forever it's
      // just one more static banner competing for attention.
      const canvas = $('report-overview-canvas');
      const hint = document.querySelector('.pdf-table-scroll-hint');
      if (canvas && hint) {
        const dismiss = () => { hint.style.display = 'none'; canvas.removeEventListener('scroll', dismiss); };
        canvas.addEventListener('scroll', dismiss, { passive: true });
      }
    },
    'close-report-overview': () => {
      const overlay = $('report-overview-overlay');
      if (overlay) overlay.style.display = 'none';
      reportOverviewKey = null;
    },
    'print-report-overview': () => {
      if (!reportOverviewKey) return;
      const built = _buildReportOverview(reportOverviewKey);
      if (built && built.bodyHTML) _printHTMLToCanvas(built.bodyHTML);
    },
    'export-report-overview': () => {
      if (!reportOverviewKey) return;
      const built = _buildReportOverview(reportOverviewKey);
      if (built && built.exportFn) built.exportFn();
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
    'filter-subround-companies': (el) => {
      subRoundSearchToken = el.value;
      const { engagements, currentEngagementId } = Store.getState();
      const engagement = engagements.find(e => e.id === currentEngagementId);
      if (engagement) renderSubRoundCompanyPicker(engagement);
    },
  };

  return { clickHandlers, changeHandlers, inputHandlers, keydownHandlers: {} };
}
