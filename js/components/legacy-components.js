import { esc } from './dom-utils.js';

/* ══════════════════════════════════════════════════════════════
   FLOOR 4 — COMPONENTS / legacy-components.js
   Everything from the original single-auditor app (Verify Stock
   table rows, History timeline/accordion, printable PDF sections)
   has been removed now that Individual Assignments (see
   individual-actions.js) and Team Audit fully cover that workflow.

   varianceCellHTML is the one survivor: it's shared with the Team
   Audit counting screen (sub-pages.js), which reuses it verbatim
   rather than duplicating the uncounted=0 rule's display logic in a
   second place.
   ══════════════════════════════════════════════════════════════ */

// The uncounted=0 rule, applied live: an item nobody has typed a value
// for shows its FULL assumed shortage here (countedQty=0), not a blank
// "—" — but visually muted (lower opacity, no red alarm weight) so
// it's clearly an assumption, not a physical finding, and a small
// "assumed" hint distinguishes it from a real confirmed-zero count.
// isAutoMatched carries the same muted treatment, since "Mark
// Remaining as Match" resolves the number without anyone actually
// counting it.
export function varianceCellHTML(countedVal, qty, price, isAutoMatched) {
  const touched = countedVal !== undefined && countedVal !== '';
  const missing = !touched || !!isAutoMatched;
  const effectiveQty = touched ? parseFloat(countedVal) : 0;
  const delta = effectiveQty - qty;
  const mutedStyle = missing ? ' style="opacity:0.6;"' : '';
  const hint = missing ? `<div style="font-size:9px; color:var(--gold-ink); font-weight:700; margin-top:1px;">${isAutoMatched ? 'auto-matched' : 'assumed'}</div>` : '';
  if (delta === 0) return `<span class="diff-zero"${mutedStyle}>0</span>${hint}`;
  const rupeeDelta = delta * price;
  const sign = delta > 0 ? '+' : '';
  const cls = delta > 0 ? 'diff-pos' : 'diff-neg';
  return `<span class="${cls}"${mutedStyle}>${sign}${delta}</span><div style="font-size:10px; color:var(--grey); margin-top:2px;">${sign}Rs ${Math.abs(rupeeDelta).toLocaleString()}</div>${hint}`;
}
