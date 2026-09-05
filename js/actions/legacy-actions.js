import { Repo } from '../repository.js';
import { Store } from '../store.js';
import { Bus } from './bus.js';

/* ══════════════════════════════════════════════════════════════
   FLOOR 3 — ACTIONS / legacy-actions.js
   What's left after retiring the original single-auditor app's
   audit-session/History/WhatsApp-PDF-signoff workflow — Individual
   Assignments (individual-actions.js) and Team Audit now cover that
   whole workflow, backed by Supabase.

   Inventory sync moved server-side on 2026-07-14: a Supabase Edge
   Function (sync-inventory-from-dropbox) now owns the one Dropbox
   token and does the actual pull, replacing the old per-device
   Dropbox OAuth link + 60s auto-sync timer + encrypted connection-
   token handoff (all removed — no client ever talks to Dropbox
   directly anymore). Settings, CSV import, full backup/restore, and
   the PIN gate's underlying verify/save are still genuinely
   general-purpose and stay.
   ══════════════════════════════════════════════════════════════ */

export const LegacyActions = (() => {

  const SETTINGS_BRANCH_KEY = 'app_branch_name';
  const SETTINGS_PIN_KEY = 'app_settings_pin';
  const DEFAULT_BRANCH_NAME = 'Bahria Town Branch';
  const DEFAULT_PIN = '1218';
  const INVENTORY_LAST_SYNCED_KEY = 'inventory_last_synced_at';
  const PWA_DISMISSED_KEY = 'pwa_install_dismissed';

  function getBranchName() { return Repo.LS.get(SETTINGS_BRANCH_KEY, DEFAULT_BRANCH_NAME); }
  function getSettingsPin() { return Repo.LS.get(SETTINGS_PIN_KEY, DEFAULT_PIN); }
  function isPwaInstallDismissed() { return Repo.LS.get(PWA_DISMISSED_KEY) === '1'; }
  function dismissPwaInstall() { Repo.LS.set(PWA_DISMISSED_KEY, '1'); }

  // ── Bootstrap ─────────────────────────────────────────
  async function bootstrapLegacy() {
    const products = await Repo.loadProducts();
    if (products.length > 0) {
      Store.setState({ products });
      Bus.emit('products:changed', products);
    }

    // Saved audit templates (Inventory tab) — local cache loads before
    // login so they're usable offline; a Main Auditor's cloud copies get
    // pulled/merged separately once auth:loggedIn fires (see actions/index.js).
    const templates = await Repo.loadTemplates();
    Store.setState({ templates });
    Bus.emit('templates:changed', templates);

    Bus.emit('branding:changed', { branchName: getBranchName() });

    const lastSynced = Repo.LS.get(INVENTORY_LAST_SYNCED_KEY);
    if (lastSynced) {
      Store.setState({ inventoryLastSyncedAt: parseInt(lastSynced) });
      Bus.emit('dbxInventoryFetch:lastKnown', { fetchedAt: parseInt(lastSynced) });
    }
    // The live shared inventory now loads from Supabase once logged in
    // (see actions/index.js auth:loggedIn) — that needs an
    // authenticated session, so it can't happen here at cold boot.
    // This local cache (Repo.loadProducts, above) is what a device
    // shows before/without a connection.
  }

  // ── Inventory import (CSV) ─────────────────────────────
  function parseCSVFileLines(text) {
    const rows = text.trim().split(/\r?\n/);
    if (rows.length < 2) return [];
    const headers = rows[0].split(',').map(h => h.trim().replace(/"/g, ''));
    return rows.slice(1).map(line => {
      const parsedLineArray = [];
      let inQuotes = false, cur = '';
      for (let i = 0; i < line.length; i++) {
        const c = line[i];
        if (c === '"') { inQuotes = !inQuotes; continue; }
        if (c === ',' && !inQuotes) { parsedLineArray.push(cur.trim()); cur = ''; continue; }
        cur += c;
      }
      parsedLineArray.push(cur.trim());
      const rowObject = {};
      headers.forEach((h, idx) => { rowObject[h] = (parsedLineArray[idx] ?? '').replace(/"/g, '').trim(); });
      return rowObject;
    }).filter(r => Object.values(r).some(v => v !== ''));
  }

  function mapNormalizedSchema(raw) {
    const fetchField = (...keys) => {
      for (const k of keys) {
        const match = Object.keys(raw).find(rk => rk.trim().toLowerCase() === k.toLowerCase());
        if (match) return raw[match] || '';
      }
      return '';
    };
    return {
      code: fetchField('Product Code', 'Code', 'ProductCode'),
      name: fetchField('Product Name', 'Name', 'Medicine', 'ProductName'),
      qty: parseFloat(fetchField('Quantity', 'Qty', 'Stock', 'System Qty')) || 0,
      price: parseFloat(fetchField('Retail Price', 'Price', 'RetailPrice')) || 0,
      company: fetchField('Manufacture', 'Company', 'Manufacturer', 'Brand') || 'Unassigned Manufacturer',
      generic: fetchField('Generic Detail', 'Generic', 'GenericDetail'),
      supplier: fetchField('Supplier') || 'Unassigned Supplier',
      conversionFactor: parseFloat(fetchField('Conversion Factor')) || 1,
    };
  }

  async function importCSVFile(file) {
    const text = await file.text();
    const rawRows = parseCSVFileLines(text);
    if (rawRows.length === 0) { Bus.emit('toast', { msg: 'Data streams corrupted', kind: 'error' }); return; }
    // Zero/negative-stock SKUs are kept, not skipped — a shrinkage audit
    // needs to see a SKU that's now at zero (or negative, i.e. oversold)
    // just as much as a positive one, especially if a prior round already
    // flagged a variance on it and it needs re-verifying, not silently
    // dropping out of view.
    const products = rawRows.map(mapNormalizedSchema).filter(m => m.name);
    Store.setState({ products });
    Repo.saveProducts(products);
    Bus.emit('products:changed', products);
    Bus.emit('toast', { msg: `Loaded ${products.length.toLocaleString()} items successfully`, kind: 'success' });
    Bus.emit('csv:imported', { count: products.length });
  }

  // ── Inventory sync (Supabase, server-side Dropbox pull) ──
  // Replaces the old per-device Dropbox OAuth link + direct browser
  // pull + 60s auto-sync timer. The Edge Function now owns the one
  // Dropbox token and does the actual pull server-side (see
  // supabase/functions/sync-inventory-from-dropbox); every device
  // just reads the shared inventory_products table and can ask for a
  // fresh pull on demand. Any logged-in staff member (Main or Sub,
  // provided their access hasn't expired) can trigger a sync now.
  function _setLastSyncedLocal(ts) {
    Repo.LS.set(INVENTORY_LAST_SYNCED_KEY, String(ts));
    Store.setState({ inventoryLastSyncedAt: ts });
  }

  // Cheap, read-only refresh from the shared table — safe to call
  // often (right after login) since it never touches Dropbox itself.
  async function loadInventoryFromSupabase(silent) {
    const { sbClient } = Store.getState();
    if (!sbClient) return;
    try {
      const products = await Repo.fetchInventoryProducts(sbClient);
      if (products.length > 0) {
        Store.setState({ products });
        Repo.saveProducts(products); // keep an offline-usable local cache too
        Bus.emit('products:changed', products);
      }
      const latest = await Repo.fetchLatestInventorySync(sbClient);
      if (latest) {
        _setLastSyncedLocal(new Date(latest.syncedAt).getTime());
        Bus.emit('cloud:state', { state: 'synced', text: '✓ Synced' });
      } else {
        Bus.emit('cloud:state', { state: 'idle', text: '☁ Tap to sync inventory' });
      }
    } catch (err) {
      if (!silent) Bus.emit('toast', { msg: 'Could not load inventory: ' + String(err.message || err), kind: 'error' });
    }
  }

  // The actual "Load Latest Inventory" action — triggers the Edge
  // Function's real Dropbox pull + full-table replace, then re-reads
  // the result so this device's view reflects it immediately.
  // Returns a result object ({ok:true,count,fetchedAt} | {ok:false,error})
  // rather than throwing, so callers (e.g. ensureFreshInventoryForAudit
  // below) can branch on success/failure without needing try/catch —
  // every failure path here is already handled (toast + Bus event),
  // this is just handing the same outcome back to the caller too.
  async function triggerInventorySync(silent) {
    const { sbClient } = Store.getState();
    if (!sbClient) { if (!silent) Bus.emit('toast', { msg: 'Not signed in', kind: 'error' }); return { ok: false, error: 'Not signed in' }; }
    Bus.emit('dbxInventoryFetch:start', {});
    Bus.emit('cloud:state', { state: 'syncing', text: '⟳ Syncing…' });
    try {
      const result = await Repo.triggerInventorySyncRemote(sbClient);
      const products = await Repo.fetchInventoryProducts(sbClient);
      Store.setState({ products });
      Repo.saveProducts(products);
      Bus.emit('products:changed', products);
      const fetchedAt = result.syncedAt ? new Date(result.syncedAt).getTime() : Date.now();
      _setLastSyncedLocal(fetchedAt);
      const count = result.count ?? products.length;
      Bus.emit('dbxInventoryFetch:success', { count, fetchedAt });
      Bus.emit('cloud:state', { state: 'synced', text: '✓ Synced' });
      if (!silent) Bus.emit('toast', { msg: 'Inventory synced — ' + count.toLocaleString() + ' products', kind: 'success' });
      return { ok: true, count, fetchedAt };
    } catch (err) {
      const msg = String(err.message || err);
      Bus.emit('dbxInventoryFetch:error', { msg });
      Bus.emit('cloud:state', { state: 'error', text: '✕ Sync failed' });
      if (!silent) Bus.emit('toast', { msg: 'Sync failed: ' + msg, kind: 'error' });
      return { ok: false, error: msg };
    }
  }

  // Tapping the top status bar re-triggers a sync — same action as
  // the "Load Latest Inventory" button on the Sync tab.
  function cloudBarTapped() { triggerInventorySync(false); }

  // ── Fresh-inventory gate for Random Audit launches ──────────────
  // Both the self-service picker (sub-pages.js "Start a Random Audit")
  // and the Main Auditor's Team-engagement launch (inventory-pages.js)
  // freeze whatever is in Store.products the instant their round is
  // created (see individual-actions.js startIndividualAssignment /
  // round-actions.js createRound) — and Store.products only refreshes
  // at login or on a manual sync tap, never continuously in the
  // background. A session left open for a while can silently launch
  // an audit against inventory that's already behind Supabase's own
  // inventory_products table, with nothing telling the person it
  // happened.
  //
  // This forces one real sync immediately before a Random Audit is
  // allowed to start, so the snapshot that gets frozen is provably
  // current at launch time — not merely current as of whenever the
  // device last happened to sync. `skipIfSyncedWithinMs` lets a
  // second call right before the actual snapshot-taking step (e.g. a
  // slow picker session) skip a redundant round-trip if the gate that
  // opened the picker already synced recently enough.
  const AUDIT_SYNC_STALE_MS = 2 * 60 * 1000; // 2 minutes
  async function ensureFreshInventoryForAudit(opts) {
    const skipIfSyncedWithinMs = (opts && opts.skipIfSyncedWithinMs) || 0;
    if (skipIfSyncedWithinMs) {
      const { inventoryLastSyncedAt } = Store.getState();
      const age = inventoryLastSyncedAt ? Date.now() - inventoryLastSyncedAt : Infinity;
      if (age < skipIfSyncedWithinMs) return { ok: true, skipped: true };
    }
    return triggerInventorySync(true); // silent — callers show their own gate UI, not a toast
  }

  // ── Settings ────────────────────────────────────────────
  function saveBranchName(name) {
    if (!name || !name.trim()) { Bus.emit('toast', { msg: 'Branch name cannot be empty', kind: 'error' }); return; }
    Repo.LS.set(SETTINGS_BRANCH_KEY, name.trim());
    Bus.emit('branding:changed', { branchName: getBranchName() });
    Bus.emit('toast', { msg: 'Branch name saved', kind: 'success' });
  }

  function exportFullBackup() {
    const { products } = Store.getState();
    const payload = {
      backupSignature: 'FAZAL_DIN_FULL_BACKUP', schemaVersion: 4,
      exportedAt: new Date().toISOString(), branchName: getBranchName(),
      products,
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'FullBackup_' + new Date().toISOString().slice(0, 10) + '.json';
    a.click();
    Bus.emit('toast', { msg: 'Full backup downloaded', kind: 'success' });
  }

  async function restoreFullBackup(file) {
    const text = await file.text();
    let parsed;
    try { parsed = JSON.parse(text); } catch (e) {
      Bus.emit('toast', { msg: 'Failed to parse backup file', kind: 'error' }); return;
    }
    if (parsed.backupSignature !== 'FAZAL_DIN_FULL_BACKUP') {
      Bus.emit('toast', { msg: 'Invalid backup file signature', kind: 'error' }); return;
    }
    const productCount = Array.isArray(parsed.products) ? parsed.products.length : 0;
    // Older backups (schemaVersion <= 3) also carried a historyLedger —
    // that field is simply ignored now (the legacy History ledger it
    // fed no longer exists anywhere in the app), so restoring an old
    // backup still works, it just won't bring back audit history.
    if (!confirm(`Restore backup?\n\nThis will REPLACE current inventory with ${productCount.toLocaleString()} item(s).\n\nCurrent local data will be overwritten.`)) return;

    if (Array.isArray(parsed.products)) {
      Store.setState({ products: parsed.products });
      Repo.saveProducts(parsed.products);
      Bus.emit('products:changed', parsed.products);
    }
    if (parsed.branchName) {
      Repo.LS.set(SETTINGS_BRANCH_KEY, parsed.branchName);
      Bus.emit('branding:changed', { branchName: getBranchName() });
    }
    Bus.emit('toast', { msg: 'Backup restored successfully', kind: 'success' });
  }

  // ── PIN gate ────────────────────────────────────────────
  function verifyPin(pin) { return pin === getSettingsPin(); }

  function saveSettingsPin(currentPin, newPin, confirmPin) {
    if (!verifyPin(currentPin)) {
      Bus.emit('toast', { msg: 'Current PIN is incorrect', kind: 'error' });
      return false;
    }
    if (!/^\d{4}$/.test(newPin)) {
      Bus.emit('toast', { msg: 'New PIN must be exactly 4 digits', kind: 'error' });
      return false;
    }
    if (newPin !== confirmPin) {
      Bus.emit('toast', { msg: 'New PIN and confirmation do not match', kind: 'error' });
      return false;
    }
    Repo.LS.set(SETTINGS_PIN_KEY, newPin);
    Bus.emit('toast', { msg: 'Settings PIN updated', kind: 'success' });
    return true;
  }

  return {
    getBranchName, getSettingsPin,
    isPwaInstallDismissed, dismissPwaInstall,
    bootstrapLegacy, importCSVFile,
    loadInventoryFromSupabase, triggerInventorySync, cloudBarTapped, ensureFreshInventoryForAudit, AUDIT_SYNC_STALE_MS,
    saveBranchName, exportFullBackup, restoreFullBackup,
    verifyPin, saveSettingsPin,
  };
})();
