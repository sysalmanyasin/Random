# Pharmacy Audit Hub — Blueprint & Phased Plan (v2 — Supabase Identity)

> **v2 changelog:** v1's "Pairing System" (self-contained links, Dropbox-file
> handoff, PIN-hash-in-link) is **removed and replaced** by real Supabase
> Auth logins (phone + PIN) with Postgres Row Level Security enforcing
> isolation at the database layer. Dropbox is narrowed to inventory sync
> only. Everything else in v1 (Round Management, Assignment Engine,
> Compilation Engine, Difference Engine, Final Snapshot, Reporting) is
> unchanged in shape — only *how a Sub-Auditor gets access* changed.

## Vision

A scalable, offline-first, multi-auditor pharmacy inventory audit platform — without losing the simplicity of the current single-auditor workflow. A solo audit and a 20-company/10-auditor audit are the *same system*, just different scope.

---

## Core Domain

**Entities:** Engagement · Round · Assignment · Submission · Staff (Auditor) · Company · Item · Inventory · Final Snapshot · Audit Report

---

## Roles

**Main Auditor**
Create Engagement · Import Inventory · Select Audit Scope · Create Rounds · Assign Work (auto-split + manual rebalance) · **Create Staff Logins · Reset PINs · Block/Unblock Staff · Set Access Expiry · Dispatch via WhatsApp** · Compile Results · Create Additional Rounds · Lock Final Snapshot · Export Reports · **can assign themself as a Sub-Auditor** on any assignment

**Sub-Auditor**
**Log In (phone number + PIN)** · Receive Assignment (visible automatically once logged in — nothing to redeem) · Count Inventory (offline) · Save Progress (auto-save) · Submit Assignment

---

## Modules

### Engagement
Create · Open Existing · Archive · Close. One engagement = one audit cycle (e.g. one quarterly audit), containing all its rounds.

### Inventory
Import (current CSV/Dropbox method — Candela stays deferred) · Validate · Store as Master Inventory · Search · Company Grouping. **Unchanged from v1 — Dropbox's role in this app is now scoped to this module only.**

