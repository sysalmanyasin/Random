import { Repo } from '../repository.js';
import { Store } from '../store.js';
import { Bus } from './bus.js';

/* ══════════════════════════════════════════════════════════════
   FLOOR 3 — ACTIONS / legacy-actions.js
   What's left after retiring the original single-auditor app's
   audit-session/History/WhatsApp-PDF-signoff workflow — Individual
   Assignments (individual-actions.js) and Team Audit now cover that
   whole workflow, backed by Supabase.

   Dropbox is pull-only now, per design: it's the master-inventory
   source, refreshed on demand or on a timer — it no longer pushes
   anything back (the old syncPushToCloud/pharma_audit_sync.json
   channel existed to keep two independent single-device apps in
   sync before Supabase was the shared source of truth; that job is
   Supabase's now). Settings, CSV import, full backup/restore, the
   PIN gate's underlying verify/save, and the encrypted connection-
   token handoff are all still genuinely general-purpose and stay.
   ══════════════════════════════════════════════════════════════ */

export const LegacyActions = (() => {

  const SETTINGS_BRANCH_KEY = 'app_branch_name';
  const SETTINGS_DROPBOX_KEY_OVERRIDE = 'app_dropbox_app_key';
  const SETTINGS_AUTOSYNC_KEY = 'app_autosync_enabled';
  const SETTINGS_PIN_KEY = 'app_settings_pin';
  const DEFAULT_BRANCH_NAME = 'Bahria Town Branch';
  const DEFAULT_PIN = '1218';
  const DROPBOX_TOKEN_KEY = 'dropbox_access_token';
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
    Bus.emit('products:changed', products);
    Bus.emit('toast', { msg: `Loaded ${products.length.toLocaleString()} items successfully`, kind: 'success' });
    Bus.emit('csv:imported', { count: products.length });
  }

  // ── Inventory import (Dropbox PULL) — the only Dropbox traffic
  // this app generates now; nothing is ever pushed back. ──
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
      Bus.emit('products:changed', products);
      const now = Date.now();
      Repo.LS.set(DBX_LAST_FETCH_KEY, String(now));
      Bus.emit('dbxInventoryFetch:success', { count: products.length, fetchedAt: now });
      if (!silent) Bus.emit('toast', { msg: 'Inventory loaded — ' + products.length.toLocaleString() + ' products', kind: 'success' });
    } catch (err) {
      const msg = String(err.message || err);
      Bus.emit('dbxInventoryFetch:error', { msg });
      // "online" access-type Dropbox tokens deliberately expire (~4h) with no
      // refresh token — surface that through the same friendly-expiry
      // handling every other Dropbox call uses, rather than a raw SDK error.
      if (isAuthError(err)) { handleCloudAuthExpired(silent); return; }
      if (!silent) Bus.emit('toast', { msg: 'Fetch failed: ' + msg, kind: 'error' });
    }
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

  // ── Cloud sync (Dropbox) — pull-only ───────────────────
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

  // Tapping the sync bar re-pulls the latest inventory (or starts
  // linking, if not yet connected) — there is nothing left to "push."
  function cloudBarTapped() {
    if (!getDropboxToken()) { initiateDropboxOAuthFlow(); return; }
    importInventoryFromDropbox(false);
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
    setTimeout(() => importInventoryFromDropbox(true), 1400);
    if (freshOAuth) Bus.emit('toast', { msg: 'Dropbox linked!', kind: 'success' });

    if (isAutoSyncEnabled()) setTimeout(() => startAutoSync(), 1600);

    Bus.emit('settings:dropboxStatusChanged', { linked: true });
    Bus.emit('inventoryHub:changed', {});

    const lastFetch = Repo.LS.get(DBX_LAST_FETCH_KEY);
    if (lastFetch) Bus.emit('dbxInventoryFetch:lastKnown', { fetchedAt: parseInt(lastFetch) });
  }

  function toggleAutoSync(enabled) {
    if (enabled) {
      if (!getDropboxToken()) { Bus.emit('toast', { msg: 'Link Dropbox first', kind: 'error' }); Bus.emit('settings:autoSyncRejected', {}); return; }
      Repo.LS.set(SETTINGS_AUTOSYNC_KEY, '1');
      startAutoSync();
      Bus.emit('toast', { msg: 'Auto-refresh enabled — inventory re-pulled from Dropbox periodically', kind: 'success' });
    } else {
      Repo.LS.set(SETTINGS_AUTOSYNC_KEY, '0');
      stopAutoSync();
      Bus.emit('toast', { msg: 'Auto-refresh disabled', kind: 'success' });
    }
  }

  // Periodically re-pulls inventory (never pushes) — every logged-in
  // user then just always sees whatever the Main Auditor last synced,
  // since inventory itself lives in this app's local/Dropbox-fed store,
  // not per-device state.
  function startAutoSync() {
    if (Store.getState().autoSyncTimer) return;
    const timer = setInterval(() => {
      if (!Store.getState().dbxClient) return;
      importInventoryFromDropbox(true);
    }, 60000);
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
      setTimeout(() => importInventoryFromDropbox(true), 600);
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
    bootstrapLegacy, importCSVFile, importInventoryFromDropbox,
    saveBranchName, saveDropboxAppKey, exportFullBackup, restoreFullBackup,
    cloudBarTapped, unlinkDropbox,
    toggleAutoSync, exportConnectionToken, applyImportedToken, verifyPin, saveSettingsPin,
  };
})();
