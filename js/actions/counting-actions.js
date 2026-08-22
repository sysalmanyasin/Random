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

// ── The uncounted=0 rule ─────────────────────────────────────
// An item nobody has actually typed a value for defaults to
// countedQty=0 — a full assumed shortage — rather than being excluded
// from variance the way "not yet counted" used to work. The ONLY
// sanctioned way to resolve that without a real physical count is
// "Mark Remaining as Match" (or Force Submit's equivalent), which is
// tracked separately (autoMatched) precisely so it's never confused
// with a real count in reports, even though both can show the same
// number. Pure/testable — used identically by the counting screen
// (live, pre-submission) and compile-actions.js buildMergedItems
// (post-submission), so the number on screen while counting and the
// number in the final report are computed by the same rule.
export function computeEffectiveRow(systemQty, rawCounted, isAutoMatched) {
  const touched = rawCounted !== undefined && rawCounted !== null;
  const effectiveQty = touched ? rawCounted : 0;
  // "missing" = not a real, physically-verified figure — true both for
  // a never-touched item (assumed 0) and an auto-matched one (assumed
  // to match, but nobody actually looked).
  const missing = !touched || !!isAutoMatched;
  return { effectiveQty, missing, variance: effectiveQty - systemQty };
}

// ── Row-time tracking ────────────────────────────────────────
// Attributes elapsed time to whichever item was just acted on,
// sequentially: the clock starts the moment the assignment is opened
// (or reopened after a reload) and each recordMyCount() call closes
// out the gap since the last action, crediting it to that item, then
// resets the cursor. Capped per-gap so a coffee break — or someone
// opening the assignment and walking away for an hour — doesn't get
// misattributed as "this one row took 63 minutes." The cursor is a
// plain module variable, not Store state: it's a timing implementation
// detail nothing renders directly, same pattern as _progressSyncTimer
// below.
const MAX_ROW_SECONDS = 600; // 10 minutes — anything slower is almost certainly an interruption, not counting time
let _lastActionAt = null;

// Pure — independently testable without Date.now()/module state.
function computeRowTimeDelta(lastActionAtMs, nowMs, maxSeconds) {
  const cap = maxSeconds === undefined ? MAX_ROW_SECONDS : maxSeconds;
  if (lastActionAtMs === null || lastActionAtMs === undefined) return 0;
  const seconds = (nowMs - lastActionAtMs) / 1000;
  if (seconds <= 0) return 0;
  return Math.min(seconds, cap);
}

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
  const { sbClient, myCounts, myConfirms, myExtraNote, myRowTimes, myAutoMatched } = Store.getState();
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
    const liveSnapshot = {
      counts: myCounts, confirms: myConfirms || {}, extraNote: myExtraNote || '',
      rowTimes: myRowTimes || {}, autoMatched: myAutoMatched || {}, updatedAt: new Date().toISOString(),
    };
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
  Store.setState({ activeAssignmentId: assignmentId, myCounts: {}, myNotes: {}, myConfirms: {}, myExtraNote: '', myRowTimes: {}, myAutoMatched: {} });
  // The clock only ever runs within one continuous session — reset on
  // every open (including a reload mid-count), not restored from the
  // checkpoint. Restoring a stale cursor from before a reload/reopen
  // would count the gap while the app was closed as "time on the next
  // item typed," which is exactly the interruption-contamination this
  // was built to avoid.
  _lastActionAt = Date.now();
  const cp = await Repo.loadSessionCheckpoint(_checkpointKey(assignmentId));
  if (cp) {
    const notes = cp.counts.__notes__ || {};
    const confirms = cp.counts.__confirms__ || {};
    const extraNote = cp.counts.__extraNote__ || '';
    const rowTimes = cp.counts.__rowTimes__ || {};
    const autoMatched = cp.counts.__autoMatched__ || {};
    const counts = Object.assign({}, cp.counts);
    delete counts.__notes__;
    delete counts.__confirms__;
    delete counts.__extraNote__;
    delete counts.__rowTimes__;
    delete counts.__autoMatched__;
    Store.setState({ myCounts: counts, myNotes: notes, myConfirms: confirms, myExtraNote: extraNote, myRowTimes: rowTimes, myAutoMatched: autoMatched });
    Bus.emit('counting:checkpointRestored', { counts, notes, confirms, extraNote, rowTimes, autoMatched });
  } else {
    // No local checkpoint on THIS device — either a brand-new device for
    // this person, or this assignment was just Reassigned to them and
    // they've never opened it before. If the server already holds counts
    // (live_snapshot — either their own in-progress sync, or counts the
    // Main Auditor carried over from a prior submission at Reassign time),
    // seed the screen from that instead of starting blank, so "keep
    // counts as a starting point" actually shows up on open, not just
    // in the database.
    const { myAssignments: _existing } = Store.getState();
    const liveAssignment = _existing.find(a => a.id === assignmentId);
    const snap = liveAssignment && liveAssignment.liveSnapshot;
    if (snap && snap.counts && Object.keys(snap.counts).length > 0) {
      const counts = Object.assign({}, snap.counts);
      const confirms = Object.assign({}, snap.confirms || {});
      const extraNote = snap.extraNote || '';
      const rowTimes = Object.assign({}, snap.rowTimes || {});
      const autoMatched = Object.assign({}, snap.autoMatched || {});
      Store.setState({ myCounts: counts, myConfirms: confirms, myExtraNote: extraNote, myRowTimes: rowTimes, myAutoMatched: autoMatched });
      Bus.emit('counting:checkpointRestored', { counts, notes: {}, confirms, extraNote, rowTimes, autoMatched });
    }
  }

  // This is the real "counting has begun" signal — the Main Auditor's
  // round-state machine picks it up the next time they view the round
  // (round-actions.js's noteAssignmentActivity checks for this status).
  // startedAt rides along on the same first-open transition, since
  // that's the actual moment "opening to submission" timing should
  // start from — not whenever the assignment happened to be created or
  // handed out.
  const { sbClient, myAssignments } = Store.getState();
  const assignment = myAssignments.find(a => a.id === assignmentId);
  if (sbClient && assignment && assignment.status === 'assigned') {
    try {
      const startedAt = new Date().toISOString();
      await Repo.updateAssignment(sbClient, assignmentId, { status: 'counting', startedAt });
      assignment.status = 'counting';
      assignment.startedAt = startedAt;
      Store.setState({ myAssignments: myAssignments.slice() });
    } catch (err) {
      console.error('[Counting] Could not mark assignment as counting (non-fatal):', err);
    }
  }

  Bus.emit('counting:sessionStarted', assignmentId);
}