### Scope Selection
Every engagement's Round 1 picks one of:
- Full Inventory
- Selected Companies
- Single Company *(this is what preserves today's single-auditor use case exactly)*

---

## Round Management

**States:** Draft → Locked → Counting → Compiled → Final

**Functions:** Create Round · Edit Draft · Lock Round · Compile Round · Finalize Round

- Round 1 assignment unit = **Company** (all its items).
- Round 1 can be locked straight to **Final** with no further rounds — a clean/accepted-as-is audit doesn't need a diff cycle.
- Round 2+ assignment unit = **Company + Item ID** (line-item level) — differences-only, full recount, or random spot-check, all using the same assignment mechanism.
- A round enters **Counting** the moment real counting activity starts (a staff member opens their assignment, or a self-assignment begins) — not merely because it was locked.

---

## Assignment Engine

**Methods:** Auto-Split by Company Count · Auto-Split by Item Volume (Round 1: balances by SKU count per company · Round 2+ item-level splits: balances by financial exposure, qty × price, per item) — both show a preview (who gets what) before anything is persisted · Manual Rebalance ("move to…" picker before lock)

**Functions:** Assign Companies · Assign Main Auditor to Self · Generate Assignment · Revoke Assignment

An assignment now points directly at a real staff login (`auditor_id` = their Supabase user id). There is no separate "generate pairing link" step — the moment a staff member is assigned and logs in, Row Level Security lets them see exactly that row and nothing else.

---

## Identity & Access *(replaces v1's "Pairing System")*

- **Real login, not a link.** Every person — Main Auditor and every Sub-Auditor — is a genuine Supabase Auth user. A phone number is mapped internally to a fake email (`<digits>@staff.internal`); the person's PIN is that account's real password. They only ever see "phone + PIN."
- **One Supabase project**, owned by the Pharmacy/Manager. The browser app only ever holds the project's public **anon/publishable key** (safe to expose — it carries no special privilege by itself).
- **Row Level Security (RLS) is the actual lock**, not app carefulness:
  - A Sub-Auditor's queries can only ever return `assignments`/`submissions` rows where `auditor_id = auth.uid()`, enforced by the database on every request — not by the app being careful about what it sends.
  - Engagements, Rounds, Compiled Rounds, Final Snapshots, and the Audit Log are Main-Auditor-only at the database level; a Sub-Auditor's client has no path to them even if it tried.
- **Admin actions that need elevated rights** (create a login, reset a PIN, block someone) are proxied through one server-side Edge Function holding the **service-role key** — that key never reaches the browser, ever.
- **Access expiry is account-level**, not per-link: `staff.access_expires_at`. Once passed, RLS itself refuses that person's requests — no manual cleanup job, checked on every single request.
- **Revoke** works two ways: revoke one `assignment` (that row stops appearing for them), or block the whole staff account (`ban_duration` via the Edge Function) — both take effect immediately, enforced by the platform, not a flag the app has to remember to check.
- Sub-auditor identity is a registered person (name/phone), not tied to a device — logging in on a new phone doesn't break anything, same guarantee v1's pairing links gave, now for a stronger reason (it's a real account, not a bearer token).

### Staff Management & Dispatch *(new in v2)*
- **Staff tab** (Main Auditor only): one card per person — name, phone, active/blocked status.
- **Create Login** — name + phone + PIN, proxied through the Edge Function.
- **Reset PIN** / **Block · Unblock** / **Delete Login** — all proxied through the Edge Function.
- **Set Access Expiry** — a plain, RLS-permitted table update (no Edge Function needed for this one).
- **Send via WhatsApp** — builds a `wa.me` deep link with a personalized message (phone + PIN + app URL) and opens it. Nothing sends automatically — the Main Auditor taps every card themselves (100% free, human-validated dispatch, no SMS/WhatsApp Business API cost).

---

## Counting Module (Sub-Auditor)

Offline Counting · Auto-Save (per item, not just on submit, cached locally) · Search Items · Notes/flag field per item (e.g. "shelf empty") · Progress Tracking · Submit Assignment · Barcode Support *(future)*

Submitting **upserts** one live row per assignment (`unique(assignment_id, auditor_id)`), so a resubmission after a dropped connection naturally replaces the same row with a fresh timestamp — no separate "which one is latest" bookkeeping needed.

---

## Compilation Engine (Main Auditor)

Receive Submissions · Validate Data · Merge Results (keyed by **Company + Item ID**, so multiple sub-auditors' partial submissions patch into the same company correctly) · Detect Variances · Generate Compiled Round · **Compile With Missing Assignments** (override for stragglers)

---

## Difference Engine

Supports: **Difference Only** · **Full Company Recount** · **Random Spot-Check** (Main Auditor can send any "clean" company/item back out on demand — no special case, just a new assignment).

Operates on **Company + Item ID**, never company-only — a 100-item company with 5 variances only sends those 5 back out.

---

## Multi-Round Engine

```
Create Round → Assign → Count → Compile → Review → Repeat Until Final
```

Each compiled round becomes the baseline the next round's diffs are measured against.

---

## Final Snapshot

Lock Engagement · Freeze Data · Freeze Inventory · Generate Final Inventory · Generate Audit Trail · Generate Final Report. Reachable directly from Round 1, or after any number of rounds.

---

## Dashboard

**Main Auditor:** Engagement Status · Round Status · Company Status · Auditor Progress · Assignment Progress · Submission Progress · Compile Status · Final Status

**Sub-Auditor:** Assigned Companies · Progress · Pending Submission

---

## Storage

**Supabase (Postgres):** Staff · Engagements · Assignments · Submissions · Compiled Rounds · Final Snapshot · Audit Log — the multi-auditor source of truth, protected by RLS.

**Dropbox:** Inventory sync only (unchanged from v1) — CSV/POS import, product + legacy single-auditor history backup.

**IndexedDB (local, per device):** Legacy single-auditor products/history/session-checkpoint (unchanged) + the counting module's offline autosave checkpoint (per open assignment, pre-submit).

## Synchronization

Supabase is the multi-auditor sync layer (replaces v1's Dropbox-folder sync for this data). Offline Queue for the Audit Log specifically (best-effort writes retried on reconnect) · Retry Failed Sync · **Conflict Detection**: a resubmission is logged as a detected conflict, and the Compilation Engine always merges from the most recent submission per assignment, never "whichever loaded first."

## Reporting

Final Audit Report · Variance Report · Round History · Submission History · Audit Trail · Digital Sign-offs (name + timestamp per submission)

## Security

Real Login (phone + PIN, backed by Supabase Auth) · **Row Level Security** (the actual isolation mechanism — a Sub-Auditor's app cannot reach data outside its own assignment, enforced by the database) · Account-Level Access Expiry · Assignment Revoke · Service-role key confined to one server-side Edge Function, never the browser · Audit Logging (every significant action, written to Postgres, queued locally and retried if offline)

---

## Workflow

```
Create Engagement → Import Inventory → Select Scope → Create Round
→ Create Staff Logins (once) → Assign Auditors (Auto-Split → Manual Rebalance) → Lock Round
→ Staff Log In & Count → Submit → Compile
→ Review Variances → Final Snapshot   OR   Create Next Round
```

---

## Architecture Layers

- **Domain** — Business rules, entities, value objects, repository contracts
- **Application** — Use cases, services, commands, queries, validation
- **Infrastructure** — **Supabase (Auth + Postgres + Edge Functions)** for multi-auditor identity/data, Dropbox for inventory sync only, IndexedDB for legacy local cache, import/export
- **Presentation** — Main Auditor UI, Sub-Auditor UI, Staff Dispatch UI, Dashboard, Reports, Settings

---

## Guiding Principles

Offline First (for counting, once logged in) · Single Source of Truth (Supabase for multi-auditor data) · One Counting Workflow · Company-Based Round 1 Assignments · Item-Level Difference Rounds · Traceable Audit History · Modular Design · Scalable Without Changing Workflow · **Preserve Existing Single-Auditor Experience** · Simple by Default · Enterprise Ready · **Isolation Enforced by the Database, Not by App Discipline**

---

## Future Modules (explicitly out of initial scope)

Direct Candela Integration · Barcode Scanner · Multi-Branch Audits · Performance Analytics · AI Assistance · Scheduled Audits · Email Notifications · Role-Based Administration Beyond Main/Sub · Regulatory Compliance Dashboard

---

## Definition of Done

The system is complete when it can:
- Audit one company with one auditor.
- Audit an entire inventory with multiple auditors.
- Let the Main Auditor participate as a Sub-Auditor.
- Compile all submissions into one master inventory.
- Reassign only variance items in additional rounds.
- Produce a Final Snapshot without requiring additional rounds.
- Export a complete audit report with full traceability.
- Preserve all current single-auditor functionality while supporting multi-auditor workflows.
- **Create, block, reset, and expire a staff member's access without touching code.**
- **Prove Sub-Auditor isolation holds even if the app's own JavaScript were compromised** — because the enforcement lives in the database, not the client.

---
---

# Phased Implementation Plan

*Each phase ends in a working, testable state — not a half-built one. Phase order follows dependency, not difficulty.*

### Phase 1 — Foundation: Re-model, don't change behavior
- Introduce Engagement, Round, Assignment, Auditor as real entities in storage.
- Port today's single-auditor flow into this model as: **1 Engagement → 1 Round → 1 Assignment → Main Auditor as sole participant.**
- Scope Selection (Full / Selected Companies / Single Company).
- **Exit test:** app behaves identically to today from a user's perspective — nothing new visible yet, just re-plumbed underneath.
- **Status: done.**

### Phase 2 — Multi-Auditor Core
- Round states (Draft/Locked/Counting/Compiled/Final) and lock mechanics.
- Assignment Engine: auto-split (count, then item-volume), manual rebalance.
- ~~Pairing System: Dropbox folder structure, link generation, expiry, re-pair flow.~~ **Replaced:** Supabase Auth (phone+PIN login), Staff tab, Row Level Security.
- Sub-Auditor counting UI: assigned-only view (RLS-filtered), offline counting, auto-save, submit.
- **Exit test:** Main Auditor can create staff logins, split one real inventory across 2+ staff, and each logs in on their own device and counts/submits independently, seeing only their own assignment.
- **Status: done (re-platformed onto Supabase).**

### Phase 3 — Compile & Differences
- Compilation Engine: receive, validate, merge (Company+Item ID keyed), variance detection, compile-with-missing override.
- Difference Engine: differences-only / full recount / random spot-check assignment generation.
- Main Auditor's compile & differences-review screen.
- **Exit test:** a full round's submissions compile into one master file, variances are visible, and a differences-only Round 2 can be generated and assigned from it.
- **Status: done.**

### Phase 4 — Multi-Round & Final Snapshot
- Wire the full loop: Create → Assign → Count → Compile → Review → Repeat.
- Round-1-direct-to-Final shortcut.
- Final Snapshot: freeze data/inventory, generate final inventory + audit trail.
- **Exit test:** an engagement can run 3 rounds and lock to Final, or lock to Final straight after Round 1 — both paths work.
- **Status: done.**

### Phase 5 — Dashboards & Reporting
- Main Auditor dashboard (all status views).
- Sub-Auditor dashboard (assigned/progress/pending).
- Reports: Final Audit Report, Variance Report, Round History, Submission History, Audit Trail, Digital Sign-offs.
- **Exit test:** a completed engagement produces an exportable report a pharmacy owner could hand to a regulator.
- **Status: done.**

### Phase 6 — Hardening & Polish
- ~~Security: assignment isolation checks, PIN option, audit logging, link-expiry enforcement.~~ **Replaced/strengthened:** Row Level Security (database-enforced isolation), real PIN login (not optional), Postgres-backed audit logging with offline retry, account-level access expiry.
- Sync robustness: offline queue (audit log), retry-on-fail, conflict detection (upsert + logged conflicts, latest-submission-wins compile).
- Quality-of-life: **Staff tab + WhatsApp dispatch** (done). Nudge/resend link (n/a — logins don't expire like links did). Assignment templates (not built). Staff roster reuse across engagements (done — roster is independent of any one engagement).
- **Exit test:** simulated failure cases (dead phone mid-count, blocked account, missing submission, resubmission after a dropped connection) all degrade gracefully with a clear recovery path.
- **Status: done**, except assignment templates (not built — acknowledged gap, low priority).

### Phase 7 — Future (not in initial build)
Candela direct integration, barcode scanning, multi-branch audits, notifications, analytics.
