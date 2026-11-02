const router = require('express').Router();
const bcrypt = require('bcryptjs');
const { db, E, wrap, J, v, auth, perm, pageResult, seqNo, rid, notify, audit, round2, post, ACC, balance, MODULES, publicUser, vendorUserId, gstSplit } = require('../core');
const svc = require('../services');
const providers = require('../providers');
const { toCsv } = require('./vendor');
const { orderDetail } = require('./customer');

router.use(auth('admin'));
const like = s => `%${s}%`;
function where(req, map) { const w = [], p = []; for (const [q, [sql, fn]] of Object.entries(map)) if (req.query[q] !== undefined && req.query[q] !== '') { w.push(sql); const val = fn ? fn(req.query[q]) : req.query[q]; Array.isArray(val) ? p.push(...val) : p.push(val); } return { w: w.length ? 'WHERE ' + w.join(' AND ') : '', p }; }

// generic CRUD for simple content tables
function crud(path, table, module, rules, opts = {}) {
  const key = opts.key || 'id';
  router.get(path, perm(module, 'read'), (req, res) => res.json(pageResult(`SELECT * FROM ${table} ORDER BY ${opts.order || key + ' DESC'}`, [], req, opts.map)));
  router.post(path, perm(module, 'write'), wrap((req, res) => { const b = v(req.body, rules); const id = db.insert(table, b); audit(req, `${table}.create`, table, id ?? b[key]); res.status(201).json(db.one(`SELECT * FROM ${table} WHERE ${key}=?`, key === 'id' ? id : b[key])); }));
  router.patch(path + '/:key', perm(module, 'write'), wrap((req, res) => { const r = db.one(`SELECT * FROM ${table} WHERE ${key}=?`, req.params.key); if (!r) throw E.notFound(); const b = v(req.body, Object.fromEntries(Object.entries(rules).map(([k, x]) => [k, x.replace('|required', '')]))); db.update(table, req.params.key, b, key); audit(req, `${table}.update`, table, req.params.key, Object.keys(b)); res.json(db.one(`SELECT * FROM ${table} WHERE ${key}=?`, req.params.key)); }));
  router.delete(path + '/:key', perm(module, 'write'), wrap((req, res) => { db.run(`DELETE FROM ${table} WHERE ${key}=?`, req.params.key); audit(req, `${table}.delete`, table, req.params.key); res.json({ ok: true }); }));
}

// ----- dashboard -----
router.get('/dashboard', (req, res) => {
  const n = sql => db.one(sql).c;
  res.json({
    counts: { customers: n("SELECT COUNT(*) c FROM users WHERE role='customer'"), vendors: n("SELECT COUNT(*) c FROM vendors WHERE status='active'"), vendors_pending: n("SELECT COUNT(*) c FROM vendors WHERE status='pending' OR kyc_status IN ('submitted','resubmitted')"), products: n("SELECT COUNT(*) c FROM products WHERE status='approved'"), products_pending: n("SELECT COUNT(*) c FROM products WHERE status='pending'"), orders: n('SELECT COUNT(*) c FROM orders'), orders_today: n("SELECT COUNT(*) c FROM orders WHERE date(created_at)=date('now')"), enquiries_open: n("SELECT COUNT(*) c FROM enquiries WHERE status IN ('open','quoted','negotiating')"), rentals_active: n("SELECT COUNT(*) c FROM rentals WHERE status IN ('confirmed','active')"), withdrawals_pending: n("SELECT COUNT(*) c FROM withdrawals WHERE status IN ('requested','approved','processing')"), refunds_open: n("SELECT COUNT(*) c FROM order_requests WHERE status IN ('open','vendor_approved','in_progress')"), tickets_open: n("SELECT COUNT(*) c FROM tickets WHERE status NOT IN ('closed','resolved')") },
    gmv: round2(db.one("SELECT COALESCE(SUM(grand_total),0) s FROM orders WHERE status NOT IN ('cancelled')").s),
    collected: round2(db.one("SELECT COALESCE(SUM(amount),0) s FROM payments WHERE status='success'").s),
    // ledger balance = credit − debit, so liability/income accounts are positive. Escrow = customer money received and not yet settled to sellers, refunded or taken as platform fee.
    commission: round2(Math.max(0, balance(ACC.commission))), gst_payable: round2(Math.max(0, balance(ACC.gst))), escrow: round2(Math.max(0, balance(ACC.escrow))),
    vendor_credited: round2(db.one("SELECT COALESCE(SUM(credit-debit),0) b FROM ledger_entries WHERE account LIKE 'vendor:%'").b + db.one("SELECT COALESCE(SUM(amount),0) s FROM withdrawals WHERE status='paid'").s),
    refunded: round2(db.one("SELECT COALESCE(SUM(amount),0) s FROM refunds WHERE status NOT IN ('pending','failed','rejected')").s),
    payouts_paid: round2(db.one("SELECT COALESCE(SUM(amount),0) s FROM withdrawals WHERE status='paid'").s),
    sales_by_day: db.all("SELECT date(created_at) d, date(created_at) day, ROUND(SUM(grand_total),2) total, COUNT(*) n, COUNT(*) orders FROM orders WHERE status!='cancelled' AND created_at >= date('now','-30 days') GROUP BY d ORDER BY d"),
    sales_by_category: db.all("SELECT c.name, ROUND(SUM(i.total),2) total FROM order_items i JOIN products p ON p.id=i.product_id JOIN categories c ON c.id=p.category_id GROUP BY c.id ORDER BY total DESC LIMIT 8"),
    top_vendors: db.all("SELECT v.id, v.business_name, ROUND(SUM(s.total),2) total, ROUND(SUM(s.total),2) sales, COUNT(*) orders FROM sub_orders s JOIN vendors v ON v.id=s.vendor_id WHERE s.status NOT IN ('cancelled','rejected') GROUP BY v.id ORDER BY total DESC LIMIT 5"),
    order_status: db.all('SELECT status, COUNT(*) n, COUNT(*) count FROM orders GROUP BY status'),
    recent_orders: db.all('SELECT o.id, o.order_no, o.grand_total, o.status, o.payment_status, o.created_at, u.name customer_name, u.name customer FROM orders o JOIN users u ON u.id=o.customer_id ORDER BY o.id DESC LIMIT 8'),
  });
});

// ----- customers -----
router.get('/customers', perm('customers', 'read'), (req, res) => { const f = where(req, { q: ["(u.name LIKE ? OR u.mobile LIKE ? OR u.email LIKE ? OR u.business_name LIKE ?)", q => [like(q), like(q), like(q), like(q)]], status: ['u.status=?'], account_type: ['u.account_type=?'], segment: ['u.segment=?'] }); res.json(pageResult(`SELECT u.id,u.name,u.mobile,u.email,u.account_type,u.business_name,u.gstin,u.status,u.segment,u.created_at,(SELECT COUNT(*) FROM orders o WHERE o.customer_id=u.id) orders,(SELECT COALESCE(SUM(grand_total),0) FROM orders o WHERE o.customer_id=u.id AND o.status!='cancelled') spend FROM users u ${f.w ? f.w + " AND u.role='customer'" : "WHERE u.role='customer'"} ORDER BY u.id DESC`, f.p, req)); });
router.get('/customers/:id', perm('customers', 'read'), wrap((req, res) => { const u = db.one("SELECT * FROM users WHERE id=? AND role='customer'", req.params.id); if (!u) throw E.notFound(); res.json({ user: publicUser(u), addresses: db.all('SELECT * FROM addresses WHERE user_id=?', u.id), orders: db.all('SELECT id,order_no,grand_total,status,payment_status,created_at FROM orders WHERE customer_id=? ORDER BY id DESC LIMIT 50', u.id), enquiries: db.all('SELECT id,enquiry_no,title,status,created_at FROM enquiries WHERE customer_id=? ORDER BY id DESC LIMIT 20', u.id), rentals: db.all('SELECT id,rental_no,status,total FROM rentals WHERE customer_id=? ORDER BY id DESC LIMIT 20', u.id), tickets: db.all('SELECT id,ticket_no,subject,status FROM tickets WHERE user_id=? ORDER BY id DESC LIMIT 20', u.id), logins: db.all('SELECT * FROM login_history WHERE user_id=? ORDER BY id DESC LIMIT 20', u.id) }); }));
router.patch('/customers/:id', perm('customers', 'write'), wrap((req, res) => { const b = v(req.body, { status: 'enum|in:active,blocked', segment: 'string|max:40', name: 'string|max:100', account_type: 'enum|in:individual,business' }); db.update('users', req.params.id, b); if (b.status === 'blocked') db.run('UPDATE sessions SET revoked=1 WHERE user_id=?', req.params.id); audit(req, 'customer.update', 'user', req.params.id, b); res.json(publicUser(db.one('SELECT * FROM users WHERE id=?', req.params.id))); }));
router.get('/customers.csv', perm('customers', 'read'), (req, res) => res.type('text/csv').attachment('customers.csv').send(toCsv(db.all("SELECT id,name,mobile,email,account_type,business_name,gstin,status,created_at FROM users WHERE role='customer'"))));

