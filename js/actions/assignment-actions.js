import { Repo } from '../repository.js';
import { Store } from '../store.js';
import { Bus } from './bus.js';
import { logAudit } from './audit-log-actions.js';

/* ══════════════════════════════════════════════════════════════
   FLOOR 3 — ACTIONS / assignment-actions.js
   Blueprint §Assignment Engine.
   Methods: Auto-Split by Company Count · Auto-Split by Item Volume
   · Manual Rebalance (before lock).
   An assignment now points straight at a real staff login
   (auditorId = their Supabase user id) — there's no separate
   pairing-link step. The moment they log in, RLS lets them see
   only rows where auditor_id = their own id.
   ══════════════════════════════════════════════════════════════ */

async function loadAssignmentsForRound(roundId) {
  const { sbClient } = Store.getState();
  const assignments = await Repo.fetchAssignmentsByRound(sbClient, roundId);
  Store.setState({ assignments });
  Bus.emit('assignments:changed', assignments);
  return assignments;
}

async function _persistNewAssignments(list) {
  const { sbClient } = Store.getState();
  const created = await Repo.insertAssignments(sbClient, list);
  const merged = Store.getState().assignments.concat(created);
  Store.setState({ assignments: merged });
  Bus.emit('assignments:changed', merged);
  return created;
}

function _guardDraftRound(round) {
  if (!round) { Bus.emit('toast', { msg: 'Round not found', kind: 'error' }); return false; }
  if (round.state !== 'draft') { Bus.emit('toast', { msg: 'Round is locked — cannot re-split assignments', kind: 'error' }); return false; }
  return true;
}

function _guardCompanyUnitRound(round) {
  if (!_guardDraftRound(round)) return false;
  if (round.unit !== 'company') { Bus.emit('toast', { msg: 'This round is item-level (from the Difference Engine) — use manual rebalance instead', kind: 'error' }); return false; }
  return true;
}

function _companyItemCounts(round, companies) {
  const map = {};
  companies.forEach(c => { map[c] = round.itemSnapshot.filter(it => it.company === c).length; });
  return map;
}

function _guardNoExistingAssignments(round) {
  const { assignments } = Store.getState();
  const existing = assignments.filter(a => a.roundId === round.id && a.status !== 'revoked');
  if (existing.length > 0) {
    Bus.emit('toast', { msg: 'This round already has assignments — revoke them first (or use "Move to…") before re-splitting, otherwise companies get assigned twice', kind: 'error' });
    return false;
  }
  return true;
}

// ── Auto-Split by Company Count (Round 1, unit = company) ──
// Companies are sorted A-Z then divided into contiguous alphabetical blocks.
// First staff gets one extra company if the count doesn't divide evenly.
// A full company always goes to exactly one person — never split across staff.
function _companyCountBuckets(companies, staffList) {
  const n = companies.length;
  const s = staffList.length;
  const buckets = [];
  let start = 0;
  for (let i = 0; i < s; i++) {
    const size = Math.floor(n / s) + (i < n % s ? 1 : 0);
    buckets.push(companies.slice(start, start + size));
    start += size;
  }
  return buckets;
}

// ── Auto-Split by Item Volume (Round 1, unit = company) ──
// Companies are sorted A-Z then assigned in contiguous blocks, with the split
// point chosen so each staff member gets a proportional share of total SKU items.
// The last staff member gets whatever remains (may be slightly less).
// A full company always goes to exactly one person — never split across staff.
function _itemVolumeBuckets(round, companies, staffList) {
  const counts = _companyItemCounts(round, companies);
  const totalItems = companies.reduce((sum, c) => sum + (counts[c] || 0), 0);
  const targetPerStaff = totalItems / staffList.length;

  const buckets = staffList.map(() => []);
  let staffIdx = 0;
  let accumulated = 0;

  companies.forEach(company => {
    buckets[staffIdx].push(company);
    accumulated += counts[company] || 0;
    // Close this bucket at a company boundary once we've hit the proportional target,
    // but never advance past the last staff member
    if (staffIdx < staffList.length - 1 && accumulated >= targetPerStaff * (staffIdx + 1)) {
      staffIdx++;
    }
  });
  return buckets;
}

