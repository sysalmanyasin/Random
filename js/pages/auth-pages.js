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
    // A Sub-Auditor (and a Deputy Auditor, who gets a read-only Team
    // Audit view instead of Sub's own-work view) only ever needs the
    // Team Audit tab — no inventory, history, or settings screens are
    // meaningful (or reachable — see legacy-pages.js) for them.
    if ((role === 'sub' || role === 'dep') && btn.id !== 'tab-team') btn.style.display = 'none';
  });
  // Same restriction for the home-screen tiles (Inventory / Team
  // Audit / Sync & Tools) — these are a separate set of elements from
  // .tab-btn, so hiding the bottom nav alone left them fully visible
  // and tappable. The real enforcement is the role check inside
  // executeViewNavigation (legacy-pages.js) — this is just to stop a
  // Sub-Auditor or Deputy Auditor from seeing, and tapping into, an
  // option that would only bounce them back anyway.
  document.querySelectorAll('.section-tile').forEach(tile => {
    if ((role === 'sub' || role === 'dep') && tile.dataset.view !== 'team') tile.style.display = 'none';
  });
  // Once logged in as Sub-Auditor or Deputy Auditor, land directly on
  // Team Audit instead of the generic home screen — removes the window
  // where the wrong tiles could even be tapped before any redirect happens.
  if (role === 'sub' || role === 'dep') Bus.emit('nav:goto', 'team');
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
