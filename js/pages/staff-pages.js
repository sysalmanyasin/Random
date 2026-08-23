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

// Which cards are expanded (showing PIN/expiry/promote/WhatsApp), and the
// device-local drag order. Both reset naturally on a full re-render since
// they only affect display, never the underlying roster data.
let staffExpandedIds = new Set();

// Applies the saved drag order (Actions.reorderStaff / Store.staffOrder),
// putting any staff not yet in that order (new hires) at the end in
// roster order. A pure display concern, so it lives here in Pages rather
// than in Store or Actions.
function sortStaffForDisplay(staff, order) {
  if (!order || order.length === 0) return staff;
  const byId = new Map(staff.map(s => [s.id, s]));
  const ordered = order.map(id => byId.get(id)).filter(Boolean);
  const seen = new Set(ordered.map(s => s.id));
  return [...ordered, ...staff.filter(s => !seen.has(s.id))];
}

export function renderStaffTab() {
  const container = $('staff-tab-root');
  if (!container) return;
  const { role, staff, staffOrder } = Store.getState();
  if (role !== 'main') { container.innerHTML = '<div class="card">Only the Main Auditor manages staff.</div>'; return; }

  const ordered = sortStaffForDisplay(staff, staffOrder);
  const cards = ordered.length === 0
    ? Components.noStaffEmptyStateHTML()
    : ordered.map(s => Components.staffCardHTML(s, appUrl(), staffExpandedIds.has(s.id))).join('');
  container.innerHTML = `
    <div class="card-title">Staff</div>
    <div id="staff-card-list">${cards}</div>
    <div class="card-title">Add Staff</div>
    ${Components.addStaffFormHTML()}
  `;
}
Bus.on('staff:changed', renderStaffTab);
Bus.on('view:activated', (page) => { if (page === 'staff') renderStaffTab(); });

/* ── Swipe-to-reveal (Block/Delete) + drag-to-reorder ──
   Both are Pointer Events (unifies touch + mouse), delegated once each
   as pointerdown/pointermove/pointerup on #app in event-delegation.js,
   which forwards to the three functions below. Kept in Pages (not
   Components, which must stay pure-render) since this is event/gesture
   logic, not markup. */
let swipeState = null; // { front, startX, startY, dx, decided, isHorizontal }
let dragState = null;  // { wrap, list, startY }

const SWIPE_OPEN_PX = 132; // matches .staff-swipe-actions width in app.css
const SWIPE_OPEN_THRESHOLD = 60;

function closeOpenSwipeCards(except) {
  document.querySelectorAll('.staff-card-front[data-swipe-open="1"]').forEach(el => {
    if (el === except) return;
    el.style.transform = '';
    el.dataset.swipeOpen = '0';
  });
}

export function handleStaffPointerDown(e) {
  const handle = e.target.closest('[data-action="staff-drag-handle"]');
  if (handle) {
    const wrap = handle.closest('.staff-card-wrap');
    const list = $('staff-card-list');
    if (!wrap || !list) return;
    e.preventDefault();
    dragState = { wrap, list, startY: e.clientY };
    wrap.classList.add('dragging');
    wrap.setPointerCapture && wrap.setPointerCapture(e.pointerId);
    return;
  }
  const front = e.target.closest('.staff-card-front');
  if (front && !e.target.closest('button, a, input')) {
    closeOpenSwipeCards();
    swipeState = { front, startX: e.clientX, startY: e.clientY, dx: 0, decided: false, isHorizontal: false };
  }
}

export function handleStaffPointerMove(e) {
  if (dragState) {
    e.preventDefault();
    const dy = e.clientY - dragState.startY;
    dragState.wrap.style.transform = `translateY(${dy}px)`;
    const items = Array.from(dragState.list.querySelectorAll('.staff-card-wrap'));
    const currentIndex = items.indexOf(dragState.wrap);
    let targetIndex = currentIndex;
    items.forEach((el, i) => {
      if (el === dragState.wrap) return;
      const mid = el.getBoundingClientRect().top + el.offsetHeight / 2;
      if (i < currentIndex && e.clientY < mid) targetIndex = Math.min(targetIndex, i);
      if (i > currentIndex && e.clientY > mid) targetIndex = Math.max(targetIndex, i);
    });
    if (targetIndex !== currentIndex) {
      const ref = items[targetIndex];
      dragState.list.insertBefore(dragState.wrap, targetIndex < currentIndex ? ref : ref.nextSibling);
      dragState.startY = e.clientY; // reset baseline so the lifted card doesn't jump after the swap
      dragState.wrap.style.transform = 'translateY(0px)';
    }
    return;
  }
  if (!swipeState) return;
  const dx = e.clientX - swipeState.startX;
  const dy = e.clientY - swipeState.startY;
  if (!swipeState.decided) {
    if (Math.abs(dx) < 6 && Math.abs(dy) < 6) return;
    swipeState.decided = true;
    swipeState.isHorizontal = Math.abs(dx) > Math.abs(dy);
    if (!swipeState.isHorizontal) { swipeState = null; return; } // vertical drag = page scroll, not a swipe
  }
  const alreadyOpen = swipeState.front.dataset.swipeOpen === '1';
  const clamped = Math.max(-SWIPE_OPEN_PX, Math.min(0, dx + (alreadyOpen ? -SWIPE_OPEN_PX : 0)));
  swipeState.dx = clamped;
  swipeState.front.style.transform = `translateX(${clamped}px)`;
}

export function handleStaffPointerUp() {
  if (dragState) {
    dragState.wrap.classList.remove('dragging');
    dragState.wrap.style.transform = '';
    const newOrder = Array.from(dragState.list.querySelectorAll('.staff-card-wrap')).map(el => el.dataset.staffId);
    Actions.reorderStaff(newOrder);
    dragState = null;
    return;
  }
  if (swipeState) {
    const open = swipeState.dx <= -SWIPE_OPEN_THRESHOLD;
    swipeState.front.style.transform = open ? `translateX(-${SWIPE_OPEN_PX}px)` : '';
    swipeState.front.dataset.swipeOpen = open ? '1' : '0';
    swipeState = null;
  }
}

export function initStaffPages() {
  const clickHandlers = {
    'staff-toggle-expand': (el) => {
      const id = el.dataset.staffId;
      staffExpandedIds.has(id) ? staffExpandedIds.delete(id) : staffExpandedIds.add(id);
      renderStaffTab();
    },
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
