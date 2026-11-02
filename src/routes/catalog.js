const router = require('express').Router();
const { db, E, wrap, J, pageResult, paginate } = require('../core');

const PSELECT = `SELECT p.*, v.business_name vendor_name, v.city vendor_city, v.state vendor_state, v.rating vendor_rating, v.rating_count vendor_rating_count, b.name brand_name, b.manufacturer, c.name category_name, sc.name subcategory_name
 FROM products p JOIN vendors v ON v.id=p.vendor_id LEFT JOIN brands b ON b.id=p.brand_id LEFT JOIN categories c ON c.id=p.category_id LEFT JOIN categories sc ON sc.id=p.subcategory_id`;
const PUBLIC_WHERE = `p.status='approved' AND p.active=1 AND v.status='active' AND p.purchase_available=1`; // rentals off: rental-only listings are hidden
function shape(p, full = false) {
  if (!p) return p;
  const o = { ...p, images: J(p.images, []), videos: J(p.videos, []), specs: J(p.specs, {}), in_stock: p.stock > 0, rental_pricing: p.rental_available ? { hourly: p.rent_hourly, daily: p.rent_daily, weekly: p.rent_weekly, monthly: p.rent_monthly, security_deposit: p.security_deposit } : null };
  o.image = o.images[0] || '/assets/placeholder.svg';
  if (!full) { delete o.description; delete o.maintenance; delete o.return_policy; delete o.cancellation_policy; }
  return o;
}
function buildFilter(q, user) {
  const where = [PUBLIC_WHERE]; const params = [];
  if (q.q) {
    const terms = String(q.q).trim().split(/\s+/).slice(0, 6);
    for (const t of terms) { where.push(`(p.name LIKE ? OR p.model_no LIKE ? OR b.name LIKE ? OR b.manufacturer LIKE ? OR c.name LIKE ? OR sc.name LIKE ? OR p.specs LIKE ? OR p.fuel_type LIKE ? OR p.horsepower LIKE ?)`); const l = `%${t}%`; params.push(l, l, l, l, l, l, l, l, l); }
  }
  const cat = q.category || q.category_id;
  if (cat) { const c = db.one('SELECT id FROM categories WHERE id=? OR slug=?', cat, cat); if (c) { where.push('(p.category_id=? OR p.subcategory_id=?)'); params.push(c.id, c.id); } else where.push('1=0'); }
  if (q.subcategory || q.subcategory_id) { const ids = String(q.subcategory || q.subcategory_id).split(',').map(Number).filter(Boolean); if (ids.length) { where.push(`p.subcategory_id IN (${ids.map(() => '?').join(',')})`); params.push(...ids); } }
  if (q.brand || q.brand_id) { const ids = String(q.brand || q.brand_id).split(',').map(Number).filter(Boolean); if (ids.length) { where.push(`p.brand_id IN (${ids.map(() => '?').join(',')})`); params.push(...ids); } }
  if (q.manufacturer) { where.push('b.manufacturer LIKE ?'); params.push(`%${q.manufacturer}%`); }
  if (q.condition) { const cs = String(q.condition).split(',').filter(c => ['new', 'used', 'refurbished'].includes(c)); if (cs.length) { where.push(`p.condition IN (${cs.map(() => '?').join(',')})`); params.push(...cs); } }
  if (q.min_price) { where.push('p.price >= ?'); params.push(+q.min_price); }
  if (q.max_price) { where.push('p.price <= ?'); params.push(+q.max_price); }
  if (q.city) { where.push('(p.location_city LIKE ? OR v.city LIKE ?)'); params.push(`%${q.city}%`, `%${q.city}%`); }
  if (q.state) { where.push('(p.location_state LIKE ? OR v.state LIKE ?)'); params.push(`%${q.state}%`, `%${q.state}%`); }
  if (q.lat && q.lng) { const r = (+q.radius_km || 300) / 111; where.push('p.lat BETWEEN ? AND ? AND p.lng BETWEEN ? AND ?'); params.push(+q.lat - r, +q.lat + r, +q.lng - r, +q.lng + r); }
  if (q.vendor_rating) { where.push('v.rating >= ?'); params.push(+q.vendor_rating); }
  if (q.vendor_id) { where.push('p.vendor_id=?'); params.push(+q.vendor_id); }
  if (q.in_stock === '1' || q.availability === 'in_stock') where.push('p.stock > 0');
  if (q.mode === 'purchase') where.push('p.purchase_available=1');
  if (q.featured === '1') where.push('p.featured=1');
  if (q.fuel_type) { where.push('p.fuel_type LIKE ?'); params.push(`%${q.fuel_type}%`); }
  if (q.year_min) { where.push('p.mfg_year >= ?'); params.push(+q.year_min); }
  const sorts = { price_asc: 'p.price ASC', price_desc: 'p.price DESC', popular: '(p.views + p.sold*20) DESC', newest: 'p.created_at DESC, p.id DESC', rating: 'p.rating DESC', relevance: 'p.featured DESC, p.promoted DESC, p.rating DESC' };
  let order = sorts[q.sort] || sorts.relevance;
  if (q.lat && q.lng && (q.sort === 'distance' || !q.sort)) { order = '((p.lat-?)*(p.lat-?)+(p.lng-?)*(p.lng-?)) ASC'; params.push(+q.lat, +q.lat, +q.lng, +q.lng); }
  return { sql: `${PSELECT} WHERE ${where.join(' AND ')} ORDER BY ${order}, p.id DESC`, params };
}

