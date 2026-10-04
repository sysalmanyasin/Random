import { esc } from './dom-utils.js';

/* ══════════════════════════════════════════════════════════════
   FLOOR 4 — COMPONENTS / barcode-components.js
   Pure render functions for the Barcode Center. Data in, HTML out;
   every button is wired in pages/barcode-pages.js.
   ══════════════════════════════════════════════════════════════ */

const STATUS_LABEL = { verified: 'Verified', unverified: 'Unverified', conflict: 'Conflict', disabled: 'Disabled' };
const STATUS_CLASS = { verified: 'ok', unverified: 'warn', conflict: 'bad', disabled: 'bad' };
export function barcodeStatusBadgeHTML(status) {
  return `<span class="bc-pill bc-pill--${STATUS_CLASS[status] || 'info'}">${esc(STATUS_LABEL[status] || status)}</span>`;
}
function fmtDate(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  return isNaN(d) ? '—' : d.toLocaleDateString(undefined, { day: '2-digit', month: 'short', year: '2-digit' }) + ' ' + d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
}

export function barcodeSubnavHTML({ view, canRegister, conflictCount, unverifiedCount }) {
  const tabs = [
    ['scan', '📷 Scan'], ['master', '📚 Master'],
    ...(canRegister ? [['register', '➕ Register'], ['queue', '✅ Queue' + (unverifiedCount ? ' (' + unverifiedCount + ')' : '')]] : []),
    ['conflicts', '⚠️ Conflicts' + (conflictCount ? ' (' + conflictCount + ')' : '')], ['history', '🕘 Scans'],
    ...(canRegister ? [['reports', '📊 Reports']] : []),
  ];
  return `<div style="display:flex; gap:8px; margin:10px 0; overflow-x:auto; padding-bottom:4px;">` +
    tabs.map(([v, l]) => `<button class="filter-btn ${view === v ? 'filter-btn-active' : ''}" style="white-space:nowrap; min-height:44px;" data-action="barcode-set-subview" data-subview="${v}">${esc(l)}</button>`).join('') + `</div>`;
}

// Offline / Syncing / Saved states, always visible at the top.
export function barcodeStatusBarHTML({ online, syncing, pending, size }) {
  const pills = [];
  pills.push(online ? `<span class="bc-pill bc-pill--ok">● Online</span>` : `<span class="bc-pill bc-pill--warn">● Offline — scans are saved on this device</span>`);
  if (syncing) pills.push(`<span class="bc-pill bc-pill--info">↻ Syncing…</span>`);
  else if (pending > 0) pills.push(`<button class="bc-pill bc-pill--warn" style="border:0; cursor:pointer;" data-action="barcode-sync-now">${pending} waiting to sync · tap to retry</button>`);
  else pills.push(`<span class="bc-pill bc-pill--ok">✓ Saved</span>`);
  pills.push(`<span class="bc-pill bc-pill--info">${size} barcodes on device</span>`);
  return `<div class="bc-status">${pills.join('')}</div>`;
}

export function barcodeScannerBoxHTML({ cameraOn, cameraSupported, hint, camPrefix }) {
  const cp = camPrefix || 'barcode';
  return `
    <div class="bc-scanner" id="bc-scanner-box">
      <video id="bc-video" playsinline muted ${cameraOn ? '' : 'style="display:none;"'}></video>
      ${cameraOn ? '<div class="bc-reticle"></div>' : `
        <div class="bc-scanner-idle">
          <div style="font-size:34px;">📷</div>
          <div>${cameraSupported ? 'Tap to start the camera' : 'No camera available — use a scanner or type the code'}</div>
          ${cameraSupported ? `<button class="bc-btn bc-btn--gold" style="width:auto;" data-action="${cp}-camera-start">Start camera</button>` : ''}
        </div>`}
    </div>
    <div style="font-size:11px; color:var(--grey); font-weight:700; margin-top:6px; text-align:center;">${esc(hint || 'USB / Bluetooth scanners work here too — just scan.')}</div>
    <div class="bc-row" style="align-items:stretch;">
      <input type="text" inputmode="numeric" autocomplete="off" id="bc-manual-input" class="bc-field" placeholder="Type or paste barcode" aria-label="Barcode" data-keydown-action="barcode-manual-key">
      <button class="bc-btn bc-btn--primary" style="flex:0 0 96px;" data-action="barcode-manual-submit">Go</button>
    </div>
    ${cameraOn ? `<button class="bc-btn bc-btn--ghost" style="margin-top:8px; min-height:44px;" data-action="${cp}-camera-stop">Stop camera</button>` : ''}`;
}

