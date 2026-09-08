import { test } from 'node:test';
import assert from 'node:assert/strict';
import { _testables } from '../js/actions/compile-actions.js';

const { buildMergedItems } = _testables;

function item(itemKey, company, code, name, qty) {
  return { itemKey, company, code, name, qty, price: 10 };
}

test('reconciliation: an approved reconciliation overrides the frozen system qty and zeroes an explained variance', () => {
  const assignments = [{ id: 'asg1', auditorName: 'Ali', items: [item('A::0', 'Acme', 'C1', 'Widget', 10)] }];
  const submissions = [{ assignmentId: 'asg1', counts: { 'A::0': 7 }, notes: {}, confirms: {} }];
  const reconciliations = { 'A::0': { systemQty: 7, originalSystemQty: 10, reason: 'transferred out', approvedByName: 'Owner', approvedAt: '2026-09-08T00:00:00.000Z' } };

  const { mergedItems } = buildMergedItems(assignments, submissions, {}, reconciliations);
  assert.equal(mergedItems[0].systemQty, 7); // overridden, not the frozen 10
  assert.equal(mergedItems[0].countedQty, 7);
  assert.equal(mergedItems[0].variance, 0); // 7 - 7, explained away
  assert.equal(mergedItems[0].reconciledBy, 'Owner');
  assert.equal(mergedItems[0].originalSystemQty, 10);
});

test('reconciliation: with no reconciliations passed at all, behavior is unchanged (backward compatible)', () => {
  const assignments = [{ id: 'asg1', auditorName: 'Ali', items: [item('A::0', 'Acme', 'C1', 'Widget', 10)] }];
  const submissions = [{ assignmentId: 'asg1', counts: { 'A::0': 7 }, notes: {}, confirms: {} }];

  const { mergedItems } = buildMergedItems(assignments, submissions, {});
  assert.equal(mergedItems[0].systemQty, 10);
  assert.equal(mergedItems[0].variance, -3);
  assert.equal(mergedItems[0].reconciledBy, null);
  assert.equal(mergedItems[0].originalSystemQty, null);
});

test('reconciliation: a correction (new counted qty) and a reconciliation (new system qty) can both apply to the same item', () => {
  const assignments = [{ id: 'asg1', auditorName: 'Ali', items: [item('A::0', 'Acme', 'C1', 'Widget', 10)] }];
  const submissions = [{ assignmentId: 'asg1', counts: { 'A::0': 6 }, notes: {}, confirms: {} }];
  const corrections = { 'A::0': { countedQty: 8, approvedByName: 'Owner', approvedAt: '2026-09-08T00:00:00.000Z' } };
  const reconciliations = { 'A::0': { systemQty: 9, originalSystemQty: 10, reason: 'late invoice entry', approvedByName: 'Owner', approvedAt: '2026-09-08T00:00:00.000Z' } };

  const { mergedItems } = buildMergedItems(assignments, submissions, corrections, reconciliations);
  assert.equal(mergedItems[0].countedQty, 8); // correction wins over the raw submitted 6
  assert.equal(mergedItems[0].systemQty, 9);  // reconciliation wins over the frozen 10
  assert.equal(mergedItems[0].variance, -1);  // 8 - 9
  assert.equal(mergedItems[0].correctedBy, 'Owner');
  assert.equal(mergedItems[0].reconciledBy, 'Owner');
});

test('reconciliation: does not affect an unrelated item in the same round', () => {
  const assignments = [{ id: 'asg1', auditorName: 'Ali', items: [item('A::0', 'Acme', 'C1', 'Widget', 10), item('A::1', 'Acme', 'C2', 'Gadget', 5)] }];
  const submissions = [{ assignmentId: 'asg1', counts: { 'A::0': 7, 'A::1': 4 }, notes: {}, confirms: {} }];
  const reconciliations = { 'A::0': { systemQty: 7, originalSystemQty: 10, reason: 'transferred out', approvedByName: 'Owner', approvedAt: '2026-09-08T00:00:00.000Z' } };

  const { mergedItems } = buildMergedItems(assignments, submissions, {}, reconciliations);
  const byKey = Object.fromEntries(mergedItems.map(r => [r.itemKey, r]));
  assert.equal(byKey['A::0'].variance, 0);
  assert.equal(byKey['A::1'].systemQty, 5); // untouched
  assert.equal(byKey['A::1'].variance, -1); // 4 - 5
  assert.equal(byKey['A::1'].reconciledBy, null);
});