// Shared preview builder — nothing here touches the Repo or Store. It just
// answers "if we split this way, who ends up with what" so the Main Auditor
// can look before committing, instead of the old behavior of splitting
// immediately and only finding out the shape of it after the fact.
function _buildSplitPreview(round, staffList, buckets, method) {
  return {
    method,
    unit: 'company',
    roundId: round.id,
    totalCompanies: buckets.reduce((sum, b) => sum + b.length, 0),
    rows: staffList.map((staffMember, i) => {
      const companies = buckets[i] || [];
      const itemCount = round.itemSnapshot.filter(it => companies.includes(it.company)).length;
      return { staffId: staffMember.id, staffName: staffMember.name, companies, itemCount };
    }),
  };
}

function previewSplitByCompanyCount(round, staffList) {
  if (!_guardCompanyUnitRound(round)) return null;
  if (!_guardNoExistingAssignments(round)) return null;
  if (staffList.length === 0) { Bus.emit('toast', { msg: 'Add at least one staff member', kind: 'error' }); return null; }
  const { engagements } = Store.getState();
  const engagement = engagements.find(e => e.id === round.engagementId);
  const companies = engagement.scope.companies.slice().sort((a, b) => a.localeCompare(b));
  const buckets = _companyCountBuckets(companies, staffList);
  return _buildSplitPreview(round, staffList, buckets, 'auto-count');
}

function previewSplitByItemVolume(round, staffList) {
  if (!_guardCompanyUnitRound(round)) return null;
  if (!_guardNoExistingAssignments(round)) return null;
  if (staffList.length === 0) { Bus.emit('toast', { msg: 'Add at least one staff member', kind: 'error' }); return null; }
  const { engagements } = Store.getState();
  const engagement = engagements.find(e => e.id === round.engagementId);
  const companies = engagement.scope.companies.slice().sort((a, b) => a.localeCompare(b));
  const buckets = _itemVolumeBuckets(round, companies, staffList);
  return _buildSplitPreview(round, staffList, buckets, 'auto-volume');
}

// Persists exactly what was previewed — no recomputation, so what the
// Main Auditor confirmed on screen is guaranteed to be what gets saved.
async function commitSplitPreview(round, staffList, preview) {
  if (!preview || preview.roundId !== round.id) return [];
  if (!_guardCompanyUnitRound(round)) return [];
  if (!_guardNoExistingAssignments(round)) return [];
  const drafts = staffList.map((staffMember, i) => _buildCompanyAssignment(round, staffMember, preview.rows[i].companies, preview.method));
  const created = await _persistNewAssignments(drafts);
  logAudit(preview.method === 'auto-volume' ? 'assignment:autoSplitItemVolume' : 'assignment:autoSplitCompanyCount', { roundId: round.id, staffCount: staffList.length });
  const byLabel = preview.method === 'auto-volume' ? 'by item volume' : 'by count';
  Bus.emit('toast', { msg: 'Split ' + preview.totalCompanies + ' companies across ' + staffList.length + ' staff member(s) ' + byLabel, kind: 'success' });
  return created;
}

function _buildCompanyAssignment(round, staffMember, companies, method) {
  const items = round.itemSnapshot.filter(it => companies.includes(it.company));
  return {
    roundId: round.id, engagementId: round.engagementId, unit: 'company',
    auditorId: staffMember.id, auditorName: staffMember.name,
    companies, items, method, status: staffMember.isSelfPairing ? 'counting' : 'assigned',
  };
}

// ── Assign Main Auditor to Self ──
// Since it's the same login/device, this goes straight to 'counting' —
// no separate step needed, it's already backed by a real (their own)
// staff row via Supabase.
async function assignMainAuditorToSelf(round, companiesOrItems, selfStaffMember) {
  if (!_guardDraftRound(round)) return null;
  const draft = round.unit === 'company'
    ? _buildCompanyAssignment(round, selfStaffMember, companiesOrItems, 'self')
    : _buildItemAssignment(round, selfStaffMember, companiesOrItems, 'self');
  draft.status = 'counting';
  const [created] = await _persistNewAssignments([draft]);
  logAudit('assignment:selfPaired', { roundId: round.id, assignmentId: created.id });
  Bus.emit('toast', { msg: 'You are now assigned as a Sub-Auditor on this round', kind: 'success' });
  return created;
}

