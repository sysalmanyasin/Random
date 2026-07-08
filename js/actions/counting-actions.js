import { Repo } from '../repository.js';
import { Store } from '../store.js';
import { Bus } from './bus.js';
import { logAudit } from './audit-log-actions.js';

/* ══════════════════════════════════════════════════════════════
   FLOOR 3 — ACTIONS / counting-actions.js
   Blueprint §Counting Module (Sub-Auditor).
   Offline Counting · Auto-Save (per item, local) · Notes/flag per
   item · Progress Tracking · Submit Assignment.

   Assignment Isolation is now enforced by Postgres Row Level
   Security (fetchMyAssignments only ever returns rows where
   auditor_id = the logged-in user's own id) — real, not "isolation
   by omission." This module still validates itemKeys locally too,
   as cheap defense-in-depth, but the database is the actual lock.
   ══════════════════════════════════════════════════════════════ */

function _checkpointKey(assignmentId) { return '__myassignment__' + assignmentId; }

// Progress is synced best-effort and throttled (not on every keystroke) —
// it's a "roughly how far along are they" signal for the Main Auditor's
// dashboard, not a source of truth (submissions/counts remain that). A
// short debounce keeps this from hammering the network while someone is
// actively typing counts in quickly.
let _progressSyncTimer = null;
function _scheduleProgressSync() {
  clearTimeout(_progressSyncTimer);
  _progressSyncTimer = setTimeout(_pushProgressNow, 1500);
}
async function _pushProgressNow() {
  const { sbClient, myCounts, myConfirms } = Store.getState();
  const assignment = _activeAssignment();
  if (!sbClient || !assignment || assignment.status === 'submitted' || assignment.status === 'revoked') return;
  const counted = countingProgress().counted;
  // No "nothing changed" early-return here anymore: the aggregate counted
  // total can stay identical even when a specific item's value just
  // changed (e.g. correcting 10 to 12 on an already-counted item), and
  // the Main Auditor's live-snapshot popup needs that new value, not just
  // a changed total. The 1.5s debounce above is what keeps this from
  // hammering the network, not this check.
  try {
    const liveSnapshot = { counts: myCounts, confirms: myConfirms || {}, updatedAt: new Date().toISOString() };
    await Repo.updateAssignment(sbClient, assignment.id, { progressCount: counted, liveSnapshot });
    assignment.progressCount = counted;
    assignment.liveSnapshot = liveSnapshot;
  } catch (err) {
    console.error('[Counting] Could not sync progress (non-fatal, will retry on next save):', err);
  }
}

async function loadMyAssignments() {
  const { sbClient, currentAuditorId } = Store.getState();
  if (!sbClient || !currentAuditorId) return [];
  const myAssignments = await Repo.fetchMyAssignments(sbClient, currentAuditorId);
  Store.setState({ myAssignments });
  Bus.emit('myAssignments:changed', myAssignments);
  return myAssignments;
}

async function openMyAssignment(assignmentId) {
  clearTimeout(_progressSyncTimer);
  Store.setState({ activeAssignmentId: assignmentId, myCounts: {}, myNotes: {}, myConfirms: {} });
  const cp = await Repo.loadSessionCheckpoint(_checkpointKey(assignmentId));
  if (cp) {
    const notes = cp.counts.__notes__ || {};
    const confirms = cp.counts.__confirms__ || {};
    const counts = Object.assign({}, cp.counts);
    delete counts.__notes__;
    delete counts.__confirms__;
    Store.setState({ myCounts: counts, myNotes: notes, myConfirms: confirms });
    Bus.emit('counting:checkpointRestored', { counts, notes, confirms });
  }

  // This is the real "counting has begun" signal — the Main Auditor's
  // round-state machine picks it up the next time they view the round
  // (round-actions.js's noteAssignmentActivity checks for this status).
  const { sbClient, myAssignments } = Store.getState();
  const assignment = myAssignments.find(a => a.id === assignmentId);
  if (sbClient && assignment && assignment.status === 'assigned') {
    try {
      await Repo.updateAssignment(sbClient, assignmentId, { status: 'counting' });
      assignment.status = 'counting';
      Store.setState({ myAssignments: myAssignments.slice() });
    } catch (err) {
      console.error('[Counting] Could not mark assignment as counting (non-fatal):', err);
    }
  }

  Bus.emit('counting:sessionStarted', assignmentId);
}

