const router = require('express').Router();
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const { db, E, wrap, v, signToken, loadUser, auth, audit, publicUser, notify, stateCodeOf, J } = require('../core');
const providers = require('../providers');
const DEV = process.env.NODE_ENV !== 'production' || process.env.EXPOSE_DEV_OTP === '1';

const normTarget = t => { t = String(t || '').trim(); if (t.includes('@')) return t.toLowerCase(); const m = t.replace(/\D/g, '').slice(-10); if (!/^[6-9]\d{9}$/.test(m)) throw E.bad('Enter a valid 10-digit mobile number or email'); return m; };
async function sendOtp(target, purpose) {
  const recent = db.one("SELECT COUNT(*) c FROM otps WHERE target=? AND created_at > datetime('now','-10 minutes')", target).c;
  if (recent >= 5) throw E.bad('Too many OTP requests, try again later');
  const code = process.env.FIXED_OTP || String(crypto.randomInt(100000, 999999));
  db.insert('otps', { target, purpose, code_hash: bcrypt.hashSync(code, 8), expires_at: new Date(Date.now() + 10 * 60000).toISOString() });
  const r = await providers.otp.send(target, code, purpose);
  return { sent: true, provider: r.provider, expires_in: 600, ...(DEV && r.provider === 'mock' || DEV && target.includes('@') ? { dev_code: code } : {}) };
}
function checkOtp(target, purpose, code) {
  const o = db.one('SELECT * FROM otps WHERE target=? AND purpose=? AND used=0 ORDER BY id DESC', target, purpose);
  if (!o || o.expires_at < new Date().toISOString()) throw E.bad('OTP expired or not requested');
  if (o.attempts >= 5) throw E.bad('Too many wrong attempts; request a new OTP');
  if (!bcrypt.compareSync(String(code || ''), o.code_hash)) { db.run('UPDATE otps SET attempts=attempts+1 WHERE id=?', o.id); throw E.bad('Incorrect OTP'); }
  db.run('UPDATE otps SET used=1 WHERE id=?', o.id);
}
function loginOk(req, user, method) {
  if (user.status === 'blocked') { db.insert('login_history', { user_id: user.id, method, success: 0, ip: req.ip, ua: req.headers['user-agent'] }); throw E.forbid('Account blocked. Contact support.'); }
  db.insert('login_history', { user_id: user.id, method, success: 1, ip: req.ip, ua: req.headers['user-agent'] });
  const token = signToken(user, req);
  return { token, user: publicUser(loadUser(user.id)) };
}
const findBy = t => t.includes('@') ? db.one('SELECT * FROM users WHERE email=?', t) : db.one('SELECT * FROM users WHERE mobile=?', t);

