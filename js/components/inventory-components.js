import { esc } from './dom-utils.js';

/* ══════════════════════════════════════════════════════════════
   FLOOR 4 — COMPONENTS / inventory-components.js
   Pure render functions for the Inventory tab — searchable/
   groupable product browser + saved Templates list. Same rules as
   every other Components file: no Repo, no Store.setState, no
   Bus.emit here.
   ══════════════════════════════════════════════════════════════ */

export function inventoryRow(product, selected) {
  const tr = document.createElement('tr');
  tr.className = 'inv-row';
  tr.innerHTML = `
    <td style="width:34px; text-align:center;">
      <input type="checkbox" class="custom-checkbox" data-change-action="toggle-inventory-row" data-code="${esc(product.code || '')}" ${selected ? 'checked' : ''}>
    </td>
    <td>
      <div style="font-size:13px; font-weight:700; color:var(--navy); line-height:1.3;">${esc(product.name)}</div>
      <div style="font-size:10px; color:var(--grey); margin-top:2px;">${product.code ? esc(product.code) : 'No SKU'} · ${esc(product.generic || '—')}</div>
    </td>
    <td style="text-align:right; font-weight:700; color:var(--navy); font-size:13px;">${product.qty}</td>
    <td style="text-align:right; font-size:13px;">Rs ${Number(product.price || 0).toLocaleString()}</td>
    <td style="font-size:11px; color:var(--grey);">${esc(product.company || '—')}</td>
    <td style="font-size:11px; color:var(--grey);">${esc(product.supplier || '—')}</td>
    <td style="text-align:right; font-size:11px; color:var(--grey);">${product.conversionFactor ?? 1}</td>
  `;
  return tr;
}

// Collapsible group header row (Company/Supplier grouping), with a
// select-all-in-group checkbox and a subtotal — same D-26-style
// "items · units · Rs value" summary as companyCard uses elsewhere.
export function inventoryGroupHeader(groupName, items, groupAllSelected, collapsed) {
  const tr = document.createElement('tr');
  tr.className = 'inv-group-header';
  tr.dataset.action = 'toggle-inventory-group-collapse';
  tr.dataset.group = groupName;
  tr.tabIndex = 0;
  tr.setAttribute('aria-label', 'Toggle ' + groupName + ' group');
  const totalQty = items.reduce((s, m) => s + (m.qty || 0), 0);
  const totalValue = items.reduce((s, m) => s + (m.qty || 0) * (m.price || 0), 0);
  tr.innerHTML = `
    <td style="width:34px; text-align:center;">
      <input type="checkbox" class="custom-checkbox" data-change-action="toggle-inventory-group-select" data-group="${esc(groupName)}" ${groupAllSelected ? 'checked' : ''} onclick="event.stopPropagation()">
    </td>
    <td colspan="6" style="padding:8px 6px;">
      <span class="arrow-toggle ${collapsed ? '' : 'open'}" style="margin-right:6px;">▸</span>
      <strong style="color:var(--navy); font-size:12.5px;">${esc(groupName)}</strong>
      <span style="color:var(--grey); font-size:11px; margin-left:8px;">${items.length} SKU${items.length !== 1 ? 's' : ''} · ${totalQty.toLocaleString()} units · Rs ${totalValue.toLocaleString()}</span>
    </td>
  `;
  return tr;
}

export function inventorySubtotalRow(label, items) {
  const tr = document.createElement('tr');
  tr.className = 'inv-subtotal-row';
  const totalQty = items.reduce((s, m) => s + (m.qty || 0), 0);
  const totalValue = items.reduce((s, m) => s + (m.qty || 0) * (m.price || 0), 0);
  tr.innerHTML = `
    <td></td>
    <td style="font-weight:800; font-size:11.5px; color:var(--navy);">${esc(label)} — ${items.length} item(s)</td>
    <td style="text-align:right; font-weight:800; font-size:12px;">${totalQty.toLocaleString()}</td>
    <td style="text-align:right; font-weight:800; font-size:12px;">Rs ${totalValue.toLocaleString()}</td>
    <td colspan="3"></td>
  `;
  return tr;
}

// Appears at the bottom of the (windowed) product list whenever more
// filtered rows exist than are currently rendered — keeps the DOM small
// on a 5000+ SKU inventory instead of building every row up front.
export function inventoryLoadMoreRow(remainingCount) {
  const tr = document.createElement('tr');
  tr.innerHTML = `
    <td colspan="7" style="padding:12px 6px; text-align:center;">
      <button class="btn btn-sm" data-action="inventory-load-more">Show ${Math.min(remainingCount, 150)} more (${remainingCount.toLocaleString()} remaining)</button>
    </td>`;
  return tr;
}

export function templateListItem(template, isActive, matchInfo) {
  const div = document.createElement('div');
  div.className = 'company-card' + (isActive ? ' active' : '');
  div.dataset.action = 'load-template';
  div.dataset.templateId = template.id;
  div.tabIndex = 0;
  div.setAttribute('role', 'button');
  div.setAttribute('aria-label', 'Load template ' + template.name);
  const matchLabel = isActive && matchInfo ? `${matchInfo.matched} of ${matchInfo.total} matched` : `${template.codes.length} code(s)`;
  div.innerHTML = `
    <div style="flex:1; min-width:0;">
      <div class="company-card-name">${esc(template.name)}</div>
      <div class="company-card-meta">${matchLabel}${isActive && matchInfo && matchInfo.matched < matchInfo.total ? ` · <span style="color:var(--red);">${matchInfo.total - matchInfo.matched} discontinued</span>` : ''}</div>
    </div>
    <div class="company-card-badges" style="gap:6px;">
      <button class="btn btn-sm" data-action="rename-template" data-template-id="${template.id}">✎</button>
      <button class="btn btn-sm btn-danger" data-action="delete-template" data-template-id="${template.id}">🗑</button>
    </div>
  `;
  return div;
}
