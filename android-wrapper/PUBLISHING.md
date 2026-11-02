# Publishing to Google Play

## 1. Create an upload key (once, keep it safe; never commit)
```
keytool -genkeypair -v -keystore mohanmishra-upload.jks -alias upload -keyalg RSA -keysize 2048 -validity 10000
```
Create `android-wrapper/keystore.properties` (it is git-ignored):
```
storeFile=mohanmishra-upload.jks
storePassword=********
keyAlias=upload
keyPassword=********
```

## 2. Build the signed bundle
1. Bump `versionCode` and `versionName` in `app/build.gradle.kts`.
2. Run:
```
./gradlew bundleRelease -PappUrl=https://<your-production-domain>/
# → app/build/outputs/bundle/release/app-release.aab
```
Use your final custom domain if you have one. The URL and App Link host are baked in at build time.

## 3. Digital Asset Links (verified links: open site links in the app)
The server serves `/.well-known/assetlinks.json` from env vars:
- `ANDROID_PACKAGE` (default `in.mohanmishra.app`)
- `ANDROID_SHA256`: comma-separated SHA-256 cert fingerprints

Set `ANDROID_SHA256` to **both** fingerprints:
- **App signing key** (Play Console → Setup → App integrity → App signing; Play re-signs the app)
- **Upload key**: `keytool -list -v -keystore mohanmishra-upload.jks -alias upload`

On Render, add both as environment variables and redeploy. Then check `https://<domain>/.well-known/assetlinks.json`, and test with:
`adb shell pm verify-app-links --re-verify in.mohanmishra.app`

## 4. Play Console
1. Create the app: name "Mohan Mishra", default language English (India), App, Free.
2. Store listing:
   - short and full description (machinery & industrial equipment marketplace)
   - 512×512 icon: `web/icons/icon-512.png`
   - 1024×500 feature graphic
   - at least 2 phone screenshots (e.g. 1080×1920 captures of home, product, cart, orders)
3. App content:
   - privacy policy URL (the CMS page on the site)
   - data safety: account info, name/phone/email, addresses, purchase history; data encrypted in transit; deletion on request
   - target audience 18+; no ads
4. Category: Shopping. Contact email and phone.
5. Testing:
   - Upload the AAB to **Internal testing** and add testers.
   - Verify login, checkout, payments, uploads and deep links.
   - Promote to Closed testing, then Production. New personal accounts must run a closed test with 12+ testers for 14 days before production.
6. Payments: physical goods/machinery may use your own gateway. Play Billing is not required.

## 5. Updates
- Web changes go live instantly; no store update is needed.
- Ship a new AAB (with a higher `versionCode`) only when you change the wrapper, icon, URL or target SDK. Google requires the target SDK to stay within one year of the latest Android release.

## Alternative: Trusted Web Activity
The PWA already passes installability: a manifest, a service worker and maskable icons. You can also generate a TWA with Bubblewrap (`npx @bubblewrap/cli init --manifest https://<domain>/manifest.webmanifest`) and reuse the same package name and assetlinks. This wrapper was chosen because it builds offline, has no Chrome dependency, and handles UPI/tel intents.
