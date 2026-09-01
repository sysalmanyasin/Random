import { Store } from '../store.js';
import { Repo } from '../repository.js';
import { computeEffectiveRow } from './counting-actions.js';

/* ══════════════════════════════════════════════════════════════
   FLOOR 3 — ACTIONS / dashboard-actions.js
   Blueprint §Dashboard. Pure read-only aggregate queries over the
   Store — no mutation, no Bus emission. Pages call these to get
   numbers to render; Components just render whatever they're given.
   ══════════════════════════════════════════════════════════════ */

function mainAuditorDashboard(engagementId, focusRoundId) {
  const { engagements, rounds, assignments, submissions, compiledRounds } = Store.getState();
  const engagement = engagements.find(e => e.id === engagementId);
  if (!engagement) return null;
  const engRounds = rounds.filter(r => r.engagementId === engagementId).sort((a, b) => a.roundNumber - b.roundNumber);
  // Bug fix: this used to always summarize the engagement's latest round by
  // roundNumber, even while the Main Auditor had an EARLIER round open (e.g.
  // reviewing Round 1 after Round 2 already exists, or working inside a
  // lettered sub-round like 1B) — so "Company Coverage" showed Unassigned
  // for companies that were actually assigned, just in the round on screen.
  // Now it reflects whichever round is actually open; only falls back to
  // "latest" when nothing is open (e.g. the plain engagement list view).
  const focusRound = (focusRoundId && engRounds.find(r => r.id === focusRoundId)) || null;
  const latestRound = focusRound || engRounds[engRounds.length - 1] || null;
  const roundAssignments = latestRound ? assignments.filter(a => a.roundId === latestRound.id && a.status !== 'revoked') : [];
  const roundSubmissions = latestRound ? submissions.filter(s => s.roundId === latestRound.id) : [];
  const compiled = latestRound ? compiledRounds.filter(c => c.roundId === latestRound.id).pop() : null;

  const auditorProgress = roundAssignments.map(a => {
    const total = a.items.length;
    const counted = Math.min(a.progressCount || 0, total);
    const sub = roundSubmissions.find(s => s.assignmentId === a.id);
    return {
      auditorName: a.auditorName,
      assignmentId: a.id,
      itemCount: total,
      counted,
      pct: total > 0 ? Math.round((counted / total) * 100) : 0,
      status: a.status,
      submitted: !!sub,
      startedAt: a.startedAt || null,
      submittedAt: sub ? sub.submittedAt : null,
    };
  });

  // Only list companies actually present in the round being viewed — for an
  // item-level round (Differences Only etc.) that's usually a small subset
  // of the engagement's full scope, so showing every scope company here
  // would just be noise ("Unassigned" for companies with zero items this round).
  const companiesInFocus = latestRound
    ? [...new Set(latestRound.itemSnapshot.map(it => it.company))].sort((a, b) => a.localeCompare(b))
    : engagement.scope.companies;
  const companyStatus = companiesInFocus.map(company => ({
    company,
    assigned: roundAssignments.some(a => a.companies.includes(company)),
    auditor: (roundAssignments.find(a => a.companies.includes(company)) || {}).auditorName || '—',
  }));

  return {
    engagementStatus: engagement.status,
    roundStatus: latestRound ? { number: latestRound.roundNumber, suffix: latestRound.roundSuffix || '', state: latestRound.state } : null,
    companyStatus,
    auditorProgress,
    assignmentProgress: { total: roundAssignments.length, submitted: roundSubmissions.length },
    submissionProgress: { total: roundAssignments.length, submitted: roundSubmissions.length },
    compileStatus: compiled ? { compiledAt: compiled.compiledAt, variances: compiled.variances.length } : 'not compiled',
    finalStatus: engagement.status === 'closed' ? 'final' : 'in progress',
    // Both default to [] rather than being omitted, so components never
    // need an extra "does this exist" guard on top of the empty-array one.
    auditorNotes: compiled ? (compiled.auditorNotes || []) : [],
    crossRoundConflicts: compiled ? (compiled.crossRoundConflicts || []) : [],
    compiledRoundId: compiled ? compiled.id : null,
  };
}

