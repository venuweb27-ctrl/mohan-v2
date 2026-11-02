# Domain setup — store.mohanmishra.app (Namecheap → Render)

The web store (and the Android app's `APP_URL`) lives on the **subdomain** `store.mohanmishra.app`. The apex `mohanmishra.app` is **not** touched.

## 1. Namecheap — Advanced DNS
Domain List → `mohanmishra.app` → **Manage** → **Advanced DNS** → Host Records:
1. Delete any existing record whose **Host is `store`** (A, AAAA, CNAME, URL Redirect, or parking). Leave `@`, `www` and everything else alone.
2. **Add New Record**:

| Type | Host | Value | TTL |
|---|---|---|---|
| CNAME Record | `store` | `mohanmishra-v2.onrender.com.` | Automatic |

3. Save (green tick). Namecheap usually propagates in 5–30 min.

## 2. Render (done by the owner, not by this pack)
Dashboard → service **mohanmishra-v2** → Settings → **Custom Domains** → Add `store.mohanmishra.app` → Verify. Render issues a Let's Encrypt certificate automatically once DNS resolves.

## 3. HTTPS note
`.app` is on the browser HSTS preload list: every `*.mohanmishra.app` host is HTTPS-only, plain http never loads. That's fine — Render serves the auto certificate. Until the cert is "Issued" on Render the domain will show a certificate error; just wait.

## 4. Verify
```
dig +short store.mohanmishra.app CNAME     # → mohanmishra-v2.onrender.com.
curl -sI https://store.mohanmishra.app/ | head -1                 # HTTP/2 200
curl -s https://store.mohanmishra.app/.well-known/assetlinks.json # package com.app.mmpl + 2 fingerprints
curl -sI https://store.mohanmishra.app/privacy | head -1          # 200 (after the new code is deployed)
```
Then in Play Console → App integrity / Deep links, the `store.mohanmishra.app` link should show as verified.

## 5. App URL / fallback
- `android-wrapper/gradle.properties`: `appUrl=https://store.mohanmishra.app/` (default).
- Fallback if the domain isn't live before rollout: build with `-PappUrl=https://mohanmishra-v2.onrender.com/` (same versionCode rules apply — bump `appVersionCode` for every upload).
- assetlinks fingerprints come from env `ANDROID_SHA256` (default: Play App Signing `68:D0:…:47` + upload key `F0:EF:…:53`).
