# Fazal Din Pharma Plus — Audit Hub

A pharmacy inventory audit app. One person can run a quick stock check on
one shelf, or a Main Auditor can run a full multi-company, multi-person
stock take with real staff logins, automatic work-splitting, and a
database-enforced guarantee that each staff member only ever sees their own
assigned work. Same app, same code, different scope.

Runs as a PWA (installable, works offline for counting) — no native app
store, no build step. Open `index.html` on any static host..

---

## 1. Scope — what this app actually does

**In scope, built and working:**
- Single-person inventory audit: import stock (CSV or Dropbox), pick a
  company, count it, save a signed-off record, export to PDF/Excel/WhatsApp.
- Multi-person inventory audit ("Team Audit"): one Main Auditor splits an
  entire inventory across any number of staff, each logs into their own
  device, counts only their assigned slice, submits. Main Auditor compiles
  everyone's results into one file, sees exactly which items disagree with
  system stock, and can send just those disagreements back out for a
  focused recount — repeating as many rounds as needed before locking a
  Final Snapshot.
- Staff management: create a login for someone, reset their PIN, block
  them, set their access to expire on a date, and hand them their login via
  a one-tap WhatsApp message — all from inside the app.
- Reporting: Final Audit Report, Variance Report, Round History, Submission
  History (doubles as a digital sign-off log), and a full Audit Trail — all
  exportable as `.xlsx`.

