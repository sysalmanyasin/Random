/* ══════════════════════════════════════════════════════════════
   BARCODE / barcode-scanner.js
   ONE scanner abstraction. Camera and USB/Bluetooth keyboard-wedge
   scanners are just two *sources*; both call the same emit(), which
   de-bounces and hands the raw string to the single registered handler
   (the barcode service). No counting logic lives here.

   Pure/testable parts: createScanHub, createWedgeDetector.
   Browser-only parts (camera, DOM key listener) are thin adapters.
   ══════════════════════════════════════════════════════════════ */

import { roiRect } from './barcode-zxing.js';
import { analyzeGray, rgbaToGray, createGuide } from './barcode-quality.js';

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

// A hardware scanner "types" the code into whatever field has focus before
// the Enter arrives. When we recognise it as a scan, take those typed
// characters back out so they don't linger in a search/qty box.
function stripTypedScan(value, scanned) {
  const v = String(value == null ? '' : value);
  return scanned && v.endsWith(scanned) ? v.slice(0, v.length - scanned.length) : v;
}

// ── Browser adapters ──────────────────────────────────────────
// isActive(): only intercept while a scan consumer is actually listening,
// so Enter in an unrelated form is never swallowed.
function attachWedge(hub, doc, isActive) {
  const d = doc || document;
  const det = createWedgeDetector();
  const onKey = (e) => {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (isActive && !isActive()) { det.reset(); return; }
    const r = det.feed(e.key, e.timeStamp || Date.now());
    if (r.action === 'scan') {
      e.preventDefault(); // don't let Enter submit a form / move focus
      const t = e.target;
      if (t && typeof t.value === 'string') t.value = stripTypedScan(t.value, r.value);
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

// ── Pure helpers (unit-tested) ────────────────────────────────

// Acceptance rules, designed to stop wrong numbers:
//  - numeric 8/12/13/14 digits must pass the real GTIN mod-10 check digit, else it is a misread and is dropped;
//  - every accepted code must be read identically on consecutive frames
//    (2 for a valid GTIN, 3 for anything else, e.g. Code 128/39 internal labels).
function gtinOk(code) {
  if (!/^\d+$/.test(code) || ![8, 12, 13, 14].includes(code.length)) return false;
  let sum = 0;
  for (let i = code.length - 2, w = 3; i >= 0; i--, w = 4 - w) sum += Number(code[i]) * w;
  return (10 - (sum % 10)) % 10 === Number(code[code.length - 1]);
}
function isChecksummed(code) { return gtinOk(code); }
function isBadGtin(code) { return /^\d+$/.test(code) && [8, 12, 13, 14].includes(code.length) && !gtinOk(code); }

function createConsensus(opts) {
  const o = Object.assign({ windowMs: 1500, now: () => Date.now() }, opts);
  let lastCode = null, count = 0, firstTs = 0;
  return {
    accept(code) {
      if (!code || isBadGtin(code)) return false;
      const needed = o.needed || (isChecksummed(code) ? 2 : 3);
      const t = o.now();
      if (code === lastCode && t - firstTs <= o.windowMs) count++;
      else { lastCode = code; count = 1; firstTs = t; }
      if (count >= needed) { lastCode = null; count = 0; return true; }
      return false;
    },
    reset() { lastCode = null; count = 0; },
  };
}

// MediaStreamTrack capabilities/settings -> a small, UI-friendly summary.
function summarizeCaps(caps, settings) {
  const c = caps || {}, s = settings || {};
  const has = (k, v) => Array.isArray(c[k]) && c[k].includes(v);
  const zoom = c.zoom && typeof c.zoom.max === 'number' && c.zoom.max > (c.zoom.min || 1)
    ? { min: c.zoom.min || 1, max: c.zoom.max, step: c.zoom.step || 0.1, value: s.zoom || c.zoom.min || 1 } : null;
  return {
    torch: !!c.torch,
    zoom,
    continuousFocus: has('focusMode', 'continuous'),
    singleShotFocus: has('focusMode', 'single-shot'),
    continuousExposure: has('exposureMode', 'continuous'),
    continuousWhiteBalance: has('whiteBalanceMode', 'continuous'),
  };
}

// A gentle zoom helps small pharmacy labels without cropping out the code.
function defaultZoom(zoom) {
  if (!zoom) return null;
  return Math.min(zoom.max, Math.max(zoom.min, 1.5));
}
function clampZoom(zoom, v) {
  if (!zoom || !isFinite(v)) return null;
  return Math.min(zoom.max, Math.max(zoom.min, v));
}

// ITF / Codabar / Code 93 are deliberately NOT listed: they are the usual source of phantom digits read from fragments of other barcodes.
const NATIVE_FORMATS = ['ean_13', 'ean_8', 'upc_a', 'upc_e', 'code_128', 'code_39', 'data_matrix', 'qr_code'];


// ── Camera churn guard (pure, unit-tested) ────────────────────
// Root cause of "camera loses autofocus after a few scans": the camera was being opened and
// closed again within a second or two, over and over. Android's camera HAL does not always
// finish releasing the sensor that fast, and the next session comes up without autofocus
// until the app is closed. Every camera open in this file therefore goes through ONE guard
// that guarantees a minimum quiet gap after the previous close.
const CAMERA_MIN_GAP_MS = 1500;
function createGapGuard(opts) {
  const o = Object.assign({ gapMs: CAMERA_MIN_GAP_MS, now: () => Date.now(), sleep: (ms) => new Promise(r => setTimeout(r, ms)) }, opts);
  let closedAt = 0;
  return {
    closed() { closedAt = o.now(); },
    remainingMs() { return closedAt ? Math.max(0, closedAt + o.gapMs - o.now()) : 0; },
    async wait() { const ms = this.remainingMs(); if (ms > 0) await o.sleep(ms); },
  };
}
const cameraGap = createGapGuard();

// ── Camera adapter (browser only) ─────────────────────────────
let current = null; // the one running camera: { track, caps, torchOn, zoomValue, videoEl, ... }

async function applyAdvanced(track, advanced) {
  try { await track.applyConstraints({ advanced: [advanced] }); return true; } catch (_) { return false; }
}

// Starts the rear camera into <video>; resolves a handle { stop, caps }.
// Native BarcodeDetector where it exists (Chrome/Android); otherwise the
// vendored ZXing decoder (iPhone/iPad Safari). opts.fallbackDecode overrides.
async function startCamera(hub, videoEl, opts) {
  const o = opts || {};
  if (!cameraSupported()) throw new Error('Camera not available on this device/browser');
  if (current) { try { current.stop(); } catch (_) {} }
  await cameraGap.wait();
  let stream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      video: {
        facingMode: { ideal: 'environment' },
        width: { ideal: 1920 }, height: { ideal: 1080 }, frameRate: { ideal: 30 },
      }, audio: false,
    });
  } catch (err) {
    if (err && (err.name === 'NotAllowedError' || err.name === 'SecurityError')) throw new Error('Camera permission was denied — allow camera access for this site and try again');
    if (err && err.name === 'NotFoundError') throw new Error('No camera found on this device');
    if (err && (err.name === 'NotReadableError' || err.name === 'AbortError')) throw new Error('The camera is busy in another app — close it and try again');
    // Last resort: any camera at all (some older phones reject facingMode/size hints).
    stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
  }
  videoEl.srcObject = stream;
  videoEl.setAttribute('playsinline', 'true');
  videoEl.muted = true;
  await videoEl.play();

  const track = stream.getVideoTracks()[0];
  const rawCaps = track && track.getCapabilities ? track.getCapabilities() : {};
  const caps = summarizeCaps(rawCaps, track && track.getSettings ? track.getSettings() : {});
  // Autofocus / exposure / white balance: ask for continuous wherever the phone supports it.
  if (track) {
    if (caps.continuousFocus) await applyAdvanced(track, { focusMode: 'continuous' });
    if (caps.continuousExposure) await applyAdvanced(track, { exposureMode: 'continuous' });
    if (caps.continuousWhiteBalance) await applyAdvanced(track, { whiteBalanceMode: 'continuous' });
    const z = defaultZoom(caps.zoom);
    if (z && await applyAdvanced(track, { zoom: z })) caps.zoom.value = z;
  }

  let detector = null;
  if (nativeDetectorSupported()) {
    try {
      let formats = NATIVE_FORMATS;
      if (window.BarcodeDetector.getSupportedFormats) {
        const sup = await window.BarcodeDetector.getSupportedFormats();
        formats = NATIVE_FORMATS.filter(f => sup.includes(f));
      }
      if (formats.length) detector = new window.BarcodeDetector({ formats });
    } catch (_) { detector = null; }
  }
  let tick = 0;
  let nativeDecode = null;
  if (detector) {
    nativeDecode = async (quietMs) => {
      // Only what is inside the laser box counts (packs often carry several barcodes). The whole frame is
      // searched only after a long quiet spell.
      let r;
      if (typeof createImageBitmap === 'function' && videoEl.videoWidth) {
        const rc = roiRect(videoEl.videoWidth, videoEl.videoHeight, videoEl.clientWidth, videoEl.clientHeight);
        const bm = await createImageBitmap(videoEl, rc.x, rc.y, rc.w, rc.h);
        try { r = await detector.detect(bm); } finally { if (bm.close) bm.close(); }
        if (r && r[0]) return r[0].rawValue;
        if (quietMs < 3000) return null;
      }
      r = await detector.detect(videoEl);
      return r && r[0] ? r[0].rawValue : null;
    };
  }
  // Software engine (ZXing-C++ WASM, JS fallback). Mandatory where there is no native detector;
  // on Chrome/Android it is loaded lazily as a 2nd opinion once the native one has been quiet for a while.
  let engine = null, engineLoading = null;
  const ensureEngine = () => {
    if (!engineLoading) {
      engineLoading = (o.fallbackDecode
        ? Promise.resolve(Object.assign((v) => o.fallbackDecode(v), { engine: 'custom' }))
        : import('./barcode-zxing.js').then(m => m.createVideoDecoder()))
        .then(d => { engine = d; return d; })
        .catch((err) => { engineLoading = null; throw err; });
    }
    return engineLoading;
  };
  if (!nativeDecode) {
    try { await ensureEngine(); } catch (err) {
      stream.getTracks().forEach(t => t.stop());
      videoEl.srcObject = null;
      throw err;
    }
  }

  // Keep the screen awake while scanning (best effort).
  let wake = null;
  try { if (navigator.wakeLock) wake = await navigator.wakeLock.request('screen'); } catch (_) { wake = null; }

  const consensus = createConsensus();
  const guide = createGuide();
  const thumb = document.createElement('canvas');
  const thumbCtx = thumb.getContext('2d', { willReadFrequently: true });
  const startedAt = Date.now();
  let lastReadAt = startedAt, lastStillAt = 0, loops = 0, stillBusy = false;
  let stopped = false;
  let timer = null;
  let handle = null;

  // Small ROI thumbnail -> brightness / sharpness -> guidance text + auto-torch.
  const assess = () => {
    const vw = videoEl.videoWidth, vh = videoEl.videoHeight; if (!vw || !vh) return;
    const rc = roiRect(vw, vh, videoEl.clientWidth, videoEl.clientHeight);
    const tw = 192, th = Math.max(16, Math.round(tw * rc.h / rc.w));
    thumb.width = tw; thumb.height = th;
    thumbCtx.drawImage(videoEl, rc.x, rc.y, rc.w, rc.h, 0, 0, tw, th);
    const stats = analyzeGray(rgbaToGray(thumbCtx.getImageData(0, 0, tw, th).data, tw, th), tw, th);
    const g = guide.feed(stats, Date.now() - lastReadAt);
    showGuide(videoEl, g.message, g.kind);
    if (g.wantTorch && handle && caps.torch && !handle.torchOn && !handle.userTorch && !handle.autoTorched) {
      handle.autoTorched = true;
      handle.setTorch(true, true).then(() => syncControls(videoEl));
    }
  };

  // Last resort for tiny / dense labels: shoot a full-resolution photo and decode that.
  const tryStill = async () => {
    if (stillBusy || typeof ImageCapture === 'undefined' || !track) return null;
    stillBusy = true; lastStillAt = Date.now();
    try {
      const blob = await new ImageCapture(track).takePhoto();
      const bm = await createImageBitmap(blob);
      try {
        if (!engine) { try { await ensureEngine(); } catch (_) { /* native only */ } }
        let v = engine && engine.decodeStill ? await engine.decodeStill(bm) : null;
        if (!v && detector) { const r = await detector.detect(bm); v = r && r[0] ? r[0].rawValue : null; }
        return v;
      } finally { if (bm.close) bm.close(); }
    } catch (_) { return null; } finally { stillBusy = false; reassertFocus(); }
  };

  // takePhoto() and some WebViews silently drop the focus mode back to a one-shot; keep asking for continuous.
  const reassertFocus = () => {
    if (stopped || !track) return;
    if (caps.continuousFocus) applyAdvanced(track, { focusMode: 'continuous' });
    if (caps.continuousExposure) applyAdvanced(track, { exposureMode: 'continuous' });
  };
  const focusTimer = setInterval(reassertFocus, 8000);
  if (track && track.addEventListener) track.addEventListener('ended', () => { if (!stopped && o.onLost) o.onLost(new Error('The camera stopped')); });

  const loop = async () => {
    if (stopped) return;
    const t0 = Date.now();
    if (!hub.isPaused() && videoEl.readyState >= 2) {
      try {
        const quiet = t0 - lastReadAt;
        let v = null;
        if (nativeDecode) {
          v = await nativeDecode(quiet);
          if (!v && quiet > 1500) { try { await ensureEngine(); } catch (_) {} if (engine) v = await engine(videoEl, quiet); }
        } else {
          v = await engine(videoEl, quiet);
        }
        if (!v && quiet > 2500 && t0 - lastStillAt > 5000) v = await tryStill();
        if (v && consensus.accept(v)) {
          lastReadAt = Date.now(); guide.reset(); showGuide(videoEl, '', 'ok');
          if (hub.emit(v, 'camera')) flashHit(videoEl);
        }
        if (!(loops++ % 4)) assess();
      } catch (_) { /* transient frame error */ }
    }
    if (stopped) return;
    timer = setTimeout(loop, Math.max(0, 70 - (Date.now() - t0))); // ~up to 14 reads/s, never piles up
  };
  loop();

  handle = {
    caps,
    userTorch: false,
    autoTorched: false,
    engine() { return engine ? engine.engine : (nativeDecode ? 'native' : 'none'); },
    videoEl,
    torchOn: false,
    zoomValue: caps.zoom ? caps.zoom.value : null,
    stop() {
      stopped = true; clearTimeout(timer); clearInterval(focusTimer);
      if (wake && wake.release) { try { wake.release(); } catch (_) {} }
      stream.getTracks().forEach(t => t.stop());
      videoEl.srcObject = null;
      cameraGap.closed();
      if (current === handle) current = null;
    },
    async setTorch(on, auto) {
      if (!caps.torch || !track) return false;
      if (!auto) handle.userTorch = true; // a manual choice always beats auto-torch
      const ok = await applyAdvanced(track, { torch: !!on });
      if (ok) handle.torchOn = !!on;
      return ok;
    },
    async setZoom(v) {
      const z = clampZoom(caps.zoom, v);
      if (z === null || !track) return false;
      const ok = await applyAdvanced(track, { zoom: z });
      if (ok) handle.zoomValue = z;
      return ok;
    },
    // Tap-to-focus: one-shot refocus where supported, then back to continuous.
    async refocus() {
      showFocusRing(videoEl);
      if (!track) return false;
      if (caps.singleShotFocus) {
        const ok = await applyAdvanced(track, { focusMode: 'single-shot' });
        if (caps.continuousFocus) setTimeout(() => { if (!stopped) applyAdvanced(track, { focusMode: 'continuous' }); }, 1200);
        return ok;
      }
      if (caps.continuousFocus) return applyAdvanced(track, { focusMode: 'continuous' });
      return false;
    },
  };
  current = handle;
  syncControls(videoEl);
  return handle;
}

