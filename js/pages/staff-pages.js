import { Store } from '../store.js';
import { Actions, Bus } from '../actions.js';
import { Components } from '../components.js';

/* ══════════════════════════════════════════════════════════════
   FLOOR 5 — PAGES / staff-pages.js
   The Staff tab — one card per person, admin controls, and the
   "100% free, human-validated" WhatsApp dispatch button (nothing
   sends automatically; you tap each card yourself).
   ══════════════════════════════════════════════════════════════ */

const $ = (id) => document.getElementById(id);

function appUrl() { return window.location.href.split('?')[0].split('#')[0]; }

export function renderStaffTab() {
  const container = $('staff-tab-root');
  if (!container) return;
  const { role, staff } = Store.getState();
  if (role !== 'main') { container.innerHTML = '<div class="card">Only the Main Auditor manages staff.</div>'; return; }

  const cards = staff.length === 0 ? Components.noStaffEmptyStateHTML() : staff.map(s => Components.staffCardHTML(s, appUrl())).join('');
  container.innerHTML = `
    <div class="card-title">Staff</div>
    ${cards}
    <div class="card-title">Add Staff</div>
    ${Components.addStaffFormHTML()}
  `;
}
Bus.on('staff:changed', renderStaffTab);
Bus.on('view:activated', (page) => { if (page === 'staff') renderStaffTab(); });

export function initStaffPages() {
  const clickHandlers = {
    'staff-create': async () => {
      const name = $('new-staff-name-input').value;
      const phone = $('new-staff-phone-input').value;
      const pin = $('new-staff-pin-input').value;
      const result = await Actions.createStaffMember(name, phone, pin, 'sub');
      if (result) { $('new-staff-name-input').value = ''; $('new-staff-phone-input').value = ''; $('new-staff-pin-input').value = ''; }
    },
    'staff-reset-pin': async (el) => {
      const input = document.querySelector(`.staff-pin-input[data-staff-id="${el.dataset.staffId}"]`);
      if (!input || !input.value.trim()) { Bus.emit('toast', { msg: 'Enter a new PIN first', kind: 'error' }); return; }
      const ok = await Actions.resetStaffPin(el.dataset.staffId, input.value.trim());
      if (ok) input.value = '';
    },
    'staff-toggle-block': async (el) => {
      const currentlyBlocked = el.dataset.currentlyBlocked === '1';
      await Actions.setStaffBlocked(el.dataset.staffId, !currentlyBlocked);
      await Actions.loadStaffRoster();
    },
    'staff-delete': (el) => Actions.deleteStaffMember(el.dataset.staffId),
    'staff-promote': (el) => Actions.promoteStaffToMain(el.dataset.staffId, el.dataset.staffName),
    'staff-set-expiry': async (el) => {
      const input = document.querySelector(`.staff-expiry-input[data-staff-id="${el.dataset.staffId}"]`);
      const iso = input && input.value ? new Date(input.value + 'T23:59:59').toISOString() : null;
      await Actions.setStaffAccessExpiry(el.dataset.staffId, iso);
    },
    'staff-send-whatsapp': (el) => {
      const { staff } = Store.getState();
      const staffMember = staff.find(s => s.id === el.dataset.staffId);
      const pinInput = document.querySelector(`.staff-pin-input[data-staff-id="${el.dataset.staffId}"]`);
      const pin = (pinInput && pinInput.value.trim()) || 'the PIN you set for them';
      if (!staffMember) return;
      el.href = Actions.buildWhatsAppDispatchUrl(staffMember, appUrl(), pin); // link is built just-in-time, then the anchor's own click proceeds
    },
  };

  return { clickHandlers, inputHandlers: {}, changeHandlers: {}, keydownHandlers: {} };
}
