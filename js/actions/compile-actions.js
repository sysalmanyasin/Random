import { Repo } from '../repository.js';
import { Store } from '../store.js';
import { Bus } from './bus.js';
import { logAudit } from './audit-log-actions.js';

/* ══════════════════════════════════════════════════════════════
   FLOOR 3 — ACTIONS / compile-actions.js
   Blueprint §Compilation Engine (Main Auditor).
   Receive Submissions · Validate Data · Merge Results (keyed by
   Company + Item ID) · Detect Variances · Generate Compiled Round
   · Compile With Missing Assignments (override for stragglers).
   Submissions now come straight from Supabase — no more package
   copy/paste handoff, and no more "which one is latest" ambiguity
   since each assignment has exactly one live submission row
   (upserted on resubmission).
   ══════════════════════════════════════════════════════════════ */

async function loadSubmissionsForRound(roundId) {
  const { sbClient } = Store.getState();
  const submissions = await Repo.fetchSubmissionsByRound(sbClient, roundId);
  Store.setState({ submissions });
  Bus.emit('submissions:changed', submissions);
  return submissions;
}

function assignmentSubmissionStatus(roundId) {
  const { assignments, submissions } = Store.getState();
  const roundAssignments = assignments.filter(a => a.roundId === roundId && a.status !== 'revoked');
  return roundAssignments.map(a => ({
    assignment: a,
    submitted: submissions.some(s => s.assignmentId === a.id),
  }));
}

// Merge Results — keyed by Company + Item ID, so multiple staff
// members' partial submissions patch into the same company correctly.
async function compileRound(roundId, options) {
  const opts = options || {};
  const { assignments, submissions, rounds, sbClient } = Store.getState();
  const round = rounds.find(r => r.id === roundId);
  if (!round) { Bus.emit('toast', { msg: 'Round not found', kind: 'error' }); return null; }

  const roundAssignments = assignments.filter(a => a.roundId === roundId && a.status !== 'revoked');
  const missing = roundAssignments.filter(a => !submissions.some(s => s.assignmentId === a.id));
  if (missing.length > 0 && !opts.allowMissing) {
    Bus.emit('compile:missingAssignments', { missing });
    return null;
  }

  // Company+ItemID keyed merge table.
  const merged = new Map();
  const overlapWarnings = [];
  roundAssignments.forEach(assignment => {
    assignment.items.forEach(item => {
      if (merged.has(item.itemKey)) {
        overlapWarnings.push({ itemKey: item.itemKey, company: item.company, name: item.name });
      }
      merged.set(item.itemKey, {
        itemKey: item.itemKey, company: item.company, code: item.code, name: item.name,
        systemQty: item.qty, price: item.price,
        countedQty: undefined, auditorName: assignment.auditorName, note: '', missing: true, confirmedSame: false,
      });
    });
  });
  roundAssignments.forEach(assignment => {
    const sub = submissions.find(s => s.assignmentId === assignment.id);
    if (!sub) return;
    Object.keys(sub.counts || {}).forEach(itemKey => {
      const row = merged.get(itemKey);
      if (!row) return; // Validate Data: ignore counts for items outside this assignment's scope
      // Two auditors were both assigned this item — last one processed
      // here wins and the other's count is discarded. Surfaced via
      // overlapWarnings below instead of failing silently.
      row.countedQty = sub.counts[itemKey];
      row.auditorName = assignment.auditorName;
      row.note = (sub.notes || {})[itemKey] || '';
      row.confirmedSame = !!(sub.confirms || {})[itemKey];
      row.missing = false;
    });
  });

  if (overlapWarnings.length > 0) {
    logAudit('round:compileOverlapDetected', { roundId, overlapCount: overlapWarnings.length, sample: overlapWarnings.slice(0, 10) });
    Bus.emit('toast', { msg: overlapWarnings.length + ' item(s) were assigned to more than one auditor — only one count was kept for each. Check the audit log.', kind: 'error' });
  }

  const mergedItems = Array.from(merged.values());
  const variances = mergedItems.filter(r => !r.missing && r.countedQty !== r.systemQty);

  try {
    const compiled = await Repo.insertCompiledRound(sbClient, {
      roundId, engagementId: round.engagementId, mergedItems, variances,
      missingAssignmentIds: missing.map(a => a.id), compiledWithMissing: missing.length > 0,
    });
    const compiledRounds = Store.getState().compiledRounds.concat([compiled]);
    Store.setState({ compiledRounds });

    await Repo.updateRound(sbClient, roundId, { state: 'compiled', compiledAt: Date.now() });
    round.state = 'compiled';
    const rNew = Store.getState().rounds.map(r => r.id === roundId ? round : r);
    Store.setState({ rounds: rNew });

    logAudit('round:compiled', { roundId, itemCount: mergedItems.length, varianceCount: variances.length, withMissing: missing.length > 0 });
    Bus.emit('rounds:changed', rNew);
    Bus.emit('round:compiled', compiled);
    Bus.emit('toast', { msg: 'Round compiled — ' + variances.length + ' variance(s) found' + (missing.length ? ' (' + missing.length + ' assignment(s) missing)' : ''), kind: 'success' });
    return compiled;
  } catch (err) {
    Bus.emit('toast', { msg: 'Could not compile round: ' + err.message, kind: 'error' });
    return null;
  }
}

function compileRoundWithMissingOverride(roundId) {
  return compileRound(roundId, { allowMissing: true });
}

async function loadCompiledRoundsForEngagement(engagementId) {
  const { rounds, sbClient } = Store.getState();
  const roundIds = rounds.filter(r => r.engagementId === engagementId).map(r => r.id);
  const lists = await Promise.all(roundIds.map(id => Repo.fetchCompiledRoundsByRound(sbClient, id)));
  const compiledRounds = lists.flat();
  Store.setState({ compiledRounds });
  Bus.emit('compiledRounds:changed', compiledRounds);
  return compiledRounds;
}

export const CompileActions = {
  loadSubmissionsForRound, assignmentSubmissionStatus,
  compileRound, compileRoundWithMissingOverride, loadCompiledRoundsForEngagement,
};
