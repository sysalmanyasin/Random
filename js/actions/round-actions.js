import { Repo } from '../repository.js';
import { Store } from '../store.js';
import { Bus } from './bus.js';
import { logAudit } from './audit-log-actions.js';
import { ItemKey } from './item-key.js';

// Both createSubRound and createItemSubRound compute their round's
// letter suffix (1A, 1B...) from whatever's currently in Store/DB — a
// second click before the first request lands back would compute the
// same "next" letter twice and create two rounds both claiming 1C. A
// simple in-flight lock is enough to prevent that without needing to
// wire up button-disabling in every place these get called from.
let _subRoundCreationInFlight = false;

/* ══════════════════════════════════════════════════════════════
   FLOOR 3 — ACTIONS / round-actions.js
   Blueprint §Round Management, persisted through Supabase.
   States: Draft → Locked → Counting → Compiled → Final
   Round 1 assignment unit = Company. Round 2+ unit = Company+ItemID.

   §Inventory Cutoff: every round takes its own frozen snapshot of the
   engagement's item scope the moment it's created (round.itemSnapshot).
   All assignment-building, compiling, and final-report generation for
   that round reads from this frozen list, never live inventory — so
   re-syncing Dropbox/CSV mid-round can't corrupt an in-progress count.
   The NEXT round takes its own fresh cutoff at ITS creation time, so
   legitimate inventory updates between rounds are still picked up.
   ══════════════════════════════════════════════════════════════ */

async function loadRoundsForCurrentEngagement() {
  const { currentEngagementId, sbClient } = Store.getState();
  if (!currentEngagementId) return [];
  const rounds = await Repo.fetchRoundsByEngagement(sbClient, currentEngagementId);
  rounds.sort((a, b) => a.roundNumber - b.roundNumber);
  Store.setState({ rounds });
  Bus.emit('rounds:changed', rounds);
  return rounds;
}

// A "round family" is every round sharing the same roundNumber — the
// plain round plus any lettered siblings (1, 1A, 1B, 1C...). Round N+1
// can't start until every member of round N's family has been compiled
// (or finalized) — otherwise work still in flight for round N would be
// silently orphaned once the Difference Engine moves on.
function _familyRounds(rounds, roundNumber) {
  return rounds.filter(r => r.roundNumber === roundNumber);
}
function _isFamilyFullyCompiled(rounds, roundNumber) {
  const family = _familyRounds(rounds, roundNumber);
  return family.length > 0 && family.every(r => r.state === 'compiled' || r.state === 'final');
}
function _familyLabel(rounds, roundNumber) {
  const family = _familyRounds(rounds, roundNumber);
  const labels = family.map(r => roundNumber + (r.roundSuffix || '')).sort();
  return labels.join(', ');
}

async function createRound() {
  const { currentEngagementId, rounds, engagements, products, sbClient } = Store.getState();
  const engagement = engagements.find(e => e.id === currentEngagementId);
  if (!engagement) { Bus.emit('toast', { msg: 'Open an engagement first', kind: 'error' }); return null; }
  if (rounds.length > 0) {
    // This path is Round 1 only. Round 2+ goes through createItemRound
    // (Difference Engine) and new-companies-mid-engagement goes through
    // createSubRound — both apply their own, more specific gating.
    Bus.emit('toast', { msg: 'Round 1 already exists for this engagement', kind: 'error' });
    return null;
  }
  // The cutoff: whatever is in the live inventory right now, for every
  // company in this engagement's scope, frozen for the rest of this round's life.
  let itemSnapshot = ItemKey.snapshotScopeItems(products, engagement.scope.companies);
  // Template-scoped engagement (launched from the Inventory tab): narrow
  // the company-level snapshot down to the exact codes the template
  // named, so sub-auditors only ever see those SKUs — not everything
  // from the companies they happen to belong to.
  if (engagement.scope.type === 'template' && engagement.scope.codes && engagement.scope.codes.length) {
    const codeSet = new Set(engagement.scope.codes);
    itemSnapshot = itemSnapshot.filter(item => codeSet.has(item.code));
  }
  try {
    const round = await Repo.insertRound(sbClient, {
      engagementId: currentEngagementId,
      roundNumber: 1,
      roundSuffix: null,
      unit: 'company',
      state: 'draft',
      baseRoundId: null,
      itemSnapshot,
    });
    const newRounds = rounds.concat([round]);
    Store.setState({ rounds: newRounds, assignments: [], submissions: [] });
    logAudit('round:created', { roundId: round.id, engagementId: currentEngagementId, roundNumber: 1, itemCount: itemSnapshot.length });
    Bus.emit('rounds:changed', newRounds);
    Bus.emit('round:opened', round);
    Bus.emit('toast', { msg: 'Round 1 created — ' + itemSnapshot.length + ' item(s) cut off from current inventory', kind: 'success' });
    return round;
  } catch (err) {
    Bus.emit('toast', { msg: 'Could not create round: ' + err.message, kind: 'error' });
    return null;
  }
}

