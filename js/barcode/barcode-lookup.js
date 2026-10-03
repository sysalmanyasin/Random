import { BarcodeValidation } from './barcode-validation.js';

/* ══════════════════════════════════════════════════════════════
   BARCODE / barcode-lookup.js  (pure — in-memory index)
   Instant, offline-capable lookup. Built once from the cached barcode
   rows; every scan is a Map.get — no network round-trip.

   resolveScan() returns exactly one of:
     invalid   – failed format/check-digit validation
     unknown   – no mapping
     disabled  – mapping exists but retired
     conflict  – mapping exists but is flagged disputed
     matched   – verified mapping
     duplicate – matched, AND that product is already counted in the
                 current session (caller supplies isAlreadyCounted)
   Only 'matched' and 'duplicate' carry a usable productCode.
   ══════════════════════════════════════════════════════════════ */

function buildIndex(rows) {
  const byBarcode = new Map();
  const byProduct = new Map();
  (rows || []).forEach(r => {
    if (!r || !r.barcode) return;
    const row = { barcode: r.barcode, productCode: r.productCode ?? r.product_code, status: r.status,
                  conflictWith: r.conflictWithProductCode ?? r.conflict_with_product_code ?? null,
                  type: r.barcodeType ?? r.barcode_type ?? 'unknown' };
    byBarcode.set(row.barcode, row);
    if (!byProduct.has(row.productCode)) byProduct.set(row.productCode, []);
    byProduct.get(row.productCode).push(row);
  });
  return { byBarcode, byProduct, size: byBarcode.size };
}

function resolveScan(index, rawScan, opts) {
  const o = opts || {};
  const norm = BarcodeValidation.normalizeBarcode(rawScan);
  if (!norm.ok) return { result: 'invalid', reason: norm.reason, raw: rawScan };
  const row = index && index.byBarcode.get(norm.barcode);
  if (!row) return { result: 'unknown', barcode: norm.barcode, type: norm.type };
  if (row.status === 'disabled') return { result: 'disabled', barcode: norm.barcode, productCode: row.productCode };
  if (row.status === 'conflict') return { result: 'conflict', barcode: norm.barcode, productCode: row.productCode, conflictWith: row.conflictWith };
  if (row.status !== 'verified') return { result: 'unknown', barcode: norm.barcode, type: norm.type, note: 'unverified' };
  if (o.isAlreadyCounted && o.isAlreadyCounted(row.productCode)) {
    return { result: 'duplicate', barcode: norm.barcode, productCode: row.productCode };
  }
  return { result: 'matched', barcode: norm.barcode, productCode: row.productCode };
}

// Map a product code onto the item(s) of the ACTIVE assignment.
// This is what keeps a Difference-Only recount closed: the list passed in
// is the assignment's own items, so a product outside it returns
// {found:false}. Same code in two companies -> ambiguous (caller must ask).
function findAssignmentItem(items, productCode) {
  const hits = (items || []).filter(it => it.code && it.code === productCode);
  if (hits.length === 0) return { found: false };
  if (hits.length > 1) return { found: true, ambiguous: true, candidates: hits };
  return { found: true, ambiguous: false, item: hits[0] };
}

// Search-by-text for the Barcode Master screen (barcode, code, product name).
function searchMaster(rows, products, query) {
  const q = String(query || '').trim().toLowerCase();
  const nameByCode = new Map((products || []).map(p => [p.code, p.name]));
  const withName = (rows || []).map(r => ({ ...r, productName: nameByCode.get(r.productCode ?? r.product_code) || '' }));
  if (!q) return withName;
  return withName.filter(r =>
    String(r.barcode).toLowerCase().includes(q) ||
    String(r.productCode ?? r.product_code).toLowerCase().includes(q) ||
    r.productName.toLowerCase().includes(q));
}

export const BarcodeLookup = { buildIndex, resolveScan, findAssignmentItem, searchMaster };
