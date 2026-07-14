/* ══════════════════════════════════════════════════════════════
   FLOOR 2 — STORE / initial-state.js
   Pure data — the shape of the one AppState. No logic lives here.
   ══════════════════════════════════════════════════════════════ */
export function createInitialState() {
  return {
    // ── inventory + Dropbox (pull-only) + local backup ──
    products: [],
    dbxClient: null,
    autoSyncTimer: null,

    // ── Supabase client + auth session ──
    sbClient: null,
    authSession: null,       // Supabase Auth session, or null if logged out
    authChecked: false,      // true once the initial session check has resolved
    authError: '',

    // ── identity / role, now derived from a REAL login (staff table row) ──
    // 'main' = Main Auditor (sees everything, RLS grants full access).
    // 'sub'  = Sub-Auditor (RLS restricts to their own assignment/submission).
    role: null,
    currentAuditorId: null,
    currentAuditorName: '',
    accessExpiresAt: null,

    // ── multi-auditor domain slice — Main Auditor's working set,
    //    fetched from Supabase (repository/supabase.js) ──
    engagements: [],
    currentEngagementId: null,
    rounds: [],              // rounds for the currently open engagement
    assignments: [],         // assignments for the currently open round
    staff: [],               // full staff roster (Main Auditor's Staff tab)
    submissions: [],         // submissions for the currently open round
    compiledRounds: [],      // compiled rounds for the currently open engagement
    finalSnapshots: [],
    auditLog: [],

    // ── Sub-Auditor's own working set — fetched live from Supabase,
    //    scoped by RLS to only what belongs to them. No "pairing
    //    payload" anymore; this is just a normal filtered query. ──
    myAssignments: [],
    activeAssignmentId: null, // which of myAssignments is open for counting
    myCounts: {},             // local counts for the open assignment, pre-submit
    myNotes: {},              // local per-item notes for the open assignment
    myConfirms: {},           // itemKey -> true when "Same" was tapped to re-apply last round's variance
    myExtraNote: '',          // free-text "items found but not in inventory" note, not itemKey-scoped
    myRowTimes: {},           // itemKey -> seconds spent on that row (see counting-actions.js MAX_ROW_SECONDS)
    // itemKey -> true for items resolved via "Mark Remaining as Match"
    // (or Force Submit's equivalent), NOT physically counted. Under the
    // uncounted=0 rule, this is the only path that can make an item
    // stop reading as a full assumed-shortage variance without someone
    // actually having counted it — see counting-actions.js markRemainingAsMatch.
    myAutoMatched: {},

    // ── UI-only working state for the new Engagement Hub ──
    engagementDraftScope: { type: 'full', companies: [] },

    // ── Inventory tab (searchable/groupable browser + Templates) ──
    inventorySearchQuery: '',
    inventoryGroupBy: 'none',        // 'none' | 'company' | 'supplier'
    inventorySelectedCodes: [],      // product codes checked in the browser right now
    templates: [],                   // saved {id, name, codes, createdAt, updatedAt}
    activeTemplateId: null,          // which saved template is currently loaded, if any
    resolvedTemplateMatch: null,     // { matched, total } for the loaded template/selection
  };
}