// Round 2+ — always item-level, always generated from a compiled round via
// the Difference Engine. `items` is whatever buildItemsForMode() produced
// (Differences Only / Full Company Recount / Random Spot-Check).
async function createItemRound(baseRoundId, items) {
  const { currentEngagementId, rounds, sbClient } = Store.getState();
  const baseRound = rounds.find(r => r.id === baseRoundId);
  if (!baseRound) { Bus.emit('toast', { msg: 'Could not find the round this was compiled from', kind: 'error' }); return null; }
  if (!_isFamilyFullyCompiled(rounds, baseRound.roundNumber)) {
    Bus.emit('toast', {
      msg: 'Compile every Round ' + _familyLabel(rounds, baseRound.roundNumber) + ' sub-round first — the next round can\'t start while any of them is still open',
      kind: 'error',
    });
    return null;
  }
  const maxRoundNumber = Math.max(...rounds.map(r => r.roundNumber));
  const roundNumber = maxRoundNumber + 1;
  try {
    const round = await Repo.insertRound(sbClient, {
      engagementId: currentEngagementId,
      roundNumber,
      roundSuffix: null,
      unit: 'item',
      state: 'draft',
      baseRoundId,
      itemSnapshot: items,
    });
    const newRounds = rounds.concat([round]);
    Store.setState({ rounds: newRounds, assignments: [], submissions: [] });
    logAudit('round:created', { roundId: round.id, engagementId: currentEngagementId, roundNumber, itemCount: items.length });
    Bus.emit('rounds:changed', newRounds);
    Bus.emit('round:opened', round);
    Bus.emit('toast', { msg: 'Round ' + roundNumber + ' created — ' + items.length + ' item(s) to recount', kind: 'success' });
    return round;
  } catch (err) {
    Bus.emit('toast', { msg: 'Could not create round: ' + err.message, kind: 'error' });
    return null;
  }
}

// New companies discovered mid-engagement: creates a lettered sub-round
// (1A, 1B, 1C…) scoped to ONLY those new companies — the original round's
// items/history are untouched. Always attaches to the current, still-open
// round family (the highest roundNumber that hasn't yet advanced past —
// i.e. no round N+1 exists yet); once Round 2 exists, that family is
// closed and a new sub-round can no longer be added to it.
async function createSubRound(newCompanies) {
  if (!newCompanies || newCompanies.length === 0) { Bus.emit('toast', { msg: 'Select at least one company to add', kind: 'error' }); return null; }
  if (_subRoundCreationInFlight) { Bus.emit('toast', { msg: 'Already creating a sub-round — one moment', kind: 'error' }); return null; }
  _subRoundCreationInFlight = true;
  try {
    return await _createSubRoundInner(newCompanies);
  } finally {
    _subRoundCreationInFlight = false;
  }
}
async function _createSubRoundInner(newCompanies) {
  const { currentEngagementId, rounds, products, sbClient } = Store.getState();
  const engRounds = rounds.filter(r => r.engagementId === currentEngagementId);
  if (engRounds.length === 0) { Bus.emit('toast', { msg: 'Create Round 1 first', kind: 'error' }); return null; }
  const maxRoundNumber = Math.max(...engRounds.map(r => r.roundNumber));
  const family = _familyRounds(engRounds, maxRoundNumber);
  const usedLetters = family.map(r => r.roundSuffix).filter(Boolean);
  const roundSuffix = String.fromCharCode(65 + usedLetters.length); // 'A', 'B', 'C'...
  const itemSnapshot = ItemKey.snapshotScopeItems(products, newCompanies);
  try {
    const round = await Repo.insertRound(sbClient, {
      engagementId: currentEngagementId,
      roundNumber: maxRoundNumber,
      roundSuffix,
      unit: 'company',
      state: 'draft',
      baseRoundId: null,
      itemSnapshot,
    });
    const newRounds = rounds.concat([round]);
    Store.setState({ rounds: newRounds });
    logAudit('round:subRoundCreated', { roundId: round.id, engagementId: currentEngagementId, roundNumber: maxRoundNumber, roundSuffix, companies: newCompanies });
    Bus.emit('rounds:changed', newRounds);
    Bus.emit('round:opened', round);
    Bus.emit('toast', { msg: 'Round ' + maxRoundNumber + roundSuffix + ' created for ' + newCompanies.length + ' new compan' + (newCompanies.length === 1 ? 'y' : 'ies'), kind: 'success' });
    return round;
  } catch (err) {
    Bus.emit('toast', { msg: 'Could not create sub-round: ' + err.message, kind: 'error' });
    return null;
  }
}

