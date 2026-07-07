import { Store } from '../store.js';

/* ══════════════════════════════════════════════════════════════
   FLOOR 3 — ACTIONS / dashboard-actions.js
   Blueprint §Dashboard. Pure read-only aggregate queries over the
   Store — no mutation, no Bus emission. Pages call these to get
   numbers to render; Components just render whatever they're given.
   ══════════════════════════════════════════════════════════════ */

function mainAuditorDashboard(engagementId) {
  const { engagements, rounds, assignments, submissions, compiledRounds } = Store.getState();
  const engagement = engagements.find(e => e.id === engagementId);
  if (!engagement) return null;
  const engRounds = rounds.filter(r => r.engagementId === engagementId).sort((a, b) => a.roundNumber - b.roundNumber);
  const latestRound = engRounds[engRounds.length - 1] || null;
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

  const companyStatus = engagement.scope.companies.map(company => ({
    company,
    assigned: roundAssignments.some(a => a.companies.includes(company)),
    auditor: (roundAssignments.find(a => a.companies.includes(company)) || {}).auditorName || '—',
  }));

  return {
    engagementStatus: engagement.status,
    roundStatus: latestRound ? { number: latestRound.roundNumber, state: latestRound.state } : null,
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

export const DashboardActions = { mainAuditorDashboard, subAuditorDashboard };
