import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as R from '../js/barcode/barcode-reports.js';

const ctx = { nameFor: id => ({ u1: 'Ali', u2: 'Sara' }[id] || ''), productName: c => ({ P1: 'Lays 50g', P2: 'Pringles' }[c] || ''), auditName: () => 'Oct Audit', roundLabel: () => 'Round 2' };
const rows = [
  { barcode: '5901234123457', barcodeType: 'ean13', productCode: 'P1', status: 'verified', createdBy: 'u1', verifiedBy: 'u2', createdAt: '2026-10-01T09:00:00Z', verifiedAt: '2026-10-01T10:00:00Z' },
  { barcode: '96385074', productCode: 'P2', status: 'unverified', createdBy: 'u1' },
  { barcode: '4006381333931', productCode: 'P1', status: 'conflict', conflictWithProductCode: 'P2', createdBy: 'u1' },
];
test('master report lists every barcode with names', () => {
  const out = R.buildBarcodeMasterRows(rows, ctx);
  assert.equal(out.length, 4 + rows.length);
  assert.ok(out.some(r => r.includes('Lays 50g') && r.includes('Sara')));
});
test('verification report counts and lists unverified first', () => {
  const out = R.buildBarcodeVerificationRows(rows, ctx);
  assert.deepEqual(out[2], ['Verified', 1]); assert.deepEqual(out[3], ['Unverified', 1]);
  assert.equal(out[6][3], 'UNVERIFIED');
});
test('conflict report has open conflicts and only conflict events from history', () => {
  const hist = [{ action: 'conflict_reported', barcode: 'B', performedAt: '2026-10-01T00:00:00Z', performedBy: 'u1' }, { action: 'registered', barcode: 'C', performedAt: '2026-10-02T00:00:00Z' }, { action: 'conflict_resolved', barcode: 'B', performedAt: '2026-10-03T00:00:00Z', performedBy: 'u2', notes: 'keep' }];
  const out = R.buildBarcodeConflictRows(rows, hist, ctx);
  assert.equal(out[2][1], 1);
  const events = out.filter(r => r[2] === 'Resolved' || r[2] === 'Reported');
  assert.equal(events.length, 2); assert.equal(events[0][2], 'Resolved'); // newest first
});
test('scan history report carries user, audit and round', () => {
  const out = R.buildBarcodeScanHistoryRows([{ scannedAt: '2026-10-04T08:00:00Z', userId: 'u1', barcode: '5901234123457', productCode: 'P1', scanType: 'count', result: 'matched', engagementId: 'e', roundId: 'r' }], ctx);
  const line = out[out.length - 1];
  assert.ok(line.includes('Ali') && line.includes('Oct Audit') && line.includes('Round 2') && line.includes('matched'));
});
test('report cell excludes disabled barcodes', () => {
  assert.equal(R.barcodeCellFor([{ barcode: 'A', status: 'verified' }, { barcode: 'B', status: 'disabled' }, { barcode: 'C', status: 'unverified' }]), 'A, C');
  assert.equal(R.barcodeCellFor(undefined), '');
});