// Pure — given the item-level snapshot a would-be sub-round is about to
// use, and every OTHER currently-open round across the whole system
// (any engagement, any state short of compiled/final), finds any
// (company, code) that's already in flight elsewhere. Used only as a
// preventive, non-blocking warning at creation time — the detective,
// after-the-fact check lives in compile-actions.js
// detectCrossRoundConflicts() instead.
function findPreCreationOverlaps(newItems, otherOpenRounds) {
  const overlaps = [];
  const wanted = new Set(newItems.filter(it => it.code).map(it => it.company + '::' + it.code));
  otherOpenRounds.forEach(r => {
    (r.itemSnapshot || []).forEach(it => {
      if (!it.code) return;
      const sig = it.company + '::' + it.code;
      if (wanted.has(sig)) overlaps.push({ company: it.company, code: it.code, name: it.name, roundId: r.id, engagementId: r.engagementId, engagementName: r.engagementName || '' });
    });
  });
  return overlaps;
}

// Launching a sub-round directly from the Inventory tab (a saved
// template or a random sample) rather than from the "Add New
// Companies" flow inside an engagement — see round-actions.js
// createSubRound for the company-level sibling of this. Codes here can
// span PARTIAL companies (a random sample rarely lines up with whole
// companies), so this is unit:'item', not unit:'company', and does NOT
// touch the engagement's scope.companies — it's a spot-check addition,
// not a scope expansion.
async function createItemSubRound(engagementId, codes) {
  if (!engagementId) { Bus.emit('toast', { msg: 'Choose an engagement to add this to', kind: 'error' }); return null; }
  if (!codes || codes.length === 0) { Bus.emit('toast', { msg: 'Nothing selected to add', kind: 'error' }); return null; }
  if (_subRoundCreationInFlight) { Bus.emit('toast', { msg: 'Already creating a sub-round — one moment', kind: 'error' }); return null; }
  _subRoundCreationInFlight = true;
  try {
    return await _createItemSubRoundInner(engagementId, codes);
  } finally {
    _subRoundCreationInFlight = false;
  }
}
async function _createItemSubRoundInner(engagementId, codes) {
  const { products, sbClient, currentEngagementId, rounds } = Store.getState();
  const itemSnapshot = ItemKey.snapshotSelectedItems(products, codes);
  if (itemSnapshot.length === 0) { Bus.emit('toast', { msg: 'None of these codes match current inventory', kind: 'error' }); return null; }

  let engRounds;
  try {
    engRounds = engagementId === currentEngagementId ? rounds.filter(r => r.engagementId === engagementId) : await Repo.fetchRoundsByEngagement(sbClient, engagementId);
  } catch (err) {
    Bus.emit('toast', { msg: 'Could not load that engagement\'s rounds: ' + err.message, kind: 'error' });
    return null;
  }
  if (engRounds.length === 0) { Bus.emit('toast', { msg: 'That engagement has no Round 1 yet — create one first', kind: 'error' }); return null; }
  const maxRoundNumber = Math.max(...engRounds.map(r => r.roundNumber));
  const family = _familyRounds(engRounds, maxRoundNumber);
  const usedLetters = family.map(r => r.roundSuffix).filter(Boolean);
  const roundSuffix = String.fromCharCode(65 + usedLetters.length);

  // Preventive check — best-effort; a failure here (e.g. offline) should
  // never block creation outright, only skip the warning.
  try {
    const openRounds = await Repo.fetchOpenRoundsAcrossEngagements(sbClient);
    const overlaps = findPreCreationOverlaps(itemSnapshot, openRounds);
    if (overlaps.length > 0) {
      const sample = overlaps[0];
      const proceed = confirm(
        overlaps.length + ' of these item(s) are already assigned in another open round' +
        (sample.engagementName ? ' (e.g. "' + sample.engagementName + '")' : '') +
        ' — continue anyway? A conflict will be flagged for you to resolve once both are compiled.'
      );
      if (!proceed) return null;
      logAudit('round:itemSubRoundOverlapAcknowledged', { engagementId, overlapCount: overlaps.length, sample: overlaps.slice(0, 10) });
    }
  } catch (_) { /* best-effort — proceed without the warning if this check itself fails */ }

  try {
    const round = await Repo.insertRound(sbClient, {
      engagementId, roundNumber: maxRoundNumber, roundSuffix, unit: 'item', state: 'draft', baseRoundId: null, itemSnapshot,
    });
    if (engagementId === currentEngagementId) {
      const newRounds = rounds.concat([round]);
      Store.setState({ rounds: newRounds });
      Bus.emit('rounds:changed', newRounds);
    }
    logAudit('round:itemSubRoundCreatedFromInventory', { roundId: round.id, engagementId, roundNumber: maxRoundNumber, roundSuffix, itemCount: itemSnapshot.length });
    Bus.emit('round:opened', round);
    Bus.emit('toast', { msg: 'Round ' + maxRoundNumber + roundSuffix + ' created — ' + itemSnapshot.length + ' item(s) from your selection', kind: 'success' });
    return round;
  } catch (err) {
    Bus.emit('toast', { msg: 'Could not create sub-round: ' + err.message, kind: 'error' });
    return null;
  }
}

