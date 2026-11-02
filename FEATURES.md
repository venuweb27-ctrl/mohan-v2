# Mohan Mishra v2 — feature coverage

Legend: ✅ done (works end-to-end, real logic) · 🟡 partial / works against a **mock** provider · ❌ not done.
"Covered by e2e" = asserted in `tests/e2e.js` (150 checks). Every screen listed below also loads without JS/API errors in `tests/ui-smoke.js`.

## Platform / backend
- ✅ Express REST API under `/api/v1`, JSON error envelope `{error:{code,message,details}}`
- ✅ SQLite (better-sqlite3, WAL) schema + auto-seed on empty DB (categories, brands, 20 products with SVG art, 5 vendors, customers, staff, CMS, FAQs, coupons, banners)
- ✅ JWT auth with server-side sessions (logout / revoke session), roles: customer, vendor (+vendor staff), staff, admin
- ✅ Admin staff roles with per-module permission levels (none/read/write) — e2e
- ✅ helmet (CSP), CORS allow-list, rate limiting (global + strict on OTP/login/forgot)
- ✅ Audit log, login history
- ✅ Idempotency-Key on checkout/payments — e2e
- ✅ File uploads (multer, type/size limits) served from `/uploads`
- 🟡 Image compression/thumbnails — files stored as uploaded (no sharp)
- ✅ Double-entry ledger with trial balance check — e2e
- 🟡 Notifications: in-app ✅; SMS / email / WhatsApp / push go to a mock outbox (adapters for Twilio/2Factor/SMTP/FCM stubbed by env)

## Auth & account (customer)
- 🟡 Mobile OTP login/registration (mock SMS; `dev_code` returned outside production) — e2e
- ✅ Email+password login, forgot/reset password via OTP
- ✅ **Continue with Google** (Google Identity Services) on customer login/signup — server verifies the ID token (tokeninfo: aud = `GOOGLE_CLIENT_ID`, iss, exp, email_verified), finds or creates a **customer** by email and returns the normal JWT; never signs in admin/staff/vendor accounts. Ships disabled: button hidden until `GOOGLE_CLIENT_ID` is set — e2e (mock verifier) + unit
- 🟡 Google sign-in (mock token `mock:email:name`; real Google ID-token verify not wired)
- ✅ Profile (individual/business, GSTIN, PAN), addresses CRUD, sessions, deactivate, delete request
- ✅ Email verification (OTP via mock outbox)

## Catalog & discovery
- ✅ Categories/sub-categories, brands, attributes
- ✅ Product detail: gallery, specs, GST, MOQ, transport/installation charges, vendor card, reviews
- ✅ Search with suggestions, popular & history, filters (category, brand, price, condition, city), sorting
- 🟡 "Near me" — lat/lng radius filter + approximate (planar) distance sort, not true geodesic/road distance
- ✅ Wishlist, compare, recently viewed, share link, report listing
- ✅ Vendor storefront page
- ✅ Home: banners, announcements, featured, categories

## Cart, checkout, payments
- ✅ Multi-vendor cart with quantity steppers, MOQ/stock checks, coupons (percent/flat/free shipping, limits)
- ✅ GST split: CGST+SGST intra-state, IGST inter-state, per vendor sub-order — e2e
- ✅ Checkout with address & payment plan (full / advance)
- 🟡 Payment gateway — mock gateway (in-app modal) with HMAC signature verify, failure, retry — e2e; Razorpay/Cashfree adapters present but untested (no keys)
- 🟡 Webhooks: signature check, replay protection, event log — e2e with mock provider
- ✅ Offline/manual payment recording by admin (NEFT/RTGS/UPI/cheque)
- ❌ EMI / BNPL / real UPI intent

## Orders & post-purchase
- ✅ Order split into vendor sub-orders, status timeline (accepted → packed → shipped → out for delivery → delivered) — e2e
- ✅ Dispatch details (transporter, LR/tracking no., vehicle, mode, ETA, documents)
- ✅ Customer cancel with auto refund — e2e
- ✅ Returns / replacement / refund / dispute requests, vendor response, admin resolution, refunds — e2e
- 🟡 Refund execution — recorded via mock gateway refund
- ✅ Confirm delivery, reorder, reviews & ratings — e2e
- ✅ Buyer–vendor chat (conversations), support tickets — e2e
- 🟡 Live shipment tracking — manual status/tracking no. only, no courier API

