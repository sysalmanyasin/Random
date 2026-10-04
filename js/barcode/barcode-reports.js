/* ══════════════════════════════════════════════════════════════
   BARCODE / barcode-reports.js  (pure — builds sheet rows)
   Array-of-arrays for the four barcode reports. The existing
   _downloadWorkbook() in report-actions.js writes them, so exports
   behave exactly like every other Random report.
   ══════════════════════════════════════════════════════════════ */

function ts(iso) { if (!iso) return ''; const d = new Date(iso); return isNaN(d) ? '' : d.toLocaleString('en-PK'); }
const pname = (ctx, code) => (ctx.productName ? ctx.productName(code) : '') || '';
const who = (ctx, id) => (id && ctx.nameFor ? ctx.nameFor(id) : '') || '';

// All registered barcodes.
export function buildBarcodeMasterRows(rows, ctx) {
  const out = [['Barcode Master Report'], ['Generated', ts(new Date().toISOString())], [],
    ['Barcode', 'Type', 'Product Code', 'Product Name', 'Status', 'Registered By', 'Registered At', 'Verified By', 'Verified At']];
  rows.slice().sort((a, b) => pname(ctx, a.productCode).localeCompare(pname(ctx, b.productCode)) || a.barcode.localeCompare(b.barcode))
    .forEach(r => out.push([r.barcode, r.barcodeType || '', r.productCode, pname(ctx, r.productCode), r.status, who(ctx, r.createdBy), ts(r.createdAt), who(ctx, r.verifiedBy), ts(r.verifiedAt)]));
  return out;
}

// Unverified vs verified mappings, with counts.
export function buildBarcodeVerificationRows(rows, ctx) {
  const unverified = rows.filter(r => r.status === 'unverified');
  const verified = rows.filter(r => r.status === 'verified');
  const out = [['Barcode Verification Report'], ['Generated', ts(new Date().toISOString())],
    ['Verified', verified.length], ['Unverified', unverified.length], [],
    ['Barcode', 'Product Code', 'Product Name', 'Verification', 'Registered By', 'Verified By', 'Verified At']];
  unverified.concat(verified).forEach(r => out.push([r.barcode, r.productCode, pname(ctx, r.productCode), r.status === 'verified' ? 'Verified' : 'UNVERIFIED', who(ctx, r.createdBy), who(ctx, r.verifiedBy), ts(r.verifiedAt)]));
  return out;
}

// Open conflicts + the resolution history that came from the verification log.
export function buildBarcodeConflictRows(rows, history, ctx) {
  const open = rows.filter(r => r.status === 'conflict');
  const out = [['Barcode Conflict Report'], ['Generated', ts(new Date().toISOString())], ['Open conflicts', open.length], [],
    ['OPEN CONFLICTS'], ['Barcode', 'Currently Linked Code', 'Currently Linked Product', 'Claimed By Code', 'Claimed By Product']];
  open.forEach(r => out.push([r.barcode, r.productCode, pname(ctx, r.productCode), r.conflictWithProductCode || '', pname(ctx, r.conflictWithProductCode)]));
  out.push([], ['CONFLICT HISTORY'], ['When', 'Barcode', 'Event', 'Product Code', 'By', 'Notes']);
  (history || []).filter(h => h.action === 'conflict_reported' || h.action === 'conflict_resolved')
    .sort((a, b) => new Date(b.performedAt) - new Date(a.performedAt))
    .forEach(h => out.push([ts(h.performedAt), h.barcode, h.action === 'conflict_resolved' ? 'Resolved' : 'Reported', h.productCode || '', who(ctx, h.performedBy), h.notes || '']));
  return out;
}

// Who scanned what, when, during which audit/round.
export function buildBarcodeScanHistoryRows(events, ctx) {
  const out = [['Barcode Scan History'], ['Generated', ts(new Date().toISOString())], ['Scans', events.length], [],
    ['Scanned At', 'Scanned By', 'Barcode', 'Product Code', 'Product Name', 'Scan Type', 'Result', 'Audit', 'Round']];
  events.forEach(e => out.push([ts(e.scannedAt), who(ctx, e.userId), e.barcode, e.productCode || '', e.productCode ? pname(ctx, e.productCode) : '',
    e.scanType, e.result, ctx.auditName ? ctx.auditName(e.engagementId) : (e.engagementId || ''), ctx.roundLabel ? ctx.roundLabel(e.roundId) : (e.roundId || '')]));
  return out;
}

// Comma list used by the Variance / Final Audit reports.
export function barcodeCellFor(barcodesOfProduct) {
  return (barcodesOfProduct || []).filter(b => b.status !== 'disabled').map(b => b.barcode).join(', ');
}
