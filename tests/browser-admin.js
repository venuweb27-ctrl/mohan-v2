// Headless browser verification of the 7-point marketplace scope (admin console screens).
// Usage: BASE=http://localhost:4199 node tests/browser-admin.js   (fresh AUTO_SEED db; needs puppeteer-core + Chrome)
let puppeteer; try { puppeteer = require('puppeteer-core'); } catch { puppeteer = require('/tmp/pp/node_modules/puppeteer-core'); }
const B = process.env.BASE || 'http://localhost:4199'; const SHOTS = process.env.SHOTS || '/tmp/shots';
let pass = 0, fail = 0; const ok = (c, m) => { c ? pass++ : fail++; console.log((c ? '  ✓ ' : '  ✗ ') + m); };
const sleep = ms => new Promise(r => setTimeout(r, ms));
(async () => {
  require('fs').mkdirSync(SHOTS, { recursive: true });
  const br = await puppeteer.launch({ executablePath: process.env.CHROME || '/usr/bin/google-chrome', headless: 'new', args: ['--no-sandbox'] });
  const pg = await br.newPage(); await pg.setViewport({ width: 1366, height: 860 });
  await pg.evaluateOnNewDocument(() => { window.__ft = []; const o = CanvasRenderingContext2D.prototype.fillText; CanvasRenderingContext2D.prototype.fillText = function (t, ...a) { window.__ft.push(String(t)); return o.call(this, t, ...a); }; });
  const errs = []; pg.on('pageerror', e => errs.push(e.message)); pg.on('dialog', d => d.accept());
  const body = () => pg.evaluate(() => document.querySelector('#pmain, main, body').innerText);
  const clean = async (where) => { const r = await pg.evaluate(() => ({ t: document.body.innerText, ft: (window.__ft || []).join(' | ') })); const bad = (r.t + ' ' + r.ft).match(/.{0,30}\b(undefined|NaN|Infinity|null)\b.{0,20}/); ok(!bad || /\bnull\b/.test(bad[1]) && !/undefined|NaN/.test(bad[0]), `${where}: no undefined/NaN on screen${bad ? ' → ' + bad[0] : ''}`); const rent = r.t.match(/.{0,30}\brent(al|als|ing)?\b.{0,20}/i); ok(!rent, `${where}: no rent/rental text on screen${rent ? ' → ' + rent[0] : ''}`); };
  const visit = async (hash, name, must, base = '/admin/') => { await pg.goto(B + base + '#' + hash, { waitUntil: 'networkidle2' }); await sleep(900); const t = await body(); await clean(base + '#' + hash); await pg.screenshot({ path: `${SHOTS}/admin-${name}.png` }); for (const m of [].concat(must)) ok(new RegExp(m, 'i').test(t), `${hash} shows ${m}`); return t; };
  const api = (m, u, b) => pg.evaluate(async (m, u, b) => { const t = Object.entries(localStorage).find(([k]) => /token/i.test(k))?.[1]; const r = await fetch('/api/v1' + u, { method: m, headers: { 'content-type': 'application/json', authorization: 'Bearer ' + t }, body: b ? JSON.stringify(b) : undefined }); return { s: r.status, ct: r.headers.get('content-type'), d: (r.headers.get('content-type') || '').includes('json') ? await r.json() : null }; }, m, u, b);
  try {
    console.log('▶ 1. customers buy machinery (storefront)');
    await pg.goto(B + '/#/', { waitUntil: 'networkidle2' }); await sleep(800); await pg.screenshot({ path: `${SHOTS}/admin-0-storefront.png` });
    ok(/machinery|equipment/i.test(await pg.evaluate(() => document.body.innerText)), 'storefront is machinery-scoped');
    console.log('▶ admin login');
    await pg.goto(B + '/admin/', { waitUntil: 'networkidle2' }); await pg.evaluate(() => localStorage.clear()); await pg.reload({ waitUntil: 'networkidle2' }); await pg.waitForSelector('#li'); await sleep(300);
    await pg.$eval('#li', e => e.value = 'admin@mohanmishra.in'); await pg.$eval('#lp', e => e.value = 'Admin@123'); await pg.click('#lb'); await sleep(1500);
    ok(!(await pg.$('#li')), 'admin signed in');
    console.log('▶ dashboards');
    await visit('/', 'dash', ['Escrow held', 'Sales']); await pg.screenshot({ path: `${SHOTS}/brand-desk-admindash.png` });
    const dash = await api('GET', '/admin/dashboard'); ok(dash.d.escrow >= 0 && dash.d.commission >= 0 && dash.d.gst_payable >= 0, `money KPIs non-negative (escrow ${dash.d.escrow}, commission ${dash.d.commission})`);
    ok(dash.d.escrow <= dash.d.collected + 1, 'escrow ≤ collected');
    ok(dash.d.order_status.every(x => Number.isFinite(x.count)) && dash.d.sales_by_day.every(x => x.day), 'chart fields present (day/count)');
    await visit('/reports', 'reports', ['report']);
    console.log('▶ 2. vendor onboarding + product approval');
    await visit('/vendors', '2a-vendors', ['vendor']);
    const vs = await api('GET', '/admin/vendors?limit=50'); ok(vs.s === 200 && (vs.d.items || []).some(v => v.status !== 'approved' && v.status !== 'active') , 'a non-approved vendor exists awaiting KYC approval');
    await visit('/products', '2b-products', ['product']);
    console.log('▶ 3. inventory + orders');
    await visit('/inventory', '3a-inventory', ['stock']);
    ok(await pg.evaluate(() => [...document.querySelectorAll('button')].some(b => /adjust/i.test(b.textContent))), 'inventory has Adjust action');
    await visit('/orders', '3b-orders', ['order']);
    console.log('▶ 4. CRM');
    await visit('/crm', '4a-crm', ['lead']);
    const ld = await api('POST', '/admin/crm/leads', { name: 'Browser Lead', company: 'Deccan Earthmovers', mobile: '8' + String(Date.now()).slice(-9), city: 'Pune', value: 1200000 });
    ok(ld.s === 201, 'lead created');
    await visit('/crm/' + ld.d.id, '4b-lead', ['Browser Lead']);
    ok(!!(await pg.$('#cv-c')) && !!(await pg.$('#cv-q')) && !!(await pg.$('#cv-o')), 'convert buttons (customer/quotation/order) present');
    await pg.click('#cv-c'); await sleep(1500); await pg.screenshot({ path: `${SHOTS}/admin-4c-converted.png` });
    const l2 = await api('GET', '/admin/crm/leads/' + ld.d.id); ok(l2.d.customer_id > 0, 'lead converted to customer from UI');
    console.log('▶ 5. staff roles + login history');
    await visit('/staff', '5a-staff', ['staff|role']); await visit('/logins', '5b-logins', ['login']);
    console.log('▶ 6. vendor withdrawals');
    await visit('/withdrawals', '6-withdrawals', ['withdraw']);
    console.log('▶ 7. GST invoicing');
    await visit('/invoices', '7a-invoices', ['invoice']);
    const iv = await api('GET', '/admin/invoices?limit=5'); const first = (iv.d.items || [])[0];
    ok(iv.s === 200, `invoice register API (${(iv.d.items || []).length} invoices; GST maths covered in npm test)`);
    if (first) { await visit('/invoices', '7b-invoices', ['GST|CGST|IGST']); }
    console.log('▶ vendor + customer screens');
    const vu = { id: dash.d.top_vendors[0].id };
    await pg.goto(B + '/vendor/', { waitUntil: 'networkidle2' }); await pg.evaluate(() => localStorage.clear()); await pg.reload({ waitUntil: 'networkidle2' }); await pg.waitForSelector('#li'); await sleep(300);
    await pg.$eval('#li', (e, v) => e.value = v, 'vendor' + vu.id + '@mohanmishra.in'); await pg.$eval('#lp', e => e.value = 'Vendor@123'); await pg.evaluate(() => [...document.querySelectorAll('button')].find(b => /login/i.test(b.textContent)).click()); await sleep(1800);
    await visit('/', 'vendor-dash', ['Sales'], '/vendor/'); await pg.screenshot({ path: `${SHOTS}/brand-desk-vendordash.png` });
    for (const h of ['/orders', '/products', '/wallet', '/invoices']) await visit(h, 'vendor' + h.replace(/\//g, '-'), [''], '/vendor/');
    await pg.goto(B + '/#/login', { waitUntil: 'networkidle2' }); await pg.evaluate(() => localStorage.clear());
    const tok = await pg.evaluate(async () => (await (await fetch('/api/v1/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ identifier: 'rahul@example.com', password: 'Customer@123' }) })).json()));
    await pg.evaluate(t => { for (const k of ['mm_token']) localStorage.setItem(k, t.token); localStorage.setItem('mm_user', JSON.stringify(t.user)); }, tok);
    for (const h of ['/', '/c', '/cart', '/orders', '/account']) await visit(h, 'cust' + h.replace(/\//g, '-'), [''], '/');
    ok(errs.length === 0, 'no page errors ' + errs.join(' | '));
  } catch (e) { fail++; console.log('  ✗ ' + e.message); }
  await br.close(); console.log(`\n${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0);
})();
