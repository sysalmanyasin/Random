import { Repo } from '../repository.js';
import { Store } from '../store.js';
import { Bus } from './bus.js';
import { logAudit } from './audit-log-actions.js';
import { CompileActions } from './compile-actions.js';

/* ══════════════════════════════════════════════════════════════
   FLOOR 3 — ACTIONS / snapshot-actions.js
   Blueprint §Final Snapshot.
   Lock Engagement · Freeze Data · Freeze Inventory · Generate
   Final Inventory · Generate Audit Trail · Generate Final Report.
   ══════════════════════════════════════════════════════════════ */

async function _ensureLatestFamilyCompiled(engagement, sbClient) {
  const { rounds } = Store.getState();
  const engRounds = rounds.filter(r => r.engagementId === engagement.id);
  if (engRounds.length === 0) return null;
  const maxRoundNumber = Math.max(...engRounds.map(r => r.roundNumber));
  // The "latest round" for finalization purposes is every round sharing
  // the highest roundNumber — the plain round plus any lettered siblings
  // (1, 1A, 1B...). Compiling only one of them (picked arbitrarily by
  // sort order when roundNumbers tie) would silently drop that sibling's
  // companies from the final inventory entirely.
  const family = engRounds.filter(r => r.roundNumber === maxRoundNumber);
  const compiledByRound = {};
  for (const round of family) {
    let compiled = (await Repo.fetchCompiledRoundsByRound(sbClient, round.id)).pop();
    if (!compiled) {
      // compileRound reads assignments/submissions off the Store, scoped
      // to whichever round the Main Auditor last had open in the UI — if
      // that was a DIFFERENT sibling in this family (e.g. they opened
      // Round 1 but never Round 1B before hitting Finalize), compiling
      // 1B here would silently see zero assignments. Load this round's
      // own rows fresh right before compiling it.
      const roundAssignments = await Repo.fetchAssignmentsByRound(sbClient, round.id);
      const roundSubmissions = await Repo.fetchSubmissionsByRound(sbClient, round.id);
      Store.setState({ assignments: roundAssignments, submissions: roundSubmissions });
      // Round-1-direct-to-Final path: compile now, allowing missing
      // assignments since finalization is terminal.
      compiled = await CompileActions.compileRound(round.id, { allowMissing: true });
    }
    if (compiled) compiledByRound[round.id] = compiled;
  }
  return { family, compiledByRound };
}

async function generateFinalSnapshot(engagementId) {
  const { engagements, rounds, sbClient } = Store.getState();
  const engagement = engagements.find(e => e.id === engagementId);
  if (!engagement) { Bus.emit('toast', { msg: 'Engagement not found', kind: 'error' }); return null; }

  const ensured = await _ensureLatestFamilyCompiled(engagement, sbClient);
  if (!ensured || ensured.family.length === 0) { Bus.emit('toast', { msg: 'Nothing to finalize — run at least one round first', kind: 'error' }); return null; }
  if (Object.keys(ensured.compiledByRound).length < ensured.family.length) {
    Bus.emit('toast', { msg: 'Could not compile every round in the current round family — check for one still stuck in draft/locked/counting', kind: 'error' });
    return null;
  }

  const engRounds = rounds.filter(r => r.engagementId === engagementId).sort((a, b) => a.roundNumber - b.roundNumber);
  const latestFamily = ensured.family;

  // Freeze Inventory / Generate Final Inventory: start from the UNION of
  // every round in the latest family's own frozen item cutoff (not live
  // inventory — see the item_snapshot note on the rounds table) — a
  // lettered sub-round is scoped to different companies than its
  // siblings, so this union, not any single round's snapshot, is the
  // real "current cutoff." Then patch in every counted quantity
  // discovered across every round of this engagement (later rounds win).
  const finalMap = new Map();
  latestFamily.forEach(r => r.itemSnapshot.forEach(it => {
    if (!finalMap.has(it.itemKey)) finalMap.set(it.itemKey, Object.assign({}, it, { systemQty: it.qty }));
  }));
  const roundSummaries = [];

  for (const round of engRounds) {
    const compiledList = await Repo.fetchCompiledRoundsByRound(sbClient, round.id);
    const compiled = compiledList[compiledList.length - 1];
    if (!compiled) { roundSummaries.push({ roundNumber: round.roundNumber, roundSuffix: round.roundSuffix || null, state: round.state, itemCount: 0, varianceCount: 0 }); continue; }
    compiled.mergedItems.forEach(row => {
      if (row.missing) return;
      const existing = finalMap.get(row.itemKey);
      if (existing) existing.qty = row.countedQty;
    });
    roundSummaries.push({
      roundNumber: round.roundNumber, roundSuffix: round.roundSuffix || null, state: round.state,
      itemCount: compiled.mergedItems.length, varianceCount: compiled.variances.length,
      compiledAt: compiled.compiledAt,
    });
  }

  const finalInventory = Array.from(finalMap.values());
  const totalVarianceValue = finalInventory.reduce((sum, p) => sum + (p.qty - p.systemQty) * p.price, 0);

  const auditLog = await Repo.fetchAuditLog(sbClient);
  const auditTrail = auditLog.filter(entry =>
    (entry.details && entry.details.engagementId === engagementId) ||
    engRounds.some(r => entry.details && entry.details.roundId === r.id)
  );

  const report = {
    engagementId, engagementName: engagement.name,
    generatedAt: Date.now(),
    scope: engagement.scope,
    roundsSummary: roundSummaries,
    totalCompanies: engagement.scope.companies.length,
    totalItems: finalInventory.filter(p => engagement.scope.companies.includes(p.company)).length,
    totalVarianceValue,
  };

  try {
    const snapshot = await Repo.insertFinalSnapshot(sbClient, { engagementId, finalInventory, auditTrail, report });
    const finalSnapshots = Store.getState().finalSnapshots.concat([snapshot]);
    Store.setState({ finalSnapshots });

    // Lock Engagement / Freeze Data.
    await Repo.updateEngagementStatus(sbClient, engagementId, 'closed');
    engagement.status = 'closed';
    const engagements2 = Store.getState().engagements.map(e => e.id === engagementId ? engagement : e);

    for (const round of latestFamily) {
      await Repo.updateRound(sbClient, round.id, { state: 'final', finalizedAt: Date.now() });
      round.state = 'final';
    }
    const rounds2 = Store.getState().rounds.map(r => latestFamily.find(fr => fr.id === r.id) || r);

    Store.setState({ engagements: engagements2, rounds: rounds2 });
    logAudit('engagement:finalized', { engagementId, snapshotId: snapshot.id });
    Bus.emit('engagements:changed', engagements2);
    Bus.emit('rounds:changed', rounds2);
    Bus.emit('snapshot:generated', snapshot);
    Bus.emit('toast', { msg: 'Final Snapshot generated — engagement locked', kind: 'success' });
    return snapshot;
  } catch (err) {
    Bus.emit('toast', { msg: 'Could not generate final snapshot: ' + err.message, kind: 'error' });
    return null;
  }
}

async function loadFinalSnapshotsForEngagement(engagementId) {
  const { sbClient } = Store.getState();
  const finalSnapshots = await Repo.fetchFinalSnapshotsByEngagement(sbClient, engagementId);
  Store.setState({ finalSnapshots });
  Bus.emit('finalSnapshots:changed', finalSnapshots);
  return finalSnapshots;
}

export const SnapshotActions = { generateFinalSnapshot, loadFinalSnapshotsForEngagement };
