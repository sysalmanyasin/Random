import { esc } from './dom-utils.js';
import { countingProgressBarHTML } from './counting-components.js';

/* ══════════════════════════════════════════════════════════════
   FLOOR 4 — COMPONENTS / dashboard-components.js
   Blueprint §Dashboard — pure render only.
   ══════════════════════════════════════════════════════════════ */

export function mainDashboardHTML(dash) {
  if (!dash) return '<div class="card">No engagement selected.</div>';
  const auditorRows = dash.auditorProgress.map(a => `
    <div class="movable-row" style="flex-direction:column; align-items:stretch; gap:4px;">
      <div style="display:flex; justify-content:space-between;">
        <span>${esc(a.auditorName)} · ${a.itemCount} lines</span>
        <span class="val-badge ${a.submitted ? 'val-green' : 'val-grey'}">${a.submitted ? 'Submitted' : a.status}</span>
      </div>
      ${!a.submitted && a.status !== 'assigned' ? `
      <div>${countingProgressBarHTML({ counted: a.counted, total: a.itemCount, pct: a.pct })}</div>` : ''}
    </div>`).join('') || '<div style="font-size:12px; color:var(--grey); padding:6px 0;">No assignments yet.</div>';

  const companyRows = dash.companyStatus.map(c => `
    <div class="movable-row">
      <span>${esc(c.company)}</span>
      <span style="font-size:11px; color:${c.assigned ? 'var(--green)' : 'var(--grey)'};">${c.assigned ? esc(c.auditor) : 'Unassigned'}</span>
    </div>`).join('');

  return `
    <div class="card">
      <div class="card-title" style="margin:0 0 8px;">Engagement</div>
      <span class="val-badge val-navy">${esc(dash.engagementStatus)}</span>
      ${dash.roundStatus ? `<span class="val-badge val-gold" style="margin-left:6px;">Round ${dash.roundStatus.number} · ${esc(dash.roundStatus.state)}</span>` : ''}
    </div>
    <div class="card-title">Auditor Progress</div>
    <div class="card">${auditorRows}</div>
    <div class="card-title">Company Coverage</div>
    <div class="card">${companyRows}</div>
    <div class="card-title">Compile Status</div>
    <div class="card">${typeof dash.compileStatus === 'string' ? esc(dash.compileStatus) : dash.compileStatus.variances + ' variance(s) as of ' + new Date(dash.compileStatus.compiledAt).toLocaleString('en-PK')}</div>
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
