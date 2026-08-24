import { Store } from '../store.js';
import { Actions, Bus } from '../actions.js';
import { Components } from '../components.js';
import { openEngagementDetailView } from './engagement-pages.js';

/* ══════════════════════════════════════════════════════════════
   FLOOR 5 — PAGES / inventory-pages.js
   The Inventory tab: searchable/groupable product browser, saved
   Templates, and the Individual/Team Random Audit launch buttons.
   Same render-function + Bus-subscription + handler-map pattern as
   every other page module — merged into event-delegation.js.
   ══════════════════════════════════════════════════════════════ */

const $ = (id) => document.getElementById(id);
const collapsedGroups = new Set(); // page-local UI state, not worth putting in the store

// With 5000+ SKUs, building every <tr> on each keystroke/filter change was
// the main source of lag. Render only a page of product rows at a time
// (across all groups combined) and grow it on demand via "Show more" —
// group headers/subtotals still reflect the full filtered set, only the
// individual product rows are windowed.
const PAGE_SIZE = 150;
let renderLimit = PAGE_SIZE;
let searchDebounceTimer = null;

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

// ── Template Builder popup — its own search state, deliberately kept
//    separate from the main Inventory tab's inventorySearchQuery (Store
//    state) so opening the popup never disturbs whatever the user was
//    already filtering the big table by underneath it. ──
let templateBuilderQuery = '';
let templateBuilderDebounce = null;
let templateBuilderMode = 'search'; // 'search' | 'company'
let templateBuilderCompanyFilter = '';
let templateBuilderCompanyFilterDebounce = null;
const TEMPLATE_BUILDER_RESULT_CAP = 40;

function _templateBuilderMatches() {
  const { products } = Store.getState();
  const q = templateBuilderQuery.toLowerCase().trim();
  if (!q) return [];
  return products.filter(p =>
    (p.name || '').toLowerCase().includes(q) ||
    (p.code || '').toLowerCase().includes(q) ||
    (p.generic || '').toLowerCase().includes(q) ||
    (p.company || '').toLowerCase().includes(q) ||
    (p.supplier || '').toLowerCase().includes(q));
}

// [{ name, codes }] sorted alphabetically — codes excludes blank-code
// rows, since those can never be added to a template anyway (same rule
// the Search Products tab already applies per-row).
function _templateBuilderCompanies() {
  const { products } = Store.getState();
  const map = new Map();
  products.forEach(p => {
    if (!p.code) return;
    const name = p.company || 'Unassigned';
    if (!map.has(name)) map.set(name, []);
    map.get(name).push(p.code);
  });
  return [...map.keys()].sort((a, b) => a.localeCompare(b)).map(name => ({ name, codes: map.get(name) }));
}

// Swaps the whole browse pane (search box + results, or company filter +
// list) when the mode tab is switched — a click, not a keystroke, so
// rebuilding the input here doesn't cost any focus/cursor position.
function renderTemplateBuilderBrowse() {
  const el = $('template-builder-browse');
  if (!el) return;
  el.innerHTML = Components.templateBuilderBrowseHTML(templateBuilderMode, templateBuilderQuery);
  if (templateBuilderMode === 'company') renderTemplateBuilderCompanyList();
  else renderTemplateBuilderResults();
}

// Only these two containers are touched on every keystroke/add/remove —
// the search input itself lives in the shell, rendered once on open, so
// it never loses focus mid-type.
function renderTemplateBuilderResults() {
  const el = $('template-builder-results');
  if (!el) return;
  const { inventorySelectedCodes } = Store.getState();
  const all = _templateBuilderMatches();
  const truncated = all.length > TEMPLATE_BUILDER_RESULT_CAP;
  const results = all.slice(0, TEMPLATE_BUILDER_RESULT_CAP);
  el.innerHTML = Components.templateBuilderResultsHTML(templateBuilderQuery, results, truncated, all.length, new Set(inventorySelectedCodes));
}

function renderTemplateBuilderCompanyList() {
  const el = $('template-builder-company-list');
  if (!el) return;
  const { inventorySelectedCodes } = Store.getState();
  el.innerHTML = Components.templateBuilderCompanyListHTML(_templateBuilderCompanies(), new Set(inventorySelectedCodes), templateBuilderCompanyFilter);
  // Tri-state checkboxes: "indeterminate" has no HTML attribute, so it
  // has to be set as a live DOM property after the checkbox exists.
  el.querySelectorAll('input[data-indeterminate="true"]').forEach(cb => { cb.indeterminate = true; });
}

