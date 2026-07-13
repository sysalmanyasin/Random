import { Repo } from '../repository.js';
import { Store } from '../store.js';
import { Bus } from './bus.js';
import { logAudit } from './audit-log-actions.js';
import { computeEffectiveRow } from './counting-actions.js';

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

// Builds the itemKey-keyed merge table plus in-round overlap warnings.
// Pure — no Store/Repo access — so it's independently testable.
// Merge every compiled round in a family (e.g. Round 1 + 1A + 1B) into
// one combined view — this is what the Difference Engine should
// actually generate the next round from, not just whichever single
// sub-round happens to be open on screen. Deduped by (company, code)
// since itemKey is only unique within one round's own snapshot, not
// across sibling sub-rounds (see item-key.js) — a genuine duplicate
// (rare: e.g. an item-level spot-check sub-round happens to touch the
// same SKU a company-level sub-round already covered) keeps whichever
// side was compiled most recently, same "last one wins" rule already
// used for in-round overlaps in buildMergedItems below. Pure/testable.
function mergeFamilyCompiled(familyRoundIds, compiledRounds) {
  const familyCompiled = (compiledRounds || [])
    .filter(c => familyRoundIds.includes(c.roundId))
    .slice()
    .sort((a, b) => new Date(a.compiledAt || 0) - new Date(b.compiledAt || 0)); // oldest first, so later ones win ties below

  const mergedItemsMap = new Map();
  const variancesMap = new Map();
  familyCompiled.forEach(c => {
    (c.mergedItems || []).forEach(row => {
      const key = row.company + '::' + (row.code || row.itemKey);
      mergedItemsMap.set(key, row);
    });
    (c.variances || []).forEach(row => {
      const key = row.company + '::' + (row.code || row.itemKey);
      variancesMap.set(key, row);
    });
  });
  return {
    mergedItems: Array.from(mergedItemsMap.values()),
    variances: Array.from(variancesMap.values()),
    memberCount: familyCompiled.length,
  };
}

function buildMergedItems(roundAssignments, submissions) {
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
        rawCounted: undefined, autoMatched: false,
        auditorName: assignment.auditorName, note: '', confirmedSame: false,
      });
    });
  });
  roundAssignments.forEach(assignment => {
    const sub = submissions.find(s => s.assignmentId === assignment.id);
    if (!sub) return; // no submission at all for this assignment — every item in it stays untouched, and the uncounted=0 rule below still applies to it same as any other unverified item
    Object.keys(sub.counts || {}).forEach(itemKey => {
      const row = merged.get(itemKey);
      if (!row) return; // Validate Data: ignore counts for items outside this assignment's scope
      // Two auditors were both assigned this item — last one processed
      // here wins and the other's count is discarded. Surfaced via
      // overlapWarnings below instead of failing silently.
      row.rawCounted = sub.counts[itemKey];
      row.autoMatched = !!(sub.autoMatched || {})[itemKey];
      row.auditorName = assignment.auditorName;
      row.note = (sub.notes || {})[itemKey] || '';
      row.confirmedSame = !!(sub.confirms || {})[itemKey];
    });
  });

  // The uncounted=0 rule, applied uniformly here — this is the one
  // place every compiled report's numbers ultimately come from. See
  // counting-actions.js computeEffectiveRow: an untouched item reads
  // as a full assumed shortage (countedQty=0), and only "Mark
  // Remaining as Match" (autoMatched) or a real typed count can change
  // that — either way, `missing` stays the honest marker of "not a
  // verified physical count," even when the number itself matches.
  const mergedItems = Array.from(merged.values()).map(row => {
    const { effectiveQty, missing, variance } = computeEffectiveRow(row.systemQty, row.rawCounted, row.autoMatched);
    return {
      itemKey: row.itemKey, company: row.company, code: row.code, name: row.name,
      systemQty: row.systemQty, price: row.price, countedQty: effectiveQty, variance,
      auditorName: row.auditorName, note: row.note, missing, autoMatched: row.autoMatched, confirmedSame: row.confirmedSame,
    };
  });
  return { mergedItems, overlapWarnings };
}

