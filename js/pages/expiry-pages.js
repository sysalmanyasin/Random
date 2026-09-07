import { Store } from '../store.js';
import { Actions, Bus } from '../actions.js';
import { Components } from '../components.js';

/* ══════════════════════════════════════════════════════════════
   FLOOR 5 — PAGES / expiry-pages.js
   The Expiry tab: Log Entry (product search-and-pick + qty/month/
   rack/status), Search (universal, month-wise grouped results),
   and Racks (Main Auditor only — master list + monthly assignment).
   Same "one page, internal sub-view switcher" shape as the
   Inventory page's Products/Templates tabs.
   ══════════════════════════════════════════════════════════════ */

const $ = (id) => document.getElementById(id);
const RESULT_CAP = 200;

let expirySubView = 'log'; // 'log' | 'search' | 'racks'
let editingEntryId = null; // which search result is currently reopened-for-editing (Main Auditor only)
let productSearchDebounce = null;
let entrySearchDebounce = null;

function _productMatches(query) {
  const { products } = Store.getState();
  const q = (query || '').toLowerCase().trim();
  if (!q) return [];
  return (products || []).filter(p =>
    (p.name || '').toLowerCase().includes(q) ||
    (p.code || '').toLowerCase().includes(q) ||
    (p.generic || '').toLowerCase().includes(q));
}

// A Sub-Auditor's rack dropdown is filtered to whatever rack(s) are
// assigned to them this month; if none are assigned yet (or they're
// the Main Auditor), every active rack is offered instead.
function _rackChoicesForCurrentUser() {
  const { role, racks } = Store.getState();
  const month = Actions.currentMonthKey();
  const mine = role === 'sub' ? Actions.myAssignedRackNames(month) : [];
  if (mine.length > 0) return mine;
  return (racks || []).filter(r => r.active).map(r => r.name);
}

function renderExpiryLog() {
  const el = $('expiry-tab-root');
  if (!el) return;
  const { expiryPickedProduct, expiryProductSearchQuery } = Store.getState();
  el.innerHTML = Components.expiryLogFormHTML({
    pickedProduct: expiryPickedProduct,
    productQuery: expiryProductSearchQuery,
    monthOptions: Actions.buildExpiryMonthOptions(),
    rackChoices: _rackChoicesForCurrentUser(),
    rackFreeText: null,
    defaultStatus: 'Near Expiry',
  });
  if (expiryProductSearchQuery) renderProductResults();
}

function renderProductResults() {
  const el = $('expiry-product-results');
  if (!el) return;
  const { expiryProductSearchQuery } = Store.getState();
  el.innerHTML = Components.expiryProductResultsHTML(_productMatches(expiryProductSearchQuery).slice(0, RESULT_CAP));
}

async function renderExpirySearch() {
  const el = $('expiry-tab-root');
  if (!el) return;
  const { expirySearchQuery, expiryFilterMonth, expiryFilterStatus } = Store.getState();
  el.innerHTML = `
    <div id="expiry-search-bar"></div>
    <div id="expiry-search-results"></div>`;
  $('expiry-search-bar').innerHTML = Components.expirySearchBarHTML({
    query: expirySearchQuery, filterMonth: expiryFilterMonth, filterStatus: expiryFilterStatus,
    monthOptions: Actions.buildExpiryMonthOptions(),
  });
  await Actions.searchExpiryEntries({});
  renderExpiryResultsList();
}

function renderExpiryResultsList() {
  const el = $('expiry-search-results');
  if (!el) return;
  const { role, expiryEntries } = Store.getState();
  el.innerHTML = Components.expiryEntriesListHTML(expiryEntries, {
    isMain: role === 'main',
    editingId: editingEntryId,
    monthOptions: Actions.buildExpiryMonthOptions(),
    monthLabelOf: Actions.monthLabel,
  });
}

function renderExpiryRacks() {
  const el = $('expiry-tab-root');
  if (!el) return;
  const { role, racks, rackAssignments, staff, expiryAssignMonth } = Store.getState();
  if (role !== 'main') { el.innerHTML = '<div class="card">Only the Main Auditor manages racks.</div>'; return; }
  const month = expiryAssignMonth || Actions.currentMonthKey();
  el.innerHTML = Components.racksAdminHTML({
    racks, rackAssignments, staffList: staff, month,
    monthOptions: Actions.buildExpiryMonthOptions(),
  });
}

