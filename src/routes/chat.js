// In-app chat: customer <-> vendor (per product / per order enquiry) and customer|vendor <-> admin support.
// Admin (and staff with the "support" permission) can view, moderate and join any thread.
// Live updates use short polling (GET /chat/threads/:id?after=<id>, GET /chat/unread) — no extra services.
const express = require('express');
const { db, E, ApiError, wrap, J, auth, v, LEVEL, notify, vendorUserId, audit } = require('../core');
const router = express.Router();
router.use(auth());

const MAX_LEN = () => +(process.env.CHAT_MAX_LEN || 2000);
const RATE = () => +(process.env.CHAT_RATE_PER_MIN || 20);
const MAX_IMG = () => (+process.env.CHAT_MAX_IMG_MB || 5) * 1048576;
const MAX_ATT = 4;
const hits = new Map(); // userId -> [timestamps]   (in-memory per-instance rate limit)
function rateGuard(u) {
  const lim = isMod(u) ? RATE() * 3 : RATE(); const t = Date.now();
  const arr = (hits.get(u.id) || []).filter(x => t - x < 60000);
  if (arr.length >= lim) throw new ApiError(429, 'You are sending messages too fast. Please wait a minute.', 'RATE_LIMITED');
  arr.push(t); hits.set(u.id, arr);
}
const isMod = (u, level = 'read') => u.role === 'admin' || (u.role === 'staff' && LEVEL[(u.permissions || {}).support || 'none'] >= LEVEL[level]);
const isParty = (c, u) => c.customer_id === u.id || (c.kind === 'vendor' && !!u.vendor && u.role === 'vendor' && c.vendor_id === u.vendor.id);
const canSee = (c, u) => isParty(c, u) || isMod(u, 'read');
function threadOf(req) {
  const c = db.one('SELECT * FROM conversations WHERE id=?', req.params.id);
  if (!c || !canSee(c, req.user)) throw E.notFound('Conversation not found'); // 404 (not 403) so ids can't be probed
  return c;
}
const member = (cid, uid) => db.one('SELECT * FROM chat_members WHERE conversation_id=? AND user_id=?', cid, uid);
function markRead(cid, uid, upto) {
  const last = upto ?? (db.one('SELECT MAX(id) m FROM messages WHERE conversation_id=?', cid).m || 0);
  db.run('INSERT INTO chat_members(conversation_id,user_id,last_read_id) VALUES(?,?,?) ON CONFLICT(conversation_id,user_id) DO UPDATE SET last_read_id=MAX(last_read_id, excluded.last_read_id)', cid, uid, last);
}
const unreadOf = (cid, uid) => db.one("SELECT COUNT(*) n FROM messages WHERE conversation_id=? AND sender_id<>? AND deleted=0 AND COALESCE(type,'text')<>'system' AND id>COALESCE((SELECT last_read_id FROM chat_members WHERE conversation_id=? AND user_id=?),0)", cid, uid, cid, uid).n;

function cleanAttachments(list, u) {
  if (list == null || list === '') return [];
  if (!Array.isArray(list)) throw E.bad('attachments must be an array');
  if (list.length > MAX_ATT) throw E.bad(`At most ${MAX_ATT} images per message`);
  return list.map(a => {
    const url = typeof a === 'string' ? a : a?.url;
    const up = url && db.one('SELECT * FROM uploads WHERE url=? AND user_id=?', String(url), u.id);
    if (!up) throw E.bad('Attachment must be an image you uploaded via /uploads');
    if (!/^image\//.test(up.mime || '')) throw E.bad('Only image attachments are allowed in chat');
    if (up.size > MAX_IMG()) throw E.bad(`Image too large (max ${MAX_IMG() / 1048576} MB)`);
    return { url: up.url, mime: up.mime, size: up.size };
  });
}
function cleanBody(b) { return String(b ?? '').replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '').trim(); }