// The five result states. `r` = BarcodeActions.processScan() result.
export function barcodeResultCardHTML(r, { canRegister, canAdminister }) {
  if (!r) return '';
  const code = `<div class="bc-code">${esc(r.barcode || r.raw || '')}</div>`;
  const productBlock = (p, codeFallback) => p
    ? `<div class="bc-big">${esc(p.name)}</div><div class="bc-sub">Code: ${esc(p.code)} · ${esc(p.company || '')}</div>`
    : `<div class="bc-big">${esc(codeFallback || '—')}</div><div class="bc-sub">Product not in current inventory</div>`;
  switch (r.result) {
    case 'matched': return `<div class="bc-card bc-card--matched bc-flash-ok"><span class="bc-pill bc-pill--ok">✓ MATCHED</span>${productBlock(r.product, r.productCode)}<div style="margin-top:8px;">${code}</div></div>`;
    case 'duplicate': return `<div class="bc-card bc-card--duplicate"><span class="bc-pill bc-pill--warn">DUPLICATE — already counted</span>${productBlock(r.product, r.productCode)}</div>`;
    case 'unknown': return `<div class="bc-card bc-card--unknown">
        <span class="bc-pill bc-pill--warn">UNKNOWN BARCODE</span>
        <div style="margin:8px 0;">${code}</div>
        ${canRegister ? `<div class="bc-row">
            <button class="bc-btn bc-btn--ghost" data-action="barcode-unknown-search">Search Product</button>
            <button class="bc-btn bc-btn--primary" data-action="barcode-unknown-register">Register Barcode</button></div>`
          : `<div class="bc-sub">Ask a Deputy or Main Auditor to register this barcode.</div>`}
      </div>`;
    case 'conflict': return `<div class="bc-card bc-card--conflict"><span class="bc-pill bc-pill--bad">CONFLICT — do not use</span>
        <div style="margin:8px 0;">${code}</div>
        <div class="bc-sub">Linked to:</div>${productBlock(r.product, r.productCode)}
        <div class="bc-sub" style="margin-top:8px;">Also claimed by:</div>${productBlock(r.claimant, r.conflictWith)}
        <div class="bc-sub" style="margin-top:8px;">${canAdminister ? 'Resolve it in the Conflicts tab.' : 'A Main Auditor must resolve this.'}</div></div>`;
    case 'disabled': return `<div class="bc-card bc-card--disabled"><span class="bc-pill bc-pill--bad">DISABLED BARCODE</span><div style="margin:8px 0;">${code}</div><div class="bc-sub">This barcode was retired. Do not count with it — find the product manually.</div></div>`;
    case 'invalid': return `<div class="bc-card bc-card--invalid"><span class="bc-pill bc-pill--bad">INVALID SCAN</span><div class="bc-sub" style="margin-top:6px;">${esc(r.message || 'Could not read that barcode — rescan')}</div></div>`;
    default: return '';
  }
}

export function barcodeProductPickerHTML({ picked, query, results, inputAction, pickAction, clearAction }) {
  if (picked) {
    return `<div class="bc-card" style="margin-top:6px;"><div class="bc-big">${esc(picked.name)}</div>
      <div class="bc-sub">Product Code: ${esc(picked.code)} · ${esc(picked.company || '')}</div>
      <button class="bc-btn bc-btn--ghost" style="margin-top:10px; min-height:44px;" data-action="${clearAction}">Change product</button></div>`;
  }
  return `<input type="text" id="bc-product-search" class="bc-field" placeholder="🔍 Search product name or code" autocomplete="off" value="${esc(query || '')}" data-input-action="${inputAction}">
    <div class="bc-list" id="bc-product-results" style="max-height:34vh; overflow:auto;">${barcodeProductResultsHTML(results, pickAction)}</div>`;
}
export function barcodeProductResultsHTML(results, pickAction) {
  if (!results || !results.length) return `<div class="bc-empty">Type to search products</div>`;
  return results.map(p => `<div class="bc-list-row">
      <div style="flex:1; min-width:0;"><div style="font-weight:800; color:var(--navy); font-size:14px;">${esc(p.name)}</div><div class="bc-sub">${esc(p.code)} · ${esc(p.company || '')}</div></div>
      <button class="bc-btn bc-btn--primary" style="width:auto; min-height:44px; font-size:14px;" data-action="${pickAction}" data-code="${esc(p.code)}">Pick</button></div>`).join('');
}

