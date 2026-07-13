/* ══════════════════════════════════════════════════════════════
   FLOOR 3 — ACTIONS / item-key.js
   Blueprint: merge/diff operate on "Company + Item ID", never
   company-only. Products in this app don't carry a stable global
   id, so we mint one deterministic key per (company, index-within-
   company) at the moment a company enters an engagement's scope,
   and carry that key through every round/assignment/submission.
   ══════════════════════════════════════════════════════════════ */

function buildItemKey(company, indexWithinCompany) {
  return company + '::' + indexWithinCompany;
}

// Used only for SKUs discovered fresh at Round 2+ cutoff time (a product
// added to an already-in-scope company since the round family's original
// snapshot) — keyed by code rather than position so it can never collide
// with the company::index keys already in use by items carried over from
// the prior round's frozen snapshot.
function buildNewItemKey(company, code) {
  return company + '::new:' + code;
}

// Snapshot every product belonging to `company` into addressable line
// items, keyed and ready to travel through assignments/submissions.
function snapshotCompanyItems(products, company) {
  return products
    .filter(p => p.company === company)
    .map((p, idx) => ({
      itemKey: buildItemKey(company, idx),
      company,
      code: p.code || '',
      name: p.name,
      qty: p.qty,
      price: p.price,
    }));
}

// Snapshot every product across an entire engagement scope (all its
// companies) in one pass. This is the per-round "cutoff" — called once
// when a round is created, then never re-derived from live inventory
// for that round again, so a later Dropbox/CSV re-sync can't shift any
// already-issued itemKey out from under an in-progress count.
function snapshotScopeItems(products, companies) {
  return companies.flatMap(c => snapshotCompanyItems(products, c));
}

// Snapshot an arbitrary, code-based selection (e.g. an Inventory-tab
// template or random sample) that can span partial companies — unlike
// snapshotScopeItems, which always takes every SKU of each named
// company. Grouped by company so each item still gets a stable
// company::index key, just indexed within this selection rather than
// the whole company — fine, since a round's itemSnapshot is its own
// self-contained namespace regardless of how it was built.
function snapshotSelectedItems(products, codes) {
  const codeSet = new Set(codes);
  const byCompany = new Map();
  products.forEach(p => {
    if (!p.code || !codeSet.has(p.code)) return;
    if (!byCompany.has(p.company)) byCompany.set(p.company, []);
    byCompany.get(p.company).push(p);
  });
  const out = [];
  byCompany.forEach((items, company) => {
    items.forEach((p, idx) => out.push({
      itemKey: buildItemKey(company, idx), company, code: p.code || '', name: p.name, qty: p.qty, price: p.price,
    }));
  });
  return out;
}

export const ItemKey = { buildItemKey, buildNewItemKey, snapshotCompanyItems, snapshotScopeItems, snapshotSelectedItems };
