const router = require('express').Router();
const path = require('path'); const fs = require('fs'); const crypto = require('crypto');
const multer = require('multer');
const { db, E, wrap, J, v, auth, pageResult, seqNo, notify, notifyAdmins, vendorUserId, round2 } = require('../core');

// ----- uploads (images, PDFs, docs) -----
const UP = process.env.UPLOAD_DIR || path.join(__dirname, '..', '..', 'uploads');
fs.mkdirSync(UP, { recursive: true });
const ALLOWED = { 'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp', 'image/svg+xml': '.svg', 'application/pdf': '.pdf', 'video/mp4': '.mp4', 'text/csv': '.csv', 'application/vnd.ms-excel': '.csv' };
const upload = multer({ storage: multer.diskStorage({ destination: UP, filename: (_r, f, cb) => cb(null, crypto.randomBytes(10).toString('hex') + (ALLOWED[f.mimetype] || '.bin')) }), limits: { fileSize: (+process.env.MAX_UPLOAD_MB || 15) * 1048576, files: 10 }, fileFilter: (_r, f, cb) => cb(ALLOWED[f.mimetype] ? null : E.bad('File type not allowed: ' + f.mimetype), !!ALLOWED[f.mimetype]) });
router.post('/uploads', auth(), upload.array('files', 10), wrap((req, res) => {
  const items = (req.files || []).map(f => { const url = '/uploads/' + f.filename; db.insert('uploads', { user_id: req.user.id, url, mime: f.mimetype, size: f.size, original_name: f.originalname }); return { url, mime: f.mimetype, size: f.size, name: f.originalname }; });
  if (!items.length) throw E.bad('No files uploaded (field name: files)');
  res.status(201).json({ items });
}));

// ----- notifications -----
router.get('/notifications', auth(), (req, res) => { const r = pageResult('SELECT * FROM notifications WHERE user_id=? ORDER BY id DESC', [req.user.id], req, n => ({ ...n, data: J(n.data) })); r.unread = db.one('SELECT COUNT(*) c FROM notifications WHERE user_id=? AND read=0', req.user.id).c; res.json(r); });
router.post('/notifications/read', auth(), (req, res) => { if (req.body.ids?.length) db.run(`UPDATE notifications SET read=1 WHERE user_id=? AND id IN (${req.body.ids.map(() => '?').join(',')})`, req.user.id, ...req.body.ids.map(Number)); else db.run('UPDATE notifications SET read=1 WHERE user_id=?', req.user.id); res.json({ ok: true }); });
router.patch('/notifications/preferences', auth(), (req, res) => { const p = { ...J(req.user.notif_prefs, {}), ...req.body }; db.update('users', req.user.id, { notif_prefs: p }); res.json(p); });

// ----- support tickets (any role; admin answers via admin routes too) -----
const ticketOf = (req) => { const t = db.one('SELECT * FROM tickets WHERE id=?', req.params.id); if (!t || (t.user_id !== req.user.id && !['admin', 'staff'].includes(req.user.role))) throw E.notFound(); return t; };
router.post('/tickets', auth(), wrap((req, res) => {
  const b = v(req.body, { subject: 'string|required|max:200', category: 'enum|in:general,order,payment,refund,product,vendor,technical,account,rental,kyc', message: 'string|required|max:4000', order_id: 'int', priority: 'enum|in:low,normal,high,urgent', attachments: 'json', channel: 'enum|in:app,web,whatsapp,call,email' });
  const id = db.insert('tickets', { ticket_no: seqNo('TKT'), user_id: req.user.id, subject: b.subject, category: b.category || 'general', order_id: b.order_id, vendor_id: req.user.vendor?.id, priority: b.priority || 'normal', channel: b.channel || 'app' });
  db.insert('ticket_messages', { ticket_id: id, user_id: req.user.id, body: b.message, attachments: b.attachments || [] });
  notifyAdmins('ticket_new', 'New support ticket', b.subject, { ticket_id: id });
  res.status(201).json(ticketDetail(id, req.user));
}));
function ticketDetail(id, u) { const t = db.one('SELECT t.*, u.name user_name, u.role user_role FROM tickets t JOIN users u ON u.id=t.user_id WHERE t.id=?', id); t.messages = db.all(`SELECT m.*, u.name, u.role FROM ticket_messages m LEFT JOIN users u ON u.id=m.user_id WHERE ticket_id=? ${['admin', 'staff'].includes(u.role) ? '' : 'AND internal=0'} ORDER BY m.id`, id).map(m => ({ ...m, attachments: J(m.attachments, []) })); return t; }
router.get('/tickets', auth(), (req, res) => res.json(pageResult('SELECT * FROM tickets WHERE user_id=? ORDER BY updated_at DESC', [req.user.id], req)));
router.get('/tickets/:id', auth(), wrap((req, res) => { const t = ticketOf(req); res.json(ticketDetail(t.id, req.user)); }));
router.post('/tickets/:id/messages', auth(), wrap((req, res) => {
  const t = ticketOf(req); const b = v(req.body, { body: 'string|required|max:4000', attachments: 'json', internal: 'bool' });
  const staff = ['admin', 'staff'].includes(req.user.role);
  db.insert('ticket_messages', { ticket_id: t.id, user_id: req.user.id, body: b.body, attachments: b.attachments || [], internal: staff && b.internal ? 1 : 0 });
  db.run('UPDATE tickets SET status=?, updated_at=CURRENT_TIMESTAMP WHERE id=?', staff ? 'awaiting_customer' : (t.status === 'closed' ? 'open' : t.status === 'awaiting_customer' ? 'open' : t.status), t.id);
  if (staff && !b.internal) notify(t.user_id, 'ticket_reply', 'Support replied', t.subject, { ticket_id: t.id }); else if (!staff) notifyAdmins('ticket_reply', 'Ticket reply', t.subject, { ticket_id: t.id });
  res.status(201).json(ticketDetail(t.id, req.user));
}));
router.post('/tickets/:id/close', auth(), wrap((req, res) => { const t = ticketOf(req); db.run("UPDATE tickets SET status='closed', rating=?, updated_at=CURRENT_TIMESTAMP WHERE id=?", req.body.rating || null, t.id); res.json(ticketDetail(t.id, req.user)); }));

