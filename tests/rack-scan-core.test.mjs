import { test } from 'node:test';
import assert from 'node:assert/strict';
import { RackCore as R } from '../js/rack/rack-scan-core.js';

const P = { code: 'P1', name: 'Panadol 500mg', company: 'GSK', qty: 10, price: 50 };
const Q = { code: 'P2', name: 'Augmentin 625', company: 'GSK', qty: 4, price: 300 };

test('match: counted equals system', () => {
  const i = R.buildItem({ product: P, barcode: '111', counted: 10, entryMode: 'counted' });
  assert.equal(i.result, 'match'); assert.equal(i.diff, 0); assert.equal(i.varianceValue, 0);
});
test('shortage and excess carry sign and rupee value', () => {
  const s = R.buildItem({ product: P, barcode: '111', counted: 7, entryMode: 'counted' });
  assert.equal(s.result, 'variance'); assert.equal(s.diff, -3); assert.equal(s.varianceValue, -150);
  const e = R.buildItem({ product: Q, barcode: '222', counted: 6, entryMode: 'counted' });
  assert.equal(e.diff, 2); assert.equal(e.varianceValue, 600);
});
test('not in system is logged with zero system qty, never dropped', () => {
  const i = R.buildItem({ product: null, barcode: '999', counted: 3, entryMode: 'counted' });
  assert.equal(i.result, 'not_in_system'); assert.equal(i.productCode, null); assert.equal(i.key, 'b:999');
});
test('same product always maps to one key (barcode does not matter)', () => {
  assert.equal(R.itemKey(P, '111'), R.itemKey(P, '222'));
});
test('duplicate scan: add vs replace', () => {
  assert.equal(R.mergeCount(4, 3, 'add'), 7);
  assert.equal(R.mergeCount(4, 3, 'replace'), 3);
});
test('recount keeps flag and marks recounted; replace corrects variance', () => {
  const first = R.buildItem({ product: P, barcode: '111', counted: 7, entryMode: 'counted' });
  first.flagged = true;
  const again = R.buildItem({ product: P, barcode: '111', counted: 10, entryMode: 'counted', previous: { ...first, recounted: true } });
  assert.equal(again.result, 'match'); assert.equal(again.flagged, true); assert.equal(again.recounted, true);
});
test('summary separates typed counts from ✓ taps and values', () => {
  const items = [
    R.buildItem({ product: P, barcode: '1', counted: 10, entryMode: 'matched_tap' }),
    R.buildItem({ product: Q, barcode: '2', counted: 6, entryMode: 'counted' }),
    R.buildItem({ product: { code: 'P3', name: 'X', qty: 5, price: 10 }, barcode: '3', counted: 2, entryMode: 'counted' }),
    R.buildItem({ product: null, barcode: '9', counted: 1, entryMode: 'counted' }),
  ];
  const s = R.summarize(items);
  assert.equal(s.checked, 4); assert.equal(s.matched, 1); assert.equal(s.variance, 2); assert.equal(s.notInSystem, 1);
  assert.equal(s.tapped, 1); assert.equal(s.typed, 3);
  assert.equal(s.excessValue, 600); assert.equal(s.shortValue, -30); assert.equal(s.netValue, 570);
  assert.equal(s.accuracy, 33.3);   // 1 of 3 items that exist in the system
});
test('db row never sends generated columns', () => {
  const row = R.toDbRow(R.buildItem({ product: P, barcode: '1', counted: 9, entryMode: 'counted' }), 'sess-1');
  assert.equal('diff' in row, false); assert.equal('variance_value' in row, false);
  assert.equal(row.session_id, 'sess-1'); assert.equal(row.client_event_id, 'p:P1'); assert.equal(row.entry_mode, 'counted');
});
test('export has Summary + Items sheets', () => {
  const sheets = R.exportRows([R.buildItem({ product: P, barcode: '1', counted: 9, entryMode: 'counted' })], { label: 'Rack 3' });
  assert.deepEqual(Object.keys(sheets), ['Summary', 'Items']);
  assert.equal(sheets.Items.length, 2);
});
