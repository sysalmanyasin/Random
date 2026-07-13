import { test } from 'node:test';
import assert from 'node:assert/strict';
import { _testables } from '../js/actions/compile-actions.js';

const { buildMergedItems, collectAuditorNotes, detectCrossRoundConflicts, mergeFamilyCompiled } = _testables;

function item(itemKey, company, code, name, qty) {
  return { itemKey, company, code, name, qty, price: 10 };
}

test('buildMergedItems: items with no submission stay missing:true', () => {
  const assignments = [{ id: 'asg1', auditorName: 'Ali', items: [item('A::0', 'Acme', 'C1', 'Widget', 10)] }];
  const { mergedItems, overlapWarnings } = buildMergedItems(assignments, []);
  assert.equal(mergedItems.length, 1);
  assert.equal(mergedItems[0].missing, true);
  assert.equal(overlapWarnings.length, 0);
});

test('buildMergedItems: a submitted count fills in countedQty and clears missing', () => {
  const assignments = [{ id: 'asg1', auditorName: 'Ali', items: [item('A::0', 'Acme', 'C1', 'Widget', 10)] }];
  const submissions = [{ assignmentId: 'asg1', counts: { 'A::0': 12 }, notes: {}, confirms: {} }];
  const { mergedItems } = buildMergedItems(assignments, submissions);
  assert.equal(mergedItems[0].missing, false);
  assert.equal(mergedItems[0].countedQty, 12);
});

test('buildMergedItems: same itemKey assigned twice is flagged as an overlap', () => {
  const assignments = [
    { id: 'asg1', auditorName: 'Ali', items: [item('A::0', 'Acme', 'C1', 'Widget', 10)] },
    { id: 'asg2', auditorName: 'Sara', items: [item('A::0', 'Acme', 'C1', 'Widget', 10)] },
  ];
  const { overlapWarnings } = buildMergedItems(assignments, []);
  assert.equal(overlapWarnings.length, 1);
  assert.equal(overlapWarnings[0].itemKey, 'A::0');
});

test('buildMergedItems: a count for an itemKey outside the assignment scope is ignored, not crashed on', () => {
  const assignments = [{ id: 'asg1', auditorName: 'Ali', items: [item('A::0', 'Acme', 'C1', 'Widget', 10)] }];
  const submissions = [{ assignmentId: 'asg1', counts: { 'ROGUE::9': 99 }, notes: {}, confirms: {} }];
  const { mergedItems } = buildMergedItems(assignments, submissions);
  assert.equal(mergedItems[0].missing, true); // untouched — the rogue key was ignored
});

test('buildMergedItems: an untouched item counts as a full variance (countedQty=0), not excluded — the uncounted=0 rule', () => {
  const assignments = [{ id: 'asg1', auditorName: 'Ali', items: [item('A::0', 'Acme', 'C1', 'Widget', 34)] }];
  const { mergedItems } = buildMergedItems(assignments, []);
  assert.equal(mergedItems[0].countedQty, 0);
  assert.equal(mergedItems[0].variance, -34);
  assert.equal(mergedItems[0].missing, true);
});

test('buildMergedItems: auto-matched items resolve to system qty (zero variance) but stay flagged missing, with autoMatched preserved distinctly', () => {
  const assignments = [{ id: 'asg1', auditorName: 'Ali', items: [item('A::0', 'Acme', 'C1', 'Widget', 34)] }];
  const submissions = [{ assignmentId: 'asg1', counts: { 'A::0': 34 }, autoMatched: { 'A::0': true }, notes: {}, confirms: {} }];
  const { mergedItems } = buildMergedItems(assignments, submissions);
  assert.equal(mergedItems[0].countedQty, 34);
  assert.equal(mergedItems[0].variance, 0);
  assert.equal(mergedItems[0].missing, true);
  assert.equal(mergedItems[0].autoMatched, true);
});

test('buildMergedItems: a real (non-auto-matched) count is never flagged autoMatched', () => {
  const assignments = [{ id: 'asg1', auditorName: 'Ali', items: [item('A::0', 'Acme', 'C1', 'Widget', 34)] }];
  const submissions = [{ assignmentId: 'asg1', counts: { 'A::0': 34 }, notes: {}, confirms: {} }];
  const { mergedItems } = buildMergedItems(assignments, submissions);
  assert.equal(mergedItems[0].autoMatched, false);
  assert.equal(mergedItems[0].missing, false);
});

test('collectAuditorNotes: skips assignments with no note or a blank/whitespace-only note', () => {
  const assignments = [
    { id: 'a1', auditorName: 'Ali' },
    { id: 'a2', auditorName: 'Sara' },
    { id: 'a3', auditorName: 'Zain' },
  ];
  const submissions = [
    { assignmentId: 'a1', extraNote: 'Found 6 units of X not in system', submittedAt: '2026-01-01' },
    { assignmentId: 'a2', extraNote: '   ' },
    { assignmentId: 'a3' }, // no extraNote field at all
  ];
  const notes = collectAuditorNotes(assignments, submissions);
  assert.equal(notes.length, 1);
  assert.equal(notes[0].auditorName, 'Ali');
});

