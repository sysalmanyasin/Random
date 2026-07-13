import { esc } from './dom-utils.js';

/* ══════════════════════════════════════════════════════════════
   FLOOR 4 — COMPONENTS / engagement-components.js
   Blueprint §Engagement + §Scope Selection — pure render only.
   ══════════════════════════════════════════════════════════════ */

const STATUS_BADGE = { open: 'val-green', archived: 'val-grey', closed: 'val-navy' };

export function engagementCard(engagement) {
  const card = document.createElement('div');
  card.className = 'company-card';
  card.dataset.action = 'open-engagement';
  card.dataset.engagementId = engagement.id;
  card.tabIndex = 0;
  card.setAttribute('role', 'button');
  card.setAttribute('aria-label', 'Open engagement ' + engagement.name);
  const badgeCls = STATUS_BADGE[engagement.status] || 'val-grey';
  card.innerHTML = `
    <div style="flex:1; min-width:0;">
      <div class="company-card-name">${esc(engagement.name)}</div>
      <div class="company-card-meta">${engagement.scope.companies.length} company(ies) in scope · ${new Date(engagement.createdAt).toLocaleDateString('en-PK')}</div>
    </div>
    <div class="company-card-badges">
      <span class="val-badge ${badgeCls}" style="font-size:10px;">${esc(engagement.status)}</span>
    </div>`;
  return card;
}

export function scopeCompanyCheckboxRow(company, checked, skuCount, value, dataAction) {
  const row = document.createElement('label');
  row.className = 'scope-company-row';
  const meta = skuCount !== undefined
    ? `${skuCount.toLocaleString()} SKU${skuCount === 1 ? '' : 's'} · Rs ${Math.round(value).toLocaleString()}`
    : '';
  row.innerHTML = `
    <input type="checkbox" class="custom-checkbox" data-action="${esc(dataAction || 'toggle-scope-company')}" data-company="${esc(company)}" ${checked ? 'checked' : ''}>
    <span class="scope-company-name-wrap">
      <span class="scope-company-name">${esc(company)}</span>
      ${meta ? `<span class="scope-company-count">${meta}</span>` : ''}
    </span>
  `;
  return row;
}

export function engagementHeaderHTML(engagement) {
  const badgeCls = STATUS_BADGE[engagement.status] || 'val-grey';
  return `
    <div class="engagement-header-card">
      <div style="display:flex; justify-content:space-between; align-items:flex-start;">
        <div>
          <div style="font-size:16px; font-weight:800; color:var(--navy);">${esc(engagement.name)}</div>
          <div style="font-size:11px; color:var(--grey); margin-top:2px;">Scope: ${esc(engagement.scope.type)} · ${engagement.scope.companies.length} company(ies)</div>
        </div>
        <span class="val-badge ${badgeCls}">${esc(engagement.status)}</span>
      </div>
    </div>`;
}
