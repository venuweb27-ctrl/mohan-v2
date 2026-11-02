# Mohan Mishra API — v1 (stable contract for web + Android)

Base URL: `https://<host>/api/v1` (local: `http://localhost:4100/api/v1`). All bodies are JSON (`content-type: application/json`) except `POST /uploads` (multipart, field `files`).
Money is **INR, rupees as decimal numbers** (not paise). Timestamps are UTC `YYYY-MM-DD HH:MM:SS`.

## Stability rules
- `/api/v1` is frozen for the Android app: fields may be **added**, never renamed/removed. Breaking changes go to `/api/v2`.
- Clients must ignore unknown fields.

## Auth
- Send `Authorization: Bearer <token>`. Tokens are JWTs backed by a server session (logout revokes immediately). Default expiry `JWT_EXPIRES` (7d).
- Roles: `customer`, `vendor` (owner or vendor staff), `staff` (admin staff with permission matrix), `admin`.
- Login responses: `{ token, user, is_new? }`.

| Flow | Request |
|---|---|
| OTP send | `POST /auth/otp/send {target: "+9198…" or email, purpose: "login"\|"register"\|"reset"}` → `{sent:true, dev_code?}` (`dev_code` only when not production) |
| OTP login/register | `POST /auth/otp/verify {target, code, name?, account_type?, business_name?}` → `{token,user,is_new}` |
| Password | `POST /auth/login {identifier, password}` |
| Google | `POST /auth/google {id_token}` — mock mode accepts `mock:<email>:<name>` |
| Reset | `POST /auth/forgot-password {identifier}` then `POST /auth/reset-password {identifier, code, new_password}` |
| Me | `GET /auth/me` → `{user, addresses}` |

## Errors
`{ "error": { "code": "VALIDATION_ERROR|UNAUTHORIZED|FORBIDDEN|NOT_FOUND|CONFLICT|RATE_LIMITED|ERROR|...", "message": "...", "details": {...} } }` with matching HTTP status. 402 = payment failed.

## Pagination
List endpoints accept `?page=1&limit=20` and return `{ items, total, page, limit, pages }`.

## Idempotency
`POST /checkout`, `POST /payments/init` accept `Idempotency-Key` header; repeats return the original result.

## Core purchase flow
1. `GET /products` — filters: `q, category_id, subcategory_id, brand_id, manufacturer, min_price, max_price, condition, availability, in_stock, city, state, fuel_type, year_min, vendor_id, vendor_rating, featured, lat, lng, radius_km`; `sort = relevance|price_asc|price_desc|popular|newest|rating|distance`
2. `POST /cart/items {product_id, qty}` · `PATCH /cart/items/:pid {qty}` · `POST /cart/apply-coupon {code}`
3. `POST /auth/me/addresses {name, mobile, line1, line2?, city, state, pincode (6 digits), gstin?, label?, kind?: billing|shipping|both, lat?, lng?, is_default?}`
4. `POST /checkout {billing_address_id, shipping_address_id, payment_plan: "full"|"advance"|"partial", coupon_code?, gstin?, notes?}` → order with `sub_orders[]` (one per vendor; CGST+SGST or IGST)
5. `POST /payments/init {order_id | rental_id, purpose: "full"|"advance"|"balance", provider:"mock"}` → `{payment, checkout}` (checkout = data for the gateway SDK)
6. Gateway success → `POST /payments/verify {gateway_order_id, gateway_payment_id, signature}`. Mock gateway: `POST /payments/mock/complete {gateway_order_id, outcome:"success"|"failure"}`; mock signature = HMAC-SHA256(`order_id|payment_id`, `MOCK_PAYMENT_SECRET`).
7. Webhooks: `POST /webhooks/:provider` (mock header `x-mock-signature` = HMAC-SHA256(raw body, `MOCK_WEBHOOK_SECRET`)); replayed event ids are ignored.
8. Retry a failed payment: `POST /payments/:id/retry`.

## Quotation (B2B) flow
`POST /enquiries {product_id?, vendor_id?, title, requirements, qty, budget?, location?}` → vendor `POST /vendor/quotations {enquiry_id, items[], transport, installation, discount, valid_until, payment_terms}` → customer `POST /quotations/:id/revision {note, counter_price?}` → vendor `POST /vendor/quotations/:id/revise` → `POST /vendor/quotations/:id/proforma` → customer `POST /quotations/:id/accept` → `POST /quotations/:id/convert {address_id, payment_plan}` → pay advance/balance via `/payments/init`.


