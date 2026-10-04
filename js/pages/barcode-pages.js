import { Store } from '../store.js';
import { Actions, Bus } from '../actions.js';
import { Components } from '../components.js';
import { BarcodeScanner } from '../barcode/barcode-scanner.js';
import { BarcodeValidation } from '../barcode/barcode-validation.js';

/* ══════════════════════════════════════════════════════════════
   FLOOR 5 — PAGES / barcode-pages.js
   The Barcode Center screens + the ONE scanner session shared by
   every consumer (Barcode Center now; counting/recount reuse
   openScannerSession). Camera and USB/Bluetooth scanners both feed the
   same ScanHub; this file never contains counting logic.
   ══════════════════════════════════════════════════════════════ */

const $ = (id) => document.getElementById(id);
const MASTER_CAP = 150;

const hub = BarcodeScanner.createScanHub();
let wedgeAttached = false;
let consumer = null;          // fn({raw, source}) while a screen wants scans
let camera = null;            // { stop() } while the camera is running
let cameraOn = false;
let externalSession = false;  // a counting screen owns the scanner; Barcode Center must not tear it down

// UI-only state for this screen
const ui = {
  view: 'scan',
  lastResult: null,
  masterQuery: '', masterStatus: '',
  detailBarcode: null, detailHistory: [],
  regPicked: null, regQuery: '', regDetected: null, regState: null, regSaving: false, regFromUnknown: false,
  scanHistory: null,
};

function pageActive() { const p = $('page-barcode'); return !!(p && p.classList.contains('active')); }
function ensureWedge() {
  if (wedgeAttached) return;
  wedgeAttached = true;
  BarcodeScanner.attachWedge(hub, document, () => !!consumer && pageActive());
}

/* ── Shared scanner session (also used by counting screens) ───────────
   openScannerSession(onScan) -> { startCamera(videoEl), stopCamera(), close() }
   Hardware scanners work as soon as the session is open; the camera
   needs an explicit user tap (browser rule). */
export function openScannerSession(onScan) {
  ensureWedge();
  externalSession = true;
  consumer = onScan;
  hub.onScan((s) => { if (consumer) consumer(s); });
  hub.resume();
  return {
    async startCamera(videoEl) { await _startCamera(videoEl); },
    stopCamera: _stopCamera,
    close() { _stopCamera(); consumer = null; externalSession = false; hub.pause(); },
  };
}
async function _startCamera(videoEl) {
  if (camera) { try { camera.stop(); } catch (_) {} camera = null; }
  camera = await BarcodeScanner.startCamera(hub, videoEl);
  cameraOn = true;
}
function _stopCamera() {
  if (camera) { try { camera.stop(); } catch (_) {} }
  camera = null; cameraOn = false;
}

/* ── Rendering ──────────────────────────────────────────────── */
function _nameFor(id) { return Actions.barcodeStaffName(id); }
function _productName(code) { const p = Actions.productByCode(code); return p ? p.name : code; }
function _decorate(rows) {
  return rows.map(r => Object.assign({}, r, { verifiedByName: r.verifiedBy ? _nameFor(r.verifiedBy) : '' }));
}

function renderShell() {
  const root = $('barcode-tab-root');
  if (!root) return;
  root.innerHTML = '<div id="bc-nav"></div><div id="bc-statusbar"></div><div id="bc-body"></div>';
  renderNav(); renderStatus(); renderBody();
}
function renderNav() {
  const el = $('bc-nav'); if (!el) return;
  const rows = Actions.barcodeRows();
  el.innerHTML = Components.barcodeSubnavHTML({
    view: ui.view, canRegister: Actions.barcodeCanRegister(),
    conflictCount: rows.filter(r => r.status === 'conflict').length,
    unverifiedCount: rows.filter(r => r.status === 'unverified').length,
  });
}
async function renderStatus() {
  const el = $('bc-statusbar'); if (!el) return;
  const st = Actions.barcodeStatus();
  const pending = await Actions.barcodePendingCount();
  el.innerHTML = Components.barcodeStatusBarHTML({ online: Actions.barcodeIsOnline(), syncing: st.syncing, pending, size: st.size });
}