export function renderExpiryTab() {
  const { role } = Store.getState();
  const racksBtn = $('expiry-racks-subview-btn');
  if (racksBtn) racksBtn.style.display = role === 'main' ? '' : 'none';
  if (expirySubView === 'racks' && role !== 'main') expirySubView = 'log';
  document.querySelectorAll('.expiry-subview-btn').forEach(b => b.classList.toggle('filter-btn-active', b.dataset.subview === expirySubView));

  if (expirySubView === 'log') renderExpiryLog();
  else if (expirySubView === 'search') renderExpirySearch();
  else renderExpiryRacks();
}
Bus.on('view:activated', (page) => { if (page === 'expiry') renderExpiryTab(); });
Bus.on('expiryEntries:changed', () => { if (expirySubView === 'search') renderExpiryResultsList(); });
Bus.on('racks:changed', () => { if (expirySubView === 'racks') renderExpiryRacks(); });
Bus.on('rackAssignments:changed', () => { if (expirySubView === 'racks') renderExpiryRacks(); });

export function initExpiryPages() {
  const clickHandlers = {
    'expiry-set-subview': (el) => { expirySubView = el.dataset.subview; editingEntryId = null; renderExpiryTab(); },
    'expiry-pick-product': (el) => { Actions.pickExpiryProduct({ code: el.dataset.code, name: el.dataset.name }); renderExpiryLog(); },
    'expiry-clear-product': () => { Actions.clearExpiryProductPick(); renderExpiryLog(); },
    'expiry-save-entry': async () => {
      const rackSelect = $('expiry-rack-select');
      const rackValue = rackSelect.value === '__other__' ? ($('expiry-rack-freetext').value || '') : rackSelect.value;
      const entry = await Actions.logExpiryEntry({
        quantity: $('expiry-qty-input').value,
        expiryMonth: $('expiry-month-select').value,
        rackLocation: rackValue,
        status: $('expiry-status-select').value,
      });
      if (entry) renderExpiryLog(); // clears the picked product + resets the form
    },
    'expiry-reopen': async (el) => {
      const ok = await Actions.reopenExpiryEntry(el.dataset.entryId);
      if (ok) { editingEntryId = el.dataset.entryId; renderExpiryResultsList(); }
    },
    'expiry-save-reopened': async (el) => {
      const id = el.dataset.entryId;
      const ok = await Actions.saveReopenedExpiryEntry(id, {
        quantity: Number($(`expiry-edit-qty-${id}`).value),
        expiryMonth: $(`expiry-edit-month-${id}`).value,
        rackLocation: $(`expiry-edit-rack-${id}`).value,
        status: $(`expiry-edit-status-${id}`).value,
      });
      if (ok) editingEntryId = null;
    },
    'expiry-delete-entry': async (el) => {
      const ok = await Actions.deleteExpiryEntry(el.dataset.entryId);
      if (ok && editingEntryId === el.dataset.entryId) editingEntryId = null;
    },
    'expiry-add-rack': async () => {
      const input = $('new-rack-name-input');
      const rack = await Actions.addRack(input.value);
      if (rack) input.value = '';
    },
    'expiry-delete-rack': (el) => Actions.removeRack(el.dataset.rackId, el.dataset.rackName),
    'expiry-assign-rack': (el) => {
      const { expiryAssignMonth } = Store.getState();
      const select = document.querySelector(`.expiry-rack-assign-select[data-rack-id="${el.dataset.rackId}"]`);
      if (!select || !select.value) { Bus.emit('toast', { msg: 'Choose a staff member first', kind: 'error' }); return; }
      const staffName = select.selectedOptions[0].dataset.name;
      Actions.assignRackToStaff(el.dataset.rackId, el.dataset.rackName, select.value, staffName, expiryAssignMonth || Actions.currentMonthKey());
    },
  };

  const changeHandlers = {
    'expiry-rack-select-change': (el) => {
      const freeText = $('expiry-rack-freetext');
      freeText.style.display = el.value === '__other__' ? '' : 'none';
      if (el.value === '__other__') freeText.focus();
    },
    'expiry-filter-month': (el) => Actions.searchExpiryEntries({ month: el.value }),
    'expiry-filter-status': (el) => Actions.searchExpiryEntries({ status: el.value }),
    'expiry-assign-month-change': (el) => Actions.loadRackAssignments(el.value),
  };

  const inputHandlers = {
    'expiry-product-search': (el) => {
      const value = el.value;
      clearTimeout(productSearchDebounce);
      productSearchDebounce = setTimeout(() => { Actions.setExpiryProductSearchQuery(value); renderProductResults(); }, 200);
    },
    'expiry-search': (el) => {
      const value = el.value;
      clearTimeout(entrySearchDebounce);
      entrySearchDebounce = setTimeout(() => Actions.searchExpiryEntries({ query: value }), 250);
    },
  };

  return { clickHandlers, inputHandlers, changeHandlers, keydownHandlers: {} };
}