// Register Barcode: Select Product → Scan → Review → Verify & Save
export function barcodeRegisterHTML({ picked, query, results, detected, detectedState, scannerHTML, saving, fromUnknown }) {
  const step1 = `<div class="bc-label">1 · Select product</div>` +
    barcodeProductPickerHTML({ picked, query, results, inputAction: 'barcode-register-search', pickAction: 'barcode-register-pick', clearAction: 'barcode-register-clear' });
  if (!picked) return step1;
  const step2 = `<div class="bc-label">2 · Scan the package barcode</div>${scannerHTML}`;
  let step3 = '';
  if (detected) {
    const s = detectedState || {};
    let body;
    if (s.kind === 'invalid') body = `<span class="bc-pill bc-pill--bad">INVALID</span><div class="bc-sub" style="margin-top:6px;">${esc(s.message)}</div>`;
    else if (s.kind === 'same') body = `<span class="bc-pill bc-pill--ok">ALREADY LINKED</span><div class="bc-sub" style="margin-top:6px;">This barcode is already linked to ${esc(picked.name)}.</div>`;
    else if (s.kind === 'other') body = `<span class="bc-pill bc-pill--bad">BELONGS TO ANOTHER PRODUCT</span>
        <div class="bc-sub" style="margin-top:6px;">Linked to <b>${esc(s.otherName || s.otherCode)}</b> (${esc(s.otherCode)}). It will NOT be moved. If you believe it is wrong, report a conflict for the Main Auditor.</div>
        <button class="bc-btn bc-btn--gold" style="margin-top:10px;" data-action="barcode-register-report-conflict">Report conflict</button>`;
    else body = `<div class="bc-sub">Check these match the package in your hand:</div>
        <div class="bc-big" style="margin-top:4px;">${esc(picked.name)}</div>
        <div class="bc-sub">Product Code: ${esc(picked.code)}</div>
        <div class="bc-label">Detected barcode</div><div class="bc-code">${esc(detected)}</div>
        <button class="bc-btn bc-btn--green" style="margin-top:12px;" data-action="barcode-register-save" ${saving ? 'disabled' : ''}>${saving ? 'Saving…' : (fromUnknown ? 'VERIFY &amp; LINK' : 'Verify &amp; Save')}</button>`;
    step3 = `<div class="bc-label">3 · Verify</div><div class="bc-card">${body}</div>`;
  }
  return step1 + step2 + step3;
}

export function barcodeMasterCountText(n, cap) { return n + ' barcode' + (n === 1 ? '' : 's') + (n > cap ? ' · showing first ' + cap + ' — refine your search' : ''); }
export function barcodeMasterHTML({ rows, query, status, cap }) {
  const filters = [['', 'All'], ['verified', 'Verified'], ['unverified', 'Unverified'], ['conflict', 'Conflict'], ['disabled', 'Disabled']]
    .map(([v, l]) => `<button class="filter-btn ${status === v ? 'filter-btn-active' : ''}" style="min-height:40px;" data-action="barcode-master-filter" data-status="${v}">${l}</button>`).join('');
  const shown = rows.slice(0, cap);
  return `<input type="text" id="bc-master-search" class="bc-field" placeholder="🔍 Barcode, product code or name" value="${esc(query || '')}" data-input-action="barcode-master-search" autocomplete="off">
    <div style="display:flex; gap:6px; overflow-x:auto; margin-top:8px;">${filters}</div>
    <div class="bc-sub" style="margin-top:8px;" id="bc-master-count">${barcodeMasterCountText(rows.length, cap)}</div>
    <div class="bc-list" id="bc-master-list">${shown.length ? shown.map(r => barcodeMasterRowHTML(r)).join('') : '<div class="bc-empty">No barcodes found</div>'}</div>`;
}
export function barcodeMasterRowHTML(r, nameFor) {
  return `<div class="bc-list-row" tabindex="0" role="button" data-action="barcode-open-detail" data-barcode="${esc(r.barcode)}" style="cursor:pointer;">
    <div style="flex:1; min-width:0;">
      <div class="bc-code" style="font-size:14px;">${esc(r.barcode)}</div>
      <div style="font-weight:800; color:var(--navy); font-size:13px;">${esc(r.productName || '(product not in inventory)')}</div>
      <div class="bc-sub">Code ${esc(r.productCode)} · Verified: ${esc(r.verifiedByName || '—')} · ${esc(fmtDate(r.verifiedAt))}</div>
    </div>${barcodeStatusBadgeHTML(r.status)}</div>`;
}

