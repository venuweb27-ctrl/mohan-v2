const router = require('express').Router();
const bcrypt = require('bcryptjs');
const { db, E, wrap, J, v, auth, vendorOnly, activeVendor, pageResult, seqNo, rid, notify, notifyAdmins, audit, round2, post, ACC, stateCodeOf, gstSplit, signToken, loadUser, publicUser } = require('../core');
const svc = require('../services');
const providers = require('../providers');
const { checkOtp, normTarget } = require('./auth');
const { orderDetail, enquiryDetail, rentalDetail } = require('./customer');

const slug = s => String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 80);
const VREG = { business_name: 'string|required|max:160', business_type: 'enum|in:proprietorship,partnership,llp,private_limited,public_limited,other', gstin: 'gstin', pan: 'pan', address: 'string|max:300', city: 'string|max:80', state: 'string|max:60', pincode: 'string|max:6', authorized_person: 'string|max:100', authorized_mobile: 'mobile', contact_email: 'email', description: 'string|max:2000', operating_hours: 'string|max:200', logo: 'string', banner: 'string', lat: 'number', lng: 'number' };

// ----- registration (new user) or upgrade (logged-in customer) -----
router.post('/register', wrap(async (req, res) => {
  let user = req.user;
  if (!user) {
    const b = v(req.body, { name: 'string|required|max:100', mobile: 'mobile|required', email: 'email', password: 'string|required', otp: 'string|required' });
    if (b.password.length < 8) throw E.bad('Password must be at least 8 characters');
    checkOtp(normTarget(b.mobile), 'register', b.otp);
    if (db.one('SELECT id FROM users WHERE mobile=? OR (email IS NOT NULL AND email=?)', b.mobile, b.email || '#')) throw E.conflict('Mobile/email already registered; log in and upgrade instead');
    const id = db.insert('users', { role: 'vendor', name: b.name, mobile: b.mobile, email: b.email, password_hash: bcrypt.hashSync(b.password, 10), mobile_verified: 1, account_type: 'business' });
    user = db.one('SELECT * FROM users WHERE id=?', id);
  } else {
    if (user.role !== 'customer' && user.role !== 'vendor') throw E.forbid();
    if (db.one('SELECT id FROM vendors WHERE user_id=?', user.id)) throw E.conflict('Vendor profile already exists');
    db.run("UPDATE users SET role='vendor' WHERE id=?", user.id);
  }
  const b = v(req.body, VREG);
  if (b.gstin) { const g = await providers.gstVerify.verify(b.gstin); b.gstin_verified = g.valid ? 1 : 0; b.state_code = g.data?.state_code; if (!b.pan) b.pan = g.data?.pan; }
  b.state_code ||= stateCodeOf(b.state);
  const vid = db.insert('vendors', { ...b, user_id: user.id, status: 'pending', kyc_status: 'pending', authorized_person: b.authorized_person || user.name, authorized_mobile: b.authorized_mobile || user.mobile, contact_email: b.contact_email || user.email });
  notifyAdmins('vendor_signup', 'New vendor registration', b.business_name, { vendor_id: vid });
  audit({ user }, 'vendor.register', 'vendor', vid);
  res.status(201).json({ token: signToken(user, req), user: publicUser(loadUser(user.id)), vendor: db.one('SELECT * FROM vendors WHERE id=?', vid) });
}));

router.use(auth('vendor'), vendorOnly);
const fresh = req => db.one('SELECT * FROM vendors WHERE id=?', req.vendor.id);
const mask = s => s ? 'XXXX' + String(s).slice(-4) : null;

// ----- profile / KYC / onboarding -----
router.get('/me', (req, res) => { const vd = fresh(req); res.json({ vendor: { ...vd, bank_account_no_masked: mask(vd.bank_account_no) }, docs: db.all('SELECT * FROM vendor_docs WHERE vendor_id=? ORDER BY id DESC', vd.id), wallet: svc.vendorWallet(vd.id), onboarding: onboarding(vd), staff_role: req.user.vendor_staff_role || 'owner' }); });
function onboarding(vd) {
  const docs = db.all('SELECT doc_type FROM vendor_docs WHERE vendor_id=?', vd.id).map(d => d.doc_type);
  const steps = [['business_details', !!(vd.business_name && vd.address && vd.city && vd.state)], ['gstin', !!vd.gstin], ['pan', !!vd.pan], ['bank', !!(vd.bank_account_no && vd.bank_ifsc)], ['documents', ['gst_certificate', 'pan_card'].every(d => docs.includes(d))], ['agreement', !!vd.agreement_accepted], ['commission_agreement', !!vd.commission_agreement_accepted]].map(([k, done]) => ({ step: k, done }));
  return { steps, complete: steps.every(s => s.done), kyc_status: vd.kyc_status, status: vd.status };
}
router.patch('/profile', wrap(async (req, res) => {
  const b = v(req.body, Object.fromEntries(Object.entries(VREG).map(([k, r]) => [k, r.replace('|required', '')])));
  if (b.gstin && b.gstin !== req.vendor.gstin) { const g = await providers.gstVerify.verify(b.gstin); b.gstin_verified = g.valid ? 1 : 0; b.state_code = g.data?.state_code; if (req.vendor.kyc_status === 'approved') b.kyc_status = 'resubmitted'; }
  if (b.state && !b.state_code) b.state_code = stateCodeOf(b.state);
  db.update('vendors', req.vendor.id, { ...b, updated_at: new Date().toISOString() }); audit(req, 'vendor.profile_update', 'vendor', req.vendor.id, Object.keys(b));
  res.json(fresh(req));
}));
router.patch('/bank', wrap((req, res) => {
  const b = v(req.body, { bank_account_name: 'string|required|max:120', bank_account_no: 'string|required|max:20', bank_ifsc: 'string|required|max:11', bank_name: 'string|max:80' });
  if (!/^[A-Z]{4}0[A-Z0-9]{6}$/.test(b.bank_ifsc.toUpperCase())) throw E.bad('Invalid IFSC');
  if (!/^\d{9,18}$/.test(b.bank_account_no)) throw E.bad('Invalid account number');
  db.update('vendors', req.vendor.id, { ...b, bank_ifsc: b.bank_ifsc.toUpperCase(), bank_verified: 0 });
  audit(req, 'vendor.bank_update', 'vendor', req.vendor.id); notifyAdmins('vendor_bank', 'Vendor bank details changed', req.vendor.business_name, { vendor_id: req.vendor.id });
  res.json({ ok: true, bank_verified: false, note: 'Bank details will be verified by admin (penny-drop mock)' });
}));
router.post('/agreements', wrap((req, res) => { const u = {}; if (req.body.agreement) u.agreement_accepted = 1; if (req.body.commission_agreement) u.commission_agreement_accepted = 1; db.update('vendors', req.vendor.id, u); audit(req, 'vendor.agreement_accept', 'vendor', req.vendor.id, u); res.json(onboarding(fresh(req))); }));
router.post('/docs', wrap((req, res) => { const b = v(req.body, { doc_type: 'enum|required|in:gst_certificate,pan_card,cancelled_cheque,incorporation,address_proof,msme,other', file_url: 'string|required|max:300' }); const id = db.insert('vendor_docs', { vendor_id: req.vendor.id, ...b }); res.status(201).json(db.one('SELECT * FROM vendor_docs WHERE id=?', id)); }));
router.post('/verify-gstin', wrap(async (req, res) => res.json(await providers.gstVerify.verify(String(req.body.gstin || '').toUpperCase()))));
router.post('/submit-kyc', wrap((req, res) => {
  const ob = onboarding(fresh(req)); const miss = ob.steps.filter(s => !s.done).map(s => s.step);
  if (miss.length) throw E.bad('Complete onboarding first: ' + miss.join(', '), { missing: miss });
  db.update('vendors', req.vendor.id, { kyc_status: 'submitted', status: req.vendor.status === 'active' ? 'active' : 'pending' });
  notifyAdmins('vendor_kyc', 'Vendor KYC submitted', req.vendor.business_name, { vendor_id: req.vendor.id });
  res.json(onboarding(fresh(req)));
}));