## Uploads
`POST /uploads` multipart `files[]` (max 10, `MAX_UPLOAD_MB`) → `{items:[{url,mime,size,name}]}`. Use returned `url` in product images, KYC docs, chat attachments.

## Invoices
`GET /invoices`, `GET /invoices/:id`, `GET /invoices/:id/pdf` (application/pdf, auth header required). Numbers: `<PREFIX>/<FY>/<seq>` e.g. `MMT/26-27/00001`.

## Endpoint index
Generated from the route files. `*` = vendor/admin/staff auth; admin endpoints also check staff module permissions.

### auth

| Method | Path |
|---|---|
| POST | `/auth/otp/send` |
| POST | `/auth/otp/verify` |
| POST | `/auth/register` |
| POST | `/auth/login` |
| POST | `/auth/google` |
| POST | `/auth/forgot-password` |
| POST | `/auth/reset-password` |
| POST | `/auth/logout` |
| GET | `/auth/me` |
| PATCH | `/auth/me` |
| POST | `/auth/me/verify-email/send` |
| POST | `/auth/me/verify-email` |
| POST | `/auth/me/change-password` |
| POST | `/auth/me/deactivate` |
| POST | `/auth/me/activate` |
| POST | `/auth/me/delete-request` |
| GET | `/auth/me/sessions` |
| DELETE | `/auth/me/sessions/:id` |
| GET | `/auth/me/login-history` |
| POST | `/auth/me/device-token` |
| GET | `/auth/me/addresses` |
| POST | `/auth/me/addresses` |
| PUT | `/auth/me/addresses/:id` |
| DELETE | `/auth/me/addresses/:id` |

### vendor

| Method | Path |
|---|---|
| POST | `/vendor/register` |
| GET | `/vendor/me` |
| PATCH | `/vendor/profile` |
| PATCH | `/vendor/bank` |
| POST | `/vendor/agreements` |
| POST | `/vendor/docs` |
| POST | `/vendor/verify-gstin` |
| POST | `/vendor/submit-kyc` |
| GET | `/vendor/dashboard` |
| GET | `/vendor/products` |
| POST | `/vendor/products` |
| GET | `/vendor/products/export.csv` |
| GET | `/vendor/products/:id` |
| PATCH | `/vendor/products/:id` |
| DELETE | `/vendor/products/:id` |
| POST | `/vendor/products/:id/duplicate` |
| POST | `/vendor/products/:id/toggle` |
| POST | `/vendor/products/:id/stock` |
| POST | `/vendor/products/import` |
| GET | `/vendor/inventory` |
| GET | `/vendor/orders` |
| GET | `/vendor/orders/:id` |
| POST | `/vendor/orders/:id/status` |
| GET | `/vendor/requests` |
| POST | `/vendor/requests/:rid/respond` |
| GET | `/vendor/enquiries` |
| GET | `/vendor/enquiries/:id` |
| POST | `/vendor/quotations` |
| POST | `/vendor/quotations/:id/revise` |
| GET | `/vendor/quotations` |
| POST | `/vendor/quotations/:id/proforma` |
| GET | `/vendor/wallet` |
| GET | `/vendor/wallet/ledger` |
| GET | `/vendor/commissions` |
| POST | `/vendor/withdrawals` |
| GET | `/vendor/withdrawals` |
| GET | `/vendor/reports/:kind` |
| GET | `/vendor/staff` |
| POST | `/vendor/staff` |
| DELETE | `/vendor/staff/:id` |
| * | `/vendor/crm/...` (same as admin CRM, vendor-scoped) |

### admin

