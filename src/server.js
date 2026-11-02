const express = require('express');
const path = require('path');
const helmet = require('helmet');
const cors = require('cors');
const rateLimit = require('express-rate-limit');
const { db, optionalAuth, ApiError } = require('./core');

if (!db.one('SELECT COUNT(*) c FROM users').c && process.env.AUTO_SEED !== '0') require('./seed');

const app = express();
app.set('trust proxy', 1);
app.disable('x-powered-by');
app.use(helmet({ contentSecurityPolicy: { directives: { defaultSrc: ["'self'"], scriptSrc: ["'self'", "'unsafe-inline'"], scriptSrcAttr: ["'unsafe-inline'"], frameSrc: ["'self'", 'blob:'], objectSrc: ["'self'", 'blob:'], styleSrc: ["'self'", "'unsafe-inline'"], imgSrc: ["'self'", 'data:', 'blob:'], connectSrc: ["'self'"], frameAncestors: ["'none'"] } }, crossOriginEmbedderPolicy: false }));
app.use(cors({ origin: (process.env.CORS_ORIGINS || '*') === '*' ? true : process.env.CORS_ORIGINS.split(','), credentials: false }));
app.use(express.json({ limit: '2mb', verify: (req, _res, buf) => { req.rawBody = buf.toString('utf8'); } }));
app.use(express.urlencoded({ extended: false }));

const lim = (max, windowMs = 60000) => rateLimit({ windowMs, max, standardHeaders: 'draft-7', legacyHeaders: false, message: { error: { code: 'RATE_LIMITED', message: 'Too many requests, slow down.' } } });
const TEST = process.env.NODE_ENV === 'test';
app.use('/api/', lim(TEST ? 100000 : +(process.env.RATE_LIMIT_PER_MIN || 300)));
app.use(['/api/v1/auth/otp', '/api/v1/auth/login', '/api/v1/auth/forgot-password'], lim(TEST ? 100000 : 20));

const api = express.Router();
api.use(optionalAuth);
api.get('/health', (req, res) => res.json({ ok: true, name: 'mohanmishra-v2', version: require('../package.json').version, time: new Date().toISOString(), db: db.one('SELECT COUNT(*) c FROM products').c >= 0 }));
api.use('/auth', require('./routes/auth'));
api.use('/vendor', require('./routes/vendor'));
api.use('/admin', require('./routes/admin'));
api.use('/', require('./routes/catalog'));
api.use('/', require('./routes/payments'));
api.use('/', require('./routes/common'));
api.use('/', require('./routes/customer'));
api.use((req, res) => res.status(404).json({ error: { code: 'NOT_FOUND', message: 'No such endpoint' } }));
// Public account-deletion request intake (Play Store requirement; additive)
db.run(`CREATE TABLE IF NOT EXISTS deletion_requests (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT, contact TEXT NOT NULL, reason TEXT, user_id INTEGER, ip TEXT, status TEXT DEFAULT 'pending', created_at TEXT DEFAULT CURRENT_TIMESTAMP)`);
app.post('/api/v1/public/deletion-request', express.json({ limit: '16kb' }), (req, res) => {
  const name = String(req.body?.name || '').trim().slice(0, 120), contact = String(req.body?.contact || '').trim().slice(0, 160), reason = String(req.body?.reason || '').trim().slice(0, 1000);
  if (!contact || contact.length < 5) return res.status(400).json({ error: { code: 'VALIDATION', message: 'Enter your registered mobile number or email' } });
  const u = db.one('SELECT id FROM users WHERE lower(email)=lower(?) OR mobile=? OR mobile=?', contact, contact, contact.replace(/\D/g, '').slice(-10));
  const r = db.run('INSERT INTO deletion_requests (name,contact,reason,user_id,ip) VALUES (?,?,?,?,?)', name, contact, reason, u ? u.id : null, req.ip);
  res.status(201).json({ ok: true, id: Number(r.lastInsertRowid), message: 'Deletion request received' });
});
app.use('/api/v1', api);

const UP = process.env.UPLOAD_DIR || path.join(__dirname, '..', 'uploads');
app.use('/uploads', express.static(UP, { maxAge: '7d' }));
const WEB = path.join(__dirname, '..', 'web');
app.use(express.static(WEB, { index: false, maxAge: '1h', setHeaders: (res, p) => { if (/\.(js|css|html|webmanifest)$/.test(p)) res.setHeader('Cache-Control', 'no-cache'); } }));
// Android app-links verification. Defaults: package com.app.mmpl; Play App Signing cert + upload-key cert (sideload builds).
// Override with ANDROID_PACKAGE / ANDROID_SHA256 (comma-separated fingerprints).
app.get('/.well-known/assetlinks.json', (req, res) => { const fp = String(process.env.ANDROID_SHA256 || '68:D0:66:C1:D3:E9:30:1D:32:4D:F5:74:2B:5E:0C:DC:24:D3:3B:50:85:6B:32:35:10:BD:58:33:62:43:59:47,F0:EF:2B:C3:AA:5B:22:03:E1:80:39:D7:E9:EA:3E:71:0C:CC:85:2C:D2:86:31:F1:36:88:28:36:D6:BD:26:53').split(',').map(s => s.trim()).filter(Boolean); res.json(fp.length ? [{ relation: ['delegate_permission/common.handle_all_urls'], target: { namespace: 'android_app', package_name: process.env.ANDROID_PACKAGE || 'com.app.mmpl', sha256_cert_fingerprints: fp } }] : []); });
app.get('/sw.js', (req, res) => { res.setHeader('Service-Worker-Allowed', '/'); res.setHeader('Cache-Control', 'no-cache'); res.sendFile(path.join(WEB, 'sw.js')); });
// Legal pages (Play Store listing: privacy policy, terms, account deletion) + public deletion-request intake (additive).
for (const [u, f] of [['/privacy', 'privacy.html'], ['/terms', 'terms.html'], ['/delete-account', 'delete-account.html']]) app.get(u, (req, res) => { res.setHeader('Cache-Control', 'no-cache'); res.sendFile(path.join(WEB, f)); });
const spa = (req, res) => res.sendFile(path.join(WEB, 'index.html'));
app.get(['/', '/vendor', '/vendor/*', '/admin', '/admin/*'], spa);

app.use((err, req, res, _next) => {
  if (err instanceof ApiError || err.status) return res.status(err.status || 400).json({ error: { code: err.code || 'ERROR', message: err.message, details: err.details } });
  if (err.type === 'entity.parse.failed') return res.status(400).json({ error: { code: 'BAD_JSON', message: 'Invalid JSON body' } });
  if (err.code === 'LIMIT_FILE_SIZE') return res.status(413).json({ error: { code: 'FILE_TOO_LARGE', message: 'File too large' } });
  console.error(err);
  res.status(500).json({ error: { code: 'INTERNAL', message: process.env.NODE_ENV === 'production' ? 'Internal error' : err.message } });
});

const PORT = +process.env.PORT || 4100;
if (require.main === module) app.listen(PORT, () => console.log(`Mohan Mishra v2 on :${PORT}`));
module.exports = app;