router.post('/otp/send', wrap(async (req, res) => {
  const { target, purpose = 'login' } = req.body;
  const t = normTarget(target);
  if (!['login', 'register', 'verify', 'reset'].includes(purpose)) throw E.bad('Invalid purpose');
  res.json(await sendOtp(t, purpose));
}));
// OTP login; auto-registers a customer if the number/email is new
router.post('/otp/verify', wrap(async (req, res) => {
  const t = normTarget(req.body.target);
  checkOtp(t, req.body.purpose || 'login', req.body.code);
  let user = findBy(t); let is_new = false;
  if (!user) {
    const b = v(req.body, { name: 'string|max:100', account_type: 'enum|in:individual,business', business_name: 'string|max:150', gstin: 'gstin', pan: 'pan', email: 'email' });
    const id = db.insert('users', { role: 'customer', name: b.name || 'Customer', mobile: t.includes('@') ? null : t, email: t.includes('@') ? t : (b.email || null), mobile_verified: t.includes('@') ? 0 : 1, email_verified: t.includes('@') ? 1 : 0, account_type: b.account_type || 'individual', business_name: b.business_name, gstin: b.gstin, pan: b.pan, state_code: b.gstin ? b.gstin.slice(0, 2) : null });
    user = db.one('SELECT * FROM users WHERE id=?', id); is_new = true;
    notify(id, 'welcome', 'Welcome to Mohan Mishra', 'Your account has been created. Explore machinery from verified vendors.');
  } else if (t.includes('@')) db.run('UPDATE users SET email_verified=1 WHERE id=?', user.id); else db.run('UPDATE users SET mobile_verified=1 WHERE id=?', user.id);
  res.json({ ...loginOk(req, user, 'otp'), is_new });
}));
router.post('/register', wrap(async (req, res) => {
  const b = v(req.body, { name: 'string|required|max:100', mobile: 'mobile|required', email: 'email', password: 'string|required|max:100', otp: 'string|required', account_type: 'enum|in:individual,business', business_name: 'string', gstin: 'gstin', pan: 'pan' });
  if (b.password.length < 8) throw E.bad('Password must be at least 8 characters');
  if (db.one('SELECT id FROM users WHERE mobile=? OR (email IS NOT NULL AND email=?)', b.mobile, b.email || '')) throw E.conflict('Mobile or email already registered');
  checkOtp(b.mobile, 'register', b.otp);
  if (b.account_type === 'business' && !b.business_name) throw E.bad('Business name required for business accounts');
  const id = db.insert('users', { role: 'customer', name: b.name, mobile: b.mobile, email: b.email ? b.email.toLowerCase() : null, password_hash: bcrypt.hashSync(b.password, 10), mobile_verified: 1, account_type: b.account_type || 'individual', business_name: b.business_name, gstin: b.gstin, pan: b.pan, state_code: b.gstin ? b.gstin.slice(0, 2) : null });
  const user = db.one('SELECT * FROM users WHERE id=?', id);
  notify(id, 'welcome', 'Registration successful', 'Welcome to Mohan Mishra!');
  if (b.email) { await sendOtp(b.email.toLowerCase(), 'verify'); }
  res.status(201).json(loginOk(req, user, 'register'));
}));
router.post('/login', wrap(async (req, res) => {
  const { identifier, password } = req.body;
  const t = normTarget(identifier);
  const user = findBy(t);
  if (!user || !user.password_hash || !bcrypt.compareSync(String(password || ''), user.password_hash)) { db.insert('login_history', { user_id: user?.id, identifier: t, method: 'password', success: 0, ip: req.ip }); throw E.unauth('Invalid credentials'); }
  res.json(loginOk(req, user, 'password'));
}));
router.post('/google', wrap(async (req, res) => {
  let g; try { g = await providers.google.verify(req.body.id_token); } catch (e) { throw E.unauth(e.message); }
  let user = db.one('SELECT * FROM users WHERE google_id=? OR email=?', g.sub, g.email); let is_new = false;
  if (!user) { const id = db.insert('users', { role: 'customer', name: g.name, email: g.email, google_id: g.sub, email_verified: g.email_verified ? 1 : 0 }); user = db.one('SELECT * FROM users WHERE id=?', id); is_new = true; }
  else if (!user.google_id) db.run('UPDATE users SET google_id=? WHERE id=?', g.sub, user.id);
  res.json({ ...loginOk(req, user, 'google'), is_new });
}));
router.post('/forgot-password', wrap(async (req, res) => {
  const t = normTarget(req.body.identifier);
  const user = findBy(t);
  if (!user) return res.json({ sent: true }); // don't leak existence
  res.json(await sendOtp(t, 'reset'));
}));
router.post('/reset-password', wrap(async (req, res) => {
  const t = normTarget(req.body.identifier);
  const pw = String(req.body.new_password || ''); if (pw.length < 8) throw E.bad('Password must be at least 8 characters');
  checkOtp(t, 'reset', req.body.code);
  const user = findBy(t); if (!user) throw E.notFound();
  db.run('UPDATE users SET password_hash=? WHERE id=?', bcrypt.hashSync(pw, 10), user.id);
  db.run('UPDATE sessions SET revoked=1 WHERE user_id=?', user.id);
  audit({ user, ip: req.ip }, 'password_reset', 'user', user.id);
  res.json({ ok: true });
}));
router.post('/logout', auth(), wrap((req, res) => { db.run('UPDATE sessions SET revoked=1 WHERE id=?', req.jti); res.json({ ok: true }); }));

