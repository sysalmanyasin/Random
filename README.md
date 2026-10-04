# Fazal Din Pharma Plus — Audit Hub

A pharmacy stock-audit platform for inventory verification, multi-user stock counting, variance investigation, barcode-assisted counting, near-expiry tracking, and final audit sign-off.

The system is built as an installable Progressive Web App (PWA) and supports:

- Shared inventory
- Team-based audits
- Individual/self-service audits
- Offline-capable counting
- Multi-round recounts
- Variance correction workflows
- Barcode registration and scanning
- Near-expiry tracking
- Excel reporting
- Supabase-backed authentication and RLS
- A native Android shell with Google ML Kit barcode scanning
- An Android home-screen widget for Individual Assignments

**Live application:** <https://random.duapharma.com>

The web application uses plain ES modules with no frontend framework and no web bundler. It can be served from a static host. The Android projects have their own native build tooling.

---

## 1. What the App Does

| Area | Capabilities |
|---|---|
| Inventory | Shared inventory synchronized from Dropbox, with CSV fallback. Search by product code, name, generic, company or supplier. Group by company/supplier, select products, create reusable Templates and launch audits. |
| Team Audit | Main Auditor creates engagements, rounds and assignments; work can be automatically split by company or item volume; rounds can be locked, counted, compiled and recounted. |
| Individual Audit | Sub-Auditors can independently select a company or Template and start an audit without waiting for a Main Auditor to create an engagement. Individual work is organized into rolling monthly engagements. |
| Staff Management | Main Auditor can create staff accounts, reset PINs, block/unblock accounts, manage roles and configure access expiry. |
| Barcode Center | Scan, search, register, verify and manage product barcodes. Includes conflict detection, verification history, scan history and barcode reports. |
| Barcode Counting | Audits can use Manual, Barcode, or Hybrid counting. Barcode scans resolve products into the existing counting workflow without changing the underlying variance calculations. |
| Expiry Tracking | Shared near-expiry inventory log with monthly rack assignments, staff responsibility, search, locking and Main Auditor-controlled corrections. |
| Verify Stock — Legacy | Original single-user stock verification workflow with history and export functionality. |
| Reports | Final Audit Report, Variance Report, Combined Variance Report, Round History, Submission History, Audit Trail and Inventory Report. |
| Counting Calculator | Floating calculator for expressions such as "6 boxes × 10 + 4 loose", inserting the calculated quantity into the active count field. |
| PWA | Installable web application with service-worker caching and offline-capable counting workflows. |
| Android App | Capacitor Android shell around the live application with native Google ML Kit barcode scanning. |
| Android Widget | Home-screen widget showing open Individual Assignment rounds, assignee and progress for the Main Auditor. |

---

## 2. Audit Model

The system is designed around a controlled audit lifecycle:

```
Inventory
   ↓
Engagement
   ↓
Round
   ↓
Assignments
   ↓
Counting
   ↓
Submission
   ↓
Compilation
   ↓
Variance Review
   ↓
Recount / Correction
   ↓
Final Snapshot
```

An audit can therefore move from a broad initial count to increasingly focused verification instead of repeatedly recounting the entire inventory.

---

## 3. Counting and Variance Rules

### Uncounted items

An item that was never entered by the auditor is treated as **zero counted quantity**.

This intentionally makes an uncounted item visible as a shortage instead of silently removing it from the result.

The sanctioned override is the **Mark Remaining as Match / Force Submit** match mode. Automatically matched rows are marked as `auto_matched` so the override remains visible in reporting.

### Fresh inventory cutoff

Each round uses an inventory snapshot taken when the round is generated.

Later rounds re-base against the current inventory and can therefore pick up newly introduced SKUs.

### Compilation

Submissions are merged using the application's item identity rules, including Company + Item ID where applicable.

Compilation:

- Detects missing submissions.
- Can block when assignments are incomplete.
- Supports Compile Anyway where permitted.
- Detects cross-round conflicts.
- Does not silently auto-resolve conflicting counts.

### Recount modes

The system supports focused next-round strategies including:

- Differences Only
- Full Company Recount
- Random Spot-Check

### Variance corrections

A Deputy or Sub-Auditor can propose a corrected count with a reason.

The Main Auditor approves or rejects the proposal.

The original count is preserved rather than silently overwritten.

### Time tracking

Assignments record start time and per-row counting time, with row-level caps to prevent long breaks from being attributed to a single product.

### Live progress

Main Auditor views show assignment progress so management can see who has started, who is counting and who has submitted.

---

## 4. Roles

| Role | Access |
|---|---|
| Main Auditor (`main`) | Full system access: inventory, engagements, rounds, assignments, compilation, snapshots, staff, reports, settings, barcode administration and audit logs. |
| Deputy Auditor (`dep`) | Read access to team audit information and ability to propose variance corrections; can also perform permitted barcode registration/verification/conflict reporting. |
| Sub-Auditor (`sub`) | Own assignments, Individual Audits and shared expiry workflows. Barcode reading/scanning is available according to RLS permissions, while administrative barcode operations remain restricted. |

Authentication uses **Phone + PIN**.

The phone number is mapped to an internal Supabase Auth email in the form:

```
<digits>@staff.internal
```

There is no separate client-side "admin mode". The authenticated staff record's role controls the application experience, while the database independently enforces authorization.

---

## 5. Team Audit Workflow

### Main Auditor

1. Synchronize inventory from Dropbox or upload/import the available inventory.
2. Create staff accounts.
3. Create an Engagement.
4. Choose the engagement scope:
   - Full Inventory
   - Selected Companies
   - Single Company
5. Configure the counting method:
   - Manual
   - Barcode
   - Hybrid
6. Create Round 1.
7. Automatically split work by:
   - Company count
   - Item volume
8. Review the assignment preview.
9. Lock the round.
10. Staff count their assignments.
11. Staff submit their assignments.
12. Main Auditor compiles the round.
13. Review financial and quantity variances.
14. Resolve or review conflicts.
15. Either:
    - Generate the Final Snapshot, or
    - Generate another focused round.
16. Export the required reports.

A company assignment is kept together when using company-level splitting.

---

## 6. Individual Audits

Individual Audits allow a Sub-Auditor to start counting without waiting for a Main Auditor to create a dedicated engagement.

A Sub-Auditor can select:

- A saved Template
- A company
- Other available individual-audit scopes

The system places Individual Assignments into a rolling monthly engagement.

This allows frequent spot checks without creating unnecessary management overhead.

---

## 7. Barcode Center

The Barcode Center is a complete barcode identification and verification subsystem.

It provides:

- Barcode scanning
- Barcode search
- Product lookup
- Barcode Master
- Barcode registration
- Verification
- Verification queue
- Conflict management
- Scan history
- Barcode reports

### Barcode lifecycle

```
Unknown
   ↓
Registered
   ↓
Verified
```

Potential problems can move a barcode into:

```
Conflict
Disabled
```

A conflicting barcode is **never silently reassigned**.

The Main Auditor explicitly resolves conflicts using a controlled resolution such as:

- Keep existing mapping
- Reassign
- Disable

Administrative changes require a reason where required.

### Barcode counting

Every engagement can use one of three methods:

- **Manual** — traditional product-by-product counting.
- **Barcode** — products are identified through barcode scanning.
- **Hybrid** — the auditor can use both manual product selection and barcode scanning.

The barcode layer is intentionally separate from the counting/variance engine.

A successful barcode resolution supplies the correct product/assignment item to the existing counting workflow. It does not duplicate or replace the application's quantity and variance calculations.

### Camera scanning

The web scanner supports multiple decoding paths depending on the device/browser.

**Android / Chrome** — uses the browser's native `BarcodeDetector` where available.

**iPhone / iPad** — uses the vendored ZXing implementation and ZXing-C++ WebAssembly engine where required.

**WASM scanner** — the ZXing-C++ WebAssembly engine improves recognition of:

- Blur
- Rotation
- Low contrast
- Damaged barcodes
- Difficult labels

The previous JavaScript ZXing implementation remains available as a fallback.

