/* ══════════════════════════════════════════════════════════════
   FLOOR 4 — COMPONENTS / report-components.js
   Blueprint §Reporting — pure render only.
   ══════════════════════════════════════════════════════════════ */

export function finalSnapshotCardHTML(snapshot) {
  return `
    <div class="card">
      <div style="font-weight:800; color:var(--navy); font-size:14px;">Final Snapshot</div>
      <div style="font-size:12px; color:var(--grey); margin-top:4px;">Generated ${new Date(snapshot.generatedAt).toLocaleString('en-PK')}</div>
      <div style="font-size:12px; color:var(--grey); margin-top:2px;">${snapshot.report.totalItems} items in scope · Net variance Rs ${Number(snapshot.report.totalVarianceValue).toLocaleString()}</div>
    </div>`;
}

const REPORT_INFO = [
  {
    icon: '📄', title: 'Final Audit Report (.xlsx)', action: 'export-final-audit-report',
    description: 'Generated when an engagement is locked to <strong>Final</strong> by the Main Auditor. Compiles the full multi-auditor cycle into one Excel workbook: every round, every sub-auditor\'s submission, the compiled inventory count per SKU, and digital sign-offs with timestamps. This is the <strong>certified, regulatory-grade document</strong> — the file you hand to an owner, external auditor, or compliance officer as the official record of the stock count.',
  },
  {
    icon: '⚠️', title: 'Variance Report (.xlsx)', action: 'export-variance-report',
    description: 'Isolates <strong>every SKU where the physical count differed from the system quantity</strong> across the entire compiled engagement. Shows the variance delta, unit cost, and rupee impact per line item — plus a cumulative financial exposure total at the bottom. Use this to <strong>prioritise follow-up action</strong>: which shortages need explanation, which overs need investigation, and which items are candidates for a recount before finalising.',
  },
  {
    icon: '📋', title: 'Round History (.xlsx)', action: 'export-round-history',
    description: 'A <strong>timeline of every round</strong> run within the engagement: round number, date opened, date closed, state (open / compiled / final), and how many assignments were issued in that round. Gives a clear picture of the audit\'s progression — useful when you need to explain <strong>how many passes were done</strong> and on what dates, especially if a recount round was triggered after a discrepancy.',
  },
  {
    icon: '✏️', title: 'Submission History (.xlsx)', action: 'export-submission-history',
    description: 'Lists <strong>every submission made by every sub-auditor</strong> across all rounds: who submitted, which company section they counted, when they submitted, and whether it was an original submission or a resubmission after a conflict was flagged. Use this to <strong>verify accountability</strong> — confirming that each section was counted by an authorised team member and that no submission was skipped or duplicated.',
  },
  {
    icon: '🔊', title: 'Audit Trail (.xlsx)', action: 'export-audit-trail',
    description: 'An <strong>immutable, chronological log</strong> of every significant system action: who was assigned, who submitted, when rounds opened and closed, any resubmissions, conflict detections, compilation events, and the final lock sign-off with timestamps. Stored in Postgres and synced even if the connection dropped mid-session. The <strong>source of truth</strong> if you ever need to explain exactly what happened, in what order, and who did it — for compliance, dispute resolution, or internal review.',
  },
];

// Collapsed by default — reuses the same .history-item / toggle-accordion
// pattern as the Verify Stock History tab, so it's a single tap to expand
// a report's description, and the export button is still right there in
// the header (one tap, no need to expand first).
export function reportButtonsHTML() {
  return REPORT_INFO.map(r => `
    <div class="history-item">
      <div class="history-header" data-action="toggle-accordion">
        <div style="display:flex; align-items:center; gap:8px; max-width:70%; overflow:hidden;">
          <span class="arrow-toggle">&#9658;</span>
          <span style="font-size:16px;">${r.icon}</span>
          <strong style="color:var(--navy); font-size:12px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">${r.title}</strong>
        </div>
        <button class="btn btn-primary btn-sm" style="flex-shrink:0; font-size:11px; padding:7px 12px;" data-action="${r.action}">Export</button>
      </div>
      <div class="history-content" style="font-size:12px; color:var(--text); line-height:1.5;">${r.description}</div>
    </div>`).join('');
}
