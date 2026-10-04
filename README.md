# Fazal Din Pharma Plus — Audit Hub

Fazal Din Pharma Plus — Audit Hub is an internal pharmacy stock-audit platform for controlled inventory verification, multi-user counting, variance investigation, barcode-assisted auditing, near-expiry tracking, and final audit sign-off.

It is built around a Progressive Web App (PWA) backed by Supabase, with offline-capable counting and barcode workflows. The repository also contains a Capacitor Android application with native Google ML Kit barcode scanning and a separate Android home-screen widget for monitoring Individual Audit assignments.

**Live application:** <https://random.duapharma.com>

---

## Overview

Audit Hub covers the complete stock-audit lifecycle:

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
   ↓
Reports
```

The system is designed to make stock discrepancies progressively easier to investigate. Instead of repeatedly recounting the entire inventory, later rounds can focus on differences, specific companies, or random spot checks.

### Core capabilities

- Shared inventory management, with Dropbox-backed synchronization and CSV/manual fallback
- Product search and reusable Templates
- Team-based stock audits and Individual/self-service audits
- Multi-round recounts
- Manual, Barcode and Hybrid counting
- Offline-capable counting, with live assignment progress
- Variance compilation and cross-round conflict detection
- Controlled variance corrections
- Final audit snapshots and a complete audit trail
- Excel reporting
- Barcode registration, verification and conflict management
- Advanced camera barcode scanning, with an offline barcode cache and scan outbox
- Near-expiry stock tracking
- Supabase Authentication and PostgreSQL Row Level Security
- Capacitor Android application with Google ML Kit native barcode scanning
- Android Individual Assignments widget
- Automated Android builds through GitHub Actions

---

## 1. Product Areas

| Area | Description |
|---|---|
| Inventory | Shared inventory synchronized from Dropbox or imported through CSV. Search by product code, name, generic, company or supplier. Group by company/supplier. |
| Templates | Save commonly audited product/company selections and reuse them for future audits. |
| Team Audit | Main Auditor creates engagements, rounds and assignments, monitors progress, compiles submissions and performs recounts. |
| Individual Audit | Sub-Auditors can independently start audits without waiting for a Main Auditor to create a team engagement. |
| Staff Management | Manage staff accounts, roles, PINs, blocking and access expiry. |
| Barcode Center | Register, verify, search, audit and resolve product barcodes. |
| Barcode Counting | Use Manual, Barcode or Hybrid counting within an audit. |
| Expiry Tracking | Maintain a shared near-expiry stock register with monthly rack/staff assignment. |
| Reports | Generate Excel audit, variance, history, submission, inventory and audit-trail reports. |
| Verify Stock | Legacy single-user stock verification workflow retained for compatibility. |
| Counting Calculator | Quantity calculator for expressions such as "6 boxes × 10 + 4 loose". |
| PWA | Installable browser application with service-worker caching and offline fallback. |
| Android App | Capacitor Android shell around the live web application with native ML Kit scanning. |
| Android Widget | Separate Kotlin widget showing Individual Assignment progress. |

---

## 2. Audit Model

An audit is divided into several controlled stages.

### Engagement

An Engagement defines the overall audit scope.

Supported scopes:

- Full Inventory
- Selected Companies
- Single Company

An Engagement can contain multiple rounds.

### Round

A Round represents one counting pass over a frozen inventory snapshot.

A round moves through these states:

```
draft → locked → counting → compiled → final
```

Each new round gets its own inventory snapshot so that a later Dropbox/CSV synchronization cannot unexpectedly change the items being counted in an active round.

### Assignment

An Assignment divides the work among auditors.

Assignments can be split by:

- Company count
- Item volume

Company-level assignments keep a company together rather than distributing its products across multiple auditors.

### Submission

Each auditor submits their completed counts. A submission contains:

- Counted quantities
- Notes
- Confirmation state
- Auditor identity
- Submission timestamp

### Compilation

The Main Auditor compiles submitted assignments into a consolidated round result.

Compilation can detect:

- Missing submissions
- Quantity differences
- Financial variance
- Cross-round conflicts
- Incomplete assignments

### Final Snapshot

Once the audit has been sufficiently verified, the Main Auditor can generate a Final Snapshot containing the final audit state and associated audit history.

---

## 3. Counting Rules

### Uncounted items

An item that is never entered by the auditor is treated as:

```
Counted quantity = 0
```

This is intentional. An uncounted product remains visible as a potential shortage rather than silently disappearing from the audit.

The controlled exception is the **Mark Remaining as Match / Force Submit** workflow. Rows automatically matched through that process are marked `auto_matched`, so the override remains visible in reporting.

### Inventory snapshots

Each round freezes its own inventory snapshot when the round is generated.

```
Live Inventory
      ↓
