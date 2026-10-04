import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BarcodeScanner as S } from '../js/barcode/barcode-scanner.js';

test('hub forwards camera and hardware scans through the same handler', () => {
  let t = 0; const got = [];
  const hub = S.createScanHub({ now: () => t });
  hub.onScan(s => got.push(s));
  hub.emit('111111', 'camera'); t += 2000;
  hub.emit('222222', 'hardware');
  assert.deepEqual(got.map(g => [g.raw, g.source]), [['111111', 'camera'], ['222222', 'hardware']]);
});
test('hub debounces the same code seen on consecutive camera frames', () => {
  let t = 0; let n = 0;
  const hub = S.createScanHub({ now: () => t });
  hub.onScan(() => n++);
  hub.emit('5901234123457', 'camera'); t += 200; hub.emit('5901234123457', 'camera'); t += 300; hub.emit('5901234123457', 'camera');
  assert.equal(n, 1);
  t += 2000; hub.emit('5901234123457', 'camera');
  assert.equal(n, 2);
});
test('paused hub drops scans; resume re-arms', () => {
  const hub = S.createScanHub(); let n = 0; hub.onScan(() => n++);
  hub.pause(); hub.emit('abcd', 'camera'); assert.equal(n, 0);
  hub.resume(); hub.emit('abcd', 'camera'); assert.equal(n, 1);
});
test('wedge detector: fast burst + Enter is a scan', () => {
  const d = S.createWedgeDetector(); let ts = 1000; let last;
  for (const ch of '5901234123457') { last = d.feed(ch, ts); ts += 8; }
  assert.equal(d.feed('Enter', ts).value, '5901234123457');
});
test('wedge detector: human typing speed is never treated as a scan', () => {
  const d = S.createWedgeDetector(); let ts = 1000;
  for (const ch of '1234567') { d.feed(ch, ts); ts += 250; }
  assert.equal(d.feed('Enter', ts).action, 'pass');
});
test('wedge detector: short fast input below min length ignored', () => {
  const d = S.createWedgeDetector(); let ts = 0;
  for (const ch of '12') { d.feed(ch, ts); ts += 5; }
  assert.equal(d.feed('Enter', ts).action, 'pass');
});

test('typed scan characters are removed from the focused field, other text kept', () => {
  assert.equal(S.stripTypedScan('milk5901234123457', '5901234123457'), 'milk');
  assert.equal(S.stripTypedScan('5901234123457', '5901234123457'), '');
  assert.equal(S.stripTypedScan('hello', '5901234123457'), 'hello');
});

test('consensus: checksummed numeric codes pass at once, others need two matching reads', () => {
  let t = 0; const c = S.createConsensus({ now: () => t });
  assert.equal(c.accept('5901234123457'), true);
  assert.equal(c.accept('FD-0042'), false); t += 300;
  assert.equal(c.accept('FD-0042'), true);
  assert.equal(c.accept('AB-1'), false); t += 300; assert.equal(c.accept('AB-2'), false); // misread differs -> restart
  assert.equal(c.accept('AB-2'), true);
  assert.equal(c.accept('XY-1'), false); t += 5000; assert.equal(c.accept('XY-1'), false); // too slow -> restart
});
test('camera capabilities are summarised for the UI', () => {
  const s = S.summarizeCaps({ torch: true, zoom: { min: 1, max: 8, step: 0.1 }, focusMode: ['manual', 'continuous'] }, { zoom: 1 });
  assert.equal(s.torch, true); assert.equal(s.continuousFocus, true); assert.equal(s.singleShotFocus, false);
  assert.deepEqual(s.zoom, { min: 1, max: 8, step: 0.1, value: 1 });
  assert.equal(S.summarizeCaps({}, {}).zoom, null);
  assert.equal(S.defaultZoom(s.zoom), 1.5); assert.equal(S.clampZoom(s.zoom, 99), 8);
});
