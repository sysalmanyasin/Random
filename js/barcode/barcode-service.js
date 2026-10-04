import { BarcodeLookup } from './barcode-lookup.js';
import { BarcodeValidation } from './barcode-validation.js';

/* ══════════════════════════════════════════════════════════════
   BARCODE / barcode-service.js
   The one place that owns: the in-memory lookup index, the offline
   mirror, and the outbox. Storage and network are INJECTED, so the same
   code runs against IndexedDB/Supabase in the app and against fakes in
   tests. No DOM, no Store.

   Offline rules
   - Lookup is always a Map.get on the in-memory index (never network).
   - Scan events and registrations go to the outbox FIRST, then a flush
     is attempted. Nothing is removed from the outbox until the server
     confirmed it.
   - Scan events carry a client-minted id; the server ignores a repeat
     (insert ... on conflict do nothing), so a retry after a crash or a
     dropped response cannot create a duplicate row.
   - flush() is single-flight: overlapping triggers (online event +
     timer + manual tap) share one run.
   ══════════════════════════════════════════════════════════════ */

const SCAN_CHUNK = 100;

// Postgres/PostgREST rejections (RLS, raise exception, constraint) will
// never succeed on retry; network failures will.
function isPermanentError(err) {
  const code = err && err.code ? String(err.code) : '';
  return /^(P0|42|23|22|PGRST)/.test(code);
}