// UI-facing view of the running camera ({torch, zoom, torchOn} or null) so
// components can render the right controls without touching the adapter.
function cameraControls() {
  if (!current) return null;
  return { torch: current.caps.torch, torchOn: current.torchOn, zoom: current.caps.zoom ? Object.assign({}, current.caps.zoom, { value: current.zoomValue }) : null };
}
function activeCamera() { return current; }

// Reveal the torch / zoom controls that exist next to <video> once we know what the phone supports.
function syncControls(videoEl) {
  try {
    const box = videoEl && videoEl.parentElement; if (!box || !current) return;
    const torch = box.querySelector('[data-bc-ctl="torch"]');
    const zoom = box.querySelector('[data-bc-ctl="zoom"]');
    if (torch) { torch.hidden = !current.caps.torch; torch.setAttribute('aria-pressed', String(!!current.torchOn)); }
    if (zoom) {
      const z = current.caps.zoom; zoom.hidden = !z;
      const input = zoom.querySelector('input');
      if (z && input) { input.min = z.min; input.max = z.max; input.step = z.step; input.value = current.zoomValue || z.min; }
    }
  } catch (_) {}
}

// Green flash + laser-hit class when a code is accepted.
function flashHit(videoEl) {
  try {
    const box = videoEl.parentElement; if (!box) return;
    box.classList.remove('bc-hit'); void box.offsetWidth; box.classList.add('bc-hit');
    setTimeout(() => box.classList.remove('bc-hit'), 450);
  } catch (_) {}
}
function showGuide(videoEl, message, kind) {
  try {
    const box = videoEl.parentElement; if (!box) return;
    const el = box.querySelector('[data-bc-guide]'); if (!el) return;
    el.textContent = message || ''; el.hidden = !message; el.dataset.kind = kind || 'ok';
  } catch (_) {}
}
function showFocusRing(videoEl) {
  try {
    const box = videoEl.parentElement; if (!box) return;
    const ring = box.querySelector('.bc-focus-ring'); if (!ring) return;
    ring.classList.remove('bc-focus-ring--on'); void ring.offsetWidth; ring.classList.add('bc-focus-ring--on');
  } catch (_) {}
}