// Recipients for a thread (excluding sender): customer, vendor owner, and for support: admins; plus joined moderators.
function recipients(c, senderId) {
  const ids = new Set([c.customer_id]);
  if (c.kind === 'vendor') ids.add(vendorUserId(c.vendor_id));
  if (c.kind === 'support') db.all("SELECT id FROM users WHERE role='admin' AND status='active'").forEach(r => ids.add(r.id));
  db.all('SELECT user_id FROM chat_members WHERE conversation_id=? AND joined=1', c.id).forEach(r => ids.add(r.user_id));
  ids.delete(senderId); ids.delete(undefined); ids.delete(null); return [...ids];
}
// Optional FCM hook for chat — disabled unless CHAT_PUSH=1 (and FCM_SERVER_KEY configured). In-app notifications always.
function pushHook(uid, title, body, data) {
  if (process.env.CHAT_PUSH !== '1') return;
  try { require('../providers').push.send(uid, title, body, data); } catch { /* ignore */ }
}
function addMessage(c, u, body, attachments, type = 'text') {
  if (type === 'text') {
    rateGuard(u);
    body = cleanBody(body); attachments = cleanAttachments(attachments, u);
    if (!body && !attachments.length) throw E.bad('Message cannot be empty');
    if (body.length > MAX_LEN()) throw E.bad(`Message too long (max ${MAX_LEN()} characters)`);
    if (c.status === 'closed' && !isMod(u, 'write')) throw E.forbid('This conversation is closed');
  }
  const rcpts = type === 'text' ? recipients(c, u.id).filter(id => !unreadOf(c.id, id)) : []; // notify only when it becomes unread (no spam)
  const id = db.insert('messages', { conversation_id: c.id, sender_id: u.id, sender_role: u.role, type, body, attachments: attachments || [] });
  db.run('UPDATE conversations SET updated_at=CURRENT_TIMESTAMP, last_message_at=CURRENT_TIMESTAMP WHERE id=?', c.id);
  markRead(c.id, u.id, id);
  if (isMod(u) && !isParty(c, u)) db.run('UPDATE chat_members SET joined=1 WHERE conversation_id=? AND user_id=?', c.id, u.id);
  const who = u.role === 'vendor' ? (u.vendor?.business_name || u.name) : ['admin', 'staff'].includes(u.role) ? 'Mohan Mishra Support' : u.name;
  for (const r of rcpts) { const prev = body ? body.slice(0, 120) : '📷 Photo'; db.insert('notifications', { user_id: r, type: 'chat', title: 'New message from ' + (who || 'user'), body: prev, data: { conversation_id: c.id } }); pushHook(r, 'New message', prev, { conversation_id: String(c.id) }); }
  return id;
}

const LIST_SQL = `SELECT c.id, c.kind, c.status, c.customer_id, c.vendor_id, c.product_id, c.order_id, c.subject, c.created_at, c.updated_at, COALESCE(c.last_message_at, c.updated_at) last_at,
  cu.name customer_name, cu.role customer_role, v.business_name vendor_name, p.name product_name, o.order_no,
  (SELECT CASE WHEN deleted=1 THEN '[removed]' WHEN body='' THEN '📷 Photo' ELSE body END FROM messages WHERE conversation_id=c.id ORDER BY id DESC LIMIT 1) last_message,
  (SELECT COUNT(*) FROM messages m WHERE m.conversation_id=c.id AND m.sender_id<>@me AND m.deleted=0 AND COALESCE(m.type,'text')<>'system' AND m.id>COALESCE((SELECT last_read_id FROM chat_members WHERE conversation_id=c.id AND user_id=@me),0)) unread,
  (SELECT joined FROM chat_members WHERE conversation_id=c.id AND user_id=@me) joined
  FROM conversations c LEFT JOIN users cu ON cu.id=c.customer_id LEFT JOIN vendors v ON v.id=c.vendor_id AND c.kind='vendor' LEFT JOIN products p ON p.id=c.product_id LEFT JOIN orders o ON o.id=c.order_id`;
function scope(u, q = {}) {
  const w = []; const p = { me: u.id, vid: u.role === 'vendor' && u.vendor ? u.vendor.id : -1 };
  if (isMod(u) && q.scope !== 'mine') { if (q.kind) { w.push('c.kind=@kind'); p.kind = q.kind; } if (q.status) { w.push('c.status=@status'); p.status = q.status; } if (q.q) { w.push("(cu.name LIKE @q OR v.business_name LIKE @q OR c.subject LIKE @q OR p.name LIKE @q OR o.order_no LIKE @q)"); p.q = '%' + q.q + '%'; } }
  else w.push("(c.customer_id=@me OR (c.kind='vendor' AND c.vendor_id=@vid))");
  return [w.length ? ' WHERE ' + w.join(' AND ') : '', p];
}
// Which threads count toward a moderator's badge: support threads + threads they joined.
const counts = (u, t) => !isMod(u) || isParty(t, u) || t.kind === 'support' || t.joined === 1;
const shape = (t, u) => ({ ...t, title: t.kind === 'support' ? (isMod(u) && !isParty(t, u) ? `Support · ${t.customer_name || ''}` : 'Mohan Mishra Support') : (u.role === 'vendor' && t.customer_id !== u.id ? t.customer_name : t.vendor_name) || 'Conversation',
  context: t.product_name ? 'Product: ' + t.product_name : t.order_no ? 'Order ' + t.order_no : t.kind === 'support' ? 'Help & support' : (t.subject || ''), counts: counts(u, t) });

