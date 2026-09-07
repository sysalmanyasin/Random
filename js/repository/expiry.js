/* ══════════════════════════════════════════════════════════════
   FLOOR 1 — REPOSITORY / expiry.js
   Expiry Tracking module: racks (master list), rack_assignments
   (who checks which rack each month), and expiry_entries (the
   near-expiry log itself — staff-wise, month-wise, universally
   searchable). Same shape as the rest of repository/supabase.js:
   row<->app mappers + thin Supabase calls, nothing else.
   ══════════════════════════════════════════════════════════════ */

// ── Racks (master list — Settings, Main Auditor only) ──
function _rowToRack(row) {
  return { id: row.id, name: row.name, active: row.active, createdAt: row.created_at };
}
async function fetchRacks(client) {
  const { data, error } = await client.from('racks').select('*').order('name', { ascending: true });
  if (error) throw error;
  return (data || []).map(_rowToRack);
}
async function insertRack(client, name) {
  const { data, error } = await client.from('racks').insert({ name }).select().single();
  if (error) throw error;
  return _rowToRack(data);
}
async function setRackActive(client, id, active) {
  const { error } = await client.from('racks').update({ active }).eq('id', id);
  if (error) throw error;
}
async function deleteRack(client, id) {
  const { error } = await client.from('racks').delete().eq('id', id);
  if (error) throw error;
}

// ── Rack assignments (monthly) ──
function _rowToRackAssignment(row) {
  return {
    id: row.id, rackId: row.rack_id, rackName: row.rack_name,
    staffId: row.staff_id, staffName: row.staff_name, month: row.month,
    assignedBy: row.assigned_by, assignedAt: row.assigned_at,
  };
}
async function fetchRackAssignmentsByMonth(client, month) {
  const { data, error } = await client.from('rack_assignments').select('*').eq('month', month).order('rack_name', { ascending: true });
  if (error) throw error;
  return (data || []).map(_rowToRackAssignment);
}
// Re-running the assignment screen for a month overwrites who
// currently owns a given rack (unique (rack_id, month) in schema.sql)
// rather than piling up duplicate rows.
async function upsertRackAssignment(client, a) {
  const { data, error } = await client.from('rack_assignments')
    .upsert({
      rack_id: a.rackId, rack_name: a.rackName, staff_id: a.staffId, staff_name: a.staffName,
      month: a.month, assigned_by: a.assignedBy, assigned_at: new Date().toISOString(),
    }, { onConflict: 'rack_id,month' })
    .select().single();
  if (error) throw error;
  return _rowToRackAssignment(data);
}
async function deleteRackAssignment(client, id) {
  const { error } = await client.from('rack_assignments').delete().eq('id', id);
  if (error) throw error;
}

// ── Expiry entries ──
function _rowToExpiryEntry(row) {
  return {
    id: row.id, staffId: row.staff_id, staffName: row.staff_name,
    productCode: row.product_code || '', productName: row.product_name,
    quantity: row.quantity, expiryMonth: row.expiry_month, rackLocation: row.rack_location,
    status: row.status, locked: row.locked, loggedAt: row.logged_at, updatedAt: row.updated_at,
    reopenedBy: row.reopened_by, reopenedByName: row.reopened_by_name, reopenedAt: row.reopened_at,
  };
}
async function insertExpiryEntry(client, e) {
  const { data, error } = await client.from('expiry_entries').insert({
    staff_id: e.staffId, staff_name: e.staffName, product_code: e.productCode || '', product_name: e.productName,
    quantity: e.quantity, expiry_month: e.expiryMonth, rack_location: e.rackLocation, status: e.status,
  }).select().single();
  if (error) throw error;
  return _rowToExpiryEntry(data);
}
// Universal search: any combination of a free-text query (product code
// or name, ilike), a specific expiry month, and/or a status filter.
// Ordered soonest-to-expire first so the "expiry rack, month wise" view
// naturally reads top-to-bottom in the order staff should act on it.
async function fetchExpiryEntries(client, { query = '', month = '', status = '' } = {}) {
  let q = client.from('expiry_entries').select('*');
  if (query && query.trim()) {
    const term = `%${query.trim()}%`;
    q = q.or(`product_name.ilike.${term},product_code.ilike.${term}`);
  }
  if (month) q = q.eq('expiry_month', month);
  if (status) q = q.eq('status', status);
  q = q.order('expiry_month', { ascending: true }).order('logged_at', { ascending: false });
  const { data, error } = await q;
  if (error) throw error;
  return (data || []).map(_rowToExpiryEntry);
}
// Main-Auditor-only (enforced by RLS, not just this call): unlocks a
// previously-saved entry so it can be edited again.
async function reopenExpiryEntry(client, id, reopenedBy, reopenedByName) {
  const { data, error } = await client.from('expiry_entries')
    .update({ locked: false, reopened_by: reopenedBy, reopened_by_name: reopenedByName, reopened_at: new Date().toISOString() })
    .eq('id', id).select().single();
  if (error) throw error;
  return _rowToExpiryEntry(data);
}
// Main-Auditor-only: saves edits made after a reopen, and re-locks the
// entry in the same call — an entry is never left silently editable.
async function saveReopenedExpiryEntry(client, id, patch) {
  const dbPatch = { locked: true, updated_at: new Date().toISOString() };
  if (patch.quantity !== undefined) dbPatch.quantity = patch.quantity;
  if (patch.expiryMonth !== undefined) dbPatch.expiry_month = patch.expiryMonth;
  if (patch.rackLocation !== undefined) dbPatch.rack_location = patch.rackLocation;
  if (patch.status !== undefined) dbPatch.status = patch.status;
  const { data, error } = await client.from('expiry_entries').update(dbPatch).eq('id', id).select().single();
  if (error) throw error;
  return _rowToExpiryEntry(data);
}
async function deleteExpiryEntry(client, id) {
  const { error } = await client.from('expiry_entries').delete().eq('id', id);
  if (error) throw error;
}

export const ExpiryRepo = {
  fetchRacks, insertRack, setRackActive, deleteRack,
  fetchRackAssignmentsByMonth, upsertRackAssignment, deleteRackAssignment,
  insertExpiryEntry, fetchExpiryEntries, reopenExpiryEntry, saveReopenedExpiryEntry, deleteExpiryEntry,
};