// ── Native Android scanner (Capacitor + Google ML Kit) ────────
// Inside the Android APK (see AndroidApp/) the Capacitor bridge exposes the ML Kit plugin.
// Its scan() opens Google's full-screen scanner: real autofocus, auto-zoom, very fast reads.
// In a normal browser none of this exists and the web camera path above is used unchanged.
const NATIVE_ML_FORMATS = ['EAN_13', 'EAN_8', 'UPC_A', 'UPC_E', 'CODE_128', 'CODE_39', 'DATA_MATRIX', 'QR_CODE'];

function nativePlugin() {
  try {
    const C = typeof window !== 'undefined' ? window.Capacitor : null;
    if (C && typeof C.isNativePlatform === 'function' && C.isNativePlatform() && C.Plugins && C.Plugins.BarcodeScanner) return C.Plugins.BarcodeScanner;
  } catch (_) {}
  return null;
}
function nativeScannerAvailable() { return !!nativePlugin(); }

// Google's scanner module normally arrives with the APK install; if not, download it once.
async function ensureGoogleModule(P, timeoutMs) {
  const r = await P.isGoogleBarcodeScannerModuleAvailable();
  if (r && r.available) return true;
  return new Promise((resolve, reject) => {
    let sub = null, done = false;
    const finish = (err) => { if (done) return; done = true; clearTimeout(timer); if (sub && sub.remove) sub.remove(); err ? reject(err) : resolve(true); };
    const timer = setTimeout(() => finish(new Error('Scanner module download timed out')), timeoutMs || 60000);
    Promise.resolve(P.addListener('googleBarcodeScannerModuleInstallProgress', (ev) => {
      if (ev && ev.state === 4) finish();                          // COMPLETED
      else if (ev && (ev.state === 3 || ev.state === 5)) finish(new Error('Scanner module download failed')); // CANCELED / FAILED
    })).then((h) => { sub = h; if (done && h && h.remove) h.remove(); });
    P.installGoogleBarcodeScannerModule().catch((e) => finish(e));
  });
}