| Method | Path |
|---|---|
| GET | `/admin/dashboard` |
| GET | `/admin/customers` |
| GET | `/admin/customers/:id` |
| PATCH | `/admin/customers/:id` |
| GET | `/admin/customers.csv` |
| GET | `/admin/vendors` |
| GET | `/admin/vendors/:id` |
| POST | `/admin/vendors/:id/kyc` |
| PATCH | `/admin/vendors/:id` |
| GET | `/admin/products` |
| GET | `/admin/products/:id` |
| POST | `/admin/products/:id/review` |
| PATCH | `/admin/products/:id` |
| GET | `/admin/reviews` |
| PATCH | `/admin/reviews/:id` |
| GET | `/admin/orders` |
| GET | `/admin/orders/:id` |
| POST | `/admin/sub-orders/:id/status` |
| PATCH | `/admin/orders/:id` |
| GET | `/admin/enquiries` |
| GET | `/admin/quotations` |
| GET | `/admin/commissions` |
| GET | `/admin/payments` |
| POST | `/admin/payments/manual` |
| GET | `/admin/ledger` |
| GET | `/admin/webhooks` |
| GET | `/admin/withdrawals` |
| POST | `/admin/withdrawals/:id/action` |
| GET | `/admin/invoices` |
| POST | `/admin/invoices` |
| POST | `/admin/invoices/:id/cancel` |
| GET | `/admin/requests` |
| POST | `/admin/requests/:id/resolve` |
| GET | `/admin/refunds` |
| POST | `/admin/refunds` |
| POST | `/admin/broadcast` |
| GET | `/admin/tickets` |
| PATCH | `/admin/tickets/:id` |
| GET | `/admin/abuse-reports` |
| PATCH | `/admin/abuse-reports/:id` |
| GET | `/admin/feedback` |
| GET | `/admin/reports/:kind` |
| GET | `/admin/roles` |
| POST | `/admin/roles` |
| PATCH | `/admin/roles/:id` |
| GET | `/admin/staff` |
| POST | `/admin/staff` |
| PATCH | `/admin/staff/:id` |
| GET | `/admin/audit-logs` |
| GET | `/admin/login-history` |
| GET | `/admin/outbox` |
| GET | `/admin/settings` |
| PATCH | `/admin/settings` |
| GET | `/admin/providers` |
| * | `/admin/crm/leads` |
| * | `/admin/crm/pipeline` |
| * | `/admin/crm/leads/:id` |
| * | `/admin/crm/leads/:id/activities` |
| * | `/admin/crm/leads/:id/call` |
| * | `/admin/crm/calls` |
| * | `/admin/crm/followups` |
| GET/POST/PATCH/DELETE | `/admin/categories[/:id]` |
| GET/POST/PATCH/DELETE | `/admin/brands[/:id]` |
| GET/POST/PATCH/DELETE | `/admin/attributes[/:id]` |
| GET/POST/PATCH/DELETE | `/admin/commission-rules[/:id]` |
| GET/POST/PATCH/DELETE | `/admin/coupons[/:id]` |
| GET/POST/PATCH/DELETE | `/admin/banners[/:id]` |
| GET/POST/PATCH/DELETE | `/admin/cms[/:id]` |
| GET/POST/PATCH/DELETE | `/admin/faqs[/:id]` |
| GET/POST/PATCH/DELETE | `/admin/announcements[/:id]` |

### catalog

| Method | Path |
|---|---|
| GET | `/products` |
| GET | `/search/suggest` |
| GET | `/search/popular` |
| GET | `/search/history` |
| DELETE | `/search/history` |
| GET | `/products/:id` |
| GET | `/products/:id/reviews` |
| GET | `/products/:id/availability` |
| GET | `/categories` |
| GET | `/categories/:id` |
| GET | `/brands` |
| GET | `/vendors` |
| GET | `/vendors/:id` |
| GET | `/home` |
| GET | `/banners` |
| GET | `/cms/:slug` |
| GET | `/cms` |
| GET | `/faqs` |
| GET | `/announcements` |
| GET | `/config` |

### payments

| Method | Path |
|---|---|
| POST | `/payments/init` |
| POST | `/payments/verify` |
| POST | `/payments/mock/complete` |
| POST | `/payments/:id/retry` |
| GET | `/payments` |
| POST | `/webhooks/:provider` |
| GET | `/invoices` |
| GET | `/invoices/:id` |
| GET | `/invoices/:id/pdf` |
| POST | `/invoices/:id/email` |
| POST | `/invoices/:id/whatsapp` |

### common

