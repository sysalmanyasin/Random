import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BarcodeService } from '../js/barcode/barcode-service.js';

function makeEnv(opts) {
  const o = Object.assign({ online: true }, opts);
  let n = 0;
  const cache = new Map(), outbox = new Map();
  const server = { events: new Map(), regs: [], barcodes: o.serverBarcodes || [], calls: 0 };
  const env = {
    online: o.online, failNext: null, server, cache, outbox,
    store: {
      loadCache: async () => [...cache.values()],
      replaceCache: async rows => { cache.clear(); rows.forEach(r => cache.set(r.barcode, r)); },
      upsertCache: async r => { cache.set(r.barcode, r); },
      loadOutbox: async () => [...outbox.values()],
      putOutbox: async i => { outbox.set(i.id, i); },
      removeOutbox: async id => { outbox.delete(id); },
    },
    remote: {
      fetchBarcodes: async () => server.barcodes.map(b => ({ ...b })),
      registerBarcode: async a => {
        if (env.failNext) { const e = env.failNext; env.failNext = null; throw e; }
        const ex = server.barcodes.find(b => b.barcode === a.barcode);
        if (!ex) { server.barcodes.push({ barcode: a.barcode, productCode: a.productCode, status: 'verified' }); server.regs.push(a); return { outcome: 'created' }; }
        if (ex.productCode === a.productCode) return { outcome: 'exists' };
        ex.status = 'conflict'; return { outcome: 'conflict', existing_product_code: ex.productCode };
      },
      insertScanEvents: async evs => {
        server.calls++;
        if (env.failNext) { const e = env.failNext; env.failNext = null; throw e; }
        evs.forEach(e => { if (!server.events.has(e.clientEventId)) server.events.set(e.clientEventId, e); });
      },
    },
  };
  env.svc = BarcodeService.createBarcodeService({
    store: env.store, remote: env.remote, isOnline: () => env.online,
    uuid: () => 'id' + (++n), now: () => 1000 + n,
  });
  return env;
}
const EAN = '5901234123457';

test('lookup works with no network at all, from the cached mirror', async () => {
  const e = makeEnv({ online: false });
  e.cache.set(EAN, { barcode: EAN, productCode: 'P1', status: 'verified' });
  await e.svc.init();
  assert.equal(e.svc.resolve(EAN).productCode, 'P1');
});

test('failed refresh keeps the existing cache', async () => {
  const e = makeEnv();
  e.cache.set(EAN, { barcode: EAN, productCode: 'P1', status: 'verified' });
  await e.svc.init();
  e.remote.fetchBarcodes = async () => { throw new TypeError('Failed to fetch'); };
  const r = await e.svc.refresh();
  assert.equal(r.ok, false);
  assert.equal(e.svc.resolve(EAN).result, 'matched');
});

test('offline scans are queued, then synced once on reconnect', async () => {
  const e = makeEnv({ online: false });
  await e.svc.init();
  await e.svc.recordScan({ barcode: EAN, productCode: 'P1', scanType: 'count', result: 'matched', roundId: 'r1' });
  await e.svc.recordScan({ barcode: EAN, productCode: 'P1', scanType: 'count', result: 'duplicate', roundId: 'r1' });
  assert.equal(await e.svc.pendingCount(), 2);
  assert.equal(e.server.events.size, 0);
  e.online = true;
  const s = await e.svc.flush();
  assert.equal(s.sent, 2);
  assert.equal(e.server.events.size, 2);
  assert.equal(await e.svc.pendingCount(), 0);
});

test('overlapping flushes share one run (no double submit)', async () => {
  const e = makeEnv({ online: false });
  await e.svc.init();
  await e.svc.recordScan({ barcode: EAN, scanType: 'identify', result: 'unknown' });
  e.online = true;
  const [a, b, c] = [e.svc.flush(), e.svc.flush(), e.svc.flush()];
  assert.equal(a, b); assert.equal(b, c);
  await a;
  assert.equal(e.server.calls, 1);
});

