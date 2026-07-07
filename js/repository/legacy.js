/* ══════════════════════════════════════════════════════════════
   FLOOR 1 — REPOSITORY / legacy.js
   Products / session checkpoint / history ledger — unchanged
   behavior from the original single-auditor app, just rebuilt on
   top of the shared DbCore helpers instead of duplicating
   transaction boilerplate.
   ══════════════════════════════════════════════════════════════ */
import { DbCore } from './db.js';

function saveProducts(items) { DbCore.clearStore('products'); DbCore.putAll('products', items); }
function loadProducts() { return DbCore.getAll('products'); }

function saveSessionCheckpoint(company, counts) {
  if (!company) return;
  DbCore.put('sessionState', { company, counts, updatedAt: Date.now() });
}
function clearSessionCheckpoint(company) {
  if (!company) return;
  DbCore.remove('sessionState', company);
}
async function loadLatestSessionCheckpoint() {
  const list = await DbCore.getAll('sessionState');
  if (list.length === 0) return null;
  list.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
  return list[0];
}
// Looks up one specific checkpoint by its exact key, instead of "whichever
// checkpoint was touched most recently across the whole store." Needed
// wherever more than one checkpoint can coexist at once (e.g. a Sub-Auditor
// with several open assignments) — loadLatestSessionCheckpoint() would only
// ever be able to restore the single most-recently-saved one, silently
// stranding the rest even though they're still sitting in IndexedDB.
function loadSessionCheckpoint(key) {
  if (!key) return Promise.resolve(null);
  return DbCore.getOne('sessionState', key);
}

function putHistoryEntry(entry) { DbCore.put('historyLedger', entry); }
function deleteHistoryEntries(ids) { ids.forEach(id => DbCore.remove('historyLedger', id)); }
function replaceAllHistory(entries) { DbCore.clearStore('historyLedger'); DbCore.putAll('historyLedger', entries); }
function loadHistory() { return DbCore.getAll('historyLedger'); }

export const LegacyRepo = {
  saveProducts, loadProducts,
  saveSessionCheckpoint, clearSessionCheckpoint, loadLatestSessionCheckpoint, loadSessionCheckpoint,
  putHistoryEntry, deleteHistoryEntries, replaceAllHistory, loadHistory,
};
