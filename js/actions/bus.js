/* ══════════════════════════════════════════════════════════════
   FLOOR 3 — ACTIONS / bus.js
   The one Event Bus, shared by every actions/* module and by
   Pages. Announces state changes; never carries logic itself.
   ══════════════════════════════════════════════════════════════ */
export const Bus = (() => {
  const handlers = {};
  return {
    on(evt, fn) { (handlers[evt] = handlers[evt] || []).push(fn); },
    emit(evt, payload) { (handlers[evt] || []).forEach(fn => fn(payload)); },
  };
})();
