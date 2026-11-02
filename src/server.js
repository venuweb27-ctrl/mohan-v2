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
app.use('/api/v1', api);

const UP = process.env.UPLOAD_DIR || path.join(__dirname, '..', 'uploads');
app.use('/uploads', express.static(UP, { maxAge: '7d' }));
const WEB = path.join(__dirname, '..', 'web');
app.use(express.static(WEB, { index: false, maxAge: '1h', setHeaders: (res, p) => { if (/\.(js|css|html|webmanifest)$/.test(p)) res.setHeader('Cache-Control', 'no-cache'); } }));
// Android TWA / app-links verification. Configure ANDROID_PACKAGE and ANDROID_SHA256 (comma-separated fingerprints).
app.get('/.well-known/assetlinks.json', (req, res) => { const fp = String(process.env.ANDROID_SHA256 || '').split(',').map(s => s.trim()).filter(Boolean); res.json(fp.length ? [{ relation: ['delegate_permission/common.handle_all_urls'], target: { namespace: 'android_app', package_name: process.env.ANDROID_PACKAGE || 'in.mohanmishra.app', sha256_cert_fingerprints: fp } }] : []); });
app.get('/sw.js', (req, res) => { res.setHeader('Service-Worker-Allowed', '/'); res.setHeader('Cache-Control', 'no-cache'); res.sendFile(path.join(WEB, 'sw.js')); });
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