// ----- vendors / KYC -----
router.get('/vendors', perm('vendors', 'read'), (req, res) => { const f = where(req, { q: ['(v.business_name LIKE ? OR v.gstin LIKE ? OR v.city LIKE ?)', q => [like(q), like(q), like(q)]], status: ['v.status=?'], kyc_status: ['v.kyc_status=?'] }); res.json(pageResult(`SELECT v.*, u.name owner_name, u.mobile owner_mobile, (SELECT COUNT(*) FROM products p WHERE p.vendor_id=v.id) products, (SELECT COALESCE(SUM(total),0) FROM sub_orders s WHERE s.vendor_id=v.id AND s.status NOT IN ('cancelled','rejected')) sales FROM vendors v JOIN users u ON u.id=v.user_id ${f.w} ORDER BY v.id DESC`, f.p, req, x => { delete x.bank_account_no; return x; })); });
router.get('/vendors/:id', perm('vendors', 'read'), wrap((req, res) => { const vd = db.one('SELECT * FROM vendors WHERE id=?', req.params.id); if (!vd) throw E.notFound(); res.json({ vendor: vd, owner: publicUser(db.one('SELECT * FROM users WHERE id=?', vd.user_id)), docs: db.all('SELECT * FROM vendor_docs WHERE vendor_id=?', vd.id), wallet: svc.vendorWallet(vd.id), products: db.all('SELECT id,name,status,price,stock FROM products WHERE vendor_id=? ORDER BY id DESC LIMIT 50', vd.id), withdrawals: db.all('SELECT * FROM withdrawals WHERE vendor_id=? ORDER BY id DESC LIMIT 20', vd.id), commission_rules: db.all("SELECT * FROM commission_rules WHERE scope='vendor' AND scope_id=?", vd.id) }); }));
router.post('/vendors/:id/kyc', perm('vendors', 'approve'), wrap((req, res) => {
  const vd = db.one('SELECT * FROM vendors WHERE id=?', req.params.id); if (!vd) throw E.notFound();
  const b = v(req.body, { action: 'enum|required|in:approve,reject,correction', remarks: 'string|max:1000' });
  const upd = b.action === 'approve' ? { kyc_status: 'approved', status: 'active', gstin_verified: 1, pan_verified: 1 } : b.action === 'reject' ? { kyc_status: 'rejected', status: 'rejected' } : { kyc_status: 'correction' };
  db.update('vendors', vd.id, { ...upd, remarks: b.remarks }); if (b.action === 'approve') db.run("UPDATE vendor_docs SET status='verified' WHERE vendor_id=?", vd.id);
  audit(req, 'vendor.kyc_' + b.action, 'vendor', vd.id, b.remarks); notify(vd.user_id, 'vendor_kyc', `KYC ${upd.kyc_status}`, b.remarks || '', { vendor_id: vd.id });
  res.json(db.one('SELECT * FROM vendors WHERE id=?', vd.id));
}));
router.patch('/vendors/:id', perm('vendors', 'write'), wrap((req, res) => { const b = v(req.body, { status: 'enum|in:active,suspended,pending,rejected', featured: 'bool', commission_pct: 'number', min_withdrawal: 'number', bank_verified: 'bool', remarks: 'string|max:1000' }); db.update('vendors', req.params.id, b); audit(req, 'vendor.update', 'vendor', req.params.id, b); if (b.status === 'suspended') db.run("UPDATE products SET active=0 WHERE vendor_id=?", req.params.id); res.json(db.one('SELECT * FROM vendors WHERE id=?', req.params.id)); }));

// ----- catalog -----
crud('/categories', 'categories', 'catalog', { name: 'string|required|max:100', parent_id: 'int', slug: 'string|max:100', description: 'string|max:2000', image: 'string', icon: 'string', sort_order: 'int', active: 'bool', featured: 'bool', hsn: 'string|max:10', gst_rate: 'number' }, { order: 'parent_id, sort_order, id' });
crud('/brands', 'brands', 'catalog', { name: 'string|required|max:100', manufacturer: 'string|max:100', country: 'string|max:60', logo: 'string', active: 'bool' }, { order: 'name' });
crud('/attributes', 'attributes', 'catalog', { category_id: 'int', name: 'string|required|max:60', unit: 'string|max:20', input_type: 'enum|in:text,number,select,bool', filterable: 'bool' });
router.get('/products', perm('catalog', 'read'), (req, res) => { const f = where(req, { q: ['(p.name LIKE ? OR p.model_no LIKE ?)', q => [like(q), like(q)]], status: ['p.status=?'], vendor_id: ['p.vendor_id=?'], category_id: ['p.category_id=?'] }); res.json(pageResult(`SELECT p.id,p.name,p.model_no,p.price,p.stock,p.status,p.active,p.featured,p.promoted,p.rental_available,p.images,p.created_at,v.business_name vendor_name,c.name category_name FROM products p JOIN vendors v ON v.id=p.vendor_id LEFT JOIN categories c ON c.id=p.category_id ${f.w} ORDER BY p.status='pending' DESC, p.id DESC`, f.p, req, p => ({ ...p, image: J(p.images, [])[0], images: undefined }))); });
router.get('/products/:id', perm('catalog', 'read'), wrap((req, res) => { const p = db.one('SELECT p.*, v.business_name vendor_name FROM products p JOIN vendors v ON v.id=p.vendor_id WHERE p.id=?', req.params.id); if (!p) throw E.notFound(); res.json({ ...p, images: J(p.images, []), specs: J(p.specs, {}), approvals: db.all('SELECT * FROM product_approvals WHERE product_id=? ORDER BY id DESC', p.id) }); }));
router.post('/products/:id/review', perm('catalog', 'approve'), wrap((req, res) => {
  const p = db.one('SELECT * FROM products WHERE id=?', req.params.id); if (!p) throw E.notFound();
  const b = v(req.body, { action: 'enum|required|in:approve,reject,correction', remarks: 'string|max:1000' });
  const st = { approve: 'approved', reject: 'rejected', correction: 'correction' }[b.action];
  db.update('products', p.id, { status: st, reject_reason: b.action === 'approve' ? null : b.remarks });
  db.insert('product_approvals', { product_id: p.id, action: st, remarks: b.remarks, by_user: req.user.id }); audit(req, 'product.' + st, 'product', p.id, b.remarks);
  notify(vendorUserId(p.vendor_id), 'product_review', `Product ${st}`, `${p.name}${b.remarks ? ': ' + b.remarks : ''}`, { product_id: p.id });
  res.json({ id: p.id, status: st });
}));
router.patch('/products/:id', perm('catalog', 'write'), wrap((req, res) => { const b = v(req.body, { featured: 'bool', promoted: 'bool', active: 'bool', commission_pct: 'number', price: 'number', stock: 'int' }); db.update('products', req.params.id, b); audit(req, 'product.admin_update', 'product', req.params.id, b); res.json(db.one('SELECT id,featured,promoted,active,commission_pct,price,stock FROM products WHERE id=?', req.params.id)); }));
router.get('/reviews', perm('catalog', 'read'), (req, res) => res.json(pageResult('SELECT r.*, u.name user_name, p.name product_name FROM reviews r JOIN users u ON u.id=r.user_id LEFT JOIN products p ON p.id=r.product_id ORDER BY r.id DESC', [], req)));
router.patch('/reviews/:id', perm('catalog', 'write'), wrap((req, res) => { const b = v(req.body, { status: 'enum|required|in:published,hidden' }); db.update('reviews', req.params.id, b); res.json({ ok: true }); }));