**Scanner assistance** — supported devices can provide:

- Rear-camera selection
- Autofocus
- Exposure/white-balance controls where available
- Torch
- Zoom
- Refocus by tapping the viewfinder
- Scan guidance
- Automatic torch assistance
- Still-image capture fallback
- Success flash
- Beep/vibration
- Screen wake-lock

**Validation** — numeric GTIN/EAN/UPC-style results are validated using the appropriate check-digit rules. Repeated reads are required for less reliable barcode types to reduce false positives.

---

## 8. Offline Barcode Support

Barcode functionality has its own local mirror and outbox.

The browser stores:

```
barcodeCache
barcodeOutbox
```

Scan events can be queued while offline and synchronized when connectivity returns.

Client-side scan IDs allow the server to ignore duplicate submissions.

The barcode subsystem therefore works with the application's broader offline-first counting philosophy instead of requiring a permanent network connection for every scan.

---

## 9. Expiry Tracking

The Expiry module provides a shared near-expiry stock register.

It records information such as:

- Product
- Quantity
- Expiry month
- Rack
- Status
- Responsible staff member

The Main Auditor can configure racks and assign racks to staff by month.

Staff can enter expiry observations, while saved records are protected from unauthorized modification.

Only the Main Auditor can reopen, edit or delete locked entries.

The expiry register also supports universal product search.

---

## 10. Reports

The team-audit reporting system produces Excel workbooks (`.xlsx`) including:

- Final Audit Report
- Variance Report
  - Auditor Notes
  - Cross-Round Conflicts
- Combined Variance Report
- Round History
- Submission History
- Audit Trail
- Inventory Report

The legacy Verify Stock workflow also provides its own historical/export functionality.

---

## 11. Architecture

The web application follows a layered five-floor architecture:

```
┌──────────────────────────────────────────┐
│ FLOOR 5 — PAGES                          │
│ DOM rendering + event delegation         │
├──────────────────────────────────────────┤
│ FLOOR 4 — COMPONENTS                     │
│ Pure render functions                    │
├──────────────────────────────────────────┤
│ FLOOR 3 — ACTIONS                        │
│ Business logic + state-changing actions  │
├──────────────────────────────────────────┤
│ FLOOR 2 — STORE                          │
│ Central in-memory application state      │
├──────────────────────────────────────────┤
│ FLOOR 1 — REPOSITORY                     │
│ Supabase / IndexedDB / local storage     │
│ Dropbox / persistence                    │
└──────────────────────────────────────────┘
```

### Architecture rules

- Storage/network access belongs in the Repository layer.
- State changes are performed through Actions.
- Components remain presentation-focused.
- Pages handle navigation and DOM composition.
- Event delegation centralizes application event handling.
- Global `window` application state is avoided.
- Actions communicate UI changes through the event Bus.
- Barcode functionality is integrated as an identification layer rather than duplicating counting logic.

---

## 12. Repository Structure

