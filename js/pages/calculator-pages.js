import { Actions, Bus } from '../actions.js';

/* ══════════════════════════════════════════════════════════════
   FLOOR 5 — PAGES / calculator-pages.js
   Global counting-helper calculator. Available on every screen
   (legacy Verify Stock, Team Audit counting, Individual counting)
   behind one floating button, so any auditor — Main or Sub — can
   work out "6 boxes × 10 + 4 loose" without leaving the count
   screen, and drop the result straight into whichever Count box
   they last tapped.

   Deliberately has no Actions/Store involvement: the running total
   is throwaway UI state, exactly like the search/filter state kept
   locally in sub-pages.js and engagement-pages.js. Nothing here is
   persisted or synced — closing the calculator forgets it, same as
   a pocket calculator.
   ══════════════════════════════════════════════════════════════ */

const $ = (id) => document.getElementById(id);
const MAX_DIGITS = 12;

let current = '0';       // the number currently being typed/shown
let stored = null;       // left-hand operand once an operator is picked
let pendingOp = null;    // '+' | '−' | '×' | '÷' | null
let resetOnNextDigit = false;
let exprLabel = '';      // small line above the display, e.g. "212 +"

// The most recently focused .audit-count-input, so ✓ Insert has
// somewhere to go. Shared across the legacy single-auditor table and
// the Team Audit counting table since both reuse .audit-count-input.
let lastCountInput = null;
export function setLastCountInput(el) { lastCountInput = el; }

function fmt(n) {
  if (!isFinite(n)) return 'Error';
  const rounded = Math.round(n * 1e6) / 1e6; // kill float noise (0.1+0.2 etc.)
  return String(rounded);
}

function compute(a, op, b) {
  switch (op) {
    case '+': return a + b;
    case '−': return a - b;
    case '×': return a * b;
    case '÷': return b === 0 ? NaN : a / b;
    default: return b;
  }
}

function _hasTarget() {
  return !!(lastCountInput && document.body.contains(lastCountInput) && !lastCountInput.disabled);
}

function render() {
  const displayEl = $('calc-display');
  const exprEl = $('calc-expr');
  if (displayEl) displayEl.textContent = current;
  if (exprEl) exprEl.textContent = exprLabel;
  const hint = $('calc-insert-hint');
  const targetEl = $('calc-target');
  const hasTarget = _hasTarget();
  if (hint) hint.style.display = hasTarget ? 'none' : 'block';
  if (targetEl) {
    if (hasTarget) {
      const name = lastCountInput.dataset.itemName || 'this item';
      targetEl.textContent = `📌 Will insert into: ${name}`;
      targetEl.style.display = 'block';
    } else {
      targetEl.style.display = 'none';
    }
  }
}

// Fresh calc session. If the target Count box already has a value in it,
// that becomes the starting point (so "add 3 more" is just "+ 3 =" instead
// of having to re-type the existing count first) — otherwise starts at 0.
function resetCalc() {
  const existing = _hasTarget() ? parseFloat(lastCountInput.value) : NaN;
  current = isFinite(existing) ? fmt(existing) : '0';
  stored = null; pendingOp = null; resetOnNextDigit = false; exprLabel = '';
}

function pressDigit(d) {
  if (resetOnNextDigit) { current = d === '.' ? '0.' : d; resetOnNextDigit = false; return; }
  if (d === '.') { if (!current.includes('.')) current += '.'; return; }
  if (current.replace(/[-.]/g, '').length >= MAX_DIGITS) return;
  current = current === '0' ? d : current + d;
}

function pressOperator(op) {
  const val = parseFloat(current);
  if (pendingOp && !resetOnNextDigit) {
    stored = compute(stored, pendingOp, val);
    current = fmt(stored);
  } else {
    stored = val;
  }
  pendingOp = op;
  resetOnNextDigit = true;
  exprLabel = `${fmt(stored)} ${op}`;
}

function pressEquals() {
  if (pendingOp === null) return;
  const val = parseFloat(current);
  const result = compute(stored, pendingOp, val);
  exprLabel = `${fmt(stored)} ${pendingOp} ${fmt(val)} =`;
  current = fmt(result);
  stored = null;
  pendingOp = null;
  resetOnNextDigit = true;
}

function pressBackspace() {
  if (resetOnNextDigit) return;
  current = current.length > 1 ? current.slice(0, -1) : '0';
  if (current === '-' || current === '') current = '0';
}

function pressPercent() {
  current = fmt(parseFloat(current) / 100);
}

function pressSign() {
  if (current !== '0') current = current.startsWith('-') ? current.slice(1) : '-' + current;
}

function openCalculator() {
  const overlay = $('calculator-overlay');
  if (!overlay) return;
  overlay.style.display = 'flex';
  render();
}

function closeCalculator() {
  const overlay = $('calculator-overlay');
  if (overlay) overlay.style.display = 'none';
}

