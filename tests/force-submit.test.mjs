import { test } from 'node:test';
import assert from 'node:assert/strict';
import { _testables } from '../js/actions/assignment-actions.js';

const { buildForceSubmitCounts } = _testables;

const items = [
  { itemKey: 'A::0', qty: 10 },
  { itemKey: 'A::1', qty: 5 },
  { itemKey: 'A::2', qty: 0 },
];

test('unverified mode: leaves uncounted items out of counts entirely (they default to 0 downstream via the uncounted=0 rule, not here)', () => {
  const liveSnapshot = { counts: { 'A::0': 12 } };
  const { counts, autoMatched } = buildForceSubmitCounts(items, liveSnapshot, 'unverified');
  assert.deepEqual(counts, { 'A::0': 12 });
  assert.deepEqual(autoMatched, {});
});

test('match mode: fills every uncounted item at system qty AND flags them autoMatched', () => {
  const liveSnapshot = { counts: { 'A::0': 12 } };
  const { counts, autoMatched } = buildForceSubmitCounts(items, liveSnapshot, 'match');
  assert.deepEqual(counts, { 'A::0': 12, 'A::1': 5, 'A::2': 0 });
  assert.deepEqual(autoMatched, { 'A::1': true, 'A::2': true });
  assert.equal(autoMatched['A::0'], undefined); // real count, never flagged
});

test('match mode never overwrites a count the Sub-Auditor actually entered, even if it equals system qty, and does not flag it autoMatched', () => {
  const liveSnapshot = { counts: { 'A::1': 5 } }; // they counted it and it happened to match
  const { counts, autoMatched } = buildForceSubmitCounts(items, liveSnapshot, 'match');
  assert.equal(counts['A::1'], 5);
  assert.equal(Object.keys(counts).length, 3); // still filled the other two
  assert.equal(autoMatched['A::1'], undefined);
});

test('handles a completely empty live snapshot (nothing synced) without throwing', () => {
  const { counts, autoMatched } = buildForceSubmitCounts(items, { counts: {} }, 'match');
  assert.deepEqual(counts, { 'A::0': 10, 'A::1': 5, 'A::2': 0 });
  assert.deepEqual(autoMatched, { 'A::0': true, 'A::1': true, 'A::2': true });
});

test('handles a missing/undefined liveSnapshot gracefully', () => {
  const { counts, autoMatched } = buildForceSubmitCounts(items, undefined, 'unverified');
  assert.deepEqual(counts, {});
  assert.deepEqual(autoMatched, {});
});

test('unverified mode with zero items counted produces an empty counts map', () => {
  const { counts } = buildForceSubmitCounts(items, { counts: {} }, 'unverified');
  assert.deepEqual(counts, {});
});

test('carries forward any autoMatched flags already present in the live snapshot (e.g. Sub-Auditor already tapped Mark Remaining as Match before going offline)', () => {
  const liveSnapshot = { counts: { 'A::0': 12, 'A::1': 5 }, autoMatched: { 'A::1': true } };
  const { autoMatched } = buildForceSubmitCounts(items, liveSnapshot, 'unverified');
  assert.deepEqual(autoMatched, { 'A::1': true });
});
