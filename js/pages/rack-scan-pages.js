import { Actions, Bus } from '../actions.js';
import { Components } from '../components.js';
import { BarcodeScanner } from '../barcode/barcode-scanner.js';
import { BarcodeValidation } from '../barcode/barcode-validation.js';
import { openScannerSession } from './barcode-pages.js';

/* ══════════════════════════════════════════════════════════════
   FLOOR 5 — PAGES / rack-scan-pages.js
   Rack Scan overlay (Main Auditor). Scan → system balance shown →
   ✓ Matches or type the count → next. No company/template/engagement.
   This file identifies items and collects a number only; verification
   maths is in rack-scan-core.js via Actions.rackSave.
   ══════════════════════════════════════════════════════════════ */

const $ = (id) => document.getElementById(id);
const LARGE_QTY = 100000;

let overlay = null, scanner = null, videoEl = null;
let reopen = BarcodeScanner.createReopenPolicy();
let st = null;   // { view, mode, cur, last, msg, cameraOn, auto, readyAt, regQuery, regResults, history, queue }

function esc(s) { return Components.esc(s); }

function scannerBox() {
  return Components.barcodeScannerBoxHTML({
    cameraOn: !!st.cameraOn, cameraSupported: BarcodeScanner.cameraSupported(), camPrefix: 'rack',
    hint: BarcodeScanner.nativeScannerAvailable() ? 'Tap to scan. The scanner reopens after each item — close the scanner to stop.' : 'Scan the next product — hardware scanners work too.',
    controls: BarcodeScanner.cameraControls(),
  });
}

function paint() {
  if (!overlay || !st) return;
  const session = Actions.rackSession();
  let body = '', strip = '', scan = '', title = 'Rack Scan';
  if (st.view === 'start') {
    body = Components.rackStartHTML({ canUse: Actions.canUseRackScan(), pending: Actions.rackPending() });
  } else if (st.view === 'history') {
    body = Components.rackHistoryHTML(st.history || []);
  } else if (st.view === 'summary' && session) {
    title = session.label || 'Rack Scan';
    body = Components.rackSummaryHTML({ session, s: Actions.rackSummary(), rows: Components.rackSummaryRowsHTML(Actions.rackItems()), synced: Actions.rackPending() === 0, pending: Actions.rackPending() });
  } else if (session) {
    title = session.label || 'Rack Scan';
    strip = Components.rackStripHTML(Actions.rackSummary());
    const flagged = Actions.rackFlaggedKeys().length;
    if (st.mode === 'count') body = Components.rackCountHTML({ product: st.cur.product, barcode: st.cur.barcode, existing: st.cur.existing });
    else if (st.mode === 'unknown') body = Components.rackUnknownHTML({ barcode: st.cur.barcode, query: st.regQuery, results: st.regResults, canRegister: Actions.barcodeCanRegister() });
    else {
      scan = scannerBox();
      body = (st.mode === 'result' && st.last ? Components.rackResultHTML({ item: st.last, canRecount: true }) : (st.msg || ''))
        + Components.rackRecentHTML(Actions.rackItems())
        + `<div class="bc-row" style="margin-top:10px;">
            ${flagged ? `<button class="bc-btn bc-btn--gold" data-action="rack-recount-flagged">Recount flagged (${flagged})</button>` : ''}
            <button class="bc-btn bc-btn--primary" data-action="rack-summary">Finish / summary</button></div>`;
    }
  }
  overlay.innerHTML = Components.rackOverlayShellHTML({ title, strip, scannerHTML: scan, body });
  if (st.mode === 'count' && st.view === 'scan') { const q = $('rk-qty'); if (q) q.focus(); }
  if (scan && st.cameraOn) {
    const ph = $('bc-video');
    if (ph && videoEl && ph !== videoEl) { videoEl.id = 'bc-video'; videoEl.style.display = ''; ph.replaceWith(videoEl); }
  }
}

async function startCameraNow() {
  if (!scanner || !st) return;
  const ns = await scanner.tryNativeScan();
  if (ns) {
    const act = reopen.note(ns);
    st.auto = act === 'continue';
    if (act === 'rest') Bus.emit('toast', { msg: 'Camera rested — tap the camera to continue', kind: 'success' });
    if (act !== 'fallback') return;
    Bus.emit('toast', { msg: 'Native scanner struggling — using the web camera', kind: 'error' });
  }
  st.cameraOn = true; paint();
  try { await scanner.startCamera(videoEl); }
  catch (err) { st.cameraOn = false; paint(); Bus.emit('toast', { msg: err.message || 'Could not start the camera', kind: 'error' }); }
}
function scheduleNext() {
  if (!st || !st.auto || !BarcodeScanner.nativeScannerAvailable()) return;
  clearTimeout(st.nextTimer);
  st.nextTimer = setTimeout(() => { if (overlay && st && st.auto && st.view === 'scan' && (st.mode === 'idle' || st.mode === 'message')) startCameraNow(); }, reopen.delayMs);
}

