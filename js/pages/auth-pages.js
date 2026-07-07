import { Store } from '../store.js';
import { Actions, Bus } from '../actions.js';
import { Components } from '../components.js';

/* ══════════════════════════════════════════════════════════════
   FLOOR 5 — PAGES / auth-pages.js
   Renders whichever of: Supabase-config screen / login screen /
   logged-in header belongs in the #auth-root container, and
   gates the rest of the app shell accordingly. This is what
   replaced the pairing-link "?pair=" URL handling entirely.
   ══════════════════════════════════════════════════════════════ */

const $ = (id) => document.getElementById(id);

export function renderAuthRoot() {
  const authRoot = $('auth-root');
  const appShell = $('app-shell-below-auth');
  if (!authRoot) return;
  const { authChecked, sbClient, role, currentAuditorName, accessExpiresAt } = Store.getState();

  if (!authChecked) { authRoot.innerHTML = ''; return; }
  if (!sbClient) { authRoot.innerHTML = Components.supabaseConfigScreenHTML(); if (appShell) appShell.style.display = 'none'; return; }
  if (!role) { authRoot.innerHTML = Components.loginScreenHTML(); if (appShell) appShell.style.display = 'none'; return; }

  authRoot.innerHTML = Components.loggedInHeaderHTML(currentAuditorName, role, accessExpiresAt);
  if (appShell) appShell.style.display = 'block';
  document.querySelectorAll('.tab-btn').forEach(btn => {
    // A Sub-Auditor only ever needs the Team Audit tab — no inventory,
    // history, or settings screens are meaningful (or reachable) for
    // them, since Postgres RLS wouldn't return that data anyway.
    if (role === 'sub' && btn.id !== 'tab-team') btn.style.display = 'none';
  });
}

Bus.on('auth:needsConfig', renderAuthRoot);
Bus.on('auth:needsLogin', renderAuthRoot);
Bus.on('auth:loggedIn', renderAuthRoot);
Bus.on('auth:loggedOut', renderAuthRoot);
Bus.on('view:activated', (page) => {
  if (page !== 'settings') return;
  const urlInput = $('supabase-url-input');
  const keyInput = $('supabase-anon-key-input');
  if (urlInput) urlInput.value = Actions.getSupabaseUrl ? Actions.getSupabaseUrl() : '';
  if (keyInput) keyInput.value = Actions.getSupabaseAnonKey ? Actions.getSupabaseAnonKey() : '';
});

export function initAuthPages() {
  const clickHandlers = {
    'save-supabase-config': () => {
      const url = $('supabase-url-input').value;
      const key = $('supabase-anon-key-input').value;
      Actions.saveSupabaseConfig(url, key);
    },
    'submit-login': async () => {
      const phone = $('login-phone-input').value.trim();
      const pin = $('login-pin-input').value.trim();
      await Actions.loginWithPhonePin(phone, pin);
    },
    'logout': async () => { await Actions.logout(); },
  };

  return { clickHandlers, inputHandlers: {}, changeHandlers: {}, keydownHandlers: {} };
}