function closeMyAssignment() {
  clearTimeout(_progressSyncTimer);
  Store.setState({ activeAssignmentId: null, myCounts: {}, myNotes: {}, myConfirms: {} });
}

function _activeAssignment() {
  const { myAssignments, activeAssignmentId } = Store.getState();
  return myAssignments.find(a => a.id === activeAssignmentId) || null;
}

// Defense-in-depth (the real lock is Postgres RLS): reject any itemKey
// that isn't actually part of the currently open assignment.
function _belongsToActiveAssignment(assignment, itemKey) {
  return !!assignment && assignment.items.some(it => it.itemKey === itemKey);
}

function recordMyCount(itemKey, rawValue, opts) {
  const assignment = _activeAssignment();
  if (!assignment) return;
  if (assignment.status === 'submitted') return; // frozen — see restrict_subauditor_assignment_updates in schema.sql
  if (!_belongsToActiveAssignment(assignment, itemKey)) { console.error('[Isolation] Rejected count for item outside this assignment:', itemKey); return; }
  const { myCounts, myConfirms } = Store.getState();
  const newCounts = Object.assign({}, myCounts);
  if (rawValue === '') {
    delete newCounts[itemKey];
  } else {
    let v = parseFloat(rawValue);
    if (isNaN(v)) v = 0;
    if (v < 0) v = 0;
    newCounts[itemKey] = v;
  }
  const patch = { myCounts: newCounts };
  // A manual edit (typing, not the Same button) means this is no longer a
  // straight re-confirmation of last round's variance — drop the flag so
  // the compiled report doesn't misreport it as "confirmed same."
  if (!(opts && opts.fromSameButton) && myConfirms && myConfirms[itemKey]) {
    const newConfirms = Object.assign({}, myConfirms);
    delete newConfirms[itemKey];
    patch.myConfirms = newConfirms;
  }
  Store.setState(patch);
  _autosave();
  Bus.emit('counting:countChanged', { itemKey, value: newCounts[itemKey] });
}

// ── Same button — re-applies last round's variance against THIS round's
// fresh system-qty cutoff, rather than copying the old physical count. ──
function applySameVariance(itemKey) {
  const assignment = _activeAssignment();
  if (!assignment) return;
  if (assignment.status === 'submitted') return;
  if (!_belongsToActiveAssignment(assignment, itemKey)) { console.error('[Isolation] Rejected same-variance for item outside this assignment:', itemKey); return; }
  const item = assignment.items.find(it => it.itemKey === itemKey);
  if (!item || item.prevVariance === undefined || item.prevVariance === null) return;

  const impliedCount = item.qty + item.prevVariance;
  if (impliedCount < 0) {
    // The system qty cutoff moved by more than the old variance could
    // explain — reapplying blindly would submit a fabricated negative
    // count. The old variance itself is what's now unreliable here.
    Bus.emit('toast', { msg: 'System qty dropped since last round — please recount', kind: 'error' });
    return;
  }

  recordMyCount(itemKey, String(impliedCount), { fromSameButton: true });
  const { myConfirms } = Store.getState();
  Store.setState({ myConfirms: Object.assign({}, myConfirms, { [itemKey]: true }) });
  _autosave();
  logAudit('counting:sameVarianceApplied', {
    assignmentId: assignment.id, itemKey, impliedCount, prevVariance: item.prevVariance, prevRoundNumber: item.prevRoundNumber || null,
  });
  Bus.emit('counting:sameApplied', { itemKey, value: impliedCount });
}

function recordMyNote(itemKey, text) {
  const assignment = _activeAssignment();
  if (!assignment) return;
  if (assignment.status === 'submitted') return;
  if (!_belongsToActiveAssignment(assignment, itemKey)) { console.error('[Isolation] Rejected note for item outside this assignment:', itemKey); return; }
  const { myNotes } = Store.getState();
  const newNotes = Object.assign({}, myNotes);
  if (!text) delete newNotes[itemKey]; else newNotes[itemKey] = text;
  Store.setState({ myNotes: newNotes });
  _autosave();
  Bus.emit('counting:noteChanged', { itemKey, text });
}

function _autosave() {
  const { activeAssignmentId, myCounts, myNotes, myConfirms } = Store.getState();
  if (!activeAssignmentId) return;
  Repo.saveSessionCheckpoint(_checkpointKey(activeAssignmentId), Object.assign({}, myCounts, { __notes__: myNotes, __confirms__: myConfirms }));
  _scheduleProgressSync();
}

