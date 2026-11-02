const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const db = require('./db');

const JWT_SECRET = process.env.JWT_SECRET || 'dev-only-secret-change-me';
const COMPANY = () => db.setting('company', {});
const MODULES = ['customers', 'vendors', 'catalog', 'orders', 'payments', 'withdrawals', 'invoices', 'crm', 'coupons', 'refunds', 'cms', 'reports', 'staff', 'settings', 'support', 'commission'];
const LEVEL = { none: 0, read: 1, write: 2, approve: 3 };

class ApiError extends Error { constructor(status, message, code, details) { super(message); this.status = status; this.code = code || 'ERROR'; this.details = details; } }
const E = {
  bad: (m, d) => new ApiError(400, m, 'VALIDATION_ERROR', d),
  unauth: (m = 'Authentication required') => new ApiError(401, m, 'UNAUTHORIZED'),
  forbid: (m = 'Not allowed') => new ApiError(403, m, 'FORBIDDEN'),
  notFound: (m = 'Not found') => new ApiError(404, m, 'NOT_FOUND'),
  conflict: (m) => new ApiError(409, m, 'CONFLICT'),
};
const wrap = fn => (req, res, next) => { try { const r = fn(req, res, next); if (r && r.catch) r.catch(next); } catch (e) { next(e); } };
const round2 = n => Math.round((Number(n) || 0) * 100) / 100;
const J = (s, d = null) => { if (s == null) return d; if (typeof s !== 'string') return s; try { return JSON.parse(s); } catch { return d; } };
const now = () => new Date().toISOString().replace('T', ' ').slice(0, 19);
const rid = (p = '') => p + crypto.randomBytes(6).toString('hex').toUpperCase();
function seqNo(prefix) { const d = new Date(); return `${prefix}${String(d.getFullYear()).slice(2)}${String(d.getMonth() + 1).padStart(2, '0')}${crypto.randomInt(100000, 999999)}`; }

// ---------- JWT / sessions ----------
function signToken(user, req) {
  const jti = crypto.randomUUID();
  db.insert('sessions', { id: jti, user_id: user.id, ip: req?.ip, ua: req?.headers?.['user-agent']?.slice(0, 200) });
  return jwt.sign({ sub: user.id, role: user.role, jti }, JWT_SECRET, { expiresIn: process.env.JWT_EXPIRES || '7d' });
}
function loadUser(id) {
  const u = db.one('SELECT * FROM users WHERE id=?', id); if (!u) return null;
  if (u.role === 'vendor') { u.vendor = db.one('SELECT * FROM vendors WHERE user_id=?', u.id); if (!u.vendor) { const vs = db.one('SELECT * FROM vendor_staff WHERE user_id=?', u.id); if (vs) { u.vendor = db.one('SELECT * FROM vendors WHERE id=?', vs.vendor_id); u.vendor_staff_role = vs.role; } } }
  if (u.role === 'staff' && u.staff_role_id) { const r = db.one('SELECT * FROM staff_roles WHERE id=?', u.staff_role_id); u.staff_role = r?.name; u.permissions = J(r?.permissions, {}); }
  if (u.role === 'admin') u.permissions = Object.fromEntries(MODULES.map(m => [m, 'approve']));
  return u;
}
function optionalAuth(req, _res, next) {
  const h = req.headers.authorization || '';
  const t = h.startsWith('Bearer ') ? h.slice(7) : null;
  if (t) {
    try {
      const p = jwt.verify(t, JWT_SECRET);
      const s = db.one('SELECT * FROM sessions WHERE id=?', p.jti);
      if (s && !s.revoked) { const u = loadUser(p.sub); if (u && !['blocked'].includes(u.status)) { req.user = u; req.jti = p.jti; db.run('UPDATE sessions SET last_seen=CURRENT_TIMESTAMP WHERE id=?', p.jti); } }
    } catch { /* ignore */ }
  }
  next();
}
const auth = (...roles) => (req, _res, next) => {
  if (!req.user) return next(E.unauth());
  if (req.user.status === 'inactive' && !req.path.includes('/me')) { /* deactivated accounts can still reactivate via /me */ }
  if (roles.length && !roles.includes(req.user.role) && !(roles.includes('admin') && req.user.role === 'staff')) return next(E.forbid('Role not permitted'));
  next();
};
// staff/admin module permission
const perm = (module, level = 'read') => (req, _res, next) => {
  const u = req.user; if (!u) return next(E.unauth());
  if (u.role === 'admin') return next();
  if (u.role !== 'staff') return next(E.forbid());
  const have = LEVEL[(u.permissions || {})[module] || 'none'];
  if (have < LEVEL[level]) return next(E.forbid(`Requires ${level} permission on ${module}`));
  next();
};
const vendorOnly = (req, _res, next) => {
  if (!req.user || req.user.role !== 'vendor' || !req.user.vendor) return next(E.forbid('Vendor account required'));
  req.vendor = req.user.vendor; next();
};
const activeVendor = (req, _res, next) => { if (req.vendor.status !== 'active') return next(E.forbid('Vendor account is not active (status: ' + req.vendor.status + ')')); next(); };

