/* ══════════════════════════════════════════════════════════════
   BARCODE / barcode-zxing.js
   Software decoder for browsers WITHOUT the native BarcodeDetector
   (notably iPhone/iPad Safari). Uses ZXing (Apache-2.0, vendored in
   js/vendor/ and loaded lazily — only on devices that need it).

   decodeRGBA(), stretchLuma(), roiRect(), planPasses() are pure and
   unit-tested; the camera plumbing is a thin wrapper. Output goes
   through the SAME scan hub as every other source.

   Accuracy pipeline per frame (cheapest first, stops at first hit):
     1. centre strip (the laser box) at full camera resolution
     2. whole frame, downscaled
     3. centre strip colour-inverted (light-on-dark labels, blister foil)
   Every pass auto-stretches contrast so dim / washed-out shelves read.
   ══════════════════════════════════════════════════════════════ */

export const ZXING_SRC = './js/vendor/zxing-library.min.js';

// Fractions of the VISIBLE video area covered by the on-screen laser box
// (keep in sync with .bc-reticle in css/barcode.css).
export const ROI = { x0: 0.06, x1: 0.94, y0: 0.26, y1: 0.74 };

// Which region of the raw video frame the user actually sees, given
// object-fit:cover inside a box of boxW x boxH. Returns {x,y,w,h} in video px.
export function visibleRegion(vw, vh, boxW, boxH) {
  if (!vw || !vh || !boxW || !boxH) return { x: 0, y: 0, w: vw || 0, h: vh || 0 };
  const boxAR = boxW / boxH, vidAR = vw / vh;
  if (vidAR > boxAR) { const w = Math.round(vh * boxAR); return { x: Math.round((vw - w) / 2), y: 0, w, h: vh }; }
  const h = Math.round(vw / boxAR); return { x: 0, y: Math.round((vh - h) / 2), w: vw, h };
}

// The laser-box strip inside the visible region, in raw video pixels.
export function roiRect(vw, vh, boxW, boxH) {
  const v = visibleRegion(vw, vh, boxW, boxH);
  const x = v.x + Math.round(v.w * ROI.x0), y = v.y + Math.round(v.h * ROI.y0);
  return { x, y, w: Math.max(1, Math.round(v.w * (ROI.x1 - ROI.x0))), h: Math.max(1, Math.round(v.h * (ROI.y1 - ROI.y0))) };
}

// Rotating schedule of decode attempts so every frame is cheap but nothing is skipped for long.
export function planPasses(tick) {
  const passes = [{ region: 'roi', invert: false, maxW: 1280 }];
  if (tick % 2 === 1) passes.push({ region: 'full', invert: false, maxW: 960 });
  if (tick % 3 === 2) passes.push({ region: 'roi', invert: true, maxW: 1280 });
  return passes;
}

// In-place percentile contrast stretch (2%..98%). Skips flat frames and
// frames that already use the full range, so it can never make things worse.
export function stretchLuma(lum) {
  const n = lum.length; if (!n) return lum;
  const hist = new Uint32Array(256);
  for (let i = 0; i < n; i++) hist[lum[i]]++;
  const loT = n * 0.02, hiT = n * 0.98;
  let acc = 0, lo = 0, hi = 255;
  for (let v = 0; v < 256; v++) { acc += hist[v]; if (acc >= loT) { lo = v; break; } }
  acc = 0;
  for (let v = 0; v < 256; v++) { acc += hist[v]; if (acc >= hiT) { hi = v; break; } }
  if (hi - lo < 8 || hi - lo > 215) return lum;
  const scale = 255 / (hi - lo);
  for (let i = 0; i < n; i++) { const v = (lum[i] - lo) * scale; lum[i] = v < 0 ? 0 : v > 255 ? 255 : v; }
  return lum;
}

const readers = new WeakMap();
function getReader(ZX) {
  let r = readers.get(ZX);
  if (r) return r;
  const hints = new Map();
  hints.set(ZX.DecodeHintType.POSSIBLE_FORMATS, [
    ZX.BarcodeFormat.EAN_13, ZX.BarcodeFormat.EAN_8, ZX.BarcodeFormat.UPC_A, ZX.BarcodeFormat.UPC_E,
    ZX.BarcodeFormat.CODE_128, ZX.BarcodeFormat.CODE_39, ZX.BarcodeFormat.CODE_93, ZX.BarcodeFormat.CODABAR,
    ZX.BarcodeFormat.ITF, ZX.BarcodeFormat.DATA_MATRIX, ZX.BarcodeFormat.QR_CODE,
  ]);
  hints.set(ZX.DecodeHintType.TRY_HARDER, true);
  r = new ZX.MultiFormatReader();
  r.setHints(hints);
  readers.set(ZX, r);
  return r;
}

// RGBA pixels -> text, or null when nothing readable is in the frame.
// opts: { invert:false, stretch:true }
export function decodeRGBA(ZX, width, height, rgba, opts) {
  const o = Object.assign({ invert: false, stretch: true }, opts);
  const lum = new Uint8ClampedArray(width * height);
  for (let i = 0, j = 0; i < lum.length; i++, j += 4) {
    lum[i] = (rgba[j] * 306 + rgba[j + 1] * 601 + rgba[j + 2] * 117) >> 10; // integer luma
  }
  if (o.stretch) stretchLuma(lum);
  if (o.invert) for (let i = 0; i < lum.length; i++) lum[i] = 255 - lum[i];
  const reader = getReader(ZX);
  const bitmap = new ZX.BinaryBitmap(new ZX.HybridBinarizer(new ZX.RGBLuminanceSource(lum, width, height)));
  // decodeWithState keeps the hints set in getReader(); plain decode() would reset them.
  try { return reader.decodeWithState(bitmap).getText(); }
  catch (e) { return null; } // NotFoundException / checksum / format errors = "no barcode this frame"
}

let loading = null;
export function loadZXing() {
  if (typeof window !== 'undefined' && window.ZXing) return Promise.resolve(window.ZXing);
  if (loading) return loading;
  loading = new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = ZXING_SRC; s.async = true;
    s.onload = () => (window.ZXing ? resolve(window.ZXing) : reject(new Error('Barcode reader failed to initialise')));
    s.onerror = () => { loading = null; reject(new Error('Could not load the barcode reader — connect once to download it, or use a hardware scanner')); };
    document.head.appendChild(s);
  });
  return loading;
}

// -> async (videoEl) => string|null. Runs the rotating pass plan above.
export async function createVideoDecoder() {
  const ZX = await loadZXing();
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  let tick = 0;
  return async (video) => {
    const vw = video.videoWidth, vh = video.videoHeight;
    if (!vw || !vh) return null;
    const roi = roiRect(vw, vh, video.clientWidth, video.clientHeight);
    const passes = planPasses(tick++);
    for (const p of passes) {
      const src = p.region === 'roi' ? roi : { x: 0, y: 0, w: vw, h: vh };
      const scale = Math.min(1, p.maxW / src.w);
      const cw = Math.max(1, Math.round(src.w * scale)), ch = Math.max(1, Math.round(src.h * scale));
      canvas.width = cw; canvas.height = ch;
      ctx.drawImage(video, src.x, src.y, src.w, src.h, 0, 0, cw, ch);
      const img = ctx.getImageData(0, 0, cw, ch);
      const text = decodeRGBA(ZX, cw, ch, img.data, { invert: p.invert });
      if (text) return text;
    }
    return null;
  };
}
