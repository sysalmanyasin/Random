import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BarcodeScanner as B } from '../js/barcode/barcode-scanner.js';

test('waits at least 2s before reopening the native scanner', () => {
  assert.ok(B.createReopenPolicy().delayMs >= 2000);
});
test('continues after a good read and rests after the limit', () => {
  const p = B.createReopenPolicy({ restAfter: 3 });
  assert.equal(p.note('ok'), 'continue'); assert.equal(p.note('ok'), 'continue'); assert.equal(p.note('ok'), 'rest');
  assert.equal(p.note('ok'), 'continue');   // streak restarts after the rest
});
test('user closing the scanner stops continuous mode', () => {
  const p = B.createReopenPolicy(); p.note('ok');
  assert.equal(p.note('cancelled'), 'stop');
});
test('two errors in a row fall back to the web camera; a good read clears the count', () => {
  const p = B.createReopenPolicy();
  assert.equal(p.note('error'), 'stop'); assert.equal(p.note('error'), 'fallback');
  const q = B.createReopenPolicy(); q.note('error'); q.note('ok');
  assert.equal(q.note('error'), 'stop');
});