export function barcodeDetailHTML({ row, productName, history, nameFor, canRegister, canAdminister }) {
  const hist = history.length
    ? history.map(h => `<div class="bc-list-row"><div style="flex:1;"><div style="font-weight:800; font-size:13px; color:var(--navy);">${esc(h.action.replace(/_/g, ' '))}</div><div class="bc-sub">${esc(nameFor(h.performedBy))} · ${esc(fmtDate(h.performedAt))}${h.notes ? '<br>' + esc(h.notes) : ''}</div></div></div>`).join('')
    : '<div class="bc-empty">No history loaded (history needs a connection, and Deputies see only their own entries)</div>';
  const actions = [];
  if (canRegister && row.status === 'unverified') actions.push(`<button class="bc-btn bc-btn--green" data-action="barcode-verify" data-barcode="${esc(row.barcode)}">Verify</button>`);
  if (canAdminister && row.status !== 'disabled') actions.push(`<button class="bc-btn bc-btn--danger" data-action="barcode-disable-start" data-barcode="${esc(row.barcode)}">Disable</button>`);
  if (canAdminister && row.status === 'disabled') actions.push(`<button class="bc-btn bc-btn--green" data-action="barcode-verify" data-barcode="${esc(row.barcode)}">Re-enable (verify)</button>`);
  return `<button class="bc-btn bc-btn--ghost" style="min-height:44px;" data-action="barcode-close-detail">‹ Back</button>
    <div class="bc-card"><div class="bc-code">${esc(row.barcode)}</div>${barcodeStatusBadgeHTML(row.status)}
      <div class="bc-big" style="margin-top:8px;">${esc(productName || '(not in inventory)')}</div>
      <div class="bc-sub">Product Code ${esc(row.productCode)} · Type ${esc(row.barcodeType || 'unknown')}</div>
      <div class="bc-sub">Registered by ${esc(nameFor(row.createdBy))} · ${esc(fmtDate(row.createdAt))}</div>
      <div class="bc-sub">Verified by ${esc(nameFor(row.verifiedBy))} · ${esc(fmtDate(row.verifiedAt))}</div></div>
    <div id="bc-action-reason-wrap"></div>
    ${actions.length ? `<div class="bc-row">${actions.join('')}</div>` : ''}
    <div class="bc-label">History</div><div class="bc-list">${hist}</div>`;
}

export function barcodeReasonPromptHTML({ title, confirmAction, barcode, extra }) {
  return `<div class="bc-card"><div class="bc-label" style="margin-top:0;">${esc(title)}</div>
    <input type="text" id="bc-reason" class="bc-field" placeholder="Reason (required)" autocomplete="off">
    ${extra || ''}
    <div class="bc-row"><button class="bc-btn bc-btn--ghost" data-action="barcode-reason-cancel">Cancel</button>
    <button class="bc-btn bc-btn--danger" data-action="${confirmAction}" data-barcode="${esc(barcode)}">Confirm</button></div></div>`;
}

export function barcodeQueueHTML({ rows }) {
  if (!rows.length) return `<div class="bc-empty">Nothing waiting for verification ✓<br><span style="font-weight:600;">Barcodes saved with “Verify &amp; Save” are verified immediately.</span></div>`;
  return `<div class="bc-list">${rows.map(r => `<div class="bc-list-row"><div style="flex:1; min-width:0;"><div class="bc-code" style="font-size:14px;">${esc(r.barcode)}</div>
      <div style="font-weight:800; color:var(--navy); font-size:13px;">${esc(r.productName || r.productCode)}</div><div class="bc-sub">Registered ${esc(fmtDate(r.createdAt))}</div></div>
      <button class="bc-btn bc-btn--green" style="width:auto; min-height:44px; font-size:14px;" data-action="barcode-verify" data-barcode="${esc(r.barcode)}">Verify</button></div>`).join('')}</div>`;
}