Round Created
      ↓
Frozen Round Snapshot
      ↓
Assignments
      ↓
Counting
      ↓
Submission
      ↓
Compilation
```

A later inventory synchronization cannot silently move products underneath an active round. A new round receives a fresh snapshot and can therefore incorporate legitimate inventory changes, including newly introduced SKUs.

### Compilation rules

Compilation:

- Checks whether required assignments have submitted.
- Can block incomplete compilation.
- Supports "Compile Anyway" where permitted.
- Merges assignment results using the application's item identity rules (including Company + Item ID where applicable).
- Detects cross-round conflicts.
- Does not silently resolve conflicting counts.

Conflicts remain visible for Main Auditor review.

### Time tracking

Assignments record start time and per-row counting time, with row-level caps so a long break is not attributed to a single product.

---

## 4. Recount Strategies

The system supports focused recounts instead of forcing a complete inventory recount.

| Strategy | Behaviour |
|---|---|
| Differences Only | Only products with relevant discrepancies are carried into the next round. |
| Full Company Recount | The selected companies are counted again in full. |
| Random Spot-Check | A random subset is selected for verification. |

This allows the audit to progressively narrow its attention.

---

## 5. Variance Corrections

A variance correction does not overwrite the original evidence.

```
Original Count
     ↓
Correction Proposal
     ↓
Reason Recorded
     ↓
Main Auditor Review
     ↓
Approve / Reject
```

The original count remains recoverable. An audit system should preserve evidence rather than silently rewrite history.

---

## 6. Roles

| Role | Access |
|---|---|
| Main Auditor (`main`) | Full access to inventory, engagements, rounds, assignments, compilation, snapshots, staff, reports, settings, barcode administration and audit logs. |
| Deputy Auditor (`dep`) | Read access to team-audit information, plus the ability to propose variance corrections and perform permitted barcode registration/verification/conflict reporting. |
| Sub-Auditor (`sub`) | Own assignments, Individual Audits, counting, shared expiry workflows and permitted barcode scanning. Barcode administration remains restricted. |

Authentication uses **Phone + PIN**. The application maps the phone number to an internal Supabase Auth email:

```
<phone-digits>@staff.internal
```

There is no separate client-side "admin mode". Authorization is not based only on the UI: Supabase RLS and server-side functions enforce access at the database/backend layer.

---

## 7. Team Audit Workflow

A typical Main Auditor workflow:

1. Synchronize or import inventory.
2. Create/manage staff accounts.
3. Create an Engagement.
4. Select the audit scope.
5. Select the counting method.
6. Create Round 1.
7. Automatically split assignments.
8. Review the assignment preview.
9. Lock the round.
10. Staff perform their counts.
11. Staff submit.
12. Main Auditor compiles the round.
13. Review quantity and financial variances.
14. Review conflicts and corrections.
15. Generate a Final Snapshot or another recount round.
16. Export reports.

### Counting methods

Each audit can use **Manual**, **Barcode** or **Hybrid** counting. The selected method is copied to assignments so Sub-Auditors can operate without requiring access to the parent Engagement.

---

## 8. Individual Audits

Individual Audits allow a Sub-Auditor to perform an audit without waiting for a Main Auditor to create a dedicated team engagement.

Available scopes:

- Saved Templates
- Company-based selections
- Other configured individual-audit scopes

Individual work is organized into rolling monthly engagements. This suits:

- Spot checks
- Frequent company checks
- Random verification
- Staff-initiated audits
- Small tasks that do not justify a full team engagement

---

## 9. Barcode System

Barcode functionality is a dedicated identification layer on top of the existing counting system. It does not create a second inventory or variance engine.

```
Barcode
   ↓
