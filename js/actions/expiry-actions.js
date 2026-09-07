import { Repo } from '../repository.js';
import { Store } from '../store.js';
import { Bus } from './bus.js';
import { logAudit } from './audit-log-actions.js';

/* ══════════════════════════════════════════════════════════════
   FLOOR 3 — ACTIONS / expiry-actions.js
   Expiry Tracking module: a shared, month-wise, staff-wise log of
   near-expiry stock, plus the monthly rack→staff assignment that
   drives which rack a Sub-Auditor sees in their entry form.

   Locking model: once saved, a Sub-Auditor's client has no UPDATE
   grant on expiry_entries at all (see supabase/schema.sql) — this
   file's job is just to shape requests, RLS is the actual lock.
   Only the Main Auditor can reopen/edit/re-lock an entry.
   ══════════════════════════════════════════════════════════════ */

function currentMonthKey(offsetMonths = 0) {
  const d = new Date();
  d.setDate(1);
  d.setMonth(d.getMonth() + offsetMonths);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}
const MONTH_NAMES = ['January','February','March','April','May','June','July','August','September','October','November','December'];
function monthLabel(monthKey) {
  if (!monthKey) return '';
  const [y, m] = monthKey.split('-');
  return `${MONTH_NAMES[Number(m) - 1] || m} ${y}`;
}
// Options for the "Expiry Month" dropdown: a little into the past (for
// logging something already found overdue) through 3 years ahead.
function buildExpiryMonthOptions() {
  const options = [];
  for (let i = -3; i <= 36; i++) {
    const key = currentMonthKey(i);
    options.push({ value: key, label: monthLabel(key) });
  }
  return options;
}

// ── Racks (master list) ──
async function loadRacks() {
  const { sbClient } = Store.getState();
  if (!sbClient) return [];
  const racks = await Repo.fetchRacks(sbClient);
  Store.setState({ racks });
  Bus.emit('racks:changed', racks);
  return racks;
}
async function addRack(name) {
  const { sbClient } = Store.getState();
  const clean = (name || '').trim();
  if (!clean) { Bus.emit('toast', { msg: 'Enter a rack name', kind: 'error' }); return null; }
  try {
    const rack = await Repo.insertRack(sbClient, clean);
    logAudit('rack:created', { rackId: rack.id, name: clean });
    Bus.emit('toast', { msg: `Rack "${clean}" added`, kind: 'success' });
    await loadRacks();
    return rack;
  } catch (err) {
    Bus.emit('toast', { msg: 'Could not add rack: ' + err.message, kind: 'error' });
    return null;
  }
}
async function removeRack(rackId, rackName) {
  const { sbClient } = Store.getState();
  if (!confirm(`Delete rack "${rackName}"? Past expiry entries logged against it keep the name; this only removes it from future dropdowns.`)) return false;
  try {
    await Repo.deleteRack(sbClient, rackId);
    logAudit('rack:deleted', { rackId, name: rackName });
    Bus.emit('toast', { msg: 'Rack deleted', kind: 'success' });
    await loadRacks();
    return true;
  } catch (err) {
    Bus.emit('toast', { msg: 'Could not delete rack: ' + err.message, kind: 'error' });
    return false;
  }
}

// ── Rack assignments (monthly) ──
async function loadRackAssignments(month) {
  const { sbClient } = Store.getState();
  if (!sbClient) return [];
  const rackAssignments = await Repo.fetchRackAssignmentsByMonth(sbClient, month);
  Store.setState({ rackAssignments, expiryAssignMonth: month });
  Bus.emit('rackAssignments:changed', rackAssignments);
  return rackAssignments;
}
async function assignRackToStaff(rackId, rackName, staffId, staffName, month) {
  const { sbClient, currentAuditorId } = Store.getState();
  try {
    await Repo.upsertRackAssignment(sbClient, { rackId, rackName, staffId, staffName, month, assignedBy: currentAuditorId });
    logAudit('rack:assigned', { rackId, rackName, staffId, staffName, month });
    Bus.emit('toast', { msg: `${rackName} assigned to ${staffName} for ${monthLabel(month)}`, kind: 'success' });
    await loadRackAssignments(month);
    return true;
  } catch (err) {
    Bus.emit('toast', { msg: 'Could not assign rack: ' + err.message, kind: 'error' });
    return false;
  }
}
async function unassignRack(assignmentId, month) {
  const { sbClient } = Store.getState();
  try {
    await Repo.deleteRackAssignment(sbClient, assignmentId);
    logAudit('rack:unassigned', { assignmentId });
    Bus.emit('toast', { msg: 'Rack unassigned', kind: 'success' });
    await loadRackAssignments(month);
    return true;
  } catch (err) {
    Bus.emit('toast', { msg: 'Could not unassign: ' + err.message, kind: 'error' });
    return false;
  }
}
// Which rack name(s) the CURRENTLY LOGGED IN staff member owns for a
// given month — used to filter the entry form's dropdown for a
// Sub-Auditor down to just their own assigned rack(s).
function myAssignedRackNames(month) {
  const { rackAssignments, currentAuditorId } = Store.getState();
  return (rackAssignments || [])
    .filter(a => a.month === month && a.staffId === currentAuditorId)
    .map(a => a.rackName);
}