async function updateRoundState(roundId, nextState) {
  const { rounds, sbClient } = Store.getState();
  const round = rounds.find(r => r.id === roundId);
  if (!round) return null;
  const patch = { state: nextState };
  if (nextState === 'locked') patch.lockedAt = Date.now();
  if (nextState === 'compiled') patch.compiledAt = Date.now();
  if (nextState === 'final') patch.finalizedAt = Date.now();
  try {
    await Repo.updateRound(sbClient, roundId, patch);
    Object.assign(round, { state: nextState }, patch.lockedAt ? { lockedAt: new Date(patch.lockedAt).toISOString() } : {}, patch.compiledAt ? { compiledAt: new Date(patch.compiledAt).toISOString() } : {}, patch.finalizedAt ? { finalizedAt: new Date(patch.finalizedAt).toISOString() } : {});
    const newRounds = rounds.slice();
    Store.setState({ rounds: newRounds });
    logAudit('round:stateChanged', { roundId, nextState });
    Bus.emit('rounds:changed', newRounds);
    Bus.emit('round:stateChanged', round);
    return round;
  } catch (err) {
    Bus.emit('toast', { msg: 'Could not update round: ' + err.message, kind: 'error' });
    return null;
  }
}

async function lockRound(roundId) {
  const { assignments } = Store.getState();
  const roundAssignments = assignments.filter(a => a.roundId === roundId && a.status !== 'revoked');
  if (roundAssignments.length === 0) {
    Bus.emit('toast', { msg: 'Assign at least one company/item before locking', kind: 'error' });
    return;
  }
  await updateRoundState(roundId, 'locked');
  Bus.emit('toast', { msg: 'Round locked — staff can now log in and see their assignment', kind: 'success' });
  // A self-assignment can already be in 'counting' status before the round
  // was ever locked (Main Auditor can pair themself any time) — if so, the
  // round's own state should reflect that counting has already begun.
  await noteAssignmentActivity(roundId);
}

// Round enters 'Counting' the moment actual counting activity starts
// anywhere in it — a Sub-Auditor logs in and opens it, or a self-
// assignment begins — not merely because it was locked.
async function noteAssignmentActivity(roundId) {
  const { rounds, assignments } = Store.getState();
  const round = rounds.find(r => r.id === roundId);
  if (!round || round.state !== 'locked') return;
  const roundAssignments = assignments.filter(a => a.roundId === roundId && a.status !== 'revoked');
  const anyActive = roundAssignments.some(a => ['counting', 'submitted'].includes(a.status));
  if (anyActive) await beginCounting(roundId);
}

function beginCounting(roundId) { return updateRoundState(roundId, 'counting'); }

// Round-1-direct-to-Final shortcut (Blueprint: "Round 1 can be locked
// straight to Final with no further rounds — a clean/accepted-as-is
// audit doesn't need a diff cycle.")
async function finalizeRoundDirect(roundId) {
  await updateRoundState(roundId, 'final');
  Bus.emit('round:readyForSnapshot', { roundId });
}

