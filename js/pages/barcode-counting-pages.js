import { Store } from '../store.js';
import { Actions, Bus } from '../actions.js';
import { Components } from '../components.js';
import { BarcodeLookup } from '../barcode/barcode-lookup.js';
import { BarcodeValidation } from '../barcode/barcode-validation.js';
import { BarcodeScanner } from '../barcode/barcode-scanner.js';
import { openScannerSession } from './barcode-pages.js';

/* ══════════════════════════════════════════════════════════════
   FLOOR 5 — PAGES / barcode-counting-pages.js
   Scan → Count → Confirm → Scan, on top of the EXISTING counting flow.

   This file only IDENTIFIES the item and collects a number. The number
   goes through Actions.recordMyCount — the same function the manual
   input uses — so system qty, variance, value difference, autosave,
   isolation ("item must belong to this assignment") and the submitted-
   lock are all unchanged. Nothing is calculated here.

   Recount isolation: the assignment's own item list is the allowlist.
   A Difference-Only recount assignment contains only the discrepancy
   items, so a scan of anything else is rejected before a count form
   can open.
   ══════════════════════════════════════════════════════════════ */

const $ = (id) => document.getElementById(id);
const LARGE_QTY = 100000;

let session = null;
let videoEl = null;   // ONE <video> node reused across repaints so the camera never restarts
let overlay = null;
let st = null; // { state, item, candidates, name, duplicate, message, cameraOn }
let hooks = { onCounted: () => {} };

function activeAssignment() {
  const { myAssignments, activeAssignmentId } = Store.getState();
  return (myAssignments || []).find(a => a.id === activeAssignmentId) || null;
}
// Recount = any round after the first. Items of a later round carry the
// previous round's variance (see counting-components prevVariance).
function isRecount(a) { return !!a && (a.items || []).some(it => it.prevVariance !== undefined && it.prevVariance !== null); }
function counted(a) { const { myCounts } = Store.getState(); return (a.items || []).filter(it => (myCounts || {})[it.itemKey] !== undefined).length; }

function scannerHTML() {
  const cam = BarcodeScanner.activeCamera();
  return Components.barcodeScannerBoxHTML({
    cameraOn: !!(st && st.cameraOn), cameraSupported: BarcodeScanner.cameraSupported(),
    hint: 'The camera stays on while you count — scan the next product. Hardware scanners work too.',
    controls: BarcodeScanner.cameraControls(), live: !!(cam && cam.live),
  });
}
function paint() {
  if (!overlay) return;
  const a = activeAssignment();
  if (!a) return close();
  const { myCounts } = Store.getState();
  overlay.innerHTML = Components.countingOverlayHTML(Object.assign({}, st, {
    recount: isRecount(a), counted: counted(a), total: (a.items || []).length, scannerHTML: scannerHTML(),
    current: st.item ? (myCounts || {})[st.item.itemKey] : undefined,
  }));
  if (st.state === 'count') { const q = $('bc-count-qty'); if (q) { q.focus(); q.select(); } }
  if (st.state === 'scanning' && st.cameraOn) {
    const ph = $('bc-video');
    if (ph && videoEl && ph !== videoEl) { videoEl.id = 'bc-video'; videoEl.style.display = ''; ph.replaceWith(videoEl); }
  }
}
// One camera session for the whole counting session. It is started once here and released once when the
// screen closes (or the app is backgrounded) — never reopened per item.
async function startCameraNow() {
  if (!session || !st) return;
  st.cameraOn = true; paint();                       // puts the persistent <video> in the box
  try { await session.startCamera(videoEl); }
  catch (err) { if (st) { st.cameraOn = false; paint(); } Bus.emit('toast', { msg: err.message || 'Could not start the camera', kind: 'error' }); }
}

function msg(kind, title, detail) {
  return `<div class="bc-card bc-card--${kind}"><span class="bc-pill bc-pill--${kind === 'matched' ? 'ok' : kind === 'unknown' ? 'warn' : 'bad'}">${title}</span><div class="bc-sub" style="margin-top:6px;">${detail || ''}</div></div>`;
}

