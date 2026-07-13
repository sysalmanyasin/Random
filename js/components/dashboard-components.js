import { esc } from './dom-utils.js';
import { countingProgressBarHTML } from './counting-components.js';

/* ══════════════════════════════════════════════════════════════
   FLOOR 4 — COMPONENTS / dashboard-components.js
   Blueprint §Dashboard — pure render only.
   ══════════════════════════════════════════════════════════════ */

// Small local duplicate of dashboard-actions.js's formatDuration —
// Components (Floor 4) don't import from Actions (Floor 3), so this
// one-off formatter lives on both sides rather than crossing layers.
function _formatDuration(totalSeconds) {
  if (totalSeconds === null || totalSeconds === undefined || totalSeconds < 0) return '—';
  const s = Math.round(totalSeconds);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (h > 0) return h + 'h ' + String(m).padStart(2, '0') + 'm';
  if (m > 0) return m + 'm ' + String(sec).padStart(2, '0') + 's';
  return sec + 's';
}

// Sections default to collapsed — reuses the same .history-item /
// toggle-accordion pattern as Verify Stock History and the Reports list,
// so the Main Auditor lands on a short scannable summary instead of three
// always-expanded cards. `openSections` is a Set of section keys the page
// layer keeps around across re-renders so a section a user opened stays
// open through live progress updates instead of snapping shut.
export function mainDashboardHTML(dash, openSections) {
  if (!dash) return '<div class="card">No engagement selected.</div>';
  const isOpen = (key) => !!(openSections && openSections.has(key));

  const auditorRows = dash.auditorProgress.map(a => {
    const clickable = !a.submitted && a.status !== 'assigned';
    let durationLabel = '';
    if (a.startedAt) {
      if (a.submitted && a.submittedAt) {
        durationLabel = '⏱ Took ' + _formatDuration((new Date(a.submittedAt) - new Date(a.startedAt)) / 1000);
      } else if (a.status === 'counting') {
        durationLabel = '⏱ ' + _formatDuration((Date.now() - new Date(a.startedAt)) / 1000) + ' so far';
      }
    }
    return `
    <div class="movable-row" style="flex-direction:column; align-items:stretch; gap:4px;${clickable ? ' cursor:pointer;' : ''}"
      ${clickable ? `data-action="view-live-snapshot" data-assignment-id="${a.assignmentId}" role="button" tabindex="0" aria-label="View live counts for ${esc(a.auditorName)}"` : ''}>
      <div style="display:flex; justify-content:space-between;">
        <span>${esc(a.auditorName)} · ${a.itemCount} lines</span>
        <span class="val-badge ${a.submitted ? 'val-green' : 'val-grey'}">${a.submitted ? 'Submitted' : a.status}</span>
      </div>
      ${clickable ? `
      <div>${countingProgressBarHTML({ counted: a.counted, total: a.itemCount, pct: a.pct })}</div>
      <div style="font-size:10px; color:var(--grey); text-align:right;">Tap to peek at their live counts →</div>` : ''}
      ${durationLabel ? `<div style="font-size:10px; color:var(--grey);">${durationLabel}</div>` : ''}
    </div>`;
  }).join('') || '<div style="font-size:12px; color:var(--grey); padding:6px 0;">No assignments yet.</div>';

  const companyRows = dash.companyStatus.map(c => `
    <div class="movable-row">
      <span>${esc(c.company)}</span>
      <span style="font-size:11px; color:${c.assigned ? 'var(--green-ink)' : 'var(--grey)'};">${c.assigned ? esc(c.auditor) : 'Unassigned'}</span>
    </div>`).join('');

  const assignedCount = dash.companyStatus.filter(c => c.assigned).length;
  const submittedCount = dash.auditorProgress.filter(a => a.submitted).length;
  const compileSummary = typeof dash.compileStatus === 'string'
    ? esc(dash.compileStatus)
    : dash.compileStatus.variances + ' variance(s) as of ' + new Date(dash.compileStatus.compiledAt).toLocaleString('en-PK');
  const compileBadge = typeof dash.compileStatus === 'string' ? '' : `${dash.compileStatus.variances} variance(s)`;

  const section = (key, title, summary, bodyHTML) => `
    <div class="history-item${isOpen(key) ? ' open' : ''}">
      <div class="history-header" data-action="toggle-dashboard-section" data-section="${key}" role="button" tabindex="0" aria-expanded="${isOpen(key)}">
        <div style="display:flex; align-items:center; gap:8px; overflow:hidden;">
          <span class="arrow-toggle" aria-hidden="true">&#9658;</span>
          <strong style="color:var(--navy); font-size:12.5px;">${title}</strong>
        </div>
        <span style="font-size:11px; color:var(--grey); flex-shrink:0; margin-left:8px;">${summary}</span>
      </div>
      <div class="history-content">${bodyHTML}</div>
    </div>`;

  const auditorNotes = dash.auditorNotes || [];
  const notesByAuditor = new Map();
  auditorNotes.forEach(n => {
    if (!notesByAuditor.has(n.auditorName)) notesByAuditor.set(n.auditorName, []);
    notesByAuditor.get(n.auditorName).push(n);
  });
  const notesRows = [...notesByAuditor.entries()].map(([auditorName, notes]) => `
    <div style="margin-bottom:10px;">
      <div style="font-size:12px; font-weight:800; color:var(--navy); margin-bottom:4px;">${esc(auditorName)}</div>
      ${notes.map(n => `<div style="font-size:12px; color:var(--grey); white-space:pre-wrap; background:var(--light); border-radius:6px; padding:6px 8px; margin-bottom:4px;">${esc(n.note)}</div>`).join('')}
    </div>`).join('');

  const conflicts = dash.crossRoundConflicts || [];
  const conflictRows = conflicts.map((c, i) => {
    if (c.resolved) {
      return `
      <div class="movable-row" style="flex-direction:column; align-items:stretch;">
        <div style="font-size:12px; font-weight:700; color:var(--navy);">${esc(c.name)} <span style="color:var(--grey); font-weight:400;">(${esc(c.company)})</span></div>
        <div style="font-size:11px; color:var(--green-ink);">✓ Resolved — kept ${c.resolved.countedQty} (by ${esc(c.resolved.resolvedBy)})</div>
      </div>`;
    }
    return `
      <div class="movable-row" style="flex-direction:column; align-items:stretch; gap:4px;">
        <div style="font-size:12px; font-weight:700; color:var(--navy);">${esc(c.name)} <span style="color:var(--grey); font-weight:400;">(${esc(c.company)})</span></div>
        <div style="display:flex; gap:8px;">
          <button class="btn" style="flex:1; background:var(--light); color:var(--navy); font-size:11px;" data-action="resolve-cross-round-conflict" data-compiled-round-id="${esc(dash.compiledRoundId || '')}" data-conflict-index="${i}" data-side="a">
            Keep ${c.a.countedQty}<div style="font-size:10px; font-weight:400; color:var(--grey);">${esc(c.a.auditorName)}</div>
          </button>
          <button class="btn" style="flex:1; background:var(--light); color:var(--navy); font-size:11px;" data-action="resolve-cross-round-conflict" data-compiled-round-id="${esc(dash.compiledRoundId || '')}" data-conflict-index="${i}" data-side="b">
            Keep ${c.b.countedQty}<div style="font-size:10px; font-weight:400; color:var(--grey);">${esc(c.b.auditorName)}</div>
          </button>
        </div>
      </div>`;
  }).join('');
  const unresolvedConflicts = conflicts.filter(c => !c.resolved).length;

  return `
    <div class="card">
      <div class="card-title" style="margin:0 0 8px;">Engagement</div>
      <span class="val-badge val-navy">${esc(dash.engagementStatus)}</span>
      ${dash.roundStatus ? `<span class="val-badge val-gold" style="margin-left:6px;">Round ${dash.roundStatus.number}${esc(dash.roundStatus.suffix || '')} · ${esc(dash.roundStatus.state)}</span>` : ''}
    </div>
    ${section('auditor-progress', 'Auditor Progress', `${submittedCount}/${dash.auditorProgress.length} submitted`, auditorRows)}
    ${section('company-coverage', 'Company Coverage', `${assignedCount}/${dash.companyStatus.length} assigned`, companyRows)}
    ${section('compile-status', 'Compile Status', compileBadge, compileSummary)}
    ${auditorNotes.length > 0 ? section('auditor-notes', 'Auditor Notes (' + auditorNotes.length + ')', auditorNotes.length + ' note(s)', notesRows) : ''}
    ${conflicts.length > 0 ? section('cross-round-conflicts', 'Cross-Round Conflicts (' + conflicts.length + ')', unresolvedConflicts > 0 ? unresolvedConflicts + ' unresolved' : 'all resolved', conflictRows) : ''}
  `;
}

