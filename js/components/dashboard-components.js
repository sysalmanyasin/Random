import { esc } from './dom-utils.js';
import { countingProgressBarHTML } from './counting-components.js';

/* ══════════════════════════════════════════════════════════════
   FLOOR 4 — COMPONENTS / dashboard-components.js
   Blueprint §Dashboard — pure render only.
   ══════════════════════════════════════════════════════════════ */

// Sections default to collapsed — reuses the same .history-item /
// toggle-accordion pattern as Verify Stock History and the Reports list,
// so the Main Auditor lands on a short scannable summary instead of three
// always-expanded cards. `openSections` is a Set of section keys the page
// layer keeps around across re-renders so a section a user opened stays
// open through live progress updates instead of snapping shut.
export function mainDashboardHTML(dash, openSections) {
  if (!dash) return '<div class="card">No engagement selected.</div>';
  const isOpen = (key) => !!(openSections && openSections.has(key));

  const auditorRows = dash.auditorProgress.map(a => `
    <div class="movable-row" style="flex-direction:column; align-items:stretch; gap:4px;${!a.submitted && a.status !== 'assigned' ? ' cursor:pointer;' : ''}"
      ${!a.submitted && a.status !== 'assigned' ? `data-action="view-live-snapshot" data-assignment-id="${a.assignmentId}"` : ''}>
      <div style="display:flex; justify-content:space-between;">
        <span>${esc(a.auditorName)} · ${a.itemCount} lines</span>
        <span class="val-badge ${a.submitted ? 'val-green' : 'val-grey'}">${a.submitted ? 'Submitted' : a.status}</span>
      </div>
      ${!a.submitted && a.status !== 'assigned' ? `
      <div>${countingProgressBarHTML({ counted: a.counted, total: a.itemCount, pct: a.pct })}</div>
      <div style="font-size:10px; color:var(--grey); text-align:right;">Tap to peek at their live counts →</div>` : ''}
    </div>`).join('') || '<div style="font-size:12px; color:var(--grey); padding:6px 0;">No assignments yet.</div>';

  const companyRows = dash.companyStatus.map(c => `
    <div class="movable-row">
      <span>${esc(c.company)}</span>
      <span style="font-size:11px; color:${c.assigned ? 'var(--green)' : 'var(--grey)'};">${c.assigned ? esc(c.auditor) : 'Unassigned'}</span>
    </div>`).join('');

  const assignedCount = dash.companyStatus.filter(c => c.assigned).length;
  const submittedCount = dash.auditorProgress.filter(a => a.submitted).length;
  const compileSummary = typeof dash.compileStatus === 'string'
    ? esc(dash.compileStatus)
    : dash.compileStatus.variances + ' variance(s) as of ' + new Date(dash.compileStatus.compiledAt).toLocaleString('en-PK');
  const compileBadge = typeof dash.compileStatus === 'string' ? '' : `${dash.compileStatus.variances} variance(s)`;

  const section = (key, title, summary, bodyHTML) => `
    <div class="history-item${isOpen(key) ? ' open' : ''}">
      <div class="history-header" data-action="toggle-dashboard-section" data-section="${key}">
        <div style="display:flex; align-items:center; gap:8px; overflow:hidden;">
          <span class="arrow-toggle">&#9658;</span>
          <strong style="color:var(--navy); font-size:12.5px;">${title}</strong>
        </div>
        <span style="font-size:11px; color:var(--grey); flex-shrink:0; margin-left:8px;">${summary}</span>
      </div>
      <div class="history-content">${bodyHTML}</div>
    </div>`;

  return `
    <div class="card">
      <div class="card-title" style="margin:0 0 8px;">Engagement</div>
      <span class="val-badge val-navy">${esc(dash.engagementStatus)}</span>
      ${dash.roundStatus ? `<span class="val-badge val-gold" style="margin-left:6px;">Round ${dash.roundStatus.number}${esc(dash.roundStatus.suffix || '')} · ${esc(dash.roundStatus.state)}</span>` : ''}
    </div>
    ${section('auditor-progress', 'Auditor Progress', `${submittedCount}/${dash.auditorProgress.length} submitted`, auditorRows)}
    ${section('company-coverage', 'Company Coverage', `${assignedCount}/${dash.companyStatus.length} assigned`, companyRows)}
    ${section('compile-status', 'Compile Status', compileBadge, compileSummary)}
  `;
}

