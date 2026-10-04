import { test } from 'node:test';
import assert from 'node:assert/strict';
import { analyzeGray, createGuide } from '../js/barcode/barcode-quality.js';

const bars = (w, h, period, blur) => {
  const g = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) g[y * w + x] = Math.floor(x / period) % 2 ? 30 : 220;
  if (!blur) return g;
  // box blur x3 to simulate an out-of-focus frame
  let cur = g;
  for (let k = 0; k < 3; k++) { const nx = new Uint8Array(g.length); for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { let s = 0, c = 0; for (let d = -2; d <= 2; d++) { const xx = x + d; if (xx >= 0 && xx < w) { s += cur[y * w + xx]; c++; } } nx[y * w + x] = s / c; } cur = nx; }
  return cur;
};

test('sharp bars score higher than the same bars blurred', () => {
  const sharp = analyzeGray(bars(96, 32, 3, false), 96, 32).sharp;
  const soft = analyzeGray(bars(96, 32, 3, true), 96, 32).sharp;
  assert.ok(sharp > soft * 2, `sharp ${sharp} vs blurred ${soft}`);
});
test('brightness and contrast are measured', () => {
  const dark = analyzeGray(new Uint8Array(100).fill(20), 10, 10);
  assert.ok(dark.mean < 25 && dark.std === 0);
});
test('guide is silent during a normal quick scan, then speaks after the quiet period', () => {
  const g = createGuide();
  const ok = { mean: 120, std: 60, sharp: 1 };
  assert.equal(g.feed(ok, 300).message, '');
  assert.match(g.feed(ok, 2500).message, /inside the box/i);
});
test('guide: dark frames ask for torch fast and request auto-torch after a few frames', () => {
  const g = createGuide(); const dark = { mean: 20, std: 10, sharp: 0.5 };
  assert.match(g.feed(dark, 900).message, /dark/i);
  g.feed(dark, 900);
  assert.equal(g.feed(dark, 900).wantTorch, true);
  assert.equal(createGuide().feed({ mean: 120, std: 60, sharp: 1 }, 5000).wantTorch, false);
});
test('guide: a frame much blurrier than the recent best says hold steady; glare is reported', () => {
  const g = createGuide();
  g.feed({ mean: 120, std: 60, sharp: 1 }, 0);
  assert.match(g.feed({ mean: 120, std: 60, sharp: 0.2 }, 2500).message, /hold steady/i);
  assert.match(createGuide().feed({ mean: 240, std: 30, sharp: 1 }, 2500).message, /glare/i);
});
