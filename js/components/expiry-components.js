import { esc } from './dom-utils.js';

/* ══════════════════════════════════════════════════════════════
   FLOOR 4 — COMPONENTS / expiry-components.js
   Expiry Tracking module: the Log Entry form (product search-and-
   pick, quantity, month, rack, status), the universal search/browse
   list (grouped month-wise), and the Racks admin screen (master
   list + monthly staff assignment). Pure render only — every button
   here is wired up in pages/expiry-pages.js.
   ══════════════════════════════════════════════════════════════ */

const STATUS_OPTIONS = ['Near Expiry', 'Sold', 'Returned to Warehouse', 'Discarded'];
const STATUS_STYLE = {
  'Near Expiry': { bg: '#FFF3D6', ink: '#8A6D00' },
  'Sold': { bg: '#ECFDF5', ink: '#059669' },
  'Returned to Warehouse': { bg: '#EAF2FF', ink: '#1B3A6B' },
  'Discarded': { bg: '#FEE2E2', ink: '#B42318' },
};
function statusBadgeHTML(status) {
  const s = STATUS_STYLE[status] || STATUS_STYLE['Near Expiry'];
  return `<span class="val-badge" style="background:${s.bg}; color:${s.ink};">${esc(status)}</span>`;
}
function statusOptionsHTML(selected) {
  return STATUS_OPTIONS.map(s => `<option value="${esc(s)}" ${s === selected ? 'selected' : ''}>${esc(s)}</option>`).join('');
}
function monthOptionsHTML(monthOptions, selected, includeAll) {
  const all = includeAll ? `<option value="">All months</option>` : '';
  return all + monthOptions.map(o => `<option value="${esc(o.value)}" ${o.value === selected ? 'selected' : ''}>${esc(o.label)}</option>`).join('');
}

// ── Log Entry form ──
export function expiryProductPickerHTML(pickedProduct, query) {
  if (pickedProduct) {
    return `
      <div style="display:flex; align-items:center; gap:8px; background:var(--light); border-radius:10px; padding:10px 12px;">
        <div style="flex:1; min-width:0;">
          <div style="font-weight:800; color:var(--navy); font-size:13px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">${esc(pickedProduct.name)}</div>
          <div style="font-size:11px; color:var(--grey);">${esc(pickedProduct.code || 'No code')}</div>
        </div>
        <button class="btn" style="font-size:11px; padding:8px 10px; background:white; color:var(--navy); flex-shrink:0;" data-action="expiry-clear-product">Change</button>
      </div>`;
  }
  return `
    <input type="text" id="expiry-product-search-input" class="search-input" placeholder="🔍 Search inventory by code or name…" aria-label="Search inventory to log an expiry entry" value="${esc(query || '')}" data-input-action="expiry-product-search">
    <div id="expiry-product-results" style="max-height:26vh; overflow:auto; border:1px solid #E2E8F0; border-radius:10px; margin-top:6px;"></div>`;
}

export function expiryProductResultsHTML(products) {
  if (!products || products.length === 0) return `<div style="padding:14px; text-align:center; font-size:12px; color:var(--grey);">No matching products</div>`;
  return products.slice(0, 40).map(p => `
    <div style="display:flex; align-items:center; gap:8px; padding:9px 12px; border-bottom:1px solid #EEF1F5;">
      <div style="flex:1; min-width:0;">
        <div style="font-weight:700; color:var(--navy); font-size:12.5px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">${esc(p.name)}</div>
        <div style="font-size:11px; color:var(--grey);">${esc(p.code || '—')} · ${esc(p.company || '')}</div>
      </div>
      <button class="btn btn-sm btn-primary" style="flex-shrink:0;" data-action="expiry-pick-product" data-code="${esc(p.code || '')}" data-name="${esc(p.name)}">Pick</button>
    </div>`).join('');
}