// ── Item-level assignment (Round 2+, unit = item) — used by the
//    Difference Engine when it generates the next round's work. ──
function _buildItemAssignment(round, staffMember, items, method) {
  return {
    roundId: round.id, engagementId: round.engagementId, unit: 'item',
    auditorId: staffMember.id, auditorName: staffMember.name,
    companies: [...new Set(items.map(it => it.company))], items, method,
    status: staffMember.isSelfPairing ? 'counting' : 'assigned',
  };
}

// ── Item-level split (Round 2+, unit = item) — same preview-before-commit
// pattern as the company-level split above, so the Main Auditor always
// picks staff and reviews the split before anything is assigned, instead
// of it happening automatically the moment the round is generated. ──
function _itemBuckets(items, staffList, byVolume) {
  const buckets = staffList.map(() => []);
  if (byVolume) {
    // Greedy-balance by each item's financial exposure (qty × price)
    // rather than a flat round-robin.
    const sorted = items.slice().sort((a, b) => (b.qty * b.price) - (a.qty * a.price));
    const totals = staffList.map(() => 0);
    sorted.forEach(item => {
      const target = totals.reduce((min, t, i) => (t < totals[min] ? i : min), 0);
      buckets[target].push(item);
      totals[target] += item.qty * item.price;
    });
  } else {
    items.forEach((item, i) => buckets[i % staffList.length].push(item));
  }
  return buckets;
}

function previewSplitItems(round, items, staffList, byVolume) {
  if (!_guardDraftRound(round)) return null;
  if (round.unit !== 'item') { Bus.emit('toast', { msg: 'This round is company-level — use Auto-Split by Count/Volume instead', kind: 'error' }); return null; }
  if (!_guardNoExistingAssignments(round)) return null;
  if (staffList.length === 0) { Bus.emit('toast', { msg: 'Add at least one staff member', kind: 'error' }); return null; }
  const buckets = _itemBuckets(items, staffList, byVolume);
  return {
    method: byVolume ? 'auto-volume' : 'auto-count',
    unit: 'item',
    roundId: round.id,
    totalCompanies: items.length, // reused by splitPreviewHTML as the "total lines" figure
    rows: staffList.map((staffMember, i) => {
      const bucket = buckets[i] || [];
      return { staffId: staffMember.id, staffName: staffMember.name, companies: [...new Set(bucket.map(it => it.company))], itemCount: bucket.length, items: bucket };
    }),
  };
}

// Persists exactly what was previewed — same guarantee as commitSplitPreview.
async function commitItemSplitPreview(round, staffList, preview) {
  if (!preview || preview.roundId !== round.id) return [];
  if (!_guardDraftRound(round)) return [];
  if (round.unit !== 'item') return [];
  if (!_guardNoExistingAssignments(round)) return [];
  const drafts = staffList.map((staffMember, i) => _buildItemAssignment(round, staffMember, preview.rows[i].items, preview.method));
  const created = await _persistNewAssignments(drafts);
  logAudit(preview.method === 'auto-volume' ? 'assignment:itemSplitByVolume' : 'assignment:itemSplitByCount', { roundId: round.id, itemCount: preview.totalCompanies, staffCount: staffList.length });
  const byLabel = preview.method === 'auto-volume' ? 'by value' : 'by count';
  Bus.emit('toast', { msg: 'Split ' + preview.totalCompanies + ' item(s) across ' + staffList.length + ' staff member(s) ' + byLabel, kind: 'success' });
  return created;
}

