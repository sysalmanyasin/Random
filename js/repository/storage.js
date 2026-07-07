/* ══════════════════════════════════════════════════════════════
   FLOOR 1 — REPOSITORY / storage.js
   Every localStorage/sessionStorage read or write in the entire
   app goes through these two objects. No other file — in any
   floor — may call localStorage.* or sessionStorage.* directly.
   ══════════════════════════════════════════════════════════════ */

export const LS = {
  get(key, fallback = null) { const v = localStorage.getItem(key); return v === null ? fallback : v; },
  set(key, val) { localStorage.setItem(key, val); },
  remove(key) { localStorage.removeItem(key); },
  getJSON(key, fallback = null) {
    const v = localStorage.getItem(key);
    if (v === null) return fallback;
    try { return JSON.parse(v); } catch { return fallback; }
  },
  setJSON(key, val) { localStorage.setItem(key, JSON.stringify(val)); },
};

export const SS = {
  get(key) { return sessionStorage.getItem(key); },
  set(key, val) { sessionStorage.setItem(key, val); },
  remove(key) { sessionStorage.removeItem(key); },
};