function createBarcodeService(deps) {
  const d = Object.assign({
    isOnline: () => true,
    now: () => Date.now(),
    uuid: () => 'ev_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 10),
    onStatus: () => {},
  }, deps);

  let index = BarcodeLookup.buildIndex([]);
  let allRows = [];
  let flushing = null;
  let lastRefreshAt = null;

  function status() {
    return { size: index.size, lastRefreshAt, online: d.isOnline(), syncing: !!flushing };
  }
  function emit() { try { d.onStatus(status()); } catch (_) {} }

  async function init() {
    const cached = await d.store.loadCache();
    allRows = cached;
    index = BarcodeLookup.buildIndex(cached);
    emit();
    return index.size;
  }

  async function refresh() {
    if (!d.isOnline()) return { ok: false, reason: 'offline' };
    try {
      const rows = await d.remote.fetchBarcodes();
      await d.store.replaceCache(rows);
      allRows = rows;
      index = BarcodeLookup.buildIndex(rows);
      lastRefreshAt = d.now();
      emit();
      return { ok: true, size: index.size };
    } catch (err) {
      // Keep serving the previous cache; a failed refresh must never empty it.
      return { ok: false, reason: 'error', error: err };
    }
  }

  function rows() { return allRows.slice(); }
  function resolve(raw, opts) { return BarcodeLookup.resolveScan(index, raw, opts); }
  function productBarcodes(productCode) { return index.byProduct.get(productCode) || []; }

  // result: matched | unknown | conflict | duplicate | disabled  (never 'invalid')
  async function recordScan(a) {
    if (!BarcodeValidation.SCAN_TYPES.includes(a.scanType)) throw new Error('Bad scan type: ' + a.scanType);
    if (!BarcodeValidation.SCAN_RESULTS.includes(a.result)) return null; // e.g. 'invalid' is not a scan event
    const ev = {
      id: d.uuid(), kind: 'scan', createdAt: d.now(),
      clientEventId: d.uuid(), barcode: a.barcode, productCode: a.productCode || null,
      scanType: a.scanType, result: a.result, scannedAt: a.scannedAt || d.now(),
      engagementId: a.engagementId || null, roundId: a.roundId || null, assignmentId: a.assignmentId || null,
    };
    await d.store.putOutbox(ev);
    flush(); // fire and forget — UI never waits on the network
    return ev;
  }

  // Offline-safe registration. The user already confirmed on screen.
  // register_barcode is idempotent server-side ('exists' on a repeat), and
  // it flags conflicts instead of overwriting, so queuing it is safe.
  async function queueRegistration(a) {
    const norm = BarcodeValidation.normalizeBarcode(a.barcode);
    if (!norm.ok) throw new Error(BarcodeValidation.invalidReasonText(norm.reason));
    const item = {
      id: d.uuid(), kind: 'register', createdAt: d.now(),
      productCode: a.productCode, barcode: norm.barcode, barcodeType: norm.type, notes: a.notes || null,
    };
    await d.store.putOutbox(item);
    // Let this device use the new mapping immediately — but NEVER shadow a
    // mapping the server already told us about.
    if (!index.byBarcode.has(norm.barcode)) {
      const row = { barcode: norm.barcode, productCode: a.productCode, status: 'verified', barcodeType: norm.type, pending: true };
      index.byBarcode.set(norm.barcode, row);
      if (!index.byProduct.has(a.productCode)) index.byProduct.set(a.productCode, []);
      index.byProduct.get(a.productCode).push(row);
      index.size++;
      allRows = allRows.concat([row]);
      await d.store.upsertCache(row);
    }
    emit();
    flush();
    return item;
  }

  async function pendingCount() { return (await d.store.loadOutbox()).length; }

  // Single-flight with a re-run flag: a flush asked for WHILE one is running
  // (e.g. the device just came back online during a pass that started
  // offline) is not dropped — the running promise does one more pass.
  let again = false;
  function flush() {
    if (flushing) { again = true; return flushing; }
    flushing = (async () => {
      try {
        let summary;
        do { again = false; summary = await _flushOnce(); } while (again);
        return summary;
      } finally { flushing = null; emit(); }
    })();
    return flushing;
  }

  async function _flushOnce() {
      const summary = { sent: 0, registered: [], conflicts: [], failed: [], pending: 0 };
      {
        if (!d.isOnline()) { summary.pending = await pendingCount(); return summary; }
        emit();
        const items = (await d.store.loadOutbox()).sort((x, y) => x.createdAt - y.createdAt);

        // 1) registrations first, in order, so the scan events that follow
        //    resolve against the server's final truth after the refresh.
        let blocked = false;
        for (const it of items.filter(i => i.kind === 'register')) {
          try {
            const r = await d.remote.registerBarcode({ productCode: it.productCode, barcode: it.barcode, barcodeType: it.barcodeType, verify: true, notes: it.notes });
            await d.store.removeOutbox(it.id);
            if (r && r.outcome === 'conflict') summary.conflicts.push({ barcode: it.barcode, productCode: it.productCode, existing: r.existing_product_code });
            else summary.registered.push({ barcode: it.barcode, productCode: it.productCode, outcome: r && r.outcome });
          } catch (err) {
            if (isPermanentError(err)) {
              await d.store.removeOutbox(it.id);
              summary.failed.push({ barcode: it.barcode, productCode: it.productCode, reason: err.message || String(err) });
            } else { blocked = true; break; }
          }
        }

        // 2) scan events, chunked
        if (!blocked) {
          const scans = items.filter(i => i.kind === 'scan');
          for (let i = 0; i < scans.length; i += SCAN_CHUNK) {
            const chunk = scans.slice(i, i + SCAN_CHUNK);
            try {
              await d.remote.insertScanEvents(chunk);
              for (const ev of chunk) await d.store.removeOutbox(ev.id);
              summary.sent += chunk.length;
            } catch (err) {
              if (isPermanentError(err) && chunk.length > 1) {
                // one bad row must not poison the batch — retry singly
                for (const ev of chunk) {
                  try { await d.remote.insertScanEvents([ev]); await d.store.removeOutbox(ev.id); summary.sent++; }
                  catch (e2) { if (isPermanentError(e2)) { await d.store.removeOutbox(ev.id); summary.failed.push({ barcode: ev.barcode, reason: e2.message || String(e2) }); } else { blocked = true; break; } }
                }
              } else if (isPermanentError(err)) {
                await d.store.removeOutbox(chunk[0].id);
                summary.failed.push({ barcode: chunk[0].barcode, reason: err.message || String(err) });
              } else { blocked = true; }
              if (blocked) break;
            }
          }
        }
        if (summary.registered.length || summary.conflicts.length) await refresh();
        summary.pending = await pendingCount();
        return summary;
      }
  }

  return { init, refresh, rows, resolve, productBarcodes, recordScan, queueRegistration, flush, pendingCount, status };
}

export const BarcodeService = { createBarcodeService, isPermanentError };
