import { test } from 'node:test';
import assert from 'node:assert/strict';
import { _testables as countingTestables } from '../js/actions/counting-actions.js';
import { _testables as dashboardTestables } from '../js/actions/dashboard-actions.js';

const { computeRowTimeDelta, MAX_ROW_SECONDS } = countingTestables;
const { formatDuration } = dashboardTestables;

test('computeRowTimeDelta: returns elapsed seconds for a normal gap', () => {
  const start = 1000000;
  const now = start + 45 * 1000; // 45 seconds later
  assert.equal(computeRowTimeDelta(start, now), 45);
});

test('computeRowTimeDelta: caps at MAX_ROW_SECONDS for a long gap (interruption/break)', () => {
  const start = 1000000;
  const now = start + 3600 * 1000; // 1 hour later
  assert.equal(computeRowTimeDelta(start, now), MAX_ROW_SECONDS);
});

test('computeRowTimeDelta: returns 0 for a null/undefined cursor (first action of a session)', () => {
  assert.equal(computeRowTimeDelta(null, Date.now()), 0);
  assert.equal(computeRowTimeDelta(undefined, Date.now()), 0);
});

test('computeRowTimeDelta: returns 0 rather than negative if clocks are equal or now is earlier', () => {
  const t = 1000000;
  assert.equal(computeRowTimeDelta(t, t), 0);
  assert.equal(computeRowTimeDelta(t, t - 500), 0);
});

test('computeRowTimeDelta: respects a custom cap argument', () => {
  assert.equal(computeRowTimeDelta(0, 500 * 1000, 60), 60);
});

test('formatDuration: seconds only under a minute', () => {
  assert.equal(formatDuration(45), '45s');
  assert.equal(formatDuration(0), '0s');
});

test('formatDuration: minutes and seconds', () => {
  assert.equal(formatDuration(65), '1m 05s');
  assert.equal(formatDuration(600), '10m 00s');
});

test('formatDuration: hours and minutes (seconds dropped)', () => {
  assert.equal(formatDuration(3661), '1h 01m');
  assert.equal(formatDuration(7200), '2h 00m');
});

test('formatDuration: null/undefined/negative all render as em-dash', () => {
  assert.equal(formatDuration(null), '—');
  assert.equal(formatDuration(undefined), '—');
  assert.equal(formatDuration(-5), '—');
});
