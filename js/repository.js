/* ══════════════════════════════════════════════════════════════
   FLOOR 1 — REPOSITORY (barrel)
   The ONLY import path other floors use for storage. Internally
   split into js/repository/*.js by concern (db core, legacy
   single-auditor stores, new multi-auditor entities, localStorage/
   sessionStorage) — but the golden rule still holds file-system-wide:
   grep for `localStorage.`, `sessionStorage.`, `indexedDB.` or
   `Dropbox.` outside js/repository/* → zero matches.
   No other floor may import anything from js/repository/* directly;
   everyone goes through this barrel.
   ══════════════════════════════════════════════════════════════ */
import { DbCore } from './repository/db.js';
import { LegacyRepo } from './repository/legacy.js';
import { TemplatesRepo } from './repository/templates.js';
import { LS, SS } from './repository/storage.js';
import { SupabaseRepo } from './repository/supabase.js';

export const Repo = {
  // db lifecycle
  openDB: DbCore.openDB,

  // legacy single-auditor stores (inventory, session checkpoint)
  ...LegacyRepo,

  // saved audit templates (Inventory tab, local-first)
  ...TemplatesRepo,

  // localStorage / sessionStorage
  LS, SS,

  // Supabase — multi-auditor engagements/rounds/assignments/submissions/
  // staff, and now also the shared inventory table + sync trigger
  // (Dropbox itself is pulled server-side only now — see
  // supabase/functions/sync-inventory-from-dropbox — so there is no
  // more client-side Dropbox networking module here).
  ...SupabaseRepo,
};