// Collapsed by default, same .history-item pattern as the Main Auditor
// dashboard — this card was a wall of text (every assigned company run
// together in one paragraph) sitting above the counting table the
// sub-auditor actually needs to reach. `open` is kept by the page layer
// across re-renders since this redraws on every single count entered.
export function subDashboardHTML(dash, filterMode, sortAscending, readOnly, open, groupByCompany) {
  if (!dash) return '<div class="card">Not paired to an assignment.</div>';
  const netCls = dash.netImpact < 0 ? 'val-red' : (dash.netImpact > 0 ? 'val-green' : 'val-grey');
  const netSign = dash.netImpact > 0 ? '+' : '';
  const chip = (mode, label) => `<button class="filter-btn${filterMode === mode ? ' filter-btn-active' : ''}" data-action="set-counting-filter" data-mode="${mode}">${label}</button>`;
  const multiCompany = dash.assignedCompanies.length > 1;
  return `
    <div class="history-item${open ? ' open' : ''}">
      <div class="history-header" data-action="toggle-sub-dashboard-card" style="align-items:flex-start;" role="button" tabindex="0" aria-expanded="${open ? 'true' : 'false'}">
        <div style="min-width:0;">
          <div style="display:flex; align-items:center; gap:8px;">
            <span class="arrow-toggle" aria-hidden="true">&#9658;</span>
            <strong style="color:var(--navy); font-size:13px;">Your Assignment</strong>
          </div>
          <div style="font-size:11px; color:var(--grey); margin:2px 0 0 22px;">${dash.assignedCompanies.length} compan${dash.assignedCompanies.length === 1 ? 'y' : 'ies'} · ${dash.progress.counted}/${dash.progress.total} counted (${dash.progress.pct}%)</div>
        </div>
        <span class="val-badge ${netCls}" style="flex-shrink:0;">Net Impact: ${netSign}Rs ${Math.abs(dash.netImpact).toLocaleString()}</span>
      </div>
      <div class="history-content">
        <div style="font-size:12px; color:var(--grey); margin:8px 0;">${dash.assignedCompanies.map(esc).join(', ')}</div>
        <div style="display:flex; justify-content:space-between; font-size:11px; font-weight:700; color:var(--grey); margin-bottom:4px;">
          <span>${dash.progress.counted} / ${dash.progress.total} counted (${dash.progress.pct}%)</span>
          ${readOnly ? '' : '<button type="button" style="color:var(--gold-ink); text-decoration:underline; background:none; border:none; font: inherit; padding:0; cursor:pointer;" data-action="mark-remaining-match-counting">Mark Remaining as Match</button>'}
        </div>
        <div style="background:var(--light); border-radius:6px; height:6px; overflow:hidden; margin-bottom:10px;">
          <div style="height:100%; background:var(--green); border-radius:6px; width:${dash.progress.pct}%;"></div>
        </div>
        <div style="display:flex; justify-content:space-between; font-size:12px; font-weight:700; margin-bottom:10px;">
          <div style="color:var(--red);">Short: ${dash.short}</div>
          <div style="color:var(--green-ink);">Over: ${dash.over}</div>
          <div style="color:var(--grey);">Match: ${dash.match}</div>
          <div style="color:var(--gold-ink);">Rem: ${dash.rem}</div>
        </div>
        <div style="display:flex; gap:6px; flex-wrap:wrap; align-items:center;">
          ${chip('all', 'All')}${chip('shorts', 'Shorts ▼')}${chip('overs', 'Overs ▲')}${chip('unverified', 'Unverified')}
          <button class="sort-btn" data-action="toggle-counting-sort" style="margin-left:auto;">↕️ ${sortAscending ? 'A-Z' : 'Z-A'}</button>
        </div>
        ${multiCompany ? `
        <label style="display:flex; align-items:center; gap:5px; font-size:11px; font-weight:700; color:var(--grey); margin-top:10px; cursor:pointer;">
          <input type="checkbox" class="custom-checkbox" data-action="toggle-counting-group-by-company" ${groupByCompany ? 'checked' : ''}> Group items by company
        </label>` : ''}
      </div>
    </div>`;
}