// ── Live Snapshot popup — sort/filter over an assignment's items,
// purely for how the Main Auditor reviews the popup. Pure/testable:
// takes the resolved rows the component already knows how to build the
// display strings from, so it never has to duplicate variance-color
// logic here — just ordering and inclusion.
function buildLiveSnapshotRows(assignment) {
  const snap = (assignment && assignment.liveSnapshot) || {};
  const counts = snap.counts || {};
  const rowTimes = snap.rowTimes || {};
  const autoMatched = snap.autoMatched || {};
  return (assignment ? assignment.items : []).map(item => {
    const rawCounted = counts[item.itemKey];
    const isAutoMatched = !!autoMatched[item.itemKey];
    // Uncounted=0 rule (see counting-actions.js computeEffectiveRow):
    // an untouched item already reads as its full assumed shortage
    // here, same as it will once compiled — `missing` is what still
    // lets the popup (and its "Unverified" filter/count) distinguish
    // an assumption from a real physical count.
    const { effectiveQty, missing, variance } = computeEffectiveRow(item.qty, rawCounted, isAutoMatched);
    const hasCount = rawCounted !== undefined; // "has an entry at all" — real OR auto-matched — distinct from `missing`
    let status; // 'short' | 'over' | 'match' | 'unverified'
    if (!hasCount) status = 'unverified';
    else if (variance < 0) status = 'short';
    else if (variance > 0) status = 'over';
    else status = 'match';
    return {
      itemKey: item.itemKey, name: item.name, company: item.company, qty: item.qty,
      counted: effectiveQty, hasCount, missing, autoMatched: isAutoMatched, variance, status,
      seconds: rowTimes[item.itemKey] || 0,
    };
  });
}

function filterLiveSnapshotRows(rows, filterMode) {
  if (!filterMode || filterMode === 'all') return rows;
  if (filterMode === 'shorts') return rows.filter(r => r.status === 'short');
  if (filterMode === 'overs') return rows.filter(r => r.status === 'over');
  if (filterMode === 'unverified') return rows.filter(r => r.status === 'unverified');
  return rows;
}

// sortMode: 'name-asc' | 'name-desc' | 'variance-desc' (largest absolute
// variance first, unverified last) | 'variance-asc' | 'time-desc' (slowest row first)
function sortLiveSnapshotRows(rows, sortMode) {
  const sorted = rows.slice();
  if (sortMode === 'name-desc') {
    sorted.sort((a, b) => b.name.localeCompare(a.name));
  } else if (sortMode === 'variance-desc' || sortMode === 'variance-asc') {
    // Unverified items (no count yet) always sort last regardless of
    // direction — there's no variance magnitude to rank them by, and
    // burying them at the top of a "largest variance first" view would
    // be confusing.
    sorted.sort((a, b) => {
      if (a.hasCount !== b.hasCount) return a.hasCount ? -1 : 1; // unverified always last
      if (!a.hasCount) return 0;
      const av = Math.abs(a.variance), bv = Math.abs(b.variance);
      return sortMode === 'variance-desc' ? bv - av : av - bv;
    });
  } else if (sortMode === 'time-desc') {
    sorted.sort((a, b) => (b.seconds || 0) - (a.seconds || 0));
  } else {
    sorted.sort((a, b) => a.name.localeCompare(b.name)); // default: name-asc
  }
  return sorted;
}