// ── Persistent native camera (the fix for the lost-autofocus bug) ──
// Counting/rack scanning used to open Google's scanner Activity once per item. Instead, startNativeLive()
// opens ONE CameraX session (ML Kit plugin startScan) that stays open for the whole counting session and
// is closed exactly once. The WebView is see-through over the scanner box (css/barcode.css, [data-live]).
//  - never reopened per item  -> no camera churn
//  - every open goes through cameraGap (min quiet time after any close)
//  - a plugin error triggers a few spaced-out recoveries, then opts.onFail() so the caller can switch
//    to the web camera; nothing ever loops tightly.
const LIVE_RESOLUTION = 2;           // plugin enum: 0=640x480 1=1280x720 2=1920x1080
const LIVE_MAX_RECOVERIES = 3;       // per RECOVERY_WINDOW_MS
const LIVE_RECOVERY_WINDOW_MS = 60000;

function nativeLiveAvailable() {
  const P = nativePlugin();
  if (!P || typeof P.startScan !== 'function' || typeof P.stopScan !== 'function' || typeof P.addListener !== 'function') return false;
  try { if (typeof CSS !== 'undefined' && CSS.supports && !CSS.supports('selector(:has(*))')) return false; } catch (_) {}
  return true;
}

async function startNativeLive(hub, videoEl, opts) {
  const P = nativePlugin();
  if (!nativeLiveAvailable()) throw new Error('Live native camera is not available');
  const o = opts || {};
  if (current) { try { current.stop(); } catch (_) {} }

  if (typeof P.checkPermissions === 'function') {
    let perm = await P.checkPermissions();
    if (!perm || perm.camera !== 'granted') perm = await P.requestPermissions();
    if (!perm || perm.camera !== 'granted') throw new Error('Camera permission was denied — allow camera access for the app and try again');
  }

  const consensus = createConsensus();
  const handle = { live: true, engine: 'native-live', videoEl, torchOn: false, userTorch: false, zoomValue: 1, caps: { torch: false, zoom: null, continuousFocus: true } };
  let stopped = false, running = false, busy = Promise.resolve(), recoveries = [], subs = [];

  const onCodes = (ev) => {
    if (stopped || hub.isPaused()) return;
    const list = (ev && ev.barcodes) || [];
    const codes = [...new Set(list.map((b) => String((b && (b.rawValue || b.displayValue)) || '').trim()).filter(Boolean))];
    if (codes.length > 1) { showGuide(videoEl, 'Several barcodes in view — aim at just one', 'blur'); return; }
    if (codes.length === 1 && consensus.accept(codes[0])) { showGuide(videoEl, '', 'ok'); if (hub.emit(codes[0], 'camera')) flashHit(videoEl); }
  };

  const openCamera = async () => {
    await cameraGap.wait();
    await P.startScan({ formats: NATIVE_ML_FORMATS, lensFacing: 'BACK', resolution: LIVE_RESOLUTION });
    running = true;
    try {
      if (P.isTorchAvailable) { const t = await P.isTorchAvailable(); handle.caps.torch = !!(t && t.available); }
      if (P.getMinZoomRatio && P.getMaxZoomRatio && P.setZoomRatio) {
        const mn = (await P.getMinZoomRatio()).zoomRatio, mx = (await P.getMaxZoomRatio()).zoomRatio;
        if (mx > mn) {
          handle.caps.zoom = { min: mn, max: mx, step: 0.1 };
          const z = clampZoom(handle.caps.zoom, o.zoom || defaultZoom(handle.caps.zoom));
          await P.setZoomRatio({ zoomRatio: z }); handle.zoomValue = z;
        }
      }
    } catch (_) { /* controls are optional */ }
  };
  const closeCamera = async () => {
    if (!running) return;
    running = false;
    try { await P.stopScan(); } catch (_) {}
    cameraGap.closed();
  };
  const serial = (fn) => (busy = busy.then(fn, fn));   // start/stop/recover never overlap

  const recover = (err) => serial(async () => {
    if (stopped) return;
    const now = Date.now();
    recoveries = recoveries.filter((t) => now - t < LIVE_RECOVERY_WINDOW_MS);
    if (recoveries.length >= LIVE_MAX_RECOVERIES) { stopped = true; await closeCamera(); detach(); if (current === handle) current = null; if (o.onFail) o.onFail(err || new Error('Camera kept failing')); return; }
    recoveries.push(now);
    await closeCamera();
    try { await openCamera(); } catch (e) { stopped = true; detach(); if (current === handle) current = null; if (o.onFail) o.onFail(e); }
  });

  const detach = () => { subs.forEach((h) => { try { h && h.remove && h.remove(); } catch (_) {} }); subs = []; try { window.removeEventListener('pagehide', onPageHide); } catch (_) {} };
  const onPageHide = () => { handle.stop(); };

  subs.push(await P.addListener('barcodesScanned', onCodes));
  subs.push(await P.addListener('scanError', (e) => recover(new Error((e && (e.message || e.errorMessage)) || 'Scanner error'))));
  try { window.addEventListener('pagehide', onPageHide); } catch (_) {}

  try { await serial(openCamera); }
  catch (err) { stopped = true; detach(); await closeCamera(); throw new Error('Could not start the camera: ' + String((err && err.message) || err || '')); }

  Object.assign(handle, {
    stop() { if (stopped) return Promise.resolve(); stopped = true; detach(); if (current === handle) current = null; return serial(closeCamera); },
    restart() { return recover(); },
    async setTorch(on, auto) {
      if (!handle.caps.torch) return false;
      try { await (on ? P.enableTorch() : P.disableTorch()); handle.torchOn = !!on; if (!auto) handle.userTorch = !!on; return true; } catch (_) { return false; }
    },
    async setZoom(v) {
      if (!handle.caps.zoom) return false;
      const z = clampZoom(handle.caps.zoom, v);
      try { await P.setZoomRatio({ zoomRatio: z }); handle.zoomValue = z; return true; } catch (_) { return false; }
    },
    async refocus() { showFocusRing(videoEl); return true; },   // CameraX keeps continuous autofocus on by itself
  });
  current = handle;
  return handle;
}