// `displayRows` is whatever DashboardActions.sortLiveSnapshotRows(
// filterLiveSnapshotRows(buildLiveSnapshotRows(assignment), filterMode),
// sortMode) produced — the page controller computes it so this stays a
// pure render function, per this file's own rule ("Components just
// render whatever they're given").
export function liveSnapshotModalHTML(assignment, displayRows, filterMode, sortMode) {
  if (!assignment) return `<div style="font-size:13px; color:var(--grey); padding:20px 0; text-align:center;">Could not load this assignment.</div>`;
  const snap = assignment.liveSnapshot || {};
  const confirms = snap.confirms || {};
  const updatedLabel = snap.updatedAt
    ? new Date(snap.updatedAt).toLocaleTimeString('en-PK', { hour: '2-digit', minute: '2-digit' })
    : null;
  const allRows = displayRows || [];

  const shortCount = allRows.filter(r => r.status === 'short').length;
  const overCount = allRows.filter(r => r.status === 'over').length;
  const matchCount = allRows.filter(r => r.status === 'match').length;
  const unverifiedCount = allRows.filter(r => r.status === 'unverified').length;

  // Time taken so far — opening to now (or to submission, once
  // submitted). See counting-actions.js openMyAssignment/submitMyAssignment.
  const elapsedMs = assignment.startedAt
    ? (assignment.status === 'submitted' && snap.updatedAt ? new Date(snap.updatedAt) : new Date()) - new Date(assignment.startedAt)
    : null;
  const elapsedLabel = elapsedMs !== null ? _formatDuration(Math.max(0, elapsedMs / 1000)) : null;

  // A row is flagged "slow" past 90s — long enough to mean something
  // (a hard-to-find item, a recount, an interruption) without flagging
  // every ordinary row that just took a normal few seconds.
  const SLOW_ROW_SECONDS = 90;

  const rowsHTML = allRows.map(r => {
    // Uncounted=0 rule: an untouched row already carries its full
    // assumed-shortage variance (r.variance is never null now — see
    // buildLiveSnapshotRows) — muted here rather than solid red/green,
    // same visual language as the counting screen itself, so it never
    // reads as a confirmed finding.
    const muted = r.missing ? 'opacity:0.6;' : '';
    const varHTML = r.variance === 0 ? `<span style="color:var(--grey); ${muted}">0</span>`
      : `<span style="color:${r.variance < 0 ? 'var(--red)' : 'var(--green-ink)'}; font-weight:800; ${muted}">${r.variance > 0 ? '+' : ''}${r.variance}</span>`;
    const assumedHint = r.missing ? `<span style="font-size:9px; color:var(--gold-ink); font-weight:700;"> · ${r.autoMatched ? 'auto-matched' : 'assumed'}</span>` : '';
    const timeBadge = r.seconds >= SLOW_ROW_SECONDS
      ? `<span style="font-size:9.5px; color:var(--gold-ink); font-weight:700;">⏱ ${_formatDuration(r.seconds)}</span>` : '';
    return `
      <div class="movable-row" style="${confirms[r.itemKey] ? 'background:#FFFBEB;' : r.missing ? 'background:#FAFAFB;' : ''}">
        <span style="min-width:0;">
          <div style="font-size:12px; font-weight:700; color:var(--navy);">${esc(r.name)}</div>
          <div style="font-size:10px; color:var(--grey);">${esc(r.company)} · Sys ${r.qty}${timeBadge ? ' · ' + timeBadge : ''}${assumedHint}</div>
        </span>
        <span style="text-align:right; font-weight:700; ${muted}">${r.hasCount ? r.counted : '<span style="color:var(--grey); font-weight:600;">not yet</span>'}</span>
        <span style="text-align:right; min-width:36px;">${varHTML}</span>
      </div>`;
  }).join('');

  const chip = (mode, label) => `<button class="filter-btn${filterMode === mode ? ' filter-btn-active' : ''}" data-action="set-live-snapshot-filter" data-mode="${mode}">${label}</button>`;
  const canForceSubmit = assignment.status === 'counting' || assignment.status === 'assigned';
  const sortLabel = { 'name-desc': 'Z-A', 'variance-desc': 'Variance ▼', 'variance-asc': 'Variance ▲', 'time-desc': 'Slowest first' }[sortMode] || 'A-Z';

  return `
    <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:6px;">
      <h3 style="color:var(--navy); font-size:15px; font-weight:800;">${esc(assignment.auditorName)}'s live counts</h3>
      <button class="sort-btn" data-action="close-live-snapshot" style="padding:4px 10px;">✕</button>
    </div>
    <div style="font-size:11px; color:var(--grey); margin-bottom:8px;">
      ${updatedLabel ? 'Last synced ' + updatedLabel : 'Nothing synced yet — they haven\'t entered a count on this device yet.'}
      This is a refreshing snapshot, not live/real-time — tap Refresh to pull the latest.
    </div>
    ${elapsedLabel ? `<div style="font-size:12px; font-weight:700; color:var(--navy); margin-bottom:8px;">⏱ ${assignment.status === 'submitted' ? 'Took' : 'Elapsed'}: ${elapsedLabel}${assignment.status !== 'submitted' ? ' so far' : ''}</div>` : ''}
    <div style="display:flex; justify-content:space-between; font-size:12px; font-weight:700; margin-bottom:8px;">
      <div style="color:var(--red);">Short: ${shortCount}</div>
      <div style="color:var(--green-ink);">Over: ${overCount}</div>
      <div style="color:var(--grey);">Match: ${matchCount}</div>
      <div style="color:var(--gold-ink);">Unverified: ${unverifiedCount}</div>
    </div>
    <div style="display:flex; gap:6px; flex-wrap:wrap; align-items:center; margin-bottom:8px;">
      ${chip('all', 'All')}${chip('shorts', 'Shorts ▼')}${chip('overs', 'Overs ▲')}${chip('unverified', 'Unverified')}
      <button class="sort-btn" data-action="cycle-live-snapshot-sort" style="margin-left:auto;">↕️ ${sortLabel}</button>
    </div>
    ${snap.extraNote ? `
    <div style="background:#FFFBEB; border:1px solid var(--gold); border-radius:8px; padding:8px 10px; margin-bottom:10px;">
      <div style="font-size:10.5px; font-weight:800; color:var(--gold-ink); text-transform:uppercase; margin-bottom:3px;">Items found — not in system</div>
      <div style="font-size:12px; color:var(--navy); white-space:pre-wrap;">${esc(snap.extraNote)}</div>
    </div>` : ''}
    <div style="max-height:42vh; overflow:auto; margin-bottom:10px;">${rowsHTML || '<div style="font-size:12px; color:var(--grey); padding:10px 0;">No items match this filter.</div>'}</div>
    <div style="display:flex; gap:8px;">
      <button class="btn btn-primary" style="flex:1;" data-action="refresh-live-snapshot" data-assignment-id="${assignment.id}">🔄 Refresh</button>
      ${canForceSubmit ? `<button class="btn" style="flex:1; background:var(--red); color:#fff;" data-action="open-force-submit" data-assignment-id="${assignment.id}">⚠️ Force Submit</button>` : ''}
    </div>`;
}