## B2B: enquiries & quotations
- ✅ Enquiry (RFQ) → vendor quotation → customer negotiation/counter → revised version → proforma invoice → accept → convert to order → advance + balance payments — e2e
- ✅ Quote validity, payment terms, transport/installation lines, version history

## Invoices & GST
- ✅ GST tax invoices per sub-order with FY numbering (e.g. `MMT/26-27/00001`), PDF (pdfkit) — e2e
- ✅ Proforma invoices, credit notes (returns), debit notes, manual invoices, cancellation — e2e
- ✅ Commission invoice to vendor (settlement invoice) — e2e
- ✅ GST report CSV — e2e
- 🟡 Invoice email / WhatsApp share — mock outbox
- ❌ E-invoice IRN / e-way bill (NIC API)
- 🟡 TCS (1% under GST §52) computed on sub-orders; ❌ TDS (§194-O) not implemented

## Vendor panel (`/vendor`)
- ✅ Registration with OTP, onboarding checklist, business/GSTIN/PAN/bank, document upload, agreements, submit KYC — e2e
- 🟡 GSTIN verification — mock provider (format + state code); real GST API adapter stubbed
- ✅ Dashboard KPIs + canvas charts (daily, monthly), top products, recent orders
- ✅ Products CRUD with images, specs JSON, purchase settings; re-approval on material edits; duplicate; enable/disable
- ✅ Inventory & low-stock alerts, quick stock update
- ✅ CSV export & import
- ✅ Order management with status actions & dispatch docs — e2e
- ✅ Returns/refund requests response
- ✅ Enquiries & quotations (create, revise, proforma)
- ✅ Wallet (available / on-hold / pending settlement), ledger, commission statement, withdrawals — e2e
- ✅ Reports with CSV (sales, products, GST, commission, payouts)
- ✅ Vendor staff accounts
- ✅ Vendor CRM leads with click-to-call (mock)
- ✅ Store profile (logo, hours, about, location)

## Admin panel (`/admin`)
- ✅ Dashboard: GMV, collections, commission, GST payable, escrow, payouts + line/bar/donut charts
- ✅ Customers (block/unblock, CSV), vendors & KYC approve/correction/reject, suspend, commission override — e2e
- ✅ Product approval queue (approve / correction / reject / feature) — e2e
- ✅ Categories, brands, attributes, commission rules, coupons, banners, CMS pages, FAQs, announcements (generic CRUD)
- ✅ Reviews moderation
- ✅ Orders with sub-order status override, offline payment, refund
- ✅ Enquiries, quotations, commissions, payments, webhooks views
- ✅ Withdrawals: approve / reject / pay (mock payout) / mark paid with UTR — e2e
- 🟡 Payouts — mock payout provider; RazorpayX/Cashfree adapters stubbed
- ✅ Invoices: manual, credit/debit note, cancel, PDF
- ✅ Returns/disputes resolution, refunds
- ✅ Broadcast notifications (in-app + mock outbox)
- ✅ CRM leads, pipeline, follow-ups, click-to-call (mock bridge) — e2e
- ✅ Tickets, abuse reports, feedback
- ✅ Reports with CSV (sales, vendors, products, GST, commission, payments, payouts, refunds, customers, CRM) — e2e
- ✅ Staff & roles with permission matrix — e2e
- ✅ Super-admin password management: **Reset / Set password** on Staff, Vendors and Customers lists — set a password (min 8, letter + digit) or generate a strong 12–14 char one (shown once, copy button); revokes the user's sessions; audit-logged without the password (`POST /api/v1/admin/users/:id/password`) — e2e + browser
- ✅ **Change my password** (Password button in the admin and vendor side menu) for admin, staff and vendor accounts (`POST /api/v1/auth/me/change-password`; signs out other devices) — e2e + browser
- ✅ Audit logs, login history, notification outbox
- ✅ Settings (JSON editor), providers status

## Frontend
- ✅ Single SPA (vanilla JS, no CDN/frameworks) served at `/`, `/vendor`, `/admin`
- ✅ Soft glassmorphism: pastel gradient background, frosted cards, pill search & title bars, green "+" buttons, star ratings, steppers
- ✅ Mobile: 2-column grid, floating glass cart pill, bottom nav; dense side-nav panels for vendor/admin
- ✅ Canvas charts (line/bar/donut) — no chart library
- ❌ PWA/offline, i18n (Hindi), dark mode
- ❌ Native Android app (API.md is the stable contract for it)

