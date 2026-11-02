// Responsive + Material 3 design-system verification across 6 widths (360/390/412/768/1024/1440).
// Usage: BASE=http://localhost:4199 node tests/browser-responsive.js   (fresh AUTO_SEED db; needs puppeteer-core + Chrome)
let puppeteer; try { puppeteer = require('puppeteer-core'); } catch { puppeteer = require('/tmp/pp/node_modules/puppeteer-core'); }
const B = process.env.BASE || 'http://localhost:4199'; const SHOTS = process.env.SHOTS || '/tmp/shots';
let pass = 0, fail = 0; const fails = []; const ok = (c, m) => { c ? pass++ : (fail++, fails.push(m)); if (!c || process.env.VERBOSE) console.log((c ? '  ✓ ' : '  ✗ ') + m); };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const WIDTHS = [360, 390, 412, 768, 1024, 1440];
const H = w => w < 768 ? 820 : w < 1200 ? 1024 : 900;
const tagW = w => w < 768 ? 'm' + w : w < 1200 ? 't' + w : 'desk';
const WANT = new Set(['m360-home', 'm390-product', 'm390-cart', 'm390-checkout', 'm390-orders', 'm390-admin-dash', 't768-home', 'desk-home', 'desk-admin-dash']);
(async () => {
  require('fs').mkdirSync(SHOTS, { recursive: true });
  const br = await puppeteer.launch({ executablePath: process.env.CHROME || '/usr/bin/google-chrome', headless: 'new', args: ['--no-sandbox'] });
  const pg = await br.newPage();
  await pg.evaluateOnNewDocument(() => { window.__ft = []; const o = CanvasRenderingContext2D.prototype.fillText; CanvasRenderingContext2D.prototype.fillText = function (t, ...a) { window.__ft.push(String(t)); return o.call(this, t, ...a); }; });
  const errs = []; pg.on('pageerror', e => errs.push(e.message)); pg.on('dialog', d => d.accept());
  const login = async (id, pw) => { await pg.goto(B + '/#/x', { waitUntil: 'networkidle2' }); return pg.evaluate(async (id, pw) => { const r = await fetch('/api/v1/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ identifier: id, password: pw }) }); const d = await r.json(); localStorage.setItem('mm_token', d.token); localStorage.setItem('mm_user', JSON.stringify(d.user)); localStorage.setItem('mm_theme', 'light'); return d; }, id, pw); };
  const api = (m, u, b) => pg.evaluate(async (m, u, b) => { const r = await fetch('/api/v1' + u, { method: m, headers: { 'content-type': 'application/json', authorization: 'Bearer ' + localStorage.getItem('mm_token') }, body: b ? JSON.stringify(b) : undefined }); return r.json().catch(() => ({})); }, m, u, b);
  // Layout audit executed in the page
  const audit = () => pg.evaluate(() => {
    const W = innerWidth, out = { W, sw: document.documentElement.scrollWidth, offenders: [], radius: [], buy: [], text: '', bn: null, overlap: null, inputs: [], spacing: [], touch: [] };
    const vis = el => { const s = getComputedStyle(el); if (s.display === 'none' || s.visibility === 'hidden') return false; const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
    const clipped = el => { for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) { const s = getComputedStyle(p); if (/(auto|scroll|hidden)/.test(s.overflowX) && p.scrollWidth > p.clientWidth - 1) return true; if (s.position === 'fixed' && p.id === 'sidenav') return true; if (p.id === 'sidenav' && !document.body.classList.contains('navopen') && W < 768) return true; } return false; };
    for (const el of document.querySelectorAll('#app *')) { if (!vis(el)) continue; const r = el.getBoundingClientRect(); if ((r.right > W + 1 || r.left < -1) && !clipped(el) && getComputedStyle(el).position !== 'fixed') out.offenders.push((el.className && typeof el.className === 'string' ? '.' + el.className.split(' ')[0] : el.tagName) + '@' + Math.round(r.left) + '-' + Math.round(r.right)); }
    const ps = document.querySelector('#pscroll'); if (ps) out.psw = [ps.scrollWidth, ps.clientWidth];
    document.querySelectorAll('.btn').forEach(b => { if (!vis(b)) return; const rr = parseFloat(getComputedStyle(b).borderTopLeftRadius); out.radius.push(rr); const h = b.getBoundingClientRect().height; if (W < 768 && !b.closest('.tablewrap') && !b.closest('#modal')) out.touch.push(h); });
    document.querySelectorAll('.buy').forEach(b => { if (vis(b) || getComputedStyle(b).display !== 'none') out.buy.push(getComputedStyle(b).backgroundColor + '|' + getComputedStyle(b).color + '|' + b.textContent.trim().slice(0, 20)); });
    out.text = document.body.innerText + ' ' + (window.__ft || []).join(' | ');
    document.querySelectorAll('input:not([type=checkbox]):not([type=radio]):not([type=file]),select,textarea').forEach(i => { if (vis(i)) out.inputs.push(parseFloat(getComputedStyle(i).fontSize)); });
    document.querySelectorAll('.card,.grid,.kpis,.wrap,#pmain').forEach(c => { if (!vis(c)) return; const s = getComputedStyle(c); [s.paddingTop, s.paddingLeft, s.rowGap].forEach(v => { const n = parseFloat(v); if (Number.isFinite(n) && n % 4) out.spacing.push(c.className + ':' + v); }); });
    const bn = [...document.querySelectorAll('.bottomnav')].find(vis); if (bn) { const r = bn.getBoundingClientRect(); out.bn = { top: r.top, bottom: r.bottom, h: r.height, items: [...bn.querySelectorAll('a')].map(a => a.getBoundingClientRect().height) }; }
    return out; });
  const overlapCheck = () => pg.evaluate(async () => { const sc = document.querySelector('#pscroll') || document.scrollingElement; sc.scrollTop = 1e7; await new Promise(r => setTimeout(r, 250)); const bn = [...document.querySelectorAll('.bottomnav')].find(e => getComputedStyle(e).display !== 'none'); if (!bn) return null; const mb = document.querySelector('.mbar'); const limit = Math.min(bn.getBoundingClientRect().top, mb && getComputedStyle(mb).display !== 'none' ? mb.getBoundingClientRect().top : 1e9);
    const root = document.querySelector('.foot') || document.querySelector('#pmain') || document.querySelector('#main'); let worst = 0, who = ''; root.querySelectorAll('a,button,input,select,textarea,b,h1,h2,h3,p,td,span').forEach(e => { const r = e.getBoundingClientRect(); if (!r.height || getComputedStyle(e).visibility === 'hidden' || e.closest('.mbar,.bottomnav,.tablewrap')) return; if (r.bottom > limit + 1 && r.top < limit + 400) { if (r.bottom - limit > worst) { worst = r.bottom - limit; who = e.tagName + ':' + e.textContent.trim().slice(0, 20); } } }); sc.scrollTop = 0; return { worst, who }; });
  const screens = [];
  const check = async (role, base, hash, name, w) => {
    await pg.setViewport({ width: w, height: H(w), deviceScaleFactor: w < 768 ? 2 : 1, isMobile: w < 768, hasTouch: w < 768 });
    await pg.goto(B + base + '#' + hash, { waitUntil: 'networkidle2' }); await sleep(700);
    const a = await audit(); const id = `${tagW(w)}-${name}`; const where = `[${w}] ${role} ${hash}`;
    ok(a.sw <= a.W + 1, `${where}: no horizontal page overflow (scrollWidth ${a.sw} ≤ ${a.W})`);
    if (a.psw) ok(a.psw[0] <= a.psw[1] + 1, `${where}: panel scroller has no horizontal overflow (${a.psw})`);
    ok(!a.offenders.length, `${where}: no element overflows outside a scroll wrapper${a.offenders.length ? ' → ' + a.offenders.slice(0, 4).join(', ') : ''}`);
    ok(a.radius.every(r => r >= 10 && r <= 12), `${where}: buttons radius 10–12px${a.radius.some(r => r < 10 || r > 12) ? ' → ' + [...new Set(a.radius)].join(',') : ''}`);
    ok(a.buy.every(x => x.startsWith('rgb(245, 158, 11)')), `${where}: purchase buttons are #F59E0B${a.buy.length ? ' (' + a.buy.length + ')' : ''}${a.buy.some(x => !x.startsWith('rgb(245, 158, 11)')) ? ' → ' + a.buy.join(';') : ''}`);
    const bad = a.text.match(/.{0,30}\b(undefined|NaN)\b.{0,20}/); ok(!bad, `${where}: no undefined/NaN text${bad ? ' → ' + bad[0] : ''}`);
    ok(!a.spacing.length, `${where}: spacing on the 4/8px grid${a.spacing.length ? ' → ' + a.spacing.slice(0, 3).join(', ') : ''}`);
    if (w < 768) {
      ok(!!a.bn && a.bn.bottom >= a.W * 0 + H(w) - 2 && a.bn.items.every(h => h >= 48), `${where}: bottom nav visible, docked, targets ≥48px${a.bn ? ' (' + a.bn.items.map(Math.round) + ')' : ''}`);
      ok(a.inputs.every(f => f >= 16), `${where}: inputs ≥16px font (${[...new Set(a.inputs)]})`);
      ok(a.touch.every(h => h >= 44), `${where}: buttons ≥44px touch target${a.touch.some(h => h < 44) ? ' → ' + [...new Set(a.touch.map(Math.round))] : ''}`);
      const ov = await overlapCheck(); ok(ov && ov.worst <= 1, `${where}: bottom nav / action bar doesn't cover content at scroll end${ov && ov.worst > 1 ? ' → ' + ov.who + ' by ' + Math.round(ov.worst) : ''}`);
    } else ok(!a.bn, `${where}: no bottom nav at ≥768`);
    await pg.screenshot({ path: `${SHOTS}/${id}.png` }); screens.push(id);
  };
  try {
    const prod = (await pg.goto(B + '/', { waitUntil: 'networkidle2' }), await pg.evaluate(() => fetch('/api/v1/products?limit=20').then(r => r.json())));
    const p = (prod.items || prod.products || prod).find(x => x.purchase_available !== 0 && x.in_stock !== 0) || (prod.items || prod)[0];
    console.log('▶ customer');
    await login('rahul@example.com', 'Customer@123');
    await api('POST', '/cart/items', { product_id: p.id, qty: 1 });
    for (const w of WIDTHS) for (const [h, n] of [['/', 'home'], ['/p/' + p.id, 'product'], ['/cart', 'cart'], ['/checkout', 'checkout'], ['/orders', 'orders'], ['/account', 'account']]) await check('customer', '/', h, n, w);
    console.log('▶ dark mode');
    await pg.setViewport({ width: 390, height: 820, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
    await pg.goto(B + '/#/', { waitUntil: 'networkidle2' }); await sleep(500); await pg.click('[data-theme-toggle]'); await sleep(400);
    let d = await pg.evaluate(() => ({ t: document.documentElement.dataset.theme, bg: getComputedStyle(document.body).backgroundColor, ls: localStorage.getItem('mm_theme') }));
    ok(d.t === 'dark' && d.ls === 'dark' && d.bg !== 'rgb(248, 250, 252)', `dark toggle applies + persists (${d.t}, ${d.bg})`);
    await pg.reload({ waitUntil: 'networkidle2' }); await sleep(500); d = await pg.evaluate(() => document.documentElement.dataset.theme); ok(d === 'dark', 'dark theme persists across reload');
    await pg.screenshot({ path: `${SHOTS}/m390-dark-home.png` }); screens.push('m390-dark-home');
    await pg.goto(B + '/#/cart', { waitUntil: 'networkidle2' }); await sleep(600); await pg.screenshot({ path: `${SHOTS}/m390-dark-cart.png` });
    const da = await audit(); ok(!/\b(undefined|NaN)\b/.test(da.text) && da.buy.every(x => x.startsWith('rgb(245, 158, 11)')), 'dark cart: purchase buttons stay orange, clean text');
    await pg.click('[data-theme-toggle]'); await sleep(300); ok(await pg.evaluate(() => document.documentElement.dataset.theme === 'light' && localStorage.getItem('mm_theme') === 'light'), 'toggle back to light');
    console.log('▶ vendor');
    const vl = await login('vendor1@mohanmishra.in', 'Vendor@123'); ok(!!vl.token, 'vendor login');
    for (const w of WIDTHS) for (const [h, n] of [['/', 'vendor-dash'], ['/products', 'vendor-products'], ['/orders', 'vendor-orders'], ['/wallet', 'vendor-wallet']]) await check('vendor', '/vendor/', h, n, w);
    console.log('▶ admin');
    await login('admin@mohanmishra.in', 'Admin@123');
    for (const w of WIDTHS) for (const [h, n] of [['/', 'admin-dash'], ['/products', 'admin-products'], ['/products/new', 'admin-addproduct'], ['/orders', 'admin-orders'], ['/invoices', 'admin-invoices'], ['/crm', 'admin-crm'], ['/withdrawals', 'admin-withdrawals'], ['/staff', 'admin-staff']]) await check('admin', '/admin/', h, n, w);
    console.log('▶ panel bottom nav "More" opens the drawer');
    await pg.setViewport({ width: 390, height: 820, deviceScaleFactor: 2, isMobile: true, hasTouch: true }); await pg.goto(B + '/admin/#/orders', { waitUntil: 'networkidle2' }); await sleep(600);
    ok(await pg.evaluate(() => document.querySelector('#pbnav a.on')?.textContent.trim() === 'Orders'), 'admin bottom nav highlights Orders');
    await pg.click('#pbmore'); await sleep(400); ok(await pg.evaluate(() => document.body.classList.contains('navopen') && document.querySelector('#sidenav').getBoundingClientRect().left >= -1), 'More opens the full drawer');
    await pg.screenshot({ path: `${SHOTS}/m390-admin-drawer.png` });
    await pg.mouse.click(380, 300); await sleep(300); ok(await pg.evaluate(() => !document.body.classList.contains('navopen')), 'drawer closes on scrim tap');
    await pg.evaluate(() => localStorage.setItem('mm_theme', 'dark')); await pg.goto(B + '/admin/#/', { waitUntil: 'networkidle2' }); await sleep(900); await pg.screenshot({ path: `${SHOTS}/m390-dark-admin-dash.png` });
    await pg.evaluate(() => localStorage.setItem('mm_theme', 'light'));
    for (const s of WANT) ok(require('fs').existsSync(`${SHOTS}/${s}.png`), `screenshot ${s}.png written`);
    ok(!errs.length, 'no page JS errors' + (errs.length ? ': ' + errs.slice(0, 3).join(' | ') : ''));
  } catch (e) { console.error(e); fail++; }
  await br.close(); console.log(`\n${pass} passed, ${fail} failed`); if (fails.length) console.log('FAILED:\n - ' + [...new Set(fails)].slice(0, 60).join('\n - ')); process.exit(fail ? 1 : 0);
})();
