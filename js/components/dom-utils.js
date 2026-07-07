/* ══════════════════════════════════════════════════════════════
   FLOOR 4 — COMPONENTS / dom-utils.js
   Tiny pure helpers shared by every component module.
   ══════════════════════════════════════════════════════════════ */

// FIX (kept from original): escapes quotes too, not just & < > —
// previously a company or medicine name containing a double-quote
// could break out of an HTML attribute (e.g. data-company="...")
// and corrupt the DOM.
export function esc(str) {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function toastNode(message, kind = 'success') {
  const node = document.createElement('div');
  node.className = `toast ${kind}`;
  node.textContent = message;
  return node;
}
