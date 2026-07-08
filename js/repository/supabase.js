/* ══════════════════════════════════════════════════════════════
   FLOOR 1 — REPOSITORY / supabase.js
   The only module that talks to Supabase. Multi-auditor data
   (engagements/rounds/assignments/submissions/staff) now lives
   here instead of IndexedDB + Dropbox file drops — Dropbox is
   still used, but only for inventory sync (repository/dropbox.js,
   unchanged). RLS on the Supabase side is what actually enforces
   Sub-Auditor isolation now; this file just shapes the requests.
   ══════════════════════════════════════════════════════════════ */

function buildSupabaseClient(url, anonKey) {
  if (typeof supabase === 'undefined' || !url || !anonKey) return null;
  return supabase.createClient(url, anonKey);
}

function _phoneToInternalEmail(phone) {
  const digitsOnly = String(phone).replace(/\D/g, '');
  return `${digitsOnly}@staff.internal`;
}

// ── Auth ──
async function signInWithPhonePin(client, phone, pin) {
  return client.auth.signInWithPassword({ email: _phoneToInternalEmail(phone), password: pin });
}
async function signOut(client) { return client.auth.signOut(); }
async function getSession(client) { const { data } = await client.auth.getSession(); return data.session; }
function onAuthStateChange(client, cb) { return client.auth.onAuthStateChange((_event, session) => cb(session)); }

// ── Admin actions (proxied through the Edge Function — never uses
//    a service-role key in the browser) ──
async function callAdminAction(client, action, payload) {
  const { data, error } = await client.functions.invoke('admin-actions', { body: { action, ...payload } });
  if (error) throw error;
  if (data && data.error) throw new Error(data.error);
  return data;
}

// ── Staff ──
function _rowToStaff(row) {
  return { id: row.id, name: row.name, phone: row.phone, role: row.role, accessExpiresAt: row.access_expires_at, createdAt: row.created_at };
}
async function fetchMyStaffProfile(client, userId) {
  const { data, error } = await client.from('staff').select('*').eq('id', userId).single();
  if (error) throw error;
  return _rowToStaff(data);
}
async function fetchAllStaff(client) {
  const { data, error } = await client.from('staff').select('*').order('created_at', { ascending: true });
  if (error) throw error;
  return (data || []).map(_rowToStaff);
}
async function setStaffAccessExpiry(client, staffId, accessExpiresAt) {
  // Plain table update — allowed by RLS for the Main Auditor directly,
  // no Edge Function/service-role needed for this one.
  const { error } = await client.from('staff').update({ access_expires_at: accessExpiresAt }).eq('id', staffId);
  if (error) throw error;
}

// ── Engagements ──
function _rowToEngagement(row) {
  return { id: row.id, name: row.name, status: row.status, scope: { type: row.scope_type, companies: row.scope_companies || [] }, createdAt: row.created_at };
}
async function insertEngagement(client, e) {
  const { data, error } = await client.from('engagements').insert({
    name: e.name, status: e.status, scope_type: e.scope.type, scope_companies: e.scope.companies,
  }).select().single();
  if (error) throw error;
  return _rowToEngagement(data);
}
async function updateEngagementStatus(client, id, status) {
  const { error } = await client.from('engagements').update({ status }).eq('id', id);
  if (error) throw error;
}
// Expanding scope.companies mid-engagement (Main Auditor adds newly
// discovered companies without disturbing existing rounds/history).
async function updateEngagementScope(client, id, scope) {
  const { error } = await client.from('engagements').update({ scope_type: scope.type, scope_companies: scope.companies }).eq('id', id);
  if (error) throw error;
}
// Deletes the engagement row outright. Rounds, assignments, submissions,
// compiled_rounds, and final_snapshots all have ON DELETE CASCADE on
// engagement_id in the schema, so this cleans up everything in one go.
async function deleteEngagement(client, id) {
  const { error } = await client.from('engagements').delete().eq('id', id);
  if (error) throw error;
}
async function fetchEngagements(client) {
  const { data, error } = await client.from('engagements').select('*').order('created_at', { ascending: false });
  if (error) throw error;
  return (data || []).map(_rowToEngagement);
}