// Pure — given the surviving rounds (already excludes whatever's being
// deleted), returns the same rounds with roundNumber reassigned 1..N so
// the sequence stays gapless. Grouped by CURRENT roundNumber first
// (ascending) so a lettered family — 4, 4A, 4B — always renumbers
// together and keeps its suffixes. A round's id, its assignments/
// submissions/compiled data, and its lettered siblings are all
// untouched — only the round_number label changes. Nothing here talks
// to the DB, so it's cheap to unit-test in isolation from Store/Repo/
// confirm() — see deleteRound below for the side-effecting wrapper.
function _computeRenumbering(survivors) {
  const byOldNumber = [...new Set(survivors.map(r => r.roundNumber))].sort((a, b) => a - b);
  const renumbered = [];
  byOldNumber.forEach((oldNumber, i) => {
    const newNumber = i + 1;
    survivors
      .filter(r => r.roundNumber === oldNumber)
      .forEach(r => renumbered.push(Object.assign({}, r, { roundNumber: newNumber })));
  });
  renumbered.sort((a, b) => a.roundNumber - b.roundNumber || (a.roundSuffix || '').localeCompare(b.roundSuffix || ''));
  return renumbered;
}

// Permanently deletes a round (any state — draft through final) and
// renumbers whatever's left, via _computeRenumbering above.
// assignments/compiled_rounds cascade off round_id in the schema, so
// those clean up on their own; the one thing the DB won't do for us is
// base_round_id (a later round pointing back at the one being diffed
// FROM) — that has no cascade, so any child pointing at this round gets
// its base_round_id nulled first, or the delete would fail on the FK
// (or worse, silently leave a dangling reference if it didn't).
async function deleteRound(roundId) {
  const { rounds, sbClient, currentEngagementId } = Store.getState();
  const round = rounds.find(r => r.id === roundId);
  if (!round) return false;

  const label = round.roundNumber + (round.roundSuffix || '');
  const warn = round.state === 'draft'
    ? `Delete Round ${label}? This cannot be undone.`
    : `Delete Round ${label}? This permanently removes its assignments, submissions, and any compiled data. This cannot be undone.`;
  if (!confirm(warn)) return false;

  try {
    // 1. Detach any round diffed FROM this one, so the FK doesn't block deletion.
    const children = rounds.filter(r => r.baseRoundId === roundId);
    for (const child of children) {
      await Repo.updateRound(sbClient, child.id, { baseRoundId: null });
      child.baseRoundId = null;
    }

    // 2. Delete the round itself (assignments/compiled_rounds cascade in the DB).
    await Repo.deleteRound(sbClient, roundId);

    // 3. Renumber the survivors so the sequence stays gapless.
    const survivors = rounds.filter(r => r.id !== roundId);
    const renumbered = _computeRenumbering(survivors);
    for (const r of renumbered) {
      const original = survivors.find(s => s.id === r.id);
      if (original.roundNumber !== r.roundNumber) {
        await Repo.updateRound(sbClient, r.id, { roundNumber: r.roundNumber });
      }
    }

    Store.setState({ rounds: renumbered });
    logAudit('round:deleted', { roundId, engagementId: currentEngagementId, roundLabel: label });
    Bus.emit('rounds:changed', renumbered);
    Bus.emit('round:deleted', { roundId });
    Bus.emit('toast', { msg: 'Round ' + label + ' deleted', kind: 'success' });
    return true;
  } catch (err) {
    Bus.emit('toast', { msg: 'Could not delete round: ' + err.message, kind: 'error' });
    // Best-effort resync — a partial failure (e.g. detach succeeded but
    // delete didn't) can leave Store's in-memory copy stale.
    await loadRoundsForCurrentEngagement();
    return false;
  }
}

export function isFamilyFullyCompiled(rounds, roundNumber) { return _isFamilyFullyCompiled(rounds, roundNumber); }
export function familyLabel(rounds, roundNumber) { return _familyLabel(rounds, roundNumber); }
export function familyRounds(rounds, roundNumber) { return _familyRounds(rounds, roundNumber); }

export const RoundActions = {
  loadRoundsForCurrentEngagement, createRound, createItemRound, createSubRound, createItemSubRound, updateRoundState,
  lockRound, beginCounting, finalizeRoundDirect, noteAssignmentActivity, deleteRound,
  isFamilyFullyCompiled, familyLabel, familyRounds,
};

export const _testables = { findPreCreationOverlaps, computeRenumbering: _computeRenumbering };
