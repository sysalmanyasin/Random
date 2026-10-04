/* ══════════════════════════════════════════════════════════════
   BARCODE / barcode-zxing.js
   Software decoder for browsers WITHOUT the native BarcodeDetector
   (notably iPhone/iPad Safari). Uses ZXing (Apache-2.0, vendored in
   js/vendor/ and loaded lazily — only on devices that need it).

   decodeRGBA() is pure and unit-tested; the camera plumbing is a thin
   wrapper. Output goes through the SAME scan hub as every other source.
   ══════════════════════════════════════════════════════════════ */

export const ZXING_SRC = './js/vendor/zxing-library.min.js';

// RGBA pixels -> text, or null when nothing readable is in the frame.
export function decodeRGBA(ZX, width, height, rgba) {
  const lum = new Uint8ClampedArray(width * height);
  for (let i = 0, j = 0; i < lum.length; i++, j += 4) {
    lum[i] = (rgba[j] * 306 + rgba[j + 1] * 601 + rgba[j + 2] * 117) >> 10; // integer luma
  }
  const hints = new Map();
  hints.set(ZX.DecodeHintType.POSSIBLE_FORMATS, [
    ZX.BarcodeFormat.EAN_13, ZX.BarcodeFormat.EAN_8, ZX.BarcodeFormat.UPC_A, ZX.BarcodeFormat.UPC_E,
    ZX.BarcodeFormat.CODE_128, ZX.BarcodeFormat.CODE_39, ZX.BarcodeFormat.ITF, ZX.BarcodeFormat.DATA_MATRIX,
  ]);
  hints.set(ZX.DecodeHintType.TRY_HARDER, true);
  const reader = new ZX.MultiFormatReader();
  reader.setHints(hints);
  const bitmap = new ZX.BinaryBitmap(new ZX.HybridBinarizer(new ZX.RGBLuminanceSource(lum, width, height)));
  try { return reader.decode(bitmap).getText(); }
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

// -> async (videoEl) => string|null  (downscales frames so phones stay fast)
export async function createVideoDecoder() {
  const ZX = await loadZXing();
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  const MAX_W = 800;
  return async (video) => {
    const vw = video.videoWidth, vh = video.videoHeight;
    if (!vw || !vh) return null;
    const scale = Math.min(1, MAX_W / vw);
    canvas.width = Math.round(vw * scale); canvas.height = Math.round(vh * scale);
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
    return decodeRGBA(ZX, canvas.width, canvas.height, img.data);
  };
}
