import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { BarcodeScanner as S } from '../js/barcode/barcode-scanner.js';

// Fake Capacitor bridge + fake ML Kit plugin that records every call.
function fakePlugin(over) {
  const calls = []; const listeners = {};
  const P = {
    calls, listeners,
    checkPermissions: async () => ({ camera: 'granted' }),
    requestPermissions: async () => ({ camera: 'granted' }),
    startScan: async (o) => { calls.push(['startScan', o]); },
    stopScan: async () => { calls.push(['stopScan']); },
    addListener: async (n, fn) => { listeners[n] = fn; return { remove() { calls.push(['remove', n]); } }; },
    isTorchAvailable: async () => ({ available: true }),
    getMinZoomRatio: async () => ({ zoomRatio: 1 }), getMaxZoomRatio: async () => ({ zoomRatio: 8 }),
    setZoomRatio: async (o) => { calls.push(['zoom', o.zoomRatio]); },
    enableTorch: async () => { calls.push(['torch', true]); }, disableTorch: async () => { calls.push(['torch', false]); },
  };
  Object.assign(P, over || {});
  globalThis.window = { Capacitor: { isNativePlatform: () => true, Plugins: { BarcodeScanner: P } }, addEventListener() {}, removeEventListener() {} };
  return P;
}
const hubWith = () => { const got = []; const hub = S.createScanHub(); hub.onScan((s) => got.push(s)); hub.resume(); return { hub, got }; };
const video = () => ({ parentElement: null });
const names = (P) => P.calls.map((c) => c[0]);
beforeEach(() => { delete globalThis.window; });

test('gap guard: a camera open must wait out the quiet time after the previous close', async () => {
  let t = 1000; const slept = [];
  const g = S.createGapGuard({ gapMs: 1500, now: () => t, sleep: async (ms) => { slept.push(ms); t += ms; } });
  await g.wait(); assert.deepEqual(slept, [], 'nothing closed yet -> no wait');
  g.closed(); t += 400; await g.wait();
  assert.deepEqual(slept, [1100]); assert.equal(g.remainingMs(), 0);
  t += 5000; await g.wait(); assert.deepEqual(slept, [1100], 'long idle -> no wait');
});

test('live camera: ONE session for many scans — startScan once, never reopened per item', async () => {
  const P = fakePlugin(); const { hub, got } = hubWith();
  const h = await S.startNativeLive(hub, video());
  assert.equal(h.live, true);
  for (const code of ['5901234123457', '4006381333931', '5449000000996']) {
    P.listeners.barcodesScanned({ barcodes: [{ rawValue: code }] });
    P.listeners.barcodesScanned({ barcodes: [{ rawValue: code }] });   // consensus: second sighting accepts
    hub.resume();
  }
  assert.equal(names(P).filter((n) => n === 'startScan').length, 1);
  assert.equal(names(P).filter((n) => n === 'stopScan').length, 0);
  assert.ok(got.length >= 1 && got.every((g) => g.source === 'camera'));
  await h.stop();
  assert.equal(names(P).filter((n) => n === 'stopScan').length, 1);
  await h.stop(); assert.equal(names(P).filter((n) => n === 'stopScan').length, 1, 'stop is idempotent');
  assert.equal(S.activeCamera(), null);
});

test('live camera: several different barcodes in one frame are ignored (no wrong item)', async () => {
  const P = fakePlugin(); const { hub, got } = hubWith();
  const h = await S.startNativeLive(hub, video());
  for (let i = 0; i < 3; i++) P.listeners.barcodesScanned({ barcodes: [{ rawValue: '5901234123457' }, { rawValue: '4006381333931' }] });
  assert.equal(got.length, 0); await h.stop();
});

test('live camera: permission denied is a clear error and the camera is never started', async () => {
  const P = fakePlugin({ checkPermissions: async () => ({ camera: 'denied' }), requestPermissions: async () => ({ camera: 'denied' }) });
  await assert.rejects(S.startNativeLive(hubWith().hub, video()), /permission/i);
  assert.equal(names(P).includes('startScan'), false);
});

test('live camera: a plugin error is recovered a limited number of times, then reported once', async () => {
  const P = fakePlugin(); let failed = 0, failErr = null;
  const h = await S.startNativeLive(hubWith().hub, video(), { onFail: (e) => { failed++; failErr = e; } });
  const settle = () => new Promise((r) => setTimeout(r, 20));
  // shrink the guard so the test is fast: recoveries still go through cameraGap, which waits real time,
  // so only assert on call ordering + the cap using a plugin whose start fails after the first recovery.
  P.startScan = async () => { P.calls.push(['startScan']); throw new Error('camera HAL stuck'); };
  P.listeners.scanError({ message: 'boom' });
  await new Promise((r) => setTimeout(r, 1700)); await settle();
  assert.equal(failed, 1); assert.match(failErr.message, /HAL stuck/);
  assert.equal(S.activeCamera(), null);
  assert.ok(names(P).includes('stopScan'), 'camera was released before reopening');
});

test('live camera: setTorch / setZoom go through the plugin', async () => {
  const P = fakePlugin(); const h = await S.startNativeLive(hubWith().hub, video());
  assert.equal(h.caps.torch, true); assert.ok(h.caps.zoom && h.caps.zoom.max === 8);
  assert.equal(await h.setTorch(true), true); assert.equal(h.torchOn, true);
  assert.equal(await h.setZoom(99), true); assert.equal(h.zoomValue, 8);
  await h.stop();
});

test('live camera is only offered inside the APK with the plugin present', () => {
  assert.equal(S.nativeLiveAvailable(), false);
  fakePlugin(); assert.equal(S.nativeLiveAvailable(), true);
  globalThis.window = { Capacitor: { isNativePlatform: () => true, Plugins: { BarcodeScanner: { scan() {} } } } };
  assert.equal(S.nativeLiveAvailable(), false);
});
