import { LS } from './storage.js';

/* ══════════════════════════════════════════════════════════════
   FLOOR 1 — REPOSITORY / rack-scan.js
   Rack Scan sessions + per-item verifications (Supabase, Main Auditor
   only via RLS) and a small localStorage outbox so scanning keeps
   working with no signal. Writes are idempotent upserts.
   ══════════════════════════════════════════════════════════════ */

const OUTBOX_KEY = 'rackScanOutbox';

async function upsertRackSession(client, s) {
  const { error } = await client.from('rack_scan_sessions').upsert({
    id: s.id, rack_label: s.label || null, status: s.status, started_at: s.startedAt,
    closed_at: s.closedAt || null, signed_off_by: s.signedOffBy || null, note: s.note || null,
  }, { onConflict: 'id' });
  if (error) throw error;
}

async function upsertRackItems(client, rows) {
  if (!rows.length) return;
  const { error } = await client.from('rack_scan_items').upsert(rows, { onConflict: 'session_id,client_event_id' });
  if (error) throw error;
}

async function fetchRackSessions(client, limit) {
  const { data, error } = await client.from('rack_scan_sessions').select('*').order('started_at', { ascending: false }).limit(limit || 30);
  if (error) throw error;
  return data || [];
}

async function fetchRackSessionItems(client, sessionId) {
  const { data, error } = await client.from('rack_scan_items').select('*').eq('session_id', sessionId).order('scanned_at', { ascending: true });
  if (error) throw error;
  return data || [];
}

async function fetchRackLastVerified(client) {
  const out = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await client.from('rack_scan_last_verified').select('*').range(from, from + 999);
    if (error) throw error;
    (data || []).forEach(r => out.push(r));
    if (!data || data.length < 1000) break;
  }
  return out;
}

function loadRackOutbox() { return LS.getJSON(OUTBOX_KEY, { sessions: {}, items: {} }); }
function saveRackOutbox(box) { LS.setJSON(OUTBOX_KEY, box); }

export const RackScanRepo = {
  upsertRackSession, upsertRackItems, fetchRackSessions, fetchRackSessionItems, fetchRackLastVerified,
  loadRackOutbox, saveRackOutbox,
};