router.get('/products', wrap((req, res) => {
  const { sql, params } = buildFilter(req.query, req.user);
  if (req.query.q && String(req.query.q).trim().length > 1) db.insert('search_history', { user_id: req.user?.id || null, q: String(req.query.q).trim().toLowerCase().slice(0, 80) });
  const r = pageResult(sql, params, req, p => shape(p));
  // facets for filters UI
  r.facets = {
    brands: db.all(`SELECT b.id,b.name,COUNT(*) c FROM products p JOIN vendors v ON v.id=p.vendor_id JOIN brands b ON b.id=p.brand_id WHERE ${PUBLIC_WHERE} GROUP BY b.id ORDER BY c DESC`),
    conditions: db.all(`SELECT p.condition value, COUNT(*) c FROM products p JOIN vendors v ON v.id=p.vendor_id WHERE ${PUBLIC_WHERE} GROUP BY p.condition`),
    price: db.one(`SELECT MIN(p.price) min, MAX(p.price) max FROM products p JOIN vendors v ON v.id=p.vendor_id WHERE ${PUBLIC_WHERE}`),
    cities: db.all(`SELECT p.location_city value, COUNT(*) c FROM products p JOIN vendors v ON v.id=p.vendor_id WHERE ${PUBLIC_WHERE} AND p.location_city IS NOT NULL GROUP BY p.location_city ORDER BY c DESC LIMIT 20`),
  };
  res.json(r);
}));
router.get('/search/suggest', wrap((req, res) => {
  const q = String(req.query.q || '').trim(); if (q.length < 1) return res.json({ products: [], categories: [], brands: [] });
  const l = `%${q}%`;
  res.json({
    products: db.all(`SELECT p.id,p.name,p.model_no,p.images,p.price FROM products p JOIN vendors v ON v.id=p.vendor_id WHERE ${PUBLIC_WHERE} AND (p.name LIKE ? OR p.model_no LIKE ?) ORDER BY p.views DESC LIMIT 6`, l, l).map(p => ({ ...p, image: J(p.images, [])[0], images: undefined })),
    categories: db.all('SELECT id,name,slug,parent_id FROM categories WHERE active=1 AND name LIKE ? LIMIT 5', l),
    brands: db.all('SELECT id,name,manufacturer FROM brands WHERE active=1 AND (name LIKE ? OR manufacturer LIKE ?) LIMIT 5', l, l),
  });
}));
router.get('/search/popular', (req, res) => res.json({ items: db.all("SELECT q, COUNT(*) c FROM search_history WHERE created_at > datetime('now','-30 days') GROUP BY q ORDER BY c DESC LIMIT 10").map(r => r.q) }));
router.get('/search/history', (req, res) => { if (!req.user) return res.json({ items: [] }); res.json({ items: db.all('SELECT q, MAX(created_at) at FROM search_history WHERE user_id=? GROUP BY q ORDER BY at DESC LIMIT 10', req.user.id).map(r => r.q) }); });
router.delete('/search/history', (req, res) => { if (req.user) db.run('DELETE FROM search_history WHERE user_id=?', req.user.id); res.json({ ok: true }); });

