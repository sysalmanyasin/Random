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

// Numeric EAN/UPC/GTIN codes carry a check digit that the decoders already
// verify, so one read is trustworthy. Everything else (Code 128/39, QR...)
// must be seen twice in a row before we accept it — kills one-frame misreads.
function isChecksummed(code) { return /^\d+$/.test(code) && [8, 12, 13, 14].includes(code.length); }

function createConsensus(opts) {
  const o = Object.assign({ needed: 2, windowMs: 1200, now: () => Date.now() }, opts);
  let lastCode = null, count = 0, firstTs = 0;
  return {
    accept(code) {
      if (!code) return false;
      if (isChecksummed(code)) return true;
      const t = o.now();
      if (code === lastCode && t - firstTs <= o.windowMs) count++;
      else { lastCode = code; count = 1; firstTs = t; }
      if (count >= o.needed) { lastCode = null; count = 0; return true; }
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

const NATIVE_FORMATS = ['ean_13', 'ean_8', 'upc_a', 'upc_e', 'code_128', 'code_39', 'code_93', 'codabar', 'itf', 'data_matrix', 'qr_code'];

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
  let decode = null;
  if (detector) {
    decode = async () => {
      // Alternate: laser-box strip (fast, ignores busy shelves) / whole frame (catches off-centre codes).
      let r;
      if (tick++ % 2 === 0 && typeof createImageBitmap === 'function' && videoEl.videoWidth) {
        const rc = roiRect(videoEl.videoWidth, videoEl.videoHeight, videoEl.clientWidth, videoEl.clientHeight);
        const bm = await createImageBitmap(videoEl, rc.x, rc.y, rc.w, rc.h);
        try { r = await detector.detect(bm); } finally { if (bm.close) bm.close(); }
        if (r && r[0]) return r[0].rawValue;
      }
      r = await detector.detect(videoEl);
      return r && r[0] ? r[0].rawValue : null;
    };
  } else if (o.fallbackDecode) {
    decode = () => o.fallbackDecode(videoEl);
  } else {
    try {
      const { createVideoDecoder } = await import('./barcode-zxing.js');
      const fb = await createVideoDecoder();
      decode = () => fb(videoEl);
    } catch (err) {
      stream.getTracks().forEach(t => t.stop());
      videoEl.srcObject = null;
      throw err;
    }
  }

  // Keep the screen awake while scanning (best effort).
  let wake = null;
  try { if (navigator.wakeLock) wake = await navigator.wakeLock.request('screen'); } catch (_) { wake = null; }

  const consensus = createConsensus();
  let stopped = false;
  let timer = null;
  const loop = async () => {
    if (stopped) return;
    const t0 = Date.now();
    if (!hub.isPaused() && videoEl.readyState >= 2) {
      try {
        const v = await decode();
        if (v && consensus.accept(v) && hub.emit(v, 'camera')) flashHit(videoEl);
      } catch (_) { /* transient frame error */ }
    }
    if (stopped) return;
    timer = setTimeout(loop, Math.max(0, 70 - (Date.now() - t0))); // ~up to 14 reads/s, never piles up
  };
  loop();

  const handle = {
    caps,
    videoEl,
    torchOn: false,
    zoomValue: caps.zoom ? caps.zoom.value : null,
    stop() {
      stopped = true; clearTimeout(timer);
      if (wake && wake.release) { try { wake.release(); } catch (_) {} }
      stream.getTracks().forEach(t => t.stop());
      videoEl.srcObject = null;
      if (current === handle) current = null;
    },
    async setTorch(on) {
      if (!caps.torch || !track) return false;
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
function showFocusRing(videoEl) {
  try {
    const box = videoEl.parentElement; if (!box) return;
    const ring = box.querySelector('.bc-focus-ring'); if (!ring) return;
    ring.classList.remove('bc-focus-ring--on'); void ring.offsetWidth; ring.classList.add('bc-focus-ring--on');
  } catch (_) {}
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
  createConsensus, isChecksummed, summarizeCaps, defaultZoom, clampZoom, cameraControls, activeCamera,
};
