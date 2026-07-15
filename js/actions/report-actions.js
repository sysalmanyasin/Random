import { Bus } from './bus.js';
import { logAudit } from './audit-log-actions.js';
import { DashboardActions } from './dashboard-actions.js';
const _fmtDuration = DashboardActions.formatDuration;

/* ══════════════════════════════════════════════════════════════
   FLOOR 3 — ACTIONS / report-actions.js
   Blueprint §Reporting.
   Final Audit Report · Variance Report · Round History ·
   Submission History · Audit Trail · Digital Sign-offs (name +
   timestamp per submission, carried on every Submission record).
   ══════════════════════════════════════════════════════════════ */

function _downloadWorkbook(rowsBySheet, filename) {
  const wb = XLSX.utils.book_new();
  Object.keys(rowsBySheet).forEach(sheetName => {
    const ws = XLSX.utils.aoa_to_sheet(rowsBySheet[sheetName]);
    XLSX.utils.book_append_sheet(wb, ws, sheetName.slice(0, 31));
  });
  XLSX.writeFile(wb, filename);
}

function exportFinalAuditReportXLSX(snapshot, engagementName) {
  const rows = [['Final Audit Report — ' + engagementName]];
  rows.push(['Generated', new Date(snapshot.generatedAt).toLocaleString('en-PK')]);
  rows.push([]);
  rows.push(['Round #', 'State', 'Items', 'Variances', 'Compiled At']);
  snapshot.report.roundsSummary.forEach(r => rows.push([r.roundNumber + (r.roundSuffix || ''), r.state, r.itemCount, r.varianceCount, r.compiledAt ? new Date(r.compiledAt).toLocaleString('en-PK') : '']));
  rows.push([]);
  rows.push(['Total Companies', snapshot.report.totalCompanies]);
  rows.push(['Total Items In Scope', snapshot.report.totalItems]);
  rows.push(['Net Variance Value (Rs)', Number(snapshot.report.totalVarianceValue.toFixed(2))]);

  const invRows = [['Company', 'Code', 'Name', 'Book Qty', 'Final Qty', 'Variance', 'Price', 'Variance Value (Rs)']];
  snapshot.finalInventory.forEach(p => {
    const variance = p.qty - (p.systemQty !== undefined ? p.systemQty : p.qty);
    invRows.push([p.company, p.code || '', p.name, p.systemQty !== undefined ? p.systemQty : p.qty, p.qty, variance, p.price, Number((variance * p.price).toFixed(2))]);
  });

  _downloadWorkbook({ 'Final Report': rows, 'Final Inventory': invRows }, 'FinalAuditReport_' + engagementName.replace(/\s+/g, '_') + '.xlsx');
  logAudit('report:finalAuditExported', { snapshotId: snapshot.id });
  Bus.emit('toast', { msg: 'Final Audit Report exported', kind: 'success' });
}

// Single source of truth for the Variance Report's row shape, used by
// both the xlsx export and the printable PDF so the two never drift
// apart. Always flat (no company grouping) and sorted alphabetically
// by product name — per Blueprint §Reporting, "sorted alphabetically"
// is the default reading order for a printed/exported report; the
// on-screen workspace table has its own separate Impact/A-Z toggle.
function buildVarianceReportRows(compiledRound) {
  const conflictedItemKeys = new Set((compiledRound.crossRoundConflicts || []).map(c => c.a.itemKey));
  const rows = compiledRound.variances.map(r => {
    const variance = r.countedQty - r.systemQty;
    const valueVariance = Number((variance * r.price).toFixed(2));
    // Under the uncounted=0 rule, EVERY row here has a number — this
    // column is what tells a reader whether it's a real physical
    // count or an assumption (untouched, defaulted to 0) / an
    // auto-match (Mark Remaining as Match), which read identically
    // as numbers but mean very different things for an audit.
    const verified = !r.missing ? 'Yes' : (r.autoMatched ? 'No — auto-matched' : 'No — not counted');
    // "Manually resolved" rather than a bare yes/no, so a reader can't
    // mistake a flagged-but-unresolved conflict for a settled one.
    const conflictMarker = conflictedItemKeys.has(r.itemKey) ? 'Yes — see appendix' : '';
    return {
      code: r.code || '', name: r.name, company: r.company, price: r.price,
      systemQty: r.systemQty, countedQty: r.countedQty, variance, valueVariance,
      auditorName: r.auditorName, verified, confirmedSame: !!r.confirmedSame, conflictMarker,
    };
  }).sort((a, b) => a.name.localeCompare(b.name));
  return rows;
}