router.get('/products/:id', wrap((req, res) => {
  const p = db.one(`${PSELECT} WHERE (p.id=? OR p.slug=?)`, req.params.id, req.params.id);
  const staffView = req.user && (['admin', 'staff'].includes(req.user.role) || (req.user.vendor && req.user.vendor.id === p?.vendor_id));
  if (!p || (!staffView && (p.status !== 'approved' || !p.active))) throw E.notFound('Machine not found');
  db.run('UPDATE products SET views=views+1 WHERE id=?', p.id);
  if (req.user?.role === 'customer') db.run('INSERT INTO recent_views(user_id,product_id,viewed_at) VALUES(?,?,CURRENT_TIMESTAMP) ON CONFLICT(user_id,product_id) DO UPDATE SET viewed_at=CURRENT_TIMESTAMP', req.user.id, p.id);
  const vendor = db.one('SELECT id,business_name,business_type,city,state,address,rating,rating_count,logo,description,operating_hours,created_at,gstin FROM vendors WHERE id=?', p.vendor_id);
  const o = shape(p, true);
  o.vendor = { ...vendor, gstin_verified: true };
  o.reviews = db.all(`SELECT r.id,r.rating,r.title,r.comment,r.created_at,u.name user_name FROM reviews r JOIN users u ON u.id=r.user_id WHERE r.product_id=? AND r.status='published' ORDER BY r.id DESC LIMIT 20`, p.id);
  o.similar = db.all(`${PSELECT} WHERE ${PUBLIC_WHERE} AND p.category_id=? AND p.id<>? ORDER BY p.rating DESC LIMIT 8`, p.category_id, p.id).map(x => shape(x));
  o.in_wishlist = !!(req.user && db.one('SELECT 1 FROM wishlist WHERE user_id=? AND product_id=?', req.user.id, p.id));
  const base = process.env.PUBLIC_URL || '';
  const link = `${base}/#/product/${p.id}`; const text = `${p.name} – ₹${p.price.toLocaleString('en-IN')} on Mohan Mishra`;
  o.share = { url: link, whatsapp: `https://wa.me/?text=${encodeURIComponent(text + ' ' + link)}`, email: `mailto:?subject=${encodeURIComponent(p.name)}&body=${encodeURIComponent(text + '\n' + link)}`, text };
  o.price_breakup = { price: p.price, gst_rate: p.gst_rate, gst_amount: Math.round(p.price * p.gst_rate) / 100, delivery_charge: p.delivery_charge, installation_charge: p.installation_charge };
  res.json(o);
}));
router.get('/products/:id/reviews', (req, res) => res.json(pageResult(`SELECT r.*,u.name user_name FROM reviews r JOIN users u ON u.id=r.user_id WHERE r.product_id=? AND r.status='published' ORDER BY r.id DESC`, [req.params.id], req)));
router.get('/products/:id/availability', wrap((req, res) => {
  const p = db.one('SELECT * FROM products WHERE id=?', req.params.id); if (!p) throw E.notFound();
  const { rentalAvailability } = require('../services');
  const start = req.query.start || new Date().toISOString(); const end = req.query.end || new Date(Date.now() + 86400000).toISOString();
  res.json({ product_id: p.id, stock: p.stock, purchase_available: !!p.purchase_available, rental_available: !!p.rental_available, rental: p.rental_available ? rentalAvailability(p, start, end) : null, start, end });
}));

