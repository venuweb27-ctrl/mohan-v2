// Boot
(async () => {
  try { S.config = await GET('/config'); } catch { S.config = {}; }
  if (S.token) { try { const m = await api('GET', '/auth/me', undefined, { quiet: 1 }); S.user = m.user; localStorage.setItem('mm_user', JSON.stringify(m.user)); } catch { } }
  if (area() === 'customer' && typeof refreshCart === 'function') refreshCart().catch(() => { });
  document.title = { vendor: 'Seller Hub · Mohan Mishra', admin: 'Admin · Mohan Mishra' }[area()] || 'Mohan Mishra — Machinery Marketplace';
  route();
})();

// PWA: service worker + install prompt
if ('serviceWorker' in navigator && location.protocol !== 'file:') window.addEventListener('load', () => navigator.serviceWorker.register('/sw.js', { scope: '/' }).catch(() => { }));
let deferredInstall = null;
window.addEventListener('beforeinstallprompt', e => {
  e.preventDefault(); deferredInstall = e; if (localStorage.getItem('mm_install_dismissed') || area() !== 'customer') return;
  const b = document.createElement('div'); b.className = 'installbar glass'; b.id = 'installbar';
  b.innerHTML = `<img src="/icons/icon-192.png" alt=""><div><b>Install Mohan Mishra</b><div class="small muted">Faster access to machines, orders & invoices</div></div><button class="btn amber" id="ib-go">Install</button><button class="iconbtn" id="ib-x" aria-label="Dismiss">✕</button>`;
  document.body.appendChild(b);
  $('#ib-go').onclick = async () => { b.remove(); deferredInstall.prompt(); await deferredInstall.userChoice.catch(() => { }); deferredInstall = null; };
  $('#ib-x').onclick = () => { b.remove(); localStorage.setItem('mm_install_dismissed', '1'); };
});
window.addEventListener('appinstalled', () => { $('#installbar')?.remove(); toast('App installed'); });
