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

async function createRound(baseRoundId) {
  const { currentEngagementId, rounds, engagements, products, sbClient } = Store.getState();
  const engagement = engagements.find(e => e.id === currentEngagementId);
  if (!engagement) { Bus.emit('toast', { msg: 'Open an engagement first', kind: 'error' }); return null; }

  const roundNumber = rounds.length + 1;
  // The cutoff: whatever is in the live inventory right now, for every
  // company in this engagement's scope, frozen for the rest of this round's life.
  const itemSnapshot = ItemKey.snapshotScopeItems(products, engagement.scope.companies);
  try {
    const round = await Repo.insertRound(sbClient, {
      engagementId: currentEngagementId,
      roundNumber,
      unit: roundNumber === 1 ? 'company' : 'item',
      state: 'draft',
      baseRoundId: baseRoundId || null,
      itemSnapshot,
    });
    const newRounds = rounds.concat([round]);
    Store.setState({ rounds: newRounds, assignments: [], submissions: [] });
    logAudit('round:created', { roundId: round.id, engagementId: currentEngagementId, roundNumber, itemCount: itemSnapshot.length });
    Bus.emit('rounds:changed', newRounds);
    Bus.emit('round:opened', round);
    Bus.emit('toast', { msg: 'Round ' + roundNumber + ' created — ' + itemSnapshot.length + ' item(s) cut off from current inventory', kind: 'success' });
    return round;
  } catch (err) {
    Bus.emit('toast', { msg: 'Could not create round: ' + err.message, kind: 'error' });
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

export const RoundActions = {
  loadRoundsForCurrentEngagement, createRound, updateRoundState,
  lockRound, beginCounting, finalizeRoundDirect, noteAssignmentActivity,
};
