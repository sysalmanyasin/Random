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
      <div class="inv-product-name" style="font-size:13px; font-weight:700; color:var(--navy); line-height:1.3;" title="${esc(product.name)}">${esc(product.name)}</div>
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

// ── Template Builder popup — Candela "Product Code Help"-style search-
//    and-add. The shell (title, search box, container divs) is rendered
//    ONCE on open; results/selected re-render into their own containers
//    on every keystroke/add/remove so the search input never loses focus
//    mid-type the way a full innerHTML replace would. ──
export function templateBuilderShellHTML(mode, query) {
  return `
    <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:10px;">
      <h3 class="modal-title">🔍 Build a Template</h3>
      <button class="sort-btn" data-action="close-template-builder" style="padding:4px 10px;">✕</button>
    </div>
    <div style="font-size:11px; color:var(--grey); margin-bottom:10px;">Search products one at a time, or switch to <strong>By Company</strong> to add an entire company's products in one tap — then save the list as a named template.</div>
    <div style="display:flex; gap:6px; margin-bottom:10px;">
      <button class="filter-btn ${mode === 'search' ? 'filter-btn-active' : ''}" data-action="template-builder-set-mode" data-mode="search" style="flex:1;">🔍 Search Products</button>
      <button class="filter-btn ${mode === 'company' ? 'filter-btn-active' : ''}" data-action="template-builder-set-mode" data-mode="company" style="flex:1;">🏢 By Company</button>
    </div>
    <div id="template-builder-browse" style="margin-bottom:12px;"></div>
    <div id="template-builder-selected" style="margin-bottom:10px;"></div>
    <div style="display:flex; gap:8px;">
      <button class="btn" style="flex:1; background:var(--light); color:var(--navy);" data-action="template-builder-clear">✕ Clear all</button>
      <button class="btn btn-primary" style="flex:1;" data-action="template-builder-save">💾 Save as Template</button>
    </div>`;
}

// The two modes' input+list markup, swapped into #template-builder-browse
// whenever the mode tab changes. Each mode's own text input (product
// search / company filter) lives here, rendered once per mode-switch —
// per-keystroke updates only ever touch the list container below it.
export function templateBuilderBrowseHTML(mode, query) {
  if (mode === 'company') {
    return `
      <input type="text" id="template-builder-company-filter" class="search-input" placeholder="Filter companies…" aria-label="Filter companies to add to this template" data-input-action="template-builder-company-filter" style="margin-bottom:10px;">
      <div id="template-builder-company-list" style="max-height:30vh; overflow:auto; border:1px solid #E2E8F0; border-radius:10px;"></div>`;
  }
  return `
    <input type="text" id="template-builder-search-input" class="search-input" placeholder="Search code, name, generic, company, supplier…" aria-label="Search inventory to add to this template" value="${esc(query || '')}" data-input-action="template-builder-search" style="margin-bottom:10px;">
    <div id="template-builder-results" style="max-height:30vh; overflow:auto; border:1px solid #E2E8F0; border-radius:10px;"></div>`;
}

