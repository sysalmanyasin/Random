import { esc, toastNode } from './dom-utils.js';
import * as Legacy from './legacy-components.js';
import * as Engagement from './engagement-components.js';
import * as RoundC from './round-components.js';
import * as AssignmentC from './assignment-components.js';
import * as CountingC from './counting-components.js';
import * as CompileC from './compile-components.js';
import * as DashboardC from './dashboard-components.js';
import * as ReportC from './report-components.js';
import * as LoginC from './login-components.js';
import * as StaffC from './staff-components.js';

/* ══════════════════════════════════════════════════════════════
   FLOOR 4 — COMPONENTS (barrel)
   Pure render functions only — no Repo, no Store.setState, no
   Bus.emit anywhere in this floor. Every function here takes data
   in, returns a DOM node or an HTML string, nothing else.
   ══════════════════════════════════════════════════════════════ */
export const Components = {
  esc, toastNode,
  ...Legacy,
  ...Engagement,
  ...RoundC,
  ...AssignmentC,
  ...CountingC,
  ...CompileC,
  ...DashboardC,
  ...ReportC,
  ...LoginC,
  ...StaffC,
};