| Method | Path |
|---|---|
| POST | `/uploads` |
| GET | `/notifications` |
| POST | `/notifications/read` |
| PATCH | `/notifications/preferences` |
| POST | `/tickets` |
| GET | `/tickets` |
| GET | `/tickets/:id` |
| POST | `/tickets/:id/messages` |
| POST | `/tickets/:id/close` |
| POST | `/conversations` |
| GET | `/conversations` |
| GET | `/conversations/:id` |
| POST | `/conversations/:id/messages` |
| POST | `/reviews` |
| GET | `/my/reviews` |
| POST | `/reports` |
| POST | `/feedback` |
| POST | `/contact` |

### customer

| Method | Path |
|---|---|
| GET | `/wishlist` |
| POST | `/wishlist` |
| DELETE | `/wishlist/:pid` |
| GET | `/compare` |
| POST | `/compare` |
| DELETE | `/compare/:pid` |
| GET | `/recently-viewed` |
| GET | `/cart` |
| POST | `/cart/items` |
| PATCH | `/cart/items/:pid` |
| DELETE | `/cart/items/:pid` |
| DELETE | `/cart` |
| POST | `/cart/apply-coupon` |
| GET | `/coupons` |
| POST | `/checkout` |
| GET | `/orders` |
| GET | `/orders/:id` |
| POST | `/orders/:id/cancel` |
| POST | `/orders/:id/requests` |
| POST | `/orders/:id/confirm-delivery` |
| POST | `/orders/:id/reorder` |
| POST | `/enquiries` |
| GET | `/enquiries` |
| GET | `/enquiries/:id` |
| POST | `/enquiries/:id/cancel` |
| GET | `/quotations` |
| GET | `/quotations/:id` |
| POST | `/quotations/:id/accept` |
| POST | `/quotations/:id/reject` |
| POST | `/quotations/:id/revision` |
| POST | `/quotations/:id/convert` |

## Additions — Nov 2026 refinement (additive only; no existing endpoint changed shape)
All paths are under `/api/v1`. Admin routes need an admin or staff token with the matching module permission.

| Method | Path | Purpose |
|---|---|---|
| GET | `/admin/product-vendors` | Seller list for the Add product form (admin can list on behalf of any approved vendor) |
| POST | `/admin/products` | Admin creates a machine listing; **auto-approved** |
| PUT | `/admin/products/:id` | Full edit (specs, images, pricing, GST/HSN) |
| DELETE | `/admin/products/:id` | Archive a listing |
| POST | `/admin/products/import` | CSV bulk import |
| GET | `/admin/products/:id/full` | Product plus images, specs and attributes for editing |
| GET | `/admin/inventory?q&vendor_id&category_id&status&stock=low\|out&page` | Cross-seller inventory: `{summary:{skus,units,reserved,sold,stock_value,low,out}, items, page…}` |
| PATCH | `/admin/inventory/:id {stock?, low_stock_threshold?, note?}` | Stock adjustment (audited; stock ≥ 0) |
| GET | `/admin/order-products?q` | Purchasable machines for Create order |
| POST | `/admin/orders {customer_id, items:[{product_id,qty}], address_id? \| address{…}, payment_plan, coupon_code?, note?}` | Create an order on behalf of a customer (201; same pricing/GST engine as checkout) |
| GET | `/admin/invoices/search` | Invoice register search (number, party, GSTIN, type, FY) |
| GET | `/admin/invoice-sources` | Orders/sub-orders eligible for invoicing |
| POST | `/admin/invoices/generate {source, id, type: invoice\|credit_note\|debit_note, reason?, lines?}` | Generate a GST tax invoice or note |
| GET/PUT | `/admin/invoice-settings` | Legal name, GSTIN, state, prefix, FY numbering, terms, signature |
| GET | `/admin/invoice-preview` | Sample invoice preview for settings |
| POST | `/admin/crm/leads/:id/convert {to: customer\|quotation\|order, product_id?, category_id?, qty?, title?, requirements?, location?}` | Converts a lead into a customer account (find or create), a quotation request (RFQ to sellers) or an order handoff (`next` = prefilled Create order URL). Returns 201 `{lead_id,to,customer_id,customer_created,enquiry_id?,enquiry_no?,vendors?,next?}` |
| GET | `/vendor/invoices`, `/vendor/invoice-sources`; POST `/vendor/invoices/generate` | Seller-side GST invoicing for own sub-orders |
| GET | `/.well-known/assetlinks.json` | Android App Links (env `ANDROID_PACKAGE`, `ANDROID_SHA256`) |
| GET | `/sw.js` | PWA service worker (`Service-Worker-Allowed: /`) |

