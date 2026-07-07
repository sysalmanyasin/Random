import { createInitialState } from './initial-state.js';

/* ══════════════════════════════════════════════════════════════
   FLOOR 2 — STATE STORE
   One protected AppState, one source of truth.

   Golden rule: grep the whole codebase for `Store.setState(` or
   `setState(` outside js/actions/* — it must return zero matches.
   Only Floor 3 (Actions) may mutate state. Every other floor reads
   via Store.getState() and reacts to Bus events.
   ══════════════════════════════════════════════════════════════ */

let state = createInitialState();

function getState() { return state; }

// setState is exported from this module, but by convention (enforced by
// file-boundary grep, per the blueprint's acceptance checks) only files
// under js/actions/* are allowed to import and call it. Every other
// module only ever imports { getState }.
function setState(patch) { state = Object.assign({}, state, patch); }

export const Store = { getState, setState };