function scannerHTML(hint) {
  return Components.barcodeScannerBoxHTML({ cameraOn, cameraSupported: BarcodeScanner.cameraSupported(), hint, controls: BarcodeScanner.cameraControls() });
}

function renderBody() {
  const el = $('bc-body'); if (!el) return;
  _stopCamera();
  const v = ui.view;
  if (v === 'scan') {
    consumer = onIdentifyScan; hub.onScan(s => consumer && consumer(s)); hub.resume();
    el.innerHTML = `<div id="bc-scanner-wrap">${scannerHTML()}</div><div id="bc-result"></div><div id="bc-picker"></div>`;
    renderResult();
  } else if (v === 'register') {
    consumer = onRegisterScan; hub.onScan(s => consumer && consumer(s)); hub.resume();
    renderRegister();
  } else {
    consumer = null; hub.pause();
    if (v === 'master') renderMaster();
    else if (v === 'queue') renderQueue();
    else if (v === 'conflicts') renderConflicts();
    else if (v === 'history') renderHistory();
    else if (v === 'reports') { const e = $('bc-body'); if (e) e.innerHTML = Components.barcodeReportsHTML(); }
    else if (v === 'detail') renderDetail();
  }
}

function renderResult() {
  const el = $('bc-result'); if (!el) return;
  el.innerHTML = Components.barcodeResultCardHTML(ui.lastResult, { canRegister: Actions.barcodeCanRegister(), canAdminister: Actions.barcodeCanAdminister() });
}
function refreshScannerBox() {
  const w = $('bc-scanner-wrap'); if (w) w.innerHTML = scannerHTML();
}

/* Scan & Identify */
async function onIdentifyScan({ raw }) {
  const res = await Actions.processScan(raw, { scanType: 'identify' });
  if (res.result === 'invalid') res.message = BarcodeValidation.invalidReasonText(res.reason);
  ui.lastResult = res;
  BarcodeScanner.feedback(res.result === 'matched' ? 'matched' : 'error');
  renderResult();
}

/* Register Barcode */
function renderRegister() {
  const el = $('bc-body'); if (!el) return;
  const results = ui.regPicked ? [] : Actions.searchProducts(ui.regQuery, 30);
  el.innerHTML = Components.barcodeRegisterHTML({
    picked: ui.regPicked, query: ui.regQuery, results,
    detected: ui.regDetected, detectedState: ui.regState, saving: ui.regSaving, fromUnknown: ui.regFromUnknown,
    scannerHTML: `<div id="bc-scanner-wrap">${scannerHTML('Scan the barcode printed on the package')}</div>`,
  });
}
async function onRegisterScan({ raw }) {
  if (!ui.regPicked) return;
  const res = await Actions.processScan(raw, { scanType: 'verification' });
  BarcodeScanner.feedback(res.result === 'unknown' ? 'matched' : 'error');
  if (res.result === 'invalid') { ui.regDetected = String(raw); ui.regState = { kind: 'invalid', message: BarcodeValidation.invalidReasonText(res.reason) }; }
  else {
    ui.regDetected = res.barcode; ui.regFromUnknown = false;
    if (res.result === 'unknown') ui.regState = { kind: 'new' };
    else if (res.productCode === ui.regPicked.code && (res.result === 'matched' || res.result === 'duplicate')) ui.regState = { kind: 'same' };
    else if (res.result === 'disabled') ui.regState = { kind: 'invalid', message: 'This barcode was disabled by a Main Auditor and cannot be re-registered here.' };
    else ui.regState = { kind: 'other', otherCode: res.productCode, otherName: res.product ? res.product.name : '' };
  }
  renderRegisterPreserveCamera();
}
// Re-render the form; if the camera was running, restart it on the fresh <video>.
async function renderRegisterPreserveCamera() {
  const wasOn = cameraOn;
  _stopCamera();
  cameraOn = wasOn;
  renderRegister();
  if (wasOn && $('bc-video')) {
    try { await _startCamera($('bc-video')); } catch (_) { cameraOn = false; refreshScannerBox(); }
  }
}

