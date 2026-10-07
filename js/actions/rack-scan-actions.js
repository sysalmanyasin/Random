import { Repo } from '../repository.js';
import { Store } from '../store.js';
import { Bus } from './bus.js';
import { logAudit } from './audit-log-actions.js';
import { BarcodeActions } from './barcode-actions.js';
import { RackCore } from '../rack/rack-scan-core.js';

/* ══════════════════════════════════════════════════════════════
   FLOOR 3 — ACTIONS / rack-scan-actions.js
   Rack Scan: verify whatever is on a rack, one item at a time, against
   the shared inventory (Store.products). Main Auditor only (the
   database enforces it too). Identification reuses BarcodeActions;
   counting arithmetic lives in rack-scan-core.js.
   Every save goes to a localStorage outbox first, then is flushed —
   scanning never waits on the network.
   ══════════════════════════════════════════════════════════════ */

let session = null;   // { id, label, status, startedAt, items: Map(key -> item) }
let flushing = false;

const _client = () => Store.getState().sbClient;
const _online = () => (typeof navigator === 'undefined' ? true : navigator.onLine !== false);
const _uuid = () => (typeof crypto !== 'undefined' && crypto.randomUUID) ? crypto.randomUUID()
  : 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => { const r = Math.random() * 16 | 0; return (c === 'x' ? r : (r & 3 | 8)).toString(16); });

function canUseRackScan() { return Store.getState().role === 'main'; }
function currentSession() { return session; }
function sessionItems() { return session ? Array.from(session.items.values()) : []; }
function summary() { return RackCore.summarize(sessionItems()); }
function _changed() { Bus.emit('rack:changed'); }

// ── outbox ──────────────────────────────────────────────────
function _queueSession() {
  if (!session) return;
  const box = Repo.loadRackOutbox();
  box.sessions[session.id] = { id: session.id, label: session.label, status: session.status, startedAt: session.startedAt,
    closedAt: session.closedAt || null, signedOffBy: session.signedOffBy || null };
  Repo.saveRackOutbox(box);
}
function _queueItem(item) {
  const box = Repo.loadRackOutbox();
  box.items[session.id + '|' + item.key] = RackCore.toDbRow(item, session.id);
  Repo.saveRackOutbox(box);
}
function pendingCount() { const b = Repo.loadRackOutbox(); return Object.keys(b.items).length + Object.keys(b.sessions).length; }

async function flush() {
  if (flushing || !_online() || !canUseRackScan() || !_client()) return { ok: false };
  flushing = true;
  try {
    const box = Repo.loadRackOutbox();
    for (const id of Object.keys(box.sessions)) { await Repo.upsertRackSession(_client(), box.sessions[id]); delete box.sessions[id]; Repo.saveRackOutbox(box); }
    const keys = Object.keys(box.items);
    for (let i = 0; i < keys.length; i += 200) {
      const slice = keys.slice(i, i + 200);
      await Repo.upsertRackItems(_client(), slice.map(k => box.items[k]));
      slice.forEach(k => delete box.items[k]); Repo.saveRackOutbox(box);
    }
    _changed();
    return { ok: true };
  } catch (err) { return { ok: false, error: err }; }
  finally { flushing = false; }
}

// ── session ─────────────────────────────────────────────────
function startSession(label) {
  if (!canUseRackScan()) { Bus.emit('toast', { msg: 'Rack Scan is for the Main Auditor', kind: 'error' }); return null; }
  session = { id: _uuid(), label: String(label || '').trim() || null, status: 'open', startedAt: new Date().toISOString(), items: new Map() };
  _queueSession(); logAudit('rack:started', { sessionId: session.id, rack: session.label });
  flush(); _changed(); return session;
}

async function closeSession(signedOffBy) {
  if (!session) return { ok: false };
  session.status = 'closed'; session.closedAt = new Date().toISOString(); session.signedOffBy = String(signedOffBy || '').trim() || null;
  _queueSession();
  logAudit('rack:closed', { sessionId: session.id, rack: session.label, ...summary() });
  const r = await flush();
  _changed();
  return { ok: true, synced: !!r.ok };
}
function discardLocalSession() { session = null; _changed(); }

