import { Repo } from '../repository.js';
import { Store } from '../store.js';
import { Bus } from './bus.js';
import { logAudit } from './audit-log-actions.js';
import { ItemKey } from './item-key.js';

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
  const itemSnapshot = ItemKey.snapshotScopeItems(products, engagement.scope.companies);
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
  const { currentEngagementId, rounds, products, sbClient } = Store.getState();
  if (!newCompanies || newCompanies.length === 0) { Bus.emit('toast', { msg: 'Select at least one company to add', kind: 'error' }); return null; }
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

export function isFamilyFullyCompiled(rounds, roundNumber) { return _isFamilyFullyCompiled(rounds, roundNumber); }
export function familyLabel(rounds, roundNumber) { return _familyLabel(rounds, roundNumber); }

export const RoundActions = {
  loadRoundsForCurrentEngagement, createRound, createItemRound, createSubRound, updateRoundState,
  lockRound, beginCounting, finalizeRoundDirect, noteAssignmentActivity,
  isFamilyFullyCompiled, familyLabel,
};
