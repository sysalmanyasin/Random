import { Repo } from '../repository.js';

/* ══════════════════════════════════════════════════════════════
   FLOOR 3 — ACTIONS / calculator-actions.js
   The only piece of the counting calculator that counts as
   "business logic" — remembering where an auditor dragged the
   floating button to, per device, so it doesn't reset to the
   corner (and back over whatever it was covering) every reload.
   Everything else about the calculator (keypad, drag math, the
   overlay itself) is throwaway UI state that lives entirely in
   js/pages/calculator-pages.js, same as this app's other
   local-only view state.
   ══════════════════════════════════════════════════════════════ */

const FAB_POSITION_KEY = 'calcFabPosition';

function getSavedCalcFabPosition() {
  return Repo.LS.getJSON(FAB_POSITION_KEY, null); // { left, top } in px, or null = default corner
}

function saveCalcFabPosition(pos) {
  Repo.LS.setJSON(FAB_POSITION_KEY, pos);
}

export const CalculatorActions = { getSavedCalcFabPosition, saveCalcFabPosition };
