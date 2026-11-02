// Browser smoke test: super-admin password management dialog + "change my password" in admin and vendor panels.
// Usage: BASE=http://localhost:4199 node tests/browser-password.js   (fresh AUTO_SEED db; needs puppeteer-core + Chrome)
let puppeteer; try { puppeteer = require('puppeteer-core'); } catch { puppeteer = require('/tmp/pp/node_modules/puppeteer-core'); }
const B = process.env.BASE || 'http://localhost:4199';
let pass = 0, fail = 0; const ok = (c, m) => { c ? pass++ : fail++; console.log((c ? '  ✓ ' : '  ✗ ') + m); };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const api = async (m, u, b, t) => { const r = await fetch(B + '/api/v1' + u, { method: m, headers: { 'content-type': 'application/json', ...(t ? { authorization: 'Bearer ' + t } : {}) }, body: b ? JSON.stringify(b) : undefined }); return { status: r.status, data: await r.json() }; };
(async () => {
  const br = await puppeteer.launch({ executablePath: process.env.CHROME || '/usr/bin/google-chrome', headless: 'new', args: ['--no-sandbox'] });
  try {
    for (const vp of [[1366, 860, false], [360, 740, true]]) {
      const tag = `[${vp[0]}]`;
      const pg = await br.newPage(); await pg.setViewport({ width: vp[0], height: vp[1], isMobile: vp[2], hasTouch: vp[2] });
      const errs = []; pg.on('pageerror', e => errs.push(e.message)); pg.on('dialog', d => d.accept());
      const adm = (await api('POST', '/auth/login', { identifier: 'admin@mohanmishra.in', password: 'Admin@123' })).data;
      await pg.goto(B + '/admin/', { waitUntil: 'networkidle2' });
      await pg.evaluate(d => { localStorage.setItem('mm_token', d.token); localStorage.setItem('mm_user', JSON.stringify(d.user)); localStorage.setItem('mm_install_dismissed', '1'); }, adm);
      for (const [hash, label] of [['/staff', 'Staff'], ['/vendors', 'Vendors'], ['/customers', 'Customers']]) {
        await pg.goto(B + '/admin/#' + hash, { waitUntil: 'networkidle2' }); await pg.reload({ waitUntil: 'networkidle2' }); await sleep(700);
        ok(await pg.$('[data-pw]') !== null, `${tag} ${label} list has a Reset / Set password action`);
      }
      // Staff list → open dialog for ops@ and generate
      await pg.goto(B + '/admin/#/staff', { waitUntil: 'networkidle2' }); await sleep(700);
      const opsId = (await api('POST', '/auth/login', { identifier: 'ops@mohanmishra.in', password: 'Staff@123' })).data.user.id;
      await pg.evaluate(id => document.querySelector(`[data-pw="${id}"]`).click(), opsId); await sleep(300);
      const dlg = await pg.evaluate(() => { const m = document.querySelector('#modal'); const c = m.querySelector('.card'); const r = c.getBoundingClientRect(); return { open: !m.hidden, t: c.innerText, fits: r.left >= -1 && r.right <= innerWidth + 1, hasGen: !!c.querySelector('#pwgen'), hasEye: !!c.querySelector('[data-eye]'), hasInput: !!c.querySelector('#npw') }; });
      ok(dlg.open && dlg.hasGen && dlg.hasEye && dlg.hasInput, `${tag} dialog has password field, show/hide and Generate`);
      ok(/Shown once — share it securely/.test(dlg.t), `${tag} dialog shows the "Shown once" note`);
      ok(dlg.fits, `${tag} dialog fits the viewport`);
      await pg.click('[data-eye="npw"]'); ok(await pg.$eval('#npw', i => i.type) === 'text', `${tag} show/hide toggles visibility`);
      await pg.type('#npw', 'weakpass'); await pg.click('#pwset'); await sleep(400);
      ok(await pg.$eval('#pwout', e => e.hidden), `${tag} weak password is not submitted`);
      await pg.click('#pwgen'); await sleep(900);
      const gen = await pg.evaluate(() => ({ vis: !document.querySelector('#pwout').hidden, v: document.querySelector('#pwval').textContent, copy: !!document.querySelector('#pwcopy') }));
      ok(gen.vis && gen.v.length >= 12 && gen.copy, `${tag} generated password shown once with Copy button`);
      ok((await api('POST', '/auth/login', { identifier: 'ops@mohanmishra.in', password: gen.v })).status === 200, `${tag} generated password works for login`);
      await pg.click('#pwclose');
      // restore seeded staff password via the API so other suites keep working
      ok((await api('POST', `/admin/users/${opsId}/password`, { password: 'Staff@123' }, adm.token)).status === 200, `${tag} admin manual set (restore) works`);
      // admin change-my-password dialog
      ok(await pg.$('#mypw') !== null, `${tag} admin panel has a Password (change my password) action`);
      await pg.evaluate(() => document.querySelector('#mypw').click()); await sleep(300);
      ok(await pg.evaluate(() => !!document.querySelector('#modal #cpw') && !!document.querySelector('#modal #npw2')), `${tag} change-my-password dialog opens (admin)`);
      await pg.evaluate(() => closeModal());
      // vendor panel
      const ven = (await api('POST', '/auth/login', { identifier: 'vendor1@mohanmishra.in', password: 'Vendor@123' })).data;
      await pg.goto(B + '/vendor/', { waitUntil: 'networkidle2' });
      await pg.evaluate(d => { localStorage.setItem('mm_token', d.token); localStorage.setItem('mm_user', JSON.stringify(d.user)); }, ven);
      await pg.reload({ waitUntil: 'networkidle2' }); await sleep(800);
      ok(await pg.$('#mypw') !== null, `${tag} vendor panel has a Password action`);
      await pg.evaluate(() => document.querySelector('#mypw').click()); await sleep(300);
      ok(await pg.evaluate(() => !!document.querySelector('#modal #cpw')), `${tag} change-my-password dialog opens (vendor)`);
      ok(errs.length === 0, `${tag} no page errors${errs.length ? ' → ' + errs[0] : ''}`);
      // Google sign-in ships disabled: no button on the customer login when GOOGLE_CLIENT_ID is unset
      await pg.goto(B + '/#/login', { waitUntil: 'networkidle2' }); await pg.evaluate(() => localStorage.clear()); await pg.reload({ waitUntil: 'networkidle2' }); await sleep(800);
      ok(!/Continue with Google/i.test(await pg.evaluate(() => document.body.innerText)) && !(await pg.$('#gsibtn')), `${tag} Google button hidden when GOOGLE_CLIENT_ID is unset`);
      await pg.close();
    }
  } catch (e) { fail++; console.log('  ✗ ' + e.message); }
  await br.close(); console.log(`\n${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0);
})();
