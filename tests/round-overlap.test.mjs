import { test } from 'node:test';
import assert from 'node:assert/strict';
import { _testables } from '../js/actions/round-actions.js';

const { findPreCreationOverlaps } = _testables;

test('finds an overlap when the same company+code is already in another open round', () => {
  const newItems = [{ company: 'Acme', code: 'C1', name: 'Widget' }];
  const otherOpenRounds = [{ id: 'r2', engagementId: 'e2', engagementName: 'Narcotics Codes', itemSnapshot: [{ company: 'Acme', code: 'C1', name: 'Widget' }] }];
  const overlaps = findPreCreationOverlaps(newItems, otherOpenRounds);
  assert.equal(overlaps.length, 1);
  assert.equal(overlaps[0].engagementName, 'Narcotics Codes');
});

test('no overlap when companies match but codes differ', () => {
  const newItems = [{ company: 'Acme', code: 'C1' }];
  const otherOpenRounds = [{ id: 'r2', itemSnapshot: [{ company: 'Acme', code: 'C2' }] }];
  assert.equal(findPreCreationOverlaps(newItems, otherOpenRounds).length, 0);
});

test('no overlap when codes match but companies differ', () => {
  const newItems = [{ company: 'Acme', code: 'C1' }];
  const otherOpenRounds = [{ id: 'r2', itemSnapshot: [{ company: 'Beta', code: 'C1' }] }];
  assert.equal(findPreCreationOverlaps(newItems, otherOpenRounds).length, 0);
});

test('codeless items are never matched (no stable identity to compare)', () => {
  const newItems = [{ company: 'Acme', code: '' }];
  const otherOpenRounds = [{ id: 'r2', itemSnapshot: [{ company: 'Acme', code: '' }] }];
  assert.equal(findPreCreationOverlaps(newItems, otherOpenRounds).length, 0);
});

test('checks across multiple other rounds, not just the first', () => {
  const newItems = [{ company: 'Acme', code: 'C1' }, { company: 'Beta', code: 'C9' }];
  const otherOpenRounds = [
    { id: 'r2', itemSnapshot: [{ company: 'Nowhere', code: 'ZZ' }] },
    { id: 'r3', itemSnapshot: [{ company: 'Beta', code: 'C9' }] },
  ];
  const overlaps = findPreCreationOverlaps(newItems, otherOpenRounds);
  assert.equal(overlaps.length, 1);
  assert.equal(overlaps[0].roundId, 'r3');
});

test('empty inputs produce no overlaps and do not throw', () => {
  assert.equal(findPreCreationOverlaps([], []).length, 0);
  assert.equal(findPreCreationOverlaps([{ company: 'A', code: 'C1' }], []).length, 0);
});
