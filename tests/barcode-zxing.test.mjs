import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import zlib from 'node:zlib';
import { decodeRGBA } from '../js/barcode/barcode-zxing.js';
import { BarcodeValidation as V } from '../js/barcode/barcode-validation.js';

// Load the vendored UMD exactly as a browser does (a classic <script> that defines window.ZXing).
const sandbox = {}; sandbox.window = sandbox; sandbox.self = sandbox; sandbox.globalThis = sandbox;
vm.runInNewContext(fs.readFileSync(new URL('../js/vendor/zxing-library.min.js', import.meta.url), 'utf8'), sandbox);
const ZX = sandbox.ZXing;
const DIR = new URL('./fixtures/barcodes/', import.meta.url).pathname;
const meta = JSON.parse(fs.readFileSync(DIR + 'meta.json'));
// Fixtures are stored as gzipped 8-bit grayscale; expand to the RGBA a <canvas> would give us.
const run = (name) => {
  const m = meta[name];
  const gray = zlib.gunzipSync(fs.readFileSync(`${DIR}${name}.gray.gz`));
  const rgba = new Uint8ClampedArray(m.w * m.h * 4);
  for (let i = 0; i < gray.length; i++) { rgba[i * 4] = rgba[i * 4 + 1] = rgba[i * 4 + 2] = gray[i]; rgba[i * 4 + 3] = 255; }
  return decodeRGBA(ZX, m.w, m.h, rgba);
};

test('blank frame returns null (no barcode), not an exception', () => {
  assert.equal(decodeRGBA(ZX, 64, 64, new Uint8ClampedArray(64 * 64 * 4).fill(255)), null);
});
for (const name of ['ean13', 'ean13_blur', 'ean8', 'code128', 'upca']) {
  test(`decodes ${name} from camera-style pixels`, () => {
    const got = run(name);
    assert.ok(got, name + ' not decoded');
    assert.equal(got, meta[name].expect, name);
  });
}
test('decoded EAN-13 and UPC-A pass the app\'s own validation and canonical form', () => {
  const n = V.normalizeBarcode(run('ean13'));
  assert.equal(n.ok, true); assert.equal(n.barcode, '5901234123457');
  assert.equal(V.normalizeBarcode(run('upca')).barcode, '0036000291452');
});

import { roiRect, visibleRegion, planPasses, stretchLuma } from '../js/barcode/barcode-zxing.js';
const rgbaOf = (name, f) => {
  const m = meta[name]; const gray = zlib.gunzipSync(fs.readFileSync(`${DIR}${name}.gray.gz`));
  const rgba = new Uint8ClampedArray(m.w * m.h * 4);
  for (let i = 0; i < gray.length; i++) { const v = f ? f(gray[i]) : gray[i]; rgba[i * 4] = rgba[i * 4 + 1] = rgba[i * 4 + 2] = v; rgba[i * 4 + 3] = 255; }
  return { m, rgba };
};
test('inverted (light-on-dark) label decodes with the invert pass', () => {
  const { m, rgba } = rgbaOf('ean13', v => 255 - v);
  assert.equal(decodeRGBA(ZX, m.w, m.h, rgba, { invert: true }), m.expect);
});
test('low-contrast / washed-out label decodes thanks to contrast stretch', () => {
  const { m, rgba } = rgbaOf('ean13', v => 110 + (v >> 3)); // squeezed into ~110..141
  assert.equal(decodeRGBA(ZX, m.w, m.h, rgba), m.expect);
});
test('stretchLuma leaves flat frames alone', () => {
  const a = new Uint8ClampedArray(100).fill(120); stretchLuma(a); assert.ok(a.every(v => v === 120));
});
test('laser-box region maps onto the visible (object-fit:cover) part of the frame', () => {
  const v = visibleRegion(1920, 1080, 400, 300); // 4:3 box over 16:9 video
  assert.deepEqual(v, { x: 240, y: 0, w: 1440, h: 1080 });
  const r = roiRect(1920, 1080, 400, 300);
  assert.ok(r.x >= v.x && r.x + r.w <= v.x + v.w && r.y >= 0 && r.y + r.h <= 1080);
});
test('pass plan: strip every tick, full frame and inverted on rotating ticks', () => {
  assert.equal(planPasses(0).length, 1);
  assert.ok(planPasses(1).some(p => p.region === 'full'));
  assert.ok(planPasses(2).some(p => p.invert));
});