function markRemainingAsMatch() {
  const assignment = _activeAssignment();
  if (!assignment) return;
  if (assignment.status === 'submitted') { Bus.emit('toast', { msg: 'Already submitted — ask the Main Auditor to reopen it first', kind: 'error' }); return; }
  if (!confirm('Stamp all unverified items in this assignment as matching system quantity?')) return;
  const { myCounts } = Store.getState();
  const newCounts = Object.assign({}, myCounts);
  assignment.items.forEach(it => { if (newCounts[it.itemKey] === undefined) newCounts[it.itemKey] = it.qty; });
  Store.setState({ myCounts: newCounts });
  _autosave();
  Bus.emit('counting:bulkMarked', {});
}

function countingProgress() {
  const assignment = _activeAssignment();
  const { myCounts } = Store.getState();
  if (!assignment) return { total: 0, counted: 0, pct: 0 };
  const total = assignment.items.length;
  const counted = assignment.items.filter(it => myCounts[it.itemKey] !== undefined).length;
  return { total, counted, pct: total > 0 ? Math.round((counted / total) * 100) : 0 };
}

// ── Submit Assignment ──
// A real database write, upserted so a resubmission naturally
// replaces the same row (fresh submitted_at) instead of needing
// separate conflict-detection bookkeeping.
async function submitMyAssignment() {
  const { sbClient, myCounts, myNotes, myConfirms, currentAuditorId, currentAuditorName, accessExpiresAt } = Store.getState();
  const assignment = _activeAssignment();
  if (!assignment) { Bus.emit('toast', { msg: 'No open assignment to submit', kind: 'error' }); return null; }

  if (assignment.status === 'submitted') {
    Bus.emit('toast', { msg: 'Already submitted — ask the Main Auditor to reopen it if you need to make changes', kind: 'error' });
    return null;
  }
  if (accessExpiresAt && Date.now() > new Date(accessExpiresAt).getTime()) {
    Bus.emit('toast', { msg: 'Your access has expired — ask the Main Auditor to renew it before submitting', kind: 'error' });
    return null;
  }

  const remaining = assignment.items.filter(it => myCounts[it.itemKey] === undefined).length;
  if (remaining > 0 && !confirm(remaining + ' item(s) still unverified. Submit anyway?')) return null;

  try {
    const priorSubmission = await Repo.fetchMySubmission(sbClient, assignment.id, currentAuditorId);
    const submission = await Repo.upsertSubmission(sbClient, {
      assignmentId: assignment.id, roundId: assignment.roundId, engagementId: assignment.engagementId,
      auditorId: currentAuditorId, auditorName: currentAuditorName, counts: myCounts, notes: myNotes || {}, confirms: myConfirms || {},
    });
    if (priorSubmission) {
      logAudit('submission:conflictDetected', {
        assignmentId: assignment.id, priorSubmissionId: priorSubmission.id,
        priorSubmittedAt: priorSubmission.submittedAt, newSubmissionId: submission.id,
      });
    }
    await Repo.updateAssignment(sbClient, assignment.id, { status: 'submitted', progressCount: assignment.items.length - remaining });
    assignment.status = 'submitted';
    Store.setState({ myAssignments: Store.getState().myAssignments.slice() });
    Repo.clearSessionCheckpoint(_checkpointKey(assignment.id));
    logAudit('submission:created', { assignmentId: assignment.id, resubmission: !!priorSubmission });
    Bus.emit('counting:submitted', { submission });
    Bus.emit('toast', { msg: 'Assignment submitted' + (priorSubmission ? ' (replaced your earlier submission)' : ''), kind: 'success' });
    return submission;
  } catch (err) {
    const closed = /row-level security|permission denied/i.test(err.message || '');
    Bus.emit('toast', {
      msg: closed
        ? 'This engagement has been closed by the Main Auditor — your count was saved on this device but could not be submitted'
        : 'Could not submit — check your connection and try again: ' + err.message,
      kind: 'error',
    });
    return null;
  }
}

export const CountingActions = {
  loadMyAssignments, openMyAssignment, closeMyAssignment, recordMyCount, recordMyNote, applySameVariance,
  markRemainingAsMatch, countingProgress, submitMyAssignment,
};
