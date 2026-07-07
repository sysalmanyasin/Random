# Pharmacy Audit Hub — Blueprint & Phased Plan (Final v1)

## Vision

A scalable, offline-first, multi-auditor pharmacy inventory audit platform — without losing the simplicity of the current single-auditor workflow. A solo audit and a 20-company/10-auditor audit are the *same system*, just different scope.

---

## Core Domain

**Entities:** Engagement · Round · Assignment · Submission · Auditor · Company · Item · Inventory · Final Snapshot · Audit Report

---

## Roles

**Main Auditor**
Create Engagement · Import Inventory · Select Audit Scope · Create Rounds · Assign Work (auto-split + manual rebalance) · Generate Pairing Links · Compile Results · Create Additional Rounds · Lock Final Snapshot · Export Reports · **can pair themself as a Sub-Auditor** on any assignment

**Sub-Auditor**
Pair Device (via link, no direct Dropbox access) · Receive Assignment · Count Inventory (offline) · Save Progress (auto-save) · Submit Assignment

---

## Modules

### Engagement
Create · Open Existing · Archive · Close. One engagement = one audit cycle (e.g. one quarterly audit), containing all its rounds.

### Inventory
Import (current CSV/Dropbox method — Candela stays deferred) · Validate · Store as Master Inventory · Search · Company Grouping.

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

---

## Assignment Engine

**Methods:** Auto-Split by Company Count · Auto-Split by Item Volume · Manual Rebalance (drag before lock)

**Functions:** Assign Companies · Assign Main Auditor to Self · Generate Assignment · Generate Pairing Link · Revoke Assignment

---

## Pairing System

- **One Dropbox account**, owned by the Pharmacy/Manager — not any individual auditor.
- Only the **Main Auditor's app instance** authenticates to Dropbox directly.
- Folder structure:
  ```
  /engagement/
    round-1/
      subauditor-<id>/assignment.json
      subauditor-<id>/submission.json
      master/compiled.json
    round-2/...
    master/final-report.json
  ```
- Sub-auditor identity = registered name/ID (not tied to a device) — re-pairing a new phone doesn't break anything.
- **Link expiry** — first of: successful submission, time-based fallback (e.g. 48h), or Main Auditor manual revoke.
- Enforcement is app-level, not a Dropbox-native permission — appropriate for an internal-team threat model, not a hostile-actor guarantee.
- Sub-auditor device never holds real Dropbox credentials — the link is the entirety of its access.

---

## Counting Module (Sub-Auditor)

Offline Counting · Auto-Save (per item, not just on submit) · Search Items · Notes/flag field per item (e.g. "shelf empty") · Progress Tracking · Submit Assignment · Barcode Support *(future)*

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

Persist: Engagements · Inventory · Companies · Assignments · Submissions · Compiled Rounds · Final Snapshot

## Synchronization

Dropbox Sync (single account model above) · Offline Queue · Retry Failed Sync · Conflict Detection

## Reporting

Final Audit Report · Variance Report · Round History · Submission History · Audit Trail · Digital Sign-offs (name + timestamp per submission)

## Security

Pairing Links · Assignment Isolation (a sub-auditor's app cannot reach data outside its own assignment) · Link Expiry · Optional PIN per sub-auditor identity · Audit Logging

---

## Workflow

```
Create Engagement → Import Inventory → Select Scope → Create Round
→ Assign Auditors (Auto-Split → Manual Rebalance) → Lock Round
→ Generate Pairing Links → Sub-Auditors Count → Submit → Compile
→ Review Variances → Final Snapshot   OR   Create Next Round
```

---

## Architecture Layers

- **Domain** — Business rules, entities, value objects, repository contracts
- **Application** — Use cases, services, commands, queries, validation
- **Infrastructure** — Dropbox, IndexedDB/SQLite, sync engine, file storage, import/export
- **Presentation** — Main Auditor UI, Sub-Auditor UI, Dashboard, Reports, Settings

---

## Guiding Principles

Offline First · Single Source of Truth · One Counting Workflow · Company-Based Round 1 Assignments · Item-Level Difference Rounds · Traceable Audit History · Modular Design · Scalable Without Changing Workflow · **Preserve Existing Single-Auditor Experience** · Simple by Default · Enterprise Ready

---

## Future Modules (explicitly out of initial scope)

Direct Candela Integration · Barcode Scanner · Multi-Branch Audits · Cloud Sync Beyond Dropbox · Performance Analytics · AI Assistance · Scheduled Audits · Email Notifications · Role-Based Administration · Regulatory Compliance Dashboard

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

---
---

# Phased Implementation Plan

*Each phase ends in a working, testable state — not a half-built one. Phase order follows dependency, not difficulty.*

### Phase 1 — Foundation: Re-model, don't change behavior
- Introduce Engagement, Round, Assignment, Auditor as real entities in storage.
- Port today's single-auditor flow into this model as: **1 Engagement → 1 Round → 1 Assignment → Main Auditor as sole participant.**
- Scope Selection (Full / Selected Companies / Single Company).
- **Exit test:** app behaves identically to today from a user's perspective — nothing new visible yet, just re-plumbed underneath.

### Phase 2 — Multi-Auditor Core
- Round states (Draft/Locked/Counting/Compiled/Final) and lock mechanics.
- Assignment Engine: auto-split (count, then item-volume), manual rebalance.
- Pairing System: Dropbox folder structure, link generation, expiry, re-pair flow.
- Sub-Auditor counting UI: assigned-only view, offline counting, auto-save, submit.
- **Exit test:** Main Auditor can split one real inventory across 2+ sub-auditor devices and each can count and submit independently.

### Phase 3 — Compile & Differences
- Compilation Engine: receive, validate, merge (Company+Item ID keyed), variance detection, compile-with-missing override.
- Difference Engine: differences-only / full recount / random spot-check assignment generation.
- Main Auditor's compile & differences-review screen.
- **Exit test:** a full round's submissions compile into one master file, variances are visible, and a differences-only Round 2 can be generated and assigned from it.

### Phase 4 — Multi-Round & Final Snapshot
- Wire the full loop: Create → Assign → Count → Compile → Review → Repeat.
- Round-1-direct-to-Final shortcut.
- Final Snapshot: freeze data/inventory, generate final inventory + audit trail.
- **Exit test:** an engagement can run 3 rounds and lock to Final, or lock to Final straight after Round 1 — both paths work.

### Phase 5 — Dashboards & Reporting
- Main Auditor dashboard (all status views).
- Sub-Auditor dashboard (assigned/progress/pending).
- Reports: Final Audit Report, Variance Report, Round History, Submission History, Audit Trail, Digital Sign-offs.
- **Exit test:** a completed engagement produces an exportable report a pharmacy owner could hand to a regulator.

### Phase 6 — Hardening & Polish
- Security: assignment isolation checks, PIN option, audit logging, link-expiry enforcement.
- Sync robustness: offline queue, retry-on-fail, conflict detection.
- Quality-of-life: nudge/resend link, assignment templates, sub-auditor roster reuse across engagements.
- **Exit test:** simulated failure cases (dead phone mid-count, expired link, missing submission) all degrade gracefully with a clear recovery path.

### Phase 7 — Future (not in initial build)
Candela direct integration, barcode scanning, multi-branch audits, notifications, broader cloud sync, analytics.

