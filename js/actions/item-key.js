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

export const ItemKey = { buildItemKey, snapshotCompanyItems, snapshotScopeItems };
