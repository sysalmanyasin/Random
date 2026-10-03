import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BarcodeValidation as V } from '../js/barcode/barcode-validation.js';

test('valid EAN-13 accepted as-is', () => {
  const r = V.normalizeBarcode('5901234123457');
  assert.deepEqual([r.ok, r.barcode, r.type], [true, '5901234123457', 'ean13']);
});
test('bad check digit rejected', () => {
  assert.equal(V.normalizeBarcode('5901234123458').reason, 'bad_checksum');
});
test('UPC-A is canonicalised to EAN-13 so it cannot be registered twice', () => {
  const r = V.normalizeBarcode('036000291452');
  assert.equal(r.barcode, '0036000291452');
});
test('EAN-8 accepted', () => {
  assert.equal(V.normalizeBarcode('96385074').type, 'ean8');
});
test('wrong length digits rejected', () => {
  assert.equal(V.normalizeBarcode('12345').reason, 'bad_length');
});
test('GS1 element string yields the GTIN, ignoring lot/expiry', () => {
  const r = V.normalizeBarcode('0105901234123457' + '17261231' + '10LOT42');
  assert.equal(r.barcode, '5901234123457');
});
test('whitespace/control chars from scanners are stripped', () => {
  assert.equal(V.normalizeBarcode(' 5901234123457\r\n').barcode, '5901234123457');
});
test('internal alphanumeric labels upper-cased and DB-format safe', () => {
  const r = V.normalizeBarcode('fd-0042');
  assert.deepEqual([r.ok, r.barcode], [true, 'FD-0042']);
  assert.ok(V.DB_FORMAT.test(r.barcode));
});
test('empty and junk rejected', () => {
  assert.equal(V.normalizeBarcode('').ok, false);
  assert.equal(V.normalizeBarcode('a b!').ok, false);
  assert.equal(V.normalizeBarcode(null).ok, false);
});
