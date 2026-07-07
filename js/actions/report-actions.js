import { Bus } from './bus.js';
import { logAudit } from './audit-log-actions.js';

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
  snapshot.report.roundsSummary.forEach(r => rows.push([r.roundNumber, r.state, r.itemCount, r.varianceCount, r.compiledAt ? new Date(r.compiledAt).toLocaleString('en-PK') : '']));
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

function exportVarianceReportXLSX(compiledRound, roundLabel) {
  const rows = [['Item Key', 'Company', 'Code', 'Name', 'System Qty', 'Counted Qty', 'Variance', 'Value Impact (Rs)', 'Auditor', 'Confirmed Same', 'Note']];
  compiledRound.variances.forEach(r => {
    const variance = r.countedQty - r.systemQty;
    rows.push([r.itemKey, r.company, r.code || '', r.name, r.systemQty, r.countedQty, variance, Number((variance * r.price).toFixed(2)), r.auditorName, r.confirmedSame ? 'Yes' : '', r.note || '']);
  });
  _downloadWorkbook({ 'Variance Report': rows }, 'VarianceReport_' + roundLabel.replace(/\s+/g, '_') + '.xlsx');
  logAudit('report:varianceExported', { roundId: compiledRound.roundId });
  Bus.emit('toast', { msg: 'Variance Report exported', kind: 'success' });
}

function exportRoundHistoryXLSX(engagement, rounds) {
  const rows = [['Round #', 'Unit', 'State', 'Created', 'Locked', 'Compiled', 'Finalized']];
  rounds.forEach(r => rows.push([
    r.roundNumber, r.unit, r.state,
    new Date(r.createdAt).toLocaleString('en-PK'),
    r.lockedAt ? new Date(r.lockedAt).toLocaleString('en-PK') : '',
    r.compiledAt ? new Date(r.compiledAt).toLocaleString('en-PK') : '',
    r.finalizedAt ? new Date(r.finalizedAt).toLocaleString('en-PK') : '',
  ]));
  _downloadWorkbook({ 'Round History': rows }, 'RoundHistory_' + engagement.name.replace(/\s+/g, '_') + '.xlsx');
  logAudit('report:roundHistoryExported', { engagementId: engagement.id });
}

function exportSubmissionHistoryXLSX(engagement, submissions, assignments) {
  const rows = [['Auditor', 'Assignment ID', 'Companies', 'Item Count', 'Submitted At (Sign-off)']];
  submissions.forEach(s => {
    const a = assignments.find(x => x.id === s.assignmentId);
    rows.push([s.auditorName, s.assignmentId, a ? a.companies.join(', ') : '', Object.keys(s.counts || {}).length, new Date(s.submittedAt).toLocaleString('en-PK')]);
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
  exportFinalAuditReportXLSX, exportVarianceReportXLSX,
  exportRoundHistoryXLSX, exportSubmissionHistoryXLSX, exportAuditTrailXLSX,
};