function subAuditorDashboard() {
  const { myAssignments, activeAssignmentId, myCounts } = Store.getState();
  const assignment = myAssignments.find(a => a.id === activeAssignmentId);
  if (!assignment) return null;
  const total = assignment.items.length;
  const counted = assignment.items.filter(it => myCounts[it.itemKey] !== undefined).length;
  let short = 0, over = 0, match = 0, netImpact = 0;
  assignment.items.forEach(it => {
    const c = myCounts[it.itemKey];
    if (c === undefined) return;
    const delta = c - it.qty;
    if (delta < 0) short++; else if (delta > 0) over++; else match++;
    netImpact += delta * it.price;
  });
  return {
    assignedCompanies: assignment.companies,
    progress: { total, counted, pct: total > 0 ? Math.round((counted / total) * 100) : 0 },
    pendingSubmission: counted > 0 || total === 0,
    short, over, match, rem: total - counted, netImpact,
  };
}

// Manual "refreshing snapshot" for the Main Auditor's progress-bar tap —
// a fresh single-row fetch (not a live subscription), showing whatever
// the Sub-Auditor's device last synced via its own debounce.
async function fetchLiveAssignmentSnapshot(assignmentId) {
  const { sbClient } = Store.getState();
  if (!sbClient) return null;
  try {
    return await Repo.fetchAssignmentById(sbClient, assignmentId);
  } catch (err) {
    console.error('[Dashboard] Could not fetch live snapshot:', err);
    return null;
  }
}

// Pure — "3m 20s" / "1h 05m" / "45s", used anywhere elapsed counting
// time is shown (live-snapshot header, Submission History export).
function formatDuration(totalSeconds) {
  if (totalSeconds === null || totalSeconds === undefined || totalSeconds < 0) return '—';
  const s = Math.round(totalSeconds);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (h > 0) return h + 'h ' + String(m).padStart(2, '0') + 'm';
  if (m > 0) return m + 'm ' + String(sec).padStart(2, '0') + 's';
  return sec + 's';
}

// Read-only, non-mutating per-round submission counts — powers the
// "Auditor Progress" lens on each round card in the Rounds list.
// Deliberately does NOT touch Store's shared `assignments` key: that
// key holds ONLY the currently-open round's assignments
// (loadAssignmentsForRound overwrites it wholesale on every open), and
// the counting/compile/reassign flows all assume it means "this
// round" — merging every round's assignments into it here to build a
// list-wide lens would corrupt those flows. A submitted count is just
// `status === 'submitted'` on the assignment row itself (set
// atomically alongside the submissions-table insert — see
// assignment-actions.js submitAssignment / counting-actions.js
// submitMyCount), so no separate submissions fetch is needed.
async function loadRoundAuditorProgress(rounds) {
  const { sbClient } = Store.getState();
  const entries = await Promise.all(rounds.map(async (round) => {
    const raw = await Repo.fetchAssignmentsByRound(sbClient, round.id);
    const active = raw.filter(a => a.status !== 'revoked');
    const submitted = active.filter(a => a.status === 'submitted').length;
    return [round.id, { submitted, total: active.length }];
  }));
  return new Map(entries);
}

// Same shape, but built from an already-fetched assignments list
// (e.g. Individual Assignments' per-engagement fetch, which already
// pulls every round's assignments in one go) — avoids a second
// redundant fetch when the caller already has the data.
function roundAuditorProgressFromAssignments(rounds, assignments) {
  const map = new Map();
  rounds.forEach((round) => {
    const active = assignments.filter(a => a.roundId === round.id && a.status !== 'revoked');
    const submitted = active.filter(a => a.status === 'submitted').length;
    map.set(round.id, { submitted, total: active.length });
  });
  return map;
}


export const DashboardActions = {
  mainAuditorDashboard, subAuditorDashboard, fetchLiveAssignmentSnapshot,
  buildLiveSnapshotRows, filterLiveSnapshotRows, sortLiveSnapshotRows, formatDuration,
  loadRoundAuditorProgress, roundAuditorProgressFromAssignments,
};

export const _testables = { buildLiveSnapshotRows, filterLiveSnapshotRows, sortLiveSnapshotRows, formatDuration };
