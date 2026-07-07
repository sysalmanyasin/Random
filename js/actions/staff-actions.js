import { Repo } from '../repository.js';
import { Store } from '../store.js';
import { Bus } from './bus.js';
import { logAudit } from './audit-log-actions.js';

/* ══════════════════════════════════════════════════════════════
   FLOOR 3 — ACTIONS / staff-actions.js
   The staff roster now lives in Supabase (real logins), not a
   local IndexedDB list. Admin actions that need elevated rights
   (create login, reset PIN, block) are proxied through the
   admin-actions Edge Function — the browser never holds a
   service-role key. Setting an access-expiry date is a normal
   RLS-permitted table update, no Edge Function needed for that one.
   ══════════════════════════════════════════════════════════════ */

async function loadStaffRoster() {
  const { sbClient } = Store.getState();
  if (!sbClient) return [];
  const staff = await Repo.fetchAllStaff(sbClient);
  Store.setState({ staff });
  Bus.emit('staff:changed', staff);
  return staff;
}

async function createStaffMember(name, phone, pin, role) {
  const { sbClient } = Store.getState();
  if (!name || !phone || !pin) { Bus.emit('toast', { msg: 'Name, phone, and PIN are all required', kind: 'error' }); return null; }
  if (!/^\d{4,8}$/.test(pin)) { Bus.emit('toast', { msg: 'PIN must be 4-8 digits', kind: 'error' }); return null; }
  try {
    const result = await Repo.callAdminAction(sbClient, 'createStaff', { name, phone, pin, role: role === 'main' ? 'main' : 'sub' });
    logAudit('staff:created', { staffId: result.staffId, name, role });
    Bus.emit('toast', { msg: name + ' can now log in', kind: 'success' });
    await loadStaffRoster();
    return result;
  } catch (err) {
    Bus.emit('toast', { msg: 'Could not create staff login: ' + err.message, kind: 'error' });
    return null;
  }
}

async function resetStaffPin(staffId, newPin) {
  const { sbClient } = Store.getState();
  if (!/^\d{4,8}$/.test(newPin)) { Bus.emit('toast', { msg: 'PIN must be 4-8 digits', kind: 'error' }); return false; }
  try {
    await Repo.callAdminAction(sbClient, 'resetPin', { staffId, newPin });
    logAudit('staff:pinReset', { staffId });
    Bus.emit('toast', { msg: 'PIN updated', kind: 'success' });
    return true;
  } catch (err) {
    Bus.emit('toast', { msg: 'Could not reset PIN: ' + err.message, kind: 'error' });
    return false;
  }
}

async function setStaffBlocked(staffId, blocked) {
  const { sbClient } = Store.getState();
  try {
    await Repo.callAdminAction(sbClient, 'setBlocked', { staffId, blocked });
    logAudit('staff:blockedChanged', { staffId, blocked });
    Bus.emit('toast', { msg: blocked ? 'Staff member blocked' : 'Staff member unblocked', kind: 'success' });
    return true;
  } catch (err) {
    Bus.emit('toast', { msg: 'Could not update block status: ' + err.message, kind: 'error' });
    return false;
  }
}

// No Edge Function needed — RLS lets a Main Auditor update this
// column directly on the staff table.
async function setStaffAccessExpiry(staffId, expiresAtIso) {
  const { sbClient } = Store.getState();
  try {
    await Repo.setStaffAccessExpiry(sbClient, staffId, expiresAtIso);
    logAudit('staff:accessExpirySet', { staffId, expiresAt: expiresAtIso });
    Bus.emit('toast', { msg: expiresAtIso ? 'Access expiry set' : 'Access expiry cleared (never expires)', kind: 'success' });
    await loadStaffRoster();
    return true;
  } catch (err) {
    Bus.emit('toast', { msg: 'Could not set expiry: ' + err.message, kind: 'error' });
    return false;
  }
}

async function deleteStaffMember(staffId) {
  const { sbClient } = Store.getState();
  if (!confirm('Permanently delete this staff login? This cannot be undone.')) return false;
  try {
    await Repo.callAdminAction(sbClient, 'deleteStaff', { staffId });
    logAudit('staff:deleted', { staffId });
    Bus.emit('toast', { msg: 'Staff login deleted', kind: 'success' });
    await loadStaffRoster();
    return true;
  } catch (err) {
    Bus.emit('toast', { msg: 'Could not delete: ' + err.message, kind: 'error' });
    return false;
  }
}

// Promotes a sub-staff login to Main Auditor. Irreversible from the app —
// grants full admin power (staff management, PIN resets, etc).
async function promoteStaffToMain(staffId, staffName) {
  const { sbClient } = Store.getState();
  if (!confirm(`Make "${staffName}" a Main Auditor?\n\nThey will get full admin access — including managing staff, resetting PINs, and promoting others. This cannot be undone from the app.`)) return false;
  try {
    await Repo.callAdminAction(sbClient, 'promoteToMain', { staffId });
    logAudit('staff:promotedToMain', { staffId });
    Bus.emit('toast', { msg: staffName + ' is now a Main Auditor', kind: 'success' });
    await loadStaffRoster();
    return true;
  } catch (err) {
    Bus.emit('toast', { msg: 'Could not promote: ' + err.message, kind: 'error' });
    return false;
  }
}

// ── WhatsApp dispatch (Blueprint: 100% free, human-validated —
//    nothing sends automatically, you tap each card yourself). ──
function buildWhatsAppDispatchUrl(staffMember, appUrl, pin) {
  const digitsOnly = String(staffMember.phone).replace(/\D/g, '');
  const lines = [
    `Hi ${staffMember.name}, you're set up on the Fazal Din Pharma Plus audit app.`,
    `Open this link: ${appUrl}`,
    `Login with your phone number and this PIN: ${pin}`,
  ];
  const text = encodeURIComponent(lines.join('\n'));
  return `https://wa.me/${digitsOnly}?text=${text}`;
}

export const StaffActions = {
  loadStaffRoster, createStaffMember, resetStaffPin, setStaffBlocked,
  setStaffAccessExpiry, deleteStaffMember, promoteStaffToMain, buildWhatsAppDispatchUrl,
};
