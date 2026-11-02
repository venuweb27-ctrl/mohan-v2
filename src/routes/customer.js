const router = require('express').Router();
const { db, E, wrap, J, v, round2, pageResult, rid, seqNo, notify, vendorUserId, audit, gstSplit, stateCodeOf } = require('../core');
const svc = require('../services');
const { shape, PSELECT } = require('./catalog');
const C = require('../core').auth('customer');
router.use(['/wishlist', '/compare', '/recently-viewed', '/cart', '/checkout', '/orders', '/enquiries', '/quotations', '/rentals', '/coupons'], C);

// ----- wishlist / compare / recent -----
router.get('/wishlist', (req, res) => res.json({ items: db.all(`${PSELECT} JOIN wishlist w ON w.product_id=p.id AND w.user_id=? ORDER BY w.created_at DESC`, req.user.id).map(p => shape(p)) }));
router.post('/wishlist', wrap((req, res) => { const pid = +req.body.product_id; if (!db.one('SELECT id FROM products WHERE id=?', pid)) throw E.notFound(); db.run('INSERT OR IGNORE INTO wishlist(user_id,product_id) VALUES(?,?)', req.user.id, pid); res.status(201).json({ ok: true }); }));
router.delete('/wishlist/:pid', (req, res) => { db.run('DELETE FROM wishlist WHERE user_id=? AND product_id=?', req.user.id, req.params.pid); res.json({ ok: true }); });
function compareMatrix(ids) {
  const ps = ids.length ? db.all(`${PSELECT} WHERE p.id IN (${ids.map(() => '?').join(',')})`, ...ids).map(p => shape(p, true)) : [];
  const keys = [...new Set(ps.flatMap(p => Object.keys(p.specs)))];
  const rows = [['Price', p => p.price], ['Condition', p => p.condition], ['Brand', p => p.brand_name], ['Model', p => p.model_no], ['Year', p => p.mfg_year], ['Horsepower', p => p.horsepower], ['Engine', p => p.engine_capacity], ['Fuel', p => p.fuel_type], ['Capacity', p => p.operating_capacity], ['Weight', p => p.weight], ['Warranty', p => p.warranty], ['Vendor', p => p.vendor_name], ['Vendor rating', p => p.vendor_rating], ['Rating', p => p.rating], ['Daily rent', p => p.rent_daily]].map(([k, f]) => ({ label: k, values: ps.map(f) }));
  keys.forEach(k => rows.push({ label: k, values: ps.map(p => p.specs[k] ?? '—') }));
  return { products: ps, rows };
}
router.get('/compare', (req, res) => res.json(compareMatrix(db.all('SELECT product_id FROM compare_items WHERE user_id=?', req.user.id).map(r => r.product_id))));
router.post('/compare', wrap((req, res) => { if (db.one('SELECT COUNT(*) c FROM compare_items WHERE user_id=?', req.user.id).c >= 4) throw E.bad('You can compare up to 4 machines'); db.run('INSERT OR IGNORE INTO compare_items(user_id,product_id) VALUES(?,?)', req.user.id, +req.body.product_id); res.status(201).json({ ok: true }); }));
router.delete('/compare/:pid', (req, res) => { db.run('DELETE FROM compare_items WHERE user_id=? AND product_id=?', req.user.id, req.params.pid); res.json({ ok: true }); });
router.get('/recently-viewed', (req, res) => res.json({ items: db.all(`${PSELECT} JOIN recent_views rv ON rv.product_id=p.id AND rv.user_id=? ORDER BY rv.viewed_at DESC LIMIT 20`, req.user.id).map(p => shape(p)) }));

