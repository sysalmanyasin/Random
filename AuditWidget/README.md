# Individual Assignments — Open Rounds (Android Widget)

A small companion Android app whose only job is to show a home-screen widget
listing open rounds under **Individual Assignments** in the Pharmacy Audit
Hub — round number, assignee, and progress — pulled straight from the same
Supabase project the main PWA uses.

## How it works

- **Login screen** (`LoginActivity`) — phone + PIN, same credentials as the
  main app. Signs in against Supabase Auth directly (`phone@staff.internal`
  convention) and stores the session (access + refresh token) in
  `EncryptedSharedPreferences` on-device. Nothing is sent anywhere else.
- **Widget** — a home-screen `AppWidgetProvider` backed by a `ListView` +
  `RemoteViewsService`. Every refresh queries Supabase's REST API *using
  that stored session token* — so the widget only ever sees what that
  logged-in Main Auditor's RLS policies allow, same as the app.
- **Auto-refresh** — a WorkManager job nudges the widget to re-fetch every
  ~15 minutes; tapping the refresh icon on the widget forces an immediate
  one. Access tokens are silently refreshed via the stored refresh token
  when they expire.
- **Data shown per row:** `R{round_number} · {engagement} · {auditor}`,
  a colored state pill (draft/locked/counting/compiled/final), and
  `{progress_count}/{total items} · {assignment status}`.

## One-time setup

1. **Build the APK** — push this folder to GitHub (already wired to
   `.github/workflows/build-widget-apk.yml`, or run it manually from the
   Actions tab → "Build Individual Rounds Widget APK" → Run workflow).
   Download the `audit-rounds-widget-debug-apk` artifact when it finishes.
2. **Install it** on the Main Auditor's phone (enable "install unknown
   apps" for whichever app you download it through).
3. **Open the app once**, log in with the Main Auditor's phone + PIN.
4. **Long-press the home screen → Widgets → Audit Rounds Widget**, drag it
   onto the home screen.

That's it — no separate config screen; the widget reads the session the
login screen just created.

## Notes / things to know

- The Supabase URL and anon (publishable) key are baked into
  `app/build.gradle.kts` at build time — the anon key is safe to ship in
  the APK, same as it's safe in the PWA's own JS. It cannot bypass Row
  Level Security on its own; the widget's actual visibility is governed by
  the logged-in session token, per your instruction.
- This is a **debug-signed APK** (fine for installing directly on your own
  device via "unknown sources"). If you want it distributed more broadly
  later, it'll need a proper release signing key — ask and I'll wire that
  into the workflow using GitHub Actions secrets.
- Only Main Auditor accounts should log in here — a Sub-Auditor's RLS
  policies wouldn't return the individual-assignments overview this widget
  is built for anyway.