**Settlement:** sub-orders now carry `tds` in addition to `tcs`.
- TCS: GST s.52, setting `tcs_pct`, default 0.5%.
- TDS: Income-tax s.194-O, setting `tds_pct`, default 0.1%.
- Both are withheld from `vendor_net` and posted to the `platform:tcs_payable` and `platform:tds_payable` ledgers.


> Rental endpoints (`/rentals*`, `/vendor/rentals*`, `/admin/rentals*`) are switched off and return 404 (set `ENABLE_RENTALS=1` to restore). Rental tables and data are kept.


## Password management
- `POST /admin/users/:id/password` (super admin only) — body `{password}` (min 8 chars, letter + digit) or `{generate:true}`. Returns `{ok, user, generated, sessions_revoked, password?}`; `password` is only present when generated and is returned once. Admin accounts are refused (403); the target's sessions are revoked; an audit entry (`password_set` / `password_generated`) is written without the password.
- `POST /auth/me/change-password` — `{current_password, new_password}`; admin/staff/vendor accounts need letter + digit; other sessions are signed out.

## Google sign-in
- `POST /auth/google {credential}` (legacy `id_token` also accepted) — Google Identity Services ID token. Verified server-side via Google tokeninfo; `aud` must equal `GOOGLE_CLIENT_ID` (comma-separated list allowed), `iss` accounts.google.com, not expired, `email_verified` true. Finds the user by Google id or email, or creates a customer. Returns `{token, user, is_new}`. Non-customer accounts → 403. Unverified/invalid → 401. When `GOOGLE_CLIENT_ID` is unset (and not in test/`GOOGLE_MOCK=1` mode) → 503 and `/config.google_client_id` is null so the button is hidden.
- Setup: create an OAuth 2.0 Web client in Google Cloud, add `https://store.mohanmishra.app` (and the onrender.com URL) as Authorized JavaScript origins, then set `GOOGLE_CLIENT_ID` on Render.

## In-app chat (`/api/v1/chat`, auth required)
Threads: `kind=vendor` (customer ↔ seller, tied to a product or order) and `kind=support` (customer ↔ Mohan Mishra Support). Admins and staff with the `support` permission can view any thread, join it, close/reopen it, and remove messages. Inaccessible threads return 404. Live updates use short polling (`GET /threads/:id?after=<last id>`, every `chat_poll_ms` from `/config`).

| Method | Path | Notes |
|---|---|---|
| GET | /chat/threads | My threads (moderators: all; filters `kind`, `status`, `q`, `scope=mine`). Each row has `unread`, `last_message`, `title`, `context` |
| GET | /chat/unread | `{ total, threads }` for badges |
| POST | /chat/threads | `{ kind: 'vendor'|'support', product_id?, order_id?, vendor_id?, body?, attachments? }`: find-or-create. The order must be yours; `vendor_id` is needed for multi-seller orders |
| GET | /chat/threads/:id | `?after=` for incremental fetch, `?peek=1` to skip marking read. Returns `messages`, `seen_upto`, `can_post`, `can_moderate` |
| POST | /chat/threads/:id/messages | `{ body, attachments: [uploadUrl…], after? }` returns 201 with the new messages |
| POST | /chat/threads/:id/read | Mark read |
| POST | /chat/threads/:id/join | Moderator joins (system message + audit) |
| POST | /chat/threads/:id/status | Moderator `{ status: 'open'|'closed' }` |
| DELETE | /chat/messages/:id | Moderator soft-delete (audited; text not logged) |

Abuse guard: `CHAT_RATE_PER_MIN` (default 20 messages/min per user; moderators 3×) returns 429 `RATE_LIMITED`. `CHAT_MAX_LEN` (2000). Attachments: up to 4 images you uploaded via `POST /uploads`, each at most `CHAT_MAX_IMG_MB` (5). Push for chat is off unless `CHAT_PUSH=1` (FCM hook); in-app notifications of type `chat` are always created.
`/config` adds `whatsapp_number` (env `WHATSAPP_CHAT_NUMBER`, default 919522224488) and `chat_poll_ms` (env `CHAT_POLL_MS`, 5000).
