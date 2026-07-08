import { Store } from '../store.js';
import { Actions, Bus } from '../actions.js';
import { Components } from '../components.js';

/* ══════════════════════════════════════════════════════════════
   FLOOR 5 — PAGES / inventory-pages.js
   The Inventory tab: searchable/groupable product browser, saved
   Templates, and the Individual/Team Random Audit launch buttons.
   Same render-function + Bus-subscription + handler-map pattern as
   every other page module — merged into event-delegation.js.
   ══════════════════════════════════════════════════════════════ */

const $ = (id) => document.getElementById(id);
const collapsedGroups = new Set(); // page-local UI state, not worth putting in the store

function _visibleProducts() {
  const { products, inventorySearchQuery } = Store.getState();
  const q = (inventorySearchQuery || '').toLowerCase().trim();
  if (!q) return products;
  return products.filter(p =>
    (p.name || '').toLowerCase().includes(q) ||
    (p.code || '').toLowerCase().includes(q) ||
    (p.generic || '').toLowerCase().includes(q) ||
    (p.company || '').toLowerCase().includes(q) ||
    (p.supplier || '').toLowerCase().includes(q));
}

function renderInventoryTable() {
  const tbody = $('inv-table-body');
  if (!tbody) return;
  const { products, inventoryGroupBy, inventorySelectedCodes } = Store.getState();
  const selectedSet = new Set(inventorySelectedCodes);
  const visible = _visibleProducts();

  $('inv-empty-state').style.display = products.length === 0 ? 'block' : 'none';
  $('inv-table-wrap').style.display = products.length === 0 ? 'none' : 'block';
  if (products.length === 0) { tbody.innerHTML = ''; return; }

  tbody.innerHTML = '';
  if (visible.length === 0) {
    tbody.innerHTML = '<tr><td colspan="7" style="text-align:center; color:var(--grey); padding:24px; font-weight:600;">No matching items found.</td></tr>';
    return;
  }

  if (inventoryGroupBy === 'none') {
    visible.forEach(p => tbody.appendChild(Components.inventoryRow(p, selectedSet.has(p.code))));
    tbody.appendChild(Components.inventorySubtotalRow('Visible total', visible));
    return;
  }

  const key = inventoryGroupBy === 'supplier' ? 'supplier' : 'company';
  const groups = new Map();
  visible.forEach(p => {
    const g = p[key] || 'Unassigned';
    if (!groups.has(g)) groups.set(g, []);
    groups.get(g).push(p);
  });
  [...groups.keys()].sort().forEach(groupName => {
    const items = groups.get(groupName);
    const groupAllSelected = items.length > 0 && items.every(p => selectedSet.has(p.code));
    const collapsed = collapsedGroups.has(groupName);
    tbody.appendChild(Components.inventoryGroupHeader(groupName, items, groupAllSelected, collapsed));
    if (!collapsed) {
      items.forEach(p => tbody.appendChild(Components.inventoryRow(p, selectedSet.has(p.code))));
      tbody.appendChild(Components.inventorySubtotalRow(groupName, items));
    }
  });
}

function renderTemplatesList() {
  const container = $('inv-templates-list');
  if (!container) return;
  const { templates, activeTemplateId, resolvedTemplateMatch } = Store.getState();
  if (templates.length === 0) {
    container.innerHTML = '<div style="text-align:center; color:var(--grey); padding:16px 0; font-size:12px; font-style:italic;">No saved templates yet.</div>';
    return;
  }
  container.innerHTML = '';
  templates.forEach(t => {
    container.appendChild(Components.templateListItem(t, t.id === activeTemplateId, t.id === activeTemplateId ? resolvedTemplateMatch : null));
  });
}

function renderSelectionBar() {
  const { inventorySelectedCodes } = Store.getState();
  const count = inventorySelectedCodes.length;
  const bar = $('inv-selection-bar');
  if (!bar) return;
  bar.style.display = count > 0 ? 'flex' : 'none';
  $('inv-selection-count').textContent = `${count} code${count !== 1 ? 's' : ''} selected`;
}

function renderInventoryTab() {
  renderInventoryTable();
  renderTemplatesList();
  renderSelectionBar();
}
Bus.on('products:changed', renderInventoryTab);
Bus.on('inventory:filterChanged', renderInventoryTable);
Bus.on('inventory:selectionChanged', () => { renderInventoryTable(); renderSelectionBar(); renderTemplatesList(); });
Bus.on('templates:changed', renderTemplatesList);
Bus.on('templates:loaded', () => { renderTemplatesList(); renderInventoryTable(); });
Bus.on('view:activated', (page) => { if (page === 'inventory') renderInventoryTab(); });