// ── Rounds ──
function _rowToRound(row) {
  return {
    id: row.id, engagementId: row.engagement_id, roundNumber: row.round_number, roundSuffix: row.round_suffix || null, unit: row.unit,
    state: row.state, baseRoundId: row.base_round_id, itemSnapshot: row.item_snapshot || [], createdAt: row.created_at,
    lockedAt: row.locked_at, compiledAt: row.compiled_at, finalizedAt: row.finalized_at,
  };
}
async function insertRound(client, r) {
  const { data, error } = await client.from('rounds').insert({
    engagement_id: r.engagementId, round_number: r.roundNumber, round_suffix: r.roundSuffix || null, unit: r.unit, state: r.state, base_round_id: r.baseRoundId,
    item_snapshot: r.itemSnapshot || [],
  }).select().single();
  if (error) throw error;
  return _rowToRound(data);
}
async function updateRound(client, id, patch) {
  const dbPatch = {};
  if (patch.state !== undefined) dbPatch.state = patch.state;
  if (patch.lockedAt !== undefined) dbPatch.locked_at = patch.lockedAt ? new Date(patch.lockedAt).toISOString() : null;
  if (patch.compiledAt !== undefined) dbPatch.compiled_at = patch.compiledAt ? new Date(patch.compiledAt).toISOString() : null;
  if (patch.finalizedAt !== undefined) dbPatch.finalized_at = patch.finalizedAt ? new Date(patch.finalizedAt).toISOString() : null;
  const { error } = await client.from('rounds').update(dbPatch).eq('id', id);
  if (error) throw error;
}
async function fetchRoundsByEngagement(client, engagementId) {
  const { data, error } = await client.from('rounds').select('*').eq('engagement_id', engagementId).order('round_number', { ascending: true });
  if (error) throw error;
  return (data || []).map(_rowToRound);
}

// ── Assignments ──
function _rowToAssignment(row) {
  return {
    id: row.id, roundId: row.round_id, engagementId: row.engagement_id, auditorId: row.auditor_id,
    auditorName: row.auditor_name, unit: row.unit, companies: row.companies || [], items: row.items || [],
    method: row.method, status: row.status, progressCount: row.progress_count || 0,
    liveSnapshot: row.live_snapshot || {}, createdAt: row.created_at,
  };
}
async function insertAssignments(client, list) {
  const rows = list.map(a => ({
    round_id: a.roundId, engagement_id: a.engagementId, auditor_id: a.auditorId, auditor_name: a.auditorName,
    unit: a.unit, companies: a.companies, items: a.items, method: a.method, status: a.status,
  }));
  const { data, error } = await client.from('assignments').insert(rows).select();
  if (error) throw error;
  return (data || []).map(_rowToAssignment);
}
async function updateAssignment(client, id, patch) {
  const dbPatch = {};
  if (patch.status !== undefined) dbPatch.status = patch.status;
  if (patch.companies !== undefined) dbPatch.companies = patch.companies;
  if (patch.items !== undefined) dbPatch.items = patch.items;
  if (patch.method !== undefined) dbPatch.method = patch.method;
  if (patch.progressCount !== undefined) dbPatch.progress_count = patch.progressCount;
  if (patch.liveSnapshot !== undefined) dbPatch.live_snapshot = patch.liveSnapshot;
  const { error } = await client.from('assignments').update(dbPatch).eq('id', id);
  if (error) throw error;
}
async function fetchAssignmentsByRound(client, roundId) {
  const { data, error } = await client.from('assignments').select('*').eq('round_id', roundId);
  if (error) throw error;
  return (data || []).map(_rowToAssignment);
}
// Single fresh row, bypassing the Store's cache — used for the Main
// Auditor's "tap the progress bar" live-snapshot popup, which is
// explicitly a manual refresh/re-fetch rather than a live subscription.
async function fetchAssignmentById(client, id) {
  const { data, error } = await client.from('assignments').select('*').eq('id', id).single();
  if (error) throw error;
  return _rowToAssignment(data);
}
// The one query a Sub-Auditor's device actually runs — RLS guarantees
// this can only ever return assignments that belong to them.
async function fetchMyAssignments(client, userId) {
  const { data, error } = await client.from('assignments').select('*').eq('auditor_id', userId).neq('status', 'revoked');
  if (error) throw error;
  return (data || []).map(_rowToAssignment);
}

