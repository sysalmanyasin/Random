import { test } from 'node:test';
import assert from 'node:assert/strict';
import { _testables } from '../js/actions/counting-actions.js';

const { truncateExtraNote, EXTRA_NOTE_MAX_LENGTH } = _testables;

test('passes short text through unchanged', () => {
  assert.equal(truncateExtraNote('Panadol 10s found on shelf'), 'Panadol 10s found on shelf');
});

test('caps text at EXTRA_NOTE_MAX_LENGTH characters', () => {
  const long = 'x'.repeat(EXTRA_NOTE_MAX_LENGTH + 500);
  const result = truncateExtraNote(long);
  assert.equal(result.length, EXTRA_NOTE_MAX_LENGTH);
});

test('handles null/undefined/empty input without throwing', () => {
  assert.equal(truncateExtraNote(undefined), '');
  assert.equal(truncateExtraNote(null), '');
  assert.equal(truncateExtraNote(''), '');
});

test('text exactly at the cap is untouched', () => {
  const exact = 'y'.repeat(EXTRA_NOTE_MAX_LENGTH);
  assert.equal(truncateExtraNote(exact), exact);
});