```
index.html
manifest.json
sw.js
CNAME
package.json

css/
  app.css
  barcode.css
  desktop.css
  design-upgrade.css
  engagement.css

js/
  main.js

  # Top-level barrels (re-export each floor's index)
  store.js
  repository.js
  actions.js
  components.js
  pages.js
  home-stats.js

  store/
    initial-state.js
    store.js

  repository/
    barcode.js
    db.js
    dropbox.js
    expiry.js
    legacy.js
    storage.js
    supabase.js
    templates.js

  actions/
    index.js
    bus.js
    item-key.js
    assignment-actions.js
    audit-log-actions.js
    auth-actions.js
    barcode-actions.js
    calculator-actions.js
    compile-actions.js
    counting-actions.js
    dashboard-actions.js
    difference-actions.js
    engagement-actions.js
    expiry-actions.js
    individual-actions.js
    inventory-actions.js
    legacy-actions.js
    report-actions.js
    round-actions.js
    snapshot-actions.js
    staff-actions.js
    variance-edit-actions.js

  barcode/
    barcode-lookup.js
    barcode-quality.js
    barcode-reports.js
    barcode-scanner.js
    barcode-service.js
    barcode-validation.js
    barcode-zxing.js

  components/
    index.js
    dom-utils.js
    assignment-components.js
    barcode-components.js
    compile-components.js
    counting-components.js
    dashboard-components.js
    engagement-components.js
    expiry-components.js
    inventory-components.js
    legacy-components.js
    login-components.js
    report-components.js
    staff-components.js
    round-components.js

  pages/
    auth-pages.js
    barcode-counting-pages.js
    barcode-pages.js
    calculator-pages.js
    engagement-pages.js
    event-delegation.js
    expiry-pages.js
    home-stats-page.js
    inventory-pages.js
    legacy-pages.js
    staff-pages.js
    sub-pages.js

  vendor/
    zxing-library.min.js
    zxing-wasm-reader.iife.js
    zxing_reader.wasm
    ZXING-LICENSE.txt
    ZXING-WASM-LICENSE.txt

supabase/
  schema.sql
  barcode-schema.sql
  admin-actions/
    index.ts

tests/
  *.test.mjs
  fixtures/

docs/
  ANDROID_APP.md
  BARCODE.md

AndroidApp/
  Capacitor Android application
  Google ML Kit scanner

AuditWidget/
  Android home-screen widget

.github/
  workflows/
    build-android-app.yml
    build-widget-apk.yml

BLUEPRINT_v1_original.md
```

---

## 13. Data and Persistence

The application uses several persistence layers for different responsibilities.

### Supabase

Used for:

- Authentication
- Staff
- Engagements
- Rounds
- Assignments
- Submissions
- Compiled rounds
- Final snapshots
- Audit logs
- Templates
- Expiry data
- Barcode data
- Shared inventory
- Server-side authorization

### IndexedDB

Used for local/offline application data including:

- Inventory/cache data
- Counting checkpoints
- Barcode mirror
- Barcode outbox
- Other local application state

### localStorage

Used for lightweight local settings and persistence.

### Dropbox

Dropbox is the upstream inventory source.

The current architecture performs inventory synchronization server-side and stores the synchronized inventory in Supabase so multiple devices work from the same inventory dataset.

---

## 14. Security Model

Security is enforced primarily at the database level rather than relying only on UI restrictions.

- **Supabase Auth** — every staff member has a real Supabase Auth account.
- **Row Level Security** — Supabase RLS policies use the authenticated user's identity and role to restrict access. A client cannot bypass authorization simply by modifying JavaScript or making a different API request.
- **Access expiry** — staff access validity is checked server-side.
- **Assignment protection** — Sub-Auditors cannot modify protected assignment scope, ownership or configuration fields.
- **Engagement protection** — database functions prevent counting/submission activity where the engagement is not in an appropriate state.
- **Barcode protection** — barcode administrative operations are protected by RLS and security-definer functions.
- **Service-role key** — kept exclusively inside the privileged Edge Function. It is never intended to be shipped to the browser.
- **Audit logging** — significant actions are recorded in the audit log. Offline-capable logging can queue events locally and retry synchronization when connectivity returns.

---

## 15. Supabase Setup

### Main database

Run `supabase/schema.sql` in the target Supabase project's SQL Editor.

The schema is designed to be safely re-runnable through its use of appropriate `IF EXISTS` / `IF NOT EXISTS` patterns where applicable.

### Barcode subsystem

Run `supabase/barcode-schema.sql` after the main schema when setting up barcode functionality.

This creates the barcode tables, policies, functions and related database logic.

### Admin Edge Function

Deploy `supabase/admin-actions/index.ts` as `admin-actions`.

Using the Supabase CLI:

```bash
supabase functions deploy admin-actions
```

The Edge Function uses the Supabase service-role key for privileged staff-account operations. That key must remain server-side.

---

## 16. Inventory Synchronization

The application uses a shared server-side inventory synchronization model.

The browser reads from `inventory_products` rather than each device independently maintaining its own Dropbox copy.

The inventory sync process is responsible for pulling the source inventory into Supabase.

The repository references a separate `sync-inventory-from-dropbox` Supabase Edge Function for the actual Dropbox synchronization.

