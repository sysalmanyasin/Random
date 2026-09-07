import { test } from 'node:test';
import assert from 'node:assert/strict';
import { _testables } from '../js/actions/report-actions.js';

const { searchProductInCompiledRounds } = _testables;

function round(id, roundNumber, roundSuffix) {
  return { id, engagementId: 'eng1', roundNumber, roundSuffix: roundSuffix || '' };
}
function compiled(roundId, mergedItems, compiledAt) {
  return { roundId, engagementId: 'eng1', mergedItems, compiledAt: compiledAt || '2026-09-01T00:00:00Z' };
}
function item(itemKey, company, code, name, systemQty, countedQty, extra) {
  return { itemKey, company, code, name, systemQty, countedQty, price: 10, auditorName: 'Ali', missing: false, autoMatched: false, ...(extra || {}) };
}

test('searchProductInCompiledRounds: matches by product code (case-insensitive, prefix)', () => {
  const rounds = [round('r1', 1)];
  const compiledRounds = [compiled('r1', [item('A::1', 'Acme', 'C-100', 'Panadol 500mg', 10, 8)])];
  const results = searchProductInCompiledRounds(rounds, compiledRounds, 'c-100');
  assert.equal(results.length, 1);
  assert.equal(results[0].name, 'Panadol 500mg');
});

test('searchProductInCompiledRounds: matches by product name (case-insensitive, contains)', () => {
  const rounds = [round('r1', 1)];
  const compiledRounds = [compiled('r1', [item('A::1', 'Acme', 'C-100', 'Panadol 500mg', 10, 8)])];
  const results = searchProductInCompiledRounds(rounds, compiledRounds, 'panadol');
  assert.equal(results.length, 1);
});

test('searchProductInCompiledRounds: an empty search term returns no results (not everything)', () => {
  const rounds = [round('r1', 1)];
  const compiledRounds = [compiled('r1', [item('A::1', 'Acme', 'C-100', 'Panadol 500mg', 10, 8)])];
  assert.equal(searchProductInCompiledRounds(rounds, compiledRounds, '').length, 0);
  assert.equal(searchProductInCompiledRounds(rounds, compiledRounds, '   ').length, 0);
});

test('searchProductInCompiledRounds: the same product across multiple rounds returns one row per round, newest round first', () => {
  const rounds = [round('r1', 1), round('r2', 2)];
  const compiledRounds = [
    compiled('r1', [item('A::1', 'Acme', 'C-100', 'Panadol 500mg', 10, 10)]),
    compiled('r2', [item('B::1', 'Acme', 'C-100', 'Panadol 500mg', 10, 7)]),
  ];
  const results = searchProductInCompiledRounds(rounds, compiledRounds, 'panadol');
  assert.equal(results.length, 2);
  assert.equal(results[0].roundNumber, 2); // newest first
  assert.equal(results[0].countedQty, 7);
  assert.equal(results[1].roundNumber, 1);
  assert.equal(results[1].countedQty, 10);
});

test('searchProductInCompiledRounds: a compiled row whose round no longer exists (deleted) is skipped, not crashed on', () => {
  const rounds = [round('r1', 1)]; // r2 deliberately missing
  const compiledRounds = [
    compiled('r1', [item('A::1', 'Acme', 'C-100', 'Panadol 500mg', 10, 10)]),
    compiled('r2', [item('B::1', 'Acme', 'C-100', 'Panadol 500mg', 10, 7)]),
  ];
  const results = searchProductInCompiledRounds(rounds, compiledRounds, 'panadol');
  assert.equal(results.length, 1);
  assert.equal(results[0].roundNumber, 1);
});

test('searchProductInCompiledRounds: unrelated products are not matched', () => {
  const rounds = [round('r1', 1)];
  const compiledRounds = [compiled('r1', [
    item('A::1', 'Acme', 'C-100', 'Panadol 500mg', 10, 10),
    item('A::2', 'Acme', 'C-200', 'Brufen 400mg', 5, 5),
  ])];
  const results = searchProductInCompiledRounds(rounds, compiledRounds, 'brufen');
  assert.equal(results.length, 1);
  assert.equal(results[0].name, 'Brufen 400mg');
});

test('searchProductInCompiledRounds: variance and value-variance are computed correctly, including negative (shortage)', () => {
  const rounds = [round('r1', 1)];
  const compiledRounds = [compiled('r1', [item('A::1', 'Acme', 'C-100', 'Panadol 500mg', 10, 6, { price: 25 })])];
  const results = searchProductInCompiledRounds(rounds, compiledRounds, 'panadol');
  assert.equal(results[0].variance, -4);
  assert.equal(results[0].valueVariance, -100);
});

test('searchProductInCompiledRounds: preserves the "not counted" (missing/autoMatched) flags for the caller to render', () => {
  const rounds = [round('r1', 1)];
  const compiledRounds = [compiled('r1', [item('A::1', 'Acme', 'C-100', 'Panadol 500mg', 10, 0, { missing: true, autoMatched: false })])];
  const results = searchProductInCompiledRounds(rounds, compiledRounds, 'panadol');
  assert.equal(results[0].missing, true);
  assert.equal(results[0].autoMatched, false);
});

test('searchProductInCompiledRounds: a product with no code is still matchable by name, and code renders as empty string not undefined', () => {
  const rounds = [round('r1', 1)];
  const compiledRounds = [compiled('r1', [item('A::1', 'Acme', undefined, 'Panadol 500mg', 10, 10)])];
  const results = searchProductInCompiledRounds(rounds, compiledRounds, 'panadol');
  assert.equal(results.length, 1);
  assert.equal(results[0].code, '');
});

test('searchProductInCompiledRounds: round label includes the sub-round suffix (e.g. "Round 2A")', () => {
  const rounds = [round('r1', 2, 'A')];
  const compiledRounds = [compiled('r1', [item('A::1', 'Acme', 'C-100', 'Panadol 500mg', 10, 10)])];
  const results = searchProductInCompiledRounds(rounds, compiledRounds, 'panadol');
  assert.equal(results[0].roundLabel, 'Round 2A');
});
