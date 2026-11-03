import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Store } from '../js/store.js';
import { Repo } from '../js/repository.js';
import { Actions } from '../js/actions/index.js';

// Minimal chainable fake of the supabase-js query builder: records every
// request and answers from an in-memory assignments table.
function fakeClient(table) {
  const calls = [];
  return {
    calls,
    from(name) {
      const q = { name, cols: null, inIds: null, range: null };
      calls.push(q);
      const b = {
        select(cols) { q.cols = cols; return b; },
        in(col, ids) { q.inIds = ids; return b; },
        order() { return b; },
        range(a, z) { q.range = [a, z]; return b; },
        then(res, rej) {
          let rows = table.filter(r => !q.inIds || q.inIds.includes(r.round_id));
          if (q.range) rows = rows.slice(q.range[0], q.range[1] + 1);
          return Promise.resolve({ data: rows, error: null }).then(res, rej);
        },
      };
      return b;
    },
  };
}

test('loadRoundAuditorProgress makes ONE status-only request for all rounds', async () => {
  const table = [
    { id: 'a1', round_id: 'r1', status: 'submitted' },
    { id: 'a2', round_id: 'r1', status: 'counting' },
    { id: 'a3', round_id: 'r1', status: 'revoked' },   // excluded from total
    { id: 'a4', round_id: 'r2', status: 'submitted' },
    { id: 'a5', round_id: 'other', status: 'submitted' }, // not asked for
  ];
  const client = fakeClient(table);
  Store.setState({ sbClient: client });
  const map = await Actions.loadRoundAuditorProgress([{ id: 'r1' }, { id: 'r2' }, { id: 'r3' }]);

  assert.equal(client.calls.length, 1, 'one request, not one per round');
  assert.equal(client.calls[0].name, 'assignments');
  assert.equal(client.calls[0].cols, 'id, round_id, status', 'no select(*) / no items payload');
  assert.deepEqual(map.get('r1'), { submitted: 1, total: 2 });
  assert.deepEqual(map.get('r2'), { submitted: 1, total: 1 });
  assert.deepEqual(map.get('r3'), { submitted: 0, total: 0 }, 'round with no assignments still present');
  assert.equal(map.has('other'), false);
});

test('fetchAssignmentStatusesByRounds pages past 1000 rows and skips empty input', async () => {
  const table = Array.from({ length: 2300 }, (_, i) => ({ id: 'x' + String(i).padStart(5, '0'), round_id: 'r1', status: 'counting' }));
  const client = fakeClient(table);
  const rows = await Repo.fetchAssignmentStatusesByRounds(client, ['r1']);
  assert.equal(rows.length, 2300);
  assert.equal(client.calls.length, 3);

  const c2 = fakeClient(table);
  assert.deepEqual(await Repo.fetchAssignmentStatusesByRounds(c2, []), []);
  assert.equal(c2.calls.length, 0);
});
