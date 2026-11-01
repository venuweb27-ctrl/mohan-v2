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
1. `GET /products` — filters: `q, category_id, subcategory_id, brand_id, manufacturer, min_price, max_price, condition, mode (buy|rent), availability, in_stock, city, state, fuel_type, year_min, vendor_id, vendor_rating, featured, lat, lng, radius_km`; `sort = relevance|price_asc|price_desc|popular|newest|rating|distance`
2. `POST /cart/items {product_id, qty}` · `PATCH /cart/items/:pid {qty}` · `POST /cart/apply-coupon {code}`
3. `POST /auth/me/addresses {name, mobile, line1, line2?, city, state, pincode (6 digits), gstin?, label?, kind?: billing|shipping|both, lat?, lng?, is_default?}`
4. `POST /checkout {billing_address_id, shipping_address_id, payment_plan: "full"|"advance"|"partial", coupon_code?, gstin?, notes?}` → order with `sub_orders[]` (one per vendor; CGST+SGST or IGST)
5. `POST /payments/init {order_id | rental_id, purpose: "full"|"advance"|"balance", provider:"mock"}` → `{payment, checkout}` (checkout = data for the gateway SDK)
6. Gateway success → `POST /payments/verify {gateway_order_id, gateway_payment_id, signature}`. Mock gateway: `POST /payments/mock/complete {gateway_order_id, outcome:"success"|"failure"}`; mock signature = HMAC-SHA256(`order_id|payment_id`, `MOCK_PAYMENT_SECRET`).
7. Webhooks: `POST /webhooks/:provider` (mock header `x-mock-signature` = HMAC-SHA256(raw body, `MOCK_WEBHOOK_SECRET`)); replayed event ids are ignored.
8. Retry a failed payment: `POST /payments/:id/retry`.

## Quotation (B2B) flow
`POST /enquiries {product_id?, vendor_id?, title, requirements, qty, budget?, location?}` → vendor `POST /vendor/quotations {enquiry_id, items[], transport, installation, discount, valid_until, payment_terms}` → customer `POST /quotations/:id/revision {note, counter_price?}` → vendor `POST /vendor/quotations/:id/revise` → `POST /vendor/quotations/:id/proforma` → customer `POST /quotations/:id/accept` → `POST /quotations/:id/convert {address_id, payment_plan}` → pay advance/balance via `/payments/init`.

## Rental flow
`POST /rentals/quote {product_id, unit:"hour"|"day"|"week"|"month", duration, start_at, address_id}` → `POST /rentals` (same body) → vendor `POST /vendor/rentals/:id/action {action:"approve"}` → customer pays (`/payments/init {rental_id, purpose:"advance"|"balance"}`; `GET /rentals/:id` shows `amount_due`) → vendor `start` → customer `POST /rentals/:id/extend {duration}` → vendor `extension_approve` → `return {late_charge, damage_charge}` → `close` (refunds unused deposit).

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
| GET | `/vendor/rentals` |
| GET | `/vendor/rentals/calendar` |
| GET | `/vendor/rentals/:id` |
| POST | `/vendor/rentals/:id/action` |
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
| GET | `/admin/rentals` |
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
| POST | `/rentals/quote` |
| POST | `/rentals` |
| GET | `/rentals` |
| GET | `/rentals/:id` |
| POST | `/rentals/:id/extend` |
| POST | `/rentals/:id/cancel` |
