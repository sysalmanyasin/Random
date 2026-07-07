/* ══════════════════════════════════════════════════════════════
   FLOOR 1 — REPOSITORY (barrel)
   The ONLY import path other floors use for storage. Internally
   split into js/repository/*.js by concern (db core, legacy
   single-auditor stores, new multi-auditor entities, localStorage/
   sessionStorage, Dropbox network) — but the golden rule still
   holds file-system-wide: grep for `localStorage.`, `sessionStorage.`,
   `indexedDB.` or `Dropbox.` outside js/repository/* → zero matches.
   No other floor may import anything from js/repository/* directly;
   everyone goes through this barrel.
   ══════════════════════════════════════════════════════════════ */
import { DbCore } from './repository/db.js';
import { LegacyRepo } from './repository/legacy.js';
import { LS, SS } from './repository/storage.js';
import { DropboxRepo } from './repository/dropbox.js';
import { SupabaseRepo } from './repository/supabase.js';

export const Repo = {
  // db lifecycle
  openDB: DbCore.openDB,

  // legacy single-auditor stores (inventory, session checkpoint, history)
  ...LegacyRepo,

  // localStorage / sessionStorage
  LS, SS,

  // Dropbox — inventory sync only now
  ...DropboxRepo,

  // Supabase — multi-auditor engagements/rounds/assignments/submissions/staff
  ...SupabaseRepo,
};
