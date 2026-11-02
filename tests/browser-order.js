// Headless browser e2e: guest → login prompt → add to cart → cart → checkout (new address) → place order → mock pay → order timeline;
// vendor accepts & dispatches; admin views order and creates an order on behalf of a customer; sidebar keeps scroll.
// Usage: BASE=http://localhost:4199 node tests/browser-order.js   (needs puppeteer-core + Chrome; CHROME env to override path)
let puppeteer; try { puppeteer = require('puppeteer-core'); } catch { puppeteer = require('/tmp/pp/node_modules/puppeteer-core'); }
const B = process.env.BASE || 'http://localhost:4199'; const SHOTS = process.env.SHOTS || '/tmp/shots';
let pass = 0, fail = 0; const ok = (c, m) => { c ? pass++ : fail++; console.log((c ? '  ✓ ' : '  ✗ ') + m); if (!c) throw new Error('FAIL ' + m); };
const sleep = ms => new Promise(r => setTimeout(r, ms));
(async () => {
  const br = await puppeteer.launch({ executablePath: process.env.CHROME || '/usr/bin/google-chrome', headless: 'new', args: ['--no-sandbox'] });
  const pg = await br.newPage(); await pg.setViewport({ width: 1366, height: 860 });
  const errs = []; pg.on('pageerror', e => errs.push(e.message)); pg.on('dialog', d => d.accept());
  const waitT = async (sel, txt, t = 8000) => pg.waitForFunction((s, x) => [...document.querySelectorAll(s)].some(e => e.offsetParent !== null && e.textContent.includes(x)), { timeout: t }, sel, txt);
  const click = async (sel, txt) => { await waitT(sel, txt); await pg.evaluate((s, x) => [...document.querySelectorAll(s)].find(e => e.offsetParent !== null && e.textContent.includes(x)).click(), sel, txt); };
  const shot = n => pg.screenshot({ path: `${SHOTS}/${n}.png` });
  try {
    console.log('▶ customer order flow');
    await pg.goto(B + '/#/', { waitUntil: 'networkidle2' }); await pg.evaluate(() => localStorage.clear());
    const pid = await pg.evaluate(async () => (await (await fetch('/api/v1/products?limit=40')).json()).items.find(p => p.purchase_available && p.in_stock !== false && p.stock >= 3).id);
    await pg.goto(B + '/#/p/' + pid, { waitUntil: 'networkidle2' }); await pg.reload({ waitUntil: 'networkidle2' });
    await click('button', 'Add to cart'); await sleep(600);
    ok(pg.url().includes('#/login'), 'guest add-to-cart prompts login'); await shot('order-1-login');
    await click('[data-t]', 'Password'); await pg.type('#pi', 'rahul@example.com'); await pg.type('#pp', 'Customer@123'); await click('#t-pw button', 'Login');
    await pg.waitForFunction(p => location.hash.includes('/p/' + p), { timeout: 8000 }, pid); ok(true, 'login returns to product page');
    await pg.evaluate(async () => { const t = localStorage.getItem('mm_token'); const c = await (await fetch('/api/v1/cart', { headers: { authorization: 'Bearer ' + t } })).json(); for (const g of c.groups || []) for (const l of g.lines) await fetch('/api/v1/cart/items/' + l.product_id, { method: 'DELETE', headers: { authorization: 'Bearer ' + t } }); });
    await click('button', 'Add to cart'); await sleep(800); await shot('order-2-product');
    await pg.goto(B + '/#/cart', { waitUntil: 'networkidle2' }); await waitT('h1', 'Cart'); await click('.stepper button', '+'); await sleep(800); await shot('order-3-cart');
    ok(await pg.evaluate(() => document.querySelector('.stepper span').textContent.trim() === '2'), 'quantity stepper works');
    await pg.type('#cpn', 'WELCOME5'); await click('button', 'Apply'); await sleep(800);
    await click('a,button', 'Proceed to checkout'); await waitT('h1', 'Checkout');
    await click('button', 'new address'); await pg.waitForSelector('#modal [name=line1]');
    for (const [k, v] of [['line1', 'Plot 12, MIDC'], ['city', 'Pune'], ['state', 'Maharashtra'], ['pincode', '411026']]) { await pg.$eval(`#modal [name=${k}]`, e => e.value = ''); await pg.type(`#modal [name=${k}]`, v); }
    await click('#modal button', 'Save'); await sleep(900); await shot('order-4-checkout');
    await pg.click('input[name=plan][value=advance]'); await click('button', 'Place order'); await waitT('#modal h3', 'Secure payment'); await shot('order-5-payment');
    await click('#modal button', 'Pay successfully'); await pg.waitForFunction(() => /#\/orders\/\d+/.test(location.hash), { timeout: 10000 });
    await waitT('h1,h2,h3', 'Order'); await sleep(500); await shot('order-6-confirmation');
    const oid = +pg.url().match(/orders\/(\d+)/)[1]; ok(oid > 0, 'order placed & confirmation shown'); { const rt = (await pg.evaluate(() => document.body.innerText)).match(/.{0,30}\brent(al|als|ing)?\b.{0,20}/i); ok(!rt, 'order confirmation has no rent/rental text' + (rt ? ' → ' + rt[0] : '')); }
    ok(await pg.evaluate(() => !!document.querySelector('.timeline')), 'order status timeline shown');
    await pg.goto(B + '/#/orders', { waitUntil: 'networkidle2' }); await sleep(500); ok(await pg.evaluate(id => !!document.querySelector(`a[href="#/orders/${id}"]`), oid), 'order listed in My Orders'); await shot('order-7-myorders');
    const sub = await pg.evaluate(async id => { const t = localStorage.getItem('mm_token'); return (await (await fetch('/api/v1/orders/' + id, { headers: { authorization: 'Bearer ' + t } })).json()); }, oid);
    const subId = sub.sub_orders[0].id; const vendorId = sub.sub_orders[0].vendor_id;
    console.log('▶ vendor accept / dispatch');
    await pg.evaluate(() => localStorage.clear()); await pg.goto(B + '/vendor/#/orders/' + subId, { waitUntil: 'networkidle2' });
    await pg.type('#li', 'vendor' + vendorId + '@mohanmishra.in'); await pg.type('#lp', 'Vendor@123'); await click('button', 'Login'); await sleep(1200);
    await pg.goto(B + '/vendor/#/orders/' + subId, { waitUntil: 'networkidle2' }); await sleep(700);
    await click('button', 'accepted'); await sleep(900); await click('button', 'packed'); await sleep(900); await click('button', 'shipped');
    await pg.waitForSelector('#modal [name=courier]'); await pg.type('#modal [name=courier]', 'VRL Logistics'); await pg.type('#modal [name=tracking_no]', 'LR12345'); await click('#modal button', 'Submit'); await sleep(1000); await shot('order-8-vendor');
    ok(await pg.evaluate(() => document.body.textContent.includes('shipped')), 'vendor accepted, packed & dispatched');
    console.log('▶ admin view + create order');
    await pg.goto(B + '/admin/#/orders/' + oid, { waitUntil: 'networkidle2' }); await pg.evaluate(() => localStorage.clear()); await pg.reload({ waitUntil: 'networkidle2' }); await pg.waitForSelector('#li'); await sleep(300);
    await pg.$eval('#li', e => e.value = 'admin@mohanmishra.in'); await pg.$eval('#lp', e => e.value = 'Admin@123'); await click('#lb', 'Login'); await sleep(1200);
    await pg.goto(B + '/admin/#/orders/' + oid, { waitUntil: 'networkidle2' }); await sleep(800); await shot('order-9-admin-order');
    ok(await pg.evaluate(o => document.body.textContent.includes(o), sub.order_no), 'admin sees order detail');
    // sidebar scroll persistence
    await pg.evaluate(() => { document.querySelector('#sidenav .navscroll').scrollTop = 9999; }); const st0 = await pg.evaluate(() => document.querySelector('#sidenav .navscroll').scrollTop);
    await pg.evaluate(() => [...document.querySelectorAll('#sidenav a[data-nav]')].find(a => a.textContent === 'Audit logs').click()); await sleep(900);
    const st1 = await pg.evaluate(() => document.querySelector('#sidenav .navscroll').scrollTop); ok(st0 > 50 && Math.abs(st1 - st0) < 2 && pg.url().includes('#/audit'), `sidebar keeps scroll (${st0}→${st1}) and route changes`); await shot('sidebar-admin');
    await pg.goto(B + '/admin/#/orders/new', { waitUntil: 'networkidle2' }); await sleep(900);
    await pg.$eval('#cust_q', e => e.value = 'rahul'); await pg.click('#cgo'); await sleep(900); await pg.select('#cust', await pg.$eval('#cust option:nth-child(2)', o => o.value)); await sleep(800);
    await pg.$eval('#prod_q', e => e.value = 'mixer'); await pg.click('#pgo'); await sleep(900); await click('#prodres button', 'Add'); await sleep(500);
    await click('button', 'Create order'); await pg.waitForFunction(() => /#\/orders\/\d+$/.test(location.hash), { timeout: 10000 }); await sleep(600); await shot('order-10-admin-created');
    ok(true, 'admin created an order on behalf of customer');
  } catch (e) { fail++; console.log('  ✗ ' + e.message); await shot('order-FAIL').catch(() => { }); }
  if (errs.length) console.log('page errors:', errs.slice(0, 5));
  console.log(`\n${pass} passed, ${fail} failed`); await br.close(); process.exit(fail ? 1 : 0);
})();