// ---------- validation ----------
function v(body, rules) {
  const errs = {}; const out = {};
  for (const [k, r] of Object.entries(rules)) {
    let val = body?.[k];
    const [type, ...flags] = r.split('|');
    const req = flags.includes('required');
    if (val === undefined || val === null || val === '') { if (req) errs[k] = 'required'; continue; }
    if (type === 'string') { val = String(val).trim(); const max = flags.find(f => f.startsWith('max:')); if (max && val.length > +max.slice(4)) errs[k] = 'too long'; }
    if (type === 'number' || type === 'int') { val = Number(val); if (!isFinite(val)) { errs[k] = 'must be a number'; continue; } if (type === 'int') val = Math.trunc(val); const min = flags.find(f => f.startsWith('min:')); if (min && val < +min.slice(4)) errs[k] = 'min ' + min.slice(4); }
    if (type === 'email' && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(val)) errs[k] = 'invalid email';
    if (type === 'mobile') { val = String(val).replace(/\D/g, '').slice(-10); if (!/^[6-9]\d{9}$/.test(val)) errs[k] = 'invalid Indian mobile'; }
    if (type === 'gstin') { val = String(val).toUpperCase().trim(); if (!/^\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/.test(val)) errs[k] = 'invalid GSTIN'; }
    if (type === 'pan') { val = String(val).toUpperCase().trim(); if (!/^[A-Z]{5}\d{4}[A-Z]$/.test(val)) errs[k] = 'invalid PAN'; }
    if (type === 'enum') { const opts = flags.find(f => f.startsWith('in:')).slice(3).split(','); if (!opts.includes(val)) errs[k] = 'must be one of ' + opts.join(','); }
    if (type === 'bool') val = val === true || val === 1 || val === '1' || val === 'true';
    if (type === 'json' && typeof val === 'string') { try { val = JSON.parse(val); } catch { errs[k] = 'invalid JSON'; } }
    out[k] = val;
  }
  if (Object.keys(errs).length) throw E.bad('Validation failed', errs);
  return out;
}
function paginate(req, maxLimit = 100) {
  const page = Math.max(1, parseInt(req.query.page) || 1);
  const limit = Math.min(maxLimit, Math.max(1, parseInt(req.query.limit) || 20));
  return { page, limit, offset: (page - 1) * limit };
}
function pageResult(sql, params, req, map = x => x) {
  const { page, limit, offset } = paginate(req);
  const total = db.prepare(`SELECT COUNT(*) c FROM (${sql}) t`).get(...params).c;
  const items = db.prepare(`${sql} LIMIT ? OFFSET ?`).all(...params, limit, offset).map(map);
  return { items, page, limit, total, pages: Math.ceil(total / limit) };
}

