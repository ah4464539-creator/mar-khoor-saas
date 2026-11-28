# Mar-Khoor Android apps

Two apps from one project. Both are Trusted Web Activities: they open the live website full screen in Chrome (no WebView), so every website deploy updates the apps at once. A Play Store update is only needed for a new icon, name or Android setting.

| Flavor | Play Store name | Package | Opens |
|---|---|---|---|
| `business` | Mar-Khoor Business | `com.markhoor.business` | `/restaurant.html#order-desk` (owner dashboard, new-order notifications) |
| `customer` | Mar-Khoor | `com.markhoor.app` | `/app` (find a business, order, book, track) |

## Build
Requirements: JDK 17+, Android SDK (platform 36), Gradle 8.14.

```bash
export ANDROID_HOME=/path/to/android-sdk
export MK_UPLOAD_STORE_FILE=/secure/path/markhoor-upload.jks MK_UPLOAD_STORE_PASSWORD=... MK_UPLOAD_KEY_ALIAS=upload MK_UPLOAD_KEY_PASSWORD=...
gradle bundleBusinessRelease bundleCustomerRelease
```
Outputs: `app/build/outputs/bundle/<flavor>Release/app-<flavor>-release.aab`.

Without the `MK_UPLOAD_*` variables the release build is unsigned. **The upload keystore is never committed.** Keep it and its password safe. If it is lost, ask Google Play support to reset the upload key.

For a new release, raise `versionCode` (and `versionName`) in `app/build.gradle`.

## Full-screen check (Digital Asset Links)
`public/.well-known/assetlinks.json` (served at `https://mar-khoor.com/.well-known/assetlinks.json`) must list the SHA-256 of:
1. the **upload key** (already there), and
2. the **Play app signing key**: Play Console → app → Test and release → App integrity → App signing key certificate → SHA-256. Add it to both entries after the first upload.

If a fingerprint is missing, the app still works but shows a small browser bar at the top.