> **Note:** that function is not contained in this repository and must be deployed separately if Dropbox synchronization is required.

CSV/manual import remains available as a fallback.

---

## 17. First Main Auditor

For a fresh Supabase project:

1. Create a Supabase Auth user.
2. Use the internal email convention `<phone digits>@staff.internal`.
3. Set the user's password to the chosen PIN.
4. Auto-confirm the user.
5. Insert the corresponding record into the `staff` table.
6. Set `role = main`.
7. Open the application.
8. Sign in using phone + PIN.

After the first Main Auditor exists, normal staff management can be performed from the application.

---

## 18. Android App

`AndroidApp/` is a Capacitor-based Android shell around the live web application.

It does not replace the web application or create a separate data layer.

It loads <https://random.duapharma.com>.

The existing Supabase backend, authentication, PWA, database, web UI and audit workflows remain unchanged.

### Native barcode scanning

The Android application adds Google ML Kit barcode scanning.

On supported Android devices:

```
Tap Scan
   ↓
Google ML Kit scanner
   ↓
Barcode result
   ↓
Existing web Barcode/Counting workflow
```

For continuous barcode counting:

```
Open scanner
   ↓
Read product
   ↓
Enter quantity
   ↓
Confirm
   ↓
Scanner reopens
   ↓
Read next product
```

If native Google scanning cannot be used, the web scanner is used as the fallback.

### Android updates

- **Web changes** arrive automatically because the APK loads the live website.
- **Native Android changes** require a new APK build and installation.

### Android build

The GitHub Actions workflow `.github/workflows/build-android-app.yml` builds the Android application when `AndroidApp/**` changes.

It:

1. Installs Node dependencies.
2. Uses JDK 21.
3. Runs Capacitor synchronization.
4. Builds the debug APK.
5. Uploads the APK artifact.
6. Publishes/refreshes the `android-latest` GitHub Release.

The current APK is debug-signed.

---

## 19. Android Individual Assignments Widget

`AuditWidget/` is a separate Android companion application.

Its purpose is to show the Main Auditor:

- Open Individual Assignment rounds
- Round number
- Engagement
- Assignee
- Round state
- Counting progress
- Assignment status

It authenticates using the same Supabase staff credentials.

The session is stored using Android encrypted storage.

The widget periodically refreshes using WorkManager and can also be manually refreshed.

### Widget security

The widget uses the authenticated session token and therefore remains subject to Supabase RLS.

It does not contain a service-role key.

The widget is intended primarily for Main Auditor accounts.

### Widget build

The GitHub Actions workflow `.github/workflows/build-widget-apk.yml` produces `audit-rounds-widget-debug-apk` as a GitHub Actions artifact.

The widget APK is currently debug-signed.

---

## 20. Progressive Web App

The web application is installable as a PWA.

It includes:

- Web App Manifest
- Service Worker
- Offline asset caching
- Install prompt
- Home-screen shortcuts
- Standalone display mode
- Mobile-oriented UI
- Desktop layout support

The service worker uses a cache version (`CACHE_NAME` in `sw.js`) that should be updated when important cached application assets change.

Serve the application over HTTPS for the full PWA experience.

---

## 21. Development

The web application has no frontend build step.

Install Node.js and run:

```bash
npm test
```

The repository currently contains 22 Node test files covering areas including:

- Barcode components
- Barcode lookup
- Native barcode integration
- Scanner quality
- Barcode reports
- Barcode scanner behavior
- Barcode service
- Barcode validation
- WASM barcode processing
- ZXing behavior
- Compilation
- Force submit
- Individual assignments
- Item identity
- Live snapshots
- Product search
- Round deletion/renumbering
- Round overlap
- Row timing
- Uncounted-item rules
- Variance corrections
- Extra notes

Tests use Node's built-in test runner.

---

## 22. Testing Philosophy

The test suite focuses heavily on business rules rather than only UI rendering.

Important invariants include:

```
Uncounted item → counted quantity 0

Barcode → product identification
        → existing count flow
        → existing variance logic

Conflicting barcode → explicit conflict
                    → no silent reassignment

Variance correction → proposal
                    → Main Auditor review
                    → original count preserved

Round → snapshot
      → assignments
      → submissions
      → compilation
      → variance review
      → recount/final snapshot
```

---

## 23. Deployment

The web application can be deployed to any static HTTPS host capable of serving ES modules and the required assets.

The current deployment uses GitHub Pages with `CNAME` pointing to `random.duapharma.com`.

There is no web bundling/build pipeline required.

When deploying a new version:

1. Push the web changes.
2. Verify the GitHub Pages deployment.
3. Update the service-worker cache version when appropriate.
4. Test login.
5. Test inventory loading.
6. Test counting.
7. Test submission/compilation.
8. Test barcode scanning.
9. Test offline behavior.
10. Verify Supabase connectivity.

---

## 24. Documentation

Detailed subsystem documentation is available in:

### Barcode — `docs/BARCODE.md`

- Barcode architecture
- Scanner behavior
- Camera requirements
- Offline barcode operation
- Decoder strategy
- Barcode roles
- Scanner quality improvements

### Android — `docs/ANDROID_APP.md`

- Capacitor Android shell
- Google ML Kit scanner
- APK builds
- Updates
- Offline behavior
- Local development

### Widget — `AuditWidget/README.md`

- Widget architecture
- Login
- Supabase session handling
- Widget refresh
- Installation
- Debug APK usage

---

## 25. Current Scope

### Implemented

- Inventory management
- Dropbox-backed inventory synchronization
- CSV fallback
- Product search
- Templates
- Team engagements
- Multi-round auditing
- Assignment splitting
- Individual Audits
- Staff management
- Supabase authentication
- RLS authorization
- Offline-capable counting
- Counting calculator
- Variance compilation
- Cross-round conflict detection
- Variance correction proposals
- Final snapshots
- Audit trail
- Excel reporting
- Expiry tracking
- Barcode Center
- Barcode registration/verification
- Barcode conflict handling
- Barcode counting
- Web camera scanning
- ZXing/WASM fallback
- Android ML Kit scanning
- Capacitor Android shell
- Individual Assignments Android widget
- Automated Android builds

---

## 26. Remaining Gaps / Future Improvements

The application is already substantially beyond the original Audit Hub design, but the following areas remain potential future work:

- Direct POS integration
- Multi-branch audit management
- Push notifications
- Scheduled/recurring audits
- Advanced analytics dashboards
- AI-assisted variance analysis
- Regulatory/compliance dashboard
- Drag-and-drop assignment balancing
- Reusable engagement assignment templates
- Production-signed Android releases
- Broader automated end-to-end testing against a real Supabase project
- More sophisticated offline conflict reconciliation
- Centralized deployment/version diagnostics

---

## 27. Design Principles

1. **Never silently lose an audit item** — an uncounted item should become visible as a discrepancy rather than disappearing from the result.
2. **Never silently overwrite evidence** — original counts and audit history should remain recoverable.
3. **Database authorization is authoritative** — UI restrictions are useful for UX, but Supabase RLS and server-side functions are the actual security boundary.
4. **Barcode is an input layer** — barcode identification should improve counting speed without creating a second independent inventory/variance engine.
5. **Offline should be deliberate** — local persistence, queues and retry mechanisms should make temporary connectivity loss survivable.
6. **Recounts should become more focused** — the audit process should progressively narrow attention to disagreements instead of repeatedly recounting everything.
7. **Management should see progress** — the Main Auditor should always be able to understand assignment status, submissions, conflicts and outstanding work.

---

## 28. Project Status

Fazal Din Pharma Plus — Audit Hub is an actively developed internal pharmacy stock-audit platform combining:

```
Inventory
   +
Team Auditing
   +
Individual Auditing
   +
Offline Counting
   +
Barcode Intelligence
   +
Expiry Tracking
   +
Supabase Security
   +
Excel Reporting
   +
Android Integration
```

The web application remains the primary system of record and user interface, while the Android application and widget provide specialized mobile capabilities around the same backend and workflows.
