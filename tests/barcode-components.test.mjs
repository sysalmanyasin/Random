import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as C from '../js/components/barcode-components.js';

const row = { barcode: '5901234123457', productCode: 'P1', productName: 'Lays 50g', status: 'verified', verifiedByName: 'Ali', verifiedAt: '2026-10-01T10:00:00Z', createdBy: 'u1', createdAt: '2026-10-01T09:00:00Z', barcodeType: 'ean13' };
const p = { code: 'P1', name: 'Lays 50g', company: 'PepsiCo' };

test('every scan result state renders and names its state', () => {
  const opts = { canRegister: true, canAdminister: true };
  const states = {
    matched: { result: 'matched', barcode: row.barcode, productCode: 'P1', product: p },
    duplicate: { result: 'duplicate', barcode: row.barcode, productCode: 'P1', product: p },
    unknown: { result: 'unknown', barcode: row.barcode },
    conflict: { result: 'conflict', barcode: row.barcode, productCode: 'P1', product: p, conflictWith: 'P2', claimant: null },
    disabled: { result: 'disabled', barcode: row.barcode },
    invalid: { result: 'invalid', message: 'Barcode check digit is wrong — rescan' },
  };
  const expect = { matched: 'MATCHED', duplicate: 'DUPLICATE', unknown: 'UNKNOWN BARCODE', conflict: 'CONFLICT', disabled: 'DISABLED', invalid: 'INVALID' };
  for (const [k, r] of Object.entries(states)) assert.ok(C.barcodeResultCardHTML(r, opts).includes(expect[k]), k);
});

test('unknown barcode: Sub gets no register buttons, Deputy/Main do', () => {
  const r = { result: 'unknown', barcode: row.barcode };
  assert.ok(!C.barcodeResultCardHTML(r, { canRegister: false }).includes('barcode-unknown-register'));
  assert.ok(C.barcodeResultCardHTML(r, { canRegister: true }).includes('barcode-unknown-register'));
});

test('HTML-escaping: hostile product/barcode text cannot inject markup', () => {
  const evil = { ...row, productName: '<img src=x onerror=alert(1)>', barcode: '"><script>1</script>' };
  const html = C.barcodeMasterRowHTML(evil);
  assert.ok(!html.includes('<img') && !html.includes('<script'));
});

test('subnav: Sub sees no Register/Queue; Deputy/Main do; conflict count shown', () => {
  assert.ok(!C.barcodeSubnavHTML({ view: 'scan', canRegister: false, conflictCount: 0 }).includes('barcode-set-subview" data-subview="register"'));
  const html = C.barcodeSubnavHTML({ view: 'scan', canRegister: true, conflictCount: 2, unverifiedCount: 1 });
  assert.ok(html.includes('data-subview="register"') && html.includes('Conflicts (2)') && html.includes('Queue (1)'));
});

test('conflict screen: only Main gets resolve buttons; reason input required', () => {
  const c = { barcode: row.barcode, productCode: 'P1', conflictWithProductCode: 'P2' };
  const nameOf = x => x;
  assert.ok(!C.barcodeConflictsHTML({ rows: [c], canAdminister: false, nameOf }).includes('barcode-resolve'));
  const main = C.barcodeConflictsHTML({ rows: [c], canAdminister: true, nameOf });
  assert.ok(main.includes('data-resolution="keep"') && main.includes('data-resolution="reassign"') && main.includes('data-resolution="disable"') && main.includes('bc-conflict-reason'));
});

test('register flow: shows Verify & Save only for a new barcode; blocks other-product barcodes', () => {
  const base = { picked: p, query: '', results: [], scannerHTML: '', saving: false };
  assert.ok(C.barcodeRegisterHTML({ ...base, detected: row.barcode, detectedState: { kind: 'new' } }).includes('barcode-register-save'));
  assert.ok(C.barcodeRegisterHTML({ ...base, detected: row.barcode, detectedState: { kind: 'new' }, fromUnknown: true }).includes('VERIFY &amp; LINK'));
  const other = C.barcodeRegisterHTML({ ...base, detected: row.barcode, detectedState: { kind: 'other', otherCode: 'P2', otherName: 'Pringles' } });
  assert.ok(!other.includes('barcode-register-save') && other.includes('barcode-register-report-conflict'));
  assert.ok(!C.barcodeRegisterHTML({ ...base, picked: null }).includes('barcode-register-save'));
});

test('master list, detail, queue, history, status bar render', () => {
  assert.ok(C.barcodeMasterHTML({ rows: [row], query: '', status: '', cap: 150 }).includes('Lays 50g'));
  const detail = C.barcodeDetailHTML({ row, productName: 'Lays 50g', history: [{ action: 'conflict_resolved', performedBy: 'u1', performedAt: row.createdAt, notes: 'ok' }], nameFor: () => 'Ali', canRegister: true, canAdminister: true });
  assert.ok(detail.includes('conflict resolved') && detail.includes('barcode-disable-start'));
  assert.ok(C.barcodeQueueHTML({ rows: [] }).includes('Nothing waiting'));
  assert.ok(C.barcodeScanHistoryHTML({ events: [{ barcode: row.barcode, productCode: 'P1', scanType: 'count', result: 'matched', userId: 'u1', scannedAt: row.createdAt }], nameFor: () => 'Ali', productName: () => 'Lays 50g' }).includes('matched'));
  const off = C.barcodeStatusBarHTML({ online: false, syncing: false, pending: 3, size: 120 });
  assert.ok(off.includes('Offline') && off.includes('3 waiting'));
  assert.ok(C.barcodeStatusBarHTML({ online: true, syncing: true, pending: 0, size: 1 }).includes('Syncing'));
});
