import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ItemKey } from '../js/actions/item-key.js';

const products = [
  { company: 'Acme', code: 'C1', name: 'Widget', qty: 10, price: 5 },
  { company: 'Acme', code: 'C2', name: 'Gadget', qty: 20, price: 8 },
  { company: 'Acme', code: 'C3', name: 'Gizmo', qty: 30, price: 2 },
  { company: 'Beta', code: 'C4', name: 'Thing', qty: 40, price: 1 },
  { company: 'Beta', code: '', name: 'No-code item', qty: 5, price: 1 }, // should never be selectable
];

test('buildItemKey format is stable and reproducible', () => {
  assert.equal(ItemKey.buildItemKey('Acme', 0), 'Acme::0');
  assert.equal(ItemKey.buildItemKey('Acme', 3), 'Acme::3');
});

test('snapshotSelectedItems only includes codes that were actually selected', () => {
  const items = ItemKey.snapshotSelectedItems(products, ['C1', 'C4']);
  assert.equal(items.length, 2);
  assert.deepEqual(items.map(i => i.code).sort(), ['C1', 'C4']);
});

test('snapshotSelectedItems indexes items within each company independently, starting at 0', () => {
  const items = ItemKey.snapshotSelectedItems(products, ['C1', 'C2', 'C4']);
  const acmeItems = items.filter(i => i.company === 'Acme');
  const betaItems = items.filter(i => i.company === 'Beta');
  assert.equal(acmeItems.length, 2);
  assert.equal(betaItems.length, 1);
  // Both companies' indexing starts at 0 independently — this is a
  // partial-company selection, so there's no reason Beta's single item
  // should inherit Acme's running index.
  assert.equal(betaItems[0].itemKey, 'Beta::0');
});

test('snapshotSelectedItems never selects a product with no code, even if asked for by name coincidence', () => {
  const items = ItemKey.snapshotSelectedItems(products, ['', undefined, null]);
  assert.equal(items.length, 0);
});

test('snapshotSelectedItems returns an empty array when nothing matches', () => {
  assert.deepEqual(ItemKey.snapshotSelectedItems(products, ['NOPE']), []);
});

test('snapshotScopeItems (whole-company) still works unchanged for the sub-round company flow', () => {
  const items = ItemKey.snapshotScopeItems(products, ['Acme']);
  assert.equal(items.length, 3);
  assert.equal(items[0].itemKey, 'Acme::0');
});
