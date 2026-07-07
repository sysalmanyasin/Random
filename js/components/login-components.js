import { esc } from './dom-utils.js';

/* ══════════════════════════════════════════════════════════════
   FLOOR 4 — COMPONENTS / login-components.js
   Real login (Supabase Auth underneath), presented as just phone
   + PIN — pure render only.
   ══════════════════════════════════════════════════════════════ */

export function supabaseConfigScreenHTML() {
  return `
    <div class="card" style="text-align:center; padding:28px 20px;">
      <span style="font-size:36px;">🔧</span>
      <div style="font-weight:800; color:var(--navy); margin-top:8px; font-size:15px;">One-time setup</div>
      <div style="font-size:12px; color:var(--grey); margin:6px 0 14px;">Enter your Supabase project URL and anon/publishable key (from your Supabase Dashboard → Settings → API). This is safe to store on this device — your data is protected by Row Level Security, not by hiding this key.</div>
      <input type="text" id="supabase-url-input" class="settings-input" placeholder="https://xxxx.supabase.co">
      <input type="text" id="supabase-anon-key-input" class="settings-input" placeholder="sb_publishable_... (or anon key)">
      <button class="btn btn-primary btn-block" data-action="save-supabase-config">Save & Continue</button>
    </div>`;
}

export function loginScreenHTML() {
  return `
    <div class="card" style="text-align:center; padding:32px 20px;">
      <span style="font-size:40px;">🔐</span>
      <div style="font-weight:800; color:var(--navy); margin-top:10px; font-size:16px;">Team Audit Login</div>
      <div style="font-size:12px; color:var(--grey); margin:4px 0 16px;">Enter your phone number and PIN.</div>
      <input type="tel" id="login-phone-input" class="settings-input" placeholder="Phone number" inputmode="tel">
      <input type="password" id="login-pin-input" class="settings-input" placeholder="PIN" inputmode="numeric" style="text-align:center; letter-spacing:4px;">
      <button class="btn btn-primary btn-block" data-action="submit-login">Log In</button>
    </div>`;
}

export function loggedInHeaderHTML(name, role, accessExpiresAt) {
  const expiryNote = accessExpiresAt ? `Access until ${esc(new Date(accessExpiresAt).toLocaleString('en-PK'))}` : '';
  return `
    <div class="sticky-controls" style="background:var(--navy); color:white; display:flex; justify-content:space-between; align-items:center;">
      <div>
        <div style="font-size:12px; font-weight:700;">${esc(name)} — ${role === 'main' ? 'Main Auditor' : 'Sub-Auditor'}</div>
        ${expiryNote ? `<div style="font-size:10px; opacity:0.8;">${expiryNote}</div>` : ''}
      </div>
      <button class="btn btn-sm" style="background:rgba(255,255,255,0.15); color:white;" data-action="logout">Log Out</button>
    </div>`;
}