// ----- orders -----
router.get('/orders', perm('orders', 'read'), (req, res) => { const f = where(req, { q: ['(o.order_no LIKE ? OR u.name LIKE ? OR u.mobile LIKE ?)', q => [like(q), like(q), like(q)]], status: ['o.status=?'], payment_status: ['o.payment_status=?'], from: ['o.created_at>=?'], to: ['o.created_at<=?', x => x + ' 23:59:59'] }); res.json(pageResult(`SELECT o.id,o.order_no,o.grand_total,o.paid_amount,o.status,o.payment_status,o.payment_plan,o.source,o.created_at,u.name customer_name,u.mobile customer_mobile,(SELECT GROUP_CONCAT(v.business_name,', ') FROM sub_orders s JOIN vendors v ON v.id=s.vendor_id WHERE s.order_id=o.id) vendors FROM orders o JOIN users u ON u.id=o.customer_id ${f.w} ORDER BY o.id DESC`, f.p, req)); });
router.get('/orders/:id', perm('orders', 'read'), wrap((req, res) => res.json(orderDetail(+req.params.id, req.user))));
router.post('/sub-orders/:id/status', perm('orders', 'write'), wrap((req, res) => { const s = db.one('SELECT * FROM sub_orders WHERE id=?', req.params.id); if (!s) throw E.notFound(); const b = v(req.body, { status: 'string|required', note: 'string|max:1000', force: 'bool', tracking_no: 'string', transporter: 'string' }); const extra = { force: b.force }; if (b.tracking_no) extra.tracking_no = b.tracking_no; if (b.transporter) extra.transporter = b.transporter; const out = svc.setSubStatus(s, b.status, { ...req.user, role: 'admin' }, b.note || `Admin set ${b.status}`, extra); audit(req, 'suborder.status', 'sub_order', s.id, { from: s.status, to: b.status }); res.json(out); }));
router.patch('/orders/:id', perm('orders', 'write'), wrap((req, res) => { const b = v(req.body, { manager_id: 'int', notes: 'string|max:2000' }); db.update('orders', req.params.id, b); res.json({ ok: true }); }));
router.get('/enquiries', perm('orders', 'read'), (req, res) => res.json(pageResult('SELECT e.*, u.name customer_name, (SELECT COUNT(*) FROM quotations q WHERE q.enquiry_id=e.id) quotes FROM enquiries e JOIN users u ON u.id=e.customer_id ORDER BY e.id DESC', [], req)));
router.get('/quotations', perm('orders', 'read'), (req, res) => res.json(pageResult('SELECT q.id,q.quote_no,q.version,q.total,q.status,q.valid_until,q.created_at,v.business_name vendor_name,u.name customer_name FROM quotations q JOIN vendors v ON v.id=q.vendor_id JOIN users u ON u.id=q.customer_id ORDER BY q.id DESC', [], req)));
router.get('/rentals', perm('orders', 'read'), (req, res) => res.json(pageResult('SELECT r.*, p.name product_name, v.business_name vendor_name, u.name customer_name FROM rentals r JOIN products p ON p.id=r.product_id JOIN vendors v ON v.id=r.vendor_id JOIN users u ON u.id=r.customer_id ORDER BY r.id DESC', [], req)));

// ----- commission -----
crud('/commission-rules', 'commission_rules', 'commission', { scope: 'enum|required|in:global,category,vendor,product', scope_id: 'int', txn_type: 'enum|in:purchase,rental', mode: 'enum|in:percent,fixed', value: 'number|required|min:0', active: 'bool' });
router.get('/commissions', perm('commission', 'read'), (req, res) => res.json(pageResult('SELECT c.*, v.business_name vendor_name FROM commissions c JOIN vendors v ON v.id=c.vendor_id ORDER BY c.id DESC', [], req)));

// ----- payments -----
router.get('/payments', perm('payments', 'read'), (req, res) => { const f = where(req, { status: ['p.status=?'], provider: ['p.provider=?'], q: ['(p.ref LIKE ? OR p.gateway_payment_id LIKE ?)', q => [like(q), like(q)]] }); res.json(pageResult(`SELECT p.id,p.ref,p.order_id,p.rental_id,p.provider,p.method,p.purpose,p.amount,p.status,p.gateway_payment_id,p.failure_reason,p.manual,p.created_at,u.name user_name FROM payments p LEFT JOIN users u ON u.id=p.user_id ${f.w} ORDER BY p.id DESC`, f.p, req)); });
router.post('/payments/manual', perm('payments', 'approve'), wrap(async (req, res) => {
  const b = v(req.body, { order_id: 'int', rental_id: 'int', amount: 'number|required|min:1', method: 'enum|required|in:bank_transfer,cheque,cash,upi,neft,rtgs', reference: 'string|required|max:80', note: 'string|max:500' });
  const tgt = b.order_id ? db.one('SELECT * FROM orders WHERE id=?', b.order_id) : db.one('SELECT * FROM rentals WHERE id=?', b.rental_id); if (!tgt) throw E.notFound('order_id or rental_id required');
  const pid = db.insert('payments', { ref: rid('PAY'), user_id: tgt.customer_id, order_id: b.order_id, rental_id: b.rental_id, provider: 'manual', method: b.method, purpose: 'partial', amount: round2(b.amount), status: 'created', gateway_payment_id: 'MAN-' + b.reference, manual: 1, authorized_by: req.user.id, raw: { note: b.note } });
  svc.markPaid(db.one('SELECT * FROM payments WHERE id=?', pid), 'MAN-' + b.reference, null);
  audit(req, 'payment.manual', 'payment', pid, b); res.status(201).json(db.one('SELECT * FROM payments WHERE id=?', pid));
}));
router.get('/ledger', perm('payments', 'read'), (req, res) => { if (req.query.account) return res.json(pageResult('SELECT * FROM ledger_entries WHERE account=? ORDER BY id DESC', [req.query.account], req)); res.json({ balances: db.all('SELECT account, ROUND(SUM(debit),2) debit, ROUND(SUM(credit),2) credit, ROUND(SUM(debit-credit),2) balance FROM ledger_entries GROUP BY account ORDER BY account'), trial_balance_ok: Math.abs(db.one('SELECT COALESCE(SUM(debit-credit),0) s FROM ledger_entries').s) < 0.05 }); });
router.get('/webhooks', perm('payments', 'read'), (req, res) => res.json(pageResult('SELECT id,provider,event_id,event_type,verified,processed,created_at FROM webhook_events ORDER BY id DESC', [], req)));

// ----- withdrawals / payouts -----
router.get('/withdrawals', perm('withdrawals', 'read'), (req, res) => { const f = where(req, { status: ['w.status=?'], vendor_id: ['w.vendor_id=?'] }); res.json(pageResult(`SELECT w.*, v.business_name vendor_name FROM withdrawals w JOIN vendors v ON v.id=w.vendor_id ${f.w} ORDER BY w.id DESC`, f.p, req, w => ({ ...w, bank: J(w.bank, {}) }))); });
router.post('/withdrawals/:id/action', perm('withdrawals', 'approve'), wrap(async (req, res) => {
  const w = db.one('SELECT * FROM withdrawals WHERE id=?', req.params.id); if (!w) throw E.notFound();
  const b = v(req.body, { action: 'enum|required|in:approve,reject,pay,mark_paid,fail', reason: 'string|max:500', utr: 'string|max:40', proof_url: 'string', provider: 'enum|in:mock,razorpayx,cashfree_payouts,manual' });
  const need = (...s) => { if (!s.includes(w.status)) throw E.bad(`Withdrawal is ${w.status}`); };
  const paid = (extra) => db.transaction(() => { post([{ account: ACC.hold(w.vendor_id), debit: w.amount }, { account: ACC.bank, credit: w.net }, ...(w.fee ? [{ account: ACC.platformFee, credit: w.fee }] : [])], 'withdrawal', w.id, 'Payout ' + w.withdrawal_no); db.update('withdrawals', w.id, { status: 'paid', processed_by: req.user.id, updated_at: new Date().toISOString(), ...extra }); svc.issueInvoice({ type: 'settlement', withdrawal_id: w.id, user_id: req.user.id }); })();
  const reverse = (status) => db.transaction(() => { post([{ account: ACC.hold(w.vendor_id), debit: w.amount }, { account: ACC.avail(w.vendor_id), credit: w.amount }], 'withdrawal', w.id, `Withdrawal ${status}`); db.update('withdrawals', w.id, { status, reason: b.reason, processed_by: req.user.id }); })();
  if (b.action === 'approve') { need('requested'); db.update('withdrawals', w.id, { status: 'approved', processed_by: req.user.id }); }
  else if (b.action === 'reject') { need('requested', 'approved'); reverse('rejected'); }
  else if (b.action === 'fail') { need('processing'); reverse('failed'); }
  else if (b.action === 'pay') {
    need('requested', 'approved'); const vd = db.one('SELECT * FROM vendors WHERE id=?', w.vendor_id);
    const r = await providers.payouts.send(b.provider || 'mock', w, J(w.bank, {}));
    if (r.status === 'paid') paid({ payout_provider: r.provider, payout_ref: r.payout_ref, utr: r.utr });
    else db.update('withdrawals', w.id, { status: r.status === 'manual' ? 'approved' : 'processing', payout_provider: r.provider, payout_ref: r.payout_ref });
  } else if (b.action === 'mark_paid') { need('approved', 'processing'); if (!b.utr) throw E.bad('UTR required'); paid({ utr: b.utr, proof_url: b.proof_url, payout_provider: w.payout_provider || 'manual' }); }
  const nw = db.one('SELECT * FROM withdrawals WHERE id=?', w.id);
  audit(req, 'withdrawal.' + b.action, 'withdrawal', w.id, b); notify(vendorUserId(w.vendor_id), 'withdrawal', `Withdrawal ${nw.status}`, `${w.withdrawal_no}: ₹${w.amount}${nw.utr ? ' UTR ' + nw.utr : ''}`, { withdrawal_id: w.id });
  res.json(nw);
}));

