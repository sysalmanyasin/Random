/* ══════════════════════════════════════════════════════════════
   RACK SCAN / rack-scan-core.js  (pure — no DOM, no storage)
   Rules for verifying whatever is on a rack, one item at a time:
   - one row per product per session (a second scan Adds or Replaces)
   - ✓ Matches tap is recorded separately from a typed count
   - an item that is not in inventory is logged, never dropped
   ══════════════════════════════════════════════════════════════ */

const num = (v) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };
const round2 = (n) => Math.round(n * 100) / 100;

export function itemKey(product, barcode) {
  return product && product.code ? 'p:' + product.code : 'b:' + barcode;
}

export function classify(systemQty, countedQty, inSystem) {
  if (inSystem === false) return 'not_in_system';
  return num(countedQty) === num(systemQty) ? 'match' : 'variance';
}

// mode: 'add' | 'replace'
export function mergeCount(existingCount, entered, mode) {
  return mode === 'add' ? num(existingCount) + num(entered) : num(entered);
}

// Build (or rebuild) the session row for one product.
export function buildItem({ product, barcode, counted, entryMode, previous, now }) {
  const inSystem = !!(product && product.code);
  const systemQty = inSystem ? num(product.qty) : 0;
  const unitPrice = inSystem ? num(product.price) : 0;
  const c = num(counted);
  return {
    key: itemKey(product, barcode),
    productCode: inSystem ? product.code : null,
    productName: inSystem ? product.name : null,
    company: inSystem ? (product.company || null) : null,
    barcode: barcode || null,
    systemQty, countedQty: c, unitPrice,
    diff: round2(c - systemQty),
    varianceValue: round2((c - systemQty) * unitPrice),
    entryMode: entryMode === 'matched_tap' ? 'matched_tap' : 'counted',
    result: classify(systemQty, c, inSystem),
    flagged: previous ? !!previous.flagged : false,
    recounted: !!(previous && previous.recounted),
    note: previous ? (previous.note || null) : null,
    scannedAt: new Date(now || Date.now()).toISOString(),
  };
}

export function summarize(items) {
  const list = Array.from(items || []);
  const s = { checked: list.length, matched: 0, variance: 0, notInSystem: 0, tapped: 0, typed: 0,
              flagged: 0, shortValue: 0, excessValue: 0, netValue: 0 };
  list.forEach(i => {
    if (i.result === 'match') s.matched++;
    else if (i.result === 'variance') s.variance++;
    else s.notInSystem++;
    if (i.entryMode === 'matched_tap') s.tapped++; else s.typed++;
    if (i.flagged) s.flagged++;
    if (i.result === 'variance') {
      if (i.varianceValue < 0) s.shortValue += i.varianceValue; else s.excessValue += i.varianceValue;
      s.netValue += i.varianceValue;
    }
  });
  s.shortValue = round2(s.shortValue); s.excessValue = round2(s.excessValue); s.netValue = round2(s.netValue);
  s.accuracy = s.checked - s.notInSystem > 0 ? Math.round((s.matched / (s.checked - s.notInSystem)) * 1000) / 10 : null;
  return s;
}

const RESULT_LABEL = { match: 'Match', variance: 'Variance', not_in_system: 'Not in system' };

export function exportRows(items, meta) {
  const m = meta || {};
  const s = summarize(items);
  const summary = [
    ['Rack Scan'], ['Rack', m.label || '—'], ['Started', m.startedAt || ''], ['Closed', m.closedAt || ''],
    ['Signed off by', m.signedOffBy || ''], [],
    ['Items checked', s.checked], ['Matched', s.matched], ['Variance', s.variance], ['Not in system', s.notInSystem],
    ['Typed counts', s.typed], ['✓ Match taps', s.tapped], ['Flagged', s.flagged],
    ['Shortage value', s.shortValue], ['Excess value', s.excessValue], ['Net variance value', s.netValue],
    ['Accuracy % (excl. not in system)', s.accuracy === null ? '' : s.accuracy],
  ];
  const head = ['Product code', 'Product', 'Company', 'Barcode', 'System qty', 'Counted', 'Difference', 'Unit price', 'Variance value', 'Result', 'Entry', 'Flagged', 'Recounted', 'Time'];
  const rows = [head].concat(Array.from(items || []).map(i => [
    i.productCode || '', i.productName || '(not in system)', i.company || '', i.barcode || '',
    i.systemQty, i.countedQty, i.diff, i.unitPrice, i.varianceValue,
    RESULT_LABEL[i.result] || i.result, i.entryMode === 'matched_tap' ? '✓ tap' : 'typed',
    i.flagged ? 'Yes' : '', i.recounted ? 'Yes' : '', i.scannedAt,
  ]));
  return { Summary: summary, Items: rows };
}

// DB row shape (generated columns diff / variance_value are NOT sent).
export function toDbRow(item, sessionId) {
  return {
    client_event_id: item.key, session_id: sessionId,
    product_code: item.productCode, product_name: item.productName, company: item.company,
    barcode: item.barcode, system_qty: item.systemQty, counted_qty: item.countedQty,
    unit_price: item.unitPrice, entry_mode: item.entryMode, result: item.result,
    flagged: item.flagged, recounted: item.recounted, note: item.note, scanned_at: item.scannedAt,
  };
}

// DB (or outbox) row -> in-memory item. Works with or without the generated columns.
export function fromDbRow(r) {
  const sys = num(r.system_qty), cnt = num(r.counted_qty), price = num(r.unit_price);
  return {
    key: r.client_event_id,
    productCode: r.product_code || null, productName: r.product_name || null, company: r.company || null,
    barcode: r.barcode || null, systemQty: sys, countedQty: cnt, unitPrice: price,
    diff: r.diff !== undefined && r.diff !== null ? num(r.diff) : round2(cnt - sys),
    varianceValue: r.variance_value !== undefined && r.variance_value !== null ? num(r.variance_value) : round2((cnt - sys) * price),
    entryMode: r.entry_mode === 'matched_tap' ? 'matched_tap' : 'counted',
    result: r.result, flagged: !!r.flagged, recounted: !!r.recounted, note: r.note || null,
    scannedAt: r.scanned_at,
  };
}

export const RackCore = { fromDbRow, itemKey, classify, mergeCount, buildItem, summarize, exportRows, toDbRow };