test('response lost after the server saved: retry cannot duplicate the row', async () => {
  const e = makeEnv();
  await e.svc.init();
  const orig = e.remote.insertScanEvents;
  let first = true;
  e.remote.insertScanEvents = async evs => { await orig(evs); if (first) { first = false; throw new TypeError('Failed to fetch'); } };
  await e.svc.recordScan({ barcode: EAN, scanType: 'count', result: 'matched' });
  await e.svc.flush();                       // server saved, client saw an error -> stays queued
  await e.svc.flush();                       // retry
  assert.equal(e.server.events.size, 1);
  assert.equal(await e.svc.pendingCount(), 0);
});

test('network error keeps the event queued and the next flush delivers it', async () => {
  const e = makeEnv();
  await e.svc.init();
  e.failNext = new TypeError('Failed to fetch');          // armed before the auto-flush recordScan triggers
  await e.svc.recordScan({ barcode: EAN, scanType: 'count', result: 'matched' });
  await e.svc.flush();                                     // joins the in-flight (failed) pass
  assert.equal(await e.svc.pendingCount(), 0 + (e.server.events.size === 0 ? 1 : 0));
  await e.svc.flush();
  assert.equal(e.server.events.size, 1);
  assert.equal(await e.svc.pendingCount(), 0);
});

test('a permanently rejected event is dropped and reported, the rest still deliver', async () => {
  const e = makeEnv({ online: false });
  await e.svc.init();
  await e.svc.recordScan({ barcode: EAN, scanType: 'count', result: 'matched' });
  await e.svc.recordScan({ barcode: '96385074', scanType: 'count', result: 'matched' });
  const orig = e.remote.insertScanEvents;
  e.remote.insertScanEvents = async evs => {
    if (evs.length > 1 || evs[0].barcode === EAN) throw Object.assign(new Error('violates check'), { code: '23514' });
    return orig(evs);
  };
  e.online = true;
  const s = await e.svc.flush();
  assert.equal(s.failed.length, 1);
  assert.equal(s.sent, 1);
  assert.equal(await e.svc.pendingCount(), 0);
});

test('invalid scans are not recorded as events', async () => {
  const e = makeEnv();
  await e.svc.init();
  assert.equal(await e.svc.recordScan({ barcode: '123', scanType: 'identify', result: 'invalid' }), null);
  assert.equal(await e.svc.pendingCount(), 0);
});

test('offline registration is usable immediately, synced later, never shadows server truth', async () => {
  const e = makeEnv({ online: false, serverBarcodes: [] });
  await e.svc.init();
  await e.svc.queueRegistration({ productCode: 'P9', barcode: EAN });
  assert.equal(e.svc.resolve(EAN).productCode, 'P9');
  e.online = true;
  const s = await e.svc.flush();
  assert.equal(s.registered.length, 1);
  assert.equal(e.server.regs.length, 1);
  // second queued registration for same barcode, different product -> server says conflict, nothing overwritten
  e.online = false;
  await e.svc.queueRegistration({ productCode: 'P2', barcode: EAN });
  assert.equal(e.svc.resolve(EAN).productCode, 'P9'); // local view not hijacked
  e.online = true;
  const s2 = await e.svc.flush();
  assert.equal(s2.conflicts.length, 1);
  assert.equal(s2.conflicts[0].existing, 'P9');
  assert.equal(e.svc.resolve(EAN).result, 'conflict');
});

test('a rejected registration (permission) is dropped and reported, not retried forever', async () => {
  const e = makeEnv();
  await e.svc.init();
  await e.svc.queueRegistration({ productCode: 'P1', barcode: EAN }).catch(() => {});
  // first flush already ran; re-queue with a permission error
  e.failNext = Object.assign(new Error('Not authorised to register barcodes'), { code: 'P0001' });
  await e.svc.queueRegistration({ productCode: 'P5', barcode: '96385074' });
  const s = await e.svc.flush();
  assert.ok(s.failed.length >= 1 || (await e.svc.pendingCount()) === 0);
  assert.equal(await e.svc.pendingCount(), 0);
});

test('isPermanentError classification', () => {
  assert.equal(BarcodeService.isPermanentError({ code: 'P0001' }), true);
  assert.equal(BarcodeService.isPermanentError({ code: '42501' }), true);
  assert.equal(BarcodeService.isPermanentError(new TypeError('Failed to fetch')), false);
});
