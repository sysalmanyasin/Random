/* ══════════════════════════════════════════════════════════════
   FLOOR 4 — COMPONENTS / report-components.js
   Blueprint §Reporting — pure render only.
   ══════════════════════════════════════════════════════════════ */

import { esc } from './dom-utils.js';

export function finalSnapshotCardHTML(snapshot) {
  return `
    <div class="card">
      <div style="font-weight:800; color:var(--navy); font-size:14px;">Final Snapshot</div>
      <div style="font-size:12px; color:var(--grey); margin-top:4px;">Generated ${new Date(snapshot.generatedAt).toLocaleString('en-PK')}</div>
      <div style="font-size:12px; color:var(--grey); margin-top:2px;">${snapshot.report.totalItems} items in scope · Net variance Rs ${Number(snapshot.report.totalVarianceValue).toLocaleString()}</div>
    </div>`;
}

// `key` identifies the report to the Overview popup (engagement-pages.js
// switches on it to build the right preview + wire the right export fn) —
// kept separate from `action`, which no longer fires an export directly.
const REPORT_INFO = [
  {
    key: 'final-audit', icon: '📄', title: 'Final Audit Report (.xlsx)',
    description: 'Generated when an engagement is locked to <strong>Final</strong> by the Main Auditor. Compiles the full multi-auditor cycle into one Excel workbook: every round, every sub-auditor\'s submission, the compiled inventory count per SKU, and digital sign-offs with timestamps. This is the <strong>certified, regulatory-grade document</strong> — the file you hand to an owner, external auditor, or compliance officer as the official record of the stock count.',
  },
  {
    key: 'variance', icon: '⚠️', title: 'Variance Report (.xlsx)',
    description: 'Isolates <strong>every SKU where the physical count differed from the system quantity</strong> across the entire compiled engagement. Shows the variance delta, unit cost, and rupee impact per line item — plus a cumulative financial exposure total at the bottom. Use this to <strong>prioritise follow-up action</strong>: which shortages need explanation, which overs need investigation, and which items are candidates for a recount before finalising.',
  },
  {
    key: 'combined-variance', icon: '🧮', title: 'Combined Variance Report — All Rounds (.xlsx)',
    description: 'The Variance Report above shows the <strong>latest round only</strong>. This one lists every variance line from <strong>every compiled round in the engagement</strong>, one flat sheet — each row shows which round it came from and who counted it (e.g. "Round 2 — Salman Yasin"). If the same product shows up in more than one round (e.g. it was recounted), those rows are <strong>flagged as duplicates and grouped together</strong> so you can see the count history for that item at a glance instead of hunting across separate round reports.',
  },
  {
    key: 'round-history', icon: '📋', title: 'Round History (.xlsx)',
    description: 'A <strong>timeline of every round</strong> run within the engagement: round number, date opened, date closed, state (open / compiled / final), and how many assignments were issued in that round. Gives a clear picture of the audit\'s progression — useful when you need to explain <strong>how many passes were done</strong> and on what dates, especially if a recount round was triggered after a discrepancy.',
  },
  {
    key: 'submission-history', icon: '✏️', title: 'Submission History (.xlsx)',
    description: 'Lists <strong>every submission made by every sub-auditor</strong> across all rounds: who submitted, which company section they counted, when they submitted, and whether it was an original submission or a resubmission after a conflict was flagged. Use this to <strong>verify accountability</strong> — confirming that each section was counted by an authorised team member and that no submission was skipped or duplicated.',
  },
  {
    key: 'audit-trail', icon: '🔊', title: 'Audit Trail (.xlsx)',
    description: 'An <strong>immutable, chronological log</strong> of every significant system action: who was assigned, who submitted, when rounds opened and closed, any resubmissions, conflict detections, compilation events, and the final lock sign-off with timestamps. Stored in Postgres and synced even if the connection dropped mid-session. The <strong>source of truth</strong> if you ever need to explain exactly what happened, in what order, and who did it — for compliance, dispute resolution, or internal review.',
  },
];

// Collapsed by default — reuses the same .history-item / toggle-accordion
// pattern as the Verify Stock History tab, so it's a single tap to expand
// a report's description. The header button now opens an Overview popup
// (branded preview) rather than downloading immediately — Print/Export
// live inside that popup instead.
export function reportButtonsHTML() {
  return REPORT_INFO.map(r => `
    <div class="history-item">
      <div class="history-header" data-action="toggle-accordion" role="button" tabindex="0" aria-expanded="false">
        <div style="display:flex; align-items:center; gap:8px; max-width:70%; overflow:hidden;">
          <span class="arrow-toggle" aria-hidden="true">&#9658;</span>
          <span style="font-size:16px;">${r.icon}</span>
          <strong style="color:var(--navy); font-size:12px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">${r.title}</strong>
        </div>
        <button class="btn btn-primary btn-sm" style="flex-shrink:0; font-size:11px; padding:7px 12px;" data-action="open-report-overview" data-report="${r.key}">Overview</button>
      </div>
      <div class="history-content" style="font-size:12px; color:var(--text); line-height:1.5;">${r.description}</div>
    </div>`).join('');
}

// ── Report Overview popup shell ──────────────────────────────
// `bodyHTML` is the same branded markup used for the Print PDF (pdf-meta-
// box / pdf-summary-grid / pdf-table classes, see app.css) — the popup is
// deliberately just that content in a scrollable frame, so what a Main
// Auditor previews here is exactly what they'll get on paper or in xlsx.
export function reportOverviewShellHTML(title, bodyHTML) {
  return `
    <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:10px;">
      <h3 style="color:var(--navy); font-size:15px; font-weight:800;">${esc(title)}</h3>
      <button class="sort-btn" data-action="close-report-overview" style="padding:4px 10px;">✕</button>
    </div>
    <div id="report-overview-canvas" style="max-height:56vh; overflow:auto; border:1px solid #E2E8F0; border-radius:10px; padding:16px; background:#fff;">${bodyHTML}</div>
    <div style="display:flex; gap:8px; margin-top:12px;">
      <button class="btn btn-primary" style="flex:1;" data-action="print-report-overview">🖨️ Print PDF</button>
      <button class="btn" style="flex:1; background:var(--green-ink); color:white;" data-action="export-report-overview">📊 Export xlsx</button>
    </div>`;
}

// Shown instead of the shell above when the underlying data doesn't exist
// yet (e.g. Final Audit Report before the engagement is locked to Final) —
// no Print/Export buttons, since there's nothing to preview or export.
export function reportOverviewEmptyHTML(title, message) {
  return `
    <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:10px;">
      <h3 style="color:var(--navy); font-size:15px; font-weight:800;">${esc(title)}</h3>
      <button class="sort-btn" data-action="close-report-overview" style="padding:4px 10px;">✕</button>
    </div>
    <div style="padding:28px 0; text-align:center; color:var(--grey); font-size:13px;">${esc(message)}</div>`;
}
