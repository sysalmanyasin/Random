/* ══════════════════════════════════════════════════════════════
   BARCODE / barcode-quality.js
   Pure frame-quality maths + the "why won't it scan?" guidance
   state machine. No DOM, no camera — the scanner adapter feeds it
   small grayscale thumbnails and shows whatever message it returns.
   ══════════════════════════════════════════════════════════════ */

// gray: Uint8 luminance, w x h -> { mean, std, sharp }
// sharp = Laplacian variance normalised by contrast, so a low-contrast
// but crisp label isn't mistaken for a blurry one.
export function analyzeGray(gray, w, h) {
  const n = w * h;
  if (!n || gray.length < n) return { mean: 0, std: 0, sharp: 0 };
  let sum = 0;
  for (let i = 0; i < n; i++) sum += gray[i];
  const mean = sum / n;
  let varSum = 0;
  for (let i = 0; i < n; i++) { const d = gray[i] - mean; varSum += d * d; }
  const variance = varSum / n;
  let lap = 0, lapSq = 0, cnt = 0;
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      const l = 4 * gray[i] - gray[i - 1] - gray[i + 1] - gray[i - w] - gray[i + w];
      lap += l; lapSq += l * l; cnt++;
    }
  }
  const lapVar = cnt ? lapSq / cnt - (lap / cnt) * (lap / cnt) : 0;
  return { mean, std: Math.sqrt(variance), sharp: lapVar / (variance + 1) };
}

// RGBA -> gray (integer luma), for the thumbnail the adapter grabs from <canvas>.
export function rgbaToGray(rgba, w, h) {
  const g = new Uint8Array(w * h);
  for (let i = 0, j = 0; i < g.length; i++, j += 4) g[i] = (rgba[j] * 306 + rgba[j + 1] * 601 + rgba[j + 2] * 117) >> 10;
  return g;
}

// Guidance only appears after the camera has failed to read for a while,
// so a normal quick scan never sees a message.
//   feed(stats, msSinceLastRead) -> { message, kind, wantTorch }
export function createGuide(opts) {
  const o = Object.assign({ darkMean: 45, brightMean: 225, lowStd: 14, blurRatio: 0.45, minPeak: 0.02, quietMs: 1800, darkQuietMs: 800, darkFramesForTorch: 3 }, opts);
  let peak = 0, darkRun = 0;
  return {
    feed(stats, msSinceRead) {
      const s = stats || { mean: 128, std: 60, sharp: 0 };
      peak = Math.max(peak * 0.995, s.sharp); // slowly forgets, so it adapts to the label
      darkRun = s.mean < o.darkMean ? darkRun + 1 : 0;
      const out = { message: '', kind: 'ok', wantTorch: darkRun >= o.darkFramesForTorch };
      if (s.mean < o.darkMean && msSinceRead >= o.darkQuietMs) { out.message = 'Too dark — turn on the torch'; out.kind = 'dark'; return out; }
      if (msSinceRead < o.quietMs) return out;
      if (s.mean > o.brightMean) { out.message = 'Glare — tilt the pack slightly'; out.kind = 'glare'; return out; }
      if (peak > o.minPeak && s.sharp < peak * o.blurRatio) { out.message = 'Hold steady — move back a little to focus'; out.kind = 'blur'; return out; }
      if (s.std < o.lowStd) { out.message = 'Low contrast — change the angle or light'; out.kind = 'contrast'; return out; }
      out.message = 'Keep the barcode inside the box'; out.kind = 'hint';
      return out;
    },
    reset() { peak = 0; darkRun = 0; },
  };
}
