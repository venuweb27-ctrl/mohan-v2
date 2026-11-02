// Pluggable third-party adapters. Every adapter has a 'mock' mode used when keys are absent.
const crypto = require('crypto');
const db = require('./db');
const env = process.env;
const log = (...a) => { if (env.NODE_ENV !== 'test' && !env.QUIET) console.log('[provider]', ...a); };
const outbox = (channel, recipient, subject, body, provider, status = 'sent') => db.insert('outbox', { channel, recipient, subject, body, provider, status });
const hmac = (secret, data, enc = 'hex') => crypto.createHmac('sha256', secret).update(data).digest(enc);
const safeEq = (a, b) => { a = Buffer.from(String(a || '')); b = Buffer.from(String(b || '')); return a.length === b.length && crypto.timingSafeEqual(a, b); };

// ---------- OTP / SMS ----------
const otp = {
  name: env.OTP_PROVIDER || 'mock',
  async send(target, code, purpose) {
    const isEmail = target.includes('@');
    if (isEmail) return email.send(target, `Your Mohan Mishra code: ${code}`, `Your verification code for ${purpose} is ${code}. It expires in 10 minutes.`);
    if (this.name === 'msg91' && env.MSG91_AUTH_KEY) {
      const r = await fetch(`https://control.msg91.com/api/v5/otp?template_id=${env.MSG91_TEMPLATE_ID}&mobile=91${target}&otp=${code}`, { method: 'POST', headers: { authkey: env.MSG91_AUTH_KEY } });
      outbox('sms', target, 'OTP', 'msg91 status ' + r.status, 'msg91'); return { provider: 'msg91', ok: r.ok };
    }
    if (this.name === '2factor' && env.TWOFACTOR_API_KEY) {
      const r = await fetch(`https://2factor.in/API/V1/${env.TWOFACTOR_API_KEY}/SMS/+91${target}/${code}/${env.TWOFACTOR_TEMPLATE || 'OTP1'}`);
      outbox('sms', target, 'OTP', '2factor status ' + r.status, '2factor'); return { provider: '2factor', ok: r.ok };
    }
    log(`OTP for ${target} (${purpose}): ${code}`); outbox('sms', target, 'OTP', `code ${code}`, 'mock'); return { provider: 'mock', ok: true };
  },
};
// ---------- Email ----------
const email = {
  name: env.SMTP_HOST || env.EMAIL_API_KEY ? 'smtp' : 'mock',
  async send(to, subject, body) {
    // Real SMTP/Email API: plug nodemailer/SendGrid here. Mock records to outbox.
    outbox('email', to, subject, body, this.name, this.name === 'mock' ? 'logged' : 'queued');
    log(`email -> ${to}: ${subject}`); return { provider: this.name, ok: true };
  },
};
// ---------- WhatsApp ----------
const whatsapp = {
  name: env.WHATSAPP_TOKEN ? 'cloud_api' : 'mock',
  async send(to, text) {
    if (this.name === 'cloud_api') {
      const r = await fetch(`https://graph.facebook.com/v19.0/${env.WHATSAPP_PHONE_ID}/messages`, { method: 'POST', headers: { Authorization: `Bearer ${env.WHATSAPP_TOKEN}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ messaging_product: 'whatsapp', to: '91' + to, type: 'text', text: { body: text } }) });
      outbox('whatsapp', to, '', text, 'cloud_api', r.ok ? 'sent' : 'failed'); return { ok: r.ok };
    }
    outbox('whatsapp', to, '', text, 'mock', 'logged'); return { ok: true, provider: 'mock', link: `https://wa.me/91${to}?text=${encodeURIComponent(text)}` };
  },
};
// ---------- Push (FCM) ----------
const push = {
  name: env.FCM_SERVER_KEY ? 'fcm' : 'mock',
  send(user_id, title, body, data) {
    const tokens = db.all('SELECT token FROM device_tokens WHERE user_id=?', user_id).map(r => r.token);
    if (!tokens.length) return;
    if (this.name === 'fcm') {
      // Legacy HTTP API shape; swap for FCM HTTP v1 with a service account in production.
      fetch('https://fcm.googleapis.com/fcm/send', { method: 'POST', headers: { Authorization: 'key=' + env.FCM_SERVER_KEY, 'Content-Type': 'application/json' }, body: JSON.stringify({ registration_ids: tokens, notification: { title, body }, data: data || {} }) }).catch(() => {});
    } else outbox('push', tokens.join(','), title, body, 'mock', 'logged');
  },
};
// ---------- Google Sign-In ----------
// Google Identity Services ID-token verification.
// Real mode: GOOGLE_CLIENT_ID set → token checked via Google's tokeninfo endpoint (signature/expiry checked by Google), then aud/iss/exp/email_verified here.
// Mock mode (tests/dev only): NODE_ENV=test or GOOGLE_MOCK=1 → token "mock:<email>:<name>[:unverified]". Never active in production unless explicitly enabled.
const google = {
  enabled: () => !!env.GOOGLE_CLIENT_ID || google.mock(),
  mock: () => !env.GOOGLE_CLIENT_ID && (env.NODE_ENV === 'test' || env.GOOGLE_MOCK === '1'),
  fetchTokenInfo: async idToken => { const r = await fetch('https://oauth2.googleapis.com/tokeninfo?id_token=' + encodeURIComponent(idToken)); if (!r.ok) throw new Error('Invalid Google token'); return r.json(); },
  async verify(idToken) {
    idToken = String(idToken || ''); if (!idToken) throw new Error('Missing Google credential');
    if (env.GOOGLE_CLIENT_ID) {
      const p = await google.fetchTokenInfo(idToken);
      const auds = env.GOOGLE_CLIENT_ID.split(',').map(s => s.trim());
      if (!auds.includes(p.aud)) throw new Error('Google token audience mismatch');
      if (!['accounts.google.com', 'https://accounts.google.com'].includes(p.iss)) throw new Error('Google token issuer mismatch');
      if (p.exp && +p.exp * 1000 < Date.now()) throw new Error('Google token expired');
      return { sub: p.sub, email: String(p.email || '').toLowerCase(), name: p.name, email_verified: p.email_verified === 'true' || p.email_verified === true };
    }
    if (!google.mock()) throw new Error('Google sign-in is not configured');
    if (!idToken.startsWith('mock:')) throw new Error('Invalid Google token');
    const [, em, name, flag] = idToken.split(':');
    return { sub: 'mock-' + em, email: String(em).toLowerCase(), name: name || em.split('@')[0], email_verified: flag !== 'unverified' };
  }
};
// ---------- GST verification ----------
const gstVerify = {
  async verify(gstin) {
    const ok = /^\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/.test(gstin || '');
    if (env.GST_API_URL && env.GST_API_KEY) {
      const r = await fetch(`${env.GST_API_URL}/${gstin}`, { headers: { 'x-api-key': env.GST_API_KEY } }); return { provider: 'api', valid: r.ok, data: r.ok ? await r.json() : null };
    }
    return { provider: 'mock', valid: ok, data: ok ? { gstin, state_code: gstin.slice(0, 2), pan: gstin.slice(2, 12), status: 'Active (mock)' } : null };
  },
};
// ---------- Payment gateways ----------
// interface: createOrder({amount, ref, customer}) -> {gateway_order_id, checkout}; verify({...}) -> bool; refund(payment, amount) -> {id,status}; verifyWebhook(rawBody, headers) -> bool
const mockPay = {
  name: 'mock',
  secret: () => env.MOCK_PAYMENT_SECRET || 'mock_secret',
  async createOrder({ amount, ref }) { const id = 'mock_order_' + crypto.randomBytes(5).toString('hex'); return { gateway_order_id: id, checkout: { provider: 'mock', key: 'mock_key', order_id: id, amount_paise: Math.round(amount * 100), currency: 'INR', note: 'Call POST /api/v1/payments/mock/complete or compute signature=HMAC_SHA256(order_id|payment_id, MOCK_PAYMENT_SECRET)' } }; },
  sign(orderId, paymentId) { return hmac(this.secret(), `${orderId}|${paymentId}`); },
  verify({ gateway_order_id, gateway_payment_id, signature }) { return safeEq(this.sign(gateway_order_id, gateway_payment_id), signature); },
  async refund(p, amount) { return { id: 'mock_rfnd_' + crypto.randomBytes(5).toString('hex'), status: 'processed' }; },
  verifyWebhook(raw, h) { return safeEq(hmac(env.MOCK_WEBHOOK_SECRET || 'mock_webhook', raw), h['x-mock-signature']); },
};
const razorpay = {
  name: 'razorpay',
  enabled: () => !!(env.RAZORPAY_KEY_ID && env.RAZORPAY_KEY_SECRET),
  auth: () => 'Basic ' + Buffer.from(`${env.RAZORPAY_KEY_ID}:${env.RAZORPAY_KEY_SECRET}`).toString('base64'),
  async createOrder({ amount, ref }) {
    const r = await fetch('https://api.razorpay.com/v1/orders', { method: 'POST', headers: { Authorization: this.auth(), 'Content-Type': 'application/json' }, body: JSON.stringify({ amount: Math.round(amount * 100), currency: 'INR', receipt: ref }) });
    const j = await r.json(); if (!r.ok) throw new Error('Razorpay: ' + (j.error?.description || r.status));
    return { gateway_order_id: j.id, checkout: { provider: 'razorpay', key: env.RAZORPAY_KEY_ID, order_id: j.id, amount_paise: j.amount, currency: 'INR' } };
  },
  verify({ gateway_order_id, gateway_payment_id, signature }) { return safeEq(hmac(env.RAZORPAY_KEY_SECRET, `${gateway_order_id}|${gateway_payment_id}`), signature); },
  async refund(p, amount) {
    const r = await fetch(`https://api.razorpay.com/v1/payments/${p.gateway_payment_id}/refund`, { method: 'POST', headers: { Authorization: this.auth(), 'Content-Type': 'application/json' }, body: JSON.stringify({ amount: Math.round(amount * 100) }) });
    const j = await r.json(); if (!r.ok) throw new Error('Razorpay refund: ' + (j.error?.description || r.status)); return { id: j.id, status: j.status };
  },
  verifyWebhook(raw, h) { return !!env.RAZORPAY_WEBHOOK_SECRET && safeEq(hmac(env.RAZORPAY_WEBHOOK_SECRET, raw), h['x-razorpay-signature']); },
};
const cashfree = {
  name: 'cashfree',
  enabled: () => !!(env.CASHFREE_APP_ID && env.CASHFREE_SECRET_KEY),
  base: () => env.CASHFREE_ENV === 'production' ? 'https://api.cashfree.com/pg' : 'https://sandbox.cashfree.com/pg',
  headers: () => ({ 'x-client-id': env.CASHFREE_APP_ID, 'x-client-secret': env.CASHFREE_SECRET_KEY, 'x-api-version': '2023-08-01', 'Content-Type': 'application/json' }),
  async createOrder({ amount, ref, customer }) {
    const r = await fetch(this.base() + '/orders', { method: 'POST', headers: this.headers(), body: JSON.stringify({ order_id: ref, order_amount: amount, order_currency: 'INR', customer_details: { customer_id: String(customer.id), customer_phone: customer.mobile || '9999999999', customer_email: customer.email } }) });
    const j = await r.json(); if (!r.ok) throw new Error('Cashfree: ' + (j.message || r.status));
    return { gateway_order_id: j.order_id, checkout: { provider: 'cashfree', payment_session_id: j.payment_session_id, order_id: j.order_id, env: env.CASHFREE_ENV || 'sandbox' } };
  },
  // Cashfree has no client signature; verify server-side by fetching order status.
  async verify({ gateway_order_id }) { const r = await fetch(`${this.base()}/orders/${gateway_order_id}`, { headers: this.headers() }); const j = await r.json(); return j.order_status === 'PAID'; },
  async refund(p, amount) { const r = await fetch(`${this.base()}/orders/${p.gateway_order_id}/refunds`, { method: 'POST', headers: this.headers(), body: JSON.stringify({ refund_amount: amount, refund_id: 'rf_' + Date.now() }) }); const j = await r.json(); if (!r.ok) throw new Error('Cashfree refund: ' + j.message); return { id: j.cf_refund_id, status: j.refund_status }; },
  verifyWebhook(raw, h) { if (!env.CASHFREE_SECRET_KEY) return false; return safeEq(hmac(env.CASHFREE_SECRET_KEY, (h['x-webhook-timestamp'] || '') + raw, 'base64'), h['x-webhook-signature']); },
};
const gateways = { mock: mockPay, razorpay, cashfree };
function gateway(name) {
  const g = gateways[name || env.PAYMENT_PROVIDER || 'mock'];
  if (!g) throw new Error('Unknown payment provider');
  if (g.enabled && !g.enabled()) return mockPay; // fall back to mock when keys missing
  return g;
}
// ---------- Payouts ----------
const payouts = {
  async send(provider, w, bank) {
    if (provider === 'razorpayx' && env.RAZORPAYX_ACCOUNT_NO && env.RAZORPAY_KEY_ID) {
      // RazorpayX: contact -> fund_account -> payout. Stub kept minimal; returns queued.
      return { provider, status: 'processing', payout_ref: 'rzpx_pending_' + w.id, note: 'Implement contact/fund_account creation with live keys' };
    }
    if (provider === 'cashfree_payouts' && env.CASHFREE_PAYOUT_CLIENT_ID) return { provider, status: 'processing', payout_ref: 'cfp_pending_' + w.id };
    if (provider === 'manual') return { provider, status: 'manual' };
    return { provider: 'mock', status: 'paid', payout_ref: 'MOCKPAYOUT' + crypto.randomBytes(4).toString('hex').toUpperCase(), utr: 'UTRMOCK' + Date.now().toString().slice(-10) };
  },
};
// ---------- Telephony ----------
const telephony = {
  name: env.TWILIO_ACCOUNT_SID ? 'twilio' : (env.CALL_PROVIDER || 'mock'),
  async call(agentNumber, toNumber) {
    if (this.name === 'twilio') {
      const body = new URLSearchParams({ To: '+91' + toNumber, From: env.TWILIO_FROM, Twiml: `<Response><Dial>${agentNumber ? '+91' + agentNumber : ''}</Dial></Response>` });
      const r = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${env.TWILIO_ACCOUNT_SID}/Calls.json`, { method: 'POST', headers: { Authorization: 'Basic ' + Buffer.from(`${env.TWILIO_ACCOUNT_SID}:${env.TWILIO_AUTH_TOKEN}`).toString('base64'), 'Content-Type': 'application/x-www-form-urlencoded' }, body });
      const j = await r.json(); return { provider: 'twilio', status: r.ok ? 'initiated' : 'failed', sid: j.sid, error: r.ok ? null : j.message };
    }
    if (this.name === 'tel') return { provider: 'tel', status: 'client_dial', dial: 'tel:+91' + toNumber };
    return { provider: 'mock', status: 'initiated', sid: 'MOCKCALL' + crypto.randomBytes(4).toString('hex'), dial: 'tel:+91' + toNumber };
  },
};
module.exports = { otp, email, whatsapp, push, google, gstVerify, gateway, gateways, mockPay, payouts, telephony, hmac };
