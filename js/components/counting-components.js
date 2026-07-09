import { esc } from './dom-utils.js';
import { varianceCellHTML } from './legacy-components.js';

/* ══════════════════════════════════════════════════════════════
   FLOOR 4 — COMPONENTS / counting-components.js
   Blueprint §Counting Module (Sub-Auditor) — pure render only.
   ══════════════════════════════════════════════════════════════ */

export function companyGroupHeaderRow(companyName, varianceValue, collapsed) {
  const tr = document.createElement('tr');
  tr.dataset.action = 'toggle-company-group';
  tr.dataset.company = companyName;
  tr.style.cursor = 'pointer';
  const hasImpact = varianceValue !== undefined && varianceValue !== 0;
  const impactColor = varianceValue < 0 ? 'var(--red)' : 'var(--green)';
  const impactHTML = hasImpact
    ? `<span style="color:${impactColor}; font-weight:800;">${varianceValue < 0 ? '-' : '+'}Rs ${Math.abs(Math.round(varianceValue)).toLocaleString()}</span>`
    : `<span style="color:var(--grey); font-weight:600;">Rs 0</span>`;
  tr.innerHTML = `<td colspan="4" style="background:var(--light); padding:8px 10px;">
    <div style="display:flex; align-items:center; justify-content:space-between;">
      <span style="font-weight:800; color:var(--navy); font-size:11px; text-transform:uppercase; letter-spacing:0.3px;">${collapsed ? '▸' : '▾'} ${esc(companyName)}</span>
      <span style="font-size:11px;">${impactHTML}</span>
    </div>
  </td>`;
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
  const newSkuBadge = item.isNewSinceLastRound
    ? `<span class="val-badge val-gold" style="margin-left:6px; font-size:9px;">NEW — not in prior round</span>` : '';

  tr.innerHTML = `
    <td style="padding-left:10px;">
      <div style="font-size:13px; font-weight:700; color:var(--navy); line-height:1.3;">${esc(item.name)}${newSkuBadge}</div>
      <div style="font-size:10px; color:var(--grey); margin-top:2px;">${item.code ? esc(item.code) : 'No SKU'} · Rs ${item.price}</div>
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