router.get('/threads', wrap((req, res) => {
  const [w, p] = scope(req.user, req.query); const lim = Math.min(+req.query.limit || 50, 200), off = Math.max(+req.query.offset || 0, 0);
  const rows = db.prepare(`${LIST_SQL}${w} ORDER BY last_at DESC, c.id DESC LIMIT ${lim} OFFSET ${off}`).all(p).map(t => shape(t, req.user));
  res.json({ data: rows, can_moderate: isMod(req.user, 'write') });
}));
router.get('/unread', wrap((req, res) => {
  const [w, p] = scope(req.user, {}); const rows = db.prepare(`${LIST_SQL}${w}`).all(p).filter(t => counts(req.user, t) && t.unread > 0);
  res.json({ total: rows.reduce((s, t) => s + t.unread, 0), threads: rows.length });
}));

function detail(c, u, after) {
  const t = shape(db.prepare(`${LIST_SQL} WHERE c.id=@id`).get({ me: u.id, id: c.id }), u);
  const msgs = db.all(`SELECT m.id, m.sender_id, m.sender_role, COALESCE(m.type,'text') type, m.body, m.attachments, m.deleted, m.created_at, us.name sender_name FROM messages m LEFT JOIN users us ON us.id=m.sender_id WHERE m.conversation_id=? AND m.id>? ORDER BY m.id DESC LIMIT 300`, c.id, after || 0).reverse()
    .map(m => ({ ...m, body: m.deleted ? '' : m.body, attachments: m.deleted ? [] : J(m.attachments, []), mine: m.sender_id === u.id,
      sender_name: ['admin', 'staff'].includes(m.sender_role) && !isMod(u) ? 'Mohan Mishra Support' : m.sender_role === 'vendor' && c.kind === 'vendor' ? (t.vendor_name || m.sender_name) : m.sender_name }));
  // other party's read pointer → "seen" ticks for my messages
  const others = db.all('SELECT last_read_id FROM chat_members WHERE conversation_id=? AND user_id<>?', c.id, u.id).map(r => r.last_read_id);
  return { ...t, unread: 0, messages: msgs, seen_upto: others.length ? Math.max(...others) : 0, can_post: c.status !== 'closed' || isMod(u, 'write'), can_moderate: isMod(u, 'write'), is_party: isParty(c, u),
    max_len: MAX_LEN(), max_image_mb: MAX_IMG() / 1048576 };
}

