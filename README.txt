HOLY BIBLE KJV - ANDROID DEBUG SIGNING KEY

This debug.keystore is a persistent TEST/debug signing key used by the GitHub Actions workflow.
The workflow copies it to ~/.android/debug.keystore before building the debug APK.
Do not use this debug key as the Google Play production/release signing key.

Alias: androiddebugkey
Keystore password: android
Key password: android

Keep this file in the project so future debug builds keep the same signing certificate.
If it is replaced, the SHA fingerprints registered in Firebase must be updated.
