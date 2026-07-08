import { Repo } from '../repository.js';
import { Store } from '../store.js';
import { Bus } from './bus.js';
import { logAudit } from './audit-log-actions.js';

/* ══════════════════════════════════════════════════════════════
   FLOOR 3 — ACTIONS / engagement-actions.js
   Blueprint §Engagement + §Scope Selection — now persisted in
   Supabase (repository/supabase.js) instead of local IndexedDB.
   Only the Main Auditor ever calls these; RLS enforces that even
   if a Sub-Auditor's client somehow tried to.
   ══════════════════════════════════════════════════════════════ */

async function loadEngagementsList() {
  const { sbClient } = Store.getState();
  if (!sbClient) return [];
  const engagements = await Repo.fetchEngagements(sbClient);
  Store.setState({ engagements });
  Bus.emit('engagements:changed', engagements);
  return engagements;
}

async function createEngagement(name, scope) {
  const { products, sbClient } = Store.getState();
  const allCompanies = [...new Set(products.map(m => m.company))];

  let normalizedScope = scope || { type: 'full', companies: [] };
  if (normalizedScope.type === 'full') normalizedScope = { type: 'full', companies: allCompanies };
  if ((normalizedScope.type === 'selected' || normalizedScope.type === 'single') && (!normalizedScope.companies || normalizedScope.companies.length === 0)) {
    Bus.emit('toast', { msg: 'Pick at least one company for this scope', kind: 'error' });
    return null;
  }
  if (normalizedScope.type === 'single') normalizedScope.companies = normalizedScope.companies.slice(0, 1);

  try {
    const engagement = await Repo.insertEngagement(sbClient, {
      name: name && name.trim() ? name.trim() : 'Engagement ' + new Date().toLocaleDateString('en-PK'),
      status: 'open',
      scope: normalizedScope,
    });
    const engagements = Store.getState().engagements.concat([engagement]);
    Store.setState({ engagements, currentEngagementId: engagement.id, rounds: [], assignments: [], submissions: [], compiledRounds: [] });
    logAudit('engagement:created', { engagementId: engagement.id, name: engagement.name, scope: normalizedScope });
    Bus.emit('engagements:changed', engagements);
    Bus.emit('engagement:opened', engagement);
    Bus.emit('toast', { msg: 'Engagement "' + engagement.name + '" created', kind: 'success' });
    return engagement;
  } catch (err) {
    Bus.emit('toast', { msg: 'Could not create engagement: ' + err.message, kind: 'error' });
    return null;
  }
}

async function openEngagement(engagementId) {
  const { sbClient, engagements } = Store.getState();
  const engagement = engagements.find(e => e.id === engagementId);
  if (!engagement) { Bus.emit('toast', { msg: 'Engagement not found', kind: 'error' }); return; }
  const rounds = await Repo.fetchRoundsByEngagement(sbClient, engagementId);
  Store.setState({ currentEngagementId: engagementId, rounds, assignments: [], submissions: [] });
  Bus.emit('engagement:opened', engagement);
  Bus.emit('rounds:changed', rounds);
}

function closeEngagementView() {
  Store.setState({ currentEngagementId: null, rounds: [], assignments: [], submissions: [] });
  Bus.emit('engagement:closed', {});
}

function archiveEngagement(engagementId) { return setEngagementStatus(engagementId, 'archived'); }
function reopenEngagement(engagementId) { return setEngagementStatus(engagementId, 'open'); }
function closeEngagementPermanently(engagementId) {
  if (!confirm('Close this engagement? It will be marked closed but kept for audit trail purposes.')) return;
  return setEngagementStatus(engagementId, 'closed');
}

async function setEngagementStatus(engagementId, status) {
  const { engagements, sbClient } = Store.getState();
  const eng = engagements.find(e => e.id === engagementId);
  if (!eng) return;
  try {
    await Repo.updateEngagementStatus(sbClient, engagementId, status);
    eng.status = status;
    Store.setState({ engagements: engagements.slice() });
    logAudit('engagement:statusChanged', { engagementId, status });
    Bus.emit('engagements:changed', Store.getState().engagements);
    Bus.emit('toast', { msg: 'Engagement ' + status, kind: 'success' });
  } catch (err) {
    Bus.emit('toast', { msg: 'Could not update engagement: ' + err.message, kind: 'error' });
  }
}

// Permanently deletes the engagement and everything under it (rounds,
// assignments, submissions, compiled rounds, final snapshots — all
// cascade in the database). Unlike Close Permanently, this cannot be
// undone and leaves no audit-trail record of the engagement itself,
// so it asks for the engagement name to be typed back as confirmation.
async function deleteEngagementForever(engagementId) {
  const { engagements, sbClient, currentEngagementId } = Store.getState();
  const eng = engagements.find(e => e.id === engagementId);
  if (!eng) return false;
  const typed = prompt(`This permanently deletes "${eng.name}" and ALL its rounds, assignments, submissions, and reports. This cannot be undone.\n\nType the engagement name to confirm:`);
  if (typed !== eng.name) {
    if (typed !== null) Bus.emit('toast', { msg: 'Name did not match — nothing was deleted', kind: 'error' });
    return false;
  }
  try {
    await Repo.deleteEngagement(sbClient, engagementId);
    const remaining = engagements.filter(e => e.id !== engagementId);
    Store.setState({
      engagements: remaining,
      ...(currentEngagementId === engagementId ? { currentEngagementId: null, rounds: [], assignments: [], submissions: [] } : {}),
    });
    logAudit('engagement:deleted', { engagementId, name: eng.name });
    Bus.emit('engagements:changed', remaining);
    if (currentEngagementId === engagementId) Bus.emit('engagement:closed', {});
    Bus.emit('toast', { msg: 'Engagement deleted permanently', kind: 'success' });
    return true;
  } catch (err) {
    Bus.emit('toast', { msg: 'Could not delete engagement: ' + err.message, kind: 'error' });
    return false;
  }
}

// Adding newly-discovered companies mid-engagement (see round-actions.js
// createSubRound — this just expands scope.companies; the sub-round
// itself is created separately once the scope includes them).
async function addCompaniesToEngagementScope(engagementId, newCompanies) {
  const { engagements, sbClient } = Store.getState();
  const eng = engagements.find(e => e.id === engagementId);
  if (!eng) { Bus.emit('toast', { msg: 'Engagement not found', kind: 'error' }); return null; }
  const toAdd = (newCompanies || []).filter(c => !eng.scope.companies.includes(c));
  if (toAdd.length === 0) { Bus.emit('toast', { msg: 'Those companies are already in scope', kind: 'error' }); return null; }
  const newScope = Object.assign({}, eng.scope, { companies: eng.scope.companies.concat(toAdd) });
  try {
    await Repo.updateEngagementScope(sbClient, engagementId, newScope);
    eng.scope = newScope;
    const newEngagements = engagements.slice();
    Store.setState({ engagements: newEngagements });
    logAudit('engagement:scopeExpanded', { engagementId, addedCompanies: toAdd });
    Bus.emit('engagements:changed', newEngagements);
    Bus.emit('toast', { msg: toAdd.length + ' compan' + (toAdd.length === 1 ? 'y' : 'ies') + ' added to scope', kind: 'success' });
    return eng;
  } catch (err) {
    Bus.emit('toast', { msg: 'Could not update scope: ' + err.message, kind: 'error' });
    return null;
  }
}

export const EngagementActions = {
  loadEngagementsList, createEngagement, openEngagement, closeEngagementView,
  archiveEngagement, reopenEngagement, closeEngagementPermanently, deleteEngagementForever,
  addCompaniesToEngagementScope,
};
