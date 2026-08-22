import { test } from 'node:test';
import assert from 'node:assert/strict';
import { _testables } from '../js/actions/individual-actions.js';

const { _currentMonthKey, _monthLabel, groupIndividualAssignmentsByStaff, summarizeIndividualRounds } = _testables;

test('_currentMonthKey: formats as YYYY-MM with a zero-padded month', () => {
  assert.equal(_currentMonthKey(new Date(2026, 0, 15)), '2026-01');
  assert.equal(_currentMonthKey(new Date(2026, 11, 1)), '2026-12');
});

test('_monthLabel: turns a month key into a human label', () => {
  assert.equal(_monthLabel('2026-07'), 'July 2026');
  assert.equal(_monthLabel('2026-01'), 'January 2026');
});

test('groupIndividualAssignmentsByStaff: groups alphabetically by auditor name', () => {
  const rounds = [{ id: 'r1', state: 'compiled', createdAt: '2026-07-01' }, { id: 'r2', state: 'compiled', createdAt: '2026-07-02' }];
  const assignments = [
    { id: 'a1', roundId: 'r1', auditorName: 'Zainab', companies: ['Acme'], items: [1, 2] },
    { id: 'a2', roundId: 'r2', auditorName: 'Ali', companies: ['Beta'], items: [1] },
  ];
  const compiledRounds = [];
  const grouped = groupIndividualAssignmentsByStaff(rounds, assignments, compiledRounds);
  assert.deepEqual(grouped.map(g => g.auditorName), ['Ali', 'Zainab']);
});

test('groupIndividualAssignmentsByStaff: each entry carries variance count once compiled, null otherwise', () => {
  const rounds = [{ id: 'r1', state: 'compiled', createdAt: '2026-07-01' }];
  const assignments = [{ id: 'a1', roundId: 'r1', auditorName: 'Ali', companies: ['Acme'], items: [1, 2, 3] }];
  const compiledRounds = [{ roundId: 'r1', variances: [{ code: 'C1' }, { code: 'C2' }] }];
  const grouped = groupIndividualAssignmentsByStaff(rounds, assignments, compiledRounds);
  assert.equal(grouped[0].items[0].varianceCount, 2);
});

test('groupIndividualAssignmentsByStaff: uncompiled round reports varianceCount null, not zero (they are different things)', () => {
  const rounds = [{ id: 'r1', state: 'counting', createdAt: '2026-07-01' }];
  const assignments = [{ id: 'a1', roundId: 'r1', auditorName: 'Ali', companies: ['Acme'], items: [1] }];
  const grouped = groupIndividualAssignmentsByStaff(rounds, assignments, []);
  assert.equal(grouped[0].items[0].varianceCount, null);
});

test('groupIndividualAssignmentsByStaff: a staff member with multiple rounds gets them newest-first', () => {
  const rounds = [
    { id: 'r1', state: 'compiled', createdAt: '2026-07-01T00:00:00Z' },
    { id: 'r2', state: 'compiled', createdAt: '2026-07-10T00:00:00Z' },
  ];
  const assignments = [
    { id: 'a1', roundId: 'r1', auditorName: 'Ali', companies: ['Acme'], items: [1] },
    { id: 'a2', roundId: 'r2', auditorName: 'Ali', companies: ['Beta'], items: [1] },
  ];
  const grouped = groupIndividualAssignmentsByStaff(rounds, assignments, []);
  assert.equal(grouped[0].items[0].roundId, 'r2'); // newest first
});

test('groupIndividualAssignmentsByStaff: empty input produces an empty list without throwing', () => {
  assert.deepEqual(groupIndividualAssignmentsByStaff([], [], []), []);
});

test('summarizeIndividualRounds: carries auditor name and companies through from the assignment', () => {
  const rounds = [{ id: 'r1' }];
  const assignments = [{ roundId: 'r1', auditorName: 'Ali', companies: ['Acme', 'Beta'], items: [] }];
  const summary = summarizeIndividualRounds(rounds, assignments);
  assert.deepEqual(summary.get('r1'), { auditorName: 'Ali', companies: ['Acme', 'Beta'], templateName: null, topCompanies: [] });
});

test('summarizeIndividualRounds: carries the template name through when the pick came from a saved template', () => {
  const rounds = [{ id: 'r1' }];
  const assignments = [{ roundId: 'r1', auditorName: 'Ali', companies: ['Acme'], templateName: 'Cold Chain Products', items: [] }];
  const summary = summarizeIndividualRounds(rounds, assignments);
  assert.equal(summary.get('r1').templateName, 'Cold Chain Products');
});

test('summarizeIndividualRounds: ranks companies by summed qty × price, highest value first, capped at 3', () => {
  const rounds = [{ id: 'r1' }];
  const assignments = [{
    roundId: 'r1', auditorName: 'Ali', companies: ['A', 'B', 'C', 'D'],
    items: [
      { company: 'A', qty: 10, price: 5 },   // 50
      { company: 'B', qty: 100, price: 10 }, // 1000
      { company: 'C', qty: 1, price: 1 },    // 1
      { company: 'D', qty: 20, price: 20 },  // 400
    ],
  }];
  const { topCompanies } = summarizeIndividualRounds(rounds, assignments).get('r1');
  assert.deepEqual(topCompanies.map(t => t.company), ['B', 'D', 'A']);
  assert.equal(topCompanies[0].value, 1000);
});

test('summarizeIndividualRounds: sums multiple line items of the same company before ranking', () => {
  const rounds = [{ id: 'r1' }];
  const assignments = [{
    roundId: 'r1', auditorName: 'Ali', companies: ['A'],
    items: [
      { company: 'A', qty: 5, price: 10 },  // 50
      { company: 'A', qty: 5, price: 10 },  // 50 → 100 total
    ],
  }];
  const { topCompanies } = summarizeIndividualRounds(rounds, assignments).get('r1');
  assert.equal(topCompanies[0].value, 100);
});

test('summarizeIndividualRounds: a round with no matching assignment is simply absent from the map', () => {
  const rounds = [{ id: 'r1' }, { id: 'r2' }];
  const assignments = [{ roundId: 'r1', auditorName: 'Ali', companies: [], items: [] }];
  const summary = summarizeIndividualRounds(rounds, assignments);
  assert.equal(summary.has('r1'), true);
  assert.equal(summary.has('r2'), false);
});

test('summarizeIndividualRounds: missing qty/price on a line item is treated as zero, not NaN', () => {
  const rounds = [{ id: 'r1' }];
  const assignments = [{
    roundId: 'r1', auditorName: 'Ali', companies: ['A'],
    items: [{ company: 'A' }],
  }];
  const { topCompanies } = summarizeIndividualRounds(rounds, assignments).get('r1');
  assert.equal(topCompanies[0].value, 0);
});