// Leftover-handling choice, shown before a Force Submit is committed —
// deliberately no default selected, per the Main Auditor's own call:
// "no default leftover behaviour... depending on company/leftover work."
export function forceSubmitModalHTML(assignment) {
  if (!assignment) return '';
  const snap = assignment.liveSnapshot || {};
  const countedByAuditor = Object.keys(snap.counts || {}).length;
  const total = assignment.items.length;
  const leftover = total - countedByAuditor;
  return `
    <h3 style="color:var(--navy); font-size:15px; font-weight:800; margin-bottom:8px;">Force submit for ${esc(assignment.auditorName)}?</h3>
    <div style="font-size:12.5px; color:var(--grey); margin-bottom:12px;">
      ${countedByAuditor}/${total} counted so far. This commits their synced counts as the real submission and locks the assignment — they won't be able to edit it unless you reopen it.
    </div>
    ${leftover > 0 ? `
    <div style="font-size:12px; font-weight:700; color:var(--navy); margin-bottom:8px;">${leftover} item(s) they never got to — how should these be handled?</div>
    <div style="display:flex; flex-direction:column; gap:8px; margin-bottom:12px;">
      <button class="btn btn-block" style="text-align:left; background:var(--light); color:var(--navy);" data-action="confirm-force-submit" data-assignment-id="${assignment.id}" data-mode="unverified">
        Leave as unverified<div style="font-size:11px; font-weight:400; color:var(--grey);">Submit only what they actually counted; the rest stays flagged as not counted.</div>
      </button>
      <button class="btn btn-block" style="text-align:left; background:var(--light); color:var(--navy);" data-action="confirm-force-submit" data-assignment-id="${assignment.id}" data-mode="match">
        Mark leftovers as Match<div style="font-size:11px; font-weight:400; color:var(--grey);">Auto-fill the rest at system quantity (0 variance).</div>
      </button>
    </div>` : `
    <button class="btn btn-primary btn-block" style="margin-bottom:12px;" data-action="confirm-force-submit" data-assignment-id="${assignment.id}" data-mode="unverified">Submit their ${countedByAuditor} counted item(s)</button>
    `}
    <button class="sort-btn btn-block" data-action="close-force-submit">Cancel</button>`;
}