export function templateBuilderResultsHTML(query, results, truncated, totalMatches, selectedSet) {
  if (!query || !query.trim()) {
    return `<div style="padding:20px 10px; text-align:center; color:var(--grey); font-size:12px;">Start typing to search inventory…</div>`;
  }
  if (results.length === 0) {
    return `<div style="padding:20px 10px; text-align:center; color:var(--grey); font-size:12px;">No matching items found.</div>`;
  }
  const rows = results.map(p => {
    const isSelected = p.code && selectedSet.has(p.code);
    return `
      <div style="display:flex; align-items:center; justify-content:space-between; gap:8px; padding:8px 10px; border-bottom:1px solid #F1F5F9;">
        <div style="min-width:0; flex:1;">
          <div style="font-size:12.5px; font-weight:700; color:var(--navy); overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">${esc(p.name)}</div>
          <div style="font-size:10.5px; color:var(--grey); overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">${p.code ? esc(p.code) : 'No SKU'} · ${esc(p.company || '')}</div>
        </div>
        ${isSelected
          ? `<button class="btn btn-sm" style="flex-shrink:0; background:#ECFDF5; color:#059669;" data-action="template-builder-remove" data-code="${esc(p.code)}">✓ Added</button>`
          : `<button class="btn btn-sm btn-primary" style="flex-shrink:0;" data-action="template-builder-add" data-code="${esc(p.code || '')}" ${!p.code ? 'disabled title="No product code to add"' : ''}>Add</button>`}
      </div>`;
  }).join('');
  const note = truncated
    ? `<div style="padding:6px 10px; font-size:10px; color:var(--grey); text-align:center;">Showing first ${results.length} of ${totalMatches.toLocaleString()} matches — refine your search to narrow it down.</div>` : '';
  return rows + note;
}

export function templateBuilderSelectedHTML(selectedItems) {
  if (selectedItems.length === 0) {
    return `<div style="font-size:11px; color:var(--grey);">Nothing added yet — search above and tap Add.</div>`;
  }
  const sorted = selectedItems.slice().sort((a, b) => a.name.localeCompare(b.name));
  const chips = sorted.map(p => `
    <span style="display:inline-flex; align-items:center; gap:5px; background:var(--light); border-radius:20px; padding:4px 6px 4px 10px; font-size:11px; font-weight:600; color:var(--navy); margin:2px 4px 2px 0;">
      ${esc(p.name)}
      <button data-action="template-builder-remove" data-code="${esc(p.code)}" aria-label="Remove ${esc(p.name)}" style="border:none; background:#E2E8F0; color:var(--navy); border-radius:50%; width:16px; height:16px; font-size:10px; line-height:1; cursor:pointer; padding:0;">✕</button>
    </span>`).join('');
  return `
    <div style="font-size:11px; font-weight:700; color:var(--navy); margin-bottom:6px;">${selectedItems.length} code(s) added</div>
    <div style="max-height:14vh; overflow:auto;">${chips}</div>`;
}

// `companies` is [{ name, codes }] — codes already restricted to products
// that actually have a code (blank-code products can't be added to a
// template, same rule as the search tab). Checkbox state is a simple
// tri-state read against the current selection: all-in → checked,
// some-in → indeterminate (set via JS after insert, see inventory-pages.js
// — HTML has no indeterminate attribute), none-in → unchecked.
export function templateBuilderCompanyListHTML(companies, selectedSet, filterQuery) {
  const q = (filterQuery || '').toLowerCase().trim();
  const filtered = q ? companies.filter(c => c.name.toLowerCase().includes(q)) : companies;
  if (filtered.length === 0) {
    return `<div style="padding:20px 10px; text-align:center; color:var(--grey); font-size:12px;">No matching companies.</div>`;
  }
  return filtered.map(c => {
    const addedCount = c.codes.filter(code => selectedSet.has(code)).length;
    const allAdded = c.codes.length > 0 && addedCount === c.codes.length;
    const someAdded = addedCount > 0 && !allAdded;
    return `
      <div style="display:flex; align-items:center; justify-content:space-between; gap:8px; padding:9px 10px; border-bottom:1px solid #F1F5F9;">
        <label style="display:flex; align-items:center; gap:8px; min-width:0; flex:1; cursor:pointer;">
          <input type="checkbox" class="custom-checkbox" data-change-action="toggle-template-builder-company" data-company="${esc(c.name)}" ${allAdded ? 'checked' : ''} ${someAdded ? 'data-indeterminate="true"' : ''}>
          <span style="font-size:12.5px; font-weight:700; color:var(--navy); overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">${esc(c.name)}</span>
        </label>
        <span style="font-size:10.5px; color:var(--grey); flex-shrink:0;">${addedCount}/${c.codes.length} added</span>
      </div>`;
  }).join('');
}