router.get('/categories', (req, res) => {
  const all = db.all('SELECT c.*, (SELECT COUNT(*) FROM products p WHERE (p.category_id=c.id OR p.subcategory_id=c.id) AND p.status=\'approved\' AND p.active=1) product_count FROM categories c WHERE active=1 ORDER BY sort_order, name');
  const tops = all.filter(c => !c.parent_id).map(c => ({ ...c, subcategories: all.filter(s => s.parent_id === c.id) }));
  res.json({ items: tops });
});
router.get('/categories/:id', wrap((req, res) => {
  const c = db.one('SELECT * FROM categories WHERE (id=? OR slug=?) AND active=1', req.params.id, req.params.id); if (!c) throw E.notFound();
  c.subcategories = db.all('SELECT * FROM categories WHERE parent_id=? AND active=1 ORDER BY sort_order', c.id);
  c.attributes = db.all('SELECT * FROM attributes WHERE category_id=? OR category_id=?', c.id, c.parent_id || -1);
  res.json(c);
}));
router.get('/brands', (req, res) => res.json({ items: db.all('SELECT * FROM brands WHERE active=1 ORDER BY name') }));
router.get('/vendors', (req, res) => res.json(pageResult(`SELECT id,business_name,city,state,rating,rating_count,logo,banner,description,featured,(SELECT COUNT(*) FROM products p WHERE p.vendor_id=vendors.id AND p.status='approved') product_count FROM vendors WHERE status='active' ${req.query.featured === '1' ? 'AND featured=1' : ''} ORDER BY featured DESC, rating DESC`, [], req)));
router.get('/vendors/:id', wrap((req, res) => {
  const v = db.one("SELECT id,business_name,business_type,city,state,address,rating,rating_count,logo,banner,description,operating_hours,created_at FROM vendors WHERE id=? AND status='active'", req.params.id); if (!v) throw E.notFound();
  v.reviews = db.all("SELECT r.rating,r.comment,r.created_at,u.name user_name FROM reviews r JOIN users u ON u.id=r.user_id WHERE r.vendor_id=? AND r.product_id IS NULL AND r.status='published' ORDER BY r.id DESC LIMIT 20", v.id);
  res.json(v);
}));
router.get('/home', wrap((req, res) => {
  const L = (where, order, n = 10, params = []) => db.all(`${PSELECT} WHERE ${PUBLIC_WHERE} ${where ? 'AND ' + where : ''} ORDER BY ${order} LIMIT ${n}`, ...params).map(p => shape(p));
  let recommended = [], recently_viewed = [];
  if (req.user) {
    recently_viewed = db.all(`${PSELECT} JOIN recent_views rv ON rv.product_id=p.id AND rv.user_id=? WHERE ${PUBLIC_WHERE} ORDER BY rv.viewed_at DESC LIMIT 10`, req.user.id).map(p => shape(p));
    const cats = [...new Set(recently_viewed.map(p => p.category_id))];
    if (cats.length) recommended = L(`p.category_id IN (${cats.map(() => '?').join(',')}) AND p.id NOT IN (SELECT product_id FROM recent_views WHERE user_id=?)`, 'p.rating DESC', 10, [...cats, req.user.id]);
  }
  if (recommended.length < 4) recommended = recommended.concat(L('', 'p.rating DESC, p.views DESC', 10 - recommended.length));
  const lat = +req.query.lat, lng = +req.query.lng;
  const nearby = lat && lng ? db.all(`${PSELECT} WHERE ${PUBLIC_WHERE} AND p.lat IS NOT NULL ORDER BY ((p.lat-?)*(p.lat-?)+(p.lng-?)*(p.lng-?)) LIMIT 10`, lat, lat, lng, lng).map(p => shape(p)) : (req.query.city ? L('p.location_city LIKE ?', 'p.rating DESC', 10, [`%${req.query.city}%`]) : []);
  res.json({
    banners: db.all("SELECT * FROM banners WHERE active=1 AND placement='home' ORDER BY sort_order"),
    categories: db.all('SELECT * FROM categories WHERE active=1 AND parent_id IS NULL ORDER BY featured DESC, sort_order'),
    featured: L('p.featured=1', 'p.promoted DESC, p.rating DESC'),
    popular: L('', '(p.views + p.sold*20) DESC'),
    recent: L('', 'p.created_at DESC, p.id DESC'),
    rental: [], // rentals switched off; key kept for API compatibility
    recommended, recently_viewed, nearby,
    featured_vendors: db.all("SELECT id,business_name,city,state,rating,rating_count,logo FROM vendors WHERE status='active' AND featured=1 ORDER BY rating DESC LIMIT 10"),
    announcements: db.all("SELECT * FROM announcements WHERE active=1 AND audience IN ('all','customers') ORDER BY id DESC LIMIT 3"),
    popular_searches: db.all("SELECT q, COUNT(*) c FROM search_history GROUP BY q ORDER BY c DESC LIMIT 8").map(r => r.q),
  });
}));
router.get('/banners', (req, res) => res.json({ items: db.all("SELECT * FROM banners WHERE active=1 AND placement=? ORDER BY sort_order", req.query.placement || 'home') }));
router.get('/cms/:slug', wrap((req, res) => { const p = db.one('SELECT * FROM cms_pages WHERE slug=? AND active=1', req.params.slug); if (!p) throw E.notFound(); res.json(p); }));
router.get('/cms', (req, res) => res.json({ items: db.all('SELECT slug,title,meta_title,meta_description FROM cms_pages WHERE active=1') }));
router.get('/faqs', (req, res) => res.json({ items: db.all('SELECT * FROM faqs WHERE active=1 ORDER BY category, sort_order') }));
router.get('/announcements', (req, res) => res.json({ items: db.all("SELECT * FROM announcements WHERE active=1 ORDER BY id DESC LIMIT 20") }));
router.get('/config', (req, res) => res.json({ company: db.setting('company', {}), advance_pct: db.setting('advance_pct', 25), payment_providers: ['mock', 'razorpay', 'cashfree'], default_provider: process.env.PAYMENT_PROVIDER || 'mock', payment_methods: ['upi', 'gpay', 'phonepe', 'paytm', 'card', 'netbanking', 'wallet'], support: db.setting('support', {}), google_client_id: process.env.GOOGLE_CLIENT_ID || null, google_mock: require('../providers').google.mock(), whatsapp_number: (process.env.WHATSAPP_CHAT_NUMBER || '919522224488').replace(/\D/g, ''), chat_poll_ms: +(process.env.CHAT_POLL_MS || 5000), states: require('../core').STATES }));

module.exports = router; module.exports.shape = shape; module.exports.PSELECT = PSELECT;