// ----- dashboard -----
router.get('/dashboard', (req, res) => {
  const vid = req.vendor.id;
  const c = (sql, ...p) => db.one(sql, vid, ...p);
  res.json({
    vendor: { id: vid, business_name: req.vendor.business_name, status: req.vendor.status, kyc_status: req.vendor.kyc_status, rating: req.vendor.rating },
    wallet: svc.vendorWallet(vid),
    orders: { total: c('SELECT COUNT(*) c FROM sub_orders WHERE vendor_id=?').c, pending: c("SELECT COUNT(*) c FROM sub_orders WHERE vendor_id=? AND status='placed'").c, processing: c("SELECT COUNT(*) c FROM sub_orders WHERE vendor_id=? AND status IN ('accepted','processing','packed')").c, shipped: c("SELECT COUNT(*) c FROM sub_orders WHERE vendor_id=? AND status IN ('shipped','out_for_delivery')").c, delivered: c("SELECT COUNT(*) c FROM sub_orders WHERE vendor_id=? AND status IN ('delivered','completed')").c, cancelled: c("SELECT COUNT(*) c FROM sub_orders WHERE vendor_id=? AND status IN ('cancelled','rejected')").c },
    products: { total: c('SELECT COUNT(*) c FROM products WHERE vendor_id=?').c, approved: c("SELECT COUNT(*) c FROM products WHERE vendor_id=? AND status='approved'").c, pending: c("SELECT COUNT(*) c FROM products WHERE vendor_id=? AND status='pending'").c, low_stock: c('SELECT COUNT(*) c FROM products WHERE vendor_id=? AND stock <= low_stock_threshold').c },
    enquiries_open: c("SELECT COUNT(*) c FROM enquiry_vendors ev JOIN enquiries e ON e.id=ev.enquiry_id WHERE ev.vendor_id=? AND ev.status='pending' AND e.status IN ('open','negotiating')").c,
    rentals_active: c("SELECT COUNT(*) c FROM rentals WHERE vendor_id=? AND status IN ('confirmed','active','extension_requested')").c,
    rental_requests: c("SELECT COUNT(*) c FROM rentals WHERE vendor_id=? AND status='requested'").c,
    sales_by_day: db.all("SELECT date(created_at) d, ROUND(SUM(total),2) total, COUNT(*) n FROM sub_orders WHERE vendor_id=? AND status NOT IN ('cancelled','rejected') AND created_at >= date('now','-30 days') GROUP BY d ORDER BY d", vid),
    sales_by_month: db.all("SELECT strftime('%Y-%m',created_at) m, ROUND(SUM(total),2) total FROM sub_orders WHERE vendor_id=? AND status NOT IN ('cancelled','rejected') GROUP BY m ORDER BY m DESC LIMIT 12", vid).reverse(),
    top_products: db.all("SELECT i.product_id, i.name, SUM(i.qty) qty, ROUND(SUM(i.total),2) revenue FROM order_items i JOIN sub_orders s ON s.id=i.sub_order_id WHERE s.vendor_id=? AND s.status NOT IN ('cancelled','rejected') GROUP BY i.product_id ORDER BY revenue DESC LIMIT 5", vid),
    recent_orders: db.all('SELECT s.id, s.sub_order_no, s.total, s.status, s.created_at, o.id order_id, u.name customer_name FROM sub_orders s JOIN orders o ON o.id=s.order_id JOIN users u ON u.id=o.customer_id WHERE s.vendor_id=? ORDER BY s.id DESC LIMIT 8', vid),
    notifications_unread: db.one('SELECT COUNT(*) c FROM notifications WHERE user_id=? AND read=0', req.user.id).c,
  });
});

