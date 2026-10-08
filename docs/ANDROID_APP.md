# Android app (Capacitor + Google ML Kit scanner)

`AndroidApp/` wraps the **live site** (`https://random.duapharma.com`) in a native Android shell.
The website, Supabase data, logins and PWA are untouched — the APK is just another way to open them.

## What it adds
- **Native barcode scanning** through Google ML Kit (`@capacitor-mlkit/barcode-scanning`): real autofocus,
  auto-zoom and fast reads. In the APK, the **Scan / Start camera** buttons open Google's scanner;
  in a normal browser (and on iPhone) the existing web camera is used, unchanged.
- **Barcode Center:** one scan per tap — the result stays on screen.
- **Counting screen (continuous):** tap the camera once. After each product is read you enter the quantity and CONFIRM
  (or Cancel); the **camera stays on** (one session, not reopened per item). Tap **Stop camera** or Done to stop. Unknown, invalid or
  disputed barcodes show their message and pause continuous mode until you tap the camera again, so you can read the warning.
  If the Google scanner can't be used on a phone (no Google Play Services, module download fails), the
  web camera is used automatically.

## Updates
- **Web changes** (everything in this repo outside `AndroidApp/`): appear in the app automatically.
- **Native changes** (`AndroidApp/**`: plugin versions, icon, permissions): a new APK is built by
  GitHub Actions and must be reinstalled.

## Getting the APK
Every push touching `AndroidApp/` (or a manual run of **Build Android App**) builds
`PharmacyAuditHub.apk` and publishes it at the repo's **Releases → android-latest** page.
On the phone: download it, allow *Install unknown apps* for the browser once, install.

The APK is signed with a per-build debug key, so a newer APK may refuse to install over an older one —
uninstall first. (To keep one signing key, add a release keystore as repository secrets and tell Claude.)

## Offline
The app loads the site from the network. If the phone is offline at launch it shows a local
"Can't reach Pharmacy Audit Hub — Retry" page. Once loaded, the site's service worker keeps working as in Chrome.

## Local build (optional)
```
cd AndroidApp && npm ci && npx cap sync android && cd android && ./gradlew assembleDebug
```
Needs JDK 21 and the Android SDK.
