// Boot
(async () => {
  try { S.config = await GET('/config'); } catch { S.config = {}; }
  if (S.token) { try { const m = await api('GET', '/auth/me', undefined, { quiet: 1 }); S.user = m.user; localStorage.setItem('mm_user', JSON.stringify(m.user)); } catch { } }
  if (area() === 'customer' && typeof refreshCart === 'function') refreshCart().catch(() => { });
  document.title = { vendor: 'Seller Hub · Mohan Mishra', admin: 'Admin · Mohan Mishra' }[area()] || 'Mohan Mishra — Machinery Marketplace';
  route();
})();