// ----- products & inventory -----
const PRULES = { name: 'string|required|max:200', description: 'string|max:10000', category_id: 'int|required', subcategory_id: 'int', brand_id: 'int', model_no: 'string|max:80', mfg_year: 'int', condition: 'enum|in:new,used,refurbished', specs: 'json', engine_capacity: 'string|max:60', horsepower: 'string|max:60', fuel_type: 'string|max:40', power_req: 'string|max:80', operating_capacity: 'string|max:80', dimensions: 'string|max:80', weight: 'string|max:40', warranty: 'string|max:120', maintenance: 'string|max:2000', price: 'number|required|min:0', mrp: 'number', gst_rate: 'number', hsn: 'string|max:10', stock: 'int|min:0', moq: 'int|min:1', low_stock_threshold: 'int|min:0', delivery_charge: 'number|min:0', installation_charge: 'number|min:0', purchase_available: 'bool', rental_available: 'bool', rent_hourly: 'number', rent_daily: 'number', rent_weekly: 'number', rent_monthly: 'number', security_deposit: 'number', rental_units: 'int|min:0', images: 'json', videos: 'json', location_city: 'string|max:80', location_state: 'string|max:60', lat: 'number', lng: 'number', return_policy: 'string|max:2000', cancellation_policy: 'string|max:2000', active: 'bool' };
const CRITICAL = ['name', 'price', 'category_id', 'description', 'images', 'specs', 'condition', 'brand_id', 'model_no'];
const myProduct = req => { const p = db.one('SELECT * FROM products WHERE id=? AND vendor_id=?', req.params.id, req.vendor.id); if (!p) throw E.notFound('Product not found'); return p; };
const pshape = p => ({ ...p, images: J(p.images, []), videos: J(p.videos, []), specs: J(p.specs, {}), image: J(p.images, [])[0] });
function checkGst(b) { if (b.gst_rate != null && ![0, 5, 12, 18, 28].includes(+b.gst_rate)) throw E.bad('GST rate must be 0/5/12/18/28'); if (b.rental_available && !(b.rent_hourly || b.rent_daily || b.rent_weekly || b.rent_monthly)) throw E.bad('Set at least one rental price'); }
router.get('/products', (req, res) => {
  const w = ['vendor_id=?']; const p = [req.vendor.id];
  if (req.query.status) { w.push('status=?'); p.push(req.query.status); }
  if (req.query.q) { w.push('(name LIKE ? OR model_no LIKE ?)'); p.push(`%${req.query.q}%`, `%${req.query.q}%`); }
  if (req.query.low_stock === '1') w.push('stock <= low_stock_threshold');
  res.json(pageResult(`SELECT * FROM products WHERE ${w.join(' AND ')} ORDER BY id DESC`, p, req, pshape));
});
router.post('/products', activeVendor, wrap((req, res) => {
  const b = v(req.body, PRULES); checkGst(b);
  const cat = db.one('SELECT * FROM categories WHERE id=?', b.category_id); if (!cat) throw E.bad('Invalid category');
  const id = db.insert('products', { ...b, vendor_id: req.vendor.id, slug: slug(b.name) + '-' + rid('').slice(-4).toLowerCase(), gst_rate: b.gst_rate ?? cat.gst_rate ?? 18, hsn: b.hsn || cat.hsn, location_city: b.location_city || req.vendor.city, location_state: b.location_state || req.vendor.state, lat: b.lat ?? req.vendor.lat, lng: b.lng ?? req.vendor.lng, status: 'pending', images: b.images || [], specs: b.specs || {} });
  db.insert('product_approvals', { product_id: id, action: 'submitted', by_user: req.user.id });
  if (b.stock) db.insert('inventory_log', { product_id: id, change: b.stock, reason: 'initial', by_user: req.user.id });
  notifyAdmins('product_pending', 'Product awaiting approval', b.name, { product_id: id });
  res.status(201).json(pshape(db.one('SELECT * FROM products WHERE id=?', id)));
}));
router.get('/products/export.csv', (req, res) => {
  const rows = db.all('SELECT id,name,model_no,category_id,brand_id,condition,price,gst_rate,hsn,stock,moq,status,rental_available,rent_daily FROM products WHERE vendor_id=?', req.vendor.id);
  res.type('text/csv').attachment('products.csv').send(toCsv(rows));
});
router.get('/products/:id', wrap((req, res) => { const p = myProduct(req); res.json({ ...pshape(p), approvals: db.all('SELECT * FROM product_approvals WHERE product_id=? ORDER BY id DESC', p.id), inventory_log: db.all('SELECT * FROM inventory_log WHERE product_id=? ORDER BY id DESC LIMIT 50', p.id) }); }));
router.patch('/products/:id', wrap((req, res) => {
  const p = myProduct(req); const b = v(req.body, Object.fromEntries(Object.entries(PRULES).map(([k, r]) => [k, r.replace('|required', '')]))); checkGst({ ...p, ...b });
  if (b.stock != null && b.stock !== p.stock) db.insert('inventory_log', { product_id: p.id, change: b.stock - p.stock, reason: 'manual_edit', by_user: req.user.id });
  const resubmit = p.status !== 'pending' && CRITICAL.some(k => k in b && JSON.stringify(b[k]) !== JSON.stringify(typeof p[k] === 'string' && /^[[{]/.test(p[k]) ? J(p[k]) : p[k]));
  if (resubmit || p.status === 'correction' || p.status === 'rejected') { b.status = 'pending'; db.insert('product_approvals', { product_id: p.id, action: 'resubmitted', by_user: req.user.id }); notifyAdmins('product_pending', 'Product updated – re-approval needed', p.name, { product_id: p.id }); }
  db.update('products', p.id, { ...b, updated_at: new Date().toISOString() });
  res.json(pshape(db.one('SELECT * FROM products WHERE id=?', p.id)));
}));
router.delete('/products/:id', wrap((req, res) => { const p = myProduct(req); if (db.one('SELECT 1 FROM order_items WHERE product_id=?', p.id)) { db.update('products', p.id, { active: 0, status: 'archived' }); return res.json({ ok: true, archived: true }); } db.run('DELETE FROM wishlist WHERE product_id=?', p.id); db.run('DELETE FROM cart_items WHERE product_id=?', p.id); db.run('DELETE FROM compare_items WHERE product_id=?', p.id); db.run('DELETE FROM recent_views WHERE product_id=?', p.id); db.run('DELETE FROM product_approvals WHERE product_id=?', p.id); db.run('DELETE FROM inventory_log WHERE product_id=?', p.id); db.run('DELETE FROM products WHERE id=?', p.id); res.json({ ok: true }); }));
router.post('/products/:id/duplicate', activeVendor, wrap((req, res) => { const p = myProduct(req); const { id, created_at, updated_at, views, sold, rating, rating_count, reserved, ...rest } = p; const nid = db.insert('products', { ...rest, name: p.name + ' (copy)', slug: p.slug + '-c' + rid('').slice(-4).toLowerCase(), status: 'pending', stock: 0, featured: 0, promoted: 0 }); res.status(201).json(pshape(db.one('SELECT * FROM products WHERE id=?', nid))); }));
router.post('/products/:id/toggle', wrap((req, res) => { const p = myProduct(req); db.update('products', p.id, { active: p.active ? 0 : 1 }); res.json({ active: !p.active }); }));
router.post('/products/:id/stock', wrap((req, res) => {
  const p = myProduct(req); const b = v(req.body, { change: 'int', set: 'int|min:0', reason: 'string|max:200' });
  const nv = b.set != null ? b.set : p.stock + (b.change || 0); if (nv < 0) throw E.bad('Stock cannot go negative');
  db.run('UPDATE products SET stock=? WHERE id=?', nv, p.id); db.insert('inventory_log', { product_id: p.id, change: nv - p.stock, reason: b.reason || 'adjustment', by_user: req.user.id });
  if (nv <= p.low_stock_threshold) notify(req.user.id, 'stock_low', 'Low stock', `${p.name}: ${nv} left`, { product_id: p.id });
  res.json({ stock: nv });
}));
// CSV bulk import: header row with PRULES keys (name,category_id,price,...). Body: {csv:"..."}
function parseCsv(text) { const rows = []; let cur = [''], q = false, row = []; const out = []; let f = ''; for (let i = 0; i < text.length; i++) { const ch = text[i]; if (q) { if (ch === '"' && text[i + 1] === '"') { f += '"'; i++; } else if (ch === '"') q = false; else f += ch; } else if (ch === '"') q = true; else if (ch === ',') { row.push(f); f = ''; } else if (ch === '\n' || ch === '\r') { if (ch === '\r' && text[i + 1] === '\n') i++; row.push(f); f = ''; if (row.some(x => x !== '')) out.push(row); row = []; } else f += ch; } row.push(f); if (row.some(x => x !== '')) out.push(row); return out; }
function toCsv(rows) { if (!rows.length) return ''; const k = Object.keys(rows[0]); const esc = x => x == null ? '' : /[",\n]/.test(String(x)) ? `"${String(x).replace(/"/g, '""')}"` : String(x); return [k.join(','), ...rows.map(r => k.map(c => esc(r[c])).join(','))].join('\n'); }
router.post('/products/import', activeVendor, wrap((req, res) => {
  let text = req.body.csv;
  if (!text && req.body.file_url) { const fp = require('path').join(__dirname, '..', '..', req.body.file_url.replace(/^\/+/, '')); if (!fp.includes('uploads')) throw E.bad('bad file'); text = require('fs').readFileSync(fp, 'utf8'); }
  if (!text) throw E.bad('csv text or file_url required');
  const rows = parseCsv(text); const head = rows.shift().map(h => h.trim());
  const results = [];
  rows.slice(0, 500).forEach((r, i) => {
    try {
      const o = Object.fromEntries(head.map((h, j) => [h, r[j]]));
      if (o.specs) o.specs = J(o.specs, Object.fromEntries(String(o.specs).split(';').filter(Boolean).map(kv => kv.split(':').map(s => s.trim()))));
      if (o.images) o.images = String(o.images).split('|').filter(Boolean);
      const b = v(o, PRULES); checkGst(b);
      if (!db.one('SELECT id FROM categories WHERE id=?', b.category_id)) throw E.bad('invalid category_id');
      const id = db.insert('products', { ...b, vendor_id: req.vendor.id, slug: slug(b.name) + '-' + rid('').slice(-4).toLowerCase(), status: 'pending', location_city: b.location_city || req.vendor.city, location_state: b.location_state || req.vendor.state, images: b.images || [], specs: b.specs || {} });
      results.push({ row: i + 2, ok: true, id });
    } catch (e) { results.push({ row: i + 2, ok: false, error: e.message, details: e.details }); }
  });
  if (results.some(r => r.ok)) notifyAdmins('product_pending', 'Bulk import awaiting approval', `${req.vendor.business_name}: ${results.filter(r => r.ok).length} products`);
  res.json({ imported: results.filter(r => r.ok).length, failed: results.filter(r => !r.ok).length, results, template_columns: Object.keys(PRULES) });
}));
router.get('/inventory', (req, res) => res.json({ items: db.all('SELECT id,name,model_no,stock,reserved,sold,low_stock_threshold,status,active,(stock<=low_stock_threshold) low FROM products WHERE vendor_id=? ORDER BY low DESC, stock ASC', req.vendor.id), log: db.all('SELECT l.*, p.name FROM inventory_log l JOIN products p ON p.id=l.product_id WHERE p.vendor_id=? ORDER BY l.id DESC LIMIT 100', req.vendor.id) }));

// ----- orders -----
const mySub = req => { const s = db.one('SELECT * FROM sub_orders WHERE id=? AND vendor_id=?', req.params.id, req.vendor.id); if (!s) throw E.notFound('Order not found'); return s; };
function subDetail(s) {
  const o = db.one('SELECT o.order_no,o.customer_id,o.shipping_address,o.billing_address,o.customer_gstin,o.payment_status,o.payment_plan,o.paid_amount,o.grand_total,o.place_of_supply,o.notes, u.name customer_name, u.mobile customer_mobile, u.email customer_email FROM orders o JOIN users u ON u.id=o.customer_id WHERE o.id=?', s.order_id);
  return { ...s, dispatch_docs: J(s.dispatch_docs, []), order: { ...o, shipping_address: J(o.shipping_address), billing_address: J(o.billing_address) }, items: db.all('SELECT * FROM order_items WHERE sub_order_id=?', s.id), events: db.all('SELECT * FROM order_events WHERE sub_order_id=? ORDER BY id', s.id), requests: db.all('SELECT * FROM order_requests WHERE sub_order_id=? ORDER BY id DESC', s.id), invoices: db.all('SELECT id,invoice_no,type,total,created_at FROM invoices WHERE sub_order_id=?', s.id), allowed_next: svc.SUB_FLOW[s.status] || [] };
}
router.get('/orders', (req, res) => {
  const w = ['s.vendor_id=?']; const p = [req.vendor.id];
  if (req.query.status) { w.push(`s.status IN (${String(req.query.status).split(',').map(() => '?').join(',')})`); p.push(...String(req.query.status).split(',')); }
  if (req.query.q) { w.push('(s.sub_order_no LIKE ? OR u.name LIKE ?)'); p.push(`%${req.query.q}%`, `%${req.query.q}%`); }
  res.json(pageResult(`SELECT s.*, o.order_no, o.payment_status, u.name customer_name, (SELECT GROUP_CONCAT(name,', ') FROM order_items WHERE sub_order_id=s.id) item_names FROM sub_orders s JOIN orders o ON o.id=s.order_id JOIN users u ON u.id=o.customer_id WHERE ${w.join(' AND ')} ORDER BY s.id DESC`, p, req));
});
router.get('/orders/:id', wrap((req, res) => res.json(subDetail(mySub(req)))));
router.post('/orders/:id/status', wrap((req, res) => {
  const s = mySub(req);
  const b = v(req.body, { status: 'enum|required|in:accepted,rejected,processing,packed,shipped,out_for_delivery,delivered,returned', note: 'string|max:1000', courier: 'string|max:80', tracking_no: 'string|max:80', eta: 'string', dispatch_docs: 'json', transport_mode: 'string|max:40', vehicle_no: 'string|max:20' });
  const extra = {}; if (b.courier) extra.transporter = b.courier; if (b.tracking_no) extra.tracking_no = b.tracking_no; if (b.eta) extra.expected_delivery = b.eta; if (b.vehicle_no) extra.vehicle_no = b.vehicle_no; if (b.transport_mode) extra.lr_no = b.transport_mode; if (b.dispatch_docs) extra.dispatch_docs = b.dispatch_docs;
  if (b.status === 'returned') { if (s.status !== 'return_requested') throw E.bad('No return requested'); }
  const out = svc.setSubStatus(s, b.status, req.user, b.note || `Status → ${b.status}`, extra);
  if (b.status === 'shipped') { const o = db.one('SELECT order_no FROM orders WHERE id=?', s.order_id); notify(db.one('SELECT customer_id FROM orders WHERE id=?', s.order_id).customer_id, 'order_tracking', 'Shipment details', `${s.sub_order_no} via ${b.courier || 'vendor transport'} ${b.tracking_no ? '(#' + b.tracking_no + ')' : ''}`, { order_id: s.order_id }); }
  res.json(subDetail(out));
}));
router.get('/requests', (req, res) => res.json(pageResult(`SELECT r.*, s.sub_order_no, u.name customer_name FROM order_requests r JOIN sub_orders s ON s.id=r.sub_order_id JOIN users u ON u.id=r.user_id WHERE s.vendor_id=? ${req.query.status ? 'AND r.status=?' : ''} ORDER BY r.id DESC`, req.query.status ? [req.vendor.id, req.query.status] : [req.vendor.id], req)));
router.post('/requests/:rid/respond', wrap(async (req, res) => {
  const r = db.one('SELECT r.*, s.vendor_id, s.status sub_status FROM order_requests r JOIN sub_orders s ON s.id=r.sub_order_id WHERE r.id=? AND s.vendor_id=?', req.params.rid, req.vendor.id); if (!r) throw E.notFound();
  if (r.status !== 'open') throw E.bad('Request already ' + r.status);
  const b = v(req.body, { action: 'enum|required|in:approve,reject', note: 'string|max:1000' });
  const sub = db.one('SELECT * FROM sub_orders WHERE id=?', r.sub_order_id);
  if (b.action === 'approve') {
    if (r.type === 'cancel') svc.setSubStatus(sub, 'cancelled', { ...req.user, role: 'admin' }, 'Cancellation approved by vendor', { force: true });
    else if (r.type === 'return') { svc.setSubStatus(sub, 'returned', req.user, 'Return approved'); svc.releaseStock(sub.id, 'return_restock'); await svc.processRefund({ sub_order_id: sub.id, amount: r.amount || undefined, reason: 'Return approved', request_id: r.id, user: req.user }); }
    else if (r.type === 'refund') { db.run("UPDATE order_requests SET status='vendor_approved' WHERE id=?", r.id); notifyAdmins('refund_request', 'Refund approved by vendor – process', `request #${r.id}`); }
    else db.run("UPDATE order_requests SET status='in_progress' WHERE id=?", r.id);
  } else if (r.type === 'return' && sub.status === 'return_requested') db.run("UPDATE sub_orders SET status='delivered' WHERE id=?", sub.id);
  const st = b.action === 'reject' ? 'rejected' : (['cancel', 'return'].includes(r.type) ? 'approved' : db.one('SELECT status FROM order_requests WHERE id=?', r.id).status);
  db.run('UPDATE order_requests SET status=?, resolution=?, resolved_by=?, updated_at=CURRENT_TIMESTAMP WHERE id=?', st, b.note || null, req.user.id, r.id);
  notify(r.user_id, 'request_update', `Your ${r.type} request was ${st.replace('_', ' ')}`, b.note || '', { order_id: r.order_id });
  res.json(db.one('SELECT * FROM order_requests WHERE id=?', r.id));
}));
// cancel_requested handled via setSubStatus force=true above (vendor approving customer cancel post-dispatch is unusual but allowed).

// ----- enquiries & quotations -----
router.get('/enquiries', (req, res) => res.json(pageResult(`SELECT e.*, ev.status vendor_status, u.name customer_name, u.business_name customer_company, p.name product_name, (SELECT COUNT(*) FROM quotations q WHERE q.enquiry_id=e.id AND q.vendor_id=ev.vendor_id) my_quotes FROM enquiry_vendors ev JOIN enquiries e ON e.id=ev.enquiry_id JOIN users u ON u.id=e.customer_id LEFT JOIN products p ON p.id=e.product_id WHERE ev.vendor_id=? ORDER BY e.id DESC`, [req.vendor.id], req, e => ({ ...e, docs: J(e.docs, []) }))));
router.get('/enquiries/:id', wrap((req, res) => {
  if (!db.one('SELECT 1 FROM enquiry_vendors WHERE enquiry_id=? AND vendor_id=?', req.params.id, req.vendor.id)) throw E.notFound();
  const e = db.one('SELECT e.*, u.name customer_name, u.mobile customer_mobile, u.email customer_email, u.business_name customer_company, u.gstin customer_gstin FROM enquiries e JOIN users u ON u.id=e.customer_id WHERE e.id=?', req.params.id);
  e.docs = J(e.docs, []); e.quotations = db.all('SELECT * FROM quotations WHERE enquiry_id=? AND vendor_id=? ORDER BY version DESC', e.id, req.vendor.id).map(q => ({ ...q, items: J(q.items, []) }));
  db.run("UPDATE enquiry_vendors SET status=CASE WHEN status='pending' THEN 'viewed' ELSE status END WHERE enquiry_id=? AND vendor_id=?", e.id, req.vendor.id);
  res.json(e);
}));
function priceQuote(vendor, customerId, b) {
  const cust = db.one('SELECT * FROM users WHERE id=?', customerId);
  const addr = db.one('SELECT state_code FROM addresses WHERE user_id=? ORDER BY is_default DESC LIMIT 1', customerId);
  const pos = addr?.state_code || cust.state_code || vendor.state_code;
  const items = b.items.map(i => { const qty = +i.qty || 1, up = +i.unit_price; if (!(up >= 0) || !i.name) throw E.bad('Each item needs name and unit_price'); const rate = i.gst_rate ?? 18; const taxable = round2(qty * up); const t = gstSplit(taxable, rate, vendor.state_code, pos); return { product_id: i.product_id || null, name: i.name, hsn: i.hsn || null, qty, unit_price: up, gst_rate: rate, taxable, ...t }; });
  const subtotal = round2(items.reduce((a, i) => a + i.taxable, 0));
  const disc = round2(b.discount || 0), transport = round2(b.transport || 0), inst = round2(b.installation || 0);
  const taxable = round2(subtotal - disc + transport + inst);
  const avgRate = subtotal ? items.reduce((a, i) => a + i.taxable * i.gst_rate, 0) / subtotal : 18;
  const t = gstSplit(taxable, avgRate, vendor.state_code, pos);
  return { items, subtotal, discount: disc, transport, installation: inst, taxable, cgst: t.cgst, sgst: t.sgst, igst: t.igst, total: round2(taxable + t.tax) };
}
const QRULES = { enquiry_id: 'int', customer_id: 'int', items: 'json|required', discount: 'number|min:0', transport: 'number|min:0', installation: 'number|min:0', payment_terms: 'string|max:500', delivery_timeline: 'string|max:200', valid_until: 'string', notes: 'string|max:2000', proposal_url: 'string|max:300' };
router.post('/quotations', activeVendor, wrap((req, res) => {
  const b = v(req.body, QRULES); if (!Array.isArray(b.items) || !b.items.length) throw E.bad('items required');
  let customerId = b.customer_id;
  if (b.enquiry_id) { if (!db.one('SELECT 1 FROM enquiry_vendors WHERE enquiry_id=? AND vendor_id=?', b.enquiry_id, req.vendor.id)) throw E.notFound('Enquiry not found'); customerId = db.one('SELECT customer_id FROM enquiries WHERE id=?', b.enquiry_id).customer_id; }
  if (!customerId || !db.one("SELECT id FROM users WHERE id=? AND role='customer'", customerId)) throw E.bad('enquiry_id or customer_id required');
  const pr = priceQuote(req.vendor, customerId, b);
  const id = db.insert('quotations', { quote_no: seqNo('QT'), enquiry_id: b.enquiry_id, vendor_id: req.vendor.id, customer_id: customerId, ...pr, payment_terms: b.payment_terms, delivery_timeline: b.delivery_timeline, valid_until: b.valid_until || new Date(Date.now() + 15 * 864e5).toISOString().slice(0, 10), notes: b.notes, proposal_url: b.proposal_url, status: 'sent' });
  if (b.enquiry_id) { db.run("UPDATE enquiry_vendors SET status='quoted' WHERE enquiry_id=? AND vendor_id=?", b.enquiry_id, req.vendor.id); db.run("UPDATE enquiries SET status='quoted' WHERE id=? AND status='open'", b.enquiry_id); }
  notify(customerId, 'quotation', 'New quotation received', `${req.vendor.business_name} sent a quotation for ₹${pr.total}`, { quotation_id: id, enquiry_id: b.enquiry_id });
  res.status(201).json(db.one('SELECT * FROM quotations WHERE id=?', id));
}));
router.post('/quotations/:id/revise', activeVendor, wrap((req, res) => {
  const q = db.one('SELECT * FROM quotations WHERE id=? AND vendor_id=?', req.params.id, req.vendor.id); if (!q) throw E.notFound();
  if (['converted', 'rejected', 'accepted'].includes(q.status)) throw E.bad('Cannot revise a ' + q.status + ' quotation');
  const b = v({ items: J(q.items), ...req.body }, QRULES);
  const pr = priceQuote(req.vendor, q.customer_id, b);
  db.run("UPDATE quotations SET status='superseded' WHERE id=?", q.id);
  const id = db.insert('quotations', { quote_no: q.quote_no.replace(/-R\d+$/, '') + '-R' + (q.version + 1), enquiry_id: q.enquiry_id, vendor_id: q.vendor_id, customer_id: q.customer_id, version: q.version + 1, parent_id: q.id, ...pr, payment_terms: b.payment_terms ?? q.payment_terms, delivery_timeline: b.delivery_timeline ?? q.delivery_timeline, valid_until: b.valid_until || q.valid_until, notes: b.notes ?? q.notes, proposal_url: b.proposal_url ?? q.proposal_url, status: 'revised' });
  notify(q.customer_id, 'quotation', 'Quotation revised', `${req.vendor.business_name} revised ${q.quote_no}: ₹${pr.total}`, { quotation_id: id });
  res.status(201).json(db.one('SELECT * FROM quotations WHERE id=?', id));
}));
router.get('/quotations', (req, res) => res.json(pageResult(`SELECT q.*, u.name customer_name FROM quotations q JOIN users u ON u.id=q.customer_id WHERE q.vendor_id=? ${req.query.status ? 'AND q.status=?' : ''} ORDER BY q.id DESC`, req.query.status ? [req.vendor.id, req.query.status] : [req.vendor.id], req, q => ({ ...q, items: J(q.items, []) }))));
router.post('/quotations/:id/proforma', wrap((req, res) => { const q = db.one('SELECT * FROM quotations WHERE id=? AND vendor_id=?', req.params.id, req.vendor.id); if (!q) throw E.notFound(); res.status(201).json(svc.issueInvoice({ type: 'quotation', quotation_id: q.id, user_id: req.user.id })); }));

// ----- rentals -----
router.get('/rentals', (req, res) => res.json(pageResult(`SELECT r.*, p.name product_name, u.name customer_name, u.mobile customer_mobile FROM rentals r JOIN products p ON p.id=r.product_id JOIN users u ON u.id=r.customer_id WHERE r.vendor_id=? ${req.query.status ? 'AND r.status=?' : ''} ORDER BY r.id DESC`, req.query.status ? [req.vendor.id, req.query.status] : [req.vendor.id], req, r => ({ ...r, extension: J(r.extension, []) }))));
router.get('/rentals/calendar', (req, res) => res.json({ items: db.all("SELECT r.id, r.rental_no, r.product_id, p.name product_name, r.start_at, r.end_at, r.status FROM rentals r JOIN products p ON p.id=r.product_id WHERE r.vendor_id=? AND r.status NOT IN ('rejected','cancelled') ORDER BY r.start_at", req.vendor.id) }));
router.get('/rentals/:id', wrap((req, res) => res.json(rentalDetail(+req.params.id, req.user))));
router.post('/rentals/:id/action', wrap(async (req, res) => {
  const r = rentalDetail(+req.params.id, req.user);
  const b = v(req.body, { action: 'enum|required|in:approve,reject,start,return,extension_approve,extension_reject,close', quoted_rate: 'number', late_charge: 'number|min:0', damage_charge: 'number|min:0', note: 'string|max:1000' });
  const need = (...s) => { if (!s.includes(r.status)) throw E.bad(`Cannot ${b.action} a rental in status ${r.status}`); };
  let msg;
  if (b.action === 'approve') { need('requested'); const upd = { status: 'approved' }; if (b.quoted_rate) { const p = db.one('SELECT * FROM products WHERE id=?', r.product_id); const cust = db.one('SELECT state_code FROM users WHERE id=?', r.customer_id); Object.assign(upd, svc.priceRental(p, r.unit, r.duration, cust.state_code, b.quoted_rate), { quoted_rate: b.quoted_rate }); } db.update('rentals', r.id, upd); msg = 'Rental approved – pay advance to confirm'; }
  else if (b.action === 'reject') { need('requested'); db.update('rentals', r.id, { status: 'rejected', notes: b.note }); msg = 'Rental request rejected'; }
  else if (b.action === 'start') { need('confirmed'); db.update('rentals', r.id, { status: 'active' }); msg = 'Rental started – machine handed over'; }
  else if (b.action === 'extension_approve' || b.action === 'extension_reject') {
    need('extension_requested'); const ext = r.extension; const last = ext.filter(x => x.status === 'requested').pop(); if (!last) throw E.bad('No pending extension');
    last.status = b.action === 'extension_approve' ? 'approved' : 'rejected';
    db.update('rentals', r.id, { extension: ext, status: 'active', ...(last.status === 'approved' ? { end_at: last.new_end } : {}) }); msg = `Extension ${last.status}`;
  }
  else if (b.action === 'return') { need('active', 'extension_requested'); let late = b.late_charge; if (late == null) { const overH = Math.max(0, (Date.now() - new Date(r.end_at).getTime()) / 3600000); late = overH > 1 ? round2(Math.ceil(overH / svc.UNIT_HOURS[r.unit]) * r.rate * 1.1) : 0; } db.update('rentals', r.id, { status: 'returned', returned_at: new Date().toISOString(), late_charge: late, damage_charge: b.damage_charge || 0, notes: b.note || r.notes }); msg = 'Machine returned' + (late || b.damage_charge ? ` – extra charges ₹${round2(late + (b.damage_charge || 0))}` : ''); }
  else if (b.action === 'close') {
    need('returned'); const out = svc.closeRental(r, req.user);
    if (out.refundDeposit > 0) { await svc.gatewayRefund(null, r.id, out.refundDeposit); post([{ account: ACC.escrow, debit: out.refundDeposit }, { account: ACC.clearing, credit: out.refundDeposit }], 'rental', r.id, 'Deposit refund'); db.insert('refunds', { refund_no: rid('RF'), rental_id: r.id, amount: out.refundDeposit, status: 'processed', reason: 'Security deposit refund' }); }
    msg = `Rental closed${out.refundDeposit > 0 ? `; deposit ₹${out.refundDeposit} refunded` : ''}`;
  }
  notify(r.customer_id, 'rental_' + b.action, msg, r.rental_no, { rental_id: r.id });
  res.json(rentalDetail(r.id, req.user));
}));

// ----- wallet & withdrawals -----
router.get('/wallet', (req, res) => res.json({ ...svc.vendorWallet(req.vendor.id), bank: { name: req.vendor.bank_account_name, account: mask(req.vendor.bank_account_no), ifsc: req.vendor.bank_ifsc, verified: !!req.vendor.bank_verified } }));
router.get('/wallet/ledger', (req, res) => res.json(pageResult('SELECT * FROM ledger_entries WHERE account IN (?,?) ORDER BY id DESC', [ACC.avail(req.vendor.id), ACC.hold(req.vendor.id)], req)));
router.get('/commissions', (req, res) => res.json(pageResult('SELECT c.*, s.sub_order_no, r.rental_no FROM commissions c LEFT JOIN sub_orders s ON s.id=c.sub_order_id LEFT JOIN rentals r ON r.id=c.rental_id WHERE c.vendor_id=? ORDER BY c.id DESC', [req.vendor.id], req)));
router.post('/withdrawals', activeVendor, wrap((req, res) => {
  const b = v(req.body, { amount: 'number|required|min:1' }); const amount = round2(b.amount);
  const vd = fresh(req); if (!vd.bank_account_no || !vd.bank_ifsc) throw E.bad('Add bank details first');
  const w = svc.vendorWallet(vd.id); const min = vd.min_withdrawal ?? w.min_withdrawal;
  if (amount < min) throw E.bad(`Minimum withdrawal is ₹${min}`);
  if (amount > w.available + 0.001) throw E.bad(`Insufficient balance (available ₹${w.available})`);
  if (db.one("SELECT id FROM withdrawals WHERE vendor_id=? AND status IN ('requested','approved','processing')", vd.id)) throw E.conflict('A withdrawal is already in progress');
  const fee = round2(w.withdrawal_fee || 0);
  const id = db.transaction(() => { const id = db.insert('withdrawals', { withdrawal_no: seqNo('WD'), vendor_id: vd.id, amount, fee, net: round2(amount - fee), bank: { name: vd.bank_account_name, account: vd.bank_account_no, ifsc: vd.bank_ifsc, bank: vd.bank_name }, status: 'requested' }); post([{ account: ACC.avail(vd.id), debit: amount }, { account: ACC.hold(vd.id), credit: amount }], 'withdrawal', id, 'Withdrawal requested'); return id; })();
  notifyAdmins('withdrawal_request', 'Withdrawal request', `${vd.business_name}: ₹${amount}`, { withdrawal_id: id });
  res.status(201).json(db.one('SELECT * FROM withdrawals WHERE id=?', id));
}));
router.get('/withdrawals', (req, res) => res.json(pageResult('SELECT * FROM withdrawals WHERE vendor_id=? ORDER BY id DESC', [req.vendor.id], req, w => ({ ...w, bank: { ...J(w.bank, {}), account: mask(J(w.bank, {}).account) } }))));

// ----- reports -----
router.get('/reports/:kind', wrap((req, res) => {
  const vid = req.vendor.id; const from = req.query.from || '2000-01-01', to = (req.query.to || '2999-12-31') + ' 23:59:59';
  const Q = { sales: ["SELECT s.sub_order_no, date(s.created_at) date, u.name customer, s.taxable, s.cgst, s.sgst, s.igst, s.total, s.commission, s.vendor_net, s.status FROM sub_orders s JOIN orders o ON o.id=s.order_id JOIN users u ON u.id=o.customer_id WHERE s.vendor_id=? AND s.created_at BETWEEN ? AND ? ORDER BY s.id", [vid, from, to]],
    products: ["SELECT p.id, p.name, p.views, p.sold, p.stock, p.rating, COALESCE(SUM(i.total),0) revenue FROM products p LEFT JOIN order_items i ON i.product_id=p.id WHERE p.vendor_id=? GROUP BY p.id ORDER BY revenue DESC", [vid]],
    gst: ["SELECT invoice_no, date(created_at) date, buyer_gstin, place_of_supply, taxable, cgst, sgst, igst, total FROM invoices WHERE vendor_id=? AND type IN ('tax','rental') AND created_at BETWEEN ? AND ? ORDER BY id", [vid, from, to]],
    commission: ["SELECT c.id, date(c.created_at) date, COALESCE(s.sub_order_no, r.rental_no) ref, c.basis, c.rate, c.amount, c.gst, c.reversed FROM commissions c LEFT JOIN sub_orders s ON s.id=c.sub_order_id LEFT JOIN rentals r ON r.id=c.rental_id WHERE c.vendor_id=? AND c.created_at BETWEEN ? AND ?", [vid, from, to]],
    payouts: ["SELECT withdrawal_no, date(created_at) date, amount, fee, net, status, utr FROM withdrawals WHERE vendor_id=? AND created_at BETWEEN ? AND ?", [vid, from, to]],
    rentals: ["SELECT r.rental_no, p.name, r.start_at, r.end_at, r.total, r.paid_amount, r.status FROM rentals r JOIN products p ON p.id=r.product_id WHERE r.vendor_id=? AND r.created_at BETWEEN ? AND ?", [vid, from, to]] };
  const q = Q[req.params.kind]; if (!q) throw E.notFound('Unknown report');
  const rows = db.all(q[0], ...q[1]);
  if (req.query.format === 'csv') return res.type('text/csv').attachment(`${req.params.kind}.csv`).send(toCsv(rows));
  res.json({ kind: req.params.kind, rows });
}));

// ----- vendor staff -----
router.get('/staff', (req, res) => res.json({ items: db.all('SELECT vs.id, vs.role, u.id user_id, u.name, u.mobile, u.email, u.status FROM vendor_staff vs JOIN users u ON u.id=vs.user_id WHERE vs.vendor_id=?', req.vendor.id) }));
router.post('/staff', wrap((req, res) => {
  if (req.user.vendor_staff_role) throw E.forbid('Only the vendor owner can add staff');
  const b = v(req.body, { name: 'string|required', mobile: 'mobile|required', email: 'email', password: 'string|required', role: 'enum|in:manager,sales,inventory,accounts' });
  if (db.one('SELECT id FROM users WHERE mobile=?', b.mobile)) throw E.conflict('Mobile already registered');
  const uid = db.insert('users', { role: 'vendor', name: b.name, mobile: b.mobile, email: b.email, password_hash: bcrypt.hashSync(b.password, 10), created_by: req.user.id });
  db.insert('vendor_staff', { vendor_id: req.vendor.id, user_id: uid, role: b.role || 'sales' }); audit(req, 'vendor.staff_add', 'user', uid);
  res.status(201).json({ ok: true, user_id: uid });
}));
router.delete('/staff/:id', wrap((req, res) => { const s = db.one('SELECT * FROM vendor_staff WHERE id=? AND vendor_id=?', req.params.id, req.vendor.id); if (!s) throw E.notFound(); db.run("UPDATE users SET status='blocked' WHERE id=?", s.user_id); db.run('DELETE FROM vendor_staff WHERE id=?', s.id); res.json({ ok: true }); }));

router.use('/crm', require('./crm')('vendor'));
module.exports = router; module.exports.toCsv = toCsv;