function msg(kind, title, detail) { return Components.rackMessageHTML(kind, title, detail); }
function openCount(cur) { st.cur = cur; st.mode = 'count'; st.msg = ''; paint(); }
function toIdle(message, delay) { st.mode = message ? 'message' : 'idle'; st.msg = message || ''; st.cur = null; st.readyAt = Date.now() + (delay || 1000); paint(); scheduleNext(); }

async function onScan({ raw, source }) {
  if (!overlay || !st || st.view !== 'scan') return;
  if (st.mode === 'count' || st.mode === 'unknown') {
    if (source !== 'camera') { Bus.emit('toast', { msg: 'Save or cancel the current item first', kind: 'error' }); BarcodeScanner.feedback('error'); }
    return;
  }
  if (st.readyAt && Date.now() < st.readyAt) return;
  const r = await Actions.rackResolveScan(raw);
  if (r.kind === 'blocked') {
    BarcodeScanner.feedback('error');
    const text = r.reason === 'invalid' ? BarcodeValidation.invalidReasonText(r.detail)
      : r.reason === 'conflict' ? 'This barcode is disputed between two products. Do not use it — check the Barcode Center.' : 'This barcode was retired.';
    st.mode = 'message'; st.msg = msg('invalid', r.reason === 'invalid' ? 'INVALID SCAN' : r.reason.toUpperCase(), text); return paint();
  }
  BarcodeScanner.feedback(r.kind === 'unknown' ? 'error' : 'matched');
  if (r.kind === 'unknown') { st.cur = { barcode: r.barcode }; st.mode = 'unknown'; st.regQuery = ''; st.regResults = []; return paint(); }
  if (r.kind === 'notInSystem') return openCount({ product: null, barcode: r.barcode, existing: r.existing });
  openCount({ product: r.product, barcode: r.barcode, existing: r.existing });
}

function readQty() {
  const input = $('rk-qty'); if (!input) return null;
  const raw = input.value.trim();
  if (raw === '' || isNaN(parseFloat(raw)) || parseFloat(raw) < 0) { Bus.emit('toast', { msg: 'Enter the physical quantity', kind: 'error' }); input.focus(); return null; }
  if (parseFloat(raw) >= LARGE_QTY && !window.confirm('Physical quantity is ' + raw + '. Is that right?')) { input.focus(); return null; }
  return parseFloat(raw);
}

function afterSave(item) {
  BarcodeScanner.feedback(item.result === 'match' ? 'saved' : 'error');
  st.cur = null;
  if (st.queue && st.queue.length) return recountNext();
  if (item.result === 'match') {
    st.last = item;
    return toIdle(msg('matched', '✅ MATCH', esc(item.productName || '') + ' = ' + item.countedQty), 1500);
  }
  st.last = item; st.mode = 'result'; st.msg = ''; st.readyAt = Date.now() + 1500; paint();
}

function confirm(dup) {
  if (!st.cur) return;
  const entered = readQty(); if (entered === null) return;
  const r = Actions.rackSave({ product: st.cur.product, barcode: st.cur.barcode, entered, entryMode: 'counted', dup });
  if (r.ok) afterSave(r.item);
}
function matchTap() {
  if (!st.cur || !st.cur.product || st.cur.existing) return;
  const r = Actions.rackSave({ product: st.cur.product, barcode: st.cur.barcode, entered: st.cur.product.qty, entryMode: 'matched_tap' });
  if (r.ok) afterSave(r.item);
}
function recount(key) {
  const item = Actions.rackGetItem(key); if (!item) return;
  openCount({ product: Actions.rackProductForItem(item), barcode: item.barcode, existing: item });
}
function recountNext() {
  const key = st.queue.shift();
  if (!key) { st.queue = null; return toIdle('', 500); }
  recount(key);
}

