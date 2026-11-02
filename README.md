# Mohan Mishra v2: Machinery & Industrial Equipment Marketplace (India)

Multi-vendor B2B/B2C marketplace for buying and getting quotes on machinery. GST-aware, priced in INR.
A single Node service serves the REST API at `/api/v1` and one SPA with three areas:

| Area | URL | For |
|---|---|---|
| Customer app | `/` | browse, search, cart, checkout, quotes, orders, invoices |
| Vendor panel | `/vendor` | onboarding/KYC, products, inventory, orders, quotations, wallet, reports, staff, CRM |
| Admin panel | `/admin` | users, vendor KYC, product review, orders, withdrawals, invoices, ledger, CMS, tickets, roles, settings, providers |

No CDN: all assets are local, and the charts are drawn on `<canvas>`. The UI uses soft glassmorphism. On mobile it shows a 2-column grid and a floating cart pill; the panels use a denser layout.

## Quick start
```bash
npm install
npm run seed          # optional: reset + seed (AUTO_SEED=1 seeds an empty DB on boot)
PORT=4100 npm start   # http://localhost:4100
npm test              # e2e API suite (starts its own server on a temp DB)
```
Requires Node 18 or later (developed on Node 24). The database is SQLite through better-sqlite3, at `data/mohanmishra.db` by default.

## Demo accounts (seed)
| Role | Email | Password |
|---|---|---|
| Admin | admin@mohanmishra.in | Admin@123 |
| Staff (ops/finance) | ops@ / finance@mohanmishra.in | Staff@123 |
| Vendor | vendor1..3@mohanmishra.in | Vendor@123 |
| Customer | rahul@example.com, priya@example.com | Customer@123 |

OTP login: outside production, or when `EXPOSE_DEV_OTP=1`, the response includes `dev_code`. Set `FIXED_OTP` to force one code for every login.

## Environment
| Var | Default | Notes |
|---|---|---|
| PORT | 4100 | |
| DB_PATH | data/mohanmishra.db | |
| JWT_SECRET | dev fallback | **set in prod** |
| JWT_EXPIRES | 7d | |
| AUTO_SEED | on (set 0 to disable) | seed if DB empty |
| CORS_ORIGINS | * | comma list |
| RATE_LIMIT_PER_MIN | 300 | auth endpoints are stricter |
| UPLOAD_DIR / MAX_UPLOAD_MB | uploads / 15 | |
| PUBLIC_URL | | used in links/invoices |
| NODE_ENV, EXPOSE_DEV_OTP, FIXED_OTP | | OTP behaviour |
| PAYMENT_PROVIDER | mock | razorpay/cashfree adapters stubbed; mock uses MOCK_PAYMENT_SECRET (HMAC) |
| MOCK_WEBHOOK_SECRET | | `x-mock-signature` on `/api/v1/payments/webhook` |
| OTP_PROVIDER / CALL_PROVIDER | mock | Twilio/SMTP/FCM keys read if set |

## Structure
```
src/server.js      express app, helmet CSP, rate limits, static SPA
src/core.js        auth/JWT, validation, errors, pagination
src/db.js          schema (better-sqlite3)
src/services.js    pricing, GST split (CGST/SGST vs IGST), commissions, ledger, invoices (PREFIX/FY/seq)
src/providers*     mock payment/OTP/call/notification providers
src/routes/*.js    auth, catalog, customer, vendor, admin, crm, payments, common
web/               SPA (index.html, css/app.css, js/{ui,customer,vendor,admin,main}.js)
tests/e2e.js       API end-to-end suite
tests/ui-smoke.js  optional Puppeteer smoke test of all screens (needs puppeteer-core + Chrome: BASE_URL, CHROME)
```

## Docs
- `API.md` is the stable REST contract for the Android app: auth, errors, pagination, idempotency, flows and the endpoint index.
- `FEATURES.md` gives honest feature coverage (✅ done, 🟡 partial, ❌ not done).

## Deploy (Render)
See `/workspace/mohanmishra-v2-deploy` (`render.yaml`). It runs on the free plan, generates `JWT_SECRET` automatically and uses mock providers.
The free plan's disk is ephemeral, so the SQLite data and uploads reset on every redeploy or restart. For anything beyond a demo, attach a disk (paid plan) or move to Postgres.

## Limitations
- Payments, payouts, OTP, calls and notifications are mocks. No real gateway has been integrated yet.
- GST is calculated (CGST/SGST/IGST from the state codes), but there is no e-invoice/IRN, no e-way bill and no TDS/TCS filing.
- "Near me" uses a lat/lng radius with an approximate distance sort.
- Images are stored as uploaded. There is no resizing (no sharp).
- Running on a single node with SQLite means no horizontal scaling.

## Design system (Material Design 3)

- **Colours:** primary Deep Navy `#123B65` · secondary Industrial Orange `#F59E0B` (promotions + all purchase buttons: Add to cart, Buy now, Checkout, Place order, Pay — charcoal text) · background `#F8FAFC` · text Charcoal `#1F2937` · success `#16A34A` (payments, confirmations). Tokens live as `--md-*` CSS variables in `web/css/app.css`, with a full dark palette under `html[data-theme=dark]`.
- **Shape & spacing:** cards 16px, buttons 10–12px, inputs 12px, chips 8px, bottom sheets 28px; 8px spacing grid (`--sp-*`). Flat surfaces with M3 elevation — no glass/gradients.
- **Icons:** local Lucide SVGs (`web/js/icons.js`, `ic(name)`), no icon fonts / CDN.
- **Theme:** light by default; moon/sun toggle in every header, saved in `localStorage.mm_theme`.
- **Navigation:** below 768px customers get a bottom nav (Home · Categories · Cart · Orders · Account); vendor/admin get a bottom nav (Home · Orders · Products · Wallet/CRM · More → drawer). ≥768px keeps the sidebar + top bar. Cart/checkout show a sticky total + action bar above the bottom nav.
- **Responsive:** tested at 360/390/412/768/1024/1440 (`node tests/browser-responsive.js`): no horizontal overflow, 16px inputs, ≥44–48px touch targets, safe-area insets, `100dvh`, tables in scroll wrappers, modals as bottom sheets on phones.
- **PWA:** theme `#123B65`, background `#F8FAFC`, service-worker cache `mm-v6`, assets `?v=6`.