// ----- in-app messaging customer <-> vendor -----
function convOf(req) { const c = db.one('SELECT * FROM conversations WHERE id=?', req.params.id); const u = req.user; if (!c || c.kind === 'support' || !(c.customer_id === u.id || (u.vendor && c.vendor_id === u.vendor.id) || ['admin', 'staff'].includes(u.role))) throw E.notFound(); return c; }
router.post('/conversations', auth('customer'), wrap((req, res) => {
  const b = v(req.body, { vendor_id: 'int', product_id: 'int', order_id: 'int', message: 'string|required|max:4000', attachments: 'json' });
  let vid = b.vendor_id; if (!vid && b.product_id) vid = db.one('SELECT vendor_id FROM products WHERE id=?', b.product_id)?.vendor_id; if (!vid) throw E.bad('vendor_id or product_id required');
  let c = db.one('SELECT * FROM conversations WHERE customer_id=? AND vendor_id=? AND COALESCE(product_id,0)=COALESCE(?,0)', req.user.id, vid, b.product_id || null);
  const cid = c ? c.id : db.insert('conversations', { customer_id: req.user.id, vendor_id: vid, product_id: b.product_id, order_id: b.order_id, subject: b.product_id ? db.one('SELECT name FROM products WHERE id=?', b.product_id)?.name : 'General' });
  db.insert('messages', { conversation_id: cid, sender_id: req.user.id, body: b.message, attachments: b.attachments || [] });
  db.run('UPDATE conversations SET updated_at=CURRENT_TIMESTAMP WHERE id=?', cid);
  notify(vendorUserId(vid), 'message', 'New message from customer', b.message.slice(0, 120), { conversation_id: cid });
  res.status(201).json(convDetail(cid, req.user));
}));
function convDetail(id, u) { const c = db.one('SELECT c.*, v.business_name vendor_name, cu.name customer_name FROM conversations c JOIN vendors v ON v.id=c.vendor_id JOIN users cu ON cu.id=c.customer_id WHERE c.id=?', id); c.messages = db.all('SELECT m.*, u.name sender_name, u.role sender_role FROM messages m JOIN users u ON u.id=m.sender_id WHERE conversation_id=? ORDER BY m.id', id).map(m => ({ ...m, attachments: J(m.attachments, []), mine: m.sender_id === u.id })); db.run('UPDATE messages SET read=1 WHERE conversation_id=? AND sender_id<>?', id, u.id); return c; }
router.get('/conversations', auth(), (req, res) => {
  const u = req.user; const [w, p] = u.role === 'vendor' ? ['c.vendor_id=?', u.vendor.id] : ['c.customer_id=?', u.id];
  res.json(pageResult(`SELECT c.*, v.business_name vendor_name, cu.name customer_name, (SELECT body FROM messages WHERE conversation_id=c.id ORDER BY id DESC LIMIT 1) last_message, (SELECT COUNT(*) FROM messages WHERE conversation_id=c.id AND read=0 AND sender_id<>?) unread FROM conversations c JOIN vendors v ON v.id=c.vendor_id JOIN users cu ON cu.id=c.customer_id WHERE ${w} ORDER BY c.updated_at DESC`, [u.id, p], req));
});
router.get('/conversations/:id', auth(), wrap((req, res) => res.json(convDetail(convOf(req).id, req.user))));
router.post('/conversations/:id/messages', auth(), wrap((req, res) => {
  const c = convOf(req); const b = v(req.body, { body: 'string|required|max:4000', attachments: 'json' });
  db.insert('messages', { conversation_id: c.id, sender_id: req.user.id, body: b.body, attachments: b.attachments || [] });
  db.run('UPDATE conversations SET updated_at=CURRENT_TIMESTAMP WHERE id=?', c.id);
  notify(req.user.id === c.customer_id ? vendorUserId(c.vendor_id) : c.customer_id, 'message', 'New message', b.body.slice(0, 120), { conversation_id: c.id });
  res.status(201).json(convDetail(c.id, req.user));
}));

