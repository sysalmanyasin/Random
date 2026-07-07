import { esc } from './dom-utils.js';
import { varianceCellHTML } from './legacy-components.js';

/* ══════════════════════════════════════════════════════════════
   FLOOR 4 — COMPONENTS / counting-components.js
   Blueprint §Counting Module (Sub-Auditor) — pure render only.
   ══════════════════════════════════════════════════════════════ */

export function companyGroupHeaderRow(companyName) {
  const tr = document.createElement('tr');
  tr.innerHTML = `<td colspan="4" style="background:var(--light); font-weight:800; color:var(--navy); font-size:11px; padding:8px 10px; text-transform:uppercase; letter-spacing:0.3px;">${esc(companyName)}</td>`;
  return tr;
}

export function countingRow(item, countedVal, noteVal, readOnly, confirmedSame) {
  const tr = document.createElement('tr');
  const sysVal = countedVal !== undefined ? countedVal : '';
  const dis = readOnly ? 'disabled' : '';
  if (confirmedSame) tr.classList.add('row-confirmed-same');

  const hasPrevVariance = item.prevVariance !== undefined && item.prevVariance !== null && item.prevVariance !== 0;
  const prevSign = hasPrevVariance && item.prevVariance > 0 ? '+' : '';
  const prevLineHTML = hasPrevVariance ? `
      <div class="prev-variance-line">
        <span>Last round: Var ${prevSign}${item.prevVariance}${item.prevRoundNumber ? ' (R' + item.prevRoundNumber + ')' : ''}</span>
        <button type="button" class="btn-same" data-action="apply-same-variance" data-item-key="${esc(item.itemKey)}" ${dis}>${confirmedSame ? '✓ Same' : 'Same'}</button>
      </div>` : '';

  tr.innerHTML = `
    <td style="padding-left:10px;">
      <div style="font-size:13px; font-weight:700; color:var(--navy); line-height:1.3;">${esc(item.name)}</div>
      <div style="font-size:10px; color:var(--grey); margin-top:2px;">${esc(item.company)} · ${item.code ? esc(item.code) : 'No SKU'}</div>
      <input type="text" class="counting-note-input" placeholder="+ note / flag" value="${esc(noteVal || '')}"
        data-input-action="record-assignment-note" data-item-key="${esc(item.itemKey)}" ${dis}>
      ${prevLineHTML}
    </td>
    <td style="text-align:right; font-weight:700; color:var(--navy); font-size:14px;">${item.qty}</td>
    <td style="text-align:right;">
      <input type="number" min="0" step="1" value="${sysVal}" placeholder="-" class="audit-count-input"
        data-item-key="${esc(item.itemKey)}"
        data-input-action="record-assignment-count" data-keydown-action="counting-input-enter-next"
        inputmode="decimal" enterkeyhint="next" ${dis}>
    </td>
    <td style="text-align:right; padding-right:10px; font-weight:800;">${varianceCellHTML(sysVal, item.qty, item.price)}</td>
  `;
  return tr;
}

export function countingProgressBarHTML(progress) {
  return `
    <div style="margin-bottom:8px;">
      <div style="display:flex; justify-content:space-between; font-size:11px; font-weight:700; color:var(--grey); margin-bottom:4px;">
        <span>${progress.counted} / ${progress.total} counted</span><span>${progress.pct}%</span>
      </div>
      <div class="progress-track"><div class="progress-fill" style="width:${progress.pct}%;"></div></div>
    </div>`;
}
