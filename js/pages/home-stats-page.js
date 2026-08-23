import { Store } from '../store.js';
import { Bus } from '../actions.js';

/* ══════════════════════════════════════════════════════════════
   FLOOR 5 — PAGES / home-stats-page.js
   Keeps the three home-screen tile stat lines up to date by
   listening to the same Bus events the rest of the app uses.
   Purely additive — reads Store, writes text into the DOM,
   nothing else.
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
  const badge = $('home-badge-team');
  if (!el) return;
  const { role, engagements, currentEngagementId, rounds, assignments } = Store.getState();
  if (!role) { el.textContent = 'Not logged in'; if (badge) badge.hidden = true; return; }
  if (!currentEngagementId) {
    const openCount = (engagements || []).filter(e => e.status === 'open').length;
    el.textContent = openCount > 0
      ? openCount + ' open engagement' + (openCount === 1 ? '' : 's')
      : 'No active engagement';
    if (badge) badge.hidden = true; // no per-assignment data loaded until an engagement is opened
    return;
  }
  const engagement = (engagements || []).find(e => e.id === currentEngagementId);
  const roundCount = (rounds || []).length;
  const lastRound = roundCount > 0 ? rounds[roundCount - 1] : null;
  const roundLabel = lastRound
    ? 'Round ' + roundCount + ' — ' + (lastRound.state || 'draft')
    : 'No rounds yet';
  el.textContent = (engagement ? engagement.name : 'Active engagement') + ' · ' + roundLabel;

  // "Did my team submit yet?" is the most common daily check a Main
  // Auditor makes, and previously required drilling into the
  // engagement's Dashboard tab to see it. Surface it directly on the
  // Home tile whenever we already have assignment data in Store for
  // the current round (no extra query — see initial-state.js comment
  // on `assignments` being scoped to the currently open round).
  const currentRoundAssignments = lastRound
    ? (assignments || []).filter(a => a.roundId === lastRound.id)
    : [];
  if (badge && currentRoundAssignments.length > 0) {
    const pending = currentRoundAssignments.filter(a => a.status !== 'submitted').length;
    if (pending > 0) {
      badge.hidden = false;
      badge.textContent = pending + ' pending';
      badge.className = 'section-tile-badge section-tile-badge--pending';
    } else {
      badge.hidden = false;
      badge.textContent = 'All submitted';
      badge.className = 'section-tile-badge section-tile-badge--done';
    }
  } else if (badge) {
    badge.hidden = true;
  }
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

export function initHomeStatsPage() {
  Bus.on('products:changed',    updateInventoryStat);
  Bus.on('templates:changed',   updateInventoryStat);
  Bus.on('auth:loggedIn',       updateTeamStat);
  Bus.on('auth:loggedOut',      updateTeamStat);
  Bus.on('engagement:opened',   updateTeamStat);
  Bus.on('engagement:closed',   updateTeamStat);
  Bus.on('engagements:changed', updateTeamStat);
  Bus.on('products:changed',    updateSyncStat);
  Bus.on('cloud:state',         updateSyncStat);

  setTimeout(updateAll, 300);
}