// ----- invoices -----
router.get('/invoices', perm('invoices', 'read'), (req, res) => { const f = where(req, { type: ['type=?'], q: ['invoice_no LIKE ?', like], vendor_id: ['vendor_id=?'], status: ['status=?'] }); res.json(pageResult(`SELECT id,invoice_no,type,order_id,sub_order_id,rental_id,vendor_id,customer_id,total,status,irn,ewaybill_no,created_at FROM invoices ${f.w} ORDER BY id DESC`, f.p, req)); });
router.post('/invoices', perm('invoices', 'write'), wrap((req, res) => {
  const b = v(req.body, { type: 'enum|required|in:manual,credit_note,debit_note', ref_invoice_id: 'int', sub_order_id: 'int', amount: 'number|min:0', buyer: 'json', buyer_gstin: 'string', items: 'json', notes: 'string|max:1000', place_of_supply: 'string' });
  if (b.type !== 'manual') { const ref = b.ref_invoice_id && db.one('SELECT sub_order_id FROM invoices WHERE id=?', b.ref_invoice_id); const sid = b.sub_order_id || ref?.sub_order_id; if (!sid || !b.amount) throw E.bad('sub_order_id (or ref_invoice_id of a tax invoice) and amount required'); return res.status(201).json(svc.issueInvoice({ type: b.type, sub_order_id: sid, amount: b.amount, reason: b.notes, user_id: req.user.id })); }
  if (!Array.isArray(b.items) || !b.items.length) throw E.bad('items required');
  const co = require('../core').COMPANY(); const pos = b.place_of_supply || co.state_code;
  const items = b.items.map(i => { const qty = +i.qty || 1, up = +i.unit_price || 0, rate = i.gst_rate ?? 18, taxable = round2(qty * up); return { name: i.name, hsn: i.hsn, qty, unit_price: up, gst_rate: rate, taxable, ...gstSplit(taxable, rate, co.state_code, pos) }; });
  const sum = k => round2(items.reduce((a, i) => a + (i[k] || 0), 0));
  const data = { type: 'tax', _prefix: 'MMMI', seller: { name: co.name, gstin: co.gstin, address: co.address, state_code: co.state_code }, seller_gstin: co.gstin, buyer: b.buyer || {}, buyer_gstin: b.buyer_gstin, place_of_supply: pos, items, taxable: sum('taxable'), cgst: sum('cgst'), sgst: sum('sgst'), igst: sum('igst'), notes: b.notes };
  data.total = round2(data.taxable + data.cgst + data.sgst + data.igst);
  const inv = svc.issueInvoice({ type: 'manual', data, user_id: req.user.id }); audit(req, 'invoice.manual', 'invoice', inv.id); res.status(201).json(inv);
}));
router.post('/invoices/:id/cancel', perm('invoices', 'approve'), wrap((req, res) => { const i = db.one('SELECT * FROM invoices WHERE id=?', req.params.id); if (!i) throw E.notFound(); if (i.status === 'cancelled') throw E.bad('Already cancelled'); const b = v(req.body, { reason: 'string|required|max:500' }); db.update('invoices', i.id, { status: 'cancelled', cancel_reason: b.reason }); audit(req, 'invoice.cancel', 'invoice', i.id, b.reason); res.json({ ok: true }); }));

// ----- refunds / requests / disputes -----
router.get('/requests', perm('refunds', 'read'), (req, res) => { const f = where(req, { status: ['r.status=?'], type: ['r.type=?'] }); res.json(pageResult(`SELECT r.*, s.sub_order_no, s.total sub_total, v.business_name vendor_name, u.name customer_name FROM order_requests r LEFT JOIN sub_orders s ON s.id=r.sub_order_id LEFT JOIN vendors v ON v.id=s.vendor_id JOIN users u ON u.id=r.user_id ${f.w} ORDER BY r.id DESC`, f.p, req)); });
router.post('/requests/:id/resolve', perm('refunds', 'approve'), wrap(async (req, res) => {
  const r = db.one('SELECT * FROM order_requests WHERE id=?', req.params.id); if (!r) throw E.notFound();
  const b = v(req.body, { action: 'enum|required|in:refund,reject,resolve,cancel', amount: 'number|min:0', note: 'string|max:1000' });
  let subId = r.sub_order_id || db.one('SELECT id FROM sub_orders WHERE order_id=? LIMIT 1', r.order_id)?.id;
  let refund;
  if (b.action === 'refund') refund = await svc.processRefund({ sub_order_id: subId, amount: b.amount, reason: b.note || r.reason || r.type, request_id: r.id, user: req.user });
  if (b.action === 'cancel') { const s = db.one('SELECT * FROM sub_orders WHERE id=?', subId); svc.setSubStatus(s, 'cancelled', { ...req.user, role: 'admin' }, b.note || 'Cancelled by admin', { force: true }); }
  const st = { refund: 'refunded', reject: 'rejected', resolve: 'resolved', cancel: 'approved' }[b.action];
  db.run('UPDATE order_requests SET status=?, resolution=?, resolved_by=?, updated_at=CURRENT_TIMESTAMP WHERE id=?', st, b.note || null, req.user.id, r.id);
  notify(r.user_id, 'request_update', `Your ${r.type} request: ${st}`, b.note || '', { order_id: r.order_id });
  audit(req, 'request.' + b.action, 'order_request', r.id, b);
  res.json({ request: db.one('SELECT * FROM order_requests WHERE id=?', r.id), refund });
}));
router.get('/refunds', perm('refunds', 'read'), (req, res) => res.json(pageResult('SELECT * FROM refunds ORDER BY id DESC', [], req)));
router.post('/refunds', perm('refunds', 'approve'), wrap(async (req, res) => { const b = v(req.body, { sub_order_id: 'int|required', amount: 'number|min:1', reason: 'string|required|max:500' }); res.status(201).json(await svc.processRefund({ ...b, user: req.user })); }));

// ----- coupons / marketing / CMS -----
crud('/coupons', 'coupons', 'coupons', { code: 'string|required|max:30', description: 'string|max:300', type: 'enum|required|in:percent,flat,free_shipping', value: 'number|required|min:0', min_order: 'number|min:0', max_discount: 'number', starts_at: 'string', expires_at: 'string', usage_limit: 'int', per_user_limit: 'int', customer_id: 'int', vendor_id: 'int', category_id: 'int', active: 'bool', campaign: 'string|max:60' });
crud('/banners', 'banners', 'cms', { title: 'string|required|max:120', subtitle: 'string|max:200', image: 'string', link: 'string|max:300', placement: 'string|max:30', sort_order: 'int', active: 'bool', campaign: 'string', starts_at: 'string', ends_at: 'string' }, { order: 'sort_order, id' });
crud('/cms', 'cms_pages', 'cms', { slug: 'string|required|max:60', title: 'string|required|max:160', content: 'string|max:100000', meta_title: 'string|max:160', meta_description: 'string|max:300', active: 'bool' }, { key: 'slug', order: 'slug' });
crud('/faqs', 'faqs', 'cms', { question: 'string|required|max:300', answer: 'string|required|max:5000', category: 'string|max:40', sort_order: 'int', active: 'bool' }, { order: 'category, sort_order' });
crud('/announcements', 'announcements', 'cms', { title: 'string|required|max:160', body: 'string|max:3000', audience: 'enum|in:all,customers,vendors', active: 'bool' });
router.post('/broadcast', perm('cms', 'write'), wrap((req, res) => {
  const b = v(req.body, { audience: 'enum|required|in:all,customers,vendors,segment', segment: 'string', title: 'string|required|max:120', body: 'string|required|max:1000' });
  const users = db.all(b.audience === 'customers' ? "SELECT id FROM users WHERE role='customer' AND status='active'" : b.audience === 'vendors' ? "SELECT id FROM users WHERE role='vendor' AND status='active'" : b.audience === 'segment' ? "SELECT id FROM users WHERE segment=? AND status='active'" : "SELECT id FROM users WHERE role IN ('customer','vendor') AND status='active'", ...(b.audience === 'segment' ? [b.segment] : []));
  users.forEach(u => notify(u.id, 'broadcast', b.title, b.body, {})); audit(req, 'broadcast', 'notification', null, { ...b, n: users.length });
  res.json({ sent: users.length });
}));

