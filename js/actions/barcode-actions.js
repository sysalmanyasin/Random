import { Repo } from '../repository.js';
import { Store } from '../store.js';
import { Bus } from './bus.js';
import { logAudit } from './audit-log-actions.js';
import { BarcodeService } from '../barcode/barcode-service.js';
import { BarcodeValidation } from '../barcode/barcode-validation.js';
import { BarcodeLookup } from '../barcode/barcode-lookup.js';

/* ══════════════════════════════════════════════════════════════
   FLOOR 3 — ACTIONS / barcode-actions.js
   Barcode is an identification/input layer ONLY. Nothing here touches
   counts, system quantity, variance or value — a resolved scan hands a
   productCode (and, for counting, the matching assignment item) to the
   existing counting flow, which does all the arithmetic as before.
   ══════════════════════════════════════════════════════════════ */

let service = null;
let staffNames = {};

function _client() { return Store.getState().sbClient; }
function _role() { return Store.getState().role; }
function canRegister() { const r = _role(); return r === 'main' || r === 'dep'; }
function canAdminister() { return _role() === 'main'; }
function isOnline() { return typeof navigator === 'undefined' ? true : navigator.onLine !== false; }

function getService() {
  if (service) return service;
  service = BarcodeService.createBarcodeService({
    isOnline,
    store: {
      loadCache: () => Repo.loadCachedBarcodes(),
      replaceCache: (rows) => Repo.replaceCachedBarcodes(rows),
      upsertCache: (row) => Repo.upsertCachedBarcode(row),
      loadOutbox: () => Repo.loadOutbox(),
      putOutbox: (i) => Repo.putOutboxItem(i),
      removeOutbox: (id) => Repo.removeOutboxItem(id),
    },
    remote: {
      fetchBarcodes: () => Repo.fetchBarcodes(_client()),
      registerBarcode: (a) => Repo.registerBarcode(_client(), a),
      insertScanEvents: (evs) => Repo.insertScanEvents(_client(), evs),
    },
    onStatus: (st) => Bus.emit('barcode:status', st),
  });
  return service;
}

// Called once after login. Loads the local mirror first (instant, works
// offline), then refreshes from Supabase in the background.
async function initBarcodes() {
  const svc = getService();
  await svc.init();
  Bus.emit('barcode:changed');
  refreshBarcodes().then(() => svc.flush());
}

async function refreshBarcodes() {
  const svc = getService();
  const r = await svc.refresh();
  if (r.ok) {
    try { staffNames = await Repo.fetchBarcodeStaffNames(_client()); } catch (_) { /* names are cosmetic */ }
  }
  Bus.emit('barcode:changed');
  return r;
}

function staffName(id) { return (id && staffNames[id]) || (id ? 'Staff' : '—'); }
function barcodeRows() { return getService().rows(); }
function barcodeStatus() { return getService().status(); }
async function barcodePendingCount() { return getService().pendingCount(); }
function syncBarcodesNow() { return getService().flush().then(s => { Bus.emit('barcode:synced', s); return s; }); }

// ── Scan pipeline (the ONE entry point for camera + hardware + manual) ──
// ctx: { scanType, engagementId, roundId, assignmentId, isAlreadyCounted }
// Returns the resolution plus { productName } etc. for the page. The scan
// event is queued to the outbox before returning; UI never waits on network.
async function processScan(raw, ctx) {
  const c = ctx || {};
  const res = getService().resolve(raw, { isAlreadyCounted: c.isAlreadyCounted });
  if (res.result !== 'invalid') {
    await getService().recordScan({
      barcode: res.barcode, productCode: res.productCode || null,
      scanType: c.scanType || 'identify', result: res.result,
      engagementId: c.engagementId, roundId: c.roundId, assignmentId: c.assignmentId,
    });
  }
  const product = res.productCode ? productByCode(res.productCode) : null;
  const claimant = res.conflictWith ? productByCode(res.conflictWith) : null;
  return Object.assign({}, res, { product, claimant });
}

function productByCode(code) {
  const { products } = Store.getState();
  return (products || []).find(p => p.code === code) || null;
}
function searchProducts(query, cap) {
  const q = String(query || '').trim().toLowerCase();
  if (!q) return [];
  const { products } = Store.getState();
  return (products || []).filter(p =>
    (p.name || '').toLowerCase().includes(q) || (p.code || '').toLowerCase().includes(q)).slice(0, cap || 30);
}
function searchMaster(query, status) {
  const { products } = Store.getState();
  let list = BarcodeLookup.searchMaster(barcodeRows(), products, query);
  if (status) list = list.filter(r => r.status === status);
  return list;
}
// Barcodes another auditor/device already knows for this product (for the product card).
function barcodesForProduct(code) { return getService().productBarcodes(code); }

// ── Mutations (all enforced again by the database) ──
function _needOnline(what) {
  if (isOnline()) return true;
  Bus.emit('toast', { msg: what + ' needs a connection', kind: 'error' });
  return false;
}
function _fail(err) { Bus.emit('toast', { msg: (err && err.message) || 'Something went wrong', kind: 'error' }); return { ok: false, error: err }; }

