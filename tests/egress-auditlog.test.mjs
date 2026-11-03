// Browser storage shim — the offline retry queue lives in localStorage.
const _mem = new Map();
globalThis.localStorage ??= {
  getItem: (k) => (_mem.has(k) ? _mem.get(k) : null),
  setItem: (k, v) => { _mem.set(k, String(v)); },
  removeItem: (k) => { _mem.delete(k); },
};
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Store } from '../js/store.js';
import { Repo } from '../js/repository.js';
import { Actions } from '../js/actions/index.js';
import { loadAuditLogList, AUDIT_LOG_LOGIN_LIMIT } from '../js/actions/audit-log-actions.js';

function fakeAuditClient(rows) {
  const log = [];
  return {
    log,
    from(name) {
      const q = { name, order: null, limit: null };
      log.push(q);
      const b = {
        select() { return b; },
        order(col, o) { q.order = o.ascending ? 'asc' : 'desc'; return b; },
        limit(n) { q.limit = n; return b; },
        then(res, rej) {
          let r = rows.slice().sort((a, z) => q.order === 'desc' ? z.ts - a.ts : a.ts - z.ts);
          if (q.limit) r = r.slice(0, q.limit);
          return Promise.resolve({ data: r, error: null }).then(res, rej);
        },
      };
      return b;
    },
  };
}
const rows = Array.from({ length: 1200 }, (_, i) => ({ id: 'e' + i, actor: 'a', role: 'main', action: 'x', details: {}, ts: i + 1 }));

test('fetchAuditLog({limit}) returns the NEWEST n entries, oldest-first like before', async () => {
  const c = fakeAuditClient(rows);
  const out = await Repo.fetchAuditLog(c, { limit: 5 });
  assert.deepEqual(out.map(e => e.ts), [1196, 1197, 1198, 1199, 1200]);
  assert.equal(c.log[0].limit, 5);
});

test('fetchAuditLog() without opts keeps the old unlimited ascending query', async () => {
  const c = fakeAuditClient(rows);
  const out = await Repo.fetchAuditLog(c);
  assert.equal(out.length, 1200);
  assert.equal(c.log[0].limit, null);
  assert.equal(out[0].ts, 1);
});

test('login loads a limited trail; ensureFullAuditLog loads the rest once', async () => {
  const c = fakeAuditClient(rows);
  Store.setState({ sbClient: c, auditLog: [] });
  await loadAuditLogList({ limit: AUDIT_LOG_LOGIN_LIMIT });
  assert.equal(Store.getState().auditLog.length, AUDIT_LOG_LOGIN_LIMIT);
  assert.equal(c.log.length, 1);

  await Actions.ensureFullAuditLog();
  assert.equal(Store.getState().auditLog.length, 1200);
  assert.equal(c.log.length, 2);

  await Actions.ensureFullAuditLog(); // already full -> no request
  assert.equal(c.log.length, 2);
});