// rackChoices: array of rack names this staff member may choose from
// (their own assigned rack(s) if any exist for the current month,
// otherwise every active rack) — the filtering itself happens in
// pages/expiry-pages.js, this just renders whatever list it's given.
export function expiryLogFormHTML({ pickedProduct, productQuery, monthOptions, rackChoices, rackFreeText, defaultStatus }) {
  const rackIsOther = rackFreeText !== null && rackFreeText !== undefined;
  return `
    <div class="card">
      <div class="card-title" style="margin-top:0;">Log a Near-Expiry Item</div>

      <label class="settings-label">Product</label>
      <div id="expiry-product-picker">${expiryProductPickerHTML(pickedProduct, productQuery)}</div>

      <label class="settings-label" for="expiry-qty-input">Quantity</label>
      <input type="number" id="expiry-qty-input" class="settings-input" placeholder="e.g. 12" min="1" inputmode="numeric">

      <label class="settings-label" for="expiry-month-select">Expiry Month</label>
      <select id="expiry-month-select" class="settings-input">${monthOptionsHTML(monthOptions, '', false)}</select>

      <label class="settings-label" for="expiry-rack-select">Rack Location</label>
      <select id="expiry-rack-select" class="settings-input" data-change-action="expiry-rack-select-change">
        ${rackChoices.map(r => `<option value="${esc(r)}">${esc(r)}</option>`).join('')}
        <option value="__other__" ${rackIsOther ? 'selected' : ''}>Other (type manually)…</option>
      </select>
      <input type="text" id="expiry-rack-freetext" class="settings-input" placeholder="Type the rack location" value="${esc(rackFreeText || '')}" style="${rackIsOther ? '' : 'display:none;'}">

      <label class="settings-label" for="expiry-status-select">Status</label>
      <select id="expiry-status-select" class="settings-input">${statusOptionsHTML(defaultStatus || 'Near Expiry')}</select>

      <button class="btn btn-primary btn-block" style="margin-top:6px;" data-action="expiry-save-entry">💾 Save Entry</button>
      <div style="font-size:11px; color:var(--grey); margin-top:8px; text-align:center;">Once saved, this entry is locked — only the Main Auditor can reopen it for edits.</div>
    </div>`;
}

// ── Universal search / browse ──
export function expirySearchBarHTML({ query, filterMonth, filterStatus, monthOptions }) {
  return `
    <input type="text" id="expiry-search-input" class="search-input" placeholder="🔍 Search any product, any time…" aria-label="Search expiry records by product" value="${esc(query || '')}" data-input-action="expiry-search">
    <div style="display:flex; gap:8px; margin:10px 0;">
      <select id="expiry-filter-month" class="settings-input" style="margin:0;" data-change-action="expiry-filter-month">${monthOptionsHTML(monthOptions, filterMonth, true)}</select>
      <select id="expiry-filter-status" class="settings-input" style="margin:0;" data-change-action="expiry-filter-status">
        <option value="all" ${!filterStatus ? 'selected' : ''}>All statuses</option>
        ${STATUS_OPTIONS.map(s => `<option value="${esc(s)}" ${s === filterStatus ? 'selected' : ''}>${esc(s)}</option>`).join('')}
      </select>
    </div>`;
}

function expiryEntryReadRowHTML(entry, isMain) {
  const lockIcon = entry.locked
    ? `<span title="Locked" style="color:var(--grey); font-size:12px;">🔒</span>`
    : `<span title="Reopened — editable" style="color:#B42318; font-size:12px;">🔓 Reopened by ${esc(entry.reopenedByName || 'Main Auditor')}</span>`;
  return `
    <div class="card" style="margin-bottom:8px;">
      <div style="display:flex; justify-content:space-between; gap:8px;">
        <div style="font-weight:800; color:var(--navy); font-size:13px;">${esc(entry.productName)}</div>
        ${statusBadgeHTML(entry.status)}
      </div>
      <div style="font-size:11px; color:var(--grey); margin-top:2px;">${esc(entry.productCode || 'No code')}</div>
      <div style="display:flex; flex-wrap:wrap; gap:10px; margin-top:8px; font-size:12px; color:var(--text);">
        <div><strong>Qty:</strong> ${esc(entry.quantity)}</div>
        <div><strong>Rack:</strong> ${esc(entry.rackLocation)}</div>
        <div><strong>Staff:</strong> ${esc(entry.staffName)}</div>
      </div>
      <div style="display:flex; justify-content:space-between; align-items:center; margin-top:8px;">
        <div style="font-size:11px; color:var(--grey);">Logged ${esc(new Date(entry.loggedAt).toLocaleDateString())} ${lockIcon}</div>
        ${isMain && entry.locked ? `<button class="btn" style="font-size:11px; padding:6px 10px; background:var(--light); color:var(--navy);" data-action="expiry-reopen" data-entry-id="${esc(entry.id)}">Reopen</button>` : ''}
      </div>
    </div>`;
}

function expiryEntryEditRowHTML(entry, monthOptions) {
  return `
    <div class="card" style="margin-bottom:8px; border:2px solid #B42318;">
      <div style="font-weight:800; color:var(--navy); font-size:13px;">${esc(entry.productName)}</div>
      <div style="font-size:11px; color:var(--grey); margin-bottom:8px;">${esc(entry.productCode || 'No code')} · reopened for editing</div>

      <label class="settings-label">Quantity</label>
      <input type="number" id="expiry-edit-qty-${esc(entry.id)}" class="settings-input" value="${esc(entry.quantity)}" min="1">

      <label class="settings-label">Expiry Month</label>
      <select id="expiry-edit-month-${esc(entry.id)}" class="settings-input">${monthOptionsHTML(monthOptions, entry.expiryMonth, false)}</select>

      <label class="settings-label">Rack Location</label>
      <input type="text" id="expiry-edit-rack-${esc(entry.id)}" class="settings-input" value="${esc(entry.rackLocation)}">

      <label class="settings-label">Status</label>
      <select id="expiry-edit-status-${esc(entry.id)}" class="settings-input">${statusOptionsHTML(entry.status)}</select>

      <div style="display:flex; gap:8px; margin-top:8px;">
        <button class="btn btn-primary" style="flex:1;" data-action="expiry-save-reopened" data-entry-id="${esc(entry.id)}">💾 Save &amp; Re-lock</button>
        <button class="btn btn-danger" style="flex-shrink:0;" data-action="expiry-delete-entry" data-entry-id="${esc(entry.id)}">Delete</button>
      </div>
    </div>`;
}