// ── Expiry entries ──
function pickExpiryProduct(product) {
  Store.setState({ expiryPickedProduct: product, expiryProductSearchQuery: '' });
}
function clearExpiryProductPick() {
  Store.setState({ expiryPickedProduct: null });
}
function setExpiryProductSearchQuery(query) {
  Store.setState({ expiryProductSearchQuery: query });
}

async function logExpiryEntry({ quantity, expiryMonth, rackLocation, status }) {
  const { sbClient, currentAuditorId, currentAuditorName, expiryPickedProduct } = Store.getState();
  if (!expiryPickedProduct) { Bus.emit('toast', { msg: 'Pick a product first', kind: 'error' }); return null; }
  const qty = Number(quantity);
  if (!qty || qty <= 0) { Bus.emit('toast', { msg: 'Enter a valid quantity', kind: 'error' }); return null; }
  if (!expiryMonth) { Bus.emit('toast', { msg: 'Pick the expiry month', kind: 'error' }); return null; }
  const rack = (rackLocation || '').trim();
  if (!rack) { Bus.emit('toast', { msg: 'Enter or pick a rack location', kind: 'error' }); return null; }
  try {
    const entry = await Repo.insertExpiryEntry(sbClient, {
      staffId: currentAuditorId, staffName: currentAuditorName,
      productCode: expiryPickedProduct.code || '', productName: expiryPickedProduct.name,
      quantity: qty, expiryMonth, rackLocation: rack, status: status || 'Near Expiry',
    });
    logAudit('expiry:logged', { entryId: entry.id, product: expiryPickedProduct.name, qty, expiryMonth, rack });
    Bus.emit('toast', { msg: 'Expiry entry saved', kind: 'success' });
    Store.setState({ expiryPickedProduct: null });
    Bus.emit('expiry:entryLogged', entry);
    return entry;
  } catch (err) {
    Bus.emit('toast', { msg: 'Could not save entry: ' + err.message, kind: 'error' });
    return null;
  }
}

async function searchExpiryEntries({ query, month, status } = {}) {
  const { sbClient } = Store.getState();
  if (!sbClient) return [];
  const q = query !== undefined ? query : Store.getState().expirySearchQuery;
  const m = month !== undefined ? month : Store.getState().expiryFilterMonth;
  const s = status !== undefined ? status : Store.getState().expiryFilterStatus;
  Store.setState({ expirySearchQuery: q, expiryFilterMonth: m, expiryFilterStatus: s === 'all' ? '' : s });
  try {
    const entries = await Repo.fetchExpiryEntries(sbClient, { query: q, month: m, status: s === 'all' ? '' : s });
    Store.setState({ expiryEntries: entries });
    Bus.emit('expiryEntries:changed', entries);
    return entries;
  } catch (err) {
    Bus.emit('toast', { msg: 'Search failed: ' + err.message, kind: 'error' });
    return [];
  }
}

// Main-Auditor-only from here down (RLS enforces it regardless of the
// UI — see supabase/schema.sql "expiry main update").
async function reopenExpiryEntry(entryId) {
  const { sbClient, currentAuditorId, currentAuditorName } = Store.getState();
  if (!confirm('Reopen this entry for editing? It will stay editable until you save your changes, which re-locks it.')) return false;
  try {
    await Repo.reopenExpiryEntry(sbClient, entryId, currentAuditorId, currentAuditorName);
    logAudit('expiry:reopened', { entryId });
    Bus.emit('toast', { msg: 'Entry reopened for editing', kind: 'success' });
    await searchExpiryEntries({});
    return true;
  } catch (err) {
    Bus.emit('toast', { msg: 'Could not reopen: ' + err.message, kind: 'error' });
    return false;
  }
}
async function saveReopenedExpiryEntry(entryId, patch) {
  const { sbClient } = Store.getState();
  try {
    await Repo.saveReopenedExpiryEntry(sbClient, entryId, patch);
    logAudit('expiry:edited', { entryId, patch });
    Bus.emit('toast', { msg: 'Entry updated and re-locked', kind: 'success' });
    await searchExpiryEntries({});
    return true;
  } catch (err) {
    Bus.emit('toast', { msg: 'Could not save: ' + err.message, kind: 'error' });
    return false;
  }
}
async function deleteExpiryEntry(entryId) {
  const { sbClient } = Store.getState();
  if (!confirm('Permanently delete this expiry entry? This cannot be undone.')) return false;
  try {
    await Repo.deleteExpiryEntry(sbClient, entryId);
    logAudit('expiry:deleted', { entryId });
    Bus.emit('toast', { msg: 'Entry deleted', kind: 'success' });
    await searchExpiryEntries({});
    return true;
  } catch (err) {
    Bus.emit('toast', { msg: 'Could not delete: ' + err.message, kind: 'error' });
    return false;
  }
}

export const ExpiryActions = {
  currentMonthKey, monthLabel, buildExpiryMonthOptions,
  loadRacks, addRack, removeRack,
  loadRackAssignments, assignRackToStaff, unassignRack, myAssignedRackNames,
  pickExpiryProduct, clearExpiryProductPick, setExpiryProductSearchQuery,
  logExpiryEntry, searchExpiryEntries,
  reopenExpiryEntry, saveReopenedExpiryEntry, deleteExpiryEntry,
};