export function subDashboardHTML(dash, filterMode, sortAscending, readOnly) {
  if (!dash) return '<div class="card">Not paired to an assignment.</div>';
  const netCls = dash.netImpact < 0 ? 'val-red' : (dash.netImpact > 0 ? 'val-green' : 'val-grey');
  const netSign = dash.netImpact > 0 ? '+' : '';
  const chip = (mode, label) => `<button class="filter-btn${filterMode === mode ? ' filter-btn-active' : ''}" data-action="set-counting-filter" data-mode="${mode}">${label}</button>`;
  return `
    <div class="card">
      <div style="display:flex; justify-content:space-between; align-items:flex-start; margin-bottom:8px;">
        <div class="card-title" style="margin:0;">Your Assignment</div>
        <span class="val-badge ${netCls}">Net Impact: ${netSign}Rs ${Math.abs(dash.netImpact).toLocaleString()}</span>
      </div>
      <div style="font-size:12px; color:var(--grey); margin-bottom:8px;">${dash.assignedCompanies.map(esc).join(', ')}</div>
      <div style="display:flex; justify-content:space-between; font-size:11px; font-weight:700; color:var(--grey); margin-bottom:4px;">
        <span>${dash.progress.counted} / ${dash.progress.total} counted (${dash.progress.pct}%)</span>
        ${readOnly ? '' : '<span style="color:var(--gold); cursor:pointer; text-decoration:underline;" data-action="mark-remaining-match-counting">Mark Remaining as Match</span>'}
      </div>
      <div style="background:var(--light); border-radius:6px; height:6px; overflow:hidden; margin-bottom:10px;">
        <div style="height:100%; background:var(--green); border-radius:6px; width:${dash.progress.pct}%;"></div>
      </div>
      <div style="display:flex; justify-content:space-between; font-size:12px; font-weight:700; margin-bottom:10px;">
        <div style="color:var(--red);">Short: ${dash.short}</div>
        <div style="color:var(--green);">Over: ${dash.over}</div>
        <div style="color:var(--grey);">Match: ${dash.match}</div>
        <div style="color:var(--gold);">Rem: ${dash.rem}</div>
      </div>
      <div style="display:flex; gap:6px; flex-wrap:wrap;">
        ${chip('all', 'All')}${chip('shorts', 'Shorts ▼')}${chip('overs', 'Overs ▲')}${chip('unverified', 'Unverified')}
        <button class="sort-btn" data-action="toggle-counting-sort" style="margin-left:auto;">↕️ ${sortAscending ? 'A-Z' : 'Z-A'}</button>
      </div>
    </div>`;
}

export function liveSnapshotModalHTML(assignment) {
  if (!assignment) return `<div style="font-size:13px; color:var(--grey); padding:20px 0; text-align:center;">Could not load this assignment.</div>`;
  const snap = assignment.liveSnapshot || {};
  const counts = snap.counts || {};
  const confirms = snap.confirms || {};
  const updatedLabel = snap.updatedAt
    ? new Date(snap.updatedAt).toLocaleTimeString('en-PK', { hour: '2-digit', minute: '2-digit' })
    : null;

  const rows = assignment.items.map(item => {
    const counted = counts[item.itemKey];
    const hasCount = counted !== undefined;
    const variance = hasCount ? counted - item.qty : null;
    const varHTML = !hasCount ? '<span style="color:var(--grey);">—</span>'
      : variance === 0 ? '<span style="color:var(--grey);">0</span>'
      : `<span style="color:${variance < 0 ? 'var(--red)' : 'var(--green)'}; font-weight:800;">${variance > 0 ? '+' : ''}${variance}</span>`;
    return `
      <div class="movable-row" style="${confirms[item.itemKey] ? 'background:#FFFBEB;' : ''}">
        <span style="min-width:0;">
          <div style="font-size:12px; font-weight:700; color:var(--navy);">${esc(item.name)}</div>
          <div style="font-size:10px; color:var(--grey);">${esc(item.company)} · Sys ${item.qty}</div>
        </span>
        <span style="text-align:right; font-weight:700;">${hasCount ? counted : '<span style="color:var(--grey); font-weight:600;">not yet</span>'}</span>
        <span style="text-align:right; min-width:36px;">${varHTML}</span>
      </div>`;
  }).join('');

  return `
    <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:6px;">
      <h3 style="color:var(--navy); font-size:15px; font-weight:800;">${esc(assignment.auditorName)}'s live counts</h3>
      <button class="sort-btn" data-action="close-live-snapshot" style="padding:4px 10px;">✕</button>
    </div>
    <div style="font-size:11px; color:var(--grey); margin-bottom:10px;">
      ${updatedLabel ? 'Last synced ' + updatedLabel : 'Nothing synced yet — they haven\'t entered a count on this device yet.'}
      This is a refreshing snapshot, not live/real-time — tap Refresh to pull the latest.
    </div>
    <div style="max-height:50vh; overflow:auto; margin-bottom:10px;">${rows || '<div style="font-size:12px; color:var(--grey); padding:10px 0;">No items on this assignment.</div>'}</div>
    <button class="btn btn-primary btn-block" data-action="refresh-live-snapshot" data-assignment-id="${assignment.id}">🔄 Refresh</button>`;
}
