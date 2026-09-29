# Fazal Din Pharma Plus — Audit Hub

A pharmacy stock-audit platform built as an installable PWA. It covers the whole audit lifecycle: import stock, split the work across staff, count on phones (offline-capable), compile variances, recount only what disagrees, and lock a final signed-off result. It also includes a shared near-expiry tracker.

Live at `random.duapharma.com` (see `CNAME`). No framework and no build step: plain ES modules served from any static host.

---

## 1. What the app does

| Area | What it gives you |
|---|---|
| **Inventory** | Product table synced from Dropbox (or manual CSV). Search by code, name, generic, company or supplier. Group by company or supplier. Save selections as reusable **Templates**. Launch a random audit straight from a selection. |
| **Team Audit → Engagements** | A Main Auditor creates an engagement, builds rounds, auto-splits work across staff, locks the round, compiles results, and repeats with focused recounts until a **Final Snapshot** is locked. |
| **Team Audit → Staff** | Create logins (name, phone, PIN), reset PINs, block users, set an access-expiry date, promote or demote roles, and send login details by WhatsApp with one tap. |
| **Team Audit → Individual** | Staff self-service audits: any Sub-Auditor picks a Template or company and starts counting without waiting for an engagement. All picks land in an auto-rolling monthly engagement ("Individual Assignments — <Month>"). |
| **Team Audit → Expiry** | Shared, month-wise log of near-expiry stock (product, quantity, expiry month, rack, status). Monthly rack→staff assignment, universal search, and locked entries that only the Main Auditor can reopen. |
| **Verify Stock (legacy)** | The original single-person audit: count, sign off, save to History, export to PDF / Excel / WhatsApp. |
| **Sync & Tools** | Dropbox inventory sync, CSV upload fallback, branch name, Settings PIN, text-size scaling, full backup and restore, Supabase project settings. |
| **Counting calculator** | Floating, draggable calculator on every count screen (e.g. "6 boxes × 10 + 4 loose") that inserts the result into the last-tapped count box. |
| **Android widget** | Companion app (`AuditWidget/`) showing open Individual rounds, assignee and progress on the Main Auditor's home screen. |