export function barcodeConflictsHTML({ rows, canAdminister, nameOf }) {
  if (!rows.length) return `<div class="bc-empty">No open conflicts ✓</div>`;
  return rows.map(r => `<div class="bc-card bc-card--conflict" data-conflict="${esc(r.barcode)}">
      <span class="bc-pill bc-pill--bad">CONFLICT</span><div class="bc-code" style="margin:8px 0;">${esc(r.barcode)}</div>
      <div class="bc-sub">Currently linked to</div><div class="bc-big" style="font-size:16px;">${esc(nameOf(r.productCode))}</div><div class="bc-sub">${esc(r.productCode)}</div>
      <div class="bc-sub" style="margin-top:8px;">Also claimed by</div><div class="bc-big" style="font-size:16px;">${esc(nameOf(r.conflictWithProductCode))}</div><div class="bc-sub">${esc(r.conflictWithProductCode || '—')}</div>
      ${canAdminister ? `<input type="text" class="bc-field bc-conflict-reason" style="margin-top:10px;" placeholder="Reason (required)" autocomplete="off">
        <div class="bc-row" style="flex-direction:column;">
          <button class="bc-btn bc-btn--primary" data-action="barcode-resolve" data-barcode="${esc(r.barcode)}" data-resolution="keep">Keep current product</button>
          <button class="bc-btn bc-btn--gold" data-action="barcode-resolve" data-barcode="${esc(r.barcode)}" data-resolution="reassign">Move to claiming product</button>
          <button class="bc-btn bc-btn--danger" data-action="barcode-resolve" data-barcode="${esc(r.barcode)}" data-resolution="disable">Disable this barcode</button></div>`
        : `<div class="bc-sub" style="margin-top:8px;">Only a Main Auditor can resolve conflicts. Nothing has been changed.</div>`}
    </div>`).join('');
}

const RESULT_PILL = { matched: 'ok', duplicate: 'warn', unknown: 'warn', conflict: 'bad', disabled: 'bad' };
export function barcodeScanHistoryHTML({ events, nameFor, productName }) {
  if (!events.length) return `<div class="bc-empty">No scans to show${''}<br><span style="font-weight:600;">History needs a connection.</span></div>`;
  return `<div class="bc-list">${events.map(e => `<div class="bc-list-row"><div style="flex:1; min-width:0;">
      <div class="bc-code" style="font-size:13px;">${esc(e.barcode)}</div>
      <div style="font-weight:800; color:var(--navy); font-size:13px;">${esc(e.productCode ? productName(e.productCode) : '—')}</div>
      <div class="bc-sub">${esc(nameFor(e.userId))} · ${esc(e.scanType)} · ${esc(fmtDate(e.scannedAt))}</div></div>
      <span class="bc-pill bc-pill--${RESULT_PILL[e.result] || 'info'}">${esc(e.result)}</span></div>`).join('')}</div>`;
}

const METHODS = [
  ['manual', 'Manual', 'Search and type counts (unchanged).'],
  ['barcode', 'Barcode', 'Scan each product, then enter the count.'],
  ['hybrid', 'Hybrid', 'Scan or search — auditor chooses. Default.'],
];
export function countingMethodCardHTML(engagement) {
  const cur = engagement.countingMethod || 'hybrid';
  return `<div class="card" style="margin-top:14px;">
    <div class="card-title" style="margin-top:0;">Counting Method</div>
    <div style="font-size:11px; color:var(--grey); margin:-4px 0 8px;">Applies to every assignment in this audit, including recounts.</div>
    ${METHODS.map(([v, l, d]) => `<label style="display:flex; gap:10px; align-items:flex-start; padding:10px 4px; min-height:44px; cursor:pointer;">
        <input type="radio" name="counting-method" value="${v}" ${cur === v ? 'checked' : ''} data-change-action="set-counting-method" data-engagement-id="${esc(engagement.id)}" style="margin-top:3px;">
        <span><span style="font-weight:800; color:var(--navy);">${l}</span><br><span style="font-size:11px; color:var(--grey);">${d}</span></span></label>`).join('')}
  </div>`;
}