Resolve Product
   ↓
Existing Assignment Item
   ↓
Existing Counting Logic
   ↓
Existing Variance Logic
```

### Barcode Center

The Barcode Center provides:

- Scan
- Barcode Master
- Register
- Verification Queue
- Conflicts
- Scan History
- Reports

### Barcode lifecycle

Normal lifecycle:

```
Unknown → Registered → Verified
```

Problem states:

```
Conflict
Disabled
```

A conflicting barcode is **never silently reassigned**. The Main Auditor resolves conflicts explicitly:

- Keep existing mapping
- Reassign
- Disable

Administrative conflict resolution records a reason.

---

## 10. Barcode Counting

Three counting methods are available:

| Method | Description |
|---|---|
| Manual | Traditional product-by-product counting. |
| Barcode | Products are identified through barcode scanning. |
| Hybrid | The auditor combines manual product selection and barcode scanning. |

The barcode subsystem resolves the product and then passes it into the normal counting workflow. Quantity calculations, variance calculations and submission logic remain centralized.

---

## 11. Camera Scanner

The web scanner supports multiple decoding strategies depending on the device.

| Device | Decoder |
|---|---|
| Chrome / Android | The browser's native `BarcodeDetector`, where available. |
| iPhone / iPad | Vendored ZXing, because Safari lacks native `BarcodeDetector` support. |
| Difficult labels | ZXing-C++ WebAssembly engine. |

The WASM engine ships as:

```
js/vendor/zxing-wasm-reader.iife.js
js/vendor/zxing_reader.wasm
```

and improves recognition of:

- Blur
- Rotation
- Low contrast
- Damaged labels
- Small/dense labels

The older JavaScript ZXing implementation remains available as a fallback.

---

## 12. Scanner Quality Controls

The scanner includes several safeguards against false reads.

**Camera** — where supported, it requests the rear camera, higher-resolution capture, continuous autofocus, and exposure/white-balance control. The user can tap the viewfinder to refocus.

**Controls** — supported devices may expose torch, zoom, camera controls, refocus and screen wake-lock.

**Guidance** — the scanner can detect:

- Too dark
- Glare
- Low contrast
- Excessive distance
- Camera movement

**Auto-torch** — when a frame stays dark and the hardware supports a torch, the scanner can switch it on automatically.

**Still-image fallback** — if live decoding keeps failing, supported devices can capture a full-resolution still image and attempt decoding from it.

**Feedback** — success flash, beep and vibration.

---

## 13. Barcode Validation

Numeric EAN/UPC/GTIN-style results are validated using their check digit.

The scanner also uses repeated-read confirmation to reduce false positives:

```
Reliable GTIN        → fewer confirmations required
Other barcode types  → stronger repeated-read confirmation
```

Full-frame acceptance is limited so that unrelated barcode fragments are less likely to become false product numbers.

---

## 14. Offline Barcode Support

Barcode data has its own local IndexedDB cache and outbox:

```
barcodeCache
barcodeOutbox
```

Scan events receive client-side identifiers, so duplicate submissions can be ignored server-side.

```
Scan online  OR  Scan offline
          ↓
     Local queue
          ↓
 Connectivity returns
          ↓
   Synchronization