### Counting and variance rules
- **Uncounted = 0.** An item never typed defaults to a full assumed shortage, so nothing silently drops out of a report. "Mark Remaining as Match" / Force Submit's match mode is the only sanctioned override, and those rows are flagged `auto_matched` in reports.
- **Fresh cutoff.** Each round freezes a snapshot of live inventory when it is generated; later rounds re-base on current stock and pick up new SKUs.
- **Compile** merges submissions keyed by **Company + Item ID**, blocks if anyone has not submitted (unless "Compile Anyway"), and flags cross-round conflicts for the Main Auditor to resolve — never auto-resolved.
- **Next round modes:** Differences Only, Full Company Recount, Random Spot-Check.
- **Corrections workflow.** A Deputy or Sub-Auditor can propose a corrected count with a reason; the Main Auditor approves or rejects. The original raw count is never overwritten.
- **Time tracking.** Assignment start time plus per-row seconds (capped per row so a break isn't misattributed).
- **Live progress.** The Main Auditor sees per-person progress bars, refreshed about every 15 seconds.

### Reports (all `.xlsx`)
Final Audit Report, Variance Report (with Auditor Notes and Cross-Round Conflicts sheets), Combined Variance Report, Round History, Submission History (digital sign-off log), Audit Trail, Inventory Report.

---

## 2. Roles

| Role | Access |
|---|---|
| **Main** (owner/manager) | Everything: inventory, engagements, rounds, assignments, compile, staff management, reports, settings. |
| **Dep** (Deputy Auditor) | Read-only on engagements, rounds, assignments and submissions. Can propose variance corrections. |
| **Sub** (Sub-Auditor) | Sees only their own assignments, self-service Individual audits, and the shared Expiry log. |

Everyone logs in with **phone + PIN**. There is no separate admin mode, just a `role` on the staff row.

---

## 3. Architecture — the 5-Floor structure

```
Floor 5 — PAGES        DOM rendering + the one set of event listeners
Floor 4 — COMPONENTS   Pure render functions (data in, HTML out)
Floor 3 — ACTIONS      All business logic; the only code allowed to mutate state
Floor 2 — STORE        One in-memory state object (getState / setState)
Floor 1 — REPOSITORY   All storage: IndexedDB, localStorage, Dropbox, Supabase
```

Each floor talks to the one below through a single barrel file (`js/pages.js`, `js/components.js`, `js/actions.js`, `js/store.js`, `js/repository.js`). Rules:

- Storage and network calls live only in `js/repository/*`.
- `Store.setState(` is called only from `js/actions/*`.
- No `window.x = ...` globals.
- One `addEventListener` per event type, all in `js/pages/event-delegation.js`; elements carry `data-action="..."`.
- Components never import Actions, Repository or Store.
- Actions talk to Pages through a small event `Bus` (toasts, change notifications).

### Project layout

```
index.html            App shell (all pages, tab bar, PWA banner)
manifest.json, sw.js  PWA manifest + service worker (network-first, offline fallback)
css/                  app.css, engagement.css, desktop.css, design-upgrade.css
js/
  main.js             Entry point
  store/              store.js, initial-state.js
  repository/         supabase, db (IndexedDB), storage (localStorage), dropbox,
                      legacy, templates, expiry
  actions/            auth, staff, engagement, round, assignment, counting,
                      compile, difference, snapshot, individual, variance-edit,
                      report, dashboard, inventory, expiry, calculator, audit-log
  components/         pure render functions per feature
  pages/              engagement, staff, expiry, inventory, auth, legacy,
                      calculator, home-stats, sub-pages, event-delegation
supabase/
  schema.sql          Tables, RLS policies, helper functions, triggers (safe to re-run)
  admin-actions/      Edge Function for privileged staff actions
tests/                12 test files (node:test)
AuditWidget/          Android home-screen widget (Kotlin) + README
.github/workflows/    Builds the widget APK
BLUEPRINT_v1_original.md   Original design blueprint
```

---

## 4. Workflows

### Team audit (Main Auditor)
1. **Import inventory** via Dropbox sync or CSV, and create staff logins in the Staff tab.
2. **Create an engagement** (Full Inventory / Selected Companies / Single Company).
3. **Create Round 1** (company-level).
4. **Assign work** by auto-split (company count or item volume) with a preview before saving, or manually via "Move to…". A company always goes to exactly one person.
5. **Lock the round.** Staff see their assignment on next login; nothing to send.
6. **Staff count** offline-capable, with autosave, search, per-item notes, then submit.
7. **Compile** and review variances (sort by financial impact, filter by value range).
8. **Generate Final Snapshot**, or **Generate Next Round** (item-level, auto-split) and repeat from step 5.
9. **Export reports.**

### Expiry tracking
Main Auditor defines racks in Settings and assigns racks to staff each month. Staff log near-expiry stock (locked on save). Everyone can search any product at any time. Only the Main Auditor can reopen, edit or delete an entry.

---

## 5. Tech stack

- **Frontend:** vanilla ES modules, no bundler.
- **Supabase:** Auth, Postgres with Row Level Security, and an Edge Function (`admin-actions`).
- **Dropbox:** inventory pull-only sync.
- **IndexedDB / localStorage:** local products, history and offline counting checkpoints.
- **SheetJS:** all Excel exports. **Supabase JS** and SheetJS load from CDNs.
- **Service worker:** installable PWA, offline asset caching.
- **Android widget:** Kotlin, WorkManager, EncryptedSharedPreferences, built by GitHub Actions.

---

## 6. Security model

- **Real accounts.** Every login is a Supabase Auth user. The phone number maps to `<digits>@staff.internal`, and the PIN is the account password.
- **Row Level Security is the lock.** Policies check `auth.uid()` on every request. Sub-Auditors cannot read engagements, rounds, compiled data, other people's assignments, or the audit log, whatever the client asks for.
- **Column-level trigger.** Sub-Auditors can update only the `status` of their own assignment, not its items or scope.
- **Engagement state is enforced in the database.** `is_engagement_open()` stops submissions to closed engagements.
- **Expiry locking.** Sub-Auditors get INSERT only on `expiry_entries`; no UPDATE policy exists for them.
- **Access expiry** is checked in the database on every request (`is_access_valid()`).
- **Service-role key** lives only inside the Edge Function. The browser holds only the public anon/publishable key.
- **Edge Function guardrails.** Only a Main Auditor can call it. Main accounts cannot be blocked, deleted or demoted through it.
- **Audit log.** Significant actions are written to Postgres, queued locally and retried if offline.

---

## 7. Setup

1. **Database.** Supabase Dashboard → SQL Editor → paste all of `supabase/schema.sql` → Run. Safe to re-run.
2. **Edge Function.** Dashboard → Edge Functions → Deploy a new function → Via Editor. Name it `admin-actions` and paste `supabase/admin-actions/index.ts`. Supabase provides `SUPABASE_SERVICE_ROLE_KEY` automatically. If it errors, set it under **Secrets**. Never paste that key anywhere else.
   - CLI alternative: `supabase functions deploy admin-actions`.
   - Note: `schema.sql` refers to a `sync-inventory-from-dropbox` function that writes `inventory_products`. It is not in this repo; deploy it separately if you use server-side inventory sync.
3. **First Main Auditor.**
   - Dashboard → Authentication → Users → Add user: email `<phone digits>@staff.internal`, password = your PIN, tick Auto Confirm.
   - Table Editor → `staff` → Insert row: `id` (the new user's id), `name`, `phone` (digits), `role` = `main`.
   - Everyone after that is created inside the app.
4. **Open the app** and log in with phone + PIN.

To use a different Supabase project: Sync & Tools → Settings → Team Audit — Supabase Project → paste URL and anon key → Save & Reload (then repeat steps 1–3 there).

### Android widget
See `AuditWidget/README.md`. Run the **Build Individual Rounds Widget APK** workflow, install the debug APK on the Main Auditor's phone, log in once, add the widget.

---

## 8. Development

```bash
npm test        # node --test tests/*.test.mjs  (100 tests)
```

Tests cover compile/merge logic, item keys, the uncounted-equals-zero rule, force submit, round overlap and renumbering, variance corrections, live snapshots, row timing, product search, extra notes and individual assignments.

Any static host works (GitHub Pages is currently used). Serve over HTTPS so the service worker and install prompt work. Bump `CACHE_NAME` in `sw.js` when shipping changes.

---

## 9. Scope and known gaps

**Not built:** direct POS integration, barcode scanning, multi-branch audits, push notifications, analytics/AI features, scheduled audits, a regulatory compliance dashboard.

**Known gaps:** manual rebalance is a tap-based "Move to…" picker (no drag-and-drop); assignment templates for engagements are not built; the Android widget is debug-signed only; a few Supabase auth edge cases (session validity at the exact moment of a block) have not been tested against a live project.
