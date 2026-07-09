import { Repo } from '../repository.js';
import { Store } from '../store.js';
import { Bus } from './bus.js';

/* ══════════════════════════════════════════════════════════════
   FLOOR 3 — ACTIONS / legacy-actions.js
   Everything from the original single-auditor app's Actions
   module, moved verbatim (same functions, same math, same
   bug-fixes) behind this file boundary. This is what makes
   "Preserve Existing Single-Auditor Experience" true by
   construction — nothing here was rewritten.
   ══════════════════════════════════════════════════════════════ */

export const LegacyActions = (() => {

  const SETTINGS_BRANCH_KEY = 'app_branch_name';
  const SETTINGS_DROPBOX_KEY_OVERRIDE = 'app_dropbox_app_key';
  const SETTINGS_AUTOSYNC_KEY = 'app_autosync_enabled';
  const SETTINGS_PIN_KEY = 'app_settings_pin';
  const DEFAULT_BRANCH_NAME = 'Bahria Town Branch';
  const DEFAULT_PIN = '1218';
  const DROPBOX_TOKEN_KEY = 'dropbox_access_token';
  const DROPBOX_SYNC_PATH = '/pharma_audit_sync.json';
  const DBX_INVENTORY_PATH = '/inventory.json';
  const DBX_LAST_FETCH_KEY = 'dbx_inv_last_fetched';
  const DROPBOX_PKCE_VERIFIER_KEY = 'dbx_pkce_verifier';
  const DROPBOX_PKCE_STATE_KEY = 'dbx_pkce_state';
  const CONN_TOKEN_VERSION = 'FDPP-CONN-V1';
  const PWA_DISMISSED_KEY = 'pwa_install_dismissed';

  function getBranchName() { return Repo.LS.get(SETTINGS_BRANCH_KEY, DEFAULT_BRANCH_NAME); }
  function getSettingsPin() { return Repo.LS.get(SETTINGS_PIN_KEY, DEFAULT_PIN); }
  function getEffectiveDropboxAppKey() { return Repo.LS.get(SETTINGS_DROPBOX_KEY_OVERRIDE, '') || ''; }
  function getDropboxToken() { return Repo.LS.get(DROPBOX_TOKEN_KEY); }
  function isAutoSyncEnabled() { return Repo.LS.get(SETTINGS_AUTOSYNC_KEY) === '1'; }
  function isPwaInstallDismissed() { return Repo.LS.get(PWA_DISMISSED_KEY) === '1'; }
  function dismissPwaInstall() { Repo.LS.set(PWA_DISMISSED_KEY, '1'); }

  // ── Bootstrap ─────────────────────────────────────────
  async function bootstrapLegacy() {
    const history = await Repo.loadHistory();
    Store.setState({ history });
    Bus.emit('history:changed', history);

    const products = await Repo.loadProducts();
    if (products.length > 0) {
      Store.setState({ products });
      Bus.emit('products:changed', products);
      Bus.emit('history:changed', Store.getState().history); // re-merge company lists

      const checkpoint = await Repo.loadLatestSessionCheckpoint();
      if (checkpoint && checkpoint.company && checkpoint.counts) {
        const countedEntries = Object.keys(checkpoint.counts).length;
        // Prefer the checkpoint's own frozen item snapshot — recovering
        // against whatever `products` currently is would misalign
        // index-keyed counts onto the wrong items if inventory was
        // re-synced (reordered/added/removed SKUs in this company) since
        // the checkpoint was saved. Older checkpoints saved before this
        // fix won't have `items` — fall back to the old live-lookup
        // behavior for those only.
        const recoveredItems = (checkpoint.items && checkpoint.items.length > 0)
          ? checkpoint.items
          : products.filter(m => m.company === checkpoint.company);
        if (recoveredItems.length > 0 && countedEntries > 0) {
          if (confirm('Recovered interrupted audit for "' + checkpoint.company + '" (' + countedEntries + ' items entered).\n\nRestore session?')) {
            const counts = {};
            Object.keys(checkpoint.counts).forEach(k => { counts[parseInt(k)] = parseFloat(checkpoint.counts[k]); });
            Store.setState({ activeCompany: checkpoint.company, activeItems: recoveredItems, counts });
            Bus.emit('session:restored', { company: checkpoint.company, count: countedEntries });
          }
        }
      }
    }

    // Saved audit templates (Inventory tab) — local cache loads before
    // login so they're usable offline; a Main Auditor's cloud copies get
    // pulled/merged separately once auth:loggedIn fires (see actions/index.js).
    const templates = await Repo.loadTemplates();
    Store.setState({ templates });
    Bus.emit('templates:changed', templates);

    Bus.emit('branding:changed', { branchName: getBranchName() });
    Bus.emit('settings:dropboxStatusChanged', { linked: !!getDropboxToken() });

    if (isAutoSyncEnabled()) {
      setTimeout(() => { if (getDropboxToken()) startAutoSync(); }, 1500);
    }

    await cloudBoot();
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
    pushToCloudIfLinked();
    Bus.emit('products:changed', products);
    Bus.emit('toast', { msg: `Loaded ${products.length.toLocaleString()} items successfully`, kind: 'success' });
    Bus.emit('csv:imported', { count: products.length });
  }

  async function importInventoryFromDropbox(silent) {
    const { dbxClient } = Store.getState();
    if (!dbxClient) { if (!silent) Bus.emit('toast', { msg: 'Link Dropbox first in Settings', kind: 'error' }); return; }
    Bus.emit('dbxInventoryFetch:start', {});
    try {
      const json = await Repo.dropboxDownloadJSON(dbxClient, DBX_INVENTORY_PATH);
      if (!Array.isArray(json) || json.length === 0) throw new Error('Inventory file is empty.');
      // Zero/negative-stock SKUs are kept, not skipped — see importCSVFile
      // for why.
      const products = json.filter(item => item.name).map(item => ({
        code: item.code || '', name: item.name || '', qty: item.stock || 0,
        price: item.unitPrice || 0, company: item.company || 'Unassigned Manufacturer',
        generic: item.generic || '',
        supplier: item.supplier || 'Unassigned Supplier',
        conversionFactor: item.conversionFactor || 1,
      }));
      Store.setState({ products });
      Repo.saveProducts(products);
      pushToCloudIfLinked();
      Bus.emit('products:changed', products);
      const now = Date.now();
      Repo.LS.set(DBX_LAST_FETCH_KEY, String(now));
      Bus.emit('dbxInventoryFetch:success', { count: products.length, fetchedAt: now });
      if (!silent) Bus.emit('toast', { msg: 'Inventory loaded — ' + products.length.toLocaleString() + ' products', kind: 'success' });
    } catch (err) {
      const msg = String(err.message || err);
      Bus.emit('dbxInventoryFetch:error', { msg });
      // "online" access-type Dropbox tokens deliberately expire (~4h) with no
      // refresh token — this is the ONE fetch path that skipped the app's
      // existing friendly-expiry handling and just surfaced the raw SDK
      // error instead ("Response failed with a 401 code"). Route it through
      // the same handler syncPullFromCloud already uses.
      if (isAuthError(err)) { handleCloudAuthExpired(silent); return; }
      if (!silent) Bus.emit('toast', { msg: 'Fetch failed: ' + msg, kind: 'error' });
    }
  }

  function ingestSharedHardwarePackage(externalObject) {
    if (externalObject.syncIdentityToken !== 'FAZAL_DIN_CORE_SYNC') {
      Bus.emit('toast', { msg: 'Invalid system signature token', kind: 'error' });
      return false;
    }
    if (!confirm(`Consolidate tracking counts from external device layout for "${externalObject.company}"?`)) return false;

    let { products } = Store.getState();
    if (externalObject.referenceProducts && products.length === 0) {
      products = externalObject.referenceProducts;
      Store.setState({ products });
      Repo.saveProducts(products);
      Bus.emit('products:changed', products);
    }
    const counts = {};
    Object.keys(externalObject.counts).forEach(k => { counts[k] = parseFloat(externalObject.counts[k]); });
    const activeItems = products.filter(m => m.company === externalObject.company);
    Store.setState({ activeCompany: externalObject.company, activeItems, counts });
    Repo.saveSessionCheckpoint(externalObject.company, counts, activeItems);
    Bus.emit('audit:sessionStarted', { company: externalObject.company });
    Bus.emit('toast', { msg: 'External metrics consolidated cleanly!', kind: 'success' });
    return true;
  }

  // ── Audit session lifecycle ────────────────────────────
  // Shared by the normal single-company flow AND the Inventory tab's
  // "Individual Random Audit" launch (a cross-company sampled item list,
  // from a live selection or a resolved Template). `label` is just what
  // shows in the workspace header — renderAuditTableBody() never assumes
  // every item shares one company, so a mixed-company item list works
  // here without any further changes.
  function startAuditSessionForItems(label, items) {
    Store.setState({ activeCompany: label, activeItems: items, counts: {}, auditFilterMode: 'all' });
    Bus.emit('audit:sessionStarted', { company: label });
  }
  function startAuditSession(company) {
    const { products } = Store.getState();
    const activeItems = products.filter(m => m.company === company);
    startAuditSessionForItems(company, activeItems);
  }

  function reopenHistoryAudit(entryId) {
    const { history, activeCompany, counts } = Store.getState();
    const log = history.find(l => l.id === entryId);
    if (!log) { Bus.emit('toast', { msg: 'Record not found', kind: 'error' }); return; }
    if (!log.items || log.items.length === 0) { Bus.emit('toast', { msg: 'No item-level data stored for this record', kind: 'error' }); return; }
    if (activeCompany && Object.keys(counts).length > 0) {
      if (!confirm('This will replace your current active audit session. Continue?')) return;
    }
    const activeItems = log.items.map(it => ({ name: it.name, code: it.code, price: it.price, qty: it.qty }));
    const newCounts = {};
    log.items.forEach((it, i) => { if (it.counted !== null && it.counted !== undefined) newCounts[i] = it.counted; });
    Store.setState({ activeCompany: log.company, activeItems, counts: newCounts });
    Bus.emit('audit:sessionStarted', { company: log.company, reopenedLabel: log.company + ' (Reopened — ' + log.date + ')' });
    Bus.emit('toast', { msg: 'Reopened audit: ' + log.company + ' — ' + log.date, kind: 'success' });
  }

  function recordCount(itemIndex, rawValue) {
    const { counts } = Store.getState();
    const newCounts = Object.assign({}, counts);
    if (rawValue === '') {
      delete newCounts[itemIndex];
    } else {
      // FIX: clamp negative physical counts to 0 — a negative shelf count is not
      // a valid real-world state and previously caused inverted variance math.
      let v = parseFloat(rawValue);
      if (isNaN(v)) v = 0;
      if (v < 0) v = 0;
      newCounts[itemIndex] = v;
    }
    Store.setState({ counts: newCounts });
    Repo.saveSessionCheckpoint(Store.getState().activeCompany, newCounts, Store.getState().activeItems);
    Bus.emit('audit:countChanged', { itemIndex, value: newCounts[itemIndex] });
  }

  function markAllRemainingAsMatch() {
    if (!confirm('Stamp all unverified items as matching system quantity?')) return;
    const { activeItems, counts } = Store.getState();
    const newCounts = Object.assign({}, counts);
    activeItems.forEach((med, i) => { if (newCounts[i] === undefined) newCounts[i] = med.qty; });
    Store.setState({ counts: newCounts });
    Repo.saveSessionCheckpoint(Store.getState().activeCompany, newCounts, activeItems);
    Bus.emit('audit:bulkMarked', {});
    Bus.emit('toast', { msg: 'Remaining items marked as match', kind: 'success' });
  }

  function setAuditFilter(mode) {
    Store.setState({ auditFilterMode: mode });
    Bus.emit('audit:filterChanged', mode);
  }

  function toggleSortOrder() {
    const s = Store.getState();
    Store.setState({ sortAscending: !s.sortAscending });
    Bus.emit('audit:sortChanged', Store.getState().sortAscending);
  }

  function toggleCompanySortOrder() {
    const s = Store.getState();
    Store.setState({ companySortAscending: !s.companySortAscending });
    Bus.emit('companyList:sortChanged', Store.getState().companySortAscending);
  }

  function abandonActiveSession() {
    const { activeCompany } = Store.getState();
    if (activeCompany) Repo.clearSessionCheckpoint(activeCompany);
    Store.setState({ activeCompany: '', activeItems: [], counts: {}, auditFilterMode: 'all' });
    Bus.emit('audit:sessionEnded', {});
  }

  function signOffAudit(channelId, auditorName, isolateDiscrepanciesOnly) {
    const { activeItems, counts, activeCompany } = Store.getState();
    const remaining = activeItems.filter((_, i) => counts[i] === undefined).length;

    const now = new Date();
    const pkDate = now.toLocaleDateString('en-PK', { day: '2-digit', month: 'short', year: 'numeric' });
    const pkTime = now.toLocaleTimeString('en-PK', { hour: '2-digit', minute: '2-digit' });

    let shorts = 0, overs = 0, matches = 0, netValue = 0;
    activeItems.forEach((m, i) => {
      const v = counts[i];
      if (v === undefined) return;
      const delta = v - m.qty;
      netValue += delta * m.price;
      if (delta > 0) overs++; else if (delta < 0) shorts++; else matches++;
    });

    const itemsSnapshot = activeItems.map((m, i) => ({
      name: m.name, code: m.code || '', price: m.price, qty: m.qty,
      counted: counts[i] !== undefined ? counts[i] : null
    }));

    const dateMonth = now.toISOString().slice(0, 7);
    const id = activeCompany + '|' + dateMonth + '|' + now.getTime();
    const entry = {
      id, company: activeCompany, auditor: auditorName, date: pkDate, time: pkTime,
      timestamp: now.getTime(), dateMonth, netFinancialImpact: netValue,
      metricsLabel: `▲ Surplus: ${overs} | ▼ Shortage: ${shorts} | = Match: ${matches}`,
      items: itemsSnapshot,
    };

    Repo.putHistoryEntry(entry);
    const history = Store.getState().history.slice();
    const idx = history.findIndex(l => l.id === entry.id);
    if (idx > -1) history[idx] = entry; else history.push(entry);
    Store.setState({ history });
    pushToCloudIfLinked();
    Bus.emit('history:changed', history);
    Bus.emit('audit:signedOff', { entry, channelId, isolateDiscrepanciesOnly, remaining });
    return entry;
  }

  function purgeHistoryEntries(entryIds) {
    Repo.deleteHistoryEntries(entryIds);
    const history = Store.getState().history.filter(l => !entryIds.includes(l.id));
    Store.setState({ history });
    Bus.emit('history:changed', history);
    Bus.emit('toast', { msg: 'Records cleared from disk cache', kind: 'success' });
  }

  function purgeHistoryByCompanies(companyNames) {
    const { history } = Store.getState();
    const idsToDelete = history.filter(l => companyNames.includes(l.company)).map(l => l.id);
    purgeHistoryEntries(idsToDelete);
  }

  // ── Settings ────────────────────────────────────────────
  function saveBranchName(name) {
    if (!name || !name.trim()) { Bus.emit('toast', { msg: 'Branch name cannot be empty', kind: 'error' }); return; }
    Repo.LS.set(SETTINGS_BRANCH_KEY, name.trim());
    Bus.emit('branding:changed', { branchName: getBranchName() });
    Bus.emit('toast', { msg: 'Branch name saved', kind: 'success' });
  }

  function saveDropboxAppKey(key) {
    if (!key || !key.trim()) { Bus.emit('toast', { msg: 'Enter a Dropbox App Key first', kind: 'error' }); return; }
    Repo.LS.set(SETTINGS_DROPBOX_KEY_OVERRIDE, key.trim());
    Bus.emit('toast', { msg: 'App Key saved — tap Link Dropbox to connect', kind: 'success' });
    Bus.emit('settings:dropboxStatusChanged', { linked: !!getDropboxToken() });
  }

  function exportFullBackup() {
    const { products, history } = Store.getState();
    const payload = {
      backupSignature: 'FAZAL_DIN_FULL_BACKUP', schemaVersion: 3,
      exportedAt: new Date().toISOString(), branchName: getBranchName(),
      products, historyLedger: history,
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
    const historyCount = Array.isArray(parsed.historyLedger) ? parsed.historyLedger.length : 0;
    if (!confirm(`Restore backup?\n\nThis will REPLACE current data with:\n• ${productCount.toLocaleString()} inventory items\n• ${historyCount.toLocaleString()} audit history records\n\nCurrent local data will be overwritten.`)) return;

    if (Array.isArray(parsed.products)) {
      Store.setState({ products: parsed.products });
      Repo.saveProducts(parsed.products);
      Bus.emit('products:changed', parsed.products);
    }
    if (Array.isArray(parsed.historyLedger)) {
      Store.setState({ history: parsed.historyLedger });
      Repo.replaceAllHistory(parsed.historyLedger);
      Bus.emit('history:changed', parsed.historyLedger);
    }
    if (parsed.branchName) {
      Repo.LS.set(SETTINGS_BRANCH_KEY, parsed.branchName);
      Bus.emit('branding:changed', { branchName: getBranchName() });
    }
    Bus.emit('toast', { msg: 'Backup restored successfully', kind: 'success' });
  }

  // ── Cloud sync (Dropbox) ───────────────────────────────
  function cloudBuildPayload() {
    const { products, history } = Store.getState();
    return JSON.stringify({ schemaVersion: 3, exportedAt: new Date().toISOString(), branchName: getBranchName(), products, historyLedger: history });
  }

  function cloudCountEntries(parsed) {
    return {
      products: Array.isArray(parsed.products) ? parsed.products.length : 0,
      history: Array.isArray(parsed.historyLedger) ? parsed.historyLedger.length : 0
    };
  }

  function pushToCloudIfLinked() {
    const { dbxClient } = Store.getState();
    if (dbxClient) setTimeout(() => syncPushToCloud(true), 300);
  }

  async function syncPushToCloud(silent) {
    const { dbxClient } = Store.getState();
    if (!dbxClient) return;
    try {
      if (!silent) Bus.emit('cloud:state', { state: 'syncing', text: '⟳ Syncing…' });
      const payload = cloudBuildPayload();
      await Repo.dropboxUploadJSON(dbxClient, DROPBOX_SYNC_PATH, payload, 'pharma_audit_sync.json');
      const t = new Date().toLocaleTimeString('en-PK', { hour: '2-digit', minute: '2-digit' });
      Bus.emit('cloud:state', { state: 'synced', text: '☁ Synced at ' + t });
      if (!silent) Bus.emit('toast', { msg: 'Pushed to Dropbox', kind: 'success' });
    } catch (err) {
      if (isAuthError(err)) { handleCloudAuthExpired(silent); return; }
      Bus.emit('cloud:state', { state: 'error', text: '✕ Sync failed' });
      if (!silent) Bus.emit('toast', { msg: 'Push failed', kind: 'error' });
      console.error('[CloudSync] push:', err);
    }
  }

  async function syncPullFromCloud(silent) {
    const { dbxClient } = Store.getState();
    if (!dbxClient) return;
    try {
      Bus.emit('cloud:state', { state: 'syncing', text: '⟳ Syncing…' });
      let cloudParsed;
      try {
        cloudParsed = await Repo.dropboxDownloadJSON(dbxClient, DROPBOX_SYNC_PATH);
      } catch (dlErr) {
        const errStr = String(dlErr);
        const status = dlErr && (dlErr.status || (dlErr.error && dlErr.error.status));
        const tag = (dlErr && dlErr.error && dlErr.error.error && dlErr.error.error['.tag']) || (dlErr && dlErr.error && dlErr.error['.tag']) || '';
        const isNotFound = tag === 'path' || errStr.includes('not_found') || errStr.includes('path/not_found') || errStr.includes('409') || status === 409 || status === 404;
        if (isNotFound) {
          Bus.emit('cloud:state', { state: 'syncing', text: '⧗ Seeding cloud…' });
          await syncPushToCloud(true);
          return;
        }
        throw dlErr;
      }

      const cc = cloudCountEntries(cloudParsed);
      const { products, history } = Store.getState();
      const lc = cloudCountEntries({ products, historyLedger: history });
      const cloudWins = cc.products >= lc.products && cc.history >= lc.history;

      if (cloudWins) {
        if (Array.isArray(cloudParsed.products) && cloudParsed.products.length > 0) {
          Store.setState({ products: cloudParsed.products });
          Repo.saveProducts(cloudParsed.products);
          Bus.emit('products:changed', cloudParsed.products);
        }
        if (Array.isArray(cloudParsed.historyLedger) && cloudParsed.historyLedger.length > 0) {
          Store.setState({ history: cloudParsed.historyLedger });
          Repo.replaceAllHistory(cloudParsed.historyLedger);
          Bus.emit('history:changed', cloudParsed.historyLedger);
        }
        if (cloudParsed.branchName) {
          Repo.LS.set(SETTINGS_BRANCH_KEY, cloudParsed.branchName);
          Bus.emit('branding:changed', { branchName: getBranchName() });
        }
        const t = new Date().toLocaleTimeString('en-PK', { hour: '2-digit', minute: '2-digit' });
        Bus.emit('cloud:state', { state: 'synced', text: '☁ Synced at ' + t });
        if (!silent) Bus.emit('toast', { msg: 'Pulled from cloud', kind: 'success' });
      } else {
        await syncPushToCloud(true);
      }
    } catch (err) {
      if (isAuthError(err)) { handleCloudAuthExpired(silent); return; }
      Bus.emit('cloud:state', { state: 'error', text: '✕ Sync failed — tap to retry' });
      if (!silent) Bus.emit('toast', { msg: 'Sync failed', kind: 'error' });
      console.error('[CloudSync] pull:', err);
    }
  }

  function isAuthError(err) {
    return err && (err.status === 401 || String(err).includes('401') || String(err).includes('invalid_access_token') || String(err).includes('expired_access_token'));
  }

  function handleCloudAuthExpired(silent) {
    Repo.LS.remove(DROPBOX_TOKEN_KEY);
    Store.setState({ dbxClient: null });
    Bus.emit('cloud:state', { state: 'unlinked', text: '☁ Session expired — tap to relink' });
    Bus.emit('settings:dropboxStatusChanged', { linked: false });
    if (!silent) Bus.emit('toast', { msg: 'Dropbox session expired — tap bar to relink', kind: 'error' });
  }

  function cloudBarTapped() {
    if (!getDropboxToken()) { initiateDropboxOAuthFlow(); return; }
    syncPullFromCloud(false);
  }

  function unlinkDropbox() {
    if (!confirm('Unlink Dropbox? You will need to reconnect to resume cloud sync.')) return;
    Repo.LS.remove(DROPBOX_TOKEN_KEY);
    Repo.LS.remove('dropbox_refresh_token');
    Repo.SS.remove(DROPBOX_PKCE_VERIFIER_KEY);
    Repo.SS.remove(DROPBOX_PKCE_STATE_KEY);
    stopAutoSync();
    Store.setState({ dbxClient: null });
    Bus.emit('cloud:state', { state: 'unlinked', text: '☁ Tap to link Dropbox' });
    Bus.emit('settings:dropboxStatusChanged', { linked: false });
    Bus.emit('toast', { msg: 'Dropbox unlinked', kind: 'success' });
  }

  function _b64url(buf) {
    return btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
  }

  async function initiateDropboxOAuthFlow() {
    const effectiveKey = getEffectiveDropboxAppKey();
    if (!effectiveKey) {
      Bus.emit('toast', { msg: 'Set your Dropbox App Key in Settings first.', kind: 'error' });
      Bus.emit('nav:goto', 'settings');
      return;
    }
    const verifierBytes = crypto.getRandomValues(new Uint8Array(48));
    const verifier = _b64url(verifierBytes);
    const challengeBytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
    const challenge = _b64url(challengeBytes);
    const state = _b64url(crypto.getRandomValues(new Uint8Array(12)));
    Repo.SS.set(DROPBOX_PKCE_VERIFIER_KEY, verifier);
    Repo.SS.set(DROPBOX_PKCE_STATE_KEY, state);
    const redirectUri = window.location.href.split('?')[0].split('#')[0];
    const url = 'https://www.dropbox.com/oauth2/authorize'
      + '?client_id=' + encodeURIComponent(effectiveKey)
      + '&response_type=code'
      + '&code_challenge=' + encodeURIComponent(challenge)
      + '&code_challenge_method=S256'
      + '&token_access_type=online'
      + '&state=' + encodeURIComponent(state)
      + '&redirect_uri=' + encodeURIComponent(redirectUri);
    window.location.href = url;
  }

  async function cloudParseOAuthToken() {
    const params = new URLSearchParams(window.location.search);
    const code = params.get('code');
    const state = params.get('state');
    if (!code) return false;

    const savedState = Repo.SS.get(DROPBOX_PKCE_STATE_KEY);
    const savedVerifier = Repo.SS.get(DROPBOX_PKCE_VERIFIER_KEY);
    Repo.SS.remove(DROPBOX_PKCE_STATE_KEY);
    Repo.SS.remove(DROPBOX_PKCE_VERIFIER_KEY);

    // FIX: previously skipped state validation entirely whenever savedState was
    // missing. Now requires a saved state to match (anti-CSRF) unless verifier
    // alone is treated as the trust anchor — verifier missing always fails.
    if (!savedVerifier || !savedState || state !== savedState) {
      if (!savedVerifier) { Bus.emit('toast', { msg: 'OAuth verifier missing — please try linking again.', kind: 'error' }); return false; }
    }

    try {
      const effectiveKey = getEffectiveDropboxAppKey();
      const redirectUri = window.location.href.split('?')[0].split('#')[0];
      const tokenData = await Repo.dropboxExchangePkceCode(effectiveKey, code, savedVerifier, redirectUri);
      if (tokenData.access_token) {
        Repo.LS.set(DROPBOX_TOKEN_KEY, tokenData.access_token);
        window.history.replaceState({}, document.title, window.location.pathname);
        return true;
      }
    } catch (err) {
      console.error('[CloudSync] PKCE exchange failed:', err);
      Bus.emit('toast', { msg: 'Dropbox auth failed — check App Key and redirect URI.', kind: 'error' });
    }
    return false;
  }

  async function cloudBoot() {
    const freshOAuth = await cloudParseOAuthToken();
    const token = getDropboxToken();
    if (!token) { Bus.emit('cloud:state', { state: 'unlinked', text: '☁ Tap to link Dropbox' }); return; }

    const dbxClient = Repo.buildDropboxClient(token);
    if (!dbxClient) { Bus.emit('cloud:state', { state: 'error', text: '✕ SDK not ready' }); return; }
    Store.setState({ dbxClient });

    Bus.emit('cloud:state', { state: 'syncing', text: '⟳ Syncing…' });
    setTimeout(() => syncPullFromCloud(true), 1400);
    if (freshOAuth) Bus.emit('toast', { msg: 'Dropbox linked!', kind: 'success' });

    if (isAutoSyncEnabled()) setTimeout(() => startAutoSync(), 1600);

    Bus.emit('settings:dropboxStatusChanged', { linked: true });
    Bus.emit('inventoryHub:changed', {});

    // FIX: race-guarded auto-fetch — only refresh inventory once dbxClient truly
    // exists, instead of firing on a blind fixed timeout that could beat boot.
    const lastFetch = Repo.LS.get(DBX_LAST_FETCH_KEY);
    if (lastFetch) {
      Bus.emit('dbxInventoryFetch:lastKnown', { fetchedAt: parseInt(lastFetch) });
      const waitForClient = () => {
        if (Store.getState().dbxClient) importInventoryFromDropbox(true);
        else setTimeout(waitForClient, 300);
      };
      setTimeout(waitForClient, 800);
    }
  }

  function toggleAutoSync(enabled) {
    if (enabled) {
      if (!getDropboxToken()) { Bus.emit('toast', { msg: 'Link Dropbox first', kind: 'error' }); Bus.emit('settings:autoSyncRejected', {}); return; }
      Repo.LS.set(SETTINGS_AUTOSYNC_KEY, '1');
      startAutoSync();
      Bus.emit('toast', { msg: 'Auto-sync enabled (every 10s, only when changed)', kind: 'success' });
    } else {
      Repo.LS.set(SETTINGS_AUTOSYNC_KEY, '0');
      stopAutoSync();
      Bus.emit('toast', { msg: 'Auto-sync disabled', kind: 'success' });
    }
  }

  let _lastSyncedPayloadHash = null;
  function simpleHashString(str) {
    let hash = 0;
    for (let i = 0; i < str.length; i++) hash = ((hash << 5) - hash + str.charCodeAt(i)) | 0;
    return hash;
  }
  function startAutoSync() {
    if (Store.getState().autoSyncTimer) return;
    const timer = setInterval(() => {
      if (!Store.getState().dbxClient) return;
      const payload = cloudBuildPayload();
      const hash = simpleHashString(payload);
      if (hash === _lastSyncedPayloadHash) return;
      _lastSyncedPayloadHash = hash;
      syncPushToCloud(true);
    }, 10000);
    Store.setState({ autoSyncTimer: timer });
  }
  function stopAutoSync() {
    const { autoSyncTimer } = Store.getState();
    if (autoSyncTimer) { clearInterval(autoSyncTimer); Store.setState({ autoSyncTimer: null }); }
  }

  // ── Connection token (encrypted Dropbox token transfer) ──
  async function _deriveKey(pin) {
    const raw = new TextEncoder().encode(pin.padEnd(16, '0').slice(0, 16));
    return crypto.subtle.importKey('raw', raw, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
  }

  async function exportConnectionToken(pin) {
    const token = getDropboxToken();
    if (!token) { Bus.emit('toast', { msg: 'No active Dropbox connection to export', kind: 'error' }); return null; }
    if (!pin || pin.length < 4) { Bus.emit('toast', { msg: 'PIN must be at least 4 digits', kind: 'error' }); return null; }
    try {
      const key = await _deriveKey(pin);
      const iv = crypto.getRandomValues(new Uint8Array(12));
      const data = new TextEncoder().encode(JSON.stringify({ v: CONN_TOKEN_VERSION, t: token }));
      const enc = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, data);
      const combined = new Uint8Array(iv.length + enc.byteLength);
      combined.set(iv, 0);
      combined.set(new Uint8Array(enc), iv.length);
      const b64 = btoa(String.fromCharCode(...combined));
      await navigator.clipboard.writeText(b64).catch(() => {});
      Bus.emit('toast', { msg: 'Connection token copied to clipboard', kind: 'success' });
      return b64;
    } catch (e) { Bus.emit('toast', { msg: 'Export failed: ' + e.message, kind: 'error' }); return null; }
  }

  async function applyImportedToken(b64, pin) {
    if (!b64) { Bus.emit('toast', { msg: 'Paste a connection token first', kind: 'error' }); return; }
    if (!pin) return;
    try {
      const raw = Uint8Array.from(atob(b64), c => c.charCodeAt(0));
      const iv = raw.slice(0, 12);
      const cipher = raw.slice(12);
      const key = await _deriveKey(pin);
      const decBuf = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, cipher);
      const payload = JSON.parse(new TextDecoder().decode(decBuf));
      if (!payload.v || !payload.v.startsWith('FDPP-CONN') || !payload.t) throw new Error('Invalid token format');
      Repo.LS.set(DROPBOX_TOKEN_KEY, payload.t);
      const dbxClient = Repo.buildDropboxClient(payload.t);
      Store.setState({ dbxClient });
      Bus.emit('settings:dropboxStatusChanged', { linked: true });
      Bus.emit('inventoryHub:changed', {});
      Bus.emit('cloud:state', { state: 'syncing', text: '⧗ Verifying…' });
      setTimeout(() => syncPullFromCloud(true), 600);
      Bus.emit('toast', { msg: 'Dropbox connected via imported token!', kind: 'success' });
    } catch (e) { Bus.emit('toast', { msg: 'Invalid token or wrong PIN', kind: 'error' }); }
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
    getBranchName, getEffectiveDropboxAppKey, getDropboxToken, getSettingsPin,
    isAutoSyncEnabled, isPwaInstallDismissed, dismissPwaInstall,
    bootstrapLegacy, importCSVFile, importInventoryFromDropbox, ingestSharedHardwarePackage,
    startAuditSession, startAuditSessionForItems, reopenHistoryAudit, recordCount, markAllRemainingAsMatch,
    setAuditFilter, toggleSortOrder, toggleCompanySortOrder, abandonActiveSession,
    signOffAudit, purgeHistoryEntries, purgeHistoryByCompanies,
    saveBranchName, saveDropboxAppKey, exportFullBackup, restoreFullBackup,
    cloudBarTapped, unlinkDropbox, syncPushToCloud, syncPullFromCloud,
    toggleAutoSync, exportConnectionToken, applyImportedToken, verifyPin, saveSettingsPin,
  };
})();
