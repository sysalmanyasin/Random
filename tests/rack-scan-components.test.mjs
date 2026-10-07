import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as C from '../js/components/rack-scan-components.js';
import { RackCore as R } from '../js/rack/rack-scan-core.js';

const P = { code: 'P1', name: '<b>Evil</b> 500mg', company: 'GSK', qty: 10, price: 50 };

test('count card shows system balance and a ✓ Matches button for a new item', () => {
  const h = C.rackCountHTML({ product: P, barcode: '123', existing: null });
  assert.match(h, /System balance/); assert.match(h, /rack-match/); assert.doesNotMatch(h, /<b>Evil<\/b>/);
});
test('duplicate shows Add / Replace and no ✓ Matches', () => {
  const ex = R.buildItem({ product: P, barcode: '1', counted: 4, entryMode: 'counted' });
  const h = C.rackCountHTML({ product: P, barcode: '123', existing: ex });
  assert.match(h, /data-dup="add"/); assert.match(h, /data-dup="replace"/); assert.doesNotMatch(h, /rack-match/);
});
test('not in system card warns and has no ✓ Matches', () => {
  const h = C.rackCountHTML({ product: null, barcode: '123', existing: null });
  assert.match(h, /not in system/i); assert.doesNotMatch(h, /rack-match/);
});
test('variance result offers Recount now + Flag; match does not', () => {
  const bad = R.buildItem({ product: P, barcode: '1', counted: 7, entryMode: 'counted' });
  const ok = R.buildItem({ product: P, barcode: '1', counted: 10, entryMode: 'counted' });
  assert.match(C.rackResultHTML({ item: bad, canRecount: true }), /Recount now/);
  assert.doesNotMatch(C.rackResultHTML({ item: ok, canRecount: true }), /Recount now/);
});
test('product names are escaped everywhere', () => {
  const item = R.buildItem({ product: P, barcode: '1', counted: 7, entryMode: 'counted' });
  assert.doesNotMatch(C.rackResultHTML({ item, canRecount: true }), /<b>Evil/);
  assert.doesNotMatch(C.rackRecentHTML([item]), /<b>Evil/);
  assert.doesNotMatch(C.rackSummaryRowsHTML([item]), /<b>Evil/);
});
test('non-main users only see the unavailable notice', () => {
  assert.match(C.rackStartHTML({ canUse: false }), /Main Auditor only/);
});

test('history rows are tappable and say whether to continue or view', () => {
  const h = C.rackHistoryHTML([{ id: 'a1', rack_label: 'Consumer Rack 2', started_at: '2026-10-07T10:00:00Z', status: 'open' },
    { id: 'b2', rack_label: 'Rack 3', started_at: '2026-10-06T10:00:00Z', status: 'closed', signed_off_by: 'Salman' }]);
  assert.match(h, /data-action="rack-resume" data-id="a1"/); assert.match(h, /tap to continue/);
  assert.match(h, /data-id="b2"/); assert.match(h, /signed off by Salman/);
});
test('a signed-off summary offers Reopen to continue', () => {
  const s = { checked: 0, matched: 0, variance: 0, notInSystem: 0, tapped: 0, typed: 0, flagged: 0, shortValue: 0, excessValue: 0, netValue: 0, accuracy: null };
  assert.match(C.rackSummaryHTML({ session: { status: 'closed', label: 'R' }, s, rows: '', synced: true, pending: 0 }), /rack-reopen/);
  assert.doesNotMatch(C.rackSummaryHTML({ session: { status: 'open', label: 'R' }, s, rows: '', synced: true, pending: 0 }), /rack-reopen/);
});