function openOverlay() {
  if (overlay) return;
  if (!Actions.canUseRackScan()) { Bus.emit('toast', { msg: 'Rack Scan is for the Main Auditor', kind: 'error' }); return; }
  reopen.reset();
  overlay = document.createElement('div');
  overlay.id = 'rk-overlay';
  overlay.setAttribute('role', 'dialog'); overlay.setAttribute('aria-modal', 'true'); overlay.setAttribute('aria-label', 'Rack Scan');
  (document.getElementById('app') || document.body).appendChild(overlay);
  videoEl = document.createElement('video'); videoEl.setAttribute('playsinline', 'true'); videoEl.muted = true;
  const open = Actions.rackSession() && Actions.rackSession().status === 'open';
  st = { view: open ? 'scan' : 'start', mode: 'idle', cur: null, last: null, msg: '', cameraOn: false, auto: false, readyAt: 0, regQuery: '', regResults: [], history: [], queue: null };
  scanner = openScannerSession(onScan);
  paint();
}
function closeOverlay() {
  if (st) { st.auto = false; clearTimeout(st.nextTimer); }
  if (scanner) scanner.close(); scanner = null; videoEl = null;
  if (overlay) overlay.remove(); overlay = null; st = null;
}

function startSession() {
  const label = $('rk-label') ? $('rk-label').value : '';
  if (!Actions.rackStart(label)) return;
  st.view = 'scan'; st.mode = 'idle'; paint();
}

export function initRackScanPages() {
  Bus.on('rack:changed', () => { if (overlay && st && st.view === 'summary') paint(); });
  const clickHandlers = {
    'rack-open': () => openOverlay(),
    'rack-close': () => closeOverlay(),
    'rack-start': () => startSession(),
    'rack-camera-start': () => startCameraNow(),
    'rack-camera-stop': () => { if (!overlay || !st) return; scanner.stopCamera(); st.cameraOn = false; st.auto = false; paint(); },
    'rack-match': () => matchTap(),
    'rack-confirm': (el) => confirm(el.dataset.dup === 'add' ? 'add' : 'replace'),
    'rack-skip': () => toIdle('', 1000),
    'rack-next': () => { st.queue = null; toIdle('', 400); },
    'rack-flag': (el) => { const it = Actions.rackToggleFlag(el.dataset.key); if (it) { st.last = it; paint(); } },
    'rack-recount': (el) => recount(el.dataset.key),
    'rack-recount-flagged': () => { st.queue = Actions.rackFlaggedKeys(); recountNext(); },
    'rack-log-notinsystem': () => { if (st.cur) openCount({ product: null, barcode: st.cur.barcode, existing: null }); },
    'rack-register': async (el) => {
      const barcode = st.cur && st.cur.barcode; if (!barcode) return;
      const r = await Actions.registerBarcode({ productCode: el.dataset.code, barcode });
      if (!r.ok) { if (r.outcome === 'known') Bus.emit('toast', { msg: 'That barcode is already registered', kind: 'error' }); return; }
      Bus.emit('toast', { msg: 'Barcode registered', kind: 'success' });
      st.mode = 'idle'; st.readyAt = 0; await onScan({ raw: barcode, source: 'camera' });
      if (st && st.mode === 'idle') Bus.emit('toast', { msg: 'Registered — scan the item again', kind: 'success' });
    },
    'rack-summary': () => { st.view = 'summary'; paint(); },
    'rack-back': () => { st.view = 'scan'; st.mode = 'idle'; paint(); },
    'rack-finish': async () => {
      const who = $('rk-signoff') ? $('rk-signoff').value.trim() : '';
      if (!who) { Bus.emit('toast', { msg: 'Enter the sign-off name', kind: 'error' }); return; }
      const unflagged = Actions.rackFlaggedKeys().length;
      if (unflagged && !window.confirm(unflagged + ' item(s) are still flagged for recount. Finish anyway?')) return;
      await Actions.rackClose(who); paint();
    },
    'rack-export': () => Actions.rackExportXLSX(),
    'rack-new': () => { Actions.rackDiscard(); st.view = 'start'; st.mode = 'idle'; paint(); },
    'rack-history-open': async () => { st.view = 'history'; st.history = await Actions.rackHistory(); paint(); },
    'rack-back-start': () => { st.view = 'start'; paint(); },
  };
  const inputHandlers = {
    'rack-reg-search': (el) => {
      st.regQuery = el.value; st.regResults = Actions.searchProducts(el.value, 12); paint();
      const q = $('rk-reg-q'); if (q) { q.focus(); q.setSelectionRange(q.value.length, q.value.length); }
    },
  };
  const keydownHandlers = {
    'rack-qty-key': (e) => { if (e.key === 'Enter') { e.preventDefault(); if (st.cur && !st.cur.existing) confirm('replace'); } },
    'rack-label-key': (e) => { if (e.key === 'Enter') { e.preventDefault(); startSession(); } },
  };
  return { clickHandlers, inputHandlers, keydownHandlers };
}