// ── Submissions ──
function _rowToSubmission(row) {
  return {
    id: row.id, assignmentId: row.assignment_id, roundId: row.round_id, engagementId: row.engagement_id,
    auditorId: row.auditor_id, auditorName: row.auditor_name, counts: row.counts || {}, notes: row.notes || {},
    confirms: row.confirms || {}, submittedAt: row.submitted_at,
  };
}
// One live row per assignment — upsert on (assignment_id, auditor_id),
// so a resubmission updates the same row (with a fresh submitted_at)
// instead of needing separate conflict-detection bookkeeping.
async function upsertSubmission(client, s) {
  const { data, error } = await client.from('submissions').upsert({
    assignment_id: s.assignmentId, round_id: s.roundId, engagement_id: s.engagementId,
    auditor_id: s.auditorId, auditor_name: s.auditorName, counts: s.counts, notes: s.notes, confirms: s.confirms || {},
    submitted_at: new Date().toISOString(),
  }, { onConflict: 'assignment_id,auditor_id' }).select().single();
  if (error) throw error;
  return _rowToSubmission(data);
}
async function fetchSubmissionsByRound(client, roundId) {
  const { data, error } = await client.from('submissions').select('*').eq('round_id', roundId);
  if (error) throw error;
  return (data || []).map(_rowToSubmission);
}
async function fetchMySubmission(client, assignmentId, userId) {
  const { data, error } = await client.from('submissions').select('*').eq('assignment_id', assignmentId).eq('auditor_id', userId).maybeSingle();
  if (error) throw error;
  return data ? _rowToSubmission(data) : null;
}

// ── Compiled rounds / Final snapshots / Audit log ──
function _rowToCompiled(row) {
  return {
    id: row.id, roundId: row.round_id, engagementId: row.engagement_id, mergedItems: row.merged_items || [],
    variances: row.variances || [], missingAssignmentIds: row.missing_assignment_ids || [],
    compiledWithMissing: row.compiled_with_missing, compiledAt: row.compiled_at,
  };
}
async function insertCompiledRound(client, c) {
  const { data, error } = await client.from('compiled_rounds').insert({
    round_id: c.roundId, engagement_id: c.engagementId, merged_items: c.mergedItems, variances: c.variances,
    missing_assignment_ids: c.missingAssignmentIds, compiled_with_missing: c.compiledWithMissing,
  }).select().single();
  if (error) throw error;
  return _rowToCompiled(data);
}
async function fetchCompiledRoundsByRound(client, roundId) {
  const { data, error } = await client.from('compiled_rounds').select('*').eq('round_id', roundId).order('compiled_at', { ascending: true });
  if (error) throw error;
  return (data || []).map(_rowToCompiled);
}

function _rowToSnapshot(row) {
  return { id: row.id, engagementId: row.engagement_id, finalInventory: row.final_inventory, auditTrail: row.audit_trail, report: row.report, generatedAt: row.generated_at };
}
async function insertFinalSnapshot(client, s) {
  const { data, error } = await client.from('final_snapshots').insert({
    engagement_id: s.engagementId, final_inventory: s.finalInventory, audit_trail: s.auditTrail, report: s.report,
  }).select().single();
  if (error) throw error;
  return _rowToSnapshot(data);
}
async function fetchFinalSnapshotsByEngagement(client, engagementId) {
  const { data, error } = await client.from('final_snapshots').select('*').eq('engagement_id', engagementId);
  if (error) throw error;
  return (data || []).map(_rowToSnapshot);
}

async function insertAuditLogEntry(client, entry) {
  const { error } = await client.from('audit_log').insert({ actor: entry.actor, role: entry.role, action: entry.action, details: entry.details });
  if (error) throw error; // caller decides whether to swallow (offline) or surface
}
async function fetchAuditLog(client) {
  const { data, error } = await client.from('audit_log').select('*').order('ts', { ascending: true });
  if (error) throw error;
  return (data || []).map(row => ({ id: row.id, actor: row.actor, role: row.role, action: row.action, details: row.details, ts: row.ts }));
}

export const SupabaseRepo = {
  buildSupabaseClient, signInWithPhonePin, signOut, getSession, onAuthStateChange, callAdminAction,
  fetchMyStaffProfile, fetchAllStaff, setStaffAccessExpiry,
  insertEngagement, updateEngagementStatus, updateEngagementScope, deleteEngagement, fetchEngagements,
  insertRound, updateRound, fetchRoundsByEngagement,
  insertAssignments, updateAssignment, fetchAssignmentsByRound, fetchAssignmentById, fetchMyAssignments,
  upsertSubmission, fetchSubmissionsByRound, fetchMySubmission,
  insertCompiledRound, fetchCompiledRoundsByRound,
  insertFinalSnapshot, fetchFinalSnapshotsByEngagement,
  insertAuditLogEntry, fetchAuditLog,
};
