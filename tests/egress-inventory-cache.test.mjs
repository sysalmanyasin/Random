const _mem = new Map();
globalThis.localStorage ??= {
  getItem: (k) => (_mem.has(k) ? _mem.get(k) : null),
  setItem: (k, v) => { _mem.set(k, String(v)); },
  removeItem: (k) => { _mem.delete(k); },
};
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { Store } from '../js/store.js';
import { Repo } from '../js/repository.js';
import { Actions } from '../js/actions/index.js';

const SYNC_A = '2026-11-03T10:00:00.000Z';
const SYNC_B = '2026-11-03T10:05:00.000Z';
const prod = (n) => Array.from({ length: n }, (_, i) => ({ code: 'c' + i, name: 'n' + i, qty: 1 }));

let fetchCalls, saved, serverSync, serverProducts;
beforeEach(() => {
  _mem.clear(); fetchCalls = 0; saved = [];
  serverSync = SYNC_A; serverProducts = prod(5);
  Repo.fetchLatestInventorySync = async () => ({ syncedAt: serverSync, itemCount: serverProducts.length, source: 'dropbox' });
  Repo.fetchInventoryProducts = async () => { fetchCalls += 1; return serverProducts.map(p => ({ ...p })); };
  Repo.saveProducts = (p) => { saved.push(p.length); };
  Store.setState({ sbClient: {}, products: [] });
});

test('first load downloads inventory; unchanged sync on next login skips the download', async () => {
  await Actions.loadInventoryFromSupabase(true);
  assert.equal(fetchCalls, 1);
  assert.equal(Store.getState().products.length, 5);

  // "next login": Store.products restored from the IndexedDB copy
  Store.setState({ products: prod(5) });
  await Actions.loadInventoryFromSupabase(true);
  assert.equal(fetchCalls, 1, 'no second download while synced_at is unchanged');
  assert.equal(Store.getState().products.length, 5, 'cached copy kept');
});

test('a newer server sync triggers a fresh download', async () => {
  await Actions.loadInventoryFromSupabase(true);
  serverSync = SYNC_B; serverProducts = prod(7);
  Store.setState({ products: prod(5) });
  await Actions.loadInventoryFromSupabase(true);
  assert.equal(fetchCalls, 2);
  assert.equal(Store.getState().products.length, 7);
});

test('doubt falls back to the full download: empty cache, count mismatch, probe failure', async () => {
  await Actions.loadInventoryFromSupabase(true);        // marker written (5)
  Store.setState({ products: [] });                      // IndexedDB copy missing
  await Actions.loadInventoryFromSupabase(true);
  assert.equal(fetchCalls, 2);

  Store.setState({ products: prod(3) });                 // partial/odd local copy
  await Actions.loadInventoryFromSupabase(true);
  assert.equal(fetchCalls, 3);

  Repo.fetchLatestInventorySync = async () => { throw new Error('boom'); };
  Store.setState({ products: prod(5) });
  const toasts = [];
  const { Bus } = await import('../js/actions/bus.js');
  Bus.on('toast', (t) => toasts.push(t));
  await Actions.loadInventoryFromSupabase(false);
  assert.equal(fetchCalls, 4, 'probe failure fails open to a full fetch');
  assert.equal(toasts.length, 1, 'and still surfaces the sync-log error like before');
});

test('CSV-style replacement clears the marker so the server copy is restored on next login', async () => {
  await Actions.loadInventoryFromSupabase(true);
  assert.ok(_mem.get('inventory_cache_marker'));
  // simulate what importing a CSV / restoring a backup does
  localStorage.removeItem('inventory_cache_marker');
  Store.setState({ products: prod(5) });                 // same length, different data
  await Actions.loadInventoryFromSupabase(true);
  assert.equal(fetchCalls, 2);
});