test('detectCrossRoundConflicts: identical counted values across rounds are NOT a conflict', () => {
  const mergedItems = [{ itemKey: 'A::0', company: 'Acme', code: 'C1', name: 'Widget', countedQty: 10, auditorName: 'Ali' }];
  const other = [{ roundId: 'r2', mergedItems: [{ itemKey: 'X::0', company: 'Acme', code: 'C1', name: 'Widget', countedQty: 10, auditorName: 'Sara' }] }];
  const conflicts = detectCrossRoundConflicts(mergedItems, other, 'r1');
  assert.equal(conflicts.length, 0);
});

test('detectCrossRoundConflicts: different counted values for the same company+code IS a conflict', () => {
  const mergedItems = [{ itemKey: 'A::0', company: 'Acme', code: 'C1', name: 'Widget', countedQty: 10, auditorName: 'Ali' }];
  const other = [{ roundId: 'r2', mergedItems: [{ itemKey: 'X::0', company: 'Acme', code: 'C1', name: 'Widget', countedQty: 7, auditorName: 'Sara' }] }];
  const conflicts = detectCrossRoundConflicts(mergedItems, other, 'r1');
  assert.equal(conflicts.length, 1);
  assert.equal(conflicts[0].a.countedQty, 10);
  assert.equal(conflicts[0].b.countedQty, 7);
  assert.equal(conflicts[0].resolved, null);
});

test('detectCrossRoundConflicts: never compares a round against itself', () => {
  const mergedItems = [{ itemKey: 'A::0', company: 'Acme', code: 'C1', name: 'Widget', countedQty: 10, auditorName: 'Ali' }];
  const other = [{ roundId: 'r1', mergedItems }]; // same roundId as currentRoundId
  const conflicts = detectCrossRoundConflicts(mergedItems, other, 'r1');
  assert.equal(conflicts.length, 0);
});

test('detectCrossRoundConflicts: missing/uncounted or codeless rows never generate a conflict', () => {
  const mergedItems = [
    { itemKey: 'A::0', company: 'Acme', code: '', name: 'No SKU item', countedQty: 10, missing: false },
    { itemKey: 'A::1', company: 'Acme', code: 'C2', name: 'Not yet counted', countedQty: undefined, missing: true },
  ];
  const other = [{ roundId: 'r2', mergedItems: [
    { itemKey: 'X::0', company: 'Acme', code: '', countedQty: 99 },
    { itemKey: 'X::1', company: 'Acme', code: 'C2', countedQty: 5 },
  ] }];
  const conflicts = detectCrossRoundConflicts(mergedItems, other, 'r1');
  assert.equal(conflicts.length, 0);
});

test('mergeFamilyCompiled: combines variances from every round in the family, company-wise', () => {
  const compiledRounds = [
    { roundId: 'r1', compiledAt: '2026-01-01T00:00:00Z', variances: [{ company: 'Acme', code: 'C1', name: 'Widget', countedQty: 8 }], mergedItems: [] },
    { roundId: 'r1a', compiledAt: '2026-01-02T00:00:00Z', variances: [{ company: 'Beta', code: 'C9', name: 'Gadget', countedQty: 3 }], mergedItems: [] },
  ];
  const merged = mergeFamilyCompiled(['r1', 'r1a'], compiledRounds);
  assert.equal(merged.variances.length, 2);
  assert.equal(merged.memberCount, 2);
  assert.deepEqual(merged.variances.map(v => v.company).sort(), ['Acme', 'Beta']);
});

test('mergeFamilyCompiled: ignores compiled rounds outside the given family', () => {
  const compiledRounds = [
    { roundId: 'r1', compiledAt: '2026-01-01T00:00:00Z', variances: [{ company: 'Acme', code: 'C1' }], mergedItems: [] },
    { roundId: 'r2-unrelated', compiledAt: '2026-01-02T00:00:00Z', variances: [{ company: 'Gamma', code: 'C5' }], mergedItems: [] },
  ];
  const merged = mergeFamilyCompiled(['r1'], compiledRounds);
  assert.equal(merged.variances.length, 1);
  assert.equal(merged.variances[0].company, 'Acme');
});

test('mergeFamilyCompiled: a genuine (company, code) duplicate across sub-rounds keeps the most recently compiled one', () => {
  const compiledRounds = [
    { roundId: 'r1', compiledAt: '2026-01-01T00:00:00Z', variances: [{ company: 'Acme', code: 'C1', countedQty: 5 }], mergedItems: [] },
    { roundId: 'r1a', compiledAt: '2026-01-05T00:00:00Z', variances: [{ company: 'Acme', code: 'C1', countedQty: 9 }], mergedItems: [] },
  ];
  const merged = mergeFamilyCompiled(['r1', 'r1a'], compiledRounds);
  assert.equal(merged.variances.length, 1);
  assert.equal(merged.variances[0].countedQty, 9); // r1a compiled later, wins
});

test('mergeFamilyCompiled: empty family returns empty, not a crash', () => {
  const merged = mergeFamilyCompiled([], []);
  assert.deepEqual(merged.variances, []);
  assert.deepEqual(merged.mergedItems, []);
  assert.equal(merged.memberCount, 0);
});