// Scan bar shown above the counting table. method: manual | barcode | hybrid
export function countingScanBarHTML(method, locked) {
  if (method === 'manual' || locked) return '';
  return `<button class="bc-btn bc-btn--primary" style="margin:0 0 10px; min-height:56px; font-size:17px;" data-action="barcode-count-open">📷 Scan to count</button>`;
}

// Full-screen scan-to-count overlay body.
//   state: scanning | count | choose | message
export function countingOverlayHTML(o) {
  const head = `<div style="display:flex; align-items:center; gap:8px; padding:10px 12px; background:var(--navy); color:#fff;">
      <div style="flex:1; font-weight:800; font-size:14px;">${o.recount ? 'Recount scan' : 'Scan to count'} · ${esc(o.counted)} / ${esc(o.total)} counted</div>
      <button class="bc-btn" style="width:auto; min-height:44px; font-size:14px; background:#fff; color:var(--navy);" data-action="barcode-count-close">Done</button></div>`;
  let body = '';
  if (o.state === 'count') {
    body = `<div class="bc-card bc-card--matched" style="margin:12px;">
        ${o.duplicate ? '<div class="bc-pill bc-pill--warn" style="margin-bottom:8px;">ALREADY COUNTED — you can update it</div>' : '<span class="bc-pill bc-pill--ok">✓ MATCHED</span>'}
        <div class="bc-big" style="margin-top:8px;">${esc(o.item.name)}</div>
        <div class="bc-sub">Code: ${esc(o.item.code || '—')}${o.item.company ? ' · ' + esc(o.item.company) : ''}</div>
        <div class="bc-label">System Qty</div><div class="bc-big">${esc(o.item.qty)}</div>
        <div class="bc-label">Physical Qty</div>
        <input type="number" inputmode="numeric" min="0" step="1" id="bc-count-qty" class="bc-field" style="font-size:28px; font-weight:900; text-align:center;" value="${o.current === undefined ? '' : esc(o.current)}" placeholder="0" data-keydown-action="barcode-count-key" aria-label="Physical quantity for ${esc(o.item.name)}">
        <button class="bc-btn bc-btn--green" style="margin-top:12px; min-height:60px; font-size:19px;" data-action="barcode-count-confirm" data-item-key="${esc(o.item.itemKey)}">CONFIRM</button>
        <button class="bc-btn bc-btn--ghost" style="margin-top:8px; min-height:44px;" data-action="barcode-count-skip">Cancel — scan another</button>
      </div>`;
  } else if (o.state === 'choose') {
    body = `<div class="bc-card" style="margin:12px;"><div class="bc-big">${esc(o.name)}</div>
        <div class="bc-sub">This product code appears under more than one company in this assignment. Which one did you scan?</div>
        ${o.candidates.map(c => `<button class="bc-btn bc-btn--ghost" style="margin-top:8px;" data-action="barcode-count-pick" data-item-key="${esc(c.itemKey)}">${esc(c.company || 'Company')} — System ${esc(c.qty)}</button>`).join('')}
        <button class="bc-btn bc-btn--ghost" style="margin-top:8px; min-height:44px;" data-action="barcode-count-skip">Cancel</button></div>`;
  } else {
    body = `<div id="bc-count-scanwrap" style="padding:12px;">${o.scannerHTML}</div>${o.message ? `<div style="padding:0 12px;">${o.message}</div>` : ''}`;
  }
  return head + `<div style="flex:1; overflow:auto;">${body}</div>`;
}

export function barcodeReportsHTML() {
  const b = (k, icon, t, d) => `<button class="bc-btn bc-btn--ghost" style="text-align:left; margin-top:10px;" data-action="barcode-export" data-kind="${k}">${icon} ${t}<br><span style="font-size:12px; font-weight:600; color:var(--grey);">${d}</span></button>`;
  return `<div class="bc-label">Export to Excel</div>` +
    b('master', '📚', 'Barcode Master Report', 'Every registered barcode, its product and status') +
    b('verification', '✅', 'Barcode Verification Report', 'Unverified and verified mappings') +
    b('conflicts', '⚠️', 'Barcode Conflict Report', 'Open conflicts and their resolution history') +
    b('scans', '🕘', 'Barcode Scan History', 'Who scanned what, when, in which audit and round') +
    `<div class="bc-sub" style="margin-top:12px;">Needs a connection. Barcodes also appear as the last column of the Variance and Final Audit exports. Barcode actions are in the Audit Trail.</div>`;
}