router.post('/threads', wrap((req, res) => {
  const u = req.user; const b = v(req.body, { kind: 'enum|in:vendor,support', product_id: 'int', order_id: 'int', vendor_id: 'int', body: 'string', message: 'string', attachments: 'json' });
  const kind = b.kind || (b.product_id || b.order_id || b.vendor_id ? 'vendor' : 'support');
  let c;
  if (kind === 'support') {
    if (!['customer', 'vendor'].includes(u.role)) throw E.forbid('Only customers and sellers can open support chats');
    c = db.one("SELECT * FROM conversations WHERE kind='support' AND customer_id=? AND status='open' ORDER BY id DESC LIMIT 1", u.id);
    if (!c) c = db.one('SELECT * FROM conversations WHERE id=?', db.insert('conversations', { customer_id: u.id, vendor_id: 0, kind: 'support', subject: 'Help & support' }));
  } else {
    if (u.role !== 'customer') throw E.forbid('Only customers can start a chat with a seller');
    let vid = b.vendor_id, subject = 'General enquiry', pid = null, oid = null;
    if (b.order_id) {
      const o = db.one('SELECT * FROM orders WHERE id=? AND customer_id=?', b.order_id, u.id); if (!o) throw E.notFound('Order not found');
      const vids = db.all('SELECT DISTINCT vendor_id FROM sub_orders WHERE order_id=?', o.id).map(r => r.vendor_id);
      if (vid && !vids.includes(vid)) throw E.bad('That seller is not part of this order');
      if (!vid) { if (vids.length !== 1) throw E.bad('vendor_id required: this order has several sellers'); vid = vids[0]; }
      oid = o.id; subject = 'Order ' + o.order_no;
    } else if (b.product_id) {
      const p = db.one('SELECT id, name, vendor_id FROM products WHERE id=?', b.product_id); if (!p) throw E.notFound('Product not found');
      if (vid && vid !== p.vendor_id) throw E.bad('Product does not belong to that seller');
      vid = p.vendor_id; pid = p.id; subject = p.name;
    }
    const vend = vid && db.one('SELECT id, status FROM vendors WHERE id=?', vid); if (!vend) throw E.notFound('Seller not found');
    c = db.one('SELECT * FROM conversations WHERE kind=\'vendor\' AND customer_id=? AND vendor_id=? AND COALESCE(product_id,0)=? AND COALESCE(order_id,0)=? ORDER BY id DESC LIMIT 1', u.id, vid, pid || 0, oid || 0);
    if (!c) c = db.one('SELECT * FROM conversations WHERE id=?', db.insert('conversations', { customer_id: u.id, vendor_id: vid, product_id: pid, order_id: oid, kind: 'vendor', subject }));
  }
  const text = b.body ?? b.message;
  if (text || (b.attachments && b.attachments.length)) addMessage(c, u, text, b.attachments);
  res.status(201).json(detail(db.one('SELECT * FROM conversations WHERE id=?', c.id), u));
}));
router.get('/threads/:id', wrap((req, res) => {
  const c = threadOf(req); const d = detail(c, req.user, +req.query.after || 0);
  if (req.query.peek !== '1') markRead(c.id, req.user.id);
  res.json(d);
}));
router.post('/threads/:id/messages', wrap((req, res) => {
  const c = threadOf(req); const u = req.user;
  if (!isParty(c, u) && !isMod(u, 'write')) throw E.forbid('Read-only access');
  const id = addMessage(c, u, req.body?.body ?? req.body?.message, req.body?.attachments);
  res.status(201).json({ id, ...detail(c, u, +req.body?.after || 0) });
}));
router.post('/threads/:id/read', wrap((req, res) => { const c = threadOf(req); markRead(c.id, req.user.id); res.json({ ok: true }); }));
// ----- moderation (admin, or staff with support:write) -----
const mod = (req, _res, next) => next(isMod(req.user, 'write') ? undefined : E.forbid('Moderator access required'));
router.post('/threads/:id/join', mod, wrap((req, res) => {
  const c = threadOf(req); const u = req.user; markRead(c.id, u.id);
  const m = member(c.id, u.id);
  if (!m.joined && !isParty(c, u)) { db.run('UPDATE chat_members SET joined=1 WHERE conversation_id=? AND user_id=?', c.id, u.id); addMessage(c, u, `${u.name || 'Support'} from Mohan Mishra Support joined the conversation`, [], 'system'); audit(req, 'chat_join', 'conversation', c.id); }
  res.json(detail(c, u));
}));
router.post('/threads/:id/status', mod, wrap((req, res) => {
  const c = threadOf(req); const b = v(req.body, { status: 'enum|required|in:open,closed' });
  if (b.status !== c.status) { db.run('UPDATE conversations SET status=? WHERE id=?', b.status, c.id); addMessage({ ...c, status: b.status }, req.user, b.status === 'closed' ? 'Conversation closed by moderator' : 'Conversation reopened', [], 'system'); audit(req, 'chat_' + b.status, 'conversation', c.id); }
  res.json(detail(db.one('SELECT * FROM conversations WHERE id=?', c.id), req.user));
}));
router.delete('/messages/:id', mod, wrap((req, res) => {
  const m = db.one('SELECT * FROM messages WHERE id=?', req.params.id); if (!m) throw E.notFound();
  if (!m.deleted) { db.run('UPDATE messages SET deleted=1, deleted_by=? WHERE id=?', req.user.id, m.id); audit(req, 'chat_message_removed', 'message', m.id, { conversation_id: m.conversation_id, sender_id: m.sender_id }); }
  res.json({ ok: true, id: m.id, deleted: 1 });
}));

module.exports = router;
