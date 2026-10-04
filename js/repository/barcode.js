import { DbCore } from './db.js';

/* ══════════════════════════════════════════════════════════════
   FLOOR 1 — REPOSITORY / barcode.js
   Barcode master (Supabase) + the local offline mirror and outbox
   (IndexedDB, same DbCore as products/templates — no second offline
   architecture). All writes to product_barcodes / the history log go
   through SECURITY DEFINER RPCs (see supabase/barcode-schema.sql); the
   browser has no direct write access to those tables.
   ══════════════════════════════════════════════════════════════ */

function _rowToBarcode(r) {
  return {
    id: r.id, productCode: r.product_code, barcode: r.barcode, barcodeType: r.barcode_type,
    status: r.status, conflictWithProductCode: r.conflict_with_product_code || null,
    createdBy: r.created_by, verifiedBy: r.verified_by || null,
    createdAt: r.created_at, verifiedAt: r.verified_at || null, updatedAt: r.updated_at,
  };
}

// Pages through the table (PostgREST caps a single response), RLS decides
// which rows this role may see (Subs never receive 'unverified').
async function fetchBarcodes(client) {
  const PAGE = 1000;
  const out = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await client.from('product_barcodes').select('*').order('barcode').range(from, from + PAGE - 1);
    if (error) throw error;
    (data || []).forEach(r => out.push(_rowToBarcode(r)));
    if (!data || data.length < PAGE) break;
  }
  return out;
}

async function _rpc(client, fn, args) {
  const { data, error } = await client.rpc(fn, args);
  if (error) throw error;
  return data;
}
const registerBarcode = (c, a) => _rpc(c, 'register_barcode', {
  p_product_code: a.productCode, p_barcode: a.barcode, p_barcode_type: a.barcodeType || 'unknown',
  p_verify: a.verify !== false, p_notes: a.notes || null,
});
const verifyBarcode = (c, a) => _rpc(c, 'verify_barcode', { p_barcode: a.barcode, p_notes: a.notes || null });
const changeBarcode = (c, a) => _rpc(c, 'change_barcode', { p_barcode: a.barcode, p_new_product_code: a.productCode, p_notes: a.notes });
const disableBarcode = (c, a) => _rpc(c, 'disable_barcode', { p_barcode: a.barcode, p_notes: a.notes });
const reportBarcodeConflict = (c, a) => _rpc(c, 'report_barcode_conflict', { p_barcode: a.barcode, p_claimed_product_code: a.productCode, p_notes: a.notes || null });
const resolveBarcodeConflict = (c, a) => _rpc(c, 'resolve_barcode_conflict', { p_barcode: a.barcode, p_resolution: a.resolution, p_notes: a.notes });

async function fetchBarcodeHistory(client, barcode) {
  let q = client.from('barcode_verification_log').select('*').order('performed_at', { ascending: false }).limit(500);
  if (barcode) q = q.eq('barcode', barcode);
  const { data, error } = await q;
  if (error) throw error;
  return (data || []).map(r => ({ id: r.id, barcode: r.barcode, productCode: r.product_code, action: r.action, performedBy: r.performed_by, performedAt: r.performed_at, notes: r.notes }));
}

async function fetchBarcodeStaffNames(client) {
  const { data, error } = await client.rpc('barcode_staff_names');
  if (error) throw error;
  const map = {};
  (data || []).forEach(r => { map[r.id] = r.name; });
  return map;
}

// Idempotent: client_event_id is UNIQUE and ignoreDuplicates makes a retry
// of an already-delivered event a silent no-op instead of an error.
async function insertScanEvents(client, events) {
  if (!events.length) return;
  const rows = events.map(e => ({
    client_event_id: e.clientEventId, engagement_id: e.engagementId || null, round_id: e.roundId || null,
    assignment_id: e.assignmentId || null, barcode: e.barcode, product_code: e.productCode || null,
    scan_type: e.scanType, result: e.result, scanned_at: new Date(e.scannedAt).toISOString(),
  }));
  const { error } = await client.from('barcode_scan_events').upsert(rows, { onConflict: 'client_event_id', ignoreDuplicates: true });
  if (error) throw error;
}

async function fetchScanEvents(client, filter) {
  const f = filter || {};
  let q = client.from('barcode_scan_events').select('*').order('scanned_at', { ascending: false }).limit(f.limit || 500);
  if (f.engagementId) q = q.eq('engagement_id', f.engagementId);
  if (f.roundId) q = q.eq('round_id', f.roundId);
  const { data, error } = await q;
  if (error) throw error;
  return (data || []).map(r => ({
    id: r.id, engagementId: r.engagement_id, roundId: r.round_id, assignmentId: r.assignment_id, barcode: r.barcode,
    productCode: r.product_code, scanType: r.scan_type, result: r.result, userId: r.user_id, scannedAt: r.scanned_at,
  }));
}

// ── Local mirror + outbox (IndexedDB stores added in db.js v6) ──
const CACHE = 'barcodeCache';
const OUTBOX = 'barcodeOutbox';
async function loadCachedBarcodes() { return DbCore.getAll(CACHE); }
async function replaceCachedBarcodes(rows) { DbCore.clearStore(CACHE); DbCore.putAll(CACHE, rows); }
async function upsertCachedBarcode(row) { DbCore.put(CACHE, row); }
async function loadOutbox() { return DbCore.getAll(OUTBOX); }
async function putOutboxItem(item) { DbCore.put(OUTBOX, item); }
async function removeOutboxItem(id) { DbCore.remove(OUTBOX, id); }

export const BarcodeRepo = {
  fetchBarcodes, registerBarcode, verifyBarcode, changeBarcode, disableBarcode,
  reportBarcodeConflict, resolveBarcodeConflict, fetchBarcodeHistory,
  insertScanEvents, fetchScanEvents, fetchBarcodeStaffNames,
  loadCachedBarcodes, replaceCachedBarcodes, upsertCachedBarcode,
  loadOutbox, putOutboxItem, removeOutboxItem,
};