// ---------- GST ----------
const STATES = { '01': 'Jammu & Kashmir', '02': 'Himachal Pradesh', '03': 'Punjab', '04': 'Chandigarh', '05': 'Uttarakhand', '06': 'Haryana', '07': 'Delhi', '08': 'Rajasthan', '09': 'Uttar Pradesh', '10': 'Bihar', '18': 'Assam', '19': 'West Bengal', '20': 'Jharkhand', '21': 'Odisha', '22': 'Chhattisgarh', '23': 'Madhya Pradesh', '24': 'Gujarat', '27': 'Maharashtra', '29': 'Karnataka', '30': 'Goa', '32': 'Kerala', '33': 'Tamil Nadu', '36': 'Telangana', '37': 'Andhra Pradesh' };
const stateCodeOf = (name) => { if (!name) return null; if (/^\d{2}$/.test(name)) return name; const e = Object.entries(STATES).find(([, n]) => n.toLowerCase() === String(name).toLowerCase()); return e ? e[0] : null; };
function gstSplit(taxable, rate, sellerState, posState) {
  const tax = round2(taxable * rate / 100);
  if (sellerState && posState && sellerState === posState) { const h = round2(tax / 2); return { cgst: h, sgst: round2(tax - h), igst: 0, tax }; }
  return { cgst: 0, sgst: 0, igst: tax, tax };
}
function fyOf(d = new Date()) { const y = d.getFullYear(); const m = d.getMonth() + 1; const s = m >= 4 ? y : y - 1; return `${String(s).slice(2)}-${String(s + 1).slice(2)}`; }
function nextNumber(prefix) {
  const fy = fyOf();
  db.run('INSERT INTO invoice_counters(prefix,fy,seq) VALUES(?,?,0) ON CONFLICT(prefix,fy) DO NOTHING', prefix, fy);
  db.run('UPDATE invoice_counters SET seq=seq+1 WHERE prefix=? AND fy=?', prefix, fy);
  const s = db.one('SELECT seq FROM invoice_counters WHERE prefix=? AND fy=?', prefix, fy).seq;
  return { no: `${prefix}/${fy}/${String(s).padStart(5, '0')}`, fy };
}

// ---------- double-entry ledger ----------
// lines: [{account, debit, credit}] must balance.
function post(lines, ref_type, ref_id, narration) {
  const d = round2(lines.reduce((a, l) => a + (l.debit || 0), 0)), c = round2(lines.reduce((a, l) => a + (l.credit || 0), 0));
  if (Math.abs(d - c) > 0.01) throw new Error(`Unbalanced ledger txn ${d} != ${c}`);
  const txn = rid('TX');
  for (const l of lines) if ((l.debit || 0) || (l.credit || 0)) db.insert('ledger_entries', { txn_id: txn, account: l.account, debit: round2(l.debit || 0), credit: round2(l.credit || 0), ref_type, ref_id, narration });
  return txn;
}
const balance = (account) => round2(db.one('SELECT COALESCE(SUM(credit-debit),0) b FROM ledger_entries WHERE account=?', account).b);
const ACC = { avail: id => `vendor:${id}:available`, hold: id => `vendor:${id}:onhold`, escrow: 'platform:escrow', clearing: 'gateway:clearing', commission: 'platform:commission', gst: 'platform:gst_payable', fees: 'platform:gateway_fees', bank: 'platform:bank', tcs: 'platform:tcs_payable', tds: 'platform:tds_payable', deposits: 'platform:security_deposits', platformFee: 'platform:fees_income' };

// ---------- notifications / audit ----------
let pushAdapter = null;
function notify(user_id, type, title, body, data) {
  if (!user_id) return;
  db.insert('notifications', { user_id, type, title, body, data: data || null });
  try { if (!pushAdapter) pushAdapter = require('./providers').push; pushAdapter.send(user_id, title, body, data); } catch (e) { /* ignore */ }
}
const notifyAdmins = (type, title, body, data) => db.all("SELECT id FROM users WHERE role='admin' AND status='active'").forEach(u => notify(u.id, type, title, body, data));
const vendorUserId = vid => db.one('SELECT user_id FROM vendors WHERE id=?', vid)?.user_id;
function audit(req, action, entity, entity_id, meta) {
  db.insert('audit_logs', { user_id: req?.user?.id || null, role: req?.user?.role || 'system', action, entity, entity_id: entity_id == null ? null : String(entity_id), meta: meta || null, ip: req?.ip || null });
}
const publicUser = u => { if (!u) return u; const { password_hash, ...r } = u; r.notif_prefs = J(r.notif_prefs, {}); return r; };

module.exports = { db, JWT_SECRET, MODULES, LEVEL, ApiError, E, wrap, round2, J, now, rid, seqNo, signToken, loadUser, optionalAuth, auth, perm, vendorOnly, activeVendor, v, paginate, pageResult, STATES, stateCodeOf, gstSplit, fyOf, nextNumber, post, balance, ACC, notify, notifyAdmins, vendorUserId, audit, publicUser, COMPANY };
