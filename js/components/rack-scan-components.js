import { esc } from './dom-utils.js';

/* ══════════════════════════════════════════════════════════════
   FLOOR 4 — COMPONENTS / rack-scan-components.js
   Pure render functions for the Rack Scan overlay. Data in, HTML out.
   ══════════════════════════════════════════════════════════════ */

const fmt = (n) => Number(n || 0).toLocaleString('en-PK', { maximumFractionDigits: 2 });
const rs = (n) => (n < 0 ? '−Rs ' : (n > 0 ? '+Rs ' : 'Rs ')) + fmt(Math.abs(n));
const sign = (n) => (n > 0 ? '+' : n < 0 ? '−' : '') + fmt(Math.abs(n));

export function rackStripHTML(s) {
  return `<div class="rk-strip" aria-live="polite">
    <div class="rk-stat"><b>${s.checked}</b><span>Checked</span></div>
    <div class="rk-stat rk-ok"><b>${s.matched}</b><span>Match</span></div>
    <div class="rk-stat rk-bad"><b>${s.variance}</b><span>Variance</span></div>
    <div class="rk-stat rk-warn"><b>${s.notInSystem}</b><span>Not in sys</span></div>
    <div class="rk-stat"><b>${rs(s.netValue)}</b><span>Net value</span></div>
  </div>`;
}

export function rackStartHTML({ canUse, pending }) {
  if (!canUse) return `<div class="rk-card">Rack Scan is available to the Main Auditor only.</div>`;
  return `<div class="rk-card">
    <div class="rk-title">Start a rack scan</div>
    <div class="rk-sub">Scan whatever is on the rack, any company. Each item is checked against system stock instantly.</div>
    <input id="rk-label" class="bc-field" type="text" maxlength="40" placeholder="Rack name (optional) e.g. Rack 3" aria-label="Rack name" data-keydown-action="rack-label-key">
    <button class="bc-btn bc-btn--primary" data-action="rack-start">Start scanning</button>
    <button class="bc-btn bc-btn--ghost" data-action="rack-history-open">Past rack scans</button>
    ${pending ? `<div class="rk-sub">${pending} record(s) waiting to sync</div>` : ''}
  </div>`;
}

function productBlock(p, barcode) {
  return p
    ? `<div class="bc-big">${esc(p.name)}</div><div class="bc-sub">${esc(p.company || '')} · Code ${esc(p.code)}</div><div class="bc-code">${esc(barcode || '')}</div>`
    : `<div class="bc-big">Not in system</div><div class="bc-code">${esc(barcode || '')}</div>`;
}

// state = 'count' | 'dup'
export function rackCountHTML({ product, barcode, existing, state }) {
  const sys = product ? Number(product.qty) : 0;
  const head = product
    ? `<div class="rk-sysrow"><span>System balance</span><b>${fmt(sys)}</b></div>`
    : `<div class="rk-sysrow rk-warn-bg"><span>⚠ Found on shelf, not in system</span><b>—</b></div>`;
  const dup = existing
    ? `<div class="rk-dup">Already counted this session: <b>${fmt(existing.countedQty)}</b>. Add to it, or replace it?</div>` : '';
  const buttons = existing
    ? `<div class="bc-row"><button class="bc-btn bc-btn--gold" data-action="rack-confirm" data-dup="add">Add to count</button>
       <button class="bc-btn bc-btn--primary" data-action="rack-confirm" data-dup="replace">Replace</button></div>`
    : `<div class="bc-row">${product ? `<button class="bc-btn bc-btn--ok" data-action="rack-match">✓ Matches (${fmt(sys)})</button>` : ''}
       <button class="bc-btn bc-btn--primary" data-action="rack-confirm" data-dup="replace">Save count</button></div>`;
  return `<div class="bc-card bc-card--matched">${productBlock(product, barcode)}${head}${dup}
    <label class="rk-lbl" for="rk-qty">Physical quantity</label>
    <input id="rk-qty" class="bc-field rk-qty" type="number" inputmode="decimal" min="0" step="any" autocomplete="off" data-keydown-action="rack-qty-key" placeholder="${existing ? 'Quantity to add / replace with' : 'Count on shelf'}">
    ${buttons}
    <button class="bc-btn bc-btn--ghost" data-action="rack-skip">Cancel</button></div>`;
}

export function rackResultHTML({ item, canRecount }) {
  const ok = item.result === 'match';
  const nis = item.result === 'not_in_system';
  const cls = ok ? 'matched' : nis ? 'unknown' : 'conflict';
  const pill = ok ? '✅ MATCH' : nis ? '⚠ NOT IN SYSTEM' : '❌ VARIANCE';
  const detail = ok ? `System ${fmt(item.systemQty)} = counted ${fmt(item.countedQty)}`
    : nis ? `Logged ${fmt(item.countedQty)} found on shelf`
    : `System ${fmt(item.systemQty)} · Counted ${fmt(item.countedQty)} · <b>${sign(item.diff)}</b> (${rs(item.varianceValue)})`;
  return `<div class="bc-card bc-card--${cls}"><span class="bc-pill bc-pill--${ok ? 'ok' : nis ? 'warn' : 'bad'}">${pill}</span>
    <div class="bc-big" style="margin-top:6px;">${esc(item.productName || 'Item not in system')}</div>
    <div class="bc-sub">${detail}${item.entryMode === 'matched_tap' ? ' · ✓ tap' : ''}</div>
    ${ok ? '' : `<div class="bc-row" style="margin-top:8px;">
      ${canRecount && !nis ? `<button class="bc-btn bc-btn--gold" data-action="rack-recount" data-key="${esc(item.key)}">Recount now</button>` : ''}
      <button class="bc-btn bc-btn--ghost" data-action="rack-flag" data-key="${esc(item.key)}">${item.flagged ? '⚑ Flagged' : 'Flag for later'}</button>
      <button class="bc-btn bc-btn--primary" data-action="rack-next">Next item</button></div>`}
  </div>`;
}