// User has already eyeballed barcode + product and tapped "Verify & Save".
async function registerBarcode(a) {
  if (!canRegister()) { Bus.emit('toast', { msg: 'Only a Deputy or Main Auditor can register barcodes', kind: 'error' }); return { ok: false }; }
  const norm = BarcodeValidation.normalizeBarcode(a.barcode);
  if (!norm.ok) { Bus.emit('toast', { msg: BarcodeValidation.invalidReasonText(norm.reason), kind: 'error' }); return { ok: false }; }
  const existing = getService().resolve(norm.barcode);
  if (existing.result !== 'unknown') return { ok: false, outcome: 'known', existing };
  try {
    if (!isOnline()) {
      await getService().queueRegistration({ productCode: a.productCode, barcode: norm.barcode, notes: a.notes });
      logAudit('barcode:registerQueued', { barcode: norm.barcode, productCode: a.productCode });
      Bus.emit('barcode:changed');
      return { ok: true, outcome: 'queued' };
    }
    const r = await Repo.registerBarcode(_client(), { productCode: a.productCode, barcode: norm.barcode, barcodeType: norm.type, verify: true, notes: a.notes });
    logAudit('barcode:registered', { barcode: norm.barcode, productCode: a.productCode, outcome: r && r.outcome });
    await refreshBarcodes();
    return { ok: true, outcome: r.outcome, existingProductCode: r.existing_product_code };
  } catch (err) {
    // Network drop mid-call: fall back to the safe, idempotent queue.
    if (!BarcodeService.isPermanentError(err)) {
      await getService().queueRegistration({ productCode: a.productCode, barcode: norm.barcode, notes: a.notes });
      return { ok: true, outcome: 'queued' };
    }
    return _fail(err);
  }
}

async function _admin(label, fn, auditAction, auditDetails) {
  if (!_needOnline(label)) return { ok: false };
  try { await fn(); logAudit(auditAction, auditDetails); await refreshBarcodes(); return { ok: true }; }
  catch (err) { return _fail(err); }
}
const verifyBarcode = (barcode, notes) => _admin('Verifying', () => Repo.verifyBarcode(_client(), { barcode, notes }), 'barcode:verified', { barcode });
const disableBarcode = (barcode, notes) => _admin('Disabling', () => Repo.disableBarcode(_client(), { barcode, notes }), 'barcode:disabled', { barcode });
const changeBarcode = (barcode, productCode, notes) => _admin('Changing', () => Repo.changeBarcode(_client(), { barcode, productCode, notes }), 'barcode:changed', { barcode, productCode });
const reportBarcodeConflict = (barcode, productCode, notes) => _admin('Reporting', () => Repo.reportBarcodeConflict(_client(), { barcode, productCode, notes }), 'barcode:conflictReported', { barcode, productCode });
const resolveBarcodeConflict = (barcode, resolution, notes) => _admin('Resolving', () => Repo.resolveBarcodeConflict(_client(), { barcode, resolution, notes }), 'barcode:conflictResolved', { barcode, resolution });

// Main only (enforced by the database too). Updates the open engagement in Store.
async function setCountingMethod(engagementId, method) {
  if (!canAdminister()) return { ok: false };
  if (!_needOnline('Changing the counting method')) return { ok: false };
  try {
    await Repo.setEngagementCountingMethod(_client(), engagementId, method);
    const { engagements, myAssignments } = Store.getState();
    Store.setState({
      engagements: (engagements || []).map(e => e.id === engagementId ? Object.assign({}, e, { countingMethod: method }) : e),
      myAssignments: (myAssignments || []).map(a => a.engagementId === engagementId ? Object.assign({}, a, { countingMethod: method }) : a),
    });
    logAudit('engagement:countingMethod', { engagementId, method });
    return { ok: true };
  } catch (err) { return _fail(err); }
}

async function loadBarcodeHistory(barcode) {
  if (!isOnline()) return [];
  try { return await Repo.fetchBarcodeHistory(_client(), barcode); } catch (err) { _fail(err); return []; }
}
async function loadScanHistory(filter) {
  if (!isOnline()) return [];
  try { return await Repo.fetchScanEvents(_client(), filter); } catch (err) { _fail(err); return []; }
}

// Reconnect → pull fresh mappings and flush the outbox. Registered once.
let _wired = false;
function wireConnectivity() {
  if (_wired || typeof window === 'undefined') return;
  _wired = true;
  window.addEventListener('online', () => { if (service) refreshBarcodes().then(() => syncBarcodesNow()); });
  window.addEventListener('offline', () => { if (service) Bus.emit('barcode:status', service.status()); });
  setInterval(() => { if (service && isOnline()) service.flush(); }, 30000);
}

Bus.on('auth:loggedIn', () => { wireConnectivity(); initBarcodes(); });

export const BarcodeActions = {
  initBarcodes, refreshBarcodes, barcodeRows, barcodeStatus, barcodePendingCount, syncBarcodesNow,
  processScan, productByCode, searchProducts, searchMaster, barcodesForProduct,
  registerBarcode, verifyBarcode, disableBarcode, changeBarcode, reportBarcodeConflict, resolveBarcodeConflict,
  loadBarcodeHistory, loadScanHistory, setCountingMethod,
  barcodeStaffName: staffName,
  barcodeCanRegister: canRegister, barcodeCanAdminister: canAdminister, barcodeIsOnline: isOnline,
};
