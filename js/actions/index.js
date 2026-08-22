import { Repo } from '../repository.js';
import { Store } from '../store.js';
import { Bus } from './bus.js';
import { LegacyActions } from './legacy-actions.js';
import { logAudit, loadAuditLogList, retryQueuedAuditLog } from './audit-log-actions.js';
import { AuthActions } from './auth-actions.js';
import { StaffActions } from './staff-actions.js';
import { EngagementActions } from './engagement-actions.js';
import { RoundActions } from './round-actions.js';
import { AssignmentActions } from './assignment-actions.js';
import { CountingActions } from './counting-actions.js';
import { CompileActions } from './compile-actions.js';
import { DifferenceActions } from './difference-actions.js';
import { SnapshotActions } from './snapshot-actions.js';
import { ReportActions } from './report-actions.js';
import { DashboardActions } from './dashboard-actions.js';
import { InventoryActions } from './inventory-actions.js';
import { IndividualActions } from './individual-actions.js';
import { CalculatorActions } from './calculator-actions.js';

/* ══════════════════════════════════════════════════════════════
   FLOOR 3 — ACTIONS (barrel)
   The one door. Every state change in the whole app happens by
   calling an Actions.* function, which talks to Repo, updates
   Store, then announces via Bus.

   Multi-auditor identity now comes from a real Supabase login
   (auth-actions.js) instead of a pairing link — once logged in,
   Bus emits 'auth:loggedIn' and this barrel loads exactly the
   right data set for that role: the Main Auditor's full working
   set, or a Sub-Auditor's own assignments (RLS-filtered either way).
   ══════════════════════════════════════════════════════════════ */

async function bootstrap() {
  await Repo.openDB();
  await LegacyActions.bootstrapLegacy();
  await AuthActions.bootstrapAuth();
}

Bus.on('auth:loggedIn', async (profile) => {
  await retryQueuedAuditLog();
  if (profile.role === 'main') {
    await EngagementActions.loadEngagementsList();
    await StaffActions.loadStaffRoster();
    await loadAuditLogList();
    await CountingActions.loadMyAssignments(); // picks up any self-assigned work too
  } else {
    await CountingActions.loadMyAssignments();
  }
  // Shared inventory (server-synced from Dropbox) — every role needs
  // the same live product data, so this isn't role-gated. Cheap read
  // of the already-synced table; never triggers a Dropbox pull itself
  // (see legacy-actions.js loadInventoryFromSupabase / triggerInventorySync).
  await LegacyActions.loadInventoryFromSupabase(true);
  await InventoryActions.pullCloudTemplates();
  if (profile.interactive) Bus.emit('nav:goto', 'team');
});

export const Actions = {
  ...LegacyActions,
  ...AuthActions,
  ...StaffActions,
  ...EngagementActions,
  ...RoundActions,
  ...AssignmentActions,
  ...CountingActions,
  ...CompileActions,
  ...DifferenceActions,
  ...SnapshotActions,
  ...ReportActions,
  ...DashboardActions,
  ...InventoryActions,
  ...IndividualActions,
  ...CalculatorActions,
  bootstrap,
  logAudit,
};

export { Bus };
