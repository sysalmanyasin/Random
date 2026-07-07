/* ══════════════════════════════════════════════════════════════
   FLOOR 1 — REPOSITORY / db.js
   IndexedDB connection + schema + generic CRUD helpers.
   Nothing outside js/repository/* may import this file directly —
   everything goes through repository.js (the barrel for Floor 1).
   ══════════════════════════════════════════════════════════════ */

export const DB_NAME = 'FazalDinPharmaPlus_AuditEngine';
// v3 → v4: multi-auditor entities (Engagement/Round/Assignment/
// Submission/Auditor/PairingLink/CompiledRound/FinalSnapshot/
// AuditLog) moved OUT of IndexedDB and into Supabase — see
// repository/supabase.js. Legacy stores (products / sessionState /
// historyLedger) are untouched, so existing installs keep working.
export const DB_VERSION = 4;

let db = null;

function openDB() {
  return new Promise((resolve) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onerror = (e) => { console.error('Database initialization rejected', e); resolve(null); };
    request.onsuccess = (e) => { db = e.target.result; resolve(db); };
    request.onupgradeneeded = (e) => {
      const d = e.target.result;
      if (!d.objectStoreNames.contains('products')) d.createObjectStore('products', { keyPath: 'id', autoIncrement: true });
      if (!d.objectStoreNames.contains('sessionState')) d.createObjectStore('sessionState', { keyPath: 'company' });
      if (!d.objectStoreNames.contains('historyLedger')) {
        const hs = d.createObjectStore('historyLedger', { keyPath: 'id' });
        hs.createIndex('byCompany', 'company', { unique: false });
      }
    };
  });
}

function getDb() { return db; }

// ── Generic helpers, reused by every entity-specific repository file ──
function putAll(storeName, items) {
  if (!db) return;
  const tx = db.transaction([storeName], 'readwrite');
  const store = tx.objectStore(storeName);
  items.forEach(item => store.put(item));
}

function put(storeName, item) {
  if (!db) return;
  const tx = db.transaction([storeName], 'readwrite');
  tx.objectStore(storeName).put(item);
}

function remove(storeName, key) {
  if (!db) return;
  const tx = db.transaction([storeName], 'readwrite');
  tx.objectStore(storeName).delete(key);
}

function clearStore(storeName) {
  if (!db) return;
  const tx = db.transaction([storeName], 'readwrite');
  tx.objectStore(storeName).clear();
}

function getAll(storeName) {
  return new Promise((resolve) => {
    if (!db) return resolve([]);
    const tx = db.transaction([storeName], 'readonly');
    const out = [];
    tx.objectStore(storeName).openCursor().onsuccess = (e) => {
      const cursor = e.target.result;
      if (cursor) { out.push(cursor.value); cursor.continue(); }
      else resolve(out);
    };
  });
}

function getByIndex(storeName, indexName, value) {
  return new Promise((resolve) => {
    if (!db) return resolve([]);
    const tx = db.transaction([storeName], 'readonly');
    const out = [];
    tx.objectStore(storeName).index(indexName).openCursor(value).onsuccess = (e) => {
      const cursor = e.target.result;
      if (cursor) { out.push(cursor.value); cursor.continue(); }
      else resolve(out);
    };
  });
}

function getOne(storeName, key) {
  return new Promise((resolve) => {
    if (!db) return resolve(null);
    const tx = db.transaction([storeName], 'readonly');
    tx.objectStore(storeName).get(key).onsuccess = (e) => resolve(e.target.result || null);
  });
}

export const DbCore = {
  openDB, getDb, putAll, put, remove, clearStore, getAll, getByIndex, getOne,
};
