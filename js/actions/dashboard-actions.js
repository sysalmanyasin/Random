import { Store } from '../store.js';
import { Repo } from '../repository.js';

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
    return {
      auditorName: a.auditorName,
      assignmentId: a.id,
      itemCount: total,
      counted,
      pct: total > 0 ? Math.round((counted / total) * 100) : 0,
      status: a.status,
      submitted: roundSubmissions.some(s => s.assignmentId === a.id),
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
  };
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

export const DashboardActions = { mainAuditorDashboard, subAuditorDashboard, fetchLiveAssignmentSnapshot };
