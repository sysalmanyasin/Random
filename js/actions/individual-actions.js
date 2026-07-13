import { Repo } from '../repository.js';
import { Store } from '../store.js';
import { Bus } from './bus.js';
import { logAudit } from './audit-log-actions.js';
import { ItemKey } from './item-key.js';
import { EngagementActions } from './engagement-actions.js';
import { CompileActions } from './compile-actions.js';
import { InventoryActions } from './inventory-actions.js';

/* ══════════════════════════════════════════════════════════════
   FLOOR 3 — ACTIONS / individual-actions.js
   Staff self-service audits — any logged-in Sub-Auditor can pick a
   saved Template or one/several companies and start counting
   immediately, without the Main Auditor building an engagement for
   them first. Every one of these lands as its own standalone round
   inside one evergreen, auto-rolling monthly engagement
   ("Individual Assignments — <Month>") — see getOrCreateCurrentIndividualEngagement.

   Deliberately NOT built on the Team Audit "round family" concept:
   a family exists so coordinated rounds can wait on each other before
   the next one starts, which is exactly wrong here — these are
   independent, concurrent, unrelated picks. Each gets a unique
   roundNumber instead, which trivially makes it its own one-member
   "family" to every existing family-aware function (compile gating,
   isFamilyFullyCompiled) without any of them needing special-casing.

   No overlap-warning here on purpose (see the design conversation this
   was built from) — that warning exists for a Main Auditor's deliberate
   choice to double-check something; for a staff self-pick it would
   just be confusing noise about something they didn't cause and can't
   act on. A genuine duplicate still gets caught by the ordinary
   cross-round-conflict detector at compile time either way.
   ══════════════════════════════════════════════════════════════ */

function _currentMonthKey(d) {
  const date = d || new Date();
  return date.getFullYear() + '-' + String(date.getMonth() + 1).padStart(2, '0');
}
function _monthLabel(monthKey) {
  const [y, m] = monthKey.split('-').map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
}

// Find-or-create this month's Individual Assignments engagement.
// Deliberately never touches `status` for the rollover (see below) —
// scope_month alone is what routes NEW picks to the right pool.
// "Closed" (in the Main Auditor's grouped view) is computed purely by
// comparing scope_month to the current month, not by a status flag —
// because `status='closed'` here would mean something it doesn't
// anywhere else in the app: is_engagement_open() (schema.sql) gates
// submission inserts/updates on the ENGAGEMENT being open, so closing
// last month's pool the instant the calendar flips would retroactively
// block anyone still finishing a round they started before the
// rollover. scope_month-based routing gets the same "new month = new
// pool" behavior without ever needing to cut anyone off mid-count.
async function getOrCreateCurrentIndividualEngagement() {
  const { sbClient } = Store.getState();
  if (!sbClient) { Bus.emit('toast', { msg: 'Not connected yet — try again in a moment', kind: 'error' }); return null; }
  await EngagementActions.loadEngagementsList();
  const { engagements } = Store.getState();
  const monthKey = _currentMonthKey();

  const current = engagements.find(e => e.scope.type === 'individual' && e.scope.month === monthKey);
  if (current) return current;

  try {
    const engagement = await Repo.insertEngagement(sbClient, {
      name: 'Individual Assignments — ' + _monthLabel(monthKey),
      status: 'open',
      scope: { type: 'individual', companies: [], month: monthKey },
    });
    const newList = Store.getState().engagements.concat([engagement]);
    Store.setState({ engagements: newList });
    logAudit('engagement:individualPoolCreated', { engagementId: engagement.id, month: monthKey });
    Bus.emit('engagements:changed', newList);
    return engagement;
  } catch (err) {
    // A unique index on (scope_month) where scope_type='individual'
    // (schema.sql) means two people opening this at the same instant
    // can't both succeed — the loser here just re-reads what the
    // winner created instead of erroring out.
    if (String(err.message || '').toLowerCase().includes('duplicate') || String(err.code) === '23505') {
      await EngagementActions.loadEngagementsList();
      const retry = Store.getState().engagements.find(e => e.scope.type === 'individual' && e.scope.month === monthKey);
      if (retry) return retry;
    }
    Bus.emit('toast', { msg: 'Could not open this month\'s Individual Assignments: ' + err.message, kind: 'error' });
    return null;
  }
}

// Purely for display (e.g. a "closed" badge in the Main Auditor's
// grouped view) — never used to gate anything, since routing NEW picks
// to the right pool is already handled by
// getOrCreateCurrentIndividualEngagement picking by exact scope_month
// match, not by this.
function isCurrentIndividualMonth(engagement) {
  return !!engagement && engagement.scope && engagement.scope.type === 'individual' && engagement.scope.month === _currentMonthKey();
}

// Rule #1: one open self-assignment per auditor, submit-first. Checked
// fresh against the DB (not just whatever's cached in Store) since two
// tabs/devices under the same login is exactly the case this has to
// catch. Returns the open assignment if one exists, else null.
async function findMyOpenIndividualAssignment(engagementId, auditorId) {
  const { sbClient } = Store.getState();
  const rounds = await Repo.fetchRoundsByEngagement(sbClient, engagementId);
  for (const round of rounds) {
    const assignments = await Repo.fetchAssignmentsByRound(sbClient, round.id);
    const mine = assignments.find(a => a.auditorId === auditorId && (a.status === 'assigned' || a.status === 'counting'));
    if (mine) return mine;
  }
  return null;
}

