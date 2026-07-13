import { test } from 'node:test';
import assert from 'node:assert/strict';
import { _testables } from '../js/actions/counting-actions.js';

const { computeEffectiveRow } = _testables;

test('an untouched item defaults to countedQty=0 — full assumed shortage', () => {
  const row = computeEffectiveRow(34, undefined, false);
  assert.equal(row.effectiveQty, 0);
  assert.equal(row.variance, -34);
  assert.equal(row.missing, true);
});

test('a real typed count (even 0) is not "missing"', () => {
  const row = computeEffectiveRow(34, 0, false);
  assert.equal(row.effectiveQty, 0);
  assert.equal(row.variance, -34);
  assert.equal(row.missing, false); // explicitly counted as zero — a real finding, not an assumption
});

test('a real typed count that matches system qty resolves to zero variance and is not missing', () => {
  const row = computeEffectiveRow(34, 34, false);
  assert.equal(row.variance, 0);
  assert.equal(row.missing, false);
});

test('auto-matched (Mark Remaining as Match) reads the same number as a real match, but stays flagged missing', () => {
  const real = computeEffectiveRow(34, 34, false);
  const autoMatched = computeEffectiveRow(34, 34, true);
  assert.equal(real.effectiveQty, autoMatched.effectiveQty);
  assert.equal(real.variance, autoMatched.variance);
  assert.equal(real.missing, false);
  assert.equal(autoMatched.missing, true); // same number, different provenance
});

test('null counted is treated the same as undefined (untouched)', () => {
  const row = computeEffectiveRow(10, null, false);
  assert.equal(row.effectiveQty, 0);
  assert.equal(row.missing, true);
});

test('system qty of 0 with no count entered produces zero variance but is still flagged missing (never verified, coincidentally correct)', () => {
  const row = computeEffectiveRow(0, undefined, false);
  assert.equal(row.variance, 0);
  assert.equal(row.missing, true);
});