// ── Report generation — builds a fresh D-26-style report into the
//    shared #printable-report-canvas (same element/@media-print trick
//    used for audit-history PDFs), then hands off to window.print(). ──
let _originalCanvasHTML = null;
function generateInventoryReport() {
  const { inventorySelectedCodes } = Store.getState();
  const rows = inventorySelectedCodes.length > 0
    ? _visibleProducts().filter(p => inventorySelectedCodes.includes(p.code))
    : _visibleProducts();
  if (rows.length === 0) { Bus.emit('toast', { msg: 'Nothing to report — clear filters or selection', kind: 'error' }); return; }

  const totalQty = rows.reduce((s, m) => s + (m.qty || 0), 0);
  const totalValue = rows.reduce((s, m) => s + (m.qty || 0) * (m.price || 0), 0);
  const tableRows = rows.map(p => `
    <tr>
      <td>${Components.esc(p.code || '')}</td>
      <td>${Components.esc(p.name)}</td>
      <td style="text-align:right;">${p.qty}</td>
      <td style="text-align:right;">Rs ${Number(p.price || 0).toLocaleString()}</td>
      <td>${Components.esc(p.generic || '')}</td>
      <td>${Components.esc(p.company || '')}</td>
      <td>${Components.esc(p.supplier || '')}</td>
      <td style="text-align:right;">${p.conversionFactor ?? 1}</td>
    </tr>`).join('');

  const canvas = $('printable-report-canvas');
  if (_originalCanvasHTML === null) _originalCanvasHTML = canvas.innerHTML;
  canvas.innerHTML = `
    <div class="pdf-meta-box">
      <div>
        <div class="pdf-brand-title">Fazal Din's Pharma Plus</div>
        <div style="font-size:13px; font-weight:700; color:#475569; margin-top:2px;">Inventory Snapshot Report</div>
        <div style="font-size:12px; color:#64748B; margin-top:1px;">Branch Terminal: ${Components.esc(Actions.getBranchName())}</div>
      </div>
      <div style="text-align:right; font-size:12px; color:#475569; line-height:1.6;">
        <div><strong>Snapshot Date:</strong> ${new Date().toLocaleDateString('en-PK')}</div>
        <div><strong>Items:</strong> ${rows.length.toLocaleString()}</div>
      </div>
    </div>
    <div class="pdf-summary-grid">
      <div class="pdf-stat-card" style="border-top:4px solid #1B3A6B;"><div class="pdf-stat-val">${rows.length.toLocaleString()}</div><div class="pdf-stat-lbl">SKUs</div></div>
      <div class="pdf-stat-card" style="border-top:4px solid #059669;"><div class="pdf-stat-val">${totalQty.toLocaleString()}</div><div class="pdf-stat-lbl">Total Units</div></div>
      <div class="pdf-stat-card" style="border-top:4px solid #F59E0B; grid-column: span 2;"><div class="pdf-stat-val">Rs ${totalValue.toLocaleString()}</div><div class="pdf-stat-lbl">Total Retail Value</div></div>
    </div>
    <table class="pdf-table">
      <thead><tr><th>Code</th><th>Name</th><th>Qty</th><th>Price</th><th>Generic</th><th>Manufacture</th><th>Supplier</th><th>Conv. Factor</th></tr></thead>
      <tbody>${tableRows}</tbody>
    </table>`;
  window.print();
  setTimeout(() => { canvas.innerHTML = _originalCanvasHTML; }, 500);
}

// ── Handlers ──────────────────────────────────────────────
export function initInventoryPages() {
  const clickHandlers = {
    'set-inventory-group': (el) => { Actions.setInventoryGroupBy(el.dataset.group); document.querySelectorAll('.inv-group-btn').forEach(b => b.classList.remove('filter-btn-active')); el.classList.add('filter-btn-active'); },
    'toggle-inventory-group-collapse': (el) => { const g = el.dataset.group; collapsedGroups.has(g) ? collapsedGroups.delete(g) : collapsedGroups.add(g); renderInventoryTable(); },
    'clear-inventory-selection': () => Actions.clearInventorySelection(),
    'save-selection-as-template': () => { const name = prompt('Name this template:'); if (name) Actions.saveSelectionAsTemplate(name); },
    'load-template': (el) => Actions.loadTemplateIntoSelection(el.dataset.templateId),
    'rename-template': (el) => { const name = prompt('Rename template:'); if (name) Actions.renameTemplate(el.dataset.templateId, name); },
    'delete-template': (el) => Actions.deleteTemplate(el.dataset.templateId),
    'start-individual-random-audit': () => {
      const sampleSize = parseInt($('inv-sample-size').value) || 10;
      const { templates, activeTemplateId } = Store.getState();
      const active = templates.find(t => t.id === activeTemplateId);
      Actions.startIndividualRandomAudit(sampleSize, active ? active.name : 'Random Audit');
    },
    'start-team-random-audit': () => {
      const { templates, activeTemplateId } = Store.getState();
      const active = templates.find(t => t.id === activeTemplateId);
      const name = prompt('Name this Team Audit engagement:', active ? active.name : '');
      if (name) Actions.startTeamRandomAudit(name);
    },
    'generate-inventory-report': generateInventoryReport,
  };
  const inputHandlers = {
    'inventory-search': (el) => Actions.setInventorySearch(el.value),
  };
  const changeHandlers = {
    'toggle-inventory-row': (el) => Actions.toggleInventorySelection(el.dataset.code),
    'toggle-inventory-group-select': (el) => {
      const g = el.dataset.group;
      const { inventoryGroupBy } = Store.getState();
      const key = inventoryGroupBy === 'supplier' ? 'supplier' : 'company';
      const codes = _visibleProducts().filter(p => (p[key] || 'Unassigned') === g).map(p => p.code).filter(Boolean);
      Actions.selectManyForInventory(codes, el.checked);
    },
    'handle-inventory-codes-file': (el) => { if (el.files[0]) Actions.importCodesFromFile(el.files[0]); el.value = ''; },
  };
  return { clickHandlers, inputHandlers, changeHandlers, keydownHandlers: {} };
}
