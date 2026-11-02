# Mohan Mishra — Android wrapper (WebView shell for the PWA)

A small, dependency-free Java app (package `in.mohanmishra.app`) that opens the mobile-first web app full-screen. One codebase: the same site works in the browser, installs as a PWA, and ships to Play through this wrapper.

- **URL:** set by the Gradle property `appUrl`. The default (in `gradle.properties`) is `https://mohanmishra-v2.onrender.com/`.
  - Override it per build: `./gradlew assembleRelease -PappUrl=https://shop.example.in/`.
  - The host is also used for the verified App Link intent filter.
- **Behaviour:**
  - Links on the app's own host stay in the app. `tel:`, `mailto:`, `upi:`, WhatsApp, maps and other sites open in their own apps.
  - Includes a file chooser for KYC/doc uploads, back navigation, an offline/retry screen, a progress bar, and saved state.
- **Branding:** launcher icons are in `mipmap-*` plus an adaptive icon (`mipmap-anydpi-v26`). The splash is `drawable/splash.png` (photo, "Mohan Mishra" wordmark, tagline), shown as the window background. The theme is maroon `#8C0F2E` with amber `#F59E0B`.
- Cleartext HTTP is allowed only for `10.0.2.2` and `localhost` (emulator testing).

## Build
```
export JAVA_HOME=/home/box/android/jdk-17.0.21+9 ANDROID_HOME=/home/box/android/sdk
./gradlew assembleDebug                                    # app/build/outputs/apk/debug/app-debug.apk
./gradlew assembleDebug -PappUrl=http://10.0.2.2:4100/     # against a local server from the emulator
./gradlew bundleRelease                                    # Play AAB (needs keystore.properties, see PUBLISHING.md)
```

## Look & behaviour (Material 3 re-skin)
- Navy `#123B65` status bar, navigation bar, splash and adaptive-icon background; photo logo kept.
- WebView: pinch/double-tap zoom disabled, text zoom fixed at 100%, overscroll glow off (no accidental pull-to-refresh).
- Back button: closes the open drawer/bottom sheet first, then goes back in history, then exits.
- Status bar is opaque (not drawn under the content), so the web app does not need system insets inside the WebView; the PWA itself respects `env(safe-area-inset-*)` on iOS/Android browsers.
