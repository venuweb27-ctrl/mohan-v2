const router = require('express').Router();
const { db, E, wrap, J, v, auth, pageResult, audit, rid } = require('../core');
const svc = require('../services');
const providers = require('../providers');

router.post('/payments/init', auth('customer'), wrap(async (req, res) => {
  const b = v(req.body, { order_id: 'int', rental_id: 'int', purpose: 'enum|in:full,advance,partial,balance', provider: 'enum|in:mock,razorpay,cashfree', method: 'string', amount: 'number', idempotency_key: 'string|max:80' });
  if (b.purpose === 'balance') b.purpose = 'full';
  b.idempotency_key ||= req.headers['idempotency-key'];
  res.status(201).json(await svc.initPayment(req.user, b));
}));
router.post('/payments/verify', auth('customer'), wrap(async (req, res) => {
  const b = v(req.body, { gateway_order_id: 'string|required', gateway_payment_id: 'string|required', signature: 'string|required' });
  const p = db.one('SELECT * FROM payments WHERE gateway_order_id=? AND user_id=?', b.gateway_order_id, req.user.id); if (!p) throw E.notFound('Payment not found');
  res.json(await svc.verifyPayment(b));
}));
// Mock checkout: simulates the gateway UI (success / failure) — only available for provider=mock.
router.post('/payments/mock/complete', auth('customer'), wrap(async (req, res) => {
  const p = db.one("SELECT * FROM payments WHERE gateway_order_id=? AND user_id=? AND provider='mock'", req.body.gateway_order_id, req.user.id); if (!p) throw E.notFound('Mock payment not found');
  if (req.body.outcome === 'failure') {
    db.update('payments', p.id, { status: 'failed', failure_reason: req.body.reason || 'Declined by bank (mock)' });
    require('../core').notify(p.user_id, 'payment_failed', 'Payment failed', `Payment ${p.ref} failed. Please retry.`, { payment_id: p.id });
    return res.status(402).json({ error: { code: 'payment_failed', message: 'Payment failed (mock)' }, payment: db.one('SELECT * FROM payments WHERE id=?', p.id) });
  }
  const pid = 'mock_pay_' + rid('').slice(1);
  res.json(await svc.verifyPayment({ gateway_order_id: p.gateway_order_id, gateway_payment_id: pid, signature: providers.mockPay.sign(p.gateway_order_id, pid) }));
}));
router.post('/payments/:id/retry', auth('customer'), wrap(async (req, res) => {
  const p = db.one('SELECT * FROM payments WHERE id=? AND user_id=?', req.params.id, req.user.id); if (!p) throw E.notFound();
  if (p.status === 'success') throw E.bad('Already paid');
  if (p.status === 'created') db.update('payments', p.id, { status: 'abandoned' });
  res.status(201).json(await svc.initPayment(req.user, { order_id: p.order_id, rental_id: p.rental_id, purpose: p.purpose, provider: req.body.provider || p.provider, method: req.body.method || p.method, amount: p.amount }));
}));
router.get('/payments', auth('customer'), (req, res) => res.json(pageResult('SELECT p.id,p.ref,p.provider,p.method,p.purpose,p.amount,p.status,p.gateway_payment_id,p.failure_reason,p.order_id,p.rental_id,p.created_at, o.order_no, r.rental_no FROM payments p LEFT JOIN orders o ON o.id=p.order_id LEFT JOIN rentals r ON r.id=p.rental_id WHERE p.user_id=? ORDER BY p.id DESC', [req.user.id], req)));