// ----- me -----
router.get('/me', auth(), (req, res) => res.json({ user: publicUser(req.user), addresses: db.all('SELECT * FROM addresses WHERE user_id=? ORDER BY is_default DESC, id DESC', req.user.id) }));
router.patch('/me', auth(), wrap((req, res) => {
  const b = v(req.body, { name: 'string|max:100', email: 'email', account_type: 'enum|in:individual,business', business_name: 'string|max:150', gstin: 'gstin', pan: 'pan', avatar: 'string', notif_prefs: 'json' });
  if (b.email && db.one('SELECT id FROM users WHERE email=? AND id<>?', b.email.toLowerCase(), req.user.id)) throw E.conflict('Email already in use');
  if (b.email && b.email.toLowerCase() !== req.user.email) { b.email = b.email.toLowerCase(); b.email_verified = 0; }
  if (b.gstin) b.state_code = b.gstin.slice(0, 2);
  db.update('users', req.user.id, { ...b, updated_at: new Date().toISOString() });
  res.json({ user: publicUser(loadUser(req.user.id)) });
}));
router.post('/me/verify-email/send', auth(), wrap(async (req, res) => { if (!req.user.email) throw E.bad('No email on account'); res.json(await sendOtp(req.user.email, 'verify')); }));
router.post('/me/verify-email', auth(), wrap((req, res) => { checkOtp(req.user.email, 'verify', req.body.code); db.run('UPDATE users SET email_verified=1 WHERE id=?', req.user.id); res.json({ ok: true }); }));
router.post('/me/change-password', auth(), wrap((req, res) => {
  const { current_password, new_password } = req.body;
  if (req.user.password_hash && !bcrypt.compareSync(String(current_password || ''), req.user.password_hash)) throw E.bad('Current password incorrect');
  if (String(new_password || '').length < 8) throw E.bad('Password must be at least 8 characters');
  db.run('UPDATE users SET password_hash=? WHERE id=?', bcrypt.hashSync(new_password, 10), req.user.id); res.json({ ok: true });
}));
router.post('/me/deactivate', auth(), wrap((req, res) => { db.run("UPDATE users SET status='inactive' WHERE id=?", req.user.id); audit(req, 'deactivate', 'user', req.user.id); res.json({ ok: true, status: 'inactive' }); }));
router.post('/me/activate', auth(), wrap((req, res) => { if (req.user.status === 'blocked') throw E.forbid(); db.run("UPDATE users SET status='active' WHERE id=?", req.user.id); res.json({ ok: true, status: 'active' }); }));
router.post('/me/delete-request', auth(), wrap((req, res) => { db.run("UPDATE users SET status='deletion_requested' WHERE id=?", req.user.id); audit(req, 'deletion_request', 'user', req.user.id, { reason: req.body.reason }); res.json({ ok: true, status: 'deletion_requested', message: 'Your deletion request has been received and will be processed within 30 days.' }); }));
router.get('/me/sessions', auth(), (req, res) => res.json({ items: db.all('SELECT id,ip,ua,created_at,last_seen,revoked FROM sessions WHERE user_id=? ORDER BY created_at DESC LIMIT 50', req.user.id).map(s => ({ ...s, current: s.id === req.jti })) }));
router.delete('/me/sessions/:id', auth(), (req, res) => { db.run('UPDATE sessions SET revoked=1 WHERE id=? AND user_id=?', req.params.id, req.user.id); res.json({ ok: true }); });
router.get('/me/login-history', auth(), (req, res) => res.json({ items: db.all('SELECT method,success,ip,ua,created_at FROM login_history WHERE user_id=? ORDER BY id DESC LIMIT 50', req.user.id) }));
router.post('/me/device-token', auth(), (req, res) => { db.run('INSERT INTO device_tokens(token,user_id,platform) VALUES(?,?,?) ON CONFLICT(token) DO UPDATE SET user_id=excluded.user_id', String(req.body.token), req.user.id, req.body.platform || 'android'); res.json({ ok: true }); });

// ----- addresses -----
const addrRules = { label: 'string|max:40', kind: 'enum|in:billing,shipping,both', name: 'string|required|max:100', mobile: 'mobile|required', line1: 'string|required|max:200', line2: 'string|max:200', city: 'string|required', state: 'string|required', pincode: 'string|required', gstin: 'gstin', lat: 'number', lng: 'number', is_default: 'bool' };
router.get('/me/addresses', auth(), (req, res) => res.json({ items: db.all('SELECT * FROM addresses WHERE user_id=? ORDER BY is_default DESC, id', req.user.id) }));
router.post('/me/addresses', auth(), wrap((req, res) => {
  const b = v(req.body, addrRules); if (!/^\d{6}$/.test(b.pincode)) throw E.bad('Invalid pincode');
  b.state_code = stateCodeOf(b.state); if (!b.state_code) throw E.bad('Unknown state');
  if (b.is_default || !db.one('SELECT id FROM addresses WHERE user_id=?', req.user.id)) { db.run('UPDATE addresses SET is_default=0 WHERE user_id=?', req.user.id); b.is_default = 1; }
  const id = db.insert('addresses', { ...b, user_id: req.user.id });
  res.status(201).json(db.one('SELECT * FROM addresses WHERE id=?', id));
}));
router.put('/me/addresses/:id', auth(), wrap((req, res) => {
  const a = db.one('SELECT * FROM addresses WHERE id=? AND user_id=?', req.params.id, req.user.id); if (!a) throw E.notFound();
  const b = v({ ...a, ...req.body }, addrRules); b.state_code = stateCodeOf(b.state);
  if (b.is_default) db.run('UPDATE addresses SET is_default=0 WHERE user_id=?', req.user.id);
  db.update('addresses', a.id, b); res.json(db.one('SELECT * FROM addresses WHERE id=?', a.id));
}));
router.delete('/me/addresses/:id', auth(), (req, res) => { db.run('DELETE FROM addresses WHERE id=? AND user_id=?', req.params.id, req.user.id); res.json({ ok: true }); });

module.exports = router;
module.exports.sendOtp = sendOtp; module.exports.checkOtp = checkOtp; module.exports.normTarget = normTarget;
