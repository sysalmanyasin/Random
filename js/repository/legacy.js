/* ══════════════════════════════════════════════════════════════
   FLOOR 1 — REPOSITORY / legacy.js
   Products + session checkpoint. The original single-auditor app's
   history ledger (putHistoryEntry/loadHistory/etc.) has been
   removed along with the workflow that used it — see
   legacy-actions.js/individual-actions.js. The underlying
   IndexedDB stores themselves are left alone in db.js (harmless if
   unused, and removing a store definition risks breaking anyone
   upgrading from an install that still has data in it).
   ══════════════════════════════════════════════════════════════ */
import { DbCore } from './db.js';

function saveProducts(items) { DbCore.clearStore('products'); DbCore.putAll('products', items); }
function loadProducts() { return DbCore.getAll('products'); }

// `items` is the exact item list the counts were entered against
// (code/name/qty/price) — stored alongside the counts so recovery can
// rebuild the session from this frozen snapshot instead of re-deriving
// it from whatever inventory happens to be loaded at recovery time.
// Without it, a re-sync between saving and recovering a checkpoint
// (reordered/added/removed SKUs) would misalign index-keyed counts
// onto the wrong products. Shared by the Team Audit / Individual
// Assignments counting screen (counting-actions.js) — `company` here
// is really just whatever key the caller uses (an assignment ID for
// counting-actions.js, a company name in the original single-device
// app).
function saveSessionCheckpoint(company, counts, items) {
  if (!company) return;
  DbCore.put('sessionState', { company, counts, items: items || null, updatedAt: Date.now() });
}
function clearSessionCheckpoint(company) {
  if (!company) return;
  DbCore.remove('sessionState', company);
}
// Looks up one specific checkpoint by its exact key — needed wherever
// more than one checkpoint can coexist at once (e.g. a Sub-Auditor
// with several open assignments).
function loadSessionCheckpoint(key) {
  if (!key) return Promise.resolve(null);
  return DbCore.getOne('sessionState', key);
}

export const LegacyRepo = {
  saveProducts, loadProducts,
  saveSessionCheckpoint, clearSessionCheckpoint, loadSessionCheckpoint,
};
