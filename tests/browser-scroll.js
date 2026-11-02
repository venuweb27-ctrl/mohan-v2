// Real touch-scroll verification on phones (390x844, 360x740): every main page must move under a finger swipe,
// keep the bottom nav docked, and let the last content be reached above the bottom nav / sticky action bar.
// Usage: BASE=http://localhost:4199 node tests/browser-scroll.js   (fresh AUTO_SEED db; needs puppeteer-core + Chrome)
let puppeteer; try { puppeteer = require('puppeteer-core'); } catch { puppeteer = require('/tmp/pp/node_modules/puppeteer-core'); }
const B = process.env.BASE || 'http://localhost:4199'; const SHOTS = process.env.SHOTS || '/tmp/shots';
let pass = 0, fail = 0; const fails = []; const ok = (c, m) => { c ? pass++ : (fail++, fails.push(m)); console.log((c ? '  ✓ ' : '  ✗ ') + m); };
const sleep = ms => new Promise(r => setTimeout(r, ms));
(async () => {
  require('fs').mkdirSync(SHOTS, { recursive: true });
  const br = await puppeteer.launch({ executablePath: process.env.CHROME || '/usr/bin/google-chrome', headless: 'new', args: ['--no-sandbox'] });
  const pg = await br.newPage(); const cdp = await pg.target().createCDPSession();
  const errs = []; pg.on('pageerror', e => errs.push(e.message)); pg.on('dialog', d => d.accept());
  const login = async (id, pw) => { await pg.goto(B + '/#/x', { waitUntil: 'networkidle2' }); return pg.evaluate(async (id, pw) => { const r = await fetch('/api/v1/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ identifier: id, password: pw }) }); const d = await r.json(); localStorage.setItem('mm_token', d.token); localStorage.setItem('mm_user', JSON.stringify(d.user)); localStorage.setItem('mm_install_dismissed', '1'); return d; }, id, pw); };
  // a real finger swipe (touchStart → moves → touchEnd), like a thumb flick upward
  const swipe = async (x, y0, dy) => { await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y: y0 }] }); for (let i = 1; i <= 12; i++) { await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x, y: y0 - dy * i / 12 }] }); await sleep(16); } await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }); await sleep(600); };
  const state = () => pg.evaluate(() => { const ps = document.querySelector('#pscroll'); const sc = ps && ps.scrollHeight > ps.clientHeight + 1 ? ps : document.scrollingElement; const bn = [...document.querySelectorAll('.bottomnav')].find(e => getComputedStyle(e).display !== 'none'); const r = bn && bn.getBoundingClientRect();
    return { pos: sc.scrollTop, sh: sc.scrollHeight, ch: sc === document.scrollingElement ? innerHeight : sc.clientHeight, max: sc.scrollHeight - (sc === document.scrollingElement ? innerHeight : sc.clientHeight), panel: sc !== document.scrollingElement, bodyOv: getComputedStyle(document.body).overflowY, bnTop: r ? Math.round(r.top) : null, bnBottom: r ? Math.round(r.bottom) : null, H: innerHeight }; });
  const reachEnd = () => pg.evaluate(() => { const bn = [...document.querySelectorAll('.bottomnav')].find(e => getComputedStyle(e).display !== 'none'); const mb = document.querySelector('.mbar'); const limit = Math.min(bn ? bn.getBoundingClientRect().top : 1e9, mb && getComputedStyle(mb).display !== 'none' ? mb.getBoundingClientRect().top : 1e9);
    const root = document.querySelector('.foot') || document.querySelector('#pmain') || document.querySelector('#main'); let worst = 0, who = ''; root.querySelectorAll('a,button,input,select,b,h1,h2,h3,p,td,span,small').forEach(e => { const r = e.getBoundingClientRect(); if (!r.height || e.closest('.mbar,.bottomnav,.tablewrap')) return; if (r.bottom > limit + 1 && r.bottom - limit > worst) { worst = r.bottom - limit; who = e.tagName + ':' + e.textContent.trim().slice(0, 20); } }); return { worst, who }; });
  const check = async (base, hash, name, vp) => {
    await pg.setViewport({ width: vp[0], height: vp[1], deviceScaleFactor: 2, isMobile: true, hasTouch: true });
    await pg.goto(B + base + '#' + hash, { waitUntil: 'networkidle2' }); await sleep(800);
    const w = `[${vp[0]}x${vp[1]}] ${base}#${hash}`; const s0 = await state(); { const rt = (await pg.evaluate(() => document.body.innerText)).match(/.{0,30}\brent(al|als|ing)?\b.{0,20}/i); ok(!rt, `${w}: no rent/rental text` + (rt ? ' → ' + rt[0] : '')); }
    ok(s0.bodyOv === 'visible' || s0.panel, `${w}: <body> is not a nested scroll container (overflow-y ${s0.bodyOv})`);
    if (s0.max < 40) { ok(true, `${w}: fits on one screen (${s0.sh}px) — nothing to scroll`); return; }
    const sx = Math.round(vp[0] / 2), sy = Math.round(vp[1] * 0.6);
    await swipe(sx, sy, Math.round(vp[1] * 0.4)); const s1 = await state();
    ok(s1.pos > s0.pos + 50, `${w}: finger swipe up scrolls the page (${s0.pos} → ${s1.pos} of ${s0.max})`);
    if (s1.bnTop !== null) ok(s1.bnBottom >= s1.H - 2 && s1.bnBottom <= s1.H + 2 && s1.bnTop === s0.bnTop, `${w}: bottom nav stays docked while scrolling (top ${s0.bnTop} → ${s1.bnTop})`);
    for (let i = 0; i < 40 && (await state()).pos < (await state()).max - 2; i++) await swipe(sx, sy, Math.round(vp[1] * 0.45));
    const s2 = await state(); ok(s2.pos >= s2.max - 2, `${w}: swiping reaches the end of the page (${s2.pos}/${s2.max})`);
    const e = await reachEnd(); ok(e.worst <= 1, `${w}: last content visible above bottom nav/action bar${e.worst > 1 ? ' → ' + e.who + ' hidden by ' + Math.round(e.worst) + 'px' : ''}`);
    await swipe(sx, Math.round(vp[1] * 0.3), -Math.round(vp[1] * 0.4)); const s3 = await state(); ok(s3.pos < s2.pos - 50, `${w}: swipe down scrolls back up (${s2.pos} → ${s3.pos})`);
    if (vp[0] === 390) await pg.screenshot({ path: `${SHOTS}/scroll-${name}.png` });
  };
  try {
    await pg.goto(B + '/', { waitUntil: 'networkidle2' });
    const prod = await pg.evaluate(() => fetch('/api/v1/products?limit=20').then(r => r.json())); const p = (prod.items || prod)[0];
    for (const vp of [[390, 844], [360, 740]]) {
      console.log(`▶ customer ${vp}`); await login('rahul@example.com', 'Customer@123');
      await pg.evaluate(async id => { const t = localStorage.getItem('mm_token'); const c = await (await fetch('/api/v1/cart', { headers: { authorization: 'Bearer ' + t } })).json(); if (!(c.item_count > 0)) await fetch('/api/v1/cart/items', { method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer ' + t }, body: JSON.stringify({ product_id: id, qty: 1 }) }); }, p.id);
      for (const [h, n] of [['/', 'home'], ['/p/' + p.id, 'product'], ['/cart', 'cart'], ['/checkout', 'checkout'], ['/orders', 'orders'], ['/account', 'account']]) await check('/', h, n, vp);
      console.log(`▶ vendor ${vp}`); await login('vendor1@mohanmishra.in', 'Vendor@123');
      for (const [h, n] of [['/', 'vendor-dash'], ['/products', 'vendor-products'], ['/orders', 'vendor-orders']]) await check('/vendor/', h, n, vp);
      console.log(`▶ admin ${vp}`); await login('admin@mohanmishra.in', 'Admin@123');
      for (const [h, n] of [['/', 'admin-dash'], ['/products', 'admin-products'], ['/orders', 'admin-orders'], ['/invoices', 'admin-invoices'], ['/crm', 'admin-crm']]) await check('/admin/', h, n, vp);
    }
    ok(!errs.length, 'no page JS errors' + (errs.length ? ': ' + errs.slice(0, 3).join(' | ') : ''));
  } catch (e) { console.error(e); fail++; }
  await br.close(); console.log(`\n${pass} passed, ${fail} failed`); if (fails.length) console.log('FAILED:\n - ' + fails.join('\n - ')); process.exit(fail ? 1 : 0);
})();
