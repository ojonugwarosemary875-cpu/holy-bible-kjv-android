# Holy Bible KJV — Standalone Android Project

The app is built with React, Vite and Capacitor. AppDeploy runtime and server code have been removed.

## Replaced services
- **Google sign-in:** Native Google sign-in via the Capacitor Firebase Authentication plugin, then Firebase JS credentials for the web layer.
- **Prayer reminders:** Scheduled Android local notifications; schedules and prayer-point text are stored locally and optionally synced to each signed-in user's Firestore document.
- **Voice Companion:** Firebase AI Logic client SDK (`gemini-2.5-flash`); no separate Gemini key is hard-coded.
- **Bible content:** bundled offline KJV resource; reading and notes remain local/offline-first.

## Firebase console setup (required)
1. In Authentication, confirm Google is enabled as a sign-in provider.
2. Create/enable Cloud Firestore. Publish the included `firestore.rules` rules. The rules restrict prayer reminder records to their signed-in owner.
3. Enable Firebase AI Logic and verify the selected model, quotas and billing settings for your Firebase project.
4. Firebase App Check is recommended before public release to reduce abuse.
5. Add the Google Play App Signing SHA-1 fingerprint to Firebase before Play Store release, then download the updated `google-services.json`.

## Reminder limitations
Prayer alarms are device-local and scheduled by Android. They do not require a server or the app to remain open. Notifications are gentle fixed reminders, not dynamically generated prayers. The browser preview does not provide reliable daily scheduled notifications; use the installed Android app.

## Build
GitHub Actions builds the web assets, syncs Capacitor Android plugins, assembles a debug APK and uploads the APK as an artifact. The included keystore is for debug testing only; never use it as a Play Store release key.

## Firestore rules
`firestore.rules` is also referenced from `firebase.json` for Firebase CLI deployment.


## Welcome artwork update (2026-11)
- Added first-launch Christ-centered welcome artwork (`public/welcome-jesus-child.jpg`) with Skip and Continue actions.
- Reused the welcome artwork as a faded background for prayer experience panels.
- Fixed Bible icon asset references to match the actual public icon path.
- Added a Psalm 23:1 verse to the splash screen.

Build verification is pending: dependency installation timed out in the current environment, so a Vite/TypeScript build has not yet been confirmed.
