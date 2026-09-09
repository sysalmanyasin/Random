import { Repo } from '../repository.js';
import { Store } from '../store.js';
import { Bus } from './bus.js';
import { logAudit } from './audit-log-actions.js';

/* ══════════════════════════════════════════════════════════════
   FLOOR 3 — ACTIONS / variance-edit-actions.js
   Deputy/Sub proposes a corrected count against ANY item in a
   compiled round's variance report; Main approves or rejects.
   Approval never touches the original submission — it writes to
   rounds.corrections, which compile-actions.js folds into the merge
   on the NEXT recompile. Nothing here mutates a compiled round
   directly, and nothing here is a shortcut around compileRound().
   ══════════════════════════════════════════════════════════════ */

async function suggestVarianceEdit(compiledRound, row, suggestedQty, reason) {
  const { sbClient, currentAuditorId, currentAuditorName } = Store.getState();
  if (suggestedQty === row.countedQty) {
    Bus.emit('toast', { msg: 'That matches the current count already', kind: 'error' });
    return null;
  }
  try {
    const s = await Repo.insertVarianceSuggestion(sbClient, {
      roundId: compiledRound.roundId, compiledRoundId: compiledRound.id, engagementId: compiledRound.engagementId,
      itemKey: row.itemKey, company: row.company, code: row.code, name: row.name,
      systemQty: row.systemQty, previousCountedQty: row.countedQty, suggestedQty, reason: reason || '',
      suggestedBy: currentAuditorId, suggestedByName: currentAuditorName,
    });
    logAudit('varianceSuggestion:created', {
      roundId: compiledRound.roundId, itemKey: row.itemKey, company: row.company, name: row.name,
      from: row.countedQty, to: suggestedQty, reason: reason || '',
    });
    const suggestions = Store.getState().suggestions.concat([s]);
    Store.setState({ suggestions });
    Bus.emit('suggestions:changed', suggestions);
    Bus.emit('toast', { msg: 'Correction sent to Main Auditor for approval', kind: 'success' });
    return s;
  } catch (err) {
    Bus.emit('toast', { msg: 'Could not send suggestion: ' + err.message, kind: 'error' });
    return null;
  }
}

async function loadSuggestionsForRound(roundId) {
  const { sbClient } = Store.getState();
  const suggestions = await Repo.fetchSuggestionsByRound(sbClient, roundId);
  Store.setState({ suggestions });
  Bus.emit('suggestions:changed', suggestions);
  return suggestions;
}

function pendingSuggestionCount(roundId) {
  const { suggestions } = Store.getState();
  return suggestions.filter(s => s.roundId === roundId && s.status === 'pending').length;
}

// Approve = record the decision + fold the corrected qty into
// rounds.corrections. It does NOT recompile the round itself — the
// Main Auditor still taps "Recompile" (existing compileRound flow) to
// actually apply it, so several approvals in a row don't each trigger
// a separate compiled_rounds write.
async function approveSuggestion(suggestionId) {
  const { sbClient, role, currentAuditorId, currentAuditorName, suggestions } = Store.getState();
  if (role !== 'main') {
    Bus.emit('toast', { msg: 'Only the Main Auditor can approve corrections', kind: 'error' });
    return null;
  }
  const s = suggestions.find(x => x.id === suggestionId);
  if (!s || s.status !== 'pending') return null;
  try {
    const updated = await Repo.updateSuggestionStatus(sbClient, suggestionId, 'approved', currentAuditorId, currentAuditorName);
    await Repo.applyRoundCorrection(sbClient, s.roundId, s.itemKey, {
      countedQty: s.suggestedQty, approvedBy: currentAuditorId, approvedByName: currentAuditorName,
      approvedAt: new Date().toISOString(), suggestionId: s.id,
    });
    logAudit('varianceSuggestion:approved', {
      roundId: s.roundId, itemKey: s.itemKey, company: s.company, name: s.name,
      appliedQty: s.suggestedQty, suggestedBy: s.suggestedByName,
    });
    const next = suggestions.map(x => x.id === suggestionId ? updated : x);
    Store.setState({ suggestions: next });
    Bus.emit('suggestions:changed', next);
    Bus.emit('toast', { msg: 'Approved — recompile the round to apply it', kind: 'success' });
    return updated;
  } catch (err) {
    Bus.emit('toast', { msg: 'Could not approve: ' + err.message, kind: 'error' });
    return null;
  }
}

async function rejectSuggestion(suggestionId, note) {
  const { sbClient, role, currentAuditorId, currentAuditorName, suggestions } = Store.getState();
  if (role !== 'main') {
    Bus.emit('toast', { msg: 'Only the Main Auditor can reject corrections', kind: 'error' });
    return null;
  }
  const s = suggestions.find(x => x.id === suggestionId);
  if (!s || s.status !== 'pending') return null;
  try {
    const updated = await Repo.updateSuggestionStatus(sbClient, suggestionId, 'rejected', currentAuditorId, currentAuditorName);
    logAudit('varianceSuggestion:rejected', {
      roundId: s.roundId, itemKey: s.itemKey, company: s.company, name: s.name, note: note || '',
    });
    const next = suggestions.map(x => x.id === suggestionId ? updated : x);
    Store.setState({ suggestions: next });
    Bus.emit('suggestions:changed', next);
    Bus.emit('toast', { msg: 'Suggestion rejected', kind: 'success' });
    return updated;
  } catch (err) {
    Bus.emit('toast', { msg: 'Could not reject: ' + err.message, kind: 'error' });
    return null;
  }
}

export const VarianceEditActions = {
  suggestVarianceEdit, loadSuggestionsForRound, pendingSuggestionCount,
  approveSuggestion, rejectSuggestion,
};