// ----- cart -----
const quote = req => svc.cartQuote(req.user, { coupon_code: req.query.coupon_code || req.body?.coupon_code, shipping_address_id: req.query.address_id || req.body?.shipping_address_id });
router.get('/cart', wrap((req, res) => res.json(quote(req))));
router.post('/cart/items', wrap((req, res) => {
  const b = v(req.body, { product_id: 'int|required', qty: 'int|min:1', with_installation: 'bool' });
  const p = db.one("SELECT * FROM products WHERE id=? AND status='approved' AND active=1", b.product_id); if (!p) throw E.notFound('Machine not available');
  if (!p.purchase_available) throw E.bad('This machine is available for rent only');
  const cur = db.one('SELECT qty FROM cart_items WHERE user_id=? AND product_id=?', req.user.id, p.id);
  const qty = Math.max(p.moq || 1, (cur?.qty || 0) + (b.qty || 1));
  if (qty > p.stock) throw E.bad(`Only ${p.stock} in stock`);
  db.run('INSERT INTO cart_items(user_id,product_id,qty,with_installation) VALUES(?,?,?,?) ON CONFLICT(user_id,product_id) DO UPDATE SET qty=excluded.qty', req.user.id, p.id, qty, b.with_installation === false ? 0 : 1);
  res.status(201).json(quote(req));
}));
router.patch('/cart/items/:pid', wrap((req, res) => {
  const b = v(req.body, { qty: 'int|min:0', with_installation: 'bool' });
  const p = db.one('SELECT * FROM products WHERE id=?', req.params.pid); if (!p) throw E.notFound();
  if (b.qty === 0) db.run('DELETE FROM cart_items WHERE user_id=? AND product_id=?', req.user.id, p.id);
  else {
    if (b.qty != null) { if (b.qty < (p.moq || 1)) throw E.bad(`Minimum order quantity is ${p.moq}`); if (b.qty > p.stock) throw E.bad(`Only ${p.stock} in stock`); db.run('UPDATE cart_items SET qty=? WHERE user_id=? AND product_id=?', b.qty, req.user.id, p.id); }
    if (b.with_installation != null) db.run('UPDATE cart_items SET with_installation=? WHERE user_id=? AND product_id=?', b.with_installation ? 1 : 0, req.user.id, p.id);
  }
  res.json(quote(req));
}));
router.delete('/cart/items/:pid', wrap((req, res) => { db.run('DELETE FROM cart_items WHERE user_id=? AND product_id=?', req.user.id, req.params.pid); res.json(quote(req)); }));
router.delete('/cart', (req, res) => { db.run('DELETE FROM cart_items WHERE user_id=?', req.user.id); res.json({ ok: true }); });
router.post('/cart/apply-coupon', wrap((req, res) => res.json(svc.cartQuote(req.user, { coupon_code: req.body.code, shipping_address_id: req.body.shipping_address_id }))));
router.get('/coupons', (req, res) => res.json({ items: db.all("SELECT code,description,type,value,min_order,max_discount,expires_at FROM coupons WHERE active=1 AND (customer_id IS NULL OR customer_id=?) AND (expires_at IS NULL OR expires_at > ?) AND (usage_limit IS NULL OR used_count < usage_limit)", req.user.id, new Date().toISOString()) }));

// ----- checkout -----
function addrOf(user, id) { const a = id && db.one('SELECT * FROM addresses WHERE id=? AND user_id=?', id, user.id); if (!a) throw E.bad('Select a valid address'); return a; }
router.post('/checkout', wrap((req, res) => {
  const b = v(req.body, { billing_address_id: 'int|required', shipping_address_id: 'int|required', gstin: 'gstin', coupon_code: 'string', payment_plan: 'enum|in:full,advance,partial', payment_method: 'string', notes: 'string|max:500' });
  const ship = addrOf(req.user, b.shipping_address_id), bill = addrOf(req.user, b.billing_address_id);
  const q = svc.cartQuote(req.user, { coupon_code: b.coupon_code, shipping_address_id: ship.id });
  if (!q.groups.length) throw E.bad('Your cart is empty');
  if (q.issues.length) throw E.bad('Some cart items need attention', q.issues);
  const coupon = b.coupon_code ? svc.loadCoupon(b.coupon_code, req.user.id) : null;
  const orderId = svc.createOrder(req.user, q, { billing: bill, shipping: ship, gstin: b.gstin || bill.gstin || req.user.gstin, coupon, payment_plan: b.payment_plan, payment_method: b.payment_method, notes: b.notes });
  db.run('DELETE FROM cart_items WHERE user_id=?', req.user.id);
  res.status(201).json(orderDetail(orderId, req.user));
}));