**Explicitly out of scope for this build** (see `BLUEPRINT.md` → "Future
Modules"): direct POS/Candela integration, barcode scanning, multi-branch
audits, push notifications, analytics, AI features, scheduled audits,
role tiers beyond Main/Sub-Auditor, a regulatory compliance dashboard.

**Known, disclosed gaps** (not silent — see `BLUEPRINT.md`'s "Honest
limitations" and "Post-build blueprint re-audit" sections for the full
list): manual rebalance is a tap-based "move to…" picker, not drag-and-drop;
assignment templates aren't built; a couple of Supabase auth edge-cases
(session validity right at the moment of a block) haven't been tested
against a live project yet.

---

## 2. Roles

**Main Auditor** — the pharmacy owner/manager. Has the full app: inventory
import, engagement/round/assignment management, staff management, compile
& variance review, reports, settings. Logs in with their own phone + PIN,
same as everyone else — there's no separate "admin mode," just a `role`
value on their own staff row.

**Sub-Auditor** — staff doing the counting. Logs in with phone + PIN (set
by the Main Auditor). Sees exactly one thing: whichever assignment(s) belong
to them. Nothing else in the app is reachable — not because the UI hides it,
but because the database itself won't return data that isn't theirs (see
§6, Security).

---

## 3. Architecture — the 5-Floor structure

Every file belongs to exactly one of five floors. Each floor talks to the
floor below it through exactly one "door" (a barrel file with the floor's
plain name), and never skips a floor or reaches sideways into another
floor's internals.

```
Floor 5 — PAGES        (DOM rendering + the one set of event listeners)
Floor 4 — COMPONENTS   (pure render functions — data in, HTML out, nothing else)
Floor 3 — ACTIONS      (all business logic + the only code allowed to mutate state)
Floor 2 — STORE        (one in-memory app state object — getState/setState)
Floor 1 — REPOSITORY   (all storage: IndexedDB, localStorage, Dropbox, Supabase)
```

**The rules that make this hold, checked by grep, not just convention:**
- No `localStorage.`, `sessionStorage.`, `indexedDB.`, Dropbox, or Supabase
  call exists anywhere outside `js/repository/*`.
- No `Store.setState(` call exists anywhere outside `js/actions/*`.
- No `window.someName = ...` global assignment exists anywhere in the app.
- Exactly one `addEventListener` per event type, all in
  `js/pages/event-delegation.js` — every clickable element just carries a
  `data-action="..."` attribute; nothing wires up its own listener.
- Components never import Actions, Repository, or Store — they only ever
  receive data as function arguments and return a DOM node or HTML string.

### File tree

```
index.html                          One shell. Every "page" is a hidden/
                                     shown <div>; tabs never navigate to a
                                     different URL.
manifest.json, sw.js                PWA install + offline asset caching.
CNAME                                Custom domain for GitHub Pages hosting.

css/
  app.css                           Original single-auditor styling (untouched).
  engagement.css                    Additive styling for Team Audit/Staff/Login screens.

js/repository.js                    Floor 1 door. Re-exports everything below as one `Repo` object.
js/repository/
  db.js                             IndexedDB schema + generic CRUD (legacy data only now).
  legacy.js                         Products / session-checkpoint / history-ledger storage.
  storage.js                        localStorage / sessionStorage wrapper.
  dropbox.js                        Dropbox network calls — inventory sync ONLY.
  supabase.js                       Supabase client, auth, and all multi-auditor table CRUD.

js/store.js                         Floor 2 door. Re-exports `Store` (getState/setState).
js/store/
  initial-state.js                  The shape of the one AppState object (data only).
  store.js                          getState/setState implementation.

js/actions.js                       Floor 3 door. Re-exports the merged `Actions` object + `Bus`.
js/actions/
  bus.js                            The shared event bus (on/emit).
  legacy-actions.js                 Original single-auditor logic (CSV import, sign-off, Dropbox sync, PIN gate, backups) — untouched.
  auth-actions.js                   Supabase login (phone+PIN), session bootstrap, role resolution.
  staff-actions.js                  Staff roster CRUD + admin actions (create/reset PIN/block/expire) + WhatsApp link builder.
  engagement-actions.js             Create/open/archive/close an engagement.
  round-actions.js                  Round state machine (Draft→Locked→Counting→Compiled→Final).
  assignment-actions.js             Auto-split (count/volume), manual rebalance, self-assign, revoke.
  item-key.js                       Shared Company+ItemID keying helper.
  counting-actions.js               Sub-Auditor's own counting: record count/note, submit.
  compile-actions.js                Merge submissions by Company+ItemID, detect variances.
  difference-actions.js             Differences-only / full-recount / spot-check item selection.
  snapshot-actions.js               Final Snapshot: freeze inventory, generate report.
  report-actions.js                 .xlsx export functions for every report type.
  dashboard-actions.js              Read-only aggregate queries for the dashboard views.
  audit-log-actions.js              logAudit() — writes to Supabase, retries if offline.
  index.js                          Merges every actions/* file into one `Actions` object + bootstrap().

js/components.js                    Floor 4 door. Re-exports the merged `Components` object.
js/components/
  dom-utils.js                      esc(), toastNode() — shared by every component file.
  legacy-components.js              Original render functions (company cards, audit rows, PDF sections) — untouched.
  login-components.js               Login screen, Supabase-config screen, logged-in header.
  staff-components.js               Staff dispatch cards, add-staff form.
  engagement-components.js          Engagement list card, scope picker, header.
  round-components.js               Round card, 5-state progress strip.
  assignment-components.js          Staff selector chip, assignment card w/ manual-rebalance dropdown.
  counting-components.js            Sub-Auditor's counting table row, progress bar.
  compile-components.js             Variance table, missing-assignment warning, compile summary.
  dashboard-components.js           Main/Sub dashboard cards.
  report-components.js              Report launcher buttons, final-snapshot summary card.
  index.js                          Merges every components/* file into one `Components` object.

js/pages.js                         Floor 5 door. Re-exports `initPages()`.
js/pages/
  legacy-pages.js                   Original single-auditor page logic — untouched.
  auth-pages.js                     Renders login/config screens; gates the rest of the app shell.
  staff-pages.js                    Staff tab wiring.
  engagement-pages.js               Main Auditor's Team Audit workspace (engagement→round→assignment→compile→dashboard→reports).
  sub-pages.js                      Sub-Auditor's own assignment view + counting table.
  event-delegation.js               The ONE set of DOM listeners, merging every page module's handler map.

js/main.js                          Entry point: initPages() then Actions.bootstrap().

supabase/
  schema.sql                        Full Postgres schema + Row Level Security policies. Run once.
  admin-actions/index.ts            Edge Function for create-login/reset-PIN/block. Holds the service-role key server-side only.

BLUEPRINT.md                        Current design document (v2 — Supabase identity model).
BLUEPRINT_v1_original.md            Historical record of the original Dropbox-pairing-link design (superseded, kept for reference only).
```

---

## 4. How it works

### Single-auditor flow (unchanged from the original app)
Import inventory → tap a company → count each item against system stock →
sign off → saved to History, exportable as PDF/Excel/WhatsApp message. All
of this still works exactly as before; nothing here was touched by the
Team Audit build.

### Multi-auditor flow (Team Audit tab)

**Setup (once):**
1. Main Auditor imports inventory (same CSV/Dropbox flow as always).
2. Main Auditor opens the **Staff** tab, creates a login for each person
   (name + phone + PIN), taps "Send via WhatsApp" to hand each one their
   login — nothing sends automatically, every dispatch is a deliberate tap.

**Per engagement:**
1. **Create Engagement** — name it, pick scope: Full Inventory / Selected
   Companies / Single Company.
2. **Create Round 1** — always company-level (each assignment gets whole
   companies, every item in them).
3. **Assign work** — auto-split by company count or by item volume shows a
   **preview** of exactly who'd get what first; nothing is saved until you
   tap Confirm. Or manually move a company from one person to another, or
   tap "Assign Myself as Sub-Auditor" to count something yourself.
4. **Lock the round.** Staff now see their assignment the moment they log
   in — nothing to send them, no link, no code.
5. **Staff count.** Each person opens their assignment, counts (offline-
   capable, autosaves locally), searches items, adds a note per item if
   needed, submits when done. The round automatically shows as
   **Counting** the moment the first person actually opens their work, and
   the Main Auditor sees a live progress bar per person (refreshed every
   ~15s) rather than just a status label.
6. **Compile.** Main Auditor merges every submission (keyed by Company +
   Item ID, so partial submissions patch in correctly), sees variances —
   sortable by financial impact, filterable to a rupee range. If someone
   hasn't submitted yet, compile is blocked unless explicitly overridden
   ("Compile Anyway").
7. **Either:**
   - **Generate Final Snapshot** now (a clean count needs no further
     rounds), or
   - **Generate Next Round** — Differences Only / Full Company Recount /
     Random Spot-Check — which creates a new item-level round, auto-splits
     just those items, and repeats from step 4.
8. **Reports** — inside the engagement, a collapsible card per report
   (tap to read what it includes, tap Export to download it as `.xlsx`
   right away): Final Audit Report, Variance Report, Round History,
   Submission History, Audit Trail.

### Isolation, in one sentence
A Sub-Auditor's device only ever asks Supabase "give me assignments where
`auditor_id` is me" — and Postgres itself, not the app's JavaScript, refuses
to return anything else. Even a tampered client can't ask around that.

---

## 5. Tech stack

- **No framework, no build step.** Plain ES modules, loaded directly by the
  browser via `<script type="module">`.
- **Supabase** — Auth (real logins) + Postgres (multi-auditor data,
  protected by Row Level Security) + one Edge Function (privileged staff
  actions).
- **Dropbox** — inventory sync only (CSV/POS import, single-auditor history
  backup). Untouched from the original app.
- **IndexedDB** (browser-local) — legacy single-auditor products/history,
  plus the offline counting checkpoint.
- **SheetJS (xlsx)** — every `.xlsx` export.
- **Service Worker** — offline asset caching, installable PWA.

---

## 6. Security model

- **Real accounts, not links.** Every login (Main or Sub) is a genuine
  Supabase Auth user. A phone number maps internally to a fake email
  (`<digits>@staff.internal`); the PIN is that account's real password.
- **Row Level Security is the actual lock.** Every table has policies that
  check `auth.uid()` against the row's owner on every single request — not
  once at login, every time. A Sub-Auditor's client cannot read engagements,
  rounds, compiled data, other people's assignments, or the audit log, no
  matter what it asks for.
- **Column-level hardening.** A database trigger additionally stops a
  Sub-Auditor from rewriting their own assignment's item list or scope —
  their row-level "update your own assignment" permission is restricted to
  the `status` field only.
- **The service-role key never reaches the browser.** It lives only in the
  Edge Function's server environment. The browser app only ever holds the
  public anon/publishable key, which is safe to expose by design.
- **Access expiry is account-level and checked on every request** — not a
  timer the app has to remember to enforce.
- **Audit log** — every significant action writes to a Postgres table,
  queued locally and retried if the write fails while offline.

---

## 7. What to do now — you haven't set up Supabase yet

You already have a Supabase project (URL + publishable key are pre-filled
as defaults in the app). Four things left, all one-time:

### Step 1 — Run the database schema
Supabase Dashboard → your project → **SQL Editor** → New Query → paste the
entire contents of `supabase/schema.sql` → **Run**. You should see
"Success. No rows returned." Safe to re-run if you ever need to.

### Step 2 — Deploy the Edge Function (no computer needed — phone browser is fine)

An Edge Function is a small helper script that runs on Supabase's servers,
not in the app itself. It's the only thing allowed to hold the
`service_role` key (the "full-admin master key" — the second long code in
your Supabase credentials, the one whose payload says `"role":"service_role"`).
That key must never sit inside the app's own code, because anything in the
app is visible to anyone who opens dev tools on their phone — including a
Sub-Auditor's. The Edge Function keeps it server-side and only ever hands
back a plain "done" to the app.

You can create and deploy it entirely from your phone's browser — no
terminal, no `npm install`, no computer:

1. Open **supabase.com/dashboard** → your project.
2. Left menu → **Edge Functions**.
3. Tap **Deploy a new function** → **Via Editor**.
4. Name it exactly: `admin-actions`
5. Delete the placeholder "Hello World" code it shows you.
6. Open `supabase/admin-actions/index.ts` from this zip, copy its entire
   contents, paste it into that code box.
7. Tap **Deploy**.

Supabase auto-provides `SUPABASE_SERVICE_ROLE_KEY` to the function's
environment for projects with legacy keys enabled (yours has them) — you
likely don't need to do anything else. If the function ever errors saying
it can't find that key: same Edge Functions section → **Secrets** → set
`SUPABASE_SERVICE_ROLE_KEY` to that value once.

**Never** paste that specific value anywhere else — not into this chat,
not into any other file, not into a screenshot. It's your database's
full-admin master key.

*(If you ever do have a computer handy, the CLI equivalent is
`npm install -g supabase`, `supabase login`, `supabase link --project-ref vtcrdkqhuvxatclobsby`,
`supabase functions deploy admin-actions` — but the Dashboard path above
does the exact same thing and needs nothing installed.)*

### Step 3 — Create your own Main Auditor login
The Staff tab can only be used by someone who's already a Main Auditor —
so your very first account needs one manual, one-time step:
1. Supabase Dashboard → **Authentication → Users → Add user**.
   - Email: `<your phone digits only>@staff.internal` (e.g. `923001234567@staff.internal`)
   - Password: your chosen PIN
   - Tick "Auto Confirm User"
2. Supabase Dashboard → **Table Editor → staff → Insert row**.
   - `id`: paste the user id you just created (visible in the Users list)
   - `name`: your name
   - `phone`: the same digits you used above
   - `role`: `main`
   - `access_expires_at`: leave empty

That's the only manual database step, ever. Every person after yourself
gets created from the app's own Staff tab — no dashboard needed again.

### Step 4 — Open the app and log in
Open `index.html` (locally, or wherever you're hosting it — the `CNAME`
file suggests `random.duapharma.com`). You'll land on a login screen. Enter
your phone number and the PIN you just set. You're in as Main Auditor.

From here: Staff tab to create everyone else's logins → Team Audit tab to
run your first engagement.

### If you want to point the app at a different Supabase project later
Settings tab → "Team Audit — Supabase Project" section → paste the new
project's URL + anon/publishable key → Save & Reload. (Re-run Steps 1–3
against the new project first.)

---

## 8. What was NOT changed

To be precise about blast radius: `css/app.css`, every function inside
`js/*/legacy-*.js`, and the entire single-auditor Verify Stock / History /
Settings experience are byte-for-byte what they were before any of this
multi-auditor work started. If something in those areas looks different,
that's a bug, not a design choice — flag it.