// One scan through the native scanner. Resolves { status, code?, error? }:
//   'ok'          a code was read and handed to the hub
//   'cancelled'   the user closed the scanner
//   'unavailable' native scanning can't be used here -> caller falls back to the web camera
//   'error'       something failed (message in .error)
async function scanNative(hub, opts) {
  const P = nativePlugin();
  if (!P) return { status: 'unavailable' };
  const o = opts || {};
  try {
    if (P.isSupported) { const sup = await P.isSupported(); if (sup && sup.supported === false) return { status: 'unavailable' }; }
    try { await ensureGoogleModule(P, o.moduleTimeoutMs); } catch (e) { return { status: 'unavailable', error: e && e.message }; }
    await cameraGap.wait();
    let res;
    try { res = await P.scan({ formats: NATIVE_ML_FORMATS, autoZoom: true }); } finally { cameraGap.closed(); }
    const b = res && res.barcodes && res.barcodes[0];
    const code = b && (b.rawValue || b.displayValue);
    if (!code) return { status: 'cancelled' };
    hub.emit(code, 'camera');
    return { status: 'ok', code };
  } catch (err) {
    const m = String((err && (err.message || err.errorMessage)) || err || '');
    if (/cancel/i.test(m)) return { status: 'cancelled' };
    return { status: 'error', error: m || 'Scanner failed' };
  }
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
  createScanHub, createWedgeDetector, stripTypedScan, attachWedge, startCamera,
  cameraSupported, nativeDetectorSupported, feedback,
  nativeScannerAvailable, nativeLiveAvailable, startNativeLive, scanNative, createGapGuard, createConsensus, isChecksummed, isBadGtin, summarizeCaps, defaultZoom, clampZoom, cameraControls, activeCamera,
};
