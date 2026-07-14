import { Store } from './store.js';
import { Actions, Bus } from './actions.js';

/* ══════════════════════════════════════════════════════════════
   home-stats.js  —  purely additive, zero changes to existing code
   Keeps the three home-screen tile stat lines up to date by
   listening to the same Bus events the rest of the app uses.
   ══════════════════════════════════════════════════════════════ */

const $ = (id) => document.getElementById(id);

function updateInventoryStat() {
  const el = $('home-stat-inventory');
  if (!el) return;
  const { products, templates } = Store.getState();
  const pLen = (products || []).length;
  const tLen = (templates || []).length;
  if (pLen === 0) { el.textContent = 'No inventory loaded yet'; return; }
  const parts = [pLen.toLocaleString() + ' items loaded'];
  if (tLen > 0) parts.push(tLen + ' saved template' + (tLen === 1 ? '' : 's'));
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
  const { products, inventoryLastSyncedAt } = Store.getState();
  const count = (products || []).length;
  if (count === 0) { el.textContent = 'No inventory loaded yet'; return; }
  if (inventoryLastSyncedAt) {
    const d = new Date(inventoryLastSyncedAt);
    el.textContent = count.toLocaleString() + ' items · synced ' + d.toLocaleDateString('en-PK', { day: '2-digit', month: 'short' });
  } else {
    el.textContent = count.toLocaleString() + ' items loaded';
  }
}

function updateAll() { updateInventoryStat(); updateTeamStat(); updateSyncStat(); }

Bus.on('products:changed',              updateInventoryStat);
Bus.on('templates:changed',             updateInventoryStat);
Bus.on('auth:loggedIn',                 updateTeamStat);
Bus.on('auth:loggedOut',                updateTeamStat);
Bus.on('engagement:opened',             updateTeamStat);
Bus.on('engagement:closed',             updateTeamStat);
Bus.on('engagements:changed',           updateTeamStat);
Bus.on('products:changed',              updateSyncStat);
Bus.on('cloud:state',                   updateSyncStat);

setTimeout(updateAll, 300);