// ----- support / moderation -----
router.get('/tickets', perm('support', 'read'), (req, res) => { const f = where(req, { status: ['t.status=?'], priority: ['t.priority=?'] }); res.json(pageResult(`SELECT t.*, u.name user_name, u.role user_role FROM tickets t JOIN users u ON u.id=t.user_id ${f.w} ORDER BY t.id DESC`, f.p, req)); });
router.patch('/tickets/:id', perm('support', 'write'), wrap((req, res) => { const b = v(req.body, { status: 'enum|in:open,in_progress,waiting,resolved,closed', priority: 'enum|in:low,normal,high,urgent', assigned_to: 'int' }); db.update('tickets', req.params.id, { ...b, updated_at: new Date().toISOString() }); const t = db.one('SELECT * FROM tickets WHERE id=?', req.params.id); if (b.status) notify(t.user_id, 'ticket', `Ticket ${t.ticket_no} ${b.status}`, t.subject, { ticket_id: t.id }); res.json(t); }));
router.get('/abuse-reports', perm('support', 'read'), (req, res) => res.json(pageResult('SELECT a.*, u.name user_name FROM abuse_reports a LEFT JOIN users u ON u.id=a.user_id ORDER BY a.id DESC', [], req)));
router.patch('/abuse-reports/:id', perm('support', 'write'), wrap((req, res) => { const b = v(req.body, { status: 'enum|required|in:open,actioned,dismissed' }); db.update('abuse_reports', req.params.id, b); res.json({ ok: true }); }));
router.get('/feedback', perm('support', 'read'), (req, res) => res.json(pageResult('SELECT f.*, u.name user_name FROM feedback f LEFT JOIN users u ON u.id=f.user_id ORDER BY f.id DESC', [], req)));

// ----- reports -----
router.get('/reports/:kind', perm('reports', 'read'), wrap((req, res) => {
  const from = req.query.from || '2000-01-01', to = (req.query.to || '2999-12-31') + ' 23:59:59';
  const Q = {
    sales: ['SELECT o.order_no, date(o.created_at) date, u.name customer, o.subtotal, o.discount, o.tax_total, o.grand_total, o.paid_amount, o.status, o.payment_status FROM orders o JOIN users u ON u.id=o.customer_id WHERE o.created_at BETWEEN ? AND ? ORDER BY o.id', [from, to]],
    vendors: ["SELECT v.id, v.business_name, v.city, COUNT(s.id) orders, ROUND(COALESCE(SUM(s.total),0),2) sales, ROUND(COALESCE(SUM(s.commission),0),2) commission FROM vendors v LEFT JOIN sub_orders s ON s.vendor_id=v.id AND s.status NOT IN ('cancelled','rejected') AND s.created_at BETWEEN ? AND ? GROUP BY v.id ORDER BY sales DESC", [from, to]],
    products: ['SELECT p.id, p.name, v.business_name vendor, p.views, p.sold, p.stock, p.rating FROM products p JOIN vendors v ON v.id=p.vendor_id ORDER BY p.sold DESC, p.views DESC', []],
    gst: ["SELECT invoice_no, type, date(created_at) date, seller_gstin, buyer_gstin, place_of_supply, taxable, cgst, sgst, igst, total, status FROM invoices WHERE type IN ('tax','rental','commission','credit_note','debit_note','manual') AND created_at BETWEEN ? AND ? ORDER BY id", [from, to]],
    commission: ['SELECT c.id, date(c.created_at) date, v.business_name vendor, c.basis, c.rate, c.amount, c.gst, c.reversed FROM commissions c JOIN vendors v ON v.id=c.vendor_id WHERE c.created_at BETWEEN ? AND ?', [from, to]],
    payments: ['SELECT ref, date(created_at) date, provider, method, purpose, amount, status FROM payments WHERE created_at BETWEEN ? AND ?', [from, to]],
    payouts: ['SELECT w.withdrawal_no, date(w.created_at) date, v.business_name vendor, w.amount, w.fee, w.net, w.status, w.utr FROM withdrawals w JOIN vendors v ON v.id=w.vendor_id WHERE w.created_at BETWEEN ? AND ?', [from, to]],
    refunds: ['SELECT refund_no, date(created_at) date, order_id, sub_order_id, rental_id, amount, status, reason FROM refunds WHERE created_at BETWEEN ? AND ?', [from, to]],
    rentals: ['SELECT r.rental_no, p.name, v.business_name vendor, r.start_at, r.end_at, r.total, r.paid_amount, r.status FROM rentals r JOIN products p ON p.id=r.product_id JOIN vendors v ON v.id=r.vendor_id WHERE r.created_at BETWEEN ? AND ?', [from, to]],
    customers: ["SELECT u.id, u.name, u.account_type, u.business_name, COUNT(o.id) orders, ROUND(COALESCE(SUM(o.grand_total),0),2) spend FROM users u LEFT JOIN orders o ON o.customer_id=u.id AND o.status!='cancelled' WHERE u.role='customer' GROUP BY u.id ORDER BY spend DESC", []],
    crm: ['SELECT status, COUNT(*) leads, ROUND(SUM(value),2) value FROM crm_leads GROUP BY status', []],
  };
  const q = Q[req.params.kind]; if (!q) throw E.notFound('Unknown report');
  const rows = db.all(q[0], ...q[1]);
  if (req.query.format === 'csv') return res.type('text/csv').attachment(`${req.params.kind}.csv`).send(toCsv(rows));
  res.json({ kind: req.params.kind, rows });
}));

// ----- staff & roles -----
router.get('/roles', perm('staff', 'read'), (req, res) => res.json({ modules: MODULES, levels: ['none', 'read', 'write', 'approve'], items: db.all('SELECT * FROM staff_roles ORDER BY id').map(r => ({ ...r, permissions: J(r.permissions, {}) })) }));
router.post('/roles', perm('staff', 'approve'), wrap((req, res) => { const b = v(req.body, { name: 'string|required|max:60', permissions: 'json|required' }); const id = db.insert('staff_roles', b); audit(req, 'role.create', 'staff_role', id, b); res.status(201).json(db.one('SELECT * FROM staff_roles WHERE id=?', id)); }));
router.patch('/roles/:id', perm('staff', 'approve'), wrap((req, res) => { const b = v(req.body, { name: 'string|max:60', permissions: 'json' }); db.update('staff_roles', req.params.id, b); audit(req, 'role.update', 'staff_role', req.params.id, b); res.json({ ok: true }); }));
router.get('/staff', perm('staff', 'read'), (req, res) => res.json({ items: db.all("SELECT u.id,u.name,u.email,u.mobile,u.role,u.status,u.staff_role_id,r.name role_name,u.created_at FROM users u LEFT JOIN staff_roles r ON r.id=u.staff_role_id WHERE u.role IN ('admin','staff') ORDER BY u.id") }));
router.post('/staff', perm('staff', 'approve'), wrap((req, res) => { const b = v(req.body, { name: 'string|required', email: 'email|required', mobile: 'mobile', password: 'string|required', staff_role_id: 'int|required' }); if (b.password.length < 8) throw E.bad('Password min 8 chars'); if (db.one('SELECT id FROM users WHERE email=?', b.email)) throw E.conflict('Email exists'); const id = db.insert('users', { role: 'staff', name: b.name, email: b.email, mobile: b.mobile, password_hash: bcrypt.hashSync(b.password, 10), staff_role_id: b.staff_role_id, email_verified: 1, created_by: req.user.id }); audit(req, 'staff.create', 'user', id); res.status(201).json({ id }); }));
router.patch('/staff/:id', perm('staff', 'approve'), wrap((req, res) => { const b = v(req.body, { staff_role_id: 'int', status: 'enum|in:active,blocked', name: 'string' }); const u = db.one("SELECT * FROM users WHERE id=? AND role='staff'", req.params.id); if (!u) throw E.notFound(); db.update('users', u.id, b); if (b.status === 'blocked') db.run('UPDATE sessions SET revoked=1 WHERE user_id=?', u.id); audit(req, 'staff.update', 'user', u.id, b); res.json({ ok: true }); }));
router.get('/audit-logs', perm('staff', 'read'), (req, res) => { const f = where(req, { entity: ['a.entity=?'], user_id: ['a.user_id=?'], action: ['a.action LIKE ?', like] }); res.json(pageResult(`SELECT a.*, u.name user_name FROM audit_logs a LEFT JOIN users u ON u.id=a.user_id ${f.w} ORDER BY a.id DESC`, f.p, req)); });
router.get('/login-history', perm('staff', 'read'), (req, res) => res.json(pageResult('SELECT l.*, u.name user_name, u.role FROM login_history l LEFT JOIN users u ON u.id=l.user_id ORDER BY l.id DESC', [], req)));
router.get('/outbox', perm('settings', 'read'), (req, res) => res.json(pageResult('SELECT * FROM outbox ORDER BY id DESC', [], req)));