// ----- webhooks (signature verified, idempotent via webhook_events.event_id) -----
function extract(provider, b) {
  if (provider === 'razorpay') { const e = b.payload?.payment?.entity || {}; return { id: b.id || e.id + ':' + b.event, type: b.event, ok: b.event === 'payment.captured' || b.event === 'order.paid', failed: b.event === 'payment.failed', gateway_order_id: e.order_id, gateway_payment_id: e.id, error: e.error_description }; }
  if (provider === 'cashfree') { const d = b.data || {}; return { id: (d.payment?.cf_payment_id || '') + ':' + b.type, type: b.type, ok: b.type === 'PAYMENT_SUCCESS_WEBHOOK', failed: b.type === 'PAYMENT_FAILED_WEBHOOK', gateway_order_id: d.order?.order_id, gateway_payment_id: String(d.payment?.cf_payment_id || ''), error: d.payment?.payment_message }; }
  return { id: b.id, type: b.event, ok: b.event === 'payment.captured', failed: b.event === 'payment.failed', gateway_order_id: b.gateway_order_id, gateway_payment_id: b.gateway_payment_id, error: b.error };
}
router.post('/webhooks/:provider', wrap(async (req, res) => {
  const provider = req.params.provider; const g = providers.gateways[provider]; if (!g) throw E.notFound();
  const raw = req.rawBody ? req.rawBody.toString() : JSON.stringify(req.body);
  const verified = g.verifyWebhook(raw, req.headers);
  const ev = extract(provider, req.body);
  if (!ev.id) throw E.bad('Missing event id');
  if (!verified) { db.insert('webhook_events', { provider, event_id: provider + ':rejected:' + Date.now() + ':' + Math.random().toString(36).slice(2), event_type: ev.type, payload: raw.slice(0, 5000), verified: 0 }); return res.status(401).json({ error: { code: 'bad_signature', message: 'Webhook signature invalid' } }); }
  const ex = db.one('SELECT * FROM webhook_events WHERE event_id=?', provider + ':' + ev.id);
  if (ex) return res.json({ ok: true, duplicate: true });
  const wid = db.insert('webhook_events', { provider, event_id: provider + ':' + ev.id, event_type: ev.type, payload: raw.slice(0, 20000), verified: verified ? 1 : 0 });
  if (!verified) return res.status(401).json({ error: { code: 'bad_signature', message: 'Webhook signature invalid' } });
  if (ev.ok) await svc.verifyPayment({ gateway_order_id: ev.gateway_order_id, gateway_payment_id: ev.gateway_payment_id }, true);
  else if (ev.failed) { const p = db.one('SELECT * FROM payments WHERE gateway_order_id=?', ev.gateway_order_id); if (p && p.status !== 'success') db.update('payments', p.id, { status: 'failed', failure_reason: ev.error || 'failed (webhook)' }); }
  db.run('UPDATE webhook_events SET processed=1 WHERE id=?', wid);
  res.json({ ok: true });
}));

// ----- invoices (customer, vendor, admin share this) -----
function canSeeInvoice(inv, u) {
  if (['admin'].includes(u.role)) return true;
  if (u.role === 'staff') return (require('../core').LEVEL[(u.permissions || {}).invoices || 'none'] || 0) >= 1;
  if (u.role === 'vendor') return inv.vendor_id === u.vendor?.id;
  return inv.customer_id === u.id && !['commission', 'settlement'].includes(inv.type);
}
router.get('/invoices', auth(), (req, res) => {
  const u = req.user; const w = []; const p = [];
  if (u.role === 'customer') { w.push("customer_id=? AND type NOT IN ('commission','settlement')"); p.push(u.id); }
  else if (u.role === 'vendor') { w.push('vendor_id=?'); p.push(u.vendor.id); }
  if (req.query.type) { w.push('type=?'); p.push(req.query.type); }
  if (req.query.q) { w.push('invoice_no LIKE ?'); p.push(`%${req.query.q}%`); }
  res.json(pageResult(`SELECT id,invoice_no,type,fy,order_id,sub_order_id,rental_id,vendor_id,customer_id,taxable,cgst,sgst,igst,total,status,irn,ewaybill_no,created_at FROM invoices ${w.length ? 'WHERE ' + w.join(' AND ') : ''} ORDER BY id DESC`, p, req));
});
router.get('/invoices/:id', auth(), wrap((req, res) => { const inv = db.one('SELECT * FROM invoices WHERE id=?', req.params.id); if (!inv || !canSeeInvoice(inv, req.user)) throw E.notFound(); res.json({ ...inv, items: J(inv.items, []), seller: J(inv.seller, {}), buyer: J(inv.buyer, {}) }); }));
router.get('/invoices/:id/pdf', auth(), wrap((req, res) => { const inv = db.one('SELECT * FROM invoices WHERE id=?', req.params.id); if (!inv || !canSeeInvoice(inv, req.user)) throw E.notFound(); svc.invoicePdf(inv, res); }));
router.post('/invoices/:id/email', auth(), wrap((req, res) => {
  const inv = db.one('SELECT * FROM invoices WHERE id=?', req.params.id); if (!inv || !canSeeInvoice(inv, req.user)) throw E.notFound();
  const to = req.body.email || req.user.email; if (!to) throw E.bad('email required');
  providers.email.send(to, `Invoice ${inv.invoice_no}`, `Your invoice ${inv.invoice_no} for ₹${inv.total} is attached. Download: /api/v1/invoices/${inv.id}/pdf`);
  res.json({ ok: true, queued_to: to });
}));
router.post('/invoices/:id/whatsapp', auth(), wrap(async (req, res) => {
  const inv = db.one('SELECT * FROM invoices WHERE id=?', req.params.id); if (!inv || !canSeeInvoice(inv, req.user)) throw E.notFound();
  const to = req.body.mobile || req.user.mobile;
  res.json(await providers.whatsapp.send(to, `Invoice ${inv.invoice_no} – ₹${inv.total}. ${process.env.PUBLIC_URL || ''}/api/v1/invoices/${inv.id}/pdf`));
}));
module.exports = router;