function renderTemplateBuilderSelected() {
  const el = $('template-builder-selected');
  if (!el) return;
  const { inventorySelectedCodes } = Store.getState();
  const { items } = Actions.resolveCodes(inventorySelectedCodes);
  el.innerHTML = Components.templateBuilderSelectedHTML(items);
}

function renderInventoryTable() {
  const tbody = $('inv-table-body');
  if (!tbody) return;
  const { products, inventoryGroupBy, inventorySelectedCodes } = Store.getState();
  const selectedSet = new Set(inventorySelectedCodes);
  const visible = _visibleProducts();

  $('inv-empty-state').style.display = products.length === 0 ? 'block' : 'none';
  $('inv-table-wrap').style.display = products.length === 0 ? 'none' : 'block';
  const scrollHint = $('inv-table-scroll-hint');
  if (scrollHint) scrollHint.style.display = products.length === 0 ? 'none' : 'block';
  if (products.length === 0) { tbody.innerHTML = ''; return; }

  tbody.innerHTML = '';
  if (visible.length === 0) {
    tbody.innerHTML = '<tr><td colspan="7" style="text-align:center; color:var(--grey); padding:24px; font-weight:600;">No matching items found.</td></tr>';
    return;
  }

  // Number of *product rows* rendered this pass is capped at renderLimit,
  // regardless of grouping — group headers/subtotals below still describe
  // the full filtered set so totals stay accurate even when collapsed.
  let rowBudget = renderLimit;

  if (inventoryGroupBy === 'none') {
    const page = visible.slice(0, rowBudget);
    page.forEach(p => tbody.appendChild(Components.inventoryRow(p, selectedSet.has(p.code))));
    tbody.appendChild(Components.inventorySubtotalRow('Visible total', visible));
    if (visible.length > page.length) tbody.appendChild(Components.inventoryLoadMoreRow(visible.length - page.length));
    return;
  }

  const key = inventoryGroupBy === 'supplier' ? 'supplier' : 'company';
  const groups = new Map();
  visible.forEach(p => {
    const g = p[key] || 'Unassigned';
    if (!groups.has(g)) groups.set(g, []);
    groups.get(g).push(p);
  });
  let shownCount = 0;
  let truncated = false;
  [...groups.keys()].sort().forEach(groupName => {
    const items = groups.get(groupName);
    const groupAllSelected = items.length > 0 && items.every(p => selectedSet.has(p.code));
    const collapsed = collapsedGroups.has(groupName);
    tbody.appendChild(Components.inventoryGroupHeader(groupName, items, groupAllSelected, collapsed));
    if (!collapsed) {
      if (rowBudget <= 0) { truncated = true; return; }
      const page = items.slice(0, rowBudget);
      page.forEach(p => tbody.appendChild(Components.inventoryRow(p, selectedSet.has(p.code))));
      tbody.appendChild(Components.inventorySubtotalRow(groupName, items));
      rowBudget -= page.length;
      shownCount += page.length;
      if (page.length < items.length) truncated = true;
    }
  });
  if (truncated) tbody.appendChild(Components.inventoryLoadMoreRow(visible.length - shownCount));
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
  if (bar) {
    bar.style.display = count > 0 ? 'flex' : 'none';
    $('inv-selection-count').textContent = `${count} code${count !== 1 ? 's' : ''} selected`;
  }
  // Same count, mirrored on the Templates sub-tab (Products and
  // Templates share one inventorySelectedCodes state — see index.html
  // #inv-templates-selection-hint) so a selection made via a loaded
  // Template is visible without switching tabs first.
  const hint = $('inv-templates-selection-hint');
  if (hint) {
    hint.style.display = count > 0 ? 'block' : 'none';
    $('inv-templates-selection-count').textContent = `${count} code${count !== 1 ? 's' : ''} selected`;
  }
}

