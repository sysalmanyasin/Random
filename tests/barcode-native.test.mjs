import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { BarcodeScanner as S } from '../js/barcode/barcode-scanner.js';

// Fake Capacitor bridge, as injected by the Android shell (AndroidApp/).
function install(plugin, native = true) {
  globalThis.window = { Capacitor: { isNativePlatform: () => native, Plugins: plugin ? { BarcodeScanner: plugin } : {} } };
}
const hubWith = () => { const got = []; const hub = S.createScanHub(); hub.onScan((s) => got.push(s)); return { hub, got }; };
beforeEach(() => { delete globalThis.window; });

test('plain browser: native scanner is unavailable and the web camera path is used', async () => {
  assert.equal(S.nativeScannerAvailable(), false);
  const { hub } = hubWith();
  assert.deepEqual(await S.scanNative(hub), { status: 'unavailable' });
  install(null, false); assert.equal(S.nativeScannerAvailable(), false);
});
test('native scan: code is handed to the same hub as every other source', async () => {
  let opts;
  install({ isSupported: async () => ({ supported: true }), isGoogleBarcodeScannerModuleAvailable: async () => ({ available: true }),
    scan: async (o) => { opts = o; return { barcodes: [{ rawValue: '5901234123457', format: 'EAN_13' }] }; } });
  const { hub, got } = hubWith();
  const r = await S.scanNative(hub);
  assert.deepEqual(r, { status: 'ok', code: '5901234123457' });
  assert.equal(got.length, 1); assert.equal(got[0].source, 'camera');
  assert.ok(opts.formats.includes('EAN_13') && !opts.formats.includes('ITF') && opts.autoZoom === true);
});
test('native scan: user closing the scanner is a clean cancel, not an error', async () => {
  install({ isSupported: async () => ({ supported: true }), isGoogleBarcodeScannerModuleAvailable: async () => ({ available: true }),
    scan: async () => { throw new Error('scan canceled.'); } });
  assert.deepEqual(await S.scanNative(hubWith().hub), { status: 'cancelled' });
});
test('native scan: real failures are reported; empty result counts as cancelled', async () => {
  install({ isGoogleBarcodeScannerModuleAvailable: async () => ({ available: true }), scan: async () => { throw new Error('camera busy'); } });
  assert.deepEqual(await S.scanNative(hubWith().hub), { status: 'error', error: 'camera busy' });
  install({ isGoogleBarcodeScannerModuleAvailable: async () => ({ available: true }), scan: async () => ({ barcodes: [] }) });
  assert.deepEqual(await S.scanNative(hubWith().hub), { status: 'cancelled' });
});
test('native scan: downloads the Google scanner module once if it is missing', async () => {
  let listener, removed = false, installed = false;
  install({
    isGoogleBarcodeScannerModuleAvailable: async () => ({ available: installed }),
    addListener: async (name, fn) => { assert.equal(name, 'googleBarcodeScannerModuleInstallProgress'); listener = fn; return { remove: () => { removed = true; } }; },
    installGoogleBarcodeScannerModule: async () => { setTimeout(() => { installed = true; listener({ state: 4 }); }, 5); },
    scan: async () => ({ barcodes: [{ rawValue: 'FD-0042' }] }),
  });
  assert.equal((await S.scanNative(hubWith().hub)).status, 'ok'); assert.ok(removed);
});
test('native scan: module download failure falls back to the web camera', async () => {
  install({
    isGoogleBarcodeScannerModuleAvailable: async () => ({ available: false }),
    addListener: async (_n, fn) => { setTimeout(() => fn({ state: 5 }), 5); return { remove() {} }; },
    installGoogleBarcodeScannerModule: async () => {},
    scan: async () => { throw new Error('should not be called'); },
  });
  assert.equal((await S.scanNative(hubWith().hub)).status, 'unavailable');
});