// ----- settings -----
router.get('/settings', perm('settings', 'read'), (req, res) => res.json(Object.fromEntries(db.all('SELECT * FROM settings').map(s => [s.key, J(s.value, s.value)]))));
router.patch('/settings', perm('settings', 'approve'), wrap((req, res) => { const allowed = ['company', 'gateway_fee_pct', 'tcs_pct', 'tds_pct', 'platform_fee', 'advance_pct', 'rental_advance_pct', 'min_withdrawal', 'withdrawal_fee', 'einvoice_enabled', 'invoice_prefixes', 'payment_providers', 'support', 'maintenance', 'cod_enabled', 'default_commission']; const out = {}; for (const [k, val] of Object.entries(req.body || {})) { if (!allowed.includes(k)) throw E.bad('Unknown setting ' + k); db.setSetting(k, val); out[k] = val; } audit(req, 'settings.update', 'settings', null, out); res.json({ ok: true, updated: Object.keys(out) }); }));
router.get('/providers', perm('settings', 'read'), (req, res) => res.json(providers.status ? providers.status() : {}));

router.use('/crm', perm('crm', 'read'), require('./crm')('admin'));
// ===== Admin product management (create/edit/delete/import) =====
const VP = require('./vendor');
function houseVendor() {
  let v = db.one("SELECT v.* FROM vendors v JOIN users u ON u.id=v.user_id WHERE u.email='direct@mohanmishra.in'"); if (v) return v;
  const co = require('../core').COMPANY();
  const uid = db.insert('users', { name: 'Mohan Mishra Direct', email: 'direct@mohanmishra.in', role: 'vendor', status: 'active', password_hash: bcrypt.hashSync(rid('pw'), 10) });
  const vid = db.insert('vendors', { user_id: uid, business_name: 'Mohan Mishra Direct', business_type: 'private_limited', gstin: co.gstin, pan: co.pan, address: co.address, city: 'Mumbai', state: co.state || 'Maharashtra', state_code: co.state_code || '27', kyc_status: 'approved', status: 'active', agreement_accepted: 1, commission_agreement_accepted: 1, commission_pct: 0, description: 'Platform-owned machinery listings' });
  return db.one('SELECT * FROM vendors WHERE id=?', vid);
}
const ADMIN_PRULES = { ...VP.PRULES, vendor_id: 'int', featured: 'bool', promoted: 'bool', status: 'enum|in:pending,approved,rejected,correction,archived', reject_reason: 'string|max:1000', commission_pct: 'number' };
function adminProductValidate(b, creating) {
  const errs = [];
  if (creating && !b.name) errs.push({ field: 'name', message: 'Machine name is required' });
  if (b.price != null && b.price < 0) errs.push({ field: 'price', message: 'Price cannot be negative' });
  if (b.mfg_year && (b.mfg_year < 1950 || b.mfg_year > new Date().getFullYear() + 1)) errs.push({ field: 'mfg_year', message: 'Manufacturing year looks wrong' });
  if (b.hsn && !/^\d{4,8}$/.test(b.hsn)) errs.push({ field: 'hsn', message: 'HSN must be 4–8 digits' });
  if (b.condition === 'new' && b.operating_hours) errs.push({ field: 'operating_hours', message: 'Operating hours apply only to used/refurbished machinery' });
  if (b.purchase_available === false && !b.rental_available && creating) errs.push({ field: 'purchase_available', message: 'Enable sale, rental or both' });
  if (errs.length) throw Object.assign(E.bad('Please fix the highlighted fields'), { details: errs });
}
router.get('/product-vendors', perm('catalog', 'read'), (req, res) => { houseVendor(); res.json({ items: db.all("SELECT id, business_name, city, status FROM vendors ORDER BY business_name='Mohan Mishra Direct' DESC, business_name") }); });
router.post('/products', perm('catalog', 'write'), wrap((req, res) => {
  const b = v(req.body, ADMIN_PRULES); VP.checkGst(b); adminProductValidate(b, true);
  const cat = db.one('SELECT * FROM categories WHERE id=?', b.category_id); if (!cat) throw Object.assign(E.bad('Invalid category'), { details: [{ field: 'category_id', message: 'Choose a category' }] });
  const vend = b.vendor_id ? db.one('SELECT * FROM vendors WHERE id=?', b.vendor_id) : houseVendor(); if (!vend) throw E.bad('Invalid vendor');
  const id = db.insert('products', { ...b, vendor_id: vend.id, slug: VP.slug(b.name) + '-' + rid('').slice(-4).toLowerCase(), gst_rate: b.gst_rate ?? cat.gst_rate ?? 18, hsn: b.hsn || cat.hsn, location_city: b.location_city || vend.city, location_state: b.location_state || vend.state, lat: vend.lat, lng: vend.lng, status: b.status || 'approved', images: b.images || [], videos: b.videos || [], specs: b.specs || {} });
  db.insert('product_approvals', { product_id: id, action: 'created_by_admin', remarks: b.status || 'approved', by_user: req.user.id });
  if (b.stock) db.insert('inventory_log', { product_id: id, change: b.stock, reason: 'initial', by_user: req.user.id });
  audit(req, 'product.admin_create', 'product', id, b.name);
  res.status(201).json(VP.pshape(db.one('SELECT * FROM products WHERE id=?', id)));
}));
router.put('/products/:id', perm('catalog', 'write'), wrap((req, res) => {
  const p = db.one('SELECT * FROM products WHERE id=?', req.params.id); if (!p) throw E.notFound();
  const b = v(req.body, Object.fromEntries(Object.entries(ADMIN_PRULES).map(([k, r]) => [k, r.replace('|required', '')]))); VP.checkGst({ ...p, ...b }); adminProductValidate({ ...b, condition: b.condition || p.condition }, false);
  if (b.stock != null && b.stock !== p.stock) db.insert('inventory_log', { product_id: p.id, change: b.stock - p.stock, reason: 'admin_edit', by_user: req.user.id });
  db.update('products', p.id, { ...b, updated_at: new Date().toISOString() }); audit(req, 'product.admin_edit', 'product', p.id);
  res.json(VP.pshape(db.one('SELECT * FROM products WHERE id=?', p.id)));
}));
router.delete('/products/:id', perm('catalog', 'write'), wrap((req, res) => {
  const p = db.one('SELECT * FROM products WHERE id=?', req.params.id); if (!p) throw E.notFound();
  if (db.one('SELECT 1 FROM order_items WHERE product_id=?', p.id) || db.one('SELECT 1 FROM rentals WHERE product_id=?', p.id)) { db.update('products', p.id, { active: 0, status: 'archived' }); audit(req, 'product.archive', 'product', p.id); return res.json({ ok: true, archived: true }); }
  for (const t of ['wishlist', 'cart_items', 'compare_items', 'recent_views', 'product_approvals', 'inventory_log']) db.run(`DELETE FROM ${t} WHERE product_id=?`, p.id);
  db.run('DELETE FROM products WHERE id=?', p.id); audit(req, 'product.delete', 'product', p.id); res.json({ ok: true });
}));
router.post('/products/import', perm('catalog', 'write'), wrap((req, res) => {
  const text = req.body.csv; if (!text) throw E.bad('csv required');
  const rows = VP.parseCsv(text); const head = rows.shift().map(h => h.trim()); const results = [];
  rows.slice(0, 1000).forEach((r, i) => { try {
    const o = Object.fromEntries(head.map((h, j) => [h, r[j]]).filter(([, x]) => x !== undefined && x !== ''));
    if (o.specs) o.specs = J(o.specs, Object.fromEntries(String(o.specs).split(';').filter(Boolean).map(kv => kv.split(':').map(s => s.trim()))));
    if (o.images) o.images = String(o.images).split('|').filter(Boolean);
    const b = v(o, ADMIN_PRULES); VP.checkGst(b); adminProductValidate(b, true);
    if (!db.one('SELECT id FROM categories WHERE id=?', b.category_id)) throw E.bad('invalid category_id');
    const vend = b.vendor_id ? db.one('SELECT * FROM vendors WHERE id=?', b.vendor_id) : houseVendor(); if (!vend) throw E.bad('invalid vendor_id');
    const id = db.insert('products', { ...b, vendor_id: vend.id, slug: VP.slug(b.name) + '-' + rid('').slice(-4).toLowerCase(), status: b.status || 'approved', location_city: b.location_city || vend.city, location_state: b.location_state || vend.state, images: b.images || [], specs: b.specs || {} });
    results.push({ row: i + 2, ok: true, id });
  } catch (e) { results.push({ row: i + 2, ok: false, error: e.message, details: e.details }); } });
  audit(req, 'product.import', 'product', null, results.filter(r => r.ok).length);
  res.json({ imported: results.filter(r => r.ok).length, failed: results.filter(r => !r.ok).length, results, template_columns: Object.keys(ADMIN_PRULES) });
}));
router.get('/products/:id/full', perm('catalog', 'read'), wrap((req, res) => { const p = db.one('SELECT p.*, v.business_name vendor_name FROM products p JOIN vendors v ON v.id=p.vendor_id WHERE p.id=?', req.params.id); if (!p) throw E.notFound(); res.json({ ...VP.pshape(p), approvals: db.all('SELECT * FROM product_approvals WHERE product_id=? ORDER BY id DESC', p.id) }); }));