// If the person we're moving a company/item AWAY from had already
// counted (submitted) it, that old count still lives in their
// submission row keyed by itemKey. Left alone, compile would still
// pick it up — even though the item now belongs to someone else — and
// whichever of the two submissions gets processed last would silently
// win, with no warning (the item is no longer "double-assigned" by
// then, so the overlap detector in compile-actions.js can't catch it).
// Purge those specific keys from the old submission right away instead.
async function _purgeMovedItemsFromStaleSubmission(sbClient, fromAssignment, movedItemKeys) {
  if (movedItemKeys.length === 0) return;
  try {
    const subs = await Repo.fetchSubmissionsByRound(sbClient, fromAssignment.roundId);
    const sub = subs.find(s => s.assignmentId === fromAssignment.id);
    if (!sub) return;
    const staleKeys = movedItemKeys.filter(k => Object.prototype.hasOwnProperty.call(sub.counts || {}, k));
    if (staleKeys.length === 0) return;
    const counts = Object.assign({}, sub.counts);
    const notes = Object.assign({}, sub.notes);
    staleKeys.forEach(k => { delete counts[k]; delete notes[k]; });
    await Repo.upsertSubmission(sbClient, {
      assignmentId: sub.assignmentId, roundId: sub.roundId, engagementId: sub.engagementId,
      auditorId: sub.auditorId, auditorName: sub.auditorName, counts, notes,
    });
    logAudit('submission:staleCountsPurgedAfterMove', { assignmentId: fromAssignment.id, itemKeys: staleKeys });
    Bus.emit('toast', { msg: staleKeys.length + ' already-counted item(s) moved — their old count was cleared so it can\'t conflict at compile', kind: 'error' });
  } catch (err) {
    console.error('[ManualMove] Could not purge stale submission data (non-fatal):', err);
  }
}

// ── Manual Rebalance (before lock) ──
async function manualMoveCompany(fromAssignmentId, toAssignmentId, companyName) {
  const { assignments, rounds, sbClient } = Store.getState();
  const from = assignments.find(a => a.id === fromAssignmentId);
  const to = assignments.find(a => a.id === toAssignmentId);
  if (!from || !to || from.unit !== 'company' || to.unit !== 'company') return;
  if (!from.companies.includes(companyName)) return;
  if (to.companies.includes(companyName)) { Bus.emit('toast', { msg: companyName + ' is already assigned there', kind: 'error' }); return; }
  const round = rounds.find(r => r.id === to.roundId);
  if (!round) return;

  // Compute the move into plain local values first — the shared `from`/`to`
  // objects in Store are NOT touched yet. This avoids a race where another
  // part of the app could read Store.getState().assignments mid-flight and
  // see the move already applied, even though it hasn't been persisted (or
  // has failed) yet. Nothing shared is mutated until both writes succeed.
  const movedItemKeys = from.items.filter(it => it.company === companyName).map(it => it.itemKey);
  const newFromCompanies = from.companies.filter(c => c !== companyName);
  const newFromItems = from.items.filter(it => it.company !== companyName);
  const newToCompanies = to.companies.concat([companyName]);
  const newToItems = to.items.concat(round.itemSnapshot.filter(it => it.company === companyName));

  try {
    await Repo.updateAssignment(sbClient, from.id, { companies: newFromCompanies, items: newFromItems, method: 'manual' });
    await Repo.updateAssignment(sbClient, to.id, { companies: newToCompanies, items: newToItems, method: 'manual' });

    // Both writes succeeded — commit fresh objects to Store in one shot.
    const updatedFrom = Object.assign({}, from, { companies: newFromCompanies, items: newFromItems, method: 'manual' });
    const updatedTo = Object.assign({}, to, { companies: newToCompanies, items: newToItems, method: 'manual' });
    const newAssignments = assignments.map(a => a.id === updatedFrom.id ? updatedFrom : a.id === updatedTo.id ? updatedTo : a);
    Store.setState({ assignments: newAssignments });

    await _purgeMovedItemsFromStaleSubmission(sbClient, updatedFrom, movedItemKeys);
    logAudit('assignment:manualRebalanceCompany', { fromAssignmentId, toAssignmentId, companyName });
    Bus.emit('assignments:changed', Store.getState().assignments);
    Bus.emit('toast', { msg: 'Moved ' + companyName, kind: 'success' });
  } catch (err) {
    // Nothing shared was ever mutated, so there's nothing to roll back —
    // Store is exactly as it was before this call.
    Bus.emit('toast', { msg: 'Could not move company — nothing changed, please retry: ' + err.message, kind: 'error' });
  }
}

