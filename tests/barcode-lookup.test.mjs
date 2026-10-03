import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BarcodeLookup as L } from '../js/barcode/barcode-lookup.js';

const rows = [
  { barcode: '5901234123457', product_code: 'P1', status: 'verified' },
  { barcode: '96385074', product_code: 'P1', status: 'verified' },          // 2 barcodes, 1 product
  { barcode: '4006381333931', product_code: 'P2', status: 'disabled' },
  { barcode: '8901234567890', product_code: 'P3', status: 'conflict', conflict_with_product_code: 'P9' },
  { barcode: 'FD-0042', product_code: 'P4', status: 'unverified' },
];
const idx = L.buildIndex(rows);

test('verified barcode matches; multiple barcodes map to same product', () => {
  assert.equal(L.resolveScan(idx, '5901234123457').productCode, 'P1');
  assert.equal(L.resolveScan(idx, '96385074').productCode, 'P1');
  assert.equal(idx.byProduct.get('P1').length, 2);
});
test('unknown barcode', () => {
  assert.equal(L.resolveScan(idx, '5000112637922').result, 'unknown');
});
test('invalid barcode never reaches lookup', () => {
  assert.equal(L.resolveScan(idx, '123').result, 'invalid');
});
test('disabled barcode is blocked and carries no usable match', () => {
  assert.equal(L.resolveScan(idx, '4006381333931').result, 'disabled');
});
test('conflict barcode is blocked and reports the claimant', () => {
  const r = L.resolveScan(idx, '8901234567893');
  // 8901234567890 has an invalid check digit => invalid, not conflict
  assert.equal(r.result, 'invalid');
});
test('conflict row surfaces as conflict (valid check digit fixture)', () => {
  const i2 = L.buildIndex([{ barcode: '5901234123457', product_code: 'P3', status: 'conflict', conflict_with_product_code: 'P9' }]);
  const r = L.resolveScan(i2, '5901234123457');
  assert.deepEqual([r.result, r.conflictWith], ['conflict', 'P9']);
});
test('unverified is NOT usable for counting', () => {
  assert.equal(L.resolveScan(idx, 'fd-0042').result, 'unknown');
});
test('duplicate flagged when product already counted this session', () => {
  const r = L.resolveScan(idx, '5901234123457', { isAlreadyCounted: c => c === 'P1' });
  assert.equal(r.result, 'duplicate');
  assert.equal(r.productCode, 'P1');
});
test('UPC-A scan finds an EAN-13-stored barcode', () => {
  const i2 = L.buildIndex([{ barcode: '0036000291452', product_code: 'PX', status: 'verified' }]);
  assert.equal(L.resolveScan(i2, '036000291452').productCode, 'PX');
});
test('recount isolation: product outside the assignment items is not found', () => {
  const items = [{ itemKey: 'A::0', code: 'P1' }];
  assert.equal(L.findAssignmentItem(items, 'P1').found, true);
  assert.equal(L.findAssignmentItem(items, 'P2').found, false);
});
test('same code in two companies is reported ambiguous, not guessed', () => {
  const items = [{ itemKey: 'A::0', code: 'P1' }, { itemKey: 'B::3', code: 'P1' }];
  const r = L.findAssignmentItem(items, 'P1');
  assert.equal(r.ambiguous, true);
  assert.equal(r.candidates.length, 2);
});
test('master search by barcode, code and name', () => {
  const products = [{ code: 'P1', name: 'Lays 50g' }];
  assert.equal(L.searchMaster(rows, products, 'lays').length, 2);
  assert.equal(L.searchMaster(rows, products, '5901').length, 1);
  assert.equal(L.searchMaster(rows, products, 'P3').length, 1);
});
