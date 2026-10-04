import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import zlib from 'node:zlib';
import { decodeWasm, invertRGBA } from '../js/barcode/barcode-zxing.js';
import { BarcodeValidation as V } from '../js/barcode/barcode-validation.js';

// Load the vendored ZXing-C++ WASM exactly as the browser would (classic script + .wasm binary).
const vendor = (f) => new URL('../js/vendor/' + f, import.meta.url);
let Z;
before(async () => {
  vm.runInThisContext(fs.readFileSync(vendor('zxing-wasm-reader.iife.js'), 'utf8') + ';globalThis.ZXingWASM = ZXingWASM;');
  Z = globalThis.ZXingWASM;
  const bin = fs.readFileSync(vendor('zxing_reader.wasm'));
  await Z.prepareZXingModule({ overrides: { wasmBinary: bin.buffer.slice(bin.byteOffset, bin.byteOffset + bin.byteLength) }, fireImmediately: true });
});
const DIR = new URL('./fixtures/barcodes/', import.meta.url).pathname;
const meta = JSON.parse(fs.readFileSync(DIR + 'meta.json'));
const frame = (name, f) => {
  const m = meta[name]; const g = zlib.gunzipSync(fs.readFileSync(`${DIR}${name}.gray.gz`));
  const rgba = new Uint8ClampedArray(m.w * m.h * 4);
  for (let i = 0; i < g.length; i++) { const v = f ? f(g[i]) : g[i]; rgba[i * 4] = rgba[i * 4 + 1] = rgba[i * 4 + 2] = v; rgba[i * 4 + 3] = 255; }
  return { m, rgba };
};

for (const name of ['ean13', 'ean13_blur', 'ean8', 'code128']) {
  test(`WASM engine decodes ${name}`, async () => {
    const { m, rgba } = frame(name);
    assert.equal(await decodeWasm(Z, m.w, m.h, rgba), m.expect);
  });
}
test('WASM engine: UPC-A comes back in a form the app canonicalises to the same 13-digit key', async () => {
  const { m, rgba } = frame('upca');
  assert.equal(V.normalizeBarcode(await decodeWasm(Z, m.w, m.h, rgba)).barcode, '0036000291452');
});
test('light-on-dark label: needs (and gets) the manual invert pass', async () => {
  const { m, rgba } = frame('ean13', v => 255 - v);
  assert.equal(await decodeWasm(Z, m.w, m.h, rgba), null, 'ZXing-C++ does not self-invert EAN, hence the manual pass');
  assert.equal(await decodeWasm(Z, m.w, m.h, invertRGBA(rgba)), m.expect);
});
test('WASM engine reads a rotated (vertical) label', async () => {
  const { m, rgba } = frame('ean13');
  const rot = new Uint8ClampedArray(rgba.length); // 90° clockwise
  for (let y = 0; y < m.h; y++) for (let x = 0; x < m.w; x++) { const s = (y * m.w + x) * 4, d = (x * m.h + (m.h - 1 - y)) * 4; rot.set(rgba.subarray(s, s + 4), d); }
  assert.equal(await decodeWasm(Z, m.h, m.w, rot), m.expect);
});
test('WASM engine reads a low-contrast label', async () => {
  const { m, rgba } = frame('ean13', v => 110 + (v >> 3));
  assert.equal(await decodeWasm(Z, m.w, m.h, rgba), m.expect);
});
test('WASM engine: blank frame is null, not an error', async () => {
  assert.equal(await decodeWasm(Z, 64, 64, new Uint8ClampedArray(64 * 64 * 4).fill(255)), null);
});