function insertIntoField() {
  if (!lastCountInput || !document.body.contains(lastCountInput) || lastCountInput.disabled) {
    Bus.emit('toast', { msg: 'Tap a Count box first, then Insert', kind: 'error' });
    return;
  }
  const val = parseFloat(current);
  if (!isFinite(val)) { Bus.emit('toast', { msg: 'Calculator result is not a valid number', kind: 'error' }); return; }
  lastCountInput.value = fmt(val);
  // Same field is wired to data-input-action="record-assignment-count" (or
  // the legacy equivalent) via the app's single delegated 'input' listener
  // — dispatching a real input event is what actually saves the count and
  // recalculates variance, exactly as if the auditor had typed it.
  lastCountInput.dispatchEvent(new Event('input', { bubbles: true }));
  Bus.emit('toast', { msg: 'Inserted into count field', kind: 'success' });
  closeCalculator();
  lastCountInput.focus();
}

// ── Draggable FAB ─────────────────────────────────────────────
// The button starts in the bottom-right corner (plain CSS), but any
// auditor can drag it wherever it's out of their way — over an empty
// area of whichever screen they're on — and it stays there (per
// device, via Actions.saveCalcFabPosition) until dragged again.
// Deliberately its own small, self-contained pointer listeners on the
// button itself rather than routed through the app's single delegated
// click/data-action system: dragging is a one-off physical gesture on
// one specific element, not app business logic.
const FAB_MARGIN = 8;

function _fabSize(btn) { return { w: btn.offsetWidth || 52, h: btn.offsetHeight || 52 }; }

function _clampFabPosition(btn, pos) {
  const { w, h } = _fabSize(btn);
  const maxLeft = Math.max(FAB_MARGIN, window.innerWidth - w - FAB_MARGIN);
  const maxTop = Math.max(FAB_MARGIN, window.innerHeight - h - FAB_MARGIN);
  return {
    left: Math.min(Math.max(pos.left, FAB_MARGIN), maxLeft),
    top: Math.min(Math.max(pos.top, FAB_MARGIN), maxTop),
  };
}

function _applyFabPosition(btn, pos) {
  const clamped = _clampFabPosition(btn, pos);
  btn.style.left = clamped.left + 'px';
  btn.style.top = clamped.top + 'px';
  btn.style.right = 'auto';
  btn.style.bottom = 'auto';
}

function _initFabDragging() {
  const btn = $('calculator-fab');
  if (!btn || typeof window.PointerEvent === 'undefined') return; // graceful no-op on ancient browsers — tap still opens it

  const saved = Actions.getSavedCalcFabPosition();
  if (saved) _applyFabPosition(btn, saved);

  let dragging = false;
  let moved = false;
  let startX = 0, startY = 0, startLeft = 0, startTop = 0;

  btn.addEventListener('pointerdown', (e) => {
    dragging = true; moved = false;
    startX = e.clientX; startY = e.clientY;
    const rect = btn.getBoundingClientRect();
    startLeft = rect.left; startTop = rect.top;
    try { btn.setPointerCapture(e.pointerId); } catch { /* unsupported — drag still works via move/up on the button */ }
  });

  btn.addEventListener('pointermove', (e) => {
    if (!dragging) return;
    const dx = e.clientX - startX;
    const dy = e.clientY - startY;
    if (!moved && Math.hypot(dx, dy) > 6) { moved = true; btn.classList.add('calc-fab-dragging'); }
    if (!moved) return;
    _applyFabPosition(btn, { left: startLeft + dx, top: startTop + dy });
  });

  const endDrag = () => {
    if (!dragging) return;
    dragging = false;
    btn.classList.remove('calc-fab-dragging');
    if (moved) {
      const rect = btn.getBoundingClientRect();
      Actions.saveCalcFabPosition({ left: rect.left, top: rect.top });
    }
  };
  btn.addEventListener('pointerup', endDrag);
  btn.addEventListener('pointercancel', endDrag);

  // A drag release still fires a native 'click' right after — swallow
  // just that one so repositioning the button doesn't also pop the
  // calculator open. A plain tap (moved stays false) is untouched and
  // reaches the app's normal data-action="open-calculator" handler.
  btn.addEventListener('click', (e) => {
    if (moved) { e.stopPropagation(); e.preventDefault(); moved = false; }
  });

  window.addEventListener('resize', () => {
    const rect = btn.getBoundingClientRect();
    if (btn.style.left) _applyFabPosition(btn, { left: rect.left, top: rect.top });
  });
}

export function initCalculatorPage() {
  _initFabDragging();
  const clickHandlers = {
    'open-calculator': () => { resetCalc(); openCalculator(); },
    'close-calculator': closeCalculator,
    'calc-clear': () => { resetCalc(); render(); },
    'calc-backspace': () => { pressBackspace(); render(); },
    'calc-percent': () => { pressPercent(); render(); },
    'calc-sign': () => { pressSign(); render(); },
    'calc-equals': () => { pressEquals(); render(); },
    'calc-insert': insertIntoField,
    'calc-key': (el) => {
      const key = el.dataset.key;
      if (key === '.') pressDigit('.');
      else if (['+', '−', '×', '÷'].includes(key)) pressOperator(key);
      else pressDigit(key);
      render();
    },
  };
  return { clickHandlers, inputHandlers: {}, changeHandlers: {}, keydownHandlers: {} };
}