function exportVarianceReportXLSX(compiledRound, roundLabel, meta) {
  meta = meta || {};
  const varianceRows = buildVarianceReportRows(compiledRound);
  const rows = [['Variance Report — ' + roundLabel + (meta.engagementName ? ' — ' + meta.engagementName : '')]];
  rows.push(['Generated', new Date().toLocaleString('en-PK')]);
  if (meta.mainAuditorName) rows.push(['Main Auditor', meta.mainAuditorName]);
  if (meta.branchName) rows.push(['Branch', meta.branchName]);
  rows.push([]);
  rows.push(['Product Code', 'Product Name', 'Company', 'Unit Price (Rs)', 'System Quantity', 'Physical Quantity', 'Variance', 'Variance Amount (Rs)', 'Sub Auditor', 'Verified', 'Confirmed Same', 'Cross-Round Conflict']);
  let grandQtyVar = 0, grandValueVar = 0;
  varianceRows.forEach(r => {
    rows.push([r.code, r.name, r.company, r.price, r.systemQty, r.countedQty, r.variance, r.valueVariance, r.auditorName, r.verified, r.confirmedSame ? 'Yes' : '', r.conflictMarker]);
    grandQtyVar += r.variance;
    grandValueVar += r.valueVariance;
  });
  rows.push([]);
  rows.push(['GRAND TOTAL', '', '', '', '', '', grandQtyVar, Number(grandValueVar.toFixed(2))]);

  const sheets = { 'Variance Report': rows };

  // Auditor Notes appendix — grouped by auditor, kept on its own sheet
  // so it's never mistaken for a counted variance line (see
  // compile-actions.js collectAuditorNotes — informational only).
  const notes = compiledRound.auditorNotes || [];
  if (notes.length > 0) {
    const noteRows = [['Additional items noted by auditors — not in system (informational only, not counted as variance)'], []];
    noteRows.push(['Auditor', 'Note', 'Submitted At']);
    const byAuditor = new Map();
    notes.forEach(n => { if (!byAuditor.has(n.auditorName)) byAuditor.set(n.auditorName, []); byAuditor.get(n.auditorName).push(n); });
    [...byAuditor.keys()].sort().forEach(auditorName => {
      byAuditor.get(auditorName).forEach(n => noteRows.push([auditorName, n.note, n.submittedAt ? new Date(n.submittedAt).toLocaleString('en-PK') : '']));
    });
    sheets['Auditor Notes'] = noteRows;
  }

  // Cross-Round Conflicts appendix — both counts kept, resolution
  // status shown plainly rather than silently picking one (see
  // compile-actions.js detectCrossRoundConflicts / resolveCrossRoundConflict).
  const conflicts = compiledRound.crossRoundConflicts || [];
  if (conflicts.length > 0) {
    const conflictRows = [['Same product counted differently in another round — both kept, flagged for manual resolution'], []];
    conflictRows.push(['Company', 'Code', 'Product', 'Count A (Auditor)', 'Count B (Auditor)', 'Resolution']);
    conflicts.forEach(c => {
      const resolution = c.resolved ? ('Kept ' + c.resolved.countedQty + ' (by ' + c.resolved.resolvedBy + ')') : 'Unresolved';
      conflictRows.push([c.company, c.code, c.name, c.a.countedQty + ' (' + c.a.auditorName + ')', c.b.countedQty + ' (' + c.b.auditorName + ')', resolution]);
    });
    sheets['Cross-Round Conflicts'] = conflictRows;
  }

  _downloadWorkbook(sheets, 'VarianceReport_' + roundLabel.replace(/\s+/g, '_') + '.xlsx');
  logAudit('report:varianceExported', { roundId: compiledRound.roundId });
  Bus.emit('toast', { msg: 'Variance Report exported', kind: 'success' });
}

function exportRoundHistoryXLSX(engagement, rounds) {
  const rows = [['Round #', 'Unit', 'State', 'Created', 'Locked', 'Compiled', 'Finalized']];
  rounds.forEach(r => rows.push([
    r.roundNumber + (r.roundSuffix || ''), r.unit, r.state,
    new Date(r.createdAt).toLocaleString('en-PK'),
    r.lockedAt ? new Date(r.lockedAt).toLocaleString('en-PK') : '',
    r.compiledAt ? new Date(r.compiledAt).toLocaleString('en-PK') : '',
    r.finalizedAt ? new Date(r.finalizedAt).toLocaleString('en-PK') : '',
  ]));
  _downloadWorkbook({ 'Round History': rows }, 'RoundHistory_' + engagement.name.replace(/\s+/g, '_') + '.xlsx');
  logAudit('report:roundHistoryExported', { engagementId: engagement.id });
}

function exportSubmissionHistoryXLSX(engagement, submissions, assignments) {
  const rows = [['Auditor', 'Assignment ID', 'Companies', 'Item Count', 'Submitted At (Sign-off)', 'Time Taken', 'Force Submitted By']];
  submissions.forEach(s => {
    const a = assignments.find(x => x.id === s.assignmentId);
    const timeTaken = (a && a.startedAt) ? _fmtDuration((new Date(s.submittedAt) - new Date(a.startedAt)) / 1000) : '';
    rows.push([s.auditorName, s.assignmentId, a ? a.companies.join(', ') : '', Object.keys(s.counts || {}).length, new Date(s.submittedAt).toLocaleString('en-PK'), timeTaken, s.forceSubmittedBy || '']);
  });
  _downloadWorkbook({ 'Submission History': rows }, 'SubmissionHistory_' + engagement.name.replace(/\s+/g, '_') + '.xlsx');
  logAudit('report:submissionHistoryExported', { engagementId: engagement.id });
}

function exportAuditTrailXLSX(engagement, auditLog) {
  const rows = [['Timestamp', 'Actor', 'Role', 'Action', 'Details']];
  auditLog.forEach(e => rows.push([new Date(e.ts).toLocaleString('en-PK'), e.actor, e.role, e.action, JSON.stringify(e.details)]));
  _downloadWorkbook({ 'Audit Trail': rows }, 'AuditTrail_' + engagement.name.replace(/\s+/g, '_') + '.xlsx');
  logAudit('report:auditTrailExported', { engagementId: engagement.id });
}

export const ReportActions = {
  exportFinalAuditReportXLSX, exportVarianceReportXLSX, buildVarianceReportRows,
  exportRoundHistoryXLSX, exportSubmissionHistoryXLSX, exportAuditTrailXLSX,
};
