/* ══════════════════════════════════════════════════════════════
   BARCODE / barcode-scanner.js
   ONE scanner abstraction. Camera and USB/Bluetooth keyboard-wedge
   scanners are just two *sources*; both call the same emit(), which
   de-bounces and hands the raw string to the single registered handler
   (the barcode service). No counting logic lives here.

   Pure/testable parts: createScanHub, createWedgeDetector.
   Browser-only parts (camera, DOM key listener) are thin adapters.
   ══════════════════════════════════════════════════════════════ */

// Same code repeated inside this window is treated as one physical scan
// (a camera sees the same label on many frames).
const DEFAULT_DEBOUNCE_MS = 1500;

function createScanHub(opts) {
  const o = Object.assign({ debounceMs: DEFAULT_DEBOUNCE_MS, now: () => Date.now() }, opts);
  let handler = null;
  let paused = false;
  const last = new Map(); // raw -> ts
  return {
    onScan(fn) { handler = fn; },
    pause() { paused = true; },
    resume() { paused = false; last.clear(); },
    isPaused() { return paused; },
    // returns true if forwarded
    emit(raw, source) {
      const code = String(raw || '').trim();
      if (!code || paused || !handler) return false;
      const t = o.now();
      const prev = last.get(code);
      if (prev !== undefined && t - prev < o.debounceMs) return false;
      last.set(code, t);
      handler({ raw: code, source: source || 'unknown', ts: t });
      return true;
    },
  };
}

// Keyboard-wedge scanners type digits very fast then press Enter.
// Humans don't. Detect by inter-key gap; never swallow normal typing.
// feed(key, ts, inEditableField) -> {action:'pass'|'buffer'|'scan', value?}
function createWedgeDetector(opts) {
  const o = Object.assign({ maxGapMs: 35, minLength: 4, resetMs: 120 }, opts);
  let buf = '';
  let lastTs = 0;
  let rapid = 0;
  return {
    feed(key, ts) {
      const gap = lastTs ? ts - lastTs : Infinity;
      lastTs = ts;
      if (key === 'Enter' || key === 'Tab') {
        const isScan = buf.length >= o.minLength && rapid >= o.minLength - 1;
        const value = buf; buf = ''; rapid = 0;
        return isScan ? { action: 'scan', value } : { action: 'pass' };
      }
      if (key.length !== 1) return { action: 'pass' };
      if (gap > o.resetMs) { buf = ''; rapid = 0; }
      buf += key;
      if (gap <= o.maxGapMs) rapid++;
      // Characters 2+ of a scan arrive fast; the first one is indistinguishable
      // from typing, so the adapter lets it through and removes it on 'scan'.
      return { action: 'buffer' };
    },
    reset() { buf = ''; rapid = 0; lastTs = 0; },
  };
}

// ── Browser adapters ──────────────────────────────────────────
function attachWedge(hub, doc) {
  const d = doc || document;
  const det = createWedgeDetector();
  const onKey = (e) => {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    const r = det.feed(e.key, e.timeStamp || Date.now());
    if (r.action === 'scan') {
      e.preventDefault(); // don't let Enter submit a form / move focus
      const t = e.target;
      // The first (slow) char leaked into a focused text field — remove it.
      if (t && 'value' in t && typeof t.value === 'string' && t.value.endsWith(r.value[0]) ) {
        t.value = t.value.slice(0, t.value.length - r.value.length);
        if (t.value.endsWith(r.value[0]) && r.value.length === 1) t.value = t.value.slice(0, -1);
      }
      hub.emit(r.value, 'hardware');
    }
  };
  d.addEventListener('keydown', onKey, true);
  return () => d.removeEventListener('keydown', onKey, true);
}

function cameraSupported() {
  return typeof navigator !== 'undefined' && !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia);
}
function nativeDetectorSupported() {
  return typeof window !== 'undefined' && 'BarcodeDetector' in window;
}

// Starts the rear camera into <video>; resolves {stop}. Uses the native
// BarcodeDetector where it exists (Chrome/Android). Where it doesn't
// (iOS Safari), a fallback decoder must be supplied via opts.fallbackDecode
// (async (video) => string|null) — see README note; none is bundled.
async function startCamera(hub, videoEl, opts) {
  const o = opts || {};
  if (!cameraSupported()) throw new Error('Camera not available on this device/browser');
  const stream = await navigator.mediaDevices.getUserMedia({
    video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } }, audio: false,
  });
  videoEl.srcObject = stream;
  videoEl.setAttribute('playsinline', 'true');
  await videoEl.play();

  let detector = null;
  if (nativeDetectorSupported()) {
    detector = new window.BarcodeDetector({ formats: ['ean_13', 'ean_8', 'upc_a', 'upc_e', 'code_128', 'code_39', 'itf', 'data_matrix', 'qr_code'] });
  }
  const decode = detector
    ? async () => { const r = await detector.detect(videoEl); return r && r[0] ? r[0].rawValue : null; }
    : o.fallbackDecode ? () => o.fallbackDecode(videoEl) : null;
  if (!decode) { stream.getTracks().forEach(t => t.stop()); throw new Error('This browser has no built-in barcode detection. Use a hardware scanner or Chrome on Android.'); }

  let stopped = false;
  let busy = false;
  const timer = setInterval(async () => {
    if (stopped || busy || hub.isPaused() || videoEl.readyState < 2) return;
    busy = true;
    try { const v = await decode(); if (v) hub.emit(v, 'camera'); } catch (_) { /* transient frame error */ }
    busy = false;
  }, 150);
  return {
    stop() { stopped = true; clearInterval(timer); stream.getTracks().forEach(t => t.stop()); videoEl.srcObject = null; },
  };
}

// Vibration / beep feedback, best-effort.
function feedback(kind) {
  try {
    if (navigator.vibrate) navigator.vibrate(kind === 'matched' || kind === 'saved' ? 40 : [80, 40, 80]);
  } catch (_) {}
  try {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return;
    const ctx = feedback._ctx || (feedback._ctx = new Ctx());
    const osc = ctx.createOscillator(); const g = ctx.createGain();
    osc.frequency.value = (kind === 'matched' || kind === 'saved') ? 1000 : 300;
    g.gain.value = 0.08; osc.connect(g); g.connect(ctx.destination);
    osc.start(); osc.stop(ctx.currentTime + 0.12);
  } catch (_) {}
}

export const BarcodeScanner = {
  createScanHub, createWedgeDetector, attachWedge, startCamera,
  cameraSupported, nativeDetectorSupported, feedback,
};