function closeMyAssignment() {
  clearTimeout(_progressSyncTimer);
  _lastActionAt = null;
  Store.setState({ activeAssignmentId: null, myCounts: {}, myNotes: {}, myConfirms: {}, myExtraNote: '', myRowTimes: {}, myAutoMatched: {} });
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
  const { myCounts, myConfirms, myRowTimes, myAutoMatched } = Store.getState();
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
  // Typing an actual value — even one that happens to equal system
  // qty — IS a real physical count. It's no longer an unresolved
  // assumption, so it can't stay flagged auto-matched.
  if (myAutoMatched && myAutoMatched[itemKey]) {
    const newAutoMatched = Object.assign({}, myAutoMatched);
    delete newAutoMatched[itemKey];
    patch.myAutoMatched = newAutoMatched;
  }
  // Credit the time since the last count/note action to this row, then
  // reset the cursor here — see MAX_ROW_SECONDS/_lastActionAt above.
  const now = Date.now();
  const delta = computeRowTimeDelta(_lastActionAt, now);
  if (delta > 0) {
    patch.myRowTimes = Object.assign({}, myRowTimes, { [itemKey]: Math.round((myRowTimes[itemKey] || 0) + delta) });
  }
  _lastActionAt = now;
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
  const { activeAssignmentId, myCounts, myNotes, myConfirms, myExtraNote, myRowTimes, myAutoMatched } = Store.getState();
  if (!activeAssignmentId) return;
  Repo.saveSessionCheckpoint(_checkpointKey(activeAssignmentId), Object.assign({}, myCounts, { __notes__: myNotes, __confirms__: myConfirms, __extraNote__: myExtraNote || '', __rowTimes__: myRowTimes || {}, __autoMatched__: myAutoMatched || {} }));
  _scheduleProgressSync();
}

// ── "Items not in inventory" note — one free-text block per assignment,
// not tied to any itemKey (there's no SKU/qty/price to attach a count
// to for stock the Sub-Auditor found that isn't in the system at all).
// Informational only: never feeds variance calculations. Soft length
// cap keeps a single note from ballooning the 1.5s live-snapshot sync.
const EXTRA_NOTE_MAX_LENGTH = 2000;
// Pure — split out purely so the length cap itself is independently
// testable without needing an active assignment/Store.
function truncateExtraNote(text) {
  return (text || '').slice(0, EXTRA_NOTE_MAX_LENGTH);
}
function recordMyExtraNote(text) {
  const assignment = _activeAssignment();
  if (!assignment) return;
  if (assignment.status === 'submitted') return;
  const trimmed = truncateExtraNote(text);
  Store.setState({ myExtraNote: trimmed });
  _autosave();
  Bus.emit('counting:extraNoteChanged', { text: trimmed });
}

function markRemainingAsMatch() {
  const assignment = _activeAssignment();
  if (!assignment) return;
  if (assignment.status === 'submitted') { Bus.emit('toast', { msg: 'Already submitted — ask the Main Auditor to reopen it first', kind: 'error' }); return; }
  if (!confirm('Every item you have NOT counted will otherwise be reported as a full shortage (assumed 0). This stamps all of them as matching system quantity WITHOUT actually counting them — that will be visible in the report as auto-matched, not verified. Continue?')) return;
  const { myCounts, myAutoMatched } = Store.getState();
  const newCounts = Object.assign({}, myCounts);
  const newAutoMatched = Object.assign({}, myAutoMatched);
  assignment.items.forEach(it => {
    if (newCounts[it.itemKey] === undefined) {
      newCounts[it.itemKey] = it.qty;
      newAutoMatched[it.itemKey] = true;
    }
  });
  Store.setState({ myCounts: newCounts, myAutoMatched: newAutoMatched });
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
  const { sbClient, myCounts, myNotes, myConfirms, myExtraNote, myRowTimes, myAutoMatched, currentAuditorId, currentAuditorName, accessExpiresAt } = Store.getState();
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
      extraNote: myExtraNote || '', rowTimes: myRowTimes || {}, autoMatched: myAutoMatched || {},
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
    // Opening-to-submission duration — assignment.startedAt was set the
    // moment they first opened it (openMyAssignment above), so this is
    // the real elapsed time, not just "time since assigned."
    const totalSeconds = assignment.startedAt ? Math.round((Date.now() - new Date(assignment.startedAt).getTime()) / 1000) : null;
    logAudit('submission:created', { assignmentId: assignment.id, resubmission: !!priorSubmission, totalSeconds });
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
  markRemainingAsMatch, countingProgress, submitMyAssignment, recordMyExtraNote,
};

export const _testables = { EXTRA_NOTE_MAX_LENGTH, truncateExtraNote, computeRowTimeDelta, MAX_ROW_SECONDS, computeEffectiveRow };