// ── scan → resolve ──────────────────────────────────────────
// Returns { kind, ... }:
//  item        – resolved product (existing = row already counted this session)
//  notInSystem – barcode known but product absent from inventory
//  unknown     – barcode not registered anywhere
//  blocked     – invalid / conflict / disabled (message in .reason)
async function resolveScan(raw) {
  const res = await BarcodeActions.processScan(raw, { scanType: 'identify' });
  if (res.result === 'invalid') return { kind: 'blocked', reason: 'invalid', detail: res.reason, barcode: res.raw };
  if (res.result === 'conflict' || res.result === 'disabled') return { kind: 'blocked', reason: res.result, barcode: res.barcode };
  if (res.result === 'unknown') return { kind: 'unknown', barcode: res.barcode };
  const product = res.product;
  if (!product) return { kind: 'notInSystem', barcode: res.barcode, productCode: res.productCode, existing: session && session.items.get('b:' + res.barcode) || null };
  const existing = session && session.items.get(RackCore.itemKey(product, res.barcode)) || null;
  return { kind: 'item', product, barcode: res.barcode, existing };
}

// ── save a verification ─────────────────────────────────────
// mode: 'counted' (typed) | 'matched_tap'. dup: 'add' | 'replace' when a row exists.
function saveCount({ product, barcode, entered, entryMode, dup }) {
  if (!session || session.status !== 'open') return { ok: false };
  const key = RackCore.itemKey(product, barcode);
  const previous = session.items.get(key) || null;
  let counted = Number(entered);
  if (!Number.isFinite(counted) || counted < 0) return { ok: false, error: 'bad quantity' };
  if (previous) counted = RackCore.mergeCount(previous.countedQty, counted, dup === 'add' ? 'add' : 'replace');
  const item = RackCore.buildItem({
    product, barcode, counted, entryMode: previous ? 'counted' : entryMode,
    previous: previous ? Object.assign({}, previous, { recounted: dup === 'replace' || previous.recounted }) : null,
  });
  session.items.set(key, item); _queueItem(item); flush(); _changed();
  return { ok: true, item };
}

function toggleFlag(key) {
  const it = session && session.items.get(key); if (!it) return null;
  it.flagged = !it.flagged; _queueItem(it); flush(); _changed(); return it;
}
function flaggedKeys() { return sessionItems().filter(i => i.flagged).map(i => i.key); }
function getItem(key) { return session && session.items.get(key) || null; }
function productForItem(item) { return item && item.productCode ? BarcodeActions.productByCode(item.productCode) : null; }

// ── history / reports ───────────────────────────────────────
async function loadSessionHistory() {
  if (!_online()) return [];
  try { return await Repo.fetchRackSessions(_client()); } catch (e) { Bus.emit('toast', { msg: (e && e.message) || 'Could not load history', kind: 'error' }); return []; }
}
async function loadLastVerifiedMap() {
  if (!_online()) return new Map();
  try { const rows = await Repo.fetchRackLastVerified(_client()); return new Map(rows.map(r => [r.product_code, r.last_verified_at])); }
  catch (_) { return new Map(); }
}

function exportSessionXLSX() {
  if (!session) return false;
  if (typeof XLSX === 'undefined') { Bus.emit('toast', { msg: 'Excel library not loaded', kind: 'error' }); return false; }
  const sheets = RackCore.exportRows(sessionItems(), { label: session.label, startedAt: session.startedAt, closedAt: session.closedAt, signedOffBy: session.signedOffBy });
  const wb = XLSX.utils.book_new();
  Object.keys(sheets).forEach(n => XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(sheets[n]), n));
  const name = 'RackScan_' + (session.label || 'session').replace(/[^\w-]+/g, '_') + '_' + session.startedAt.slice(0, 10) + '.xlsx';
  XLSX.writeFile(wb, name);
  logAudit('rack:exported', { sessionId: session.id });
  return true;
}

if (typeof window !== 'undefined') {
  window.addEventListener('online', () => { if (session || pendingCount()) flush(); });
  setInterval(() => { if (pendingCount()) flush(); }, 30000);
}
Bus.on('auth:loggedOut', () => { session = null; });

export const RackScanActions = {
  canUseRackScan, rackSession: currentSession, rackItems: sessionItems, rackSummary: summary, rackPending: pendingCount,
  rackStart: startSession, rackClose: closeSession, rackDiscard: discardLocalSession, rackFlush: flush,
  rackResolveScan: resolveScan, rackSave: saveCount, rackToggleFlag: toggleFlag, rackFlaggedKeys: flaggedKeys,
  rackGetItem: getItem, rackProductForItem: productForItem,
  rackHistory: loadSessionHistory, rackLastVerified: loadLastVerifiedMap, rackExportXLSX: exportSessionXLSX,
};
