import { Bus } from './bus.js';
import { logAudit } from './audit-log-actions.js';
import { ItemKey } from './item-key.js';

/* ══════════════════════════════════════════════════════════════
   FLOOR 3 — ACTIONS / difference-actions.js
   Blueprint §Difference Engine.
   Supports: Difference Only · Full Company Recount · Random
   Spot-Check. Operates on Company + Item ID, never company-only —
   a 100-item company with 5 variances only sends those 5 back out.

   §Fresh Cutoff: same rule as Round 1 — every round takes its own
   snapshot from LIVE inventory at the moment it's generated, then
   that snapshot is frozen for the round's whole life (round-actions.js
   never re-derives it). Previously, Round 2+ only ever reused Round
   1's numbers forever, and never picked up new SKUs added to a
   company already in scope. Both are fixed here: `_rowToItem` re-bases
   systemQty/name/price on live inventory (matched by code) when
   available, and Full Company Recount additionally appends any SKU
   that exists in a scoped company right now but wasn't part of the
   prior round's snapshot at all.
   ══════════════════════════════════════════════════════════════ */

// Index live products by "company::code" — plain code alone would let two
// different companies that happen to share a code string collide (one
// company's item silently refreshed with another company's figures).
function _liveByCompanyCode(liveProducts) {
  const map = new Map();
  (liveProducts || []).forEach(p => { if (p.code) map.set(p.company + '::' + p.code, p); });
  return map;
}

function _rowToItem(row, sourceRoundNumber, liveByCompanyCode) {
  // prevVariance/prevRoundNumber let the next round's counting screen show
  // "Last round: Var X" and offer the Same button — only meaningful for
  // rows that were actually counted last time (never for `missing` rows).
  // This is computed from the PRIOR round's counted vs. system figures
  // regardless of any live refresh below, since it's describing history,
  // not this round's new baseline.
  const hasPriorCount = row.countedQty !== undefined && !row.missing;
  const live = liveByCompanyCode && row.code ? liveByCompanyCode.get(row.company + '::' + row.code) : null;
  return {
    itemKey: row.itemKey, company: row.company, code: row.code,
    // Fresh cutoff: prefer the live figures if this code still exists in
    // current inventory under the SAME company; otherwise fall back to
    // the frozen prior-round values (e.g. a discontinued SKU is still
    // worth confirming as gone).
    name: live ? live.name : row.name,
    qty: live ? live.qty : row.systemQty,
    price: live ? live.price : row.price,
    refreshedFromLiveInventory: !!live,
    prevVariance: hasPriorCount ? (row.countedQty - row.systemQty) : null,
    prevRoundNumber: hasPriorCount ? (sourceRoundNumber || null) : null,
  };
}

// Difference Only — every variance line from the compiled round, re-based
// on live inventory where the code still exists.
function differencesOnlyItems(compiledRound, sourceRoundNumber, liveProducts) {
  const liveByCompanyCode = _liveByCompanyCode(liveProducts);
  return compiledRound.variances.map(r => _rowToItem(r, sourceRoundNumber, liveByCompanyCode));
}

// Full Company Recount — every item belonging to the chosen companies,
// clean or not, re-based on live inventory — PLUS any SKU that exists in
// those companies right now but wasn't in the round's original snapshot
// at all (new stock received since the engagement started).
function fullCompanyRecountItems(compiledRound, companies, sourceRoundNumber, liveProducts) {
  const liveByCompanyCode = _liveByCompanyCode(liveProducts);
  const carried = compiledRound.mergedItems.filter(r => companies.includes(r.company));
  const items = carried.map(r => _rowToItem(r, sourceRoundNumber, liveByCompanyCode));

  // Scoped per company::code — a code already known under Company A must
  // not suppress detecting that same code as genuinely new under Company B.
  const knownCompanyCodes = new Set(carried.filter(r => r.code).map(r => r.company + '::' + r.code));
  const newSkus = (liveProducts || [])
    .filter(p => companies.includes(p.company) && p.code && !knownCompanyCodes.has(p.company + '::' + p.code))
    .map(p => ({
      itemKey: ItemKey.buildNewItemKey(p.company, p.code),
      company: p.company, code: p.code, name: p.name, qty: p.qty, price: p.price,
      refreshedFromLiveInventory: true, isNewSinceLastRound: true,
      prevVariance: null, prevRoundNumber: null,
    }));

  return items.concat(newSkus);
}

// Random Spot-Check — a random sample of N items across the compiled
// round (or restricted to given companies), regardless of whether they
// were clean — "no special case, just a new assignment." Re-based on live
// inventory the same as the other two modes; does not pull in new SKUs
// (there's nothing to "spot-check" for a code with no prior round data).
function randomSpotCheckItems(compiledRound, sampleSize, companies, sourceRoundNumber, liveProducts) {
  const liveByCompanyCode = _liveByCompanyCode(liveProducts);
  const pool = companies && companies.length
    ? compiledRound.mergedItems.filter(r => companies.includes(r.company))
    : compiledRound.mergedItems.slice();
  const shuffled = pool.slice().sort(() => Math.random() - 0.5);
  return shuffled.slice(0, Math.max(1, sampleSize)).map(r => _rowToItem(r, sourceRoundNumber, liveByCompanyCode));
}

function buildItemsForMode(compiledRound, mode, params) {
  const p = params || {};
  if (mode === 'differences') return differencesOnlyItems(compiledRound, p.sourceRoundNumber, p.liveProducts);
  if (mode === 'full') return fullCompanyRecountItems(compiledRound, p.companies || [], p.sourceRoundNumber, p.liveProducts);
  if (mode === 'spotcheck') return randomSpotCheckItems(compiledRound, p.sampleSize || 10, p.companies || [], p.sourceRoundNumber, p.liveProducts);
  return [];
}

function logDifferenceRoundGenerated(roundId, mode, itemCount) {
  logAudit('differenceEngine:roundGenerated', { roundId, mode, itemCount });
  Bus.emit('toast', { msg: 'Generated ' + itemCount + ' item(s) for the next round (' + mode + ')', kind: 'success' });
}

export const DifferenceActions = {
  differencesOnlyItems, fullCompanyRecountItems, randomSpotCheckItems,
  buildItemsForMode, logDifferenceRoundGenerated,
};