// ----- orders -----
function orderDetail(id, user) {
  const o = db.one('SELECT * FROM orders WHERE id=?', id); if (!o) throw E.notFound('Order not found');
  if (user.role === 'customer' && o.customer_id !== user.id) throw E.notFound('Order not found');
  o.billing_address = J(o.billing_address); o.shipping_address = J(o.shipping_address);
  o.sub_orders = db.all('SELECT s.*, v.business_name vendor_name, v.city vendor_city FROM sub_orders s JOIN vendors v ON v.id=s.vendor_id WHERE s.order_id=?', id).map(s => ({ ...s, dispatch_docs: J(s.dispatch_docs, []), items: db.all('SELECT i.*, p.images FROM order_items i LEFT JOIN products p ON p.id=i.product_id WHERE i.sub_order_id=?', s.id).map(i => ({ ...i, image: J(i.images, [])[0], images: undefined })) }));
  if (user.role === 'customer') o.sub_orders.forEach(s => { delete s.commission; delete s.commission_gst; delete s.gateway_fee; delete s.vendor_net; delete s.tcs; });
  o.events = db.all('SELECT * FROM order_events WHERE order_id=? ORDER BY id', id);
  o.payments = db.all('SELECT id,ref,provider,method,purpose,amount,status,gateway_payment_id,failure_reason,created_at FROM payments WHERE order_id=? ORDER BY id', id);
  o.invoices = db.all('SELECT id,invoice_no,type,total,status,created_at,sub_order_id FROM invoices WHERE order_id=? AND type<>\'commission\' ORDER BY id', id);
  o.requests = db.all('SELECT * FROM order_requests WHERE order_id=? ORDER BY id', id);
  o.refunds = db.all('SELECT * FROM refunds WHERE order_id=? ORDER BY id', id);
  o.balance_due = round2(o.grand_total - o.paid_amount);
  return o;
}
router.get('/orders', (req, res) => {
  const st = req.query.status; const params = [req.user.id]; let w = '';
  if (st) { w = ' AND status=?'; params.push(st); }
  res.json(pageResult(`SELECT o.*, (SELECT COUNT(*) FROM order_items i WHERE i.order_id=o.id) item_count, (SELECT p.images FROM order_items i JOIN products p ON p.id=i.product_id WHERE i.order_id=o.id LIMIT 1) images FROM orders o WHERE customer_id=?${w} ORDER BY id DESC`, params, req, o => ({ ...o, billing_address: undefined, shipping_address: J(o.shipping_address), image: J(o.images, [])[0], images: undefined })));
});
router.get('/orders/:id', wrap((req, res) => res.json(orderDetail(+req.params.id, req.user))));
router.post('/orders/:id/cancel', wrap((req, res) => {
  const o = orderDetail(+req.params.id, req.user);
  const subs = o.sub_orders.filter(s => !req.body.sub_order_id || s.id === +req.body.sub_order_id);
  const out = [];
  for (const s of subs) {
    if (['placed', 'accepted', 'processing', 'packed'].includes(s.status)) { svc.setSubStatus(db.one('SELECT * FROM sub_orders WHERE id=?', s.id), 'cancelled', req.user, 'Cancelled by customer: ' + (req.body.reason || '')); db.insert('order_requests', { order_id: o.id, sub_order_id: s.id, user_id: req.user.id, type: 'cancel', reason: req.body.reason, status: 'approved', resolution: 'auto-cancelled before dispatch' }); out.push({ sub_order_id: s.id, status: 'cancelled' }); }
    else if (!['cancelled', 'rejected'].includes(s.status)) { db.insert('order_requests', { order_id: o.id, sub_order_id: s.id, user_id: req.user.id, type: 'cancel', reason: req.body.reason, status: 'open' }); out.push({ sub_order_id: s.id, status: 'cancel_requested' }); notify(vendorUserId(s.vendor_id), 'cancel_request', 'Cancellation requested', s.sub_order_no); }
  }
  res.json({ results: out, order: orderDetail(o.id, req.user) });
}));
router.post('/orders/:id/requests', wrap((req, res) => {
  const o = orderDetail(+req.params.id, req.user);
  const b = v(req.body, { type: 'enum|required|in:return,refund,dispute,delivery_issue,cancel', sub_order_id: 'int|required', reason: 'string|required|max:1000', amount: 'number', attachments: 'json' });
  const s = o.sub_orders.find(x => x.id === b.sub_order_id); if (!s) throw E.bad('Invalid sub-order');
  if (b.type === 'return' && !['delivered', 'completed'].includes(s.status)) throw E.bad('Returns are allowed only after delivery');
  if (b.type === 'return') db.run("UPDATE sub_orders SET status='return_requested' WHERE id=?", s.id);
  const id = db.insert('order_requests', { order_id: o.id, sub_order_id: s.id, user_id: req.user.id, type: b.type, reason: b.reason, amount: b.amount, attachments: b.attachments || [] });
  db.insert('order_events', { order_id: o.id, sub_order_id: s.id, status: b.type + '_requested', note: b.reason, by_user: req.user.id });
  notify(vendorUserId(s.vendor_id), 'order_request', `${b.type.replace('_', ' ')} request`, `${s.sub_order_no}: ${b.reason}`, { request_id: id });
  require('../core').notifyAdmins('order_request', `New ${b.type} request`, `${s.sub_order_no}`, { request_id: id });
  res.status(201).json(db.one('SELECT * FROM order_requests WHERE id=?', id));
}));
router.post('/orders/:id/confirm-delivery', wrap((req, res) => {
  const o = orderDetail(+req.params.id, req.user);
  const s = o.sub_orders.find(x => x.id === +req.body.sub_order_id); if (!s) throw E.bad('Invalid sub-order');
  const sub = db.one('SELECT * FROM sub_orders WHERE id=?', s.id);
  if (['shipped', 'out_for_delivery'].includes(sub.status)) svc.setSubStatus(sub, 'delivered', req.user, 'Delivery confirmed by customer');
  else if (sub.status === 'delivered') svc.setSubStatus(sub, 'completed', req.user, 'Customer confirmed completion');
  else throw E.bad('Sub-order is not out for delivery');
  res.json(orderDetail(o.id, req.user));
}));
router.post('/orders/:id/reorder', wrap((req, res) => {
  const o = orderDetail(+req.params.id, req.user); let added = 0;
  for (const s of o.sub_orders) for (const i of s.items) { const p = db.one("SELECT * FROM products WHERE id=? AND status='approved' AND active=1 AND stock>=?", i.product_id, i.qty); if (p) { db.run('INSERT INTO cart_items(user_id,product_id,qty) VALUES(?,?,?) ON CONFLICT(user_id,product_id) DO UPDATE SET qty=excluded.qty', req.user.id, p.id, i.qty); added++; } }
  res.json({ added, cart: quote(req) });
}));