// Auditor Notes appendix — collects each submission's free-text
// "items not in inventory" note (see counting-actions.js
// recordMyExtraNote), grouped by auditor. Kept entirely separate from
// mergedItems/variances: it has no itemKey, no qty, no price, so it
// can never be mistaken for a counted line. Pure/testable.
function collectAuditorNotes(roundAssignments, submissions) {
  const notes = [];
  roundAssignments.forEach(assignment => {
    const sub = submissions.find(s => s.assignmentId === assignment.id);
    const text = sub && sub.extraNote ? sub.extraNote.trim() : '';
    if (!text) return;
    notes.push({ assignmentId: assignment.id, auditorName: assignment.auditorName, note: text, submittedAt: sub.submittedAt });
  });
  return notes;
}

// Cross-round conflicts — the same physical product (matched by
// company+code, since itemKey is only unique within one round-family's
// snapshot — see item-key.js) counted with a DIFFERENT variance in
// another already-compiled round. Never auto-resolved: both counts are
// kept, flagged here, and the Main Auditor picks one explicitly via
// resolveCrossRoundConflict(). Pure/testable — `otherCompiledRounds`
// is whatever the caller decides is "in scope" (today: every other
// compiled round currently loaded in Store, i.e. same engagement).
function detectCrossRoundConflicts(mergedItems, otherCompiledRounds, currentRoundId) {
  const conflicts = [];
  const byCompanyCode = new Map();
  mergedItems.forEach(row => {
    if (row.missing || !row.code) return;
    byCompanyCode.set(row.company + '::' + row.code, row);
  });
  otherCompiledRounds.forEach(other => {
    if (other.roundId === currentRoundId) return;
    (other.mergedItems || []).forEach(otherRow => {
      if (otherRow.missing || !otherRow.code) return;
      const key = otherRow.company + '::' + otherRow.code;
      const mine = byCompanyCode.get(key);
      if (!mine) return;
      if (mine.countedQty === otherRow.countedQty) return; // same result — not a conflict
      conflicts.push({
        company: mine.company, code: mine.code, name: mine.name,
        a: { roundId: currentRoundId, itemKey: mine.itemKey, countedQty: mine.countedQty, auditorName: mine.auditorName },
        b: { roundId: other.roundId, itemKey: otherRow.itemKey, countedQty: otherRow.countedQty, auditorName: otherRow.auditorName },
        resolved: null,
      });
    });
  });
  return conflicts;
}

