import { Repo } from '../repository.js';
import { Store } from '../store.js';
import { Bus } from './bus.js';

/* ══════════════════════════════════════════════════════════════
   FLOOR 3 — ACTIONS / auth-actions.js
   Real login, replacing the old pairing-link mechanism entirely.
   Phone + PIN is presented to the person; underneath, it's a
   normal Supabase Auth session (phone mapped to an internal fake
   email, PIN is the real password) — see repository/supabase.js.
   Isolation is enforced by Postgres Row Level Security, not by
   the app being careful about what it sends.
   ══════════════════════════════════════════════════════════════ */

const SUPABASE_URL_KEY = 'app_supabase_url';
const SUPABASE_ANON_KEY_KEY = 'app_supabase_anon_key';
// Defaults point at the project already created for this app. Safe to
// ship — the publishable/anon key is designed to be public; Postgres
// Row Level Security is what actually protects the data.
const DEFAULT_SUPABASE_URL = 'https://vtcrdkqhuvxatclobsby.supabase.co';
const DEFAULT_SUPABASE_ANON_KEY = 'sb_publishable_h-Z3ldRXyb18HEjF68cJ0g_tmRgbrAy';

function getSupabaseUrl() { return Repo.LS.get(SUPABASE_URL_KEY, DEFAULT_SUPABASE_URL); }
function getSupabaseAnonKey() { return Repo.LS.get(SUPABASE_ANON_KEY_KEY, DEFAULT_SUPABASE_ANON_KEY); }
function isSupabaseConfigured() { return !!(getSupabaseUrl() && getSupabaseAnonKey()); }

function saveSupabaseConfig(url, anonKey) {
  if (!url || !anonKey) { Bus.emit('toast', { msg: 'Enter both the Supabase URL and anon key', kind: 'error' }); return; }
  Repo.LS.set(SUPABASE_URL_KEY, url.trim());
  Repo.LS.set(SUPABASE_ANON_KEY_KEY, anonKey.trim());
  Bus.emit('toast', { msg: 'Supabase configured — reloading…', kind: 'success' });
  setTimeout(() => window.location.reload(), 600);
}

// ── Bootstrap: build the client, restore any existing session,
//    resolve which role (main/sub) this person actually is. ──
async function bootstrapAuth() {
  if (!isSupabaseConfigured()) {
    Store.setState({ authChecked: true });
    Bus.emit('auth:needsConfig', {});
    return;
  }

  try {
    const sbClient = Repo.buildSupabaseClient(getSupabaseUrl(), getSupabaseAnonKey());

    // The Supabase SDK is loaded from a CDN <script> tag in index.html.
    // If that script hasn't loaded (blocked, offline, CDN hiccup, etc.),
    // buildSupabaseClient() safely returns null instead of throwing. We
    // must not call into sbClient.auth.* in that case, or we crash before
    // authChecked ever gets set — which is what silently blanked the app.
    if (!sbClient) {
      Store.setState({ sbClient: null, authChecked: true });
      Bus.emit('toast', { msg: 'Could not reach Supabase — check your connection and reload', kind: 'error' });
      Bus.emit('auth:needsConfig', {});
      return;
    }

    Store.setState({ sbClient });

    Repo.onAuthStateChange(sbClient, (session) => {
      Store.setState({ authSession: session });
      if (!session) {
        Store.setState({ role: null, currentAuditorId: null, currentAuditorName: '', accessExpiresAt: null });
        Bus.emit('auth:loggedOut', {});
      }
    });

    const session = await Repo.getSession(sbClient);
    Store.setState({ authSession: session, authChecked: true });
    if (session) await _resolveStaffProfile(sbClient, session.user.id, false);
    else Bus.emit('auth:needsLogin', {});
  } catch (err) {
    // Safety net: whatever goes wrong above, never leave authChecked
    // unset — that's what causes the permanent blank screen. Surface
    // the failure instead so the person can retry or report it.
    console.error('[Auth] bootstrapAuth failed:', err);
    Store.setState({ authChecked: true });
    Bus.emit('toast', { msg: 'Something went wrong starting the app — please reload', kind: 'error' });
    Bus.emit('auth:needsConfig', {});
  }
}

async function _resolveStaffProfile(sbClient, userId, interactive) {
  try {
    const profile = await Repo.fetchMyStaffProfile(sbClient, userId);
    const blocked = profile.accessExpiresAt && new Date(profile.accessExpiresAt).getTime() < Date.now();
    if (blocked) {
      Bus.emit('toast', { msg: 'Your access has expired — ask the Main Auditor to renew it', kind: 'error' });
      await Repo.signOut(sbClient);
      Store.setState({ role: null });
      return;
    }
    Store.setState({
      role: profile.role, currentAuditorId: profile.id, currentAuditorName: profile.name,
      accessExpiresAt: profile.accessExpiresAt,
    });
    // `interactive` distinguishes "the person just typed phone+PIN and hit
    // Login" from "Supabase silently restored a saved session while the
    // app was booting" — only the former should ever auto-navigate
    // anywhere. Otherwise every relaunch with a still-valid session would
    // yank the person into Team Audit regardless of which page they
    // actually landed on (see actions/index.js's 'auth:loggedIn' handler).
    Bus.emit('auth:loggedIn', Object.assign({}, profile, { interactive: !!interactive }));
  } catch (err) {
    Bus.emit('toast', { msg: 'Could not load your staff profile — contact the Main Auditor', kind: 'error' });
    console.error('[Auth] profile resolution failed:', err);
  }
}

async function loginWithPhonePin(phone, pin) {
  const { sbClient } = Store.getState();
  if (!sbClient) { Bus.emit('toast', { msg: 'Supabase isn\u2019t configured yet', kind: 'error' }); return false; }
  if (!phone || !pin) { Bus.emit('toast', { msg: 'Enter your phone number and PIN', kind: 'error' }); return false; }

  const { data, error } = await Repo.signInWithPhonePin(sbClient, phone, pin);
  if (error) {
    Bus.emit('toast', { msg: 'Login failed — check your phone number and PIN', kind: 'error' });
    return false;
  }
  await _resolveStaffProfile(sbClient, data.user.id, true);
  return true;
}

async function logout() {
  const { sbClient } = Store.getState();
  if (sbClient) await Repo.signOut(sbClient);
  Store.setState({ role: null, currentAuditorId: null, currentAuditorName: '', accessExpiresAt: null, myAssignments: [], activeAssignmentId: null, myCounts: {}, myNotes: {} });
  Bus.emit('auth:loggedOut', {});
}

export const AuthActions = {
  getSupabaseUrl, getSupabaseAnonKey, isSupabaseConfigured, saveSupabaseConfig,
  bootstrapAuth, loginWithPhonePin, logout,
};