// ----- enquiries & quotations -----
router.post('/enquiries', wrap((req, res) => {
  const b = v(req.body, { product_id: 'int', category_id: 'int', vendor_ids: 'json', type: 'enum|in:quotation,enquiry,custom', title: 'string|required|max:200', requirements: 'string|max:4000', qty: 'int|min:1', specs: 'string|max:4000', location: 'string|max:300', expected_date: 'string', docs: 'json' });
  let vendors = Array.isArray(b.vendor_ids) ? b.vendor_ids.map(Number) : [];
  let category_id = b.category_id;
  if (b.product_id) { const p = db.one('SELECT vendor_id, category_id FROM products WHERE id=?', b.product_id); if (!p) throw E.notFound('Product not found'); if (!vendors.length) vendors = [p.vendor_id]; category_id ||= p.category_id; }
  if (!vendors.length && category_id) vendors = db.all("SELECT DISTINCT p.vendor_id FROM products p JOIN vendors v ON v.id=p.vendor_id WHERE (p.category_id=? OR p.subcategory_id=?) AND v.status='active' LIMIT 10", category_id, category_id).map(r => r.vendor_id);
  vendors = vendors.filter(id => db.one("SELECT id FROM vendors WHERE id=? AND status='active'", id));
  if (!vendors.length) throw E.bad('Select at least one vendor, product or category');
  const id = db.insert('enquiries', { enquiry_no: seqNo('ENQ'), customer_id: req.user.id, product_id: b.product_id, category_id, type: b.type || 'quotation', title: b.title, requirements: b.requirements, qty: b.qty || 1, specs: b.specs, location: b.location, expected_date: b.expected_date, docs: b.docs || [] });
  for (const vid of vendors) { db.run('INSERT OR IGNORE INTO enquiry_vendors(enquiry_id,vendor_id) VALUES(?,?)', id, vid); notify(vendorUserId(vid), 'enquiry_new', 'New enquiry', b.title, { enquiry_id: id }); }
  // also captured as CRM lead for admin
  db.insert('crm_leads', { owner_type: 'admin', name: req.user.name || 'Customer', company: req.user.business_name, mobile: req.user.mobile, email: req.user.email, gstin: req.user.gstin, source: 'enquiry', status: 'new', customer_id: req.user.id, enquiry_id: id, value: 0, kind: 'customer' });
  notify(req.user.id, 'enquiry_confirm', 'Enquiry submitted', `Your enquiry was sent to ${vendors.length} vendor(s).`, { enquiry_id: id });
  res.status(201).json(enquiryDetail(id, req.user));
}));
function enquiryDetail(id, user) {
  const e = db.one('SELECT e.*, p.name product_name FROM enquiries e LEFT JOIN products p ON p.id=e.product_id WHERE e.id=?', id); if (!e || (user.role === 'customer' && e.customer_id !== user.id)) throw E.notFound();
  e.docs = J(e.docs, []);
  e.vendors = db.all('SELECT ev.*, v.business_name, v.city, v.rating FROM enquiry_vendors ev JOIN vendors v ON v.id=ev.vendor_id WHERE ev.enquiry_id=?', id);
  e.quotations = db.all('SELECT q.*, v.business_name vendor_name, v.rating vendor_rating FROM quotations q JOIN vendors v ON v.id=q.vendor_id WHERE q.enquiry_id=? ORDER BY q.total', id).map(q => ({ ...q, items: J(q.items, []), expired: q.valid_until && q.valid_until < new Date().toISOString().slice(0, 10) }));
  return e;
}
router.get('/enquiries', (req, res) => res.json(pageResult(`SELECT e.*, (SELECT COUNT(*) FROM quotations q WHERE q.enquiry_id=e.id) quote_count FROM enquiries e WHERE customer_id=? ORDER BY id DESC`, [req.user.id], req)));
router.get('/enquiries/:id', wrap((req, res) => res.json(enquiryDetail(+req.params.id, req.user))));
router.post('/enquiries/:id/cancel', wrap((req, res) => { enquiryDetail(+req.params.id, req.user); db.run("UPDATE enquiries SET status='cancelled' WHERE id=?", req.params.id); res.json({ ok: true }); }));
const myQuote = (req) => { const q = db.one('SELECT * FROM quotations WHERE id=? AND customer_id=?', req.params.id, req.user.id); if (!q) throw E.notFound('Quotation not found'); return q; };
router.get('/quotations', (req, res) => res.json(pageResult(`SELECT q.*, v.business_name vendor_name, e.title enquiry_title FROM quotations q JOIN vendors v ON v.id=q.vendor_id LEFT JOIN enquiries e ON e.id=q.enquiry_id WHERE q.customer_id=? ORDER BY q.id DESC`, [req.user.id], req, q => ({ ...q, items: J(q.items, []) }))));
router.get('/quotations/:id', wrap((req, res) => { const q = myQuote(req); q.items = J(q.items, []); q.history = db.all('SELECT id,quote_no,version,total,status,customer_note,counter_price,created_at FROM quotations WHERE enquiry_id=? AND vendor_id=? ORDER BY version', q.enquiry_id, q.vendor_id); res.json(q); }));
router.post('/quotations/:id/accept', wrap((req, res) => {
  const q = myQuote(req);
  if (!['sent', 'revised'].includes(q.status)) throw E.bad('Quotation cannot be accepted in status ' + q.status);
  if (q.valid_until && q.valid_until < new Date().toISOString().slice(0, 10)) { db.run("UPDATE quotations SET status='expired' WHERE id=?", q.id); throw E.bad('Quotation has expired'); }
  db.run("UPDATE quotations SET status='accepted', updated_at=CURRENT_TIMESTAMP WHERE id=?", q.id);
  if (q.enquiry_id) db.run("UPDATE enquiries SET status='accepted' WHERE id=?", q.enquiry_id);
  notify(vendorUserId(q.vendor_id), 'quote_accepted', 'Quotation accepted', `${q.quote_no} was accepted by the customer`, { quotation_id: q.id });
  res.json(db.one('SELECT * FROM quotations WHERE id=?', q.id));
}));
router.post('/quotations/:id/reject', wrap((req, res) => { const q = myQuote(req); db.run("UPDATE quotations SET status='rejected', customer_note=? WHERE id=?", req.body.reason || null, q.id); notify(vendorUserId(q.vendor_id), 'quote_rejected', 'Quotation rejected', q.quote_no); res.json({ ok: true }); }));
router.post('/quotations/:id/revision', wrap((req, res) => {
  const q = myQuote(req); if (!['sent', 'revised'].includes(q.status)) throw E.bad('Cannot request revision now');
  const b = v(req.body, { note: 'string|required|max:1000', counter_price: 'number' });
  db.run("UPDATE quotations SET status=?, customer_note=?, counter_price=?, updated_at=CURRENT_TIMESTAMP WHERE id=?", b.counter_price ? 'negotiation' : 'revision_requested', b.note, b.counter_price || null, q.id);
  if (q.enquiry_id) db.run("UPDATE enquiries SET status='negotiating' WHERE id=?", q.enquiry_id);
  notify(vendorUserId(q.vendor_id), 'quote_revision', b.counter_price ? 'Price negotiation' : 'Revision requested', `${q.quote_no}: ${b.note}`, { quotation_id: q.id });
  res.json(db.one('SELECT * FROM quotations WHERE id=?', q.id));
}));
router.post('/quotations/:id/convert', wrap((req, res) => {
  const q = myQuote(req); if (q.status !== 'accepted') throw E.bad('Accept the quotation first');
  const b = v(req.body, { billing_address_id: 'int|required', shipping_address_id: 'int|required', payment_plan: 'enum|in:full,advance,partial', gstin: 'gstin' });
  const ship = addrOf(req.user, b.shipping_address_id), bill = addrOf(req.user, b.billing_address_id);
  const items = J(q.items, []);
  const totalGross = items.reduce((a, i) => a + i.unit_price * i.qty, 0) || 1;
  const lines = items.map(i => ({ product_id: i.product_id || null, name: i.name, hsn: i.hsn, qty: i.qty, unit_price: i.unit_price, gst_rate: i.gst_rate ?? 18, discount: round2((q.discount || 0) * (i.unit_price * i.qty) / totalGross), transport: round2((q.transport || 0) * (i.unit_price * i.qty) / totalGross), installation: round2((q.installation || 0) * (i.unit_price * i.qty) / totalGross) }));
  const priced = svc.priceGroups([{ vendor_id: q.vendor_id, lines }], ship.state_code, null);
  priced.place_of_supply = ship.state_code;
  const orderId = svc.createOrder(req.user, priced, { source: 'quotation', quotation_id: q.id, billing: bill, shipping: ship, gstin: b.gstin || req.user.gstin, payment_plan: b.payment_plan || 'full' });
  db.run("UPDATE quotations SET status='converted', order_id=? WHERE id=?", orderId, q.id);
  if (q.enquiry_id) db.run("UPDATE enquiries SET status='closed' WHERE id=?", q.enquiry_id);
  db.run("UPDATE crm_leads SET status='won', converted_at=CURRENT_TIMESTAMP, value=? WHERE enquiry_id=?", priced.grand_total, q.enquiry_id || -1);
  res.status(201).json(orderDetail(orderId, req.user));
}));