export function rackMessageHTML(kind, title, detail) {
  return `<div class="bc-card bc-card--${kind}"><span class="bc-pill bc-pill--${kind === 'matched' ? 'ok' : kind === 'unknown' ? 'warn' : 'bad'}">${esc(title)}</span><div class="bc-sub" style="margin-top:6px;">${detail || ''}</div></div>`;
}

// Unknown barcode: register to a product, or just log it as not-in-system.
export function rackUnknownHTML({ barcode, query, results, canRegister }) {
  return `<div class="bc-card bc-card--unknown"><span class="bc-pill bc-pill--warn">UNKNOWN BARCODE</span>
    <div class="bc-code" style="margin-top:6px;">${esc(barcode)}</div>
    ${canRegister ? `<div class="bc-sub">Find the product to register this barcode:</div>
      <input id="rk-reg-q" class="bc-field" type="text" value="${esc(query || '')}" placeholder="Search name or code" data-input-action="rack-reg-search">
      <div class="rk-results">${(results || []).map(p => `<button class="rk-res" data-action="rack-register" data-code="${esc(p.code)}"><b>${esc(p.name)}</b><span>${esc(p.company || '')} · stock ${fmt(p.qty)}</span></button>`).join('') || (query ? '<div class="bc-sub">No match</div>' : '')}</div>` : ''}
    <div class="bc-row" style="margin-top:8px;"><button class="bc-btn bc-btn--ghost" data-action="rack-log-notinsystem">Log as not in system</button>
    <button class="bc-btn bc-btn--ghost" data-action="rack-skip">Skip</button></div></div>`;
}

export function rackRecentHTML(items) {
  const last = items.slice(-6).reverse();
  if (!last.length) return '';
  return `<div class="rk-recent"><div class="rk-sub">Recent</div>${last.map(i => `<div class="rk-line">
    <span class="rk-dot rk-dot--${i.result}"></span><span class="rk-name">${esc(i.productName || '(not in system)')}</span>
    <span class="rk-num">${i.result === 'match' ? fmt(i.countedQty) : sign(i.diff)}</span>${i.flagged ? '<span>⚑</span>' : ''}</div>`).join('')}</div>`;
}

export function rackSummaryHTML({ session, s, rows, synced, pending }) {
  const closed = session.status === 'closed';
  return `<div class="rk-card"><div class="rk-title">${closed ? 'Rack scan complete' : 'Summary'} — ${esc(session.label || 'Rack')}</div>
    ${rackStripHTML(s)}
    <div class="rk-grid">
      <div>Typed counts <b>${s.typed}</b></div><div>✓ Match taps <b>${s.tapped}</b></div>
      <div>Shortage <b>${rs(s.shortValue)}</b></div><div>Excess <b>${rs(s.excessValue)}</b></div>
      <div>Flagged <b>${s.flagged}</b></div><div>Accuracy <b>${s.accuracy === null ? '—' : s.accuracy + '%'}</b></div>
    </div>
    ${rows}
    ${closed ? '' : `<input id="rk-signoff" class="bc-field" type="text" maxlength="60" placeholder="Signed off by (name)" aria-label="Signed off by">`}
    <div class="bc-row">
      ${closed ? '' : `<button class="bc-btn bc-btn--ok" data-action="rack-finish">Sign off &amp; finish</button>`}
      <button class="bc-btn bc-btn--primary" data-action="rack-export">Export Excel</button></div>
    ${closed ? `<button class="bc-btn bc-btn--ghost" data-action="rack-new">New rack scan</button>` : `<button class="bc-btn bc-btn--ghost" data-action="rack-back">Back to scanning</button>`}
    <div class="rk-sub">${pending ? pending + ' record(s) waiting to sync' : (synced ? '☁ Synced' : '')}</div></div>`;
}

export function rackSummaryRowsHTML(items) {
  const bad = items.filter(i => i.result !== 'match');
  if (!bad.length) return '<div class="rk-sub">No variances 🎉</div>';
  return `<div class="rk-tbl">${bad.map(i => `<div class="rk-line"><span class="rk-dot rk-dot--${i.result}"></span>
    <span class="rk-name">${esc(i.productName || '(not in system) ' + (i.barcode || ''))}</span>
    <span class="rk-num">${i.result === 'not_in_system' ? 'NIS ' + fmt(i.countedQty) : sign(i.diff) + ' · ' + rs(i.varianceValue)}</span></div>`).join('')}</div>`;
}

export function rackHistoryHTML(rows) {
  return `<div class="rk-card"><div class="rk-title">Past rack scans</div>
    ${(rows || []).map(r => `<div class="rk-line"><span class="rk-name">${esc(r.rack_label || 'Rack')}</span>
      <span class="rk-num">${esc(String(r.started_at).slice(0, 10))} · ${esc(r.status)}${r.signed_off_by ? ' · ' + esc(r.signed_off_by) : ''}</span></div>`).join('') || '<div class="rk-sub">No rack scans yet</div>'}
    <button class="bc-btn bc-btn--ghost" data-action="rack-back-start">Back</button></div>`;
}

export function rackOverlayShellHTML({ title, body, strip, scannerHTML, footer }) {
  return `<div class="rk-head"><div class="rk-title">📦 ${esc(title)}</div><button class="bc-btn bc-btn--ghost rk-x" data-action="rack-close" aria-label="Close Rack Scan">✕</button></div>
    <div class="rk-body">${strip || ''}${scannerHTML || ''}${body || ''}${footer || ''}</div>`;
}
