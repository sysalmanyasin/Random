import { test } from 'node:test';
import assert from 'node:assert/strict';
import { _testables } from '../js/actions/dashboard-actions.js';

const { buildLiveSnapshotRows, filterLiveSnapshotRows, sortLiveSnapshotRows } = _testables;

function assignment(counts) {
  return {
    liveSnapshot: { counts },
    items: [
      { itemKey: 'a', name: 'Bravo', company: 'Acme', qty: 10 },
      { itemKey: 'b', name: 'Alpha', company: 'Acme', qty: 5 },
      { itemKey: 'c', name: 'Charlie', company: 'Acme', qty: 8 },
      { itemKey: 'd', name: 'Delta', company: 'Acme', qty: 3 },
    ],
  };
}

test('buildLiveSnapshotRows classifies short / over / match / unverified correctly', () => {
  const rows = buildLiveSnapshotRows(assignment({ a: 8, b: 5, c: 20 })); // d uncounted
  const byKey = Object.fromEntries(rows.map(r => [r.itemKey, r]));
  assert.equal(byKey.a.status, 'short');   // 8 < 10
  assert.equal(byKey.b.status, 'match');   // 5 === 5
  assert.equal(byKey.c.status, 'over');    // 20 > 8
  assert.equal(byKey.d.status, 'unverified');
});

test('buildLiveSnapshotRows handles an assignment with no liveSnapshot at all', () => {
  const rows = buildLiveSnapshotRows({ items: [{ itemKey: 'a', name: 'X', company: 'Y', qty: 1 }] });
  assert.equal(rows[0].status, 'unverified');
  assert.equal(rows[0].hasCount, false);
});

test('filterLiveSnapshotRows: "all" and falsy modes pass everything through', () => {
  const rows = buildLiveSnapshotRows(assignment({ a: 8, b: 5 }));
  assert.equal(filterLiveSnapshotRows(rows, 'all').length, 4);
  assert.equal(filterLiveSnapshotRows(rows, undefined).length, 4);
});

test('filterLiveSnapshotRows: shorts/overs/unverified each isolate the right rows', () => {
  const rows = buildLiveSnapshotRows(assignment({ a: 8, b: 5, c: 20 }));
  assert.deepEqual(filterLiveSnapshotRows(rows, 'shorts').map(r => r.itemKey), ['a']);
  assert.deepEqual(filterLiveSnapshotRows(rows, 'overs').map(r => r.itemKey), ['c']);
  assert.deepEqual(filterLiveSnapshotRows(rows, 'unverified').map(r => r.itemKey), ['d']);
});

test('sortLiveSnapshotRows: name-asc / name-desc order correctly', () => {
  const rows = buildLiveSnapshotRows(assignment({}));
  assert.deepEqual(sortLiveSnapshotRows(rows, 'name-asc').map(r => r.name), ['Alpha', 'Bravo', 'Charlie', 'Delta']);
  assert.deepEqual(sortLiveSnapshotRows(rows, 'name-desc').map(r => r.name), ['Delta', 'Charlie', 'Bravo', 'Alpha']);
});

test('sortLiveSnapshotRows: variance-desc puts the largest |variance| first and unverified last', () => {
  const rows = buildLiveSnapshotRows(assignment({ a: 8, b: 5, c: 20 })); // variances: a=-2, b=0, c=12, d=unverified
  const order = sortLiveSnapshotRows(rows, 'variance-desc').map(r => r.itemKey);
  assert.deepEqual(order, ['c', 'a', 'b', 'd']);
});

test('sortLiveSnapshotRows: variance-asc puts the smallest |variance| first, still with unverified last', () => {
  const rows = buildLiveSnapshotRows(assignment({ a: 8, b: 5, c: 20 }));
  const order = sortLiveSnapshotRows(rows, 'variance-asc').map(r => r.itemKey);
  assert.deepEqual(order, ['b', 'a', 'c', 'd']);
});

test('default/unknown sort mode falls back to name-asc', () => {
  const rows = buildLiveSnapshotRows(assignment({}));
  assert.deepEqual(sortLiveSnapshotRows(rows, 'nonsense').map(r => r.name), ['Alpha', 'Bravo', 'Charlie', 'Delta']);
});
