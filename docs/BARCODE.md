# Barcode & Scanner subsystem

Setup: run `supabase/barcode-schema.sql` once (already applied to the BTpharmacyAudit@2026 project).

- Barcode Center (Home tile): Scan, Master, Register, Queue, Conflicts, Scans, Reports.
- Counting Method (Main Auditor → open audit → Counting Method): Manual / Barcode / Hybrid (default). Applies to all assignments and recounts of that audit.
- Scan to count: Sub-Auditor counting screen → "Scan to count". Counts are saved through the existing `recordMyCount`; variance logic is unchanged.
- Recount: the assignment's own item list is the allowlist, so a Difference-Only recount rejects any product that is not in it.
- Offline: barcode mirror + outbox live in IndexedDB v6 (`barcodeCache`, `barcodeOutbox`). Scan events carry a client id; the server ignores repeats.
- Roles (enforced by RLS / SECURITY DEFINER functions): Sub reads verified barcodes and logs own scans; Deputy also registers/verifies/flags conflicts; Main also changes, disables and resolves conflicts and sees full history.
- Camera scanning needs HTTPS and a user tap. Chrome/Android uses the browser's built-in BarcodeDetector. iPhone/iPad Safari has none, so a vendored ZXing decoder (`js/vendor/zxing-library.min.js`, Apache-2.0) is loaded on demand. Hardware (keyboard-wedge) scanners and typing work everywhere.

## Camera scanner quality (v8.95)

- **Focus/exposure:** requests 1080p/30fps rear camera; turns on continuous autofocus, exposure and white balance wherever the phone exposes them. Tap the viewfinder to refocus.
- **Controls:** torch and zoom slider appear only on phones that support them (default zoom 1.5x).
- **Decoding:** native `BarcodeDetector` (Chrome/Android) on the laser-box strip + full frame; ZXing fallback (iOS Safari) runs strip → full frame → inverted strip, each with auto contrast stretch.
- **Accuracy:** EAN/UPC/GTIN accepted on one read (check digit verified); Code 128/39/QR etc. need two matching reads.
- **UX:** red laser sweep, dimmed surround, green flash + beep/vibration on success, screen kept awake while scanning.

## Camera scanner v8.96 — WASM engine, guidance, auto-torch, still capture

- **Engine:** ZXing-C++ compiled to WebAssembly (`js/vendor/zxing-wasm-reader.iife.js` + `zxing_reader.wasm`, MIT, see `ZXING-WASM-LICENSE.txt`). It handles blur, rotation, low contrast and damaged codes far better than the old JS port, which stays as an automatic fallback if WASM can't load. iPhone/iPad use it from the first frame; Chrome/Android keep the native detector and load WASM as a second opinion after ~1.5 s with no read.
- **Light-on-dark labels:** ZXing-C++ does not self-invert EAN/UPC, so every third frame also runs a manual inverted strip.
- **Guidance (`barcode-quality.js`):** after ~2 s with no read the viewfinder says "Too dark", "Glare", "Hold steady — move back a little" or "Low contrast". Silent during normal scans.
- **Auto-torch:** if the frame stays dark and the phone has a torch, it turns on once. Tapping the torch button yourself always overrides it.
- **Still capture:** if live frames keep failing for ~2.5 s, it takes a full-resolution photo (`ImageCapture.takePhoto`, where supported) and decodes that — at most once every 5 s. Helps tiny/dense labels such as blister strips and GS1 DataMatrix. Some Android phones may play a shutter sound.
- **Offline:** the engine and `.wasm` are precached and served network-first with cache fallback (`sw.js`, cache `v8.96-scanner-wasm`).

## v8.97 — wrong-number fix

Camera reads are now accepted only when: (1) numeric 8/12/13/14-digit codes pass the real GTIN check digit (otherwise dropped as a misread); (2) the same value is read on consecutive frames — 2× for a valid GTIN, 3× for other codes; (3) it comes from inside the laser box (whole frame only after 3 s of silence). ITF, Codabar and Code 93 were removed from the camera decoders (phantom digits from fragments of other barcodes); ZXing-C++ now needs 3 agreeing scan lines.
