import { test } from 'node:test';
import assert from 'node:assert/strict';
import { _testables } from '../js/actions/compile-actions.js';

const { buildMergedItems } = _testables;

function item(itemKey, company, code, name, qty) {
  return { itemKey, company, code, name, qty, price: 10 };
}

test('corrections: an approved correction overrides the submitted count and updates variance', () => {
  const assignments = [{ id: 'asg1', auditorName: 'Ali', items: [item('A::0', 'Acme', 'C1', 'Widget', 10)] }];
  const submissions = [{ assignmentId: 'asg1', counts: { 'A::0': 12 }, notes: {}, confirms: {} }];
  const corrections = { 'A::0': { countedQty: 9, approvedByName: 'Owner', approvedAt: '2026-09-08T00:00:00.000Z' } };

  const { mergedItems } = buildMergedItems(assignments, submissions, corrections);
  assert.equal(mergedItems[0].countedQty, 9);
  assert.equal(mergedItems[0].variance, -1); // 9 - 10
  assert.equal(mergedItems[0].missing, false);
  assert.equal(mergedItems[0].correctedBy, 'Owner');
});

test('corrections: an approved correction can also fill in an item nobody submitted a count for', () => {
  const assignments = [{ id: 'asg1', auditorName: 'Ali', items: [item('A::0', 'Acme', 'C1', 'Widget', 10)] }];
  const corrections = { 'A::0': { countedQty: 10, approvedByName: 'Owner', approvedAt: '2026-09-08T00:00:00.000Z' } };

  const { mergedItems } = buildMergedItems(assignments, [], corrections);
  assert.equal(mergedItems[0].countedQty, 10);
  assert.equal(mergedItems[0].missing, false); // a correction is a real verified number, not the uncounted=0 default
});

test('corrections: a correction is never treated as autoMatched, even if it happens to equal system qty', () => {
  const assignments = [{ id: 'asg1', auditorName: 'Ali', items: [item('A::0', 'Acme', 'C1', 'Widget', 10)] }];
  const submissions = [{ assignmentId: 'asg1', counts: {}, notes: {}, confirms: {}, autoMatched: { 'A::0': true } }];
  const corrections = { 'A::0': { countedQty: 10, approvedByName: 'Owner', approvedAt: '2026-09-08T00:00:00.000Z' } };

  const { mergedItems } = buildMergedItems(assignments, submissions, corrections);
  assert.equal(mergedItems[0].autoMatched, false);
  assert.equal(mergedItems[0].correctedBy, 'Owner');
});

test('corrections: with no corrections passed at all, behavior is unchanged (backward compatible)', () => {
  const assignments = [{ id: 'asg1', auditorName: 'Ali', items: [item('A::0', 'Acme', 'C1', 'Widget', 10)] }];
  const submissions = [{ assignmentId: 'asg1', counts: { 'A::0': 12 }, notes: {}, confirms: {} }];
  const { mergedItems } = buildMergedItems(assignments, submissions);
  assert.equal(mergedItems[0].countedQty, 12);
  assert.equal(mergedItems[0].correctedBy, null);
});
