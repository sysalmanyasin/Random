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

test('counting overlay: count state shows system qty, physical input and CONFIRM wired to the item', () => {
  const html = C.countingOverlayHTML({ state: 'count', item: { itemKey: 'A::3', name: 'Lays 50g', code: 'P1', company: 'PepsiCo', qty: 24 }, counted: 3, total: 40, recount: false, duplicate: false, current: undefined });
  assert.ok(html.includes('System Qty') && html.includes('24') && html.includes('bc-count-qty'));
  assert.ok(html.includes('barcode-count-confirm') && html.includes('data-item-key="A::3"'));
  assert.ok(html.includes('3 / 40'));
});
test('counting overlay: duplicate warns and pre-fills existing count; recount is labelled', () => {
  const html = C.countingOverlayHTML({ state: 'count', item: { itemKey: 'k', name: 'X', qty: 5 }, counted: 1, total: 2, recount: true, duplicate: true, current: 7 });
  assert.ok(html.includes('ALREADY COUNTED') && html.includes('value="7"') && html.includes('Recount scan'));
});
test('counting overlay: same code under two companies asks which one', () => {
  const html = C.countingOverlayHTML({ state: 'choose', name: 'Panadol', candidates: [{ itemKey: 'a', company: 'GSK', qty: 1 }, { itemKey: 'b', company: 'Haleon', qty: 2 }], counted: 0, total: 2 });
  assert.ok(html.includes('barcode-count-pick') && html.includes('GSK') && html.includes('Haleon'));
});
test('scan bar: hidden for Manual and when submitted; shown for Barcode and Hybrid', () => {
  assert.equal(C.countingScanBarHTML('manual', false), '');
  assert.equal(C.countingScanBarHTML('hybrid', true), '');
  assert.ok(C.countingScanBarHTML('barcode', false).includes('barcode-count-open'));
  assert.ok(C.countingScanBarHTML('hybrid', false).includes('barcode-count-open'));
});
test('counting method card marks the current choice and offers all three', () => {
  const html = C.countingMethodCardHTML({ id: 'e1', countingMethod: 'barcode' });
  assert.ok(/value="barcode" checked/.test(html) && html.includes('value="manual"') && html.includes('value="hybrid"'));
  assert.ok(/value="hybrid" checked/.test(C.countingMethodCardHTML({ id: 'e1' })), 'hybrid is the default');
});

test('REGRESSION: scanner box has real action names (no unrendered ${...} placeholders)', () => {
  for (const camPrefix of [undefined, 'barcode', 'barcode-count']) {
    const idle = C.barcodeScannerBoxHTML({ cameraOn: false, cameraSupported: true, camPrefix });
    const on = C.barcodeScannerBoxHTML({ cameraOn: true, cameraSupported: true, camPrefix });
    const pre = camPrefix || 'barcode';
    assert.ok(idle.includes(`data-action="${pre}-camera-start"`), 'start: ' + camPrefix);
    assert.ok(on.includes(`data-action="${pre}-camera-stop"`), 'stop: ' + camPrefix);
    assert.ok(!idle.includes('${') && !on.includes('${'), 'unrendered placeholder in HTML');
  }
});
test('every data-action emitted by every screen is a real, rendered name', () => {
  const p = { code: 'P1', name: 'Lays', company: 'C' };
  const row = { barcode: '5901234123457', productCode: 'P1', productName: 'Lays', status: 'conflict', conflictWithProductCode: 'P2' };
  const all = [
    C.barcodeSubnavHTML({ view: 'scan', canRegister: true, conflictCount: 1, unverifiedCount: 1 }),
    C.barcodeStatusBarHTML({ online: true, syncing: false, pending: 2, size: 3 }),
    C.barcodeScannerBoxHTML({ cameraOn: true, cameraSupported: true }),
    C.barcodeResultCardHTML({ result: 'unknown', barcode: row.barcode }, { canRegister: true }),
    C.barcodeRegisterHTML({ picked: p, query: '', results: [p], detected: row.barcode, detectedState: { kind: 'new' }, scannerHTML: '' }),
    C.barcodeMasterHTML({ rows: [row], query: '', status: '', cap: 5 }),
    C.barcodeConflictsHTML({ rows: [row], canAdminister: true, nameOf: x => x }),
    C.barcodeReportsHTML(), C.barcodeReasonPromptHTML({ title: 't', confirmAction: 'x', barcode: 'b' }),
    C.countingOverlayHTML({ state: 'count', item: { itemKey: 'k', name: 'n', qty: 1 }, counted: 0, total: 1 }),
    C.countingMethodCardHTML({ id: 'e' }),
  ].join('\n');
  assert.ok(!all.includes('${'), 'unrendered ${ found in generated HTML');
  assert.ok(!all.includes('undefined') && !all.includes('[object Object]'));
});

test('product picker results show retail price and stock', async () => {
  const { barcodeProductResultsHTML, barcodeProductPickerHTML } = await import('../js/components/barcode-components.js');
  const html = barcodeProductResultsHTML([
    { code: 'A1', name: 'In Stock', company: 'Co', price: 1250.5, qty: 12 },
    { code: 'A2', name: 'Out', company: 'Co', price: 90, qty: 0 },
    { code: 'A3', name: 'No data', company: 'Co' },
  ], 'barcode-register-pick');
  assert.match(html, /Rs 1,250\.5/);
  assert.match(html, /Stock: 12/);
  assert.match(html, /bc-pill--bad">Stock: 0/);
  assert.match(html, /Rs —/);
  assert.match(html, /Stock: —/);
  const picked = barcodeProductPickerHTML({ picked: { code: 'A1', name: 'In Stock', company: 'Co', price: 50, qty: 3 }, clearAction: 'x' });
  assert.match(picked, /Rs 50/);
  assert.match(picked, /Stock: 3/);
});
