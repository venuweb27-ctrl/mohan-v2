// Unit tests for Google ID-token verification with a mocked tokeninfo verifier (no network).
const env = process.env; delete env.GOOGLE_MOCK; env.NODE_ENV = 'production'; delete env.GOOGLE_CLIENT_ID;
const { google } = require('../src/providers');
let pass = 0, fail = 0; const ok = (c, m) => { c ? pass++ : fail++; console.log((c ? '  ✓ ' : '  ✗ ') + m); };
const rejects = async (p, re, m) => { try { await p; ok(false, m); } catch (e) { ok(re.test(e.message), m + ' → ' + e.message); } };
(async () => {
  ok(!google.enabled(), 'disabled in production when GOOGLE_CLIENT_ID is unset');
  await rejects(google.verify('mock:a@b.com:A'), /not configured/, 'mock tokens refused in production');
  env.GOOGLE_CLIENT_ID = 'cid-123.apps.googleusercontent.com'; ok(google.enabled() && !google.mock(), 'enabled (real mode) once GOOGLE_CLIENT_ID is set');
  const base = { aud: env.GOOGLE_CLIENT_ID, iss: 'https://accounts.google.com', sub: '1001', email: 'Buyer@Example.com', name: 'Buyer', email_verified: 'true', exp: String(Math.floor(Date.now() / 1000) + 600) };
  let info = base; google.fetchTokenInfo = async () => info;
  const g = await google.verify('tok'); ok(g.sub === '1001' && g.email === 'buyer@example.com' && g.email_verified === true, 'valid token → verified identity (email lower-cased)');
  info = { ...base, aud: 'someone-else' }; await rejects(google.verify('tok'), /audience/, 'wrong aud rejected');
  info = { ...base, iss: 'evil.example' }; await rejects(google.verify('tok'), /issuer/, 'wrong iss rejected');
  info = { ...base, exp: '1000' }; await rejects(google.verify('tok'), /expired/, 'expired token rejected');
  info = { ...base, email_verified: 'false' }; ok((await google.verify('tok')).email_verified === false, 'unverified email flagged (endpoint rejects it)');
  google.fetchTokenInfo = async () => { throw new Error('Invalid Google token'); }; await rejects(google.verify('bad'), /Invalid/, 'tokeninfo failure rejected');
  await rejects(google.verify(''), /Missing/, 'empty credential rejected');
  console.log(`\n${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0);
})();
