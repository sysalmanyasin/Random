# Barcode & Scanner subsystem

Setup: run `supabase/barcode-schema.sql` once (already applied to the BTpharmacyAudit@2026 project).

- Barcode Center (Home tile): Scan, Master, Register, Queue, Conflicts, Scans, Reports.
- Counting Method (Main Auditor → open audit → Counting Method): Manual / Barcode / Hybrid (default). Applies to all assignments and recounts of that audit.
- Scan to count: Sub-Auditor counting screen → "Scan to count". Counts are saved through the existing `recordMyCount`; variance logic is unchanged.
- Recount: the assignment's own item list is the allowlist, so a Difference-Only recount rejects any product that is not in it.
- Offline: barcode mirror + outbox live in IndexedDB v6 (`barcodeCache`, `barcodeOutbox`). Scan events carry a client id; the server ignores repeats.
- Roles (enforced by RLS / SECURITY DEFINER functions): Sub reads verified barcodes and logs own scans; Deputy also registers/verifies/flags conflicts; Main also changes, disables and resolves conflicts and sees full history.
- Camera scanning needs HTTPS and a user tap. Chrome/Android uses the browser's built-in BarcodeDetector. iPhone/iPad Safari has none, so a vendored ZXing decoder (`js/vendor/zxing-library.min.js`, Apache-2.0) is loaded on demand. Hardware (keyboard-wedge) scanners and typing work everywhere.