// selection: { source: 'template', templateId, name } | { source: 'template', codes, name } (an ad-hoc/random-sample selection, not a saved template) | { source: 'companies', companies: [...] }
async function startIndividualAssignment(selection) {
  const { sbClient, products, currentAuditorId, currentAuditorName } = Store.getState();
  if (!currentAuditorId) { Bus.emit('toast', { msg: 'Not logged in', kind: 'error' }); return null; }

  const engagement = await getOrCreateCurrentIndividualEngagement();
  if (!engagement) return null;

  const existing = await findMyOpenIndividualAssignment(engagement.id, currentAuditorId);
  if (existing) {
    Bus.emit('toast', { msg: 'Finish and submit your current individual audit before starting a new one.', kind: 'error' });
    return null;
  }

  let itemSnapshot, label;
  if (selection.source === 'companies') {
    if (!selection.companies || selection.companies.length === 0) { Bus.emit('toast', { msg: 'Pick at least one company', kind: 'error' }); return null; }
    itemSnapshot = ItemKey.snapshotScopeItems(products, selection.companies);
    label = selection.companies.join(', ');
  } else if (selection.source === 'template') {
    if (!selection.codes || selection.codes.length === 0) { Bus.emit('toast', { msg: 'That template has no product codes', kind: 'error' }); return null; }
    itemSnapshot = ItemKey.snapshotSelectedItems(products, selection.codes);
    label = selection.name || 'Template';
  } else {
    Bus.emit('toast', { msg: 'Choose a template or at least one company first', kind: 'error' });
    return null;
  }
  if (itemSnapshot.length === 0) { Bus.emit('toast', { msg: 'None of that matches current inventory', kind: 'error' }); return null; }

  try {
    const { rounds } = Store.getState();
    const allEngagementRounds = await Repo.fetchRoundsByEngagement(sbClient, engagement.id);
    const nextRoundNumber = allEngagementRounds.length === 0 ? 1 : Math.max(...allEngagementRounds.map(r => r.roundNumber)) + 1;

    const round = await Repo.insertRound(sbClient, {
      engagementId: engagement.id, roundNumber: nextRoundNumber, roundSuffix: null,
      unit: 'item', state: 'counting', baseRoundId: null, itemSnapshot,
    });
    const companies = [...new Set(itemSnapshot.map(it => it.company))];
    const [assignment] = await Repo.insertAssignments(sbClient, [{
      roundId: round.id, engagementId: engagement.id, auditorId: currentAuditorId, auditorName: currentAuditorName,
      unit: 'item', companies, items: itemSnapshot, method: 'individual-self-pick', status: 'assigned',
    }]);

    logAudit('individual:assignmentStarted', {
      engagementId: engagement.id, roundId: round.id, assignmentId: assignment.id,
      label, itemCount: itemSnapshot.length, source: selection.source,
    });
    Bus.emit('toast', { msg: 'Started — ' + itemSnapshot.length + ' item(s)', kind: 'success' });
    return assignment;
  } catch (err) {
    Bus.emit('toast', { msg: 'Could not start this audit: ' + err.message, kind: 'error' });
    return null;
  }
}

// Called right after a real Team-style submitMyAssignment() succeeds —
// see counting-actions.js/sub-pages.js wiring. An individual round has
// exactly one assignment by construction, so the instant it's
// submitted there is nothing left to wait on: compile immediately
// instead of waiting for the Main Auditor to notice and click Compile,
// so the result shows up in reports right away.
// Checks assignment.method rather than looking up the engagement,
// deliberately: a Sub-Auditor's session never loads the engagements
// list the normal way (that's Main-Auditor-only data outside the
// narrow "individual" carve-out — see schema.sql RLS), so this can't
// depend on Store.engagements being populated the way a Main
// Auditor's session has it. The method tag set at creation time
// (startIndividualAssignment above) is enough on its own.
//
// The merge/variance computation reuses buildMergedItems exactly as
// compileRound() does (compile-actions.js) — same rule, same code —
// but the actual WRITE goes through compile_individual_round(), a
// security-definer RPC, rather than compileRound()'s direct table
// writes: a Sub-Auditor's client has no INSERT on compiled_rounds or
// UPDATE on rounds at all (that stays Main-Auditor-only), so this is
// the one privileged step that has to cross a real permission
// boundary rather than just a Store-population one.
async function autoCompileIfIndividual(assignment) {
  if (!assignment || assignment.method !== 'individual-self-pick') return;
  const { sbClient } = Store.getState();
  const round = await Repo.fetchRoundById(sbClient, assignment.roundId);
  if (!round) return;
  const roundAssignments = await Repo.fetchAssignmentsByRound(sbClient, assignment.roundId);
  const roundSubmissions = await Repo.fetchSubmissionsByRound(sbClient, assignment.roundId);
  const { mergedItems, overlapWarnings } = CompileActions.buildMergedItems(roundAssignments, roundSubmissions);
  const variances = mergedItems.filter(r => r.countedQty !== r.systemQty); // uncounted=0 rule — see compile-actions.js compileRound for the identical line
  try {
    await Repo.compileIndividualRoundRPC(sbClient, assignment.roundId, mergedItems, variances);
    logAudit('individual:autoCompiled', { roundId: assignment.roundId, itemCount: mergedItems.length, varianceCount: variances.length, overlapCount: overlapWarnings.length });
    Bus.emit('toast', { msg: 'Compiled — ' + variances.length + ' variance(s) found', kind: 'success' });
  } catch (err) {
    // Non-fatal by design: the submission itself already succeeded
    // (see the caller in sub-pages.js) — a failed auto-compile just
    // means the Main Auditor compiles it normally later, same as any
    // other round that doesn't get auto-compiled.
    console.error('[Individual] Auto-compile failed (non-fatal — submission already succeeded):', err);
  }
}