/* Master */
function renderMaster() {
  const el = $('bc-body'); if (!el) return;
  const rows = _decorate(Actions.searchMaster(ui.masterQuery, ui.masterStatus));
  el.innerHTML = Components.barcodeMasterHTML({ rows, query: ui.masterQuery, status: ui.masterStatus, cap: MASTER_CAP });
}
function updateMasterList() {
  const rows = _decorate(Actions.searchMaster(ui.masterQuery, ui.masterStatus));
  const list = $('bc-master-list'); const cnt = $('bc-master-count');
  if (cnt) cnt.textContent = Components.barcodeMasterCountText(rows.length, MASTER_CAP);
  if (list) list.innerHTML = rows.length ? rows.slice(0, MASTER_CAP).map(r => Components.barcodeMasterRowHTML(r)).join('') : '<div class="bc-empty">No barcodes found</div>';
}
function _rowFor(barcode) { return Actions.barcodeRows().find(r => r.barcode === barcode) || null; }
async function renderDetail() {
  const el = $('bc-body'); if (!el) return;
  const row = _rowFor(ui.detailBarcode);
  if (!row) { ui.view = 'master'; renderNav(); return renderBody(); }
  const paint = () => { el.innerHTML = Components.barcodeDetailHTML({
    row, productName: _productName(row.productCode), history: ui.detailHistory, nameFor: _nameFor,
    canRegister: Actions.barcodeCanRegister(), canAdminister: Actions.barcodeCanAdminister() }); };
  paint();
  ui.detailHistory = await Actions.loadBarcodeHistory(row.barcode);
  if (ui.view === 'detail' && ui.detailBarcode === row.barcode) paint();
}
function renderQueue() {
  const el = $('bc-body'); if (!el) return;
  const rows = _decorate(Actions.searchMaster('', 'unverified')).map(r => r);
  el.innerHTML = Components.barcodeQueueHTML({ rows });
}
function renderConflicts() {
  const el = $('bc-body'); if (!el) return;
  const rows = Actions.searchMaster('', 'conflict');
  el.innerHTML = Components.barcodeConflictsHTML({ rows, canAdminister: Actions.barcodeCanAdminister(), nameOf: (c) => { const p = Actions.productByCode(c); return p ? p.name : (c || '—'); } });
}
async function renderHistory() {
  const el = $('bc-body'); if (!el) return;
  el.innerHTML = '<div class="bc-empty">Loading…</div>';
  ui.scanHistory = await Actions.loadScanHistory({ limit: 200 });
  if (ui.view !== 'history') return;
  el.innerHTML = Components.barcodeScanHistoryHTML({ events: ui.scanHistory, nameFor: _nameFor, productName: _productName });
}

function setView(v) { ui.view = v; renderNav(); renderBody(); }

/* ── Handlers ───────────────────────────────────────────────── */
function _reason(scopeEl) {
  const input = scopeEl ? scopeEl.querySelector('input') : $('bc-reason');
  const v = input ? input.value.trim() : '';
  if (!v) Bus.emit('toast', { msg: 'A reason is required', kind: 'error' });
  return v;
}
async function submitManual() {
  const inp = $('bc-manual-input'); if (!inp) return;
  const raw = inp.value.trim(); if (!raw) return;
  inp.value = '';
  if (consumer) consumer({ raw, source: 'manual' });
}

