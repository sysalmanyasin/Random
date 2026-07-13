import { esc } from './dom-utils.js';

/* ══════════════════════════════════════════════════════════════
   FLOOR 4 — COMPONENTS / staff-components.js
   The Staff tab: one card per person, admin controls, and the
   WhatsApp deep-link dispatch button. Pure render only — every
   button here is wired up in pages/staff-pages.js.
   ══════════════════════════════════════════════════════════════ */

export function staffCardHTML(staffMember, appUrl) {
  const blocked = staffMember.accessExpiresAt && new Date(staffMember.accessExpiresAt).getTime() < Date.now();
  const isMain = staffMember.role === 'main';
  return `
    <div class="card assignment-card" data-staff-id="${esc(staffMember.id)}">
      <div style="display:flex; justify-content:space-between; align-items:flex-start; margin-bottom:8px;">
        <div>
          <div style="font-weight:800; color:var(--navy); font-size:13px;">${esc(staffMember.name)} ${isMain ? '👑' : ''}</div>
          <div style="font-size:11px; color:var(--grey); margin-top:2px;">${esc(staffMember.phone)}</div>
        </div>
        <span class="val-badge ${blocked ? 'val-red' : 'val-green'}">${blocked ? 'Blocked/Expired' : 'Active'}</span>
      </div>
      <div style="display:flex; gap:6px; margin-bottom:6px;">
        <input type="text" class="settings-input staff-pin-input" placeholder="New PIN" aria-label="New PIN for ${esc(staffMember.name)}" style="margin:0; flex:1; font-size:12px; padding:8px;" data-staff-id="${esc(staffMember.id)}">
        <button class="btn btn-primary" style="font-size:11px; padding:8px 10px;" data-action="staff-reset-pin" data-staff-id="${esc(staffMember.id)}">Set PIN</button>
      </div>
      ${isMain ? '' : `
      <div style="display:flex; gap:6px; margin-bottom:6px;">
        <button class="btn" style="flex:1; font-size:11px; padding:8px; background:var(--light); color:var(--text);" data-action="staff-toggle-block" data-staff-id="${esc(staffMember.id)}" data-currently-blocked="${blocked ? '1' : '0'}">${blocked ? 'Unblock' : 'Block'}</button>
        <button class="btn btn-danger" style="flex:1; font-size:11px; padding:8px;" data-action="staff-delete" data-staff-id="${esc(staffMember.id)}">Delete</button>
      </div>
      <div style="display:flex; gap:6px; margin-bottom:6px; align-items:center;">
        <input type="date" class="settings-input staff-expiry-input" style="margin:0; flex:1; font-size:12px; padding:8px;" data-staff-id="${esc(staffMember.id)}" value="${staffMember.accessExpiresAt ? esc(staffMember.accessExpiresAt.slice(0, 10)) : ''}">
        <button class="btn" style="font-size:11px; padding:8px 10px; background:var(--light); color:var(--text);" data-action="staff-set-expiry" data-staff-id="${esc(staffMember.id)}">Set</button>
      </div>
      <button class="btn btn-block" style="margin-bottom:6px; font-size:11px; padding:8px; background:#FFF3D6; color:#8A6D00; border:1px solid #F0D998;" data-action="staff-promote" data-staff-id="${esc(staffMember.id)}" data-staff-name="${esc(staffMember.name)}">👑 Promote to Main Auditor</button>`}
      <a href="${esc(appUrl)}" target="_blank" data-action="staff-send-whatsapp" data-staff-id="${esc(staffMember.id)}" class="btn btn-block" style="background:#25D366; color:white; text-decoration:none; display:block; text-align:center; padding:10px; font-weight:700; font-size:12px;">📲 Send via WhatsApp</a>
    </div>`;
}

export function addStaffFormHTML() {
  return `
    <div class="card">
      <label class="settings-label" for="new-staff-name-input">Name</label>
      <input type="text" id="new-staff-name-input" class="settings-input" placeholder="Staff member's name">
      <label class="settings-label" for="new-staff-phone-input">Phone (with country code)</label>
      <input type="tel" id="new-staff-phone-input" class="settings-input" placeholder="923001234567">
      <label class="settings-label" for="new-staff-pin-input">PIN (4-8 digits)</label>
      <input type="text" id="new-staff-pin-input" class="settings-input" placeholder="e.g. 4821" inputmode="numeric">
      <button class="btn btn-primary btn-block" data-action="staff-create">Create Login</button>
    </div>`;
}

export function noStaffEmptyStateHTML() {
  return `<div class="card" style="text-align:center; padding:24px 16px;"><div style="font-weight:700; color:var(--navy);">No staff yet.</div><div style="font-size:12px; color:var(--grey); margin-top:4px;">Create a login below, then dispatch it via WhatsApp.</div></div>`;
}