```

---

## 15. Expiry Tracking

The Expiry module maintains a shared near-expiry stock register.

Records can contain:

- Product
- Quantity
- Expiry month
- Rack
- Status
- Assigned staff member

The system supports monthly rack-to-staff assignment and universal product search. Saved entries can be locked; only the Main Auditor can reopen, edit or delete locked entries.

---

## 16. Reports

The system generates Excel workbooks (`.xlsx`) covering the major audit stages:

- Final Audit Report
- Variance Report
  - Auditor Notes
  - Cross-Round Conflicts
- Combined Variance Report
- Round History
- Submission History
- Audit Trail
- Inventory Report

The legacy Verify Stock workflow also retains its own historical/export capabilities.

---

## 17. Architecture

The web application follows a five-layer ("five-floor") architecture:

```
┌─────────────────────────────────────────────┐
│ FLOOR 5 — PAGES                             │
│ DOM rendering + event delegation            │
├─────────────────────────────────────────────┤
│ FLOOR 4 — COMPONENTS                        │
│ Presentation / pure render functions        │
├─────────────────────────────────────────────┤
│ FLOOR 3 — ACTIONS                           │
│ Business logic + state-changing operations  │
├─────────────────────────────────────────────┤
│ FLOOR 2 — STORE                             │
│ Central in-memory application state         │
├─────────────────────────────────────────────┤
│ FLOOR 1 — REPOSITORY                        │
│ Supabase / IndexedDB / localStorage /       │
│ Dropbox / persistence                       │
└─────────────────────────────────────────────┘
```

### Architectural rules

- Repository owns persistence and external data access.
- Actions own business operations and state changes.
- Store owns application state.
- Components focus on rendering.
- Pages handle page-level composition.
- Event delegation centralizes DOM events.
- Global application state is avoided.
- Actions communicate UI changes through the application Bus.
- Barcode identification remains separate from counting and variance calculation.

---

## 18. Repository Structure

```
.
├── index.html
├── manifest.json
├── sw.js
├── package.json
├── CNAME
│
├── css/
│   ├── app.css
│   ├── barcode.css
│   ├── desktop.css
│   ├── design-upgrade.css
│   └── engagement.css
│
├── js/
│   ├── main.js
│   ├── actions.js          # barrels: re-export each floor's index
│   ├── components.js
│   ├── pages.js
│   ├── repository.js
│   ├── store.js
│   ├── home-stats.js
│   │
│   ├── actions/            # incl. index.js, bus.js, item-key.js
│   ├── barcode/
│   ├── components/         # incl. index.js, dom-utils.js
│   ├── pages/
│   ├── repository/
│   ├── store/
│   └── vendor/             # ZXing + ZXing-C++ WASM (+ licences)
│
├── supabase/
│   ├── schema.sql
│   ├── barcode-schema.sql
│   └── admin-actions/
│       └── index.ts
│
├── tests/
│   ├── *.test.mjs
│   └── fixtures/
│
├── docs/
│   ├── ANDROID_APP.md
│   └── BARCODE.md
│
├── AndroidApp/             # Capacitor Android application
├── AuditWidget/            # Kotlin Android widget
├── .github/workflows/
└── BLUEPRINT_v1_original.md
```

---

## 19. Data and Persistence

Audit Hub uses different persistence layers for different responsibilities.

### Supabase

The shared backend stores and controls:

- Authentication
- Staff
- Engagements, rounds and assignments
- Submissions and compiled rounds
- Final snapshots
- Audit logs
- Templates
- Expiry data
- Barcode data
- Shared inventory (`inventory_products`)

### IndexedDB

Local/offline data:

- Inventory/cache information
- Counting checkpoints
- Barcode cache and outbox
- Other offline application data

### localStorage

Lightweight local preferences and settings.

### Dropbox

Dropbox is the upstream inventory source. The browser does not maintain an independent authoritative Dropbox copy: inventory synchronization populates the shared Supabase inventory dataset so multiple devices operate against the same data.

> **Note:** the repository references a separate `sync-inventory-from-dropbox` Supabase Edge Function. It is **not contained in this repository** and must be deployed separately if server-side Dropbox synchronization is required.

CSV/manual import remains available as a fallback.

---

## 20. Supabase Security Model

Authorization is enforced at the database/backend level rather than relying only on client-side UI restrictions.

- **Supabase Auth** — each staff member has a real authenticated Supabase identity.
- **Row Level Security** — RLS policies restrict access by the authenticated user and their staff role. A client cannot bypass authorization by modifying JavaScript or calling a different API.
- **Access expiry** — staff access can have an expiration timestamp, checked server-side.
- **Assignment protection** — Sub-Auditors cannot modify protected assignment configuration or ownership fields.
- **Engagement protection** — database functions prevent counting/submission activity against inappropriate engagement states.
- **Barcode protection** — barcode administration uses protected (security-definer) database operations and role checks.
- **Service-role key** — remains exclusively inside the privileged `admin-actions` Edge Function and must never be shipped to the browser.
- **Audit logging** — important operations are recorded in the audit log. Offline-capable logging can queue events locally and synchronize them when connectivity returns.

---

## 21. Supabase Setup

### Main schema

Run `supabase/schema.sql` in the target Supabase project's SQL Editor. The schema is re-runnable through `IF EXISTS` / `IF NOT EXISTS` and related migration-safe patterns.

### Barcode schema

After the main schema, run `supabase/barcode-schema.sql`. It creates the barcode subsystem's tables, policies and functions.

### Admin Edge Function

Deploy `supabase/admin-actions/index.ts` as `admin-actions`:

```bash
supabase functions deploy admin-actions
```

The function requires the Supabase service-role key through the Edge Function environment.

---

## 22. Creating the First Main Auditor

For a fresh Supabase project:

1. Create a Supabase Auth user.
2. Use the internal email format `<phone-digits>@staff.internal`.
3. Set the password to the selected PIN.
4. Confirm the account.
5. Create the corresponding `staff` record.
6. Set `role = main`.
7. Open the application.
8. Sign in using phone + PIN.

After the first Main Auditor exists, staff administration can be performed from the application.

---

## 23. Android Application

`AndroidApp/` is a Capacitor 8 Android shell around the live application. It loads <https://random.duapharma.com>.

The web application remains the primary system. The Android app does not create a second database or second audit engine.

**Android adds:**

- Native Android shell
- Google ML Kit barcode scanner
- Native camera autofocus
- Automatic scanner zoom
- Fast native scanning
- Continuous barcode-counting integration

---

## 24. Android Barcode Flow

In the native application:

```
Tap Scan
   ↓