// Groups entries by expiry_month so the list reads exactly like the
// physical "expiry rack, displayed month-wise" the Main Auditor
// already keeps — just searchable and staff-attributed now.
export function expiryEntriesListHTML(entries, { isMain, editingId, monthOptions, monthLabelOf }) {
  if (!entries || entries.length === 0) {
    return `<div class="card" style="text-align:center; padding:24px 16px;"><div style="font-weight:700; color:var(--navy);">No matching entries.</div><div style="font-size:12px; color:var(--grey); margin-top:4px;">Try a different search term or clear the filters.</div></div>`;
  }
  const groups = new Map();
  entries.forEach(e => {
    if (!groups.has(e.expiryMonth)) groups.set(e.expiryMonth, []);
    groups.get(e.expiryMonth).push(e);
  });
  let html = '';
  for (const [month, rows] of groups) {
    html += `<div style="font-weight:800; color:var(--navy); font-size:12px; text-transform:uppercase; letter-spacing:.4px; margin:14px 0 6px;">${esc(monthLabelOf(month))} · ${rows.length} item${rows.length === 1 ? '' : 's'}</div>`;
    html += rows.map(e => (isMain && editingId === e.id) ? expiryEntryEditRowHTML(e, monthOptions) : expiryEntryReadRowHTML(e, isMain)).join('');
  }
  return html;
}

// ── Racks admin (Settings, Main Auditor only) ──
export function racksAdminHTML({ racks, rackAssignments, staffList, month, monthOptions }) {
  const activeRacks = (racks || []).filter(r => r.active);
  const assignmentByRackId = new Map((rackAssignments || []).map(a => [a.rackId, a]));
  return `
    <div class="card">
      <div class="card-title" style="margin-top:0;">Monthly Rack Assignment</div>
      <label class="settings-label" for="expiry-assign-month-select">Month</label>
      <select id="expiry-assign-month-select" class="settings-input" data-change-action="expiry-assign-month-change">${monthOptionsHTML(monthOptions, month, false)}</select>

      ${activeRacks.length === 0 ? `<div style="font-size:12px; color:var(--grey); margin-top:10px;">No racks yet — add one below.</div>` : activeRacks.map(r => {
        const current = assignmentByRackId.get(r.id);
        return `
        <div style="display:flex; align-items:center; gap:8px; padding:10px 0; border-bottom:1px solid #EEF1F5;">
          <div style="flex:1; min-width:0;">
            <div style="font-weight:700; color:var(--navy); font-size:13px;">${esc(r.name)}</div>
            <div style="font-size:11px; color:var(--grey);">${current ? 'Assigned to ' + esc(current.staffName) : 'Unassigned'}</div>
          </div>
          <select class="settings-input expiry-rack-assign-select" style="margin:0; width:auto; flex-shrink:0;" data-rack-id="${esc(r.id)}" data-rack-name="${esc(r.name)}">
            <option value="">— choose staff —</option>
            ${(staffList || []).map(s => `<option value="${esc(s.id)}" data-name="${esc(s.name)}" ${current && current.staffId === s.id ? 'selected' : ''}>${esc(s.name)}</option>`).join('')}
          </select>
          <button class="btn btn-primary" style="font-size:11px; padding:8px 10px; flex-shrink:0;" data-action="expiry-assign-rack" data-rack-id="${esc(r.id)}" data-rack-name="${esc(r.name)}">Assign</button>
        </div>`;
      }).join('')}
    </div>

    <div class="card">
      <div class="card-title" style="margin-top:0;">Racks (Master List)</div>
      ${activeRacks.length === 0 ? '' : activeRacks.map(r => `
        <div style="display:flex; align-items:center; gap:8px; padding:6px 0;">
          <div style="flex:1; font-size:13px; color:var(--text);">${esc(r.name)}</div>
          <button class="btn btn-danger" style="font-size:11px; padding:6px 10px;" data-action="expiry-delete-rack" data-rack-id="${esc(r.id)}" data-rack-name="${esc(r.name)}">Delete</button>
        </div>`).join('')}
      <div style="display:flex; gap:6px; margin-top:10px;">
        <input type="text" id="new-rack-name-input" class="settings-input" placeholder="e.g. Rack A2" style="margin:0; flex:1;">
        <button class="btn btn-primary" style="font-size:12px; padding:8px 12px;" data-action="expiry-add-rack">Add</button>
      </div>
    </div>`;
}