## Ops
- ✅ `render.yaml` (free plan, generated JWT secret, mock providers) in `/workspace/mohanmishra-v2-deploy`
- 🟡 Free-plan disk is ephemeral → SQLite + uploads reset on redeploy (use a paid disk or Postgres for production)
- ❌ Postgres migration, background job queue, automated backups

## Nov 2026 refinement — scope checklist
1. **Customers buy machinery.** Includes:
   - mobile-first storefront: hero, trust badges, featured/top sellers, bottom tabs, cart pill
   - cart → checkout (address, state-aware GST, coupon) → payment → confirmation and timeline
   - login returns to the page the customer came from
2. **Vendors sell only after approval.**
   - KYC onboarding approval at Admin → Vendors & KYC.
   - Vendor product listings stay *pending* until approved at Admin → Products & approvals.
3. **Admin oversight.**
   - Inventory across all sellers (Admin → Inventory: stock, reserved, sold, low/out filters, adjust with audit) and all orders.
   - Admin can create orders for a customer and add products, which are auto-approved.
4. **CRM** (Admin → CRM).
   - Lead CRUD, a pipeline board (New → Won/Lost), assignment and follow-ups (call, note, follow-up with due date, mark done).
   - Convert a lead to a customer, a quotation request (RFQ to sellers) or an order.
5. **Staff roles.** Per-module permissions, create/edit/disable staff, login history (Admin → Staff, Login history).
6. **Vendor withdrawals.** Request → approve/reject → mark paid with a UTR (Admin → Withdrawals).
7. **Indian GST invoicing.**
   - CGST+SGST (intra-state) vs IGST (inter-state), HSN/SAC per line, FY-wise numbering.
   - Credit and debit notes; TCS (s.52) and TDS (s.194-O) on seller settlement.
   - Amount in words; PDF download.
- **PWA + Android.**
  - Manifest, service worker (network-first API, offline fallback), install prompt.
  - `android-wrapper/` WebView app `in.mohanmishra.app` (see PUBLISHING.md).
  - The old `android/` app is deprecated.
- **Brand.** Mohan Mishra photo logo, icons and splash; maroon/crimson + amber palette.

## Design system (Material Design 3)

- **Colours:** primary Deep Navy `#123B65` · secondary Industrial Orange `#F59E0B` (promotions + all purchase buttons: Add to cart, Buy now, Checkout, Place order, Pay — charcoal text) · background `#F8FAFC` · text Charcoal `#1F2937` · success `#16A34A` (payments, confirmations). Tokens live as `--md-*` CSS variables in `web/css/app.css`, with a full dark palette under `html[data-theme=dark]`.
- **Shape & spacing:** cards 16px, buttons 10–12px, inputs 12px, chips 8px, bottom sheets 28px; 8px spacing grid (`--sp-*`). Flat surfaces with M3 elevation — no glass/gradients.
- **Icons:** local Lucide SVGs (`web/js/icons.js`, `ic(name)`), no icon fonts / CDN.
- **Theme:** light by default; moon/sun toggle in every header, saved in `localStorage.mm_theme`.
- **Navigation:** below 768px customers get a bottom nav (Home · Categories · Cart · Orders · Account); vendor/admin get a bottom nav (Home · Orders · Products · Wallet/CRM · More → drawer). ≥768px keeps the sidebar + top bar. Cart/checkout show a sticky total + action bar above the bottom nav.
- **Responsive:** tested at 360/390/412/768/1024/1440 (`node tests/browser-responsive.js`): no horizontal overflow, 16px inputs, ≥44–48px touch targets, safe-area insets, `100dvh`, tables in scroll wrappers, modals as bottom sheets on phones.
- **PWA:** theme `#123B65`, background `#F8FAFC`, service-worker cache `mm-v6`, assets `?v=6`.

## In-app chat & WhatsApp
- Customer ↔ seller chat from the product page ("Chat with seller") and the order page; customer ↔ support threads from Account → Messages.
- Admin/support staff can see every thread, join it, close/reopen it, and remove messages (audited).
- M3 chat UI with bubbles, day separators, seen ticks, and image attachments (max 5 MB). Unread badges in the customer header and Account tab, and in the vendor/admin header; a "Messages" entry in the panel nav. Updates arrive by 5 s polling.
- Rate limit, max length, and role checks. FCM push hook is present but disabled (`CHAT_PUSH=1` turns it on).
- "Chat on WhatsApp" (+91 95222 24488) on product pages (prefilled with the product name and link) and on Messages.