// Merge Results — keyed by Company + Item ID, so multiple staff
// members' partial submissions patch into the same company correctly.
async function compileRound(roundId, options) {
  const opts = options || {};
  const { assignments, submissions, rounds, sbClient, compiledRounds } = Store.getState();
  const round = rounds.find(r => r.id === roundId);
  if (!round) { Bus.emit('toast', { msg: 'Round not found', kind: 'error' }); return null; }
  if (round.state === 'compiled' || round.state === 'final') {
    Bus.emit('toast', { msg: 'This round is already compiled.', kind: 'error' });
    return compiledRounds.find(c => c.roundId === roundId) || null;
  }

  const roundAssignments = assignments.filter(a => a.roundId === roundId && a.status !== 'revoked');
  const missing = roundAssignments.filter(a => !submissions.some(s => s.assignmentId === a.id));
  if (missing.length > 0 && !opts.allowMissing) {
    Bus.emit('compile:missingAssignments', { missing });
    return null;
  }

  const { mergedItems, overlapWarnings } = buildMergedItems(roundAssignments, submissions);

  if (overlapWarnings.length > 0) {
    logAudit('round:compileOverlapDetected', { roundId, overlapCount: overlapWarnings.length, sample: overlapWarnings.slice(0, 10) });
    Bus.emit('toast', { msg: overlapWarnings.length + ' item(s) were assigned to more than one auditor — only one count was kept for each. Check the audit log.', kind: 'error' });
  }

  // Under the uncounted=0 rule, a "missing" row is not excluded — an
  // untouched item defaulting to countedQty=0 is exactly the kind of
  // variance this report exists to surface (`missing:true` on the row
  // itself is what still lets a reader tell it apart from a verified
  // count, see buildMergedItems above).
  const variances = mergedItems.filter(r => r.countedQty !== r.systemQty);
  const auditorNotes = collectAuditorNotes(roundAssignments, submissions);
  // Compare against every OTHER already-compiled round currently loaded
  // (same engagement, in practice — see loadCompiledRoundsForEngagement).
  const otherCompiled = compiledRounds.filter(c => c.roundId !== roundId);
  const crossRoundConflicts = detectCrossRoundConflicts(mergedItems, otherCompiled, roundId);
  if (crossRoundConflicts.length > 0) {
    logAudit('round:crossRoundConflictDetected', { roundId, conflictCount: crossRoundConflicts.length, sample: crossRoundConflicts.slice(0, 10) });
    Bus.emit('toast', { msg: crossRoundConflicts.length + ' item(s) show a different count in another round — both were kept, flagged for you to resolve.', kind: 'error' });
  }

  try {
    const compiled = await Repo.insertCompiledRound(sbClient, {
      roundId, engagementId: round.engagementId, mergedItems, variances,
      missingAssignmentIds: missing.map(a => a.id), compiledWithMissing: missing.length > 0,
      auditorNotes, crossRoundConflicts,
    });
    const newCompiledRounds = Store.getState().compiledRounds.concat([compiled]);
    Store.setState({ compiledRounds: newCompiledRounds });

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

// Main Auditor's explicit, logged resolution of a flagged cross-round
// conflict — never automatic. `side` is 'a' or 'b', matching the shape
// detectCrossRoundConflicts() produced.
async function resolveCrossRoundConflict(compiledRoundId, conflictIndex, side, mainAuditorName) {
  const { compiledRounds, sbClient, rounds } = Store.getState();
  const compiled = compiledRounds.find(c => c.id === compiledRoundId);
  if (!compiled) { Bus.emit('toast', { msg: 'Compiled round not found', kind: 'error' }); return null; }
  const conflict = (compiled.crossRoundConflicts || [])[conflictIndex];
  if (!conflict) { Bus.emit('toast', { msg: 'Conflict not found', kind: 'error' }); return null; }
  if (side !== 'a' && side !== 'b') return null;

  const chosen = conflict[side];
  const updated = compiled.crossRoundConflicts.map((c, i) => i === conflictIndex
    ? Object.assign({}, c, { resolved: { side, roundId: chosen.roundId, countedQty: chosen.countedQty, resolvedBy: mainAuditorName, resolvedAt: new Date().toISOString() } })
    : c);
  try {
    await Repo.updateCompiledRoundConflicts(sbClient, compiledRoundId, updated);
    compiled.crossRoundConflicts = updated;
    Store.setState({ compiledRounds: compiledRounds.slice() });
    logAudit('round:conflictResolved', {
      compiledRoundId, company: conflict.company, code: conflict.code,
      keptSide: side, keptRoundId: chosen.roundId, keptCountedQty: chosen.countedQty, resolvedBy: mainAuditorName,
    });
    Bus.emit('compiledRounds:changed', compiledRounds);
    const chosenRound = rounds.find(r => r.id === chosen.roundId);
    const roundLabel = chosenRound ? ('Round ' + chosenRound.roundNumber + (chosenRound.roundSuffix || '')) : 'the other round';
    Bus.emit('toast', { msg: 'Conflict resolved — kept the count from ' + roundLabel, kind: 'success' });
    return updated[conflictIndex];
  } catch (err) {
    Bus.emit('toast', { msg: 'Could not save resolution: ' + err.message, kind: 'error' });
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
  resolveCrossRoundConflict, mergeFamilyCompiled, buildMergedItems, collectAuditorNotes,
};

// Pure logic exposed separately for the test suite — not part of the
// surface Pages/Components import.
export const _testables = { buildMergedItems, collectAuditorNotes, detectCrossRoundConflicts, mergeFamilyCompiled };