Google ML Kit
   ↓
Barcode result
   ↓
Existing web barcode workflow
```

For continuous counting:

```
Open scanner
   ↓
Scan product
   ↓
Enter quantity
   ↓
Confirm / Cancel
   ↓
Scanner reopens
   ↓
Scan next product
```

If native ML Kit scanning cannot be used, the application falls back to the existing web scanner.

---

## 25. Android Updates

| Change location | Effect |
|---|---|
| Outside `AndroidApp/` (web) | Appears automatically after the live website updates. |
| Inside `AndroidApp/` (native) | Requires a new APK build and installation. |

Native changes include Capacitor dependencies, ML Kit integration, native permissions, Android configuration, native icons and Android code.

---

## 26. Android CI/CD

Workflow: `.github/workflows/build-android-app.yml`

It runs when:

- `AndroidApp/**` changes on `main`
- The workflow is manually dispatched

The build uses Node.js 22, JDK 21, Capacitor and the Android Gradle tooling.

It:

1. Checks out the repository.
2. Installs Node dependencies.
3. Synchronizes Capacitor.
4. Builds the debug APK.
5. Uploads the APK as a GitHub Actions artifact.
6. Refreshes the `android-latest` GitHub Release.

The generated APK is `PharmacyAuditHub.apk`.

> **Important:** the current Android build is **debug-signed**. A production release should use a dedicated release keystore.

---

## 27. Android Individual Assignments Widget

`AuditWidget/` is a separate Kotlin Android application that gives the Main Auditor a quick view of open Individual Assignment rounds.

The widget can display:

- Round number
- Engagement
- Assignee
- Round state
- Counting progress
- Assignment status

It uses the same Supabase backend and authenticated staff identity. The session is stored in Android-side protected storage. The widget refreshes periodically through WorkManager and can be refreshed manually. It remains subject to Supabase RLS and does not contain a service-role key.

### Widget architecture

```
LoginActivity
SupabaseAuth
TokenStore
RoundsRepository
WidgetUpdateWorker
IndividualRoundsWidgetProvider
WidgetRemoteViewsService
```

See `AuditWidget/README.md` for installation and usage.

---

## 28. Widget CI

Workflow: `.github/workflows/build-widget-apk.yml`

It:

1. Checks out the repository.
2. Installs JDK 17.
3. Generates the Gradle wrapper.
4. Builds the debug APK.
5. Uploads it as the `audit-rounds-widget-debug-apk` GitHub Actions artifact.

The current widget APK is debug-signed.

---

## 29. Progressive Web App

The web application is an installable PWA providing:

- Web App Manifest
- Service Worker
- Offline asset caching
- Installable standalone mode
- Home-screen shortcuts
- Mobile-oriented interface
- Desktop support

### Service worker

- The cache version is the `CACHE_NAME` constant at the top of `sw.js`.
- At install, the service worker precaches the application shell, CSS, favicons and icons, the **complete ES-module graph of `js/main.js`**, the ZXing/WASM scanner assets, and the CDN libraries (SheetJS and the Supabase client). A freshly installed app can therefore start offline.
- At runtime, app code (HTML/JS/CSS/JSON/WASM and the CDN libraries) is **network-first with cached fallback**; icons and favicons are cache-first.

> **Keep in sync:** the precache list in `sw.js` is maintained manually. When you add or remove a JS module, update `STATIC_ASSETS` too, or the offline-start guarantee quietly breaks.

For the complete PWA experience, serve the application over HTTPS.

---

## 30. Development

The web application deliberately has no frontend bundler or framework build step. It uses native ES modules.

Install Node.js and run:

```bash
npm test
```

This runs `node --test tests/*.test.mjs`.

---

## 31. Test Suite

The repository currently contains 22 Node test files covering:

- Barcode components, lookup, service and validation
- Native barcode integration
- Scanner quality and scanner behaviour
- Barcode reports
- WASM barcode processing and ZXing behaviour
- Compilation
- Force Submit
- Individual Assignments
- Item identity
- Live snapshots
- Product search
- Round deletion/renumbering and round overlap
- Row timing
- Uncounted-item rules
- Variance corrections
- Extra notes

Tests use Node's built-in test runner. Barcode image fixtures live in `tests/fixtures/barcodes/`.

---

## 32. Testing Philosophy

The test suite focuses heavily on business invariants:

```
Uncounted item → Counted quantity = 0

Barcode → Product identification
        → Existing count workflow
        → Existing variance logic

Conflicting barcode → Explicit conflict
                    → No silent reassignment

Variance correction → Proposal
                    → Reason
                    → Main Auditor review
                    → Original count preserved

Round → Snapshot
      → Assignments
      → Submissions
      → Compilation
      → Variance review
      → Recount / Final Snapshot
```

---

## 33. Deployment

The web application is a static ES-module application and can be served from any static HTTPS host. The repository includes a `CNAME` for the production domain `random.duapharma.com` (currently served via GitHub Pages).

### Web deployment checklist

1. Verify the website loads.
2. Verify authentication.
3. Verify inventory loading.
4. Verify Templates.
5. Verify Team Audit creation.
6. Verify assignment generation.
7. Verify counting.
8. Verify submission.
9. Verify compilation.
10. Verify variance review.
11. Verify barcode scanning.
12. Verify offline behaviour.
13. Verify Supabase connectivity.
14. Verify PWA installation.
15. Verify Android behaviour if the web changes affect native integration.

### Service-worker changes

When important cached assets change, bump `CACHE_NAME` in `sw.js`. This retires old caches during service-worker activation. If you added or removed a JS module, update `STATIC_ASSETS` as well.

---

## 34. Documentation

| Document | Covers |
|---|---|
| [`docs/BARCODE.md`](docs/BARCODE.md) | Barcode architecture, counting methods, scanner behaviour, camera requirements, offline operation, decoder strategy, roles, scanner quality improvements. |
| [`docs/ANDROID_APP.md`](docs/ANDROID_APP.md) | Capacitor Android shell, Google ML Kit, APK builds, updates, offline behaviour, local development. |
| [`AuditWidget/README.md`](AuditWidget/README.md) | Widget architecture, authentication, Supabase session handling, refresh, installation, debug APK usage. |

---

## 35. Known Gaps and Recommended Future Work

The system is already a substantial production-oriented internal audit platform. These improvements would make it stronger.

### High priority

1. **Production Android signing** — replace debug signing with a protected release keystore.
2. **Automated end-to-end testing** — test against a disposable/staging Supabase environment instead of relying primarily on unit/business-rule tests. This would also cover untested auth edge cases, such as session validity at the exact moment an account is blocked.
3. **Deployment diagnostics** — a visible diagnostic showing web version, service-worker version, backend environment, last inventory synchronization, offline queue state and build timestamp.
4. **Better offline reconciliation** — extend the queue/retry architecture into a consistent conflict-resolution model for every offline-capable operation.
5. **Database migrations** — as the schema grows, move from one large re-runnable SQL file toward explicit versioned migrations.
6. **Service-worker precache guard** — a test that fails when `STATIC_ASSETS` drifts from the real module graph.

### Medium priority

- Multi-branch audit management
- Scheduled and recurring audits / reusable assignment templates
- Push notifications
- Drag-and-drop assignment balancing (currently a tap-based "Move to…" picker)
- Advanced analytics: historical variance trends, auditor productivity, richer management dashboards
- Automated inventory-sync monitoring
- Centralized Android release management
- Automated smoke tests after deployment

### Longer-term

- Direct POS integration
- AI-assisted variance investigation
- Predictive discrepancy and anomaly detection
- Regulatory/compliance dashboards
- Intelligent audit sampling
- Cross-branch benchmarking

---

## 36. Design Principles

1. **Never silently lose an audit item** — an uncounted item should remain visible as a discrepancy.
2. **Never silently overwrite evidence** — original counts, corrections and audit history should remain traceable.
3. **Database authorization is authoritative** — UI restrictions improve user experience, but Supabase RLS and server-side functions provide the actual security boundary.
4. **Barcode is an input layer** — scanning should make counting faster without creating a second independent inventory or variance system.
5. **Offline operation should be deliberate** — temporary connectivity loss should not destroy work.
6. **Recounts should become progressively focused** — later rounds should concentrate on disagreement rather than repeating the entire audit.
7. **Management should always understand progress** — the Main Auditor should see:
   - Who is assigned
   - Who has started
   - How much has been counted
   - Who has submitted
   - What differs
   - What conflicts remain
   - What requires correction

---

## 37. Technology Summary

| Layer | Technology |
|---|---|
| Web UI | HTML / CSS / native ES modules |
| Frontend framework | None |
| Build system | None for web |
| Backend | Supabase |
| Database | PostgreSQL |
| Authentication | Supabase Auth |
| Authorization | PostgreSQL RLS + server-side functions |
| Local database | IndexedDB |
| Lightweight storage | localStorage |
| Inventory source | Dropbox + CSV fallback |
| PWA | Web App Manifest + Service Worker |
| Barcode (web) | BarcodeDetector + ZXing + ZXing-C++ WASM |
| Android shell | Capacitor 8 |
| Native Android scanner | Google ML Kit |
| Android widget | Kotlin, WorkManager |
| Android build | Gradle |
| CI | GitHub Actions |
| Testing | Node.js built-in test runner |
| Reports | XLSX generation (SheetJS) |

---

## 38. Project Status

Fazal Din Pharma Plus — Audit Hub is an actively developed internal pharmacy stock-audit platform. Its current architecture combines:

```
Shared Inventory
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
Supabase Authorization
      +
Audit History
      +
Excel Reporting
      +
PWA
      +
Native Android Scanning
      +
Android Management Widget
```

The web application remains the primary audit platform and system of record. The Android application provides a specialized native scanning experience around the same web system, while the Android widget provides a lightweight management view for Individual Assignments.

---

## Repository

- **GitHub:** <https://github.com/sysalmanyasin/Random>
- **Live application:** <https://random.duapharma.com>
- **Primary branch:** `main`

## License / Internal Use

This repository is maintained for the operational use of Fazal Din Pharma Plus.

Refer to the repository configuration and organizational policies before redistributing or deploying the application outside its intended environment.
