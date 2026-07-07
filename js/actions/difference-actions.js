import { Bus } from './bus.js';
import { logAudit } from './audit-log-actions.js';

/* ══════════════════════════════════════════════════════════════
   FLOOR 3 — ACTIONS / difference-actions.js
   Blueprint §Difference Engine.
   Supports: Difference Only · Full Company Recount · Random
   Spot-Check. Operates on Company + Item ID, never company-only —
   a 100-item company with 5 variances only sends those 5 back out.
   ══════════════════════════════════════════════════════════════ */

function _rowToItem(row, sourceRoundNumber) {
  // prevVariance/prevRoundNumber let the next round's counting screen show
  // "Last round: Var X" and offer the Same button — only meaningful for
  // rows that were actually counted last time (never for `missing` rows).
  const hasPriorCount = row.countedQty !== undefined && !row.missing;
  return {
    itemKey: row.itemKey, company: row.company, code: row.code, name: row.name, qty: row.systemQty, price: row.price,
    prevVariance: hasPriorCount ? (row.countedQty - row.systemQty) : null,
    prevRoundNumber: hasPriorCount ? (sourceRoundNumber || null) : null,
  };
}

// Difference Only — every variance line from the compiled round.
function differencesOnlyItems(compiledRound, sourceRoundNumber) {
  return compiledRound.variances.map(r => _rowToItem(r, sourceRoundNumber));
}

// Full Company Recount — every item belonging to the chosen companies,
// clean or not (Main Auditor can send a whole company back out on demand).
function fullCompanyRecountItems(compiledRound, companies, sourceRoundNumber) {
  return compiledRound.mergedItems.filter(r => companies.includes(r.company)).map(r => _rowToItem(r, sourceRoundNumber));
}

// Random Spot-Check — a random sample of N items across the compiled
// round (or restricted to given companies), regardless of whether they
// were clean — "no special case, just a new assignment."
function randomSpotCheckItems(compiledRound, sampleSize, companies, sourceRoundNumber) {
  const pool = companies && companies.length
    ? compiledRound.mergedItems.filter(r => companies.includes(r.company))
    : compiledRound.mergedItems.slice();
  const shuffled = pool.slice().sort(() => Math.random() - 0.5);
  return shuffled.slice(0, Math.max(1, sampleSize)).map(r => _rowToItem(r, sourceRoundNumber));
}

function buildItemsForMode(compiledRound, mode, params) {
  const p = params || {};
  if (mode === 'differences') return differencesOnlyItems(compiledRound, p.sourceRoundNumber);
  if (mode === 'full') return fullCompanyRecountItems(compiledRound, p.companies || [], p.sourceRoundNumber);
  if (mode === 'spotcheck') return randomSpotCheckItems(compiledRound, p.sampleSize || 10, p.companies || [], p.sourceRoundNumber);
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