async function onScan({ raw, source }) {
  if (!overlay) return;
  if (st.state === 'count' || st.state === 'choose') {
    // Another scan while an item is open must never replace it or become a quantity
    // (the wedge listener has already stripped any characters typed into the box).
    if (source !== 'camera') { Bus.emit('toast', { msg: 'Confirm or cancel the current item first', kind: 'error' }); BarcodeScanner.feedback('error'); }
    return;
  }
  if (st.readyAt && Date.now() < st.readyAt) return;   // camera is still looking at the item just counted
  const a = activeAssignment(); if (!a) return;
  const { myCounts } = Store.getState();
  const recount = isRecount(a);
  const res = await Actions.processScan(raw, {
    scanType: recount ? 'recount' : 'count', engagementId: a.engagementId, roundId: a.roundId, assignmentId: a.id,
    isAlreadyCounted: (code) => (a.items || []).some(it => it.code === code && (Store.getState().myCounts || {})[it.itemKey] !== undefined),
  });
  st.message = '';
  if (res.result === 'invalid') { st.message = msg('invalid', 'INVALID SCAN', BarcodeValidation.invalidReasonText(res.reason)); BarcodeScanner.feedback('error'); return paint(); }
  if (res.result === 'unknown') { st.message = msg('unknown', 'UNKNOWN BARCODE', `<span class="bc-code">${Components.esc(res.barcode)}</span><br>Not registered. Close this screen and search the product by name, then ask a Deputy/Main Auditor to register the barcode.`); BarcodeScanner.feedback('error'); return paint(); }
  if (res.result === 'conflict') { st.message = msg('conflict', 'BARCODE CONFLICT', 'This barcode is disputed between two products. Do not use it — search the product by name and tell the Main Auditor.'); BarcodeScanner.feedback('error'); return paint(); }
  if (res.result === 'disabled') { st.message = msg('disabled', 'DISABLED BARCODE', 'This barcode was retired. Search the product by name instead.'); BarcodeScanner.feedback('error'); return paint(); }

  // matched | duplicate → must belong to THIS assignment
  const hit = BarcodeLookup.findAssignmentItem(a.items, res.productCode);
  if (!hit.found) {
    const name = res.product ? res.product.name : res.productCode;
    st.message = msg('conflict', recount ? 'NOT PART OF THIS RECOUNT' : 'NOT IN THIS ASSIGNMENT', `${Components.esc(name)} is not in your ${recount ? 'recount list' : 'assignment'}. Nothing was changed.`);
    BarcodeScanner.feedback('error'); return paint();
  }
  BarcodeScanner.feedback('matched');
  st.duplicate = res.result === 'duplicate';
  if (hit.ambiguous) { st.state = 'choose'; st.candidates = hit.candidates; st.name = res.product ? res.product.name : res.productCode; return paint(); }
  st.state = 'count'; st.item = hit.item; paint();
}

function confirmCount(itemKey) {
  const a = activeAssignment(); if (!a) return;
  const input = $('bc-count-qty'); if (!input) return;
  const raw = input.value.trim();
  if (raw === '' || isNaN(parseFloat(raw)) || parseFloat(raw) < 0) { Bus.emit('toast', { msg: 'Enter the physical quantity', kind: 'error' }); input.focus(); return; }
  if (parseFloat(raw) >= LARGE_QTY && !window.confirm(`Physical quantity is ${raw}. Is that right?`)) { input.focus(); return; }
  const item = (a.items || []).find(it => it.itemKey === itemKey); if (!item) return;
  Actions.recordMyCount(itemKey, raw);          // existing path — all calculations unchanged
  hooks.onCounted(item);
  BarcodeScanner.feedback('saved');
  st.state = 'scanning'; st.item = null; st.duplicate = false; st.readyAt = Date.now() + 1500;
  st.message = msg('matched', '✓ SAVED', `${Components.esc(item.name)} = ${Components.esc(raw)}`);
  paint();                                       // straight back to scanning (camera is still running)
}

export function openBarcodeCounting() {
  if (overlay) return;
  const a = activeAssignment();
  if (!a || a.status === 'submitted') return;
  overlay = document.createElement('div');
  overlay.id = 'bc-count-overlay';
  overlay.setAttribute('role', 'dialog'); overlay.setAttribute('aria-modal', 'true'); overlay.setAttribute('aria-label', 'Scan to count');
  overlay.style.cssText = 'position:fixed; inset:0; z-index:9000; background:var(--page-bg,#E7ECF2); display:flex; flex-direction:column;';
  (document.getElementById('app') || document.body).appendChild(overlay); // inside #app so the delegated click/input listeners reach it
  videoEl = document.createElement('video'); videoEl.setAttribute('playsinline', 'true'); videoEl.muted = true;
  st = { state: 'scanning', item: null, candidates: [], message: '', cameraOn: false, duplicate: false, readyAt: 0 };
  session = openScannerSession(onScan);
  paint();
}
function close() {
  if (session) session.close(); session = null; videoEl = null;
  if (overlay) overlay.remove(); overlay = null; st = null;
  hooks.onCounted(null);
}

export function initBarcodeCounting(h) {
  hooks = Object.assign(hooks, h || {});
  Bus.on('view:activated', (p) => { if (p !== 'team' && overlay) close(); });
  // The shared camera started/stopped/was restarted (resume, reset, fallback): redraw the scanner box,
  // but never while the quantity card is open (that would wipe what is being typed).
  Bus.on('scanner:camera', (e) => {
    if (!overlay || !st || (e && e.on === false && e.resuming)) return;
    if (e && e.on === false) st.cameraOn = false;
    if (st.state === 'scanning') paint();
  });
  const clickHandlers = {
    'barcode-count-open': () => openBarcodeCounting(),
    'barcode-count-close': () => close(),
    'barcode-count-confirm': (el) => confirmCount(el.dataset.itemKey),
    'barcode-count-skip': () => { st.state = 'scanning'; st.item = null; st.message = ''; st.readyAt = Date.now() + 1000; paint(); },
    'barcode-count-pick': (el) => { const a = activeAssignment(); const it = a && a.items.find(x => x.itemKey === el.dataset.itemKey); if (it) { st.item = it; st.state = 'count'; paint(); } },
    'barcode-count-camera-start': () => startCameraNow(),
    'barcode-count-camera-stop': () => { if (!overlay || !st) return; session.stopCamera(); st.cameraOn = false; paint(); },
  };
  const keydownHandlers = {
    'barcode-count-key': (e, el) => { if (e.key === 'Enter') { e.preventDefault(); const b = overlay && overlay.querySelector('[data-action="barcode-count-confirm"]'); if (b) confirmCount(b.dataset.itemKey); } },
  };
  return { clickHandlers, keydownHandlers };
}