// ===== Invoice generation & settings =====
router.get('/invoices/search', perm('invoices', 'read'), (req, res) => {
  const f = where(req, { type: ['i.type=?'], status: ['i.status=?'], vendor_id: ['i.vendor_id=?'], customer_id: ['i.customer_id=?'], q: ['(i.invoice_no LIKE ? OR i.buyer LIKE ? OR i.seller LIKE ?)', q => [like(q), like(q), like(q)]], gstin: ['(i.buyer_gstin LIKE ? OR i.seller_gstin LIKE ?)', q => [like(q), like(q)]], from: ['i.created_at>=?'], to: ['i.created_at<=?', x => x + ' 23:59:59'], fy: ['i.fy=?'] });
  const sort = { total: 'i.total', date: 'i.id', no: 'i.invoice_no' }[req.query.sort] || 'i.id'; const dir = req.query.dir === 'asc' ? 'ASC' : 'DESC';
  res.json(pageResult(`SELECT i.id,i.invoice_no,i.type,i.fy,i.order_id,i.sub_order_id,i.quotation_id,i.rental_id,i.vendor_id,i.customer_id,i.seller_gstin,i.buyer_gstin,i.place_of_supply,i.taxable,i.cgst,i.sgst,i.igst,i.total,i.status,i.irn,i.emailed_at,i.created_at,v.business_name vendor_name,u.name customer_name, json_extract(i.buyer,'$.name') buyer_name FROM invoices i LEFT JOIN vendors v ON v.id=i.vendor_id LEFT JOIN users u ON u.id=i.customer_id ${f.w} ORDER BY ${sort} ${dir}`, f.p, req));
});
router.get('/invoice-sources', perm('invoices', 'read'), (req, res) => res.json({
  orders: db.all('SELECT o.id, o.order_no label, o.grand_total total, o.status FROM orders o ORDER BY o.id DESC LIMIT 200'),
  sub_orders: db.all('SELECT s.id, s.sub_order_no label, s.total, s.status, v.business_name vendor FROM sub_orders s JOIN vendors v ON v.id=s.vendor_id ORDER BY s.id DESC LIMIT 200'),
  quotations: db.all("SELECT q.id, q.quote_no label, q.total, q.status FROM quotations q WHERE q.status IN ('accepted','converted','sent','revised') ORDER BY q.id DESC LIMIT 200"),
  rentals: db.all('SELECT r.id, r.rental_no label, r.total, r.status FROM rentals r ORDER BY r.id DESC LIMIT 200'),
  payments: db.all("SELECT p.id, p.ref label, p.amount total, p.status FROM payments p WHERE p.status='success' ORDER BY p.id DESC LIMIT 200"),
  refunds: db.all('SELECT r.id, COALESCE(r.refund_no, r.id) label, r.amount total, r.status FROM refunds r ORDER BY r.id DESC LIMIT 200'),
  withdrawals: db.all('SELECT w.id, w.withdrawal_no label, w.amount total, w.status FROM withdrawals w ORDER BY w.id DESC LIMIT 200'),
  vendors: db.all('SELECT id, business_name label FROM vendors ORDER BY business_name'),
}));
function generateInvoice(b, userId) {
  const need = (x, m) => { if (!x) throw E.bad(m); return x; };
  switch (b.type) {
    case 'tax': {
      if (b.order_id && !b.sub_order_id) { const subs = db.all('SELECT id FROM sub_orders WHERE order_id=?', b.order_id); if (!subs.length) throw E.notFound('Order not found'); return subs.map(s => svc.issueInvoice({ type: 'tax', sub_order_id: s.id, user_id: userId })); }
      need(db.one('SELECT id FROM sub_orders WHERE id=?', b.sub_order_id), 'sub_order_id or order_id required'); return [svc.issueInvoice({ type: 'tax', sub_order_id: b.sub_order_id, user_id: userId })];
    }
    case 'proforma':
      if (b.quotation_id) { need(db.one('SELECT id FROM quotations WHERE id=?', b.quotation_id), 'Quotation not found'); return [svc.issueInvoice({ type: 'quotation', quotation_id: b.quotation_id, user_id: userId })]; }
      need(db.one('SELECT id FROM orders WHERE id=?', b.order_id), 'order_id or quotation_id required'); return [svc.issueInvoice({ type: 'proforma', order_id: b.order_id, user_id: userId })];
    case 'commission': need(db.one('SELECT id FROM sub_orders WHERE id=?', b.sub_order_id), 'sub_order_id required'); return [svc.issueInvoice({ type: 'commission', sub_order_id: b.sub_order_id, user_id: userId })];
    case 'receipt': need(db.one('SELECT id FROM payments WHERE id=?', b.payment_id), 'payment_id required'); return [svc.issueInvoice({ type: 'receipt', payment_id: b.payment_id, user_id: userId })];
    case 'rental': need(db.one('SELECT id FROM rentals WHERE id=?', b.rental_id), 'rental_id required'); return [svc.issueInvoice({ type: 'rental', rental_id: b.rental_id, user_id: userId })];
    case 'credit_note': case 'debit_note': {
      const ref = b.ref_invoice_id && db.one('SELECT sub_order_id FROM invoices WHERE id=?', b.ref_invoice_id); const sid = b.sub_order_id || ref?.sub_order_id;
      if (!sid || !b.amount) throw E.bad('sub_order_id (or a reference tax invoice) and amount required'); return [svc.issueInvoice({ type: b.type, sub_order_id: sid, amount: b.amount, reason: b.notes, user_id: userId })];
    }
    case 'refund': need(db.one('SELECT id FROM refunds WHERE id=?', b.refund_id), 'refund_id required'); return [svc.issueInvoice({ type: 'refund', refund_id: b.refund_id, user_id: userId })];
    case 'settlement':
      if (b.withdrawal_id) { need(db.one('SELECT id FROM withdrawals WHERE id=?', b.withdrawal_id), 'Withdrawal not found'); return [svc.issueInvoice({ type: 'settlement', withdrawal_id: b.withdrawal_id, user_id: userId })]; }
      need(db.one('SELECT id FROM vendors WHERE id=?', b.vendor_id), 'vendor_id or withdrawal_id required'); return [svc.issueInvoice({ type: 'settlement_statement', vendor_id: b.vendor_id, from: b.from, to: b.to, user_id: userId })];
    default: throw E.bad('Unsupported invoice type');
  }
}
router.post('/invoices/generate', perm('invoices', 'write'), wrap((req, res) => {
  const b = v(req.body, { type: 'enum|required|in:tax,proforma,commission,receipt,rental,credit_note,debit_note,refund,settlement', order_id: 'int', sub_order_id: 'int', quotation_id: 'int', rental_id: 'int', payment_id: 'int', refund_id: 'int', withdrawal_id: 'int', vendor_id: 'int', ref_invoice_id: 'int', amount: 'number|min:0', notes: 'string|max:1000', from: 'string', to: 'string' });
  const out = generateInvoice(b, req.user.id); out.forEach(i => audit(req, 'invoice.generate', 'invoice', i.id, i.invoice_no));
  res.status(201).json({ items: out, invoice: out[0] });
}));
const INV_TYPES = ['tax', 'proforma', 'commission', 'credit_note', 'debit_note', 'receipt', 'rental', 'settlement', 'refund', 'quotation'];
router.get('/invoice-settings', perm('invoices', 'read'), (req, res) => res.json({ company: db.setting('company', {}), prefixes: db.setting('invoice_prefixes', {}), template: db.setting('invoice_template', {}), einvoice_enabled: db.setting('einvoice_enabled', true), types: INV_TYPES, counters: db.all('SELECT * FROM invoice_counters ORDER BY fy DESC, prefix') }));
router.put('/invoice-settings', perm('invoices', 'approve'), wrap((req, res) => {
  const b = v(req.body, { company: 'json', prefixes: 'json', template: 'json', einvoice_enabled: 'bool' });
  if (b.company?.gstin && !/^\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/.test(b.company.gstin)) throw Object.assign(E.bad('Invalid company GSTIN'), { details: [{ field: 'gstin', message: 'Enter a valid 15-character GSTIN' }] });
  if (b.prefixes) for (const [k, x] of Object.entries(b.prefixes)) if (!/^[A-Z0-9-]{1,12}$/.test(String(x))) throw Object.assign(E.bad('Invalid prefix for ' + k), { details: [{ field: 'prefix_' + k, message: 'Use 1–12 capital letters, digits or -' }] });
  const set = (k, val) => db.run('INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value', k, JSON.stringify(val));
  if (b.company) { if (b.company.gstin) b.company.state_code = b.company.gstin.slice(0, 2); set('company', { ...db.setting('company', {}), ...b.company }); }
  if (b.prefixes) set('invoice_prefixes', { ...db.setting('invoice_prefixes', {}), ...b.prefixes });
  if (b.template) set('invoice_template', { ...db.setting('invoice_template', {}), ...b.template });
  if (b.einvoice_enabled !== undefined) set('einvoice_enabled', b.einvoice_enabled);
  audit(req, 'invoice.settings', 'settings', 'invoice'); res.json({ ok: true });
}));
router.get('/invoice-preview', perm('invoices', 'read'), wrap((req, res) => { const co = db.setting('company', {}); svc.invoicePdf({ invoice_no: (db.setting('invoice_prefixes', {}).tax || 'MMT') + '/PREVIEW/00000', type: 'tax', fy: require('../core').fyOf(), created_at: new Date().toISOString(), seller: { name: co.name, gstin: co.gstin, address: co.address }, buyer: { name: 'Sample Buyer Infra Pvt Ltd', gstin: '29AAACS1234A1Z1', address: 'Peenya Industrial Area, Bengaluru, Karnataka' }, seller_gstin: co.gstin, buyer_gstin: '29AAACS1234A1Z1', place_of_supply: '29', items: [{ name: 'Hydraulic Excavator 20T (sample)', hsn: '84295200', qty: 1, unit_price: 2500000, taxable: 2500000, gst_rate: 18 }], taxable: 2500000, igst: 450000, total: 2950000, status: 'issued' }, res); }));


