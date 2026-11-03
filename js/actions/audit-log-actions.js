import { Repo } from '../repository.js';
import { Store } from '../store.js';
import { Bus } from './bus.js';

/* ══════════════════════════════════════════════════════════════
   FLOOR 3 — ACTIONS / audit-log-actions.js
   Blueprint §Security → Audit Logging.
   Every significant action across every domain module calls
   logAudit(). It updates the local, in-memory trail immediately
   (so the UI never waits on it) and writes through to Supabase in
   the background — queuing for retry if that write fails (e.g.
   offline), rather than silently losing the entry.
   ══════════════════════════════════════════════════════════════ */

const QUEUE_KEY = 'app_auditlog_retry_queue';
function _readQueue() { return Repo.LS.getJSON(QUEUE_KEY, []); }
function _writeQueue(list) { Repo.LS.setJSON(QUEUE_KEY, list); }

function logAudit(action, details) {
  const { role, currentAuditorName } = Store.getState();
  const entry = {
    id: 'local_' + Date.now() + '_' + Math.random().toString(36).slice(2),
    ts: Date.now(),
    actor: currentAuditorName || (role === 'main' ? 'Main Auditor' : 'Sub-Auditor'),
    role,
    action,
    details: details || {},
  };
  const auditLog = Store.getState().auditLog.concat([entry]);
  Store.setState({ auditLog });
  Bus.emit('auditLog:changed', auditLog);

  const { sbClient } = Store.getState();
  if (!sbClient) return entry;
  Repo.insertAuditLogEntry(sbClient, entry).catch(() => {
    const q = _readQueue();
    q.push(entry);
    _writeQueue(q);
  });
  return entry;
}

async function retryQueuedAuditLog() {
  const { sbClient } = Store.getState();
  if (!sbClient) return;
  const queue = _readQueue();
  if (queue.length === 0) return;
  const stillPending = [];
  for (const entry of queue) {
    try { await Repo.insertAuditLogEntry(sbClient, entry); }
    catch { stillPending.push(entry); }
  }
  _writeQueue(stillPending);
}

// Login loads only the newest entries (2026-11 egress cleanup); the full
// trail is fetched on demand by ensureFullAuditLog() when something
// actually needs all of it (the Audit Trail report).
const AUDIT_LOG_LOGIN_LIMIT = 500;
let _auditLogIsFull = false;

async function loadAuditLogList(opts) {
  const { sbClient } = Store.getState();
  if (!sbClient) return [];
  const limit = opts && opts.limit ? opts.limit : 0;
  let auditLog = await Repo.fetchAuditLog(sbClient, limit ? { limit } : undefined);
  // On-demand reload mid-session: keep entries still waiting in the offline
  // retry queue so they don't vanish from the trail while unsent.
  if (opts && opts.keepQueued) auditLog = auditLog.concat(_readQueue());
  _auditLogIsFull = !limit;
  Store.setState({ auditLog });
  Bus.emit('auditLog:changed', auditLog);
  return auditLog;
}

// Idempotent: a no-op once the full log is already in Store this session.
async function ensureFullAuditLog() {
  if (_auditLogIsFull) return Store.getState().auditLog;
  return loadAuditLogList({ keepQueued: true });
}

export { logAudit, loadAuditLogList, ensureFullAuditLog, retryQueuedAuditLog, AUDIT_LOG_LOGIN_LIMIT };
