// SQLite data layer (better-sqlite3). SQL kept portable (no SQLite-only features beyond AUTOINCREMENT/datetime defaults).
const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');
const DB_PATH = process.env.DB_PATH || path.join(__dirname, '..', 'data', 'mohanmishra.db');
fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

const SCHEMA = `
CREATE TABLE IF NOT EXISTS staff_roles (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT UNIQUE NOT NULL, permissions TEXT NOT NULL DEFAULT '{}', is_system INTEGER DEFAULT 0, created_at TEXT DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS users (id INTEGER PRIMARY KEY AUTOINCREMENT, role TEXT NOT NULL, name TEXT, email TEXT UNIQUE, mobile TEXT UNIQUE, password_hash TEXT, google_id TEXT,
  email_verified INTEGER DEFAULT 0, mobile_verified INTEGER DEFAULT 0, account_type TEXT DEFAULT 'individual', business_name TEXT, gstin TEXT, pan TEXT, state_code TEXT,
  status TEXT DEFAULT 'active', staff_role_id INTEGER REFERENCES staff_roles(id), notif_prefs TEXT DEFAULT '{"push":true,"email":true,"sms":true,"promo":true}', avatar TEXT,
  segment TEXT, created_by INTEGER, created_at TEXT DEFAULT CURRENT_TIMESTAMP, updated_at TEXT DEFAULT CURRENT_TIMESTAMP);
CREATE INDEX IF NOT EXISTS ix_users_role ON users(role);
CREATE TABLE IF NOT EXISTS otps (id INTEGER PRIMARY KEY AUTOINCREMENT, target TEXT NOT NULL, purpose TEXT NOT NULL, code_hash TEXT NOT NULL, expires_at TEXT NOT NULL, attempts INTEGER DEFAULT 0, used INTEGER DEFAULT 0, created_at TEXT DEFAULT CURRENT_TIMESTAMP);
CREATE INDEX IF NOT EXISTS ix_otps_target ON otps(target, purpose);
CREATE TABLE IF NOT EXISTS sessions (id TEXT PRIMARY KEY, user_id INTEGER NOT NULL, ip TEXT, ua TEXT, revoked INTEGER DEFAULT 0, created_at TEXT DEFAULT CURRENT_TIMESTAMP, last_seen TEXT DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS login_history (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER, identifier TEXT, method TEXT, success INTEGER, ip TEXT, ua TEXT, created_at TEXT DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS addresses (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL REFERENCES users(id), label TEXT, kind TEXT DEFAULT 'both', name TEXT, mobile TEXT, line1 TEXT, line2 TEXT, city TEXT, state TEXT, state_code TEXT, pincode TEXT, gstin TEXT, lat REAL, lng REAL, is_default INTEGER DEFAULT 0, created_at TEXT DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS vendors (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER UNIQUE NOT NULL REFERENCES users(id), business_name TEXT NOT NULL, business_type TEXT, gstin TEXT, pan TEXT,
  address TEXT, city TEXT, state TEXT, state_code TEXT, pincode TEXT, lat REAL, lng REAL, authorized_person TEXT, authorized_mobile TEXT, contact_email TEXT,
  bank_account_name TEXT, bank_account_no TEXT, bank_ifsc TEXT, bank_name TEXT, bank_verified INTEGER DEFAULT 0, gstin_verified INTEGER DEFAULT 0, pan_verified INTEGER DEFAULT 0,
  agreement_accepted INTEGER DEFAULT 0, commission_agreement_accepted INTEGER DEFAULT 0, kyc_status TEXT DEFAULT 'pending', status TEXT DEFAULT 'pending', remarks TEXT,
  commission_pct REAL, rating REAL DEFAULT 0, rating_count INTEGER DEFAULT 0, logo TEXT, banner TEXT, description TEXT, operating_hours TEXT, featured INTEGER DEFAULT 0,
  min_withdrawal REAL, categories TEXT DEFAULT '[]', created_at TEXT DEFAULT CURRENT_TIMESTAMP, updated_at TEXT DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS vendor_staff (id INTEGER PRIMARY KEY AUTOINCREMENT, vendor_id INTEGER NOT NULL, user_id INTEGER NOT NULL, role TEXT DEFAULT 'sales', created_at TEXT DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS vendor_docs (id INTEGER PRIMARY KEY AUTOINCREMENT, vendor_id INTEGER NOT NULL REFERENCES vendors(id), doc_type TEXT NOT NULL, file_url TEXT NOT NULL, status TEXT DEFAULT 'submitted', remarks TEXT, created_at TEXT DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS categories (id INTEGER PRIMARY KEY AUTOINCREMENT, parent_id INTEGER REFERENCES categories(id), name TEXT NOT NULL, slug TEXT UNIQUE, description TEXT, image TEXT, icon TEXT, sort_order INTEGER DEFAULT 0, active INTEGER DEFAULT 1, featured INTEGER DEFAULT 0, hsn TEXT, gst_rate REAL DEFAULT 18, created_at TEXT DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS brands (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT UNIQUE NOT NULL, manufacturer TEXT, country TEXT, logo TEXT, active INTEGER DEFAULT 1);
CREATE TABLE IF NOT EXISTS attributes (id INTEGER PRIMARY KEY AUTOINCREMENT, category_id INTEGER REFERENCES categories(id), name TEXT NOT NULL, unit TEXT, input_type TEXT DEFAULT 'text', filterable INTEGER DEFAULT 1);
CREATE TABLE IF NOT EXISTS products (id INTEGER PRIMARY KEY AUTOINCREMENT, vendor_id INTEGER NOT NULL REFERENCES vendors(id), category_id INTEGER REFERENCES categories(id), subcategory_id INTEGER REFERENCES categories(id), brand_id INTEGER REFERENCES brands(id),
  name TEXT NOT NULL, slug TEXT, description TEXT, model_no TEXT, mfg_year INTEGER, condition TEXT DEFAULT 'new', specs TEXT DEFAULT '{}',
  engine_capacity TEXT, horsepower TEXT, fuel_type TEXT, power_req TEXT, operating_capacity TEXT, dimensions TEXT, weight TEXT, warranty TEXT, maintenance TEXT,
  price REAL DEFAULT 0, mrp REAL, gst_rate REAL DEFAULT 18, hsn TEXT, stock INTEGER DEFAULT 0, reserved INTEGER DEFAULT 0, sold INTEGER DEFAULT 0, moq INTEGER DEFAULT 1, low_stock_threshold INTEGER DEFAULT 2,
  delivery_charge REAL DEFAULT 0, installation_charge REAL DEFAULT 0, purchase_available INTEGER DEFAULT 1, rental_available INTEGER DEFAULT 0,
  rent_hourly REAL, rent_daily REAL, rent_weekly REAL, rent_monthly REAL, security_deposit REAL DEFAULT 0, rental_units INTEGER DEFAULT 0,
  images TEXT DEFAULT '[]', videos TEXT DEFAULT '[]', location_city TEXT, location_state TEXT, lat REAL, lng REAL,
  status TEXT DEFAULT 'pending', reject_reason TEXT, featured INTEGER DEFAULT 0, promoted INTEGER DEFAULT 0, active INTEGER DEFAULT 1, views INTEGER DEFAULT 0,
  rating REAL DEFAULT 0, rating_count INTEGER DEFAULT 0, commission_pct REAL, return_policy TEXT, cancellation_policy TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP, updated_at TEXT DEFAULT CURRENT_TIMESTAMP);
CREATE INDEX IF NOT EXISTS ix_products_cat ON products(category_id, status);
CREATE INDEX IF NOT EXISTS ix_products_vendor ON products(vendor_id);
CREATE INDEX IF NOT EXISTS ix_products_price ON products(price);
CREATE TABLE IF NOT EXISTS product_approvals (id INTEGER PRIMARY KEY AUTOINCREMENT, product_id INTEGER NOT NULL, action TEXT NOT NULL, remarks TEXT, by_user INTEGER, created_at TEXT DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS inventory_log (id INTEGER PRIMARY KEY AUTOINCREMENT, product_id INTEGER NOT NULL, change INTEGER NOT NULL, field TEXT DEFAULT 'stock', reason TEXT, ref TEXT, by_user INTEGER, created_at TEXT DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS wishlist (user_id INTEGER NOT NULL, product_id INTEGER NOT NULL, created_at TEXT DEFAULT CURRENT_TIMESTAMP, PRIMARY KEY(user_id, product_id));
CREATE TABLE IF NOT EXISTS compare_items (user_id INTEGER NOT NULL, product_id INTEGER NOT NULL, PRIMARY KEY(user_id, product_id));
CREATE TABLE IF NOT EXISTS recent_views (user_id INTEGER NOT NULL, product_id INTEGER NOT NULL, viewed_at TEXT DEFAULT CURRENT_TIMESTAMP, PRIMARY KEY(user_id, product_id));
CREATE TABLE IF NOT EXISTS search_history (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER, q TEXT NOT NULL, created_at TEXT DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS cart_items (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL, product_id INTEGER NOT NULL, qty INTEGER NOT NULL DEFAULT 1, with_installation INTEGER DEFAULT 1, UNIQUE(user_id, product_id));
CREATE TABLE IF NOT EXISTS coupons (id INTEGER PRIMARY KEY AUTOINCREMENT, code TEXT UNIQUE NOT NULL, description TEXT, type TEXT NOT NULL, value REAL NOT NULL, min_order REAL DEFAULT 0, max_discount REAL,
  starts_at TEXT, expires_at TEXT, usage_limit INTEGER, per_user_limit INTEGER DEFAULT 1, used_count INTEGER DEFAULT 0, customer_id INTEGER, vendor_id INTEGER, category_id INTEGER, active INTEGER DEFAULT 1, campaign TEXT, created_at TEXT DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS coupon_usages (id INTEGER PRIMARY KEY AUTOINCREMENT, coupon_id INTEGER, user_id INTEGER, order_id INTEGER, discount REAL, created_at TEXT DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS orders (id INTEGER PRIMARY KEY AUTOINCREMENT, order_no TEXT UNIQUE NOT NULL, customer_id INTEGER NOT NULL REFERENCES users(id), source TEXT DEFAULT 'cart', quotation_id INTEGER,
  billing_address TEXT, shipping_address TEXT, customer_gstin TEXT, place_of_supply TEXT, subtotal REAL, discount REAL DEFAULT 0, coupon_code TEXT,
  cgst REAL DEFAULT 0, sgst REAL DEFAULT 0, igst REAL DEFAULT 0, tax_total REAL DEFAULT 0, transport REAL DEFAULT 0, installation REAL DEFAULT 0, platform_fee REAL DEFAULT 0, platform_fee_gst REAL DEFAULT 0,
  grand_total REAL NOT NULL, paid_amount REAL DEFAULT 0, refunded_amount REAL DEFAULT 0, payment_status TEXT DEFAULT 'pending', payment_plan TEXT DEFAULT 'full', payment_method TEXT,
  status TEXT DEFAULT 'placed', manager_id INTEGER, notes TEXT, created_at TEXT DEFAULT CURRENT_TIMESTAMP, updated_at TEXT DEFAULT CURRENT_TIMESTAMP);
CREATE INDEX IF NOT EXISTS ix_orders_customer ON orders(customer_id);
CREATE TABLE IF NOT EXISTS sub_orders (id INTEGER PRIMARY KEY AUTOINCREMENT, order_id INTEGER NOT NULL REFERENCES orders(id), sub_order_no TEXT UNIQUE NOT NULL, vendor_id INTEGER NOT NULL REFERENCES vendors(id),
  subtotal REAL, discount REAL DEFAULT 0, taxable REAL, cgst REAL DEFAULT 0, sgst REAL DEFAULT 0, igst REAL DEFAULT 0, transport REAL DEFAULT 0, installation REAL DEFAULT 0, total REAL,
  commission REAL DEFAULT 0, commission_gst REAL DEFAULT 0, gateway_fee REAL DEFAULT 0, tcs REAL DEFAULT 0, vendor_net REAL DEFAULT 0, refunded REAL DEFAULT 0,
  status TEXT DEFAULT 'placed', reject_reason TEXT, transporter TEXT, vehicle_no TEXT, lr_no TEXT, tracking_no TEXT, tracking_url TEXT, dispatch_docs TEXT DEFAULT '[]', expected_delivery TEXT,
  pod_url TEXT, delivered_at TEXT, settled INTEGER DEFAULT 0, created_at TEXT DEFAULT CURRENT_TIMESTAMP, updated_at TEXT DEFAULT CURRENT_TIMESTAMP);
CREATE INDEX IF NOT EXISTS ix_sub_vendor ON sub_orders(vendor_id, status);
CREATE TABLE IF NOT EXISTS order_items (id INTEGER PRIMARY KEY AUTOINCREMENT, order_id INTEGER NOT NULL, sub_order_id INTEGER NOT NULL, product_id INTEGER, name TEXT, hsn TEXT, qty INTEGER, unit_price REAL,
  discount REAL DEFAULT 0, gst_rate REAL, taxable REAL, cgst REAL, sgst REAL, igst REAL, transport REAL DEFAULT 0, installation REAL DEFAULT 0, total REAL);
CREATE TABLE IF NOT EXISTS order_events (id INTEGER PRIMARY KEY AUTOINCREMENT, order_id INTEGER, sub_order_id INTEGER, status TEXT, note TEXT, by_user INTEGER, created_at TEXT DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS order_requests (id INTEGER PRIMARY KEY AUTOINCREMENT, order_id INTEGER NOT NULL, sub_order_id INTEGER, user_id INTEGER, type TEXT NOT NULL, reason TEXT, attachments TEXT DEFAULT '[]',
  amount REAL, status TEXT DEFAULT 'open', resolution TEXT, resolved_by INTEGER, created_at TEXT DEFAULT CURRENT_TIMESTAMP, updated_at TEXT DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS payments (id INTEGER PRIMARY KEY AUTOINCREMENT, ref TEXT UNIQUE NOT NULL, user_id INTEGER, order_id INTEGER, rental_id INTEGER, provider TEXT NOT NULL, method TEXT, purpose TEXT DEFAULT 'full',
  amount REAL NOT NULL, currency TEXT DEFAULT 'INR', status TEXT DEFAULT 'created', gateway_order_id TEXT, gateway_payment_id TEXT UNIQUE, signature TEXT, idempotency_key TEXT UNIQUE,
  failure_reason TEXT, gateway_fee REAL DEFAULT 0, settled INTEGER DEFAULT 0, manual INTEGER DEFAULT 0, authorized_by INTEGER, raw TEXT, created_at TEXT DEFAULT CURRENT_TIMESTAMP, updated_at TEXT DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS refunds (id INTEGER PRIMARY KEY AUTOINCREMENT, refund_no TEXT UNIQUE, payment_id INTEGER, order_id INTEGER, sub_order_id INTEGER, rental_id INTEGER, request_id INTEGER, amount REAL NOT NULL,
  status TEXT DEFAULT 'pending', gateway_refund_id TEXT, reason TEXT, processed_by INTEGER, created_at TEXT DEFAULT CURRENT_TIMESTAMP, updated_at TEXT DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS webhook_events (id INTEGER PRIMARY KEY AUTOINCREMENT, provider TEXT, event_id TEXT UNIQUE, event_type TEXT, payload TEXT, verified INTEGER, processed INTEGER DEFAULT 0, created_at TEXT DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS ledger_entries (id INTEGER PRIMARY KEY AUTOINCREMENT, txn_id TEXT NOT NULL, account TEXT NOT NULL, debit REAL DEFAULT 0, credit REAL DEFAULT 0, ref_type TEXT, ref_id INTEGER, narration TEXT, created_at TEXT DEFAULT CURRENT_TIMESTAMP);
CREATE INDEX IF NOT EXISTS ix_ledger_account ON ledger_entries(account);
CREATE TABLE IF NOT EXISTS commission_rules (id INTEGER PRIMARY KEY AUTOINCREMENT, scope TEXT NOT NULL, scope_id INTEGER, txn_type TEXT DEFAULT 'purchase', mode TEXT DEFAULT 'percent', value REAL NOT NULL, active INTEGER DEFAULT 1, created_at TEXT DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS commissions (id INTEGER PRIMARY KEY AUTOINCREMENT, sub_order_id INTEGER, rental_id INTEGER, vendor_id INTEGER, rule_id INTEGER, basis REAL, mode TEXT, rate REAL, amount REAL, gst REAL, reversed REAL DEFAULT 0, note TEXT, created_at TEXT DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS withdrawals (id INTEGER PRIMARY KEY AUTOINCREMENT, withdrawal_no TEXT UNIQUE, vendor_id INTEGER NOT NULL, amount REAL NOT NULL, fee REAL DEFAULT 0, net REAL, bank TEXT, status TEXT DEFAULT 'requested',
  payout_provider TEXT, payout_ref TEXT, utr TEXT, proof_url TEXT, reason TEXT, processed_by INTEGER, created_at TEXT DEFAULT CURRENT_TIMESTAMP, updated_at TEXT DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS invoice_counters (prefix TEXT NOT NULL, fy TEXT NOT NULL, seq INTEGER NOT NULL DEFAULT 0, PRIMARY KEY(prefix, fy));
CREATE TABLE IF NOT EXISTS invoices (id INTEGER PRIMARY KEY AUTOINCREMENT, invoice_no TEXT UNIQUE NOT NULL, type TEXT NOT NULL, fy TEXT, order_id INTEGER, sub_order_id INTEGER, quotation_id INTEGER, rental_id INTEGER, withdrawal_id INTEGER,
  vendor_id INTEGER, customer_id INTEGER, seller TEXT, buyer TEXT, seller_gstin TEXT, buyer_gstin TEXT, place_of_supply TEXT, items TEXT, taxable REAL DEFAULT 0, cgst REAL DEFAULT 0, sgst REAL DEFAULT 0, igst REAL DEFAULT 0,
  discount REAL DEFAULT 0, charges REAL DEFAULT 0, total REAL DEFAULT 0, status TEXT DEFAULT 'issued', ref_invoice_id INTEGER, irn TEXT, ewaybill_no TEXT, notes TEXT, cancel_reason TEXT, created_by INTEGER, created_at TEXT DEFAULT CURRENT_TIMESTAMP);
CREATE INDEX IF NOT EXISTS ix_inv_order ON invoices(order_id);
CREATE TABLE IF NOT EXISTS enquiries (id INTEGER PRIMARY KEY AUTOINCREMENT, enquiry_no TEXT UNIQUE, customer_id INTEGER NOT NULL, product_id INTEGER, category_id INTEGER, type TEXT DEFAULT 'quotation', title TEXT, requirements TEXT,
  qty INTEGER DEFAULT 1, specs TEXT, location TEXT, expected_date TEXT, docs TEXT DEFAULT '[]', status TEXT DEFAULT 'open', created_at TEXT DEFAULT CURRENT_TIMESTAMP, updated_at TEXT DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS enquiry_vendors (enquiry_id INTEGER NOT NULL, vendor_id INTEGER NOT NULL, status TEXT DEFAULT 'pending', response TEXT, PRIMARY KEY(enquiry_id, vendor_id));
CREATE TABLE IF NOT EXISTS quotations (id INTEGER PRIMARY KEY AUTOINCREMENT, quote_no TEXT UNIQUE, enquiry_id INTEGER, vendor_id INTEGER NOT NULL, customer_id INTEGER NOT NULL, version INTEGER DEFAULT 1, parent_id INTEGER,
  items TEXT, subtotal REAL, discount REAL DEFAULT 0, taxable REAL, cgst REAL DEFAULT 0, sgst REAL DEFAULT 0, igst REAL DEFAULT 0, transport REAL DEFAULT 0, installation REAL DEFAULT 0, total REAL,
  payment_terms TEXT, delivery_timeline TEXT, valid_until TEXT, proposal_url TEXT, notes TEXT, status TEXT DEFAULT 'sent', customer_note TEXT, counter_price REAL, order_id INTEGER, created_at TEXT DEFAULT CURRENT_TIMESTAMP, updated_at TEXT DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS rentals (id INTEGER PRIMARY KEY AUTOINCREMENT, rental_no TEXT UNIQUE, customer_id INTEGER NOT NULL, vendor_id INTEGER NOT NULL, product_id INTEGER NOT NULL, unit TEXT NOT NULL, duration INTEGER NOT NULL,
  start_at TEXT NOT NULL, end_at TEXT NOT NULL, rate REAL, rent_amount REAL, transport REAL DEFAULT 0, gst_rate REAL, cgst REAL DEFAULT 0, sgst REAL DEFAULT 0, igst REAL DEFAULT 0, deposit REAL DEFAULT 0, total REAL, advance_pct REAL DEFAULT 30,
  paid_amount REAL DEFAULT 0, site_address TEXT, notes TEXT, quoted_rate REAL, status TEXT DEFAULT 'requested', extension TEXT, returned_at TEXT, late_charge REAL DEFAULT 0, damage_charge REAL DEFAULT 0, deposit_refund REAL,
  commission REAL DEFAULT 0, settled INTEGER DEFAULT 0, created_at TEXT DEFAULT CURRENT_TIMESTAMP, updated_at TEXT DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS crm_leads (id INTEGER PRIMARY KEY AUTOINCREMENT, owner_type TEXT DEFAULT 'admin', vendor_id INTEGER, name TEXT NOT NULL, company TEXT, mobile TEXT, email TEXT, gstin TEXT, city TEXT,
  source TEXT DEFAULT 'manual', status TEXT DEFAULT 'new', value REAL DEFAULT 0, segment TEXT, kind TEXT DEFAULT 'customer', assigned_to INTEGER, next_followup TEXT, customer_id INTEGER, ref_vendor_id INTEGER, enquiry_id INTEGER,
  tags TEXT, converted_at TEXT, created_by INTEGER, created_at TEXT DEFAULT CURRENT_TIMESTAMP, updated_at TEXT DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS crm_activities (id INTEGER PRIMARY KEY AUTOINCREMENT, lead_id INTEGER NOT NULL, type TEXT NOT NULL, content TEXT, due_at TEXT, done INTEGER DEFAULT 0, meta TEXT, by_user INTEGER, created_at TEXT DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS call_logs (id INTEGER PRIMARY KEY AUTOINCREMENT, lead_id INTEGER, by_user INTEGER, to_number TEXT, provider TEXT, status TEXT, sid TEXT, duration INTEGER, outcome TEXT, created_at TEXT DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS tickets (id INTEGER PRIMARY KEY AUTOINCREMENT, ticket_no TEXT UNIQUE, user_id INTEGER NOT NULL, category TEXT DEFAULT 'general', subject TEXT NOT NULL, order_id INTEGER, vendor_id INTEGER, channel TEXT DEFAULT 'app',
  status TEXT DEFAULT 'open', priority TEXT DEFAULT 'normal', assigned_to INTEGER, rating INTEGER, created_at TEXT DEFAULT CURRENT_TIMESTAMP, updated_at TEXT DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS ticket_messages (id INTEGER PRIMARY KEY AUTOINCREMENT, ticket_id INTEGER NOT NULL, user_id INTEGER, body TEXT, attachments TEXT DEFAULT '[]', internal INTEGER DEFAULT 0, created_at TEXT DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS conversations (id INTEGER PRIMARY KEY AUTOINCREMENT, customer_id INTEGER NOT NULL, vendor_id INTEGER NOT NULL, product_id INTEGER, order_id INTEGER, subject TEXT, updated_at TEXT DEFAULT CURRENT_TIMESTAMP, created_at TEXT DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS messages (id INTEGER PRIMARY KEY AUTOINCREMENT, conversation_id INTEGER NOT NULL, sender_id INTEGER NOT NULL, body TEXT NOT NULL, attachments TEXT DEFAULT '[]', read INTEGER DEFAULT 0, created_at TEXT DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS reviews (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL, product_id INTEGER, vendor_id INTEGER, order_id INTEGER, rating INTEGER NOT NULL, title TEXT, comment TEXT, status TEXT DEFAULT 'published', created_at TEXT DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS abuse_reports (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER, target_type TEXT, target_id INTEGER, reason TEXT, status TEXT DEFAULT 'open', created_at TEXT DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS feedback (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER, rating INTEGER, message TEXT, created_at TEXT DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS notifications (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL, type TEXT, title TEXT, body TEXT, data TEXT, read INTEGER DEFAULT 0, created_at TEXT DEFAULT CURRENT_TIMESTAMP);
CREATE INDEX IF NOT EXISTS ix_notif_user ON notifications(user_id, read);
CREATE TABLE IF NOT EXISTS device_tokens (token TEXT PRIMARY KEY, user_id INTEGER NOT NULL, platform TEXT, created_at TEXT DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS outbox (id INTEGER PRIMARY KEY AUTOINCREMENT, channel TEXT, recipient TEXT, subject TEXT, body TEXT, status TEXT, provider TEXT, created_at TEXT DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS banners (id INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT, subtitle TEXT, image TEXT, link TEXT, placement TEXT DEFAULT 'home', sort_order INTEGER DEFAULT 0, active INTEGER DEFAULT 1, campaign TEXT, starts_at TEXT, ends_at TEXT);
CREATE TABLE IF NOT EXISTS cms_pages (slug TEXT PRIMARY KEY, title TEXT, content TEXT, meta_title TEXT, meta_description TEXT, active INTEGER DEFAULT 1, updated_at TEXT DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS faqs (id INTEGER PRIMARY KEY AUTOINCREMENT, question TEXT, answer TEXT, category TEXT DEFAULT 'general', sort_order INTEGER DEFAULT 0, active INTEGER DEFAULT 1);
CREATE TABLE IF NOT EXISTS announcements (id INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT, body TEXT, audience TEXT DEFAULT 'all', active INTEGER DEFAULT 1, created_at TEXT DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT);
CREATE TABLE IF NOT EXISTS audit_logs (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER, role TEXT, action TEXT, entity TEXT, entity_id TEXT, meta TEXT, ip TEXT, created_at TEXT DEFAULT CURRENT_TIMESTAMP);
CREATE INDEX IF NOT EXISTS ix_audit_entity ON audit_logs(entity, entity_id);
CREATE TABLE IF NOT EXISTS uploads (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER, url TEXT, mime TEXT, size INTEGER, original_name TEXT, created_at TEXT DEFAULT CURRENT_TIMESTAMP);
`;
db.exec(SCHEMA);
// additive migrations (safe on existing DBs)
for (const [t, c] of [['products', 'operating_hours INTEGER'], ['products', 'manufacturer TEXT'], ['products', 'rental_terms TEXT'], ['invoices', 'emailed_at TEXT'], ['invoices', 'refund_id INTEGER'], ['sub_orders', 'tds REAL DEFAULT 0']]) { try { db.exec(`ALTER TABLE ${t} ADD COLUMN ${c}`); } catch (e) { } }