// ----- admin: create order on behalf of a customer (phone / offline sales) -----
router.get('/order-products', perm('orders', 'read'), (req, res) => { const q = String(req.query.q || ''); res.json({ items: db.all(`SELECT p.id,p.name,p.model_no sku,p.price,p.stock,p.moq,p.gst_rate,p.images,v.business_name vendor_name FROM products p JOIN vendors v ON v.id=p.vendor_id WHERE p.status='approved' AND p.active=1 AND p.purchase_available=1 AND (p.name LIKE ? OR p.model_no LIKE ? OR p.manufacturer LIKE ?) ORDER BY p.name LIMIT 20`, like(q), like(q), like(q)).map(p => ({ ...p, image: J(p.images, [])[0], images: undefined })) }); });
router.post('/orders', perm('orders', 'write'), wrap((req, res) => {
  const b = v(req.body, { customer_id: 'int|required', items: 'json|required', shipping_address_id: 'int', billing_address_id: 'int', new_address: 'json', gstin: 'gstin', coupon_code: 'string', payment_plan: 'enum|in:full,advance,partial', payment_method: 'string', notes: 'string|max:500' });
  const cust = db.one("SELECT * FROM users WHERE id=? AND role='customer'", b.customer_id); if (!cust) throw E.bad('Validation failed', [{ field: 'customer_id', message: 'Select a customer' }]);
  if (!Array.isArray(b.items) || !b.items.length) throw E.bad('Validation failed', [{ field: 'items', message: 'Add at least one machine' }]);
  let shipId = b.shipping_address_id;
  if (!shipId && b.new_address) { const a = b.new_address; const miss = ['name', 'mobile', 'line1', 'city', 'state', 'pincode'].filter(k => !a[k]); if (miss.length) throw E.bad('Validation failed', miss.map(k => ({ field: 'new_address.' + k, message: k + ' is required' }))); shipId = db.insert('addresses', { user_id: cust.id, label: a.label || 'Site', name: a.name, mobile: a.mobile, line1: a.line1, line2: a.line2, city: a.city, state: a.state, state_code: require('../core').stateCodeOf(a.state), pincode: a.pincode, gstin: a.gstin }); }
  const ship = shipId && db.one('SELECT * FROM addresses WHERE id=? AND user_id=?', shipId, cust.id); if (!ship) throw E.bad('Validation failed', [{ field: 'shipping_address_id', message: 'Select or add a delivery address for this customer' }]);
  const bill = (b.billing_address_id && db.one('SELECT * FROM addresses WHERE id=? AND user_id=?', b.billing_address_id, cust.id)) || ship;
  const byV = {}, errs = [];
  b.items.forEach((it, i) => { const p = db.one('SELECT * FROM products WHERE id=?', +it.product_id); const qty = Math.max(1, +it.qty || 1);
    if (!p || p.status !== 'approved' || !p.active || !p.purchase_available) return errs.push({ field: `items.${i}`, message: 'Product not available for sale' });
    if (p.stock < qty) return errs.push({ field: `items.${i}`, message: `Only ${p.stock} in stock for ${p.name}` });
    (byV[p.vendor_id] ||= { vendor_id: p.vendor_id, lines: [] }).lines.push(svc.productLine(p, qty, it.with_installation !== false)); });
  if (errs.length) throw E.bad('Validation failed', errs);
  const coupon = b.coupon_code ? svc.loadCoupon(b.coupon_code, cust.id) : null;
  const pos = ship.state_code || require('../core').stateCodeOf(ship.state) || cust.state_code;
  const priced = svc.priceGroups(Object.values(byV), pos, coupon); priced.place_of_supply = pos;
  const id = svc.createOrder(cust, priced, { source: 'admin', billing: bill, shipping: ship, gstin: b.gstin || bill.gstin || cust.gstin, coupon, payment_plan: b.payment_plan, payment_method: b.payment_method || 'offline', notes: b.notes });
  db.insert('order_events', { order_id: id, status: 'note', note: `Order created by admin ${req.user.name || req.user.email}`, by_user: req.user.id });
  audit(req, 'order.create_on_behalf', 'order', id, { customer_id: cust.id, items: b.items.length });
  res.status(201).json(orderDetail(id, req.user));
}));
// ---- Inventory (platform-wide stock across all sellers) ----
router.get('/inventory', perm('catalog', 'read'), (req, res) => {
  const wh = ['1=1']; const ps = [];
  if (req.query.q) { wh.push('(p.name LIKE ? OR p.model_no LIKE ? OR p.manufacturer LIKE ?)'); ps.push(like(req.query.q), like(req.query.q), like(req.query.q)); }
  if (req.query.vendor_id) { wh.push('p.vendor_id=?'); ps.push(+req.query.vendor_id); }
  if (req.query.category_id) { wh.push('(p.category_id=? OR p.subcategory_id=?)'); ps.push(+req.query.category_id, +req.query.category_id); }
  if (req.query.status) { wh.push('p.status=?'); ps.push(req.query.status); }
  if (req.query.stock === 'low') wh.push('p.stock > 0 AND p.stock <= COALESCE(p.low_stock_threshold,0)');
  if (req.query.stock === 'out') wh.push('p.stock <= 0');
  const W = wh.join(' AND ');
  const summary = db.one(`SELECT COUNT(*) skus, COALESCE(SUM(p.stock),0) units, COALESCE(SUM(p.reserved),0) reserved, COALESCE(SUM(p.sold),0) sold, ROUND(COALESCE(SUM(p.stock*p.price),0),2) stock_value, SUM(CASE WHEN p.stock<=0 THEN 1 ELSE 0 END) out_of_stock, SUM(CASE WHEN p.stock>0 AND p.stock<=COALESCE(p.low_stock_threshold,0) THEN 1 ELSE 0 END) low_stock FROM products p WHERE ${W}`, ...ps);
  res.json({ summary, ...pageResult(`SELECT p.id,p.name,p.model_no,p.price,p.stock,p.reserved,p.sold,p.low_stock_threshold,p.status,p.active,p.rental_available,p.rental_units,p.vendor_id,v.business_name vendor_name,c.name category_name FROM products p JOIN vendors v ON v.id=p.vendor_id LEFT JOIN categories c ON c.id=p.category_id WHERE ${W} ORDER BY (p.stock<=COALESCE(p.low_stock_threshold,0)) DESC, p.stock ASC, p.id DESC`, ps, req) });
});
router.patch('/inventory/:id', perm('catalog', 'approve'), wrap((req, res) => {
  const p = db.one('SELECT * FROM products WHERE id=?', req.params.id); if (!p) throw E.notFound('Product not found');
  const b = v(req.body, { stock: 'int|required', low_stock_threshold: 'int', note: 'string|max:300' });
  if (b.stock < 0) throw E.bad('Stock cannot be negative', { stock: 'Enter 0 or more' });
  db.update('products', p.id, { stock: b.stock, ...(b.low_stock_threshold != null ? { low_stock_threshold: b.low_stock_threshold } : {}), updated_at: new Date().toISOString() });
  audit(req, 'inventory.adjust', 'product', p.id, { from: p.stock, to: b.stock, note: b.note || '' });
  res.json(db.one('SELECT id,name,stock,reserved,sold,low_stock_threshold FROM products WHERE id=?', p.id));
}));

module.exports = router;