function renderInventoryTab() {
  renderInventoryTable();
  renderTemplatesList();
  renderSelectionBar();
}
Bus.on('products:changed', () => { renderLimit = PAGE_SIZE; renderInventoryTab(); });
Bus.on('inventory:filterChanged', () => { renderLimit = PAGE_SIZE; renderInventoryTable(); });
Bus.on('inventory:selectionChanged', () => { renderInventoryTable(); renderSelectionBar(); renderTemplatesList(); });
Bus.on('templates:changed', renderTemplatesList);
Bus.on('templates:loaded', () => { renderTemplatesList(); renderInventoryTable(); });
Bus.on('view:activated', (page) => {
  if (page === 'inventory') { renderLimit = PAGE_SIZE; renderInventoryTab(); }
  else if (page === 'inventory-templates') { renderTemplatesList(); renderSelectionBar(); }
});

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
  // One-time: dismiss the "swipe sideways" hint the first time the
  // table is actually scrolled — see index.html #inv-table-scroll-hint
  // and the matching pattern in engagement-pages.js for Report Overview.
  const tableWrap = $('inv-table-wrap');
  const invHint = $('inv-table-scroll-hint');
  if (tableWrap && invHint) {
    const dismissInvHint = () => { invHint.style.display = 'none'; tableWrap.removeEventListener('scroll', dismissInvHint); };
    tableWrap.addEventListener('scroll', dismissInvHint, { passive: true });
  }

  const clickHandlers = {
    'set-inventory-group': (el) => { Actions.setInventoryGroupBy(el.dataset.group); document.querySelectorAll('.inv-group-btn').forEach(b => b.classList.remove('filter-btn-active')); el.classList.add('filter-btn-active'); },
    'toggle-inventory-group-collapse': (el) => { const g = el.dataset.group; collapsedGroups.has(g) ? collapsedGroups.delete(g) : collapsedGroups.add(g); renderInventoryTable(); },
    'clear-inventory-selection': () => Actions.clearInventorySelection(),
    'save-selection-as-template': () => { const name = prompt('Name this template:'); if (name) Actions.saveSelectionAsTemplate(name); },
    'load-template': (el) => Actions.loadTemplateIntoSelection(el.dataset.templateId),
    'rename-template': (el) => { const name = prompt('Rename template:'); if (name) Actions.renameTemplate(el.dataset.templateId, name); },
    'delete-template': (el) => Actions.deleteTemplate(el.dataset.templateId),
    'start-individual-random-audit': async () => {
      const sampleSize = parseInt($('inv-sample-size').value) || 10;
      const { templates, activeTemplateId } = Store.getState();
      const active = templates.find(t => t.id === activeTemplateId);
      const sample = Actions.sampleRandomCodesForIndividualAudit(sampleSize);
      if (!sample) return;
      const assignment = await Actions.startIndividualAssignment({ source: 'template', codes: sample.codes, name: active ? active.name : 'Random Audit' });
      if (!assignment) return;
      await Actions.loadMyAssignments();
      await Actions.openMyAssignment(assignment.id);
      Bus.emit('nav:goto', 'team');
    },
    'start-team-random-audit': () => {
      const { templates, activeTemplateId } = Store.getState();
      const active = templates.find(t => t.id === activeTemplateId);
      const name = prompt('Name this Team Audit engagement:', active ? active.name : '');
      if (name) Actions.startTeamRandomAudit(name);
    },
    'generate-inventory-report': generateInventoryReport,
    'inventory-load-more': () => { renderLimit += PAGE_SIZE; renderInventoryTable(); },
    'add-manual-inventory-codes': () => {
      const input = $('inv-manual-code-input');
      if (!input) return;
      Actions.addManualCodes(input.value);
      input.value = '';
    },
    'toggle-existing-engagement-picker': () => {
      const wrap = $('inv-existing-engagement-picker');
      if (!wrap) return;
      const opening = wrap.style.display === 'none';
      wrap.style.display = opening ? 'block' : 'none';
      if (opening) {
        const { engagements } = Store.getState();
        const open = engagements.filter(e => e.status === 'open');
        const select = $('inv-existing-engagement-select');
        select.innerHTML = open.length === 0
          ? '<option value="">No open engagements</option>'
          : open.map(e => `<option value="${e.id}">${e.name}</option>`).join('');
      }
    },
    'confirm-add-to-existing-engagement': async () => {
      const select = $('inv-existing-engagement-select');
      const engagementId = select && select.value;
      if (!engagementId) { Bus.emit('toast', { msg: 'Choose an engagement first', kind: 'error' }); return; }
      const round = await Actions.startSubRoundFromInventorySelection(engagementId);
      if (round) {
        const wrap = $('inv-existing-engagement-picker');
        if (wrap) wrap.style.display = 'none';
        await openEngagementDetailView(engagementId);
        Bus.emit('nav:goto', 'team');
      }
    },
    // Template Builder — search-and-add popup (Candela "Product Code
    // Help"-style). Adds/removes go straight through the same
    // inventorySelectedCodes selection every other entry point (checkbox,
    // file, manual paste) uses, so it's fully interchangeable with them.
    'open-template-builder': () => {
      templateBuilderQuery = '';
      templateBuilderCompanyFilter = '';
      templateBuilderMode = 'search';
      const content = $('template-builder-content');
      if (content) content.innerHTML = Components.templateBuilderShellHTML(templateBuilderMode, templateBuilderQuery);
      renderTemplateBuilderBrowse();
      renderTemplateBuilderSelected();
      const overlay = $('template-builder-overlay');
      if (overlay) overlay.style.display = 'flex';
      setTimeout(() => { const input = $('template-builder-search-input'); if (input) input.focus(); }, 0);
    },
    'close-template-builder': () => {
      const overlay = $('template-builder-overlay');
      if (overlay) overlay.style.display = 'none';
    },
    'template-builder-set-mode': (el) => {
      if (templateBuilderMode === el.dataset.mode) return;
      templateBuilderMode = el.dataset.mode;
      const content = $('template-builder-content');
      if (content) content.innerHTML = Components.templateBuilderShellHTML(templateBuilderMode, templateBuilderQuery);
      renderTemplateBuilderBrowse();
      renderTemplateBuilderSelected();
      if (templateBuilderMode === 'search') { const input = $('template-builder-search-input'); if (input) input.focus(); }
    },
    'template-builder-add': (el) => {
      if (!el.dataset.code) return;
      Actions.selectManyForInventory([el.dataset.code], true);
      renderTemplateBuilderBrowse();
      renderTemplateBuilderSelected();
    },
    'template-builder-remove': (el) => {
      if (!el.dataset.code) return;
      Actions.selectManyForInventory([el.dataset.code], false);
      renderTemplateBuilderBrowse();
      renderTemplateBuilderSelected();
    },
    'template-builder-clear': () => {
      Actions.clearInventorySelection();
      renderTemplateBuilderBrowse();
      renderTemplateBuilderSelected();
    },
    'template-builder-save': async () => {
      const name = prompt('Name this template:');
      if (!name) return;
      const t = await Actions.saveSelectionAsTemplate(name);
      if (t) { const overlay = $('template-builder-overlay'); if (overlay) overlay.style.display = 'none'; }
    },
  };
  const inputHandlers = {
    // Debounced — with 5000+ rows, re-filtering and re-rendering on every
    // keystroke was the other big source of lag on the Inventory tab.
    'inventory-search': (el) => {
      const value = el.value;
      clearTimeout(searchDebounceTimer);
      searchDebounceTimer = setTimeout(() => Actions.setInventorySearch(value), 250);
    },
    'template-builder-search': (el) => {
      const value = el.value;
      clearTimeout(templateBuilderDebounce);
      // Only the results pane re-renders here — the input itself is
      // never touched, so it keeps focus and cursor position while the
      // person keeps typing.
      templateBuilderDebounce = setTimeout(() => { templateBuilderQuery = value; renderTemplateBuilderResults(); }, 200);
    },
    'template-builder-company-filter': (el) => {
      const value = el.value;
      clearTimeout(templateBuilderCompanyFilterDebounce);
      templateBuilderCompanyFilterDebounce = setTimeout(() => { templateBuilderCompanyFilter = value; renderTemplateBuilderCompanyList(); }, 200);
    },
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
    'toggle-template-builder-company': (el) => {
      const company = _templateBuilderCompanies().find(c => c.name === el.dataset.company);
      if (!company) return;
      Actions.selectManyForInventory(company.codes, el.checked);
      renderTemplateBuilderBrowse();
      renderTemplateBuilderSelected();
    },
  };
  return { clickHandlers, inputHandlers, changeHandlers, keydownHandlers: {} };
}
