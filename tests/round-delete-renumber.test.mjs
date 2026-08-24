import { test } from 'node:test';
import assert from 'node:assert/strict';
import { _testables } from '../js/actions/round-actions.js';

const { computeRenumbering } = _testables;

test('the exact reported scenario: delete rounds 4, 5, 6 — round 7 becomes round 4', () => {
  // Rounds 1, 2, 3 stay untouched; 4, 5, 6 are already excluded (as if
  // deleted one at a time); only round 7 survives above round 3.
  const survivors = [
    { id: 'r1', roundNumber: 1, roundSuffix: null },
    { id: 'r2', roundNumber: 2, roundSuffix: null },
    { id: 'r3', roundNumber: 3, roundSuffix: null },
    { id: 'r7', roundNumber: 7, roundSuffix: null },
  ];
  const result = computeRenumbering(survivors);
  assert.deepEqual(result.map(r => [r.id, r.roundNumber]), [
    ['r1', 1], ['r2', 2], ['r3', 3], ['r7', 4],
  ]);
});

test('no gaps to begin with — numbers are left alone', () => {
  const survivors = [
    { id: 'r1', roundNumber: 1, roundSuffix: null },
    { id: 'r2', roundNumber: 2, roundSuffix: null },
  ];
  const result = computeRenumbering(survivors);
  assert.deepEqual(result.map(r => [r.id, r.roundNumber]), [['r1', 1], ['r2', 2]]);
});

test('a lettered sub-round family (4, 4A, 4B) renumbers together and keeps its suffixes', () => {
  const survivors = [
    { id: 'r1', roundNumber: 1, roundSuffix: null },
    { id: 'r4', roundNumber: 4, roundSuffix: null },
    { id: 'r4a', roundNumber: 4, roundSuffix: 'A' },
    { id: 'r4b', roundNumber: 4, roundSuffix: 'B' },
  ];
  const result = computeRenumbering(survivors);
  assert.deepEqual(result.map(r => [r.id, r.roundNumber, r.roundSuffix]), [
    ['r1', 1, null],
    ['r4', 2, null],
    ['r4a', 2, 'A'],
    ['r4b', 2, 'B'],
  ]);
});

test('deleting everything leaves an empty list, no error', () => {
  assert.deepEqual(computeRenumbering([]), []);
});

test('deleting the middle of a family-heavy sequence still closes the gap correctly', () => {
  // Simulates: rounds 1, 2, 3, 5, 6 survive (round 4 deleted)
  const survivors = [
    { id: 'r1', roundNumber: 1, roundSuffix: null },
    { id: 'r2', roundNumber: 2, roundSuffix: null },
    { id: 'r3', roundNumber: 3, roundSuffix: null },
    { id: 'r5', roundNumber: 5, roundSuffix: null },
    { id: 'r6', roundNumber: 6, roundSuffix: null },
  ];
  const result = computeRenumbering(survivors);
  assert.deepEqual(result.map(r => [r.id, r.roundNumber]), [
    ['r1', 1], ['r2', 2], ['r3', 3], ['r5', 4], ['r6', 5],
  ]);
});

test('does not mutate the input round objects (returns fresh copies)', () => {
  const survivors = [{ id: 'r7', roundNumber: 7, roundSuffix: null }];
  const result = computeRenumbering(survivors);
  assert.equal(survivors[0].roundNumber, 7, 'original object left untouched');
  assert.equal(result[0].roundNumber, 1);
});
