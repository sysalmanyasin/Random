import { Bus } from '../actions.js';

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

function render() {
  const displayEl = $('calc-display');
  const exprEl = $('calc-expr');
  if (displayEl) displayEl.textContent = current;
  if (exprEl) exprEl.textContent = exprLabel;
  const hint = $('calc-insert-hint');
  if (hint) {
    const hasTarget = !!(lastCountInput && document.body.contains(lastCountInput) && !lastCountInput.disabled);
    hint.style.display = hasTarget ? 'none' : 'block';
  }
}

function resetCalc() {
  current = '0'; stored = null; pendingOp = null; resetOnNextDigit = false; exprLabel = '';
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

export function initCalculatorPage() {
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
