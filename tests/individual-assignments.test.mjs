import { test } from 'node:test';
import assert from 'node:assert/strict';
import { _testables } from '../js/actions/individual-actions.js';

const { _currentMonthKey, _monthLabel, groupIndividualAssignmentsByStaff } = _testables;

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