// ── Main Auditor's grouped view — data loading ────────────────
// Fetches everything renderIndividualDashboard (engagement-pages.js)
// needs in one call, rather than the page reaching into Repo directly
// — Pages go through Actions in this codebase, never Repository.
async function loadIndividualDashboardData(engagement) {
  const { sbClient } = Store.getState();
  const rounds = await Repo.fetchRoundsByEngagement(sbClient, engagement.id);
  const assignments = (await Promise.all(rounds.map(r => Repo.fetchAssignmentsByRound(sbClient, r.id)))).flat();
  const compiledRounds = (await Promise.all(
    rounds.filter(r => r.state === 'compiled').map(r => Repo.fetchCompiledRoundsByRound(sbClient, r.id))
  )).flat();
  return { rounds, assignments, compiledRounds };
}

// ── Main Auditor's grouped view ──────────────────────────────
// Flattens every round in the Individual pool into one list, grouped
// by auditor name (A–Z), each entry showing what they picked and the
// outcome once compiled. Pure — takes whatever's already loaded in
// Store for that engagement, same as every other dashboard view.
function groupIndividualAssignmentsByStaff(rounds, assignments, compiledRounds) {
  const byStaff = new Map();
  rounds.forEach(round => {
    const roundAssignments = assignments.filter(a => a.roundId === round.id);
    roundAssignments.forEach(a => {
      const compiled = compiledRounds.find(c => c.roundId === round.id);
      const entry = {
        roundId: round.id,
        assignmentId: a.id,
        label: a.companies.length > 0 ? a.companies.join(', ') : (a.items.length + ' item(s)'),
        varianceCount: compiled ? compiled.variances.length : null,
        status: round.state,
        date: round.createdAt,
      };
      if (!byStaff.has(a.auditorName)) byStaff.set(a.auditorName, []);
      byStaff.get(a.auditorName).push(entry);
    });
  });
  return [...byStaff.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([auditorName, items]) => ({ auditorName, items: items.sort((a, b) => new Date(b.date) - new Date(a.date)) }));
}

// ── Recompile N rounds → a new verification engagement ───────
// Reuses compile-actions.js's mergeFamilyCompiled as-is: despite the
// name, it only ever operates on whatever list of roundIds it's
// given — it has no actual "same family" requirement baked in — so an
// arbitrary Main-Auditor-picked set of individual rounds merges
// company-wise/deduplicated exactly the same way a real round family
// does. The merged result is saved as a Template (reusing the
// existing Templates feature outright) so starting the follow-up
// verification engagement is just the ordinary Team launch path.
async function recompileIndividualRounds(roundIds, templateName) {
  if (!roundIds || roundIds.length === 0) { Bus.emit('toast', { msg: 'Select at least one round to recompile', kind: 'error' }); return null; }
  const { compiledRounds } = Store.getState();
  const merged = CompileActions.mergeFamilyCompiled(roundIds, compiledRounds);
  if (merged.variances.length === 0) { Bus.emit('toast', { msg: 'No variances found across the selected rounds', kind: 'error' }); return null; }

  const codes = merged.variances.map(v => v.code).filter(Boolean);
  InventoryActions.selectManyForInventory(codes, true);
  const template = await InventoryActions.saveSelectionAsTemplate(templateName);
  if (template) {
    logAudit('individual:recompiled', { roundIds, templateId: template.id, itemCount: codes.length });
    Bus.emit('toast', { msg: 'Saved ' + codes.length + ' item(s) as template "' + templateName + '" — start a new engagement from it whenever ready', kind: 'success' });
  }
  return template;
}

export const IndividualActions = {
  getOrCreateCurrentIndividualEngagement, findMyOpenIndividualAssignment, startIndividualAssignment,
  autoCompileIfIndividual, groupIndividualAssignmentsByStaff, recompileIndividualRounds, isCurrentIndividualMonth,
  loadIndividualDashboardData,
};

export const _testables = { _currentMonthKey, _monthLabel, groupIndividualAssignmentsByStaff, isCurrentIndividualMonth };