async function manualMoveItem(fromAssignmentId, toAssignmentId, itemKey) {
  const { assignments, sbClient } = Store.getState();
  const from = assignments.find(a => a.id === fromAssignmentId);
  const to = assignments.find(a => a.id === toAssignmentId);
  if (!from || !to || from.unit !== 'item' || to.unit !== 'item') return;
  const item = from.items.find(it => it.itemKey === itemKey);
  if (!item) return;
  if (to.items.some(it => it.itemKey === itemKey)) { Bus.emit('toast', { msg: 'That item is already assigned there', kind: 'error' }); return; }

  // Compute locally first — `from`/`to` in Store stay untouched until both
  // writes succeed, so nothing else can ever observe a half-applied move.
  const newFromItems = from.items.filter(it => it.itemKey !== itemKey);
  const newToItems = to.items.concat([item]);
  const newFromCompanies = [...new Set(newFromItems.map(it => it.company))];
  const newToCompanies = [...new Set(newToItems.map(it => it.company))];

  try {
    await Repo.updateAssignment(sbClient, from.id, { companies: newFromCompanies, items: newFromItems, method: 'manual' });
    await Repo.updateAssignment(sbClient, to.id, { companies: newToCompanies, items: newToItems, method: 'manual' });

    const updatedFrom = Object.assign({}, from, { companies: newFromCompanies, items: newFromItems, method: 'manual' });
    const updatedTo = Object.assign({}, to, { companies: newToCompanies, items: newToItems, method: 'manual' });
    const newAssignments = assignments.map(a => a.id === updatedFrom.id ? updatedFrom : a.id === updatedTo.id ? updatedTo : a);
    Store.setState({ assignments: newAssignments });

    await _purgeMovedItemsFromStaleSubmission(sbClient, updatedFrom, [itemKey]);
    logAudit('assignment:manualRebalanceItem', { fromAssignmentId, toAssignmentId, itemKey });
    Bus.emit('assignments:changed', Store.getState().assignments);
    Bus.emit('toast', { msg: 'Moved item', kind: 'success' });
  } catch (err) {
    // Nothing shared was mutated, so there's nothing to roll back.
    Bus.emit('toast', { msg: 'Could not move item — nothing changed, please retry: ' + err.message, kind: 'error' });
  }
}

async function revokeAssignment(assignmentId) {
  if (!confirm('Revoke this assignment? The staff member will lose access to it immediately (enforced by the database, not just the app).')) return;
  const { assignments, sbClient } = Store.getState();
  const assignment = assignments.find(a => a.id === assignmentId);
  if (!assignment) return;
  try {
    await Repo.updateAssignment(sbClient, assignmentId, { status: 'revoked' });
    assignment.status = 'revoked';
    Store.setState({ assignments: assignments.slice() });
    logAudit('assignment:revoked', { assignmentId });
    Bus.emit('assignments:changed', Store.getState().assignments);
    Bus.emit('toast', { msg: 'Assignment revoked', kind: 'success' });
  } catch (err) {
    Bus.emit('toast', { msg: 'Could not revoke: ' + err.message, kind: 'error' });
  }
}

// Submitted assignments are frozen for the Sub-Auditor (DB-enforced —
// see restrict_subauditor_assignment_updates in schema.sql). Only the
// Main Auditor can lift that, by moving status back to "counting" —
// deliberate and visible, unlike silently allowing endless resubmits.
async function reopenAssignment(assignmentId) {
  if (!confirm('Reopen this assignment for editing? The staff member will be able to change their counts again — if you already compiled this round, you\'ll need to re-compile after they resubmit.')) return;
  const { assignments, sbClient } = Store.getState();
  const assignment = assignments.find(a => a.id === assignmentId);
  if (!assignment) return;
  try {
    await Repo.updateAssignment(sbClient, assignmentId, { status: 'counting' });
    assignment.status = 'counting';
    Store.setState({ assignments: assignments.slice() });
    logAudit('assignment:reopened', { assignmentId });
    Bus.emit('assignments:changed', Store.getState().assignments);
    Bus.emit('toast', { msg: 'Assignment reopened for editing', kind: 'success' });
  } catch (err) {
    Bus.emit('toast', { msg: 'Could not reopen: ' + err.message, kind: 'error' });
  }
}

export const AssignmentActions = {
  loadAssignmentsForRound, previewSplitByCompanyCount, previewSplitByItemVolume, commitSplitPreview,
  assignMainAuditorToSelf, previewSplitItems, commitItemSplitPreview,
  manualMoveCompany, manualMoveItem, revokeAssignment, reopenAssignment,
};
