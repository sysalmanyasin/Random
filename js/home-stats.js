import { Store } from './store.js';
import { Actions, Bus } from './actions.js';

/* ══════════════════════════════════════════════════════════════
   home-stats.js  —  purely additive, zero changes to existing code
   Keeps the three home-screen tile stat lines up to date by
   listening to the same Bus events the rest of the app uses.
   ══════════════════════════════════════════════════════════════ */

const $ = (id) => document.getElementById(id);

function updateRandomStat() {
  const el = $('home-stat-random');
  if (!el) return;
  const { history, products } = Store.getState();
  const hLen = (history || []).length;
  const pLen = (products || []).length;
  if (pLen === 0 && hLen === 0) { el.textContent = 'No inventory loaded yet'; return; }
  const parts = [];
  if (pLen > 0) parts.push(pLen.toLocaleString() + ' items loaded');
  if (hLen > 0) parts.push(hLen + ' audit' + (hLen === 1 ? '' : 's') + ' in history');
  el.textContent = parts.join(' · ');
}

function updateTeamStat() {
  const el = $('home-stat-team');
  if (!el) return;
  const { role, engagements, currentEngagementId, rounds } = Store.getState();
  if (!role) { el.textContent = 'Not logged in'; return; }
  if (!currentEngagementId) {
    const openCount = (engagements || []).filter(e => e.status === 'open').length;
    el.textContent = openCount > 0
      ? openCount + ' open engagement' + (openCount === 1 ? '' : 's')
      : 'No active engagement';
    return;
  }
  const engagement = (engagements || []).find(e => e.id === currentEngagementId);
  const roundCount = (rounds || []).length;
  const lastRound = roundCount > 0 ? rounds[roundCount - 1] : null;
  const roundLabel = lastRound
    ? 'Round ' + roundCount + ' — ' + (lastRound.state || 'draft')
    : 'No rounds yet';
  el.textContent = (engagement ? engagement.name : 'Active engagement') + ' · ' + roundLabel;
}

function updateSyncStat() {
  const el = $('home-stat-sync');
  if (!el) return;
  const linked = !!(Actions.getDropboxToken && Actions.getDropboxToken());
  el.textContent = linked ? '☁ Dropbox linked & ready' : 'Dropbox not linked — tap to configure';
}

function updateAll() { updateRandomStat(); updateTeamStat(); updateSyncStat(); }

Bus.on('products:changed',              updateRandomStat);
Bus.on('history:changed',               updateRandomStat);
Bus.on('auth:loggedIn',                 updateTeamStat);
Bus.on('auth:loggedOut',                updateTeamStat);
Bus.on('engagement:opened',             updateTeamStat);
Bus.on('engagement:closed',             updateTeamStat);
Bus.on('engagements:changed',           updateTeamStat);
Bus.on('settings:dropboxStatusChanged', updateSyncStat);
Bus.on('cloud:state',                   updateSyncStat);

setTimeout(updateAll, 300);