// ----- rentals -----
router.post('/rentals/quote', wrap((req, res) => {
  const b = v(req.body, { product_id: 'int|required', unit: 'enum|required|in:hour,day,week,month', duration: 'int|required|min:1', start_at: 'string|required', address_id: 'int' });
  const p = db.one("SELECT * FROM products WHERE id=? AND status='approved' AND rental_available=1", b.product_id); if (!p) throw E.notFound('Rental machine not found');
  const a = b.address_id ? addrOf(req.user, b.address_id) : null;
  const start = new Date(b.start_at); const end = new Date(start.getTime() + svc.UNIT_HOURS[b.unit] * b.duration * 3600000);
  res.json({ ...svc.priceRental(p, b.unit, b.duration, a?.state_code || req.user.state_code), start_at: start.toISOString(), end_at: end.toISOString(), availability: svc.rentalAvailability(p, start.toISOString(), end.toISOString()), advance_pct: db.setting('rental_advance_pct', 30) });
}));
router.post('/rentals', wrap((req, res) => {
  const b = v(req.body, { product_id: 'int|required', unit: 'enum|required|in:hour,day,week,month', duration: 'int|required|min:1', start_at: 'string|required', address_id: 'int', notes: 'string|max:1000' });
  const p = db.one("SELECT * FROM products WHERE id=? AND status='approved' AND rental_available=1", b.product_id); if (!p) throw E.notFound('Rental machine not found');
  const start = new Date(b.start_at); if (isNaN(start) || start < new Date(Date.now() - 3600000)) throw E.bad('Start must be a future date/time');
  const end = new Date(start.getTime() + svc.UNIT_HOURS[b.unit] * b.duration * 3600000);
  const av = svc.rentalAvailability(p, start.toISOString(), end.toISOString()); if (av.available < 1) throw E.conflict('Machine not available for selected dates');
  const a = b.address_id ? addrOf(req.user, b.address_id) : db.one('SELECT * FROM addresses WHERE user_id=? ORDER BY is_default DESC LIMIT 1', req.user.id);
  const pr = svc.priceRental(p, b.unit, b.duration, a?.state_code || req.user.state_code);
  const id = db.insert('rentals', { rental_no: seqNo('RNT'), customer_id: req.user.id, vendor_id: p.vendor_id, product_id: p.id, unit: b.unit, duration: b.duration, start_at: start.toISOString(), end_at: end.toISOString(), ...pr, advance_pct: db.setting('rental_advance_pct', 30), site_address: a ? svc.addrText(a) : null, notes: b.notes, status: 'requested' });
  notify(vendorUserId(p.vendor_id), 'rental_request', 'New rental request', `${p.name} for ${b.duration} ${b.unit}(s)`, { rental_id: id });
  res.status(201).json(rentalDetail(id, req.user));
}));
function rentalDetail(id, user) {
  const r = db.one('SELECT r.*, p.name product_name, p.images, v.business_name vendor_name FROM rentals r JOIN products p ON p.id=r.product_id JOIN vendors v ON v.id=r.vendor_id WHERE r.id=?', id);
  if (!r || (user.role === 'customer' && r.customer_id !== user.id) || (user.role === 'vendor' && r.vendor_id !== user.vendor?.id)) throw E.notFound();
  r.image = J(r.images, [])[0]; delete r.images; r.extension = J(r.extension, []);
  r.amount_due = svc.rentalOutstanding(r);
  r.advance_amount = round2(r.rent_amount * r.advance_pct / 100 + r.deposit);
  r.payments = db.all('SELECT id,ref,amount,purpose,status,created_at FROM payments WHERE rental_id=?', id);
  r.invoices = db.all('SELECT id,invoice_no,type,total,created_at FROM invoices WHERE rental_id=?', id);
  return r;
}
router.get('/rentals', (req, res) => res.json(pageResult(`SELECT r.*, p.name product_name, p.images FROM rentals r JOIN products p ON p.id=r.product_id WHERE r.customer_id=? ORDER BY r.id DESC`, [req.user.id], req, r => ({ ...r, image: J(r.images, [])[0], images: undefined }))));
router.get('/rentals/:id', wrap((req, res) => res.json(rentalDetail(+req.params.id, req.user))));
router.post('/rentals/:id/extend', wrap((req, res) => {
  const r = rentalDetail(+req.params.id, req.user); if (!['active', 'confirmed'].includes(r.status)) throw E.bad('Only active rentals can be extended');
  const dur = parseInt(req.body.duration); if (!(dur > 0)) throw E.bad('duration required');
  const p = db.one('SELECT * FROM products WHERE id=?', r.product_id);
  const newEnd = new Date(new Date(r.end_at).getTime() + svc.UNIT_HOURS[r.unit] * dur * 3600000).toISOString();
  const av = svc.rentalAvailability(p, r.end_at, newEnd, r.id); if (av.available < 1) throw E.conflict('Machine is booked after your rental; extension not possible');
  const amt = round2(r.rate * dur * (1 + r.gst_rate / 100));
  const ext = r.extension; ext.push({ duration: dur, amount: amt, new_end: newEnd, status: 'requested', at: new Date().toISOString() });
  db.update('rentals', r.id, { extension: ext, status: 'extension_requested' });
  notify(vendorUserId(r.vendor_id), 'rental_extension', 'Rental extension requested', `${r.rental_no}: +${dur} ${r.unit}(s)`, { rental_id: r.id });
  res.json(rentalDetail(r.id, req.user));
}));
router.post('/rentals/:id/cancel', wrap(async (req, res) => {
  const r = rentalDetail(+req.params.id, req.user); if (!['requested', 'approved', 'confirmed'].includes(r.status)) throw E.bad('Cannot cancel now');
  db.run("UPDATE rentals SET status='cancelled' WHERE id=?", r.id);
  if (r.paid_amount > 0) { const out = await svc.gatewayRefund(null, r.id, r.paid_amount); require('../core').post([{ account: 'platform:escrow', debit: r.paid_amount }, { account: 'gateway:clearing', credit: r.paid_amount }], 'rental', r.id, 'Rental cancel refund'); db.insert('refunds', { refund_no: rid('RF'), rental_id: r.id, amount: r.paid_amount, status: 'processed', reason: 'Rental cancelled', gateway_refund_id: out.map(o => o.id).join(',') }); db.run('UPDATE rentals SET paid_amount=0 WHERE id=?', r.id); }
  res.json(rentalDetail(r.id, req.user));
}));

module.exports = router; module.exports.orderDetail = orderDetail; module.exports.enquiryDetail = enquiryDetail; module.exports.rentalDetail = rentalDetail;