export function initBarcodePages() {
  Bus.on('view:activated', (page) => {
    if (page === 'barcode') { ensureWedge(); ui.view = ui.view === 'detail' ? 'master' : ui.view; renderShell(); }
    else if (!externalSession) { _stopCamera(); if (consumer) { consumer = null; hub.pause(); } }
  });
  Bus.on('barcode:status', () => { if (pageActive()) renderStatus(); });
  Bus.on('barcode:synced', (s) => {
    if (!pageActive()) return;
    renderStatus();
    if (s && s.conflicts && s.conflicts.length) Bus.emit('toast', { msg: s.conflicts.length + ' barcode(s) were already linked to another product — flagged as conflicts', kind: 'error' });
  });
  Bus.on('barcode:changed', () => {
    if (!pageActive()) return;
    renderNav(); renderStatus();
    if (['master', 'queue', 'conflicts'].includes(ui.view)) renderBody();
  });
  document.addEventListener('visibilitychange', () => { if (document.hidden) { _stopCamera(); if (pageActive()) refreshScannerBox(); } });

  const clickHandlers = {
    'barcode-set-subview': (el) => setView(el.dataset.subview),
    'barcode-sync-now': () => Actions.syncBarcodesNow(),
    'barcode-export': async (el) => {
      if (!Actions.barcodeCanRegister()) return;
      const kind = el.dataset.kind;
      const { engagements, rounds } = Store.getState();
      const ctx = {
        nameFor: _nameFor, productName: (c) => { const p = Actions.productByCode(c); return p ? p.name : ''; },
        auditName: (id) => { const e = (engagements || []).find(x => x.id === id); return e ? e.name : ''; },
        roundLabel: (id) => { const r = (rounds || []).find(x => x.id === id); return r ? 'Round ' + r.roundNumber + (r.roundSuffix || '') : ''; },
      };
      const data = { rows: Actions.barcodeRows(), ctx };
      if (kind === 'conflicts') data.history = await Actions.loadBarcodeHistory();
      if (kind === 'scans') data.events = await Actions.loadScanHistory({ limit: 5000 });
      Actions.exportBarcodeReportXLSX(kind, data);
    },
    'barcode-camera-start': async () => {
      if (!$('bc-scanner-wrap')) return;
      try {
        cameraOn = true; refreshScannerBox();      // draws <video> + reticle
        await _startCamera($('bc-video'));
      } catch (err) {
        cameraOn = false; _stopCamera(); refreshScannerBox();
        Bus.emit('toast', { msg: err.message || 'Could not start the camera', kind: 'error' });
      }
    },
    'barcode-camera-stop': () => { _stopCamera(); refreshScannerBox(); },
    // Shared by the Barcode Center and the counting overlay (handler maps are merged globally).
    'barcode-focus': () => { const c = BarcodeScanner.activeCamera(); if (c) c.refocus(); },
    'barcode-torch': async (el) => {
      const c = BarcodeScanner.activeCamera(); if (!c) return;
      const ok = await c.setTorch(!c.torchOn);
      if (ok) el.setAttribute('aria-pressed', String(c.torchOn));
      else Bus.emit('toast', { msg: 'Torch not available on this camera', kind: 'error' });
    },
    'barcode-manual-submit': () => submitManual(),

    'barcode-unknown-search': () => { ui.regPicked = null; ui.regQuery = ''; ui.regDetected = ui.lastResult.barcode; ui.regState = { kind: 'new' }; ui.regFromUnknown = true; setView('register'); },
    'barcode-unknown-register': () => { ui.regPicked = null; ui.regQuery = ''; ui.regDetected = ui.lastResult.barcode; ui.regState = { kind: 'new' }; ui.regFromUnknown = true; setView('register'); },

    'barcode-register-pick': (el) => { ui.regPicked = Actions.productByCode(el.dataset.code); renderRegister(); },
    'barcode-register-clear': () => { ui.regPicked = null; ui.regDetected = null; ui.regState = null; ui.regFromUnknown = false; renderRegister(); },
    'barcode-register-save': async () => {
      if (!ui.regPicked || !ui.regDetected || ui.regSaving) return;
      ui.regSaving = true; renderRegisterPreserveCamera();
      const r = await Actions.registerBarcode({ productCode: ui.regPicked.code, barcode: ui.regDetected });
      ui.regSaving = false;
      if (r.ok) {
        BarcodeScanner.feedback('saved');
        Bus.emit('toast', { msg: r.outcome === 'queued' ? 'Saved on this device — will sync when online' : r.outcome === 'conflict' ? 'Already linked to another product — flagged as a conflict' : r.outcome === 'exists' ? 'Already linked' : 'Barcode saved & verified', kind: r.outcome === 'conflict' ? 'error' : 'success' });
        ui.regDetected = null; ui.regState = null; ui.regFromUnknown = false;
      } else if (r.outcome === 'known') {
        ui.regState = { kind: 'other', otherCode: r.existing.productCode, otherName: '' };
      }
      renderRegisterPreserveCamera();
    },
    'barcode-register-report-conflict': async () => {
      if (!ui.regPicked || !ui.regDetected) return;
      const r = await Actions.reportBarcodeConflict(ui.regDetected, ui.regPicked.code, 'Reported while registering');
      if (r.ok) { Bus.emit('toast', { msg: 'Conflict reported to the Main Auditor', kind: 'success' }); ui.regDetected = null; ui.regState = null; renderRegisterPreserveCamera(); }
    },

    'barcode-master-filter': (el) => { ui.masterStatus = el.dataset.status; renderMaster(); },
    'barcode-open-detail': (el) => { ui.detailBarcode = el.dataset.barcode; ui.detailHistory = []; ui.view = 'detail'; renderBody(); },
    'barcode-close-detail': () => setView('master'),
    'barcode-verify': async (el) => {
      const r = await Actions.verifyBarcode(el.dataset.barcode, 'Verified in Barcode Center');
      if (r.ok) { Bus.emit('toast', { msg: 'Verified', kind: 'success' }); BarcodeScanner.feedback('saved'); if (ui.view === 'detail') renderDetail(); else renderBody(); renderNav(); }
    },
    'barcode-disable-start': (el) => {
      const w = $('bc-action-reason-wrap'); if (w) { w.innerHTML = Components.barcodeReasonPromptHTML({ title: 'Disable this barcode?', confirmAction: 'barcode-disable-confirm', barcode: el.dataset.barcode }); const i = $('bc-reason'); if (i) i.focus(); }
    },
    'barcode-reason-cancel': () => { const w = $('bc-action-reason-wrap'); if (w) w.innerHTML = ''; },
    'barcode-disable-confirm': async (el) => {
      const reason = _reason($('bc-action-reason-wrap')); if (!reason) return;
      const r = await Actions.disableBarcode(el.dataset.barcode, reason);
      if (r.ok) { Bus.emit('toast', { msg: 'Barcode disabled', kind: 'success' }); renderDetail(); }
    },
    'barcode-resolve': async (el) => {
      const card = el.closest('[data-conflict]');
      const reason = _reason(card ? card.querySelector('.bc-conflict-reason').parentElement : null);
      if (!reason) return;
      const r = await Actions.resolveBarcodeConflict(el.dataset.barcode, el.dataset.resolution, reason);
      if (r.ok) { Bus.emit('toast', { msg: 'Conflict resolved & logged', kind: 'success' }); renderBody(); renderNav(); }
    },
  };

  let masterDebounce = null; let regDebounce = null;
  const inputHandlers = {
    'barcode-zoom': (el) => { const c = BarcodeScanner.activeCamera(); if (c) c.setZoom(parseFloat(el.value)); },
    'barcode-master-search': (el) => { ui.masterQuery = el.value; clearTimeout(masterDebounce); masterDebounce = setTimeout(updateMasterList, 120); },
    'barcode-register-search': (el) => {
      ui.regQuery = el.value; clearTimeout(regDebounce);
      regDebounce = setTimeout(() => { const r = $('bc-product-results'); if (r) r.innerHTML = Components.barcodeProductResultsHTML(Actions.searchProducts(ui.regQuery, 30), 'barcode-register-pick'); }, 120);
    },
  };
  const keydownHandlers = {
    'barcode-manual-key': (e) => { if (e.key === 'Enter') { e.preventDefault(); submitManual(); } },
  };
  return { clickHandlers, inputHandlers, changeHandlers: {}, keydownHandlers };
}