// helpers
db.one = (sql, ...p) => db.prepare(sql).get(...p);
db.all = (sql, ...p) => db.prepare(sql).all(...p);
db.run = (sql, ...p) => db.prepare(sql).run(...p);
db.insert = (table, obj) => {
  const keys = Object.keys(obj).filter(k => obj[k] !== undefined);
  const vals = keys.map(k => (obj[k] !== null && typeof obj[k] === 'object') ? JSON.stringify(obj[k]) : (typeof obj[k] === 'boolean' ? (obj[k] ? 1 : 0) : obj[k]));
  return db.prepare(`INSERT INTO ${table} (${keys.join(',')}) VALUES (${keys.map(() => '?').join(',')})`).run(...vals).lastInsertRowid;
};
db.update = (table, id, obj, idCol = 'id') => {
  const keys = Object.keys(obj).filter(k => obj[k] !== undefined);
  if (!keys.length) return;
  const vals = keys.map(k => (obj[k] !== null && typeof obj[k] === 'object') ? JSON.stringify(obj[k]) : (typeof obj[k] === 'boolean' ? (obj[k] ? 1 : 0) : obj[k]));
  db.prepare(`UPDATE ${table} SET ${keys.map(k => k + '=?').join(',')} WHERE ${idCol}=?`).run(...vals, id);
};
db.setting = (k, def) => { const r = db.one('SELECT value FROM settings WHERE key=?', k); if (!r) return def; try { return JSON.parse(r.value); } catch { return r.value; } };
db.setSetting = (k, v) => db.run('INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value', k, JSON.stringify(v));
db.PATH = DB_PATH;
module.exports = db;