// ----- reviews, abuse reports, feedback -----
router.post('/reviews', auth('customer'), wrap((req, res) => {
  const b = v(req.body, { product_id: 'int', vendor_id: 'int', order_id: 'int|required', rating: 'int|required|min:1', title: 'string|max:120', comment: 'string|max:2000' });
  if (b.rating > 5) throw E.bad('rating must be 1-5');
  const o = db.one("SELECT * FROM orders WHERE id=? AND customer_id=?", b.order_id, req.user.id); if (!o) throw E.bad('Reviews are allowed only for your orders');
  const delivered = db.one(`SELECT s.vendor_id FROM sub_orders s ${b.product_id ? 'JOIN order_items i ON i.sub_order_id=s.id AND i.product_id=' + (+b.product_id) : ''} WHERE s.order_id=? AND s.status IN ('delivered','completed') ${b.vendor_id ? 'AND s.vendor_id=' + (+b.vendor_id) : ''} LIMIT 1`, o.id);
  if (!delivered) throw E.bad('You can review after delivery');
  if (db.one('SELECT id FROM reviews WHERE user_id=? AND order_id=? AND COALESCE(product_id,0)=?', req.user.id, o.id, b.product_id || 0)) throw E.conflict('Already reviewed');
  const id = db.insert('reviews', { user_id: req.user.id, product_id: b.product_id || null, vendor_id: b.vendor_id || delivered.vendor_id, order_id: o.id, rating: b.rating, title: b.title, comment: b.comment });
  if (b.product_id) db.run("UPDATE products SET rating=(SELECT ROUND(AVG(rating),1) FROM reviews WHERE product_id=? AND status='published'), rating_count=(SELECT COUNT(*) FROM reviews WHERE product_id=? AND status='published') WHERE id=?", b.product_id, b.product_id, b.product_id);
  const vid = b.vendor_id || delivered.vendor_id;
  db.run("UPDATE vendors SET rating=(SELECT ROUND(AVG(rating),1) FROM reviews WHERE vendor_id=? AND status='published'), rating_count=(SELECT COUNT(*) FROM reviews WHERE vendor_id=? AND status='published') WHERE id=?", vid, vid, vid);
  res.status(201).json(db.one('SELECT * FROM reviews WHERE id=?', id));
}));
router.get('/my/reviews', auth('customer'), (req, res) => res.json({ items: db.all('SELECT r.*, p.name product_name FROM reviews r LEFT JOIN products p ON p.id=r.product_id WHERE r.user_id=? ORDER BY r.id DESC', req.user.id) }));
router.post('/reports', auth(), wrap((req, res) => { const b = v(req.body, { target_type: 'enum|required|in:product,vendor,review,user,message', target_id: 'int|required', reason: 'string|required|max:1000' }); const id = db.insert('abuse_reports', { user_id: req.user.id, ...b }); notifyAdmins('abuse_report', 'Abuse report', `${b.target_type} #${b.target_id}: ${b.reason}`); res.status(201).json({ id }); }));
router.post('/feedback', auth(), wrap((req, res) => { const b = v(req.body, { rating: 'int|min:1', message: 'string|required|max:2000' }); res.status(201).json({ id: db.insert('feedback', { user_id: req.user.id, ...b }) }); }));
router.post('/contact', wrap((req, res) => { const b = v(req.body, { name: 'string|required|max:100', mobile: 'mobile', email: 'email', message: 'string|required|max:2000' }); db.insert('crm_leads', { owner_type: 'admin', name: b.name, mobile: b.mobile, email: b.email, source: 'website', status: 'new', tags: 'contact-form' }); notifyAdmins('contact', 'Website contact', b.message.slice(0, 200)); res.status(201).json({ ok: true }); }));
module.exports = router;
