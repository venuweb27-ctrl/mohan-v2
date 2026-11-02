// Browser smoke test: in-app chat (customer product page → seller, vendor reply, admin moderation, badges, WhatsApp link) at 1366 and 360 widths.
// Usage: BASE=http://localhost:4199 node tests/browser-chat.js   (fresh AUTO_SEED db; needs puppeteer-core + Chrome)
let puppeteer; try { puppeteer = require('puppeteer-core'); } catch { puppeteer = require('/tmp/pp/node_modules/puppeteer-core'); }
const B = process.env.BASE || 'http://localhost:4199';
let pass = 0, fail = 0; const ok = (c, m) => { c ? pass++ : fail++; console.log((c ? '  ✓ ' : '  ✗ ') + m); };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const api = async (m, u, b, t) => { const r = await fetch(B + '/api/v1' + u, { method: m, headers: { 'content-type': 'application/json', ...(t ? { authorization: 'Bearer ' + t } : {}) }, body: b ? JSON.stringify(b) : undefined }); return { status: r.status, data: await r.json() }; };
const login = async (id, pw) => (await api('POST', '/auth/login', { identifier: id, password: pw })).data;
async function as(pg, path, d) { await pg.goto(B + path, { waitUntil: 'networkidle2' }); await pg.evaluate(d => { localStorage.setItem('mm_token', d.token); localStorage.setItem('mm_user', JSON.stringify(d.user)); localStorage.setItem('mm_install_dismissed', '1'); }, d); }
(async () => {
  const br = await puppeteer.launch({ executablePath: process.env.CHROME || '/usr/bin/google-chrome', headless: 'new', args: ['--no-sandbox'] });
  try {
    const cust = await login('priya@example.com', 'Customer@123'), adm = await login('admin@mohanmishra.in', 'Admin@123');
    const prods = (await api('GET', '/products?limit=50')).data.items;
    let i = 0;
    for (const vp of [[1366, 860, false], [360, 740, true]]) {
      const tag = `[${vp[0]}]`; const p = prods[i++ * 3];
      const vend = await login(`vendor${p.vendor_id}@mohanmishra.in`, 'Vendor@123').catch(() => null);
      const pg = await br.newPage(); await pg.setViewport({ width: vp[0], height: vp[1], isMobile: vp[2], hasTouch: vp[2] });
      const errs = []; pg.on('pageerror', e => errs.push(e.message)); pg.on('dialog', d => d.accept());
      await as(pg, '/', cust);
      await pg.goto(B + '/#/p/' + p.id, { waitUntil: 'networkidle2' }); await pg.reload({ waitUntil: 'networkidle2' }); await sleep(800);
      const wa = await pg.$eval('.chatcta a.wa', a => a.href).catch(() => '');
      ok(wa.startsWith('https://wa.me/919522224488?text=') && decodeURIComponent(wa).includes(p.name) && decodeURIComponent(wa).includes('/#/p/' + p.id), `${tag} WhatsApp button prefilled with product name + link`);
      ok(!!(await pg.$('#chatseller')), `${tag} product page has "Chat with seller"`);
      await pg.$eval('#chatseller', b => b.scrollIntoView({ block: 'center' })); await sleep(300); await pg.click('#chatseller'); await sleep(1500);
      ok(/#\/chat\/\d+/.test(pg.url()), `${tag} opens chat thread`);
      const tid = +pg.url().split('/chat/')[1];
      await pg.type('#cmsg', `Is this in stock? ${vp[0]}`); await pg.click('#csend'); await sleep(900);
      ok(await pg.$$eval('.mrow.me .mtext', e => e.map(x => x.textContent).join('|')).then(s => s.includes(`in stock? ${vp[0]}`)), `${tag} my message appears as a bubble`);
      const lay = await pg.evaluate(() => { const b = document.querySelector('.chatbar').getBoundingClientRect(); return { inView: b.bottom <= innerHeight + 1 && b.top > 0, noOverflow: document.documentElement.scrollWidth <= innerWidth + 1 }; });
      ok(lay.inView, `${tag} input bar visible in viewport`); ok(lay.noOverflow, `${tag} no horizontal overflow`);
      // vendor replies via API → customer poll shows it
      const vtok = (await api('GET', '/chat/threads/' + tid + '?peek=1', null, vend.token)).status === 200 ? vend.token : null;
      ok(!!vtok, `${tag} seller can access the thread`);
      await api('POST', `/chat/threads/${tid}/messages`, { body: 'Yes, in stock!' }, vtok);
      await sleep(6500);
      ok(await pg.$$eval('.mrow:not(.me) .mtext', e => e.some(x => x.textContent === 'Yes, in stock!')), `${tag} seller reply arrives by polling`);
      // badge: vendor panel shows unread after another customer message
      await api('POST', `/chat/threads/${tid}/messages`, { body: 'Thanks' }, cust.token);
      const vp2 = await br.newPage(); await vp2.setViewport({ width: vp[0], height: vp[1], isMobile: vp[2], hasTouch: vp[2] }); vp2.on('pageerror', e => errs.push('vendor: ' + e.message));
      await as(vp2, '/vendor/', vend); await vp2.goto(B + '/vendor/#/chats', { waitUntil: 'networkidle2' }); await vp2.reload({ waitUntil: 'networkidle2' }); await sleep(2500);
      ok(await vp2.$$eval('.chatbadge', b => b.some(x => !x.hidden && +x.textContent > 0)), `${tag} vendor panel unread badge shown`);
      ok(!!(await vp2.$(`[data-thread="${tid}"]`)), `${tag} vendor Messages list shows the thread`);
      await vp2.click(`[data-thread="${tid}"]`); await sleep(1200);
      ok(await vp2.$$eval('.mtext', e => e.some(x => x.textContent === 'Thanks')), `${tag} vendor sees thread messages`);
      await vp2.close();
      // admin moderation UI
      const ap = await br.newPage(); await ap.setViewport({ width: vp[0], height: vp[1], isMobile: vp[2], hasTouch: vp[2] }); ap.on('pageerror', e => errs.push('admin: ' + e.message)); ap.on('dialog', d => d.accept());
      await as(ap, '/admin/', adm); await ap.goto(B + '/admin/#/chat/' + tid, { waitUntil: 'networkidle2' }); await ap.reload({ waitUntil: 'networkidle2' }); await sleep(1200);
      const joinBtn = await ap.$('#cjoin'); const already = await ap.$$eval('.msys', e => e.some(x => /joined/.test(x.textContent)));
      ok(!!joinBtn || already, `${tag} admin sees Join on a seller thread (or has joined)`);
      if (joinBtn) { await ap.click('#cjoin'); await sleep(1200); }
      ok(await ap.$$eval('.msys', e => e.some(x => /joined/.test(x.textContent))), `${tag} join posts a system message`);
      const n0 = await ap.$$eval('.bub.del', e => e.length);
      await ap.evaluate(() => document.querySelector('[data-del]').click()); await sleep(1000);
      ok(await ap.$$eval('.bub.del', e => e.length) === n0 + 1, `${tag} admin can remove a message`);
      await ap.goto(B + '/admin/#/chats', { waitUntil: 'networkidle2' }); await sleep(1000);
      ok(!!(await ap.$('#cf')) && !!(await ap.$(`[data-thread="${tid}"]`)), `${tag} admin Messages list with filters`);
      await ap.close();
      // customer support thread + list page
      await pg.goto(B + '/#/chats', { waitUntil: 'networkidle2' }); await sleep(900);
      ok(!!(await pg.$('#newsupport')) && !!(await pg.$('.chathead-list a.wa')), `${tag} Messages page has support + WhatsApp buttons`);
      await pg.click('#newsupport'); await sleep(1200);
      ok(await pg.$eval('.chathead b', b => b.textContent) === 'Mohan Mishra Support', `${tag} support thread opens`);
      ok(errs.length === 0, `${tag} no page errors ${errs.join('; ')}`);
      await pg.close();
    }
  } finally { await br.close(); }
  console.log(`\n${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
