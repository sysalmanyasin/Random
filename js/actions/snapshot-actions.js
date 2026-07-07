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

async function _ensureLatestRoundCompiled(engagement, sbClient) {
  const { rounds } = Store.getState();
  const engRounds = rounds.filter(r => r.engagementId === engagement.id).sort((a, b) => a.roundNumber - b.roundNumber);
  const latest = engRounds[engRounds.length - 1];
  if (!latest) return null;
  let compiled = (await Repo.fetchCompiledRoundsByRound(sbClient, latest.id)).pop();
  if (!compiled) {
    // Round-1-direct-to-Final path: compile now, allowing missing
    // assignments since finalization is terminal.
    compiled = await CompileActions.compileRound(latest.id, { allowMissing: true });
  }
  return { latest, compiled };
}

async function generateFinalSnapshot(engagementId) {
  const { engagements, rounds, sbClient } = Store.getState();
  const engagement = engagements.find(e => e.id === engagementId);
  if (!engagement) { Bus.emit('toast', { msg: 'Engagement not found', kind: 'error' }); return null; }

  const ensured = await _ensureLatestRoundCompiled(engagement, sbClient);
  if (!ensured || !ensured.compiled) { Bus.emit('toast', { msg: 'Nothing to finalize — run at least one round first', kind: 'error' }); return null; }

  const engRounds = rounds.filter(r => r.engagementId === engagementId).sort((a, b) => a.roundNumber - b.roundNumber);
  const latestRound = engRounds[engRounds.length - 1];

  // Freeze Inventory / Generate Final Inventory: start from the LAST
  // round's own frozen item cutoff (not live inventory — see the
  // item_snapshot note on the rounds table), then patch in every
  // counted quantity discovered across every round of this engagement
  // (later rounds win). Because every round's assignments/submissions/
  // compiled results were themselves keyed off that same round's own
  // cutoff, this lookup just works — no positional-index reconstruction
  // needed anymore.
  const finalMap = new Map((latestRound ? latestRound.itemSnapshot : []).map(it => [it.itemKey, Object.assign({}, it, { systemQty: it.qty })]));
  const roundSummaries = [];

  for (const round of engRounds) {
    const compiledList = await Repo.fetchCompiledRoundsByRound(sbClient, round.id);
    const compiled = compiledList[compiledList.length - 1];
    if (!compiled) { roundSummaries.push({ roundNumber: round.roundNumber, state: round.state, itemCount: 0, varianceCount: 0 }); continue; }
    compiled.mergedItems.forEach(row => {
      if (row.missing) return;
      const existing = finalMap.get(row.itemKey);
      if (existing) existing.qty = row.countedQty;
    });
    roundSummaries.push({
      roundNumber: round.roundNumber, state: round.state,
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

    await Repo.updateRound(sbClient, ensured.latest.id, { state: 'final', finalizedAt: Date.now() });
    ensured.latest.state = 'final';
    const rounds2 = Store.getState().rounds.map(r => r.id === ensured.latest.id ? ensured.latest : r);

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
