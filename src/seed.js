// Seed demo data. Usage: node src/seed.js [--reset]
const fs = require('fs'); const path = require('path');
const bcrypt = require('bcryptjs');
if (process.argv.includes('--reset')) { const p = process.env.DB_PATH || path.join(__dirname, '..', 'data', 'mohanmishra.db'); for (const f of [p, p + '-wal', p + '-shm']) try { fs.unlinkSync(f); } catch { } }
const db = require('./db');
const { MODULES } = require('./core');

const IMG_DIR = path.join(__dirname, '..', 'web', 'img', 'seed'); fs.mkdirSync(IMG_DIR, { recursive: true });
const GLYPH = {
  cnc: '<rect x="70" y="110" width="260" height="130" rx="14" fill="#fff" opacity=".85"/><rect x="95" y="130" width="150" height="85" rx="8" fill="#9fb4ff" opacity=".6"/><rect x="260" y="135" width="45" height="60" rx="6" fill="#7c8cf8"/><circle cx="283" cy="210" r="8" fill="#34c38f"/><rect x="150" y="80" width="40" height="55" fill="#6b7bd6"/>',
  compressor: '<rect x="80" y="150" width="240" height="90" rx="45" fill="#fff" opacity=".9"/><rect x="140" y="100" width="90" height="60" rx="10" fill="#8aa0f7"/><circle cx="120" cy="250" r="16" fill="#5a67b8"/><circle cx="280" cy="250" r="16" fill="#5a67b8"/><circle cx="260" cy="125" r="18" fill="#ffd6b8"/>',
  generator: '<rect x="70" y="110" width="260" height="140" rx="16" fill="#fff" opacity=".9"/><g fill="#9aa7f0">' + [0, 1, 2, 3, 4].map(i => `<rect x="${95 + i * 22}" y="135" width="12" height="90" rx="6"/>`).join('') + '</g><rect x="225" y="140" width="80" height="50" rx="8" fill="#ffcfb0"/><path d="M262 150 l-12 22h14l-8 16" stroke="#e8793a" stroke-width="5" fill="none"/>',
  earthmoving: '<rect x="150" y="120" width="110" height="80" rx="10" fill="#ffc861"/><rect x="170" y="85" width="60" height="45" rx="6" fill="#fff" opacity=".9"/><rect x="80" y="195" width="200" height="40" rx="20" fill="#5a5f7a"/><path d="M260 150 l50 -40 l30 60 h-40z" fill="#f2a93b"/><circle cx="110" cy="215" r="14" fill="#2f3247"/><circle cx="250" cy="215" r="14" fill="#2f3247"/>',
  packaging: '<rect x="60" y="170" width="280" height="40" rx="10" fill="#fff" opacity=".9"/><g fill="#ffcfb0">' + [0, 1, 2].map(i => `<rect x="${90 + i * 80}" y="130" width="50" height="42" rx="4"/>`).join('') + '</g><rect x="160" y="70" width="80" height="55" rx="8" fill="#9aa7f0"/><rect x="190" y="125" width="20" height="20" fill="#6b7bd6"/>',
  pump: '<circle cx="190" cy="170" r="65" fill="#fff" opacity=".9"/><circle cx="190" cy="170" r="30" fill="#8fc3ff"/><rect x="250" y="155" width="80" height="30" rx="8" fill="#6b9cf0"/><rect x="175" y="60" width="30" height="50" rx="6" fill="#6b9cf0"/><rect x="110" y="235" width="160" height="16" rx="8" fill="#5a67b8"/>',
  welding: '<rect x="90" y="120" width="170" height="120" rx="16" fill="#fff" opacity=".9"/><circle cx="140" cy="170" r="22" fill="#9aa7f0"/><rect x="190" y="150" width="50" height="10" rx="5" fill="#6b7bd6"/><rect x="190" y="175" width="50" height="10" rx="5" fill="#6b7bd6"/><path d="M260 200 q50 -10 60 -70" stroke="#5a5f7a" stroke-width="7" fill="none"/><circle cx="320" cy="125" r="10" fill="#ffb347"/>',
  tools: '<rect x="80" y="150" width="200" height="60" rx="18" fill="#fff" opacity=".9"/><rect x="270" y="165" width="60" height="30" rx="6" fill="#9aa7f0"/><rect x="120" y="200" width="45" height="60" rx="10" fill="#6b7bd6"/>',
};
// Industrial studio palette (navy / safety-orange / steel) — clean product-shot backdrop, no baked rounding.
const PAL = [['#f1f5f9', '#e2e8f0'], ['#eef2f7', '#dbe4ef'], ['#f8fafc', '#e5eaf1']];
const RECOLOR = { '#fff': '#f8fafc', '#9fb4ff': '#5b7fa6', '#7c8cf8': '#123b65', '#6b7bd6': '#1e4f82', '#8aa0f7': '#2c5d8f', '#5a67b8': '#0f2f52', '#ffd6b8': '#f59e0b', '#9aa7f0': '#3a6a9b', '#ffcfb0': '#fbbf24', '#e8793a': '#123b65', '#ffc861': '#f59e0b', '#5a5f7a': '#334155', '#f2a93b': '#d97706', '#2f3247': '#1f2937', '#8fc3ff': '#5b7fa6', '#6b9cf0': '#1e4f82', '#ffb347': '#f59e0b', '#34c38f': '#16a34a' };
function svg(name, kind, i = 0) {
  const [a, b] = PAL[i % 3]; const file = `${name}.svg`;
  const g = (GLYPH[kind] || GLYPH.tools).replace(/#[0-9a-fA-F]{3,6}\b/g, c => RECOLOR[c.toLowerCase()] || c).replace(/opacity="\.(85|9)"/g, 'stroke="#cbd5e1" stroke-width="2"');
  fs.writeFileSync(path.join(IMG_DIR, file), `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 600"><defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${a}"/><stop offset="1" stop-color="${b}"/></linearGradient><radialGradient id="s" cx=".5" cy=".5" r=".5"><stop offset="0" stop-color="#0f172a" stop-opacity=".28"/><stop offset="1" stop-color="#0f172a" stop-opacity="0"/></radialGradient></defs><rect width="800" height="600" fill="url(#g)"/><rect y="470" width="800" height="130" fill="#000" opacity=".03"/><ellipse cx="400" cy="512" rx="300" ry="26" fill="url(#s)"/><g transform="scale(2)">${g}</g></svg>`);
  return `/img/seed/${file}`;
}
const H = p => bcrypt.hashSync(p, 8);
const ins = db.insert;

db.transaction(() => {
  // settings
  const S = (k, v) => db.setSetting(k, v);
  S('company', { name: 'Mohan Mishra Multitrade Private Limited', gstin: '09AAHCM7149Q1ZK', pan: 'AAHCM7149Q', address: '23, Mainapur Rd, Mainapur, Ghaziabad, Uttar Pradesh 201017, India', state: 'Uttar Pradesh', state_code: '09', email: 'mohanmishra9999@gmail.com', phone: '+91 95222 24488', cin: 'U52100CT2011PTC000081' });
  S('gateway_fee_pct', 2); S('tcs_pct', 0.5); S('tds_pct', 0.1); S('platform_fee', { type: 'fixed', value: 0 }); S('advance_pct', 25); S('rental_advance_pct', 30); S('min_withdrawal', 1000); S('withdrawal_fee', 0); S('einvoice_enabled', true);
  S('invoice_prefixes', { tax: 'MMT', proforma: 'MMPF', commission: 'MMC', credit_note: 'MMCN', debit_note: 'MMDN', receipt: 'MMRC', rental: 'MMRT', settlement: 'MMST', quotation: 'MMQI' });
  S('support', { phone: '+91 95222 24488', email: 'mohanmishra9999@gmail.com', hours: 'Mon–Sat 9:30–18:30 IST' });
  S('payment_providers', { default: 'mock', enabled: ['mock', 'razorpay', 'cashfree'] }); S('cod_enabled', false);

  // staff roles
  const all = lvl => Object.fromEntries(MODULES.map(m => [m, lvl]));
  ins('staff_roles', { name: 'Super Admin', permissions: all('approve'), is_system: 1 });
  const ops = ins('staff_roles', { name: 'Operations', permissions: { ...all('read'), orders: 'write', vendors: 'approve', catalog: 'approve', support: 'write', refunds: 'write', crm: 'write', staff: 'none', settings: 'none' } });
  const fin = ins('staff_roles', { name: 'Finance', permissions: { ...all('none'), payments: 'approve', withdrawals: 'approve', invoices: 'approve', refunds: 'approve', reports: 'read', commission: 'write', orders: 'read' } });
  ins('staff_roles', { name: 'Sales / CRM', permissions: { ...all('none'), crm: 'approve', customers: 'read', orders: 'read', reports: 'read' } });

  // users
  ins('users', { role: 'admin', name: 'Platform Admin', email: 'admin@mohanmishra.in', mobile: '9000000001', password_hash: H('Admin@123'), email_verified: 1, mobile_verified: 1 });
  ins('users', { role: 'staff', name: 'Ops Executive', email: 'ops@mohanmishra.in', mobile: '9000000002', password_hash: H('Staff@123'), staff_role_id: ops, email_verified: 1 });
  ins('users', { role: 'staff', name: 'Finance Executive', email: 'finance@mohanmishra.in', mobile: '9000000003', password_hash: H('Staff@123'), staff_role_id: fin, email_verified: 1 });
  const c1 = ins('users', { role: 'customer', name: 'Rahul Verma', email: 'rahul@example.com', mobile: '9876543210', password_hash: H('Customer@123'), mobile_verified: 1, email_verified: 1, account_type: 'business', business_name: 'Verma Fabricators', gstin: '09AAKFV1234B1ZQ', state_code: '09' });
  const c2 = ins('users', { role: 'customer', name: 'Priya Nair', email: 'priya@example.com', mobile: '9876543211', password_hash: H('Customer@123'), mobile_verified: 1, state_code: '27' });
  ins('addresses', { user_id: c1, label: 'Factory', name: 'Rahul Verma', mobile: '9876543210', line1: 'B-44, Sector 63', city: 'Noida', state: 'Uttar Pradesh', state_code: '09', pincode: '201301', gstin: '09AAKFV1234B1ZQ', lat: 28.62, lng: 77.38, is_default: 1 });
  ins('addresses', { user_id: c2, label: 'Workshop', name: 'Priya Nair', mobile: '9876543211', line1: '7 Bhosari MIDC', city: 'Pune', state: 'Maharashtra', state_code: '27', pincode: '411026', lat: 18.63, lng: 73.85, is_default: 1 });

  const VENDORS = [
    ['Shakti Machine Tools', 'vendor1@mohanmishra.in', '9100000001', '27AAFCS1111A1Z1', 'Pune', 'Maharashtra', '27', 18.52, 73.86],
    ['Bharat Power Systems', 'vendor2@mohanmishra.in', '9100000002', '24AAFCB2222B1Z2', 'Ahmedabad', 'Gujarat', '24', 23.02, 72.57],
    ['Deccan Earthmovers', 'vendor3@mohanmishra.in', '9100000003', '36AAFCD3333C1Z3', 'Hyderabad', 'Telangana', '36', 17.39, 78.49],
    ['Kaveri Pumps & Packaging', 'vendor4@mohanmishra.in', '9100000004', '33AAFCK4444D1Z4', 'Coimbatore', 'Tamil Nadu', '33', 11.02, 76.96],
  ];
  const vids = VENDORS.map(([n, e, m, g, city, st, sc, lat, lng], i) => {
    const uid = ins('users', { role: 'vendor', name: n.split(' ')[0] + ' Owner', email: e, mobile: m, password_hash: H('Vendor@123'), email_verified: 1, mobile_verified: 1, account_type: 'business', business_name: n });
    const vid = ins('vendors', { user_id: uid, business_name: n, business_type: 'private_limited', gstin: g, pan: g.slice(2, 12), address: `Unit ${i + 3}, Industrial Estate`, city, state: st, state_code: sc, pincode: ['411018', '382445', '500037', '641021'][i], lat, lng, authorized_person: n.split(' ')[0] + ' Owner', authorized_mobile: m, contact_email: e, bank_account_name: n, bank_account_no: '5010012345678' + i, bank_ifsc: 'HDFC0001234', bank_name: 'HDFC Bank', bank_verified: 1, gstin_verified: 1, pan_verified: 1, agreement_accepted: 1, commission_agreement_accepted: 1, kyc_status: 'approved', status: 'active', rating: [4.6, 4.3, 4.8, 4.2][i], rating_count: [38, 21, 54, 12][i], featured: i < 3 ? 1 : 0, description: `${n} — trusted supplier of industrial machinery with pan-India delivery, installation and AMC support.`, operating_hours: 'Mon–Sat 9:00–19:00', logo: svg('vendor' + (i + 1), ['cnc', 'generator', 'earthmoving', 'pump'][i], i) });
    ['gst_certificate', 'pan_card', 'cancelled_cheque'].forEach(d => ins('vendor_docs', { vendor_id: vid, doc_type: d, file_url: '/img/seed/vendor' + (i + 1) + '.svg', status: 'verified' }));
    return vid;
  });
  // a pending vendor for KYC flow
  const pu = ins('users', { role: 'vendor', name: 'New Vendor', email: 'vendor5@mohanmishra.in', mobile: '9100000005', password_hash: H('Vendor@123'), account_type: 'business' });
  ins('vendors', { user_id: pu, business_name: 'Sunrise Welding Solutions', gstin: '08AAFCS5555E1Z5', pan: 'AAFCS5555E', city: 'Jaipur', state: 'Rajasthan', state_code: '08', address: 'VKI Area', kyc_status: 'submitted', status: 'pending', bank_account_name: 'Sunrise', bank_account_no: '1234567890', bank_ifsc: 'ICIC0000123', agreement_accepted: 1, commission_agreement_accepted: 1 });

  // categories
  const CATS = [
    ['CNC Machines', 'cnc', '8457', 18, ['CNC Lathes', 'Vertical Machining Centres', 'CNC Routers']],
    ['Air Compressors', 'compressor', '8414', 18, ['Screw Compressors', 'Reciprocating Compressors']],
    ['Generators', 'generator', '8502', 18, ['Diesel Gensets', 'Portable Generators']],
    ['JCB & Earthmoving', 'earthmoving', '8429', 18, ['Backhoe Loaders', 'Excavators', 'Skid Steers']],
    ['Packaging Machines', 'packaging', '8422', 18, ['Pouch Packing', 'Strapping & Sealing']],
    ['Pumps', 'pump', '8413', 18, ['Centrifugal Pumps', 'Submersible Pumps']],
    ['Welding Machines', 'welding', '8515', 18, ['MIG / TIG Welders', 'Arc Welders']],
    ['Power Tools', 'tools', '8467', 18, ['Drills', 'Grinders']],
  ];
  const cat = {};
  CATS.forEach(([n, k, hsn, gst, subs], i) => {
    const id = ins('categories', { name: n, slug: k, hsn, gst_rate: gst, sort_order: i, featured: i < 6 ? 1 : 0, image: svg('cat-' + k, k, i), icon: k, description: `${n} for Indian industry — new and used.` });
    cat[k] = { id, subs: subs.map((s, j) => ins('categories', { name: s, parent_id: id, slug: k + '-' + j, hsn, gst_rate: gst, sort_order: j })) };
  });
  const BR = ['Ace Micromatic', 'Jyoti CNC', 'ELGi', 'Ingersoll Rand', 'Kirloskar', 'Cummins', 'JCB', 'Tata Hitachi', 'CASE', 'Nichrome', 'CRI Pumps', 'ESAB', 'Bosch', 'Makita'];
  const brand = Object.fromEntries(BR.map(b => [b, ins('brands', { name: b, manufacturer: b, country: ['Bosch', 'Makita', 'Ingersoll Rand', 'JCB', 'CASE', 'ESAB', 'Cummins'].includes(b) ? 'Global' : 'India' })]));
  [['cnc', 'Spindle speed', 'rpm'], ['cnc', 'Axis travel', 'mm'], ['compressor', 'Free air delivery', 'CFM'], ['compressor', 'Pressure', 'bar'], ['generator', 'Rating', 'kVA'], ['earthmoving', 'Bucket capacity', 'm³'], ['pump', 'Head', 'm'], ['pump', 'Discharge', 'LPM'], ['welding', 'Current', 'A']].forEach(([k, n, u]) => ins('attributes', { category_id: cat[k].id, name: n, unit: u, input_type: 'number' }));

  // products: [vendorIdx, catKey, subIdx, brand, name, model, price, mrp, cond, year, stock, rental{daily,weekly,monthly,deposit,units}|null, specs, extra]
  const P = [
    [0, 'cnc', 0, 'Ace Micromatic', 'Ace Jobber XL CNC Turning Centre', 'JOBBER-XL', 1850000, 2100000, 'new', 2025, 3, null, { 'Max turning dia': '350 mm', 'Spindle speed': '4000 rpm', Control: 'Fanuc 0i-TF', 'Chuck size': '8"' }, { power_req: '15 kVA, 415V 3-phase', weight: '3200 kg', installation_charge: 25000, delivery_charge: 18000 }],
    [0, 'cnc', 1, 'Jyoti CNC', 'Jyoti PX10 Vertical Machining Centre', 'PX10', 2650000, 2900000, 'new', 2025, 2, null, { 'X/Y/Z travel': '1020/510/510 mm', 'Spindle speed': '8000 rpm', ATC: '24 tools' }, { power_req: '20 kVA', weight: '5600 kg', installation_charge: 35000, delivery_charge: 25000 }],
    [0, 'cnc', 2, 'Jyoti CNC', 'Refurbished 3-Axis CNC Wood Router 1325', 'R1325', 385000, 520000, 'refurbished', 2021, 4, null, { 'Working area': '1300 x 2500 mm', Spindle: '3.2 kW water-cooled' }, { delivery_charge: 9000 }],
    [0, 'tools', 0, 'Bosch', 'Bosch GSB 13 RE Impact Drill Kit', 'GSB13RE', 3299, 4199, 'new', 2025, 120, null, { Power: '600 W', Chuck: '13 mm' }, { moq: 2 }],
    [0, 'tools', 1, 'Makita', 'Makita GA4030 Angle Grinder 100mm', 'GA4030', 2950, 3600, 'new', 2025, 80, null, { Power: '720 W', 'Disc dia': '100 mm' }, {}],
    [1, 'compressor', 0, 'ELGi', 'ELGi EG 15 Screw Air Compressor 15 kW', 'EG15', 485000, 540000, 'new', 2025, 6, null, { 'Free air delivery': '88 CFM', Pressure: '7.5 bar', Motor: '15 kW' }, { fuel_type: 'Electric', installation_charge: 8000, delivery_charge: 6000 }],
    [1, 'compressor', 1, 'Ingersoll Rand', 'Ingersoll Rand 2475 Reciprocating Compressor', '2475N7.5', 168000, 189000, 'new', 2024, 9, { daily: 1800, weekly: 10500, monthly: 36000, deposit: 15000, units: 3 }, { 'Free air delivery': '24.1 CFM', Pressure: '12 bar', Tank: '500 L' }, { fuel_type: 'Electric' }],
    [1, 'generator', 0, 'Kirloskar', 'Kirloskar Green 62.5 kVA Silent DG Set', 'KG1-62.5WS', 845000, 910000, 'new', 2025, 5, { daily: 4500, weekly: 27000, monthly: 90000, deposit: 50000, units: 4 }, { Rating: '62.5 kVA', Engine: '4R1040TAG2', 'Fuel tank': '120 L', Noise: '75 dB(A)@1m' }, { fuel_type: 'Diesel', engine_capacity: '4.1 L', horsepower: '78 HP', installation_charge: 15000, delivery_charge: 12000 }],
    [1, 'generator', 0, 'Cummins', 'Cummins 125 kVA DG Set (Used, 2.1k hrs)', 'C125D5', 1150000, 1600000, 'used', 2020, 1, { daily: 7500, weekly: 45000, monthly: 150000, deposit: 100000, units: 1 }, { Rating: '125 kVA', 'Hours run': '2100' }, { fuel_type: 'Diesel', horsepower: '150 HP' }],
    [1, 'generator', 1, 'Kirloskar', 'Kirloskar 5 kVA Portable Petrol Generator', 'KG5000', 64500, 72000, 'new', 2025, 25, { daily: 900, weekly: 5000, monthly: 16000, deposit: 8000, units: 6 }, { Rating: '5 kVA', Start: 'Electric + recoil' }, { fuel_type: 'Petrol' }],
    [2, 'earthmoving', 0, 'JCB', 'JCB 3DX Super Backhoe Loader', '3DX-SUPER', 3450000, 3600000, 'new', 2025, 2, { hourly: 1400, daily: 9500, weekly: 60000, monthly: 210000, deposit: 150000, units: 3 }, { 'Bucket capacity': '1.1 m³', 'Dig depth': '4.77 m', 'Operating weight': '8020 kg' }, { fuel_type: 'Diesel', horsepower: '76 HP', engine_capacity: '4.4 L', delivery_charge: 35000 }],
    [2, 'earthmoving', 1, 'Tata Hitachi', 'Tata Hitachi EX 210 LC Excavator', 'EX210LC', 4950000, 5200000, 'new', 2024, 1, { hourly: 2400, daily: 16500, weekly: 105000, monthly: 360000, deposit: 250000, units: 2 }, { 'Bucket capacity': '0.9 m³', 'Operating weight': '21 t' }, { fuel_type: 'Diesel', horsepower: '148 HP', delivery_charge: 60000 }],
    [2, 'earthmoving', 2, 'CASE', 'CASE SR 220 Skid Steer Loader (Used)', 'SR220', 1750000, 2600000, 'used', 2019, 1, { hourly: 1100, daily: 7000, weekly: 44000, monthly: 150000, deposit: 100000, units: 1 }, { 'Rated capacity': '998 kg', 'Hours run': '3400' }, { fuel_type: 'Diesel', horsepower: '74 HP' }],
    [3, 'packaging', 0, 'Nichrome', 'Nichrome FFS Pouch Packing Machine', 'FILPACK-VFFS', 725000, 780000, 'new', 2025, 3, null, { Speed: '60 pouches/min', 'Fill range': '50 g – 1 kg' }, { installation_charge: 15000, delivery_charge: 10000 }],
    [3, 'packaging', 1, 'Nichrome', 'Semi-auto Box Strapping Machine', 'SS-200', 58500, 65000, 'new', 2025, 14, null, { 'Strap width': '9–15 mm', Speed: '2.5 s/strap' }, {}],
    [3, 'pump', 0, 'CRI Pumps', 'CRI 10 HP Centrifugal Monoblock Pump', 'MHBS-10', 46500, 52000, 'new', 2025, 40, null, { Head: '42 m', Discharge: '900 LPM', Motor: '7.5 kW' }, { fuel_type: 'Electric' }],
    [3, 'pump', 1, 'CRI Pumps', 'CRI 5 HP Borewell Submersible Pump', '4S-5HP', 32800, 37000, 'new', 2025, 60, null, { Head: '120 m', Stages: '20' }, {}],
    [3, 'pump', 0, 'Kirloskar', 'Kirloskar 3" Diesel Dewatering Pump Set', 'KDS-3', 54000, 60000, 'new', 2025, 8, { daily: 1200, weekly: 7000, monthly: 22000, deposit: 10000, units: 4 }, { Discharge: '1100 LPM', Engine: '5 HP diesel' }, { fuel_type: 'Diesel' }],
    [0, 'welding', 0, 'ESAB', 'ESAB Warrior 400i MIG Welder', 'W400i', 285000, 310000, 'new', 2025, 7, { daily: 1500, weekly: 8500, monthly: 28000, deposit: 20000, units: 2 }, { Current: '400 A', 'Duty cycle': '60%' }, { power_req: '415V 3-phase' }],
    [0, 'welding', 1, 'ESAB', 'ESAB Arc 250 Inverter Welder', 'ARC250', 28900, 33000, 'new', 2025, 30, null, { Current: '250 A' }, {}],
  ];
  P.forEach(([vi, ck, si, br, name, model, price, mrp, cond, year, stock, rent, specs, extra], i) => {
    const vd = db.one('SELECT * FROM vendors WHERE id=?', vids[vi]);
    const imgs = [svg(`p${i + 1}a`, ck, i), svg(`p${i + 1}b`, ck, i + 1)];
    const pid = ins('products', { vendor_id: vd.id, category_id: cat[ck].id, subcategory_id: cat[ck].subs[si], brand_id: brand[br], name, slug: name.toLowerCase().replace(/[^a-z0-9]+/g, '-') + '-' + (i + 1), model_no: model, mfg_year: year, condition: cond, specs, description: `${name} by ${br}. ${cond === 'new' ? 'Brand new with manufacturer warranty.' : 'Inspected, serviced and test-run before dispatch.'} GST invoice, pan-India delivery.`, price, mrp, gst_rate: 18, hsn: CATS.find(c => c[1] === ck)[2], stock, moq: extra.moq || 1, warranty: cond === 'new' ? '12 months manufacturer warranty' : '3 months seller warranty', maintenance: 'Service every 500 running hours. AMC available.', purchase_available: 1, rental_available: rent ? 1 : 0, rent_hourly: rent?.hourly, rent_daily: rent?.daily, rent_weekly: rent?.weekly, rent_monthly: rent?.monthly, security_deposit: rent?.deposit || 0, rental_units: rent?.units || 0, images: imgs, location_city: vd.city, location_state: vd.state, lat: vd.lat, lng: vd.lng, status: 'approved', featured: [0, 5, 7, 10, 13, 15].includes(i) ? 1 : 0, promoted: i % 7 === 0 ? 1 : 0, views: 40 + (i * 37) % 300, sold: (i * 13) % 25, rating: [4.5, 4.7, 4.1, 4.4, 4.6, 4.8, 4.2, 4.5, 3.9, 4.3][i % 10], rating_count: 5 + (i * 7) % 40, return_policy: '7-day return for manufacturing defects (unused, original packing).', cancellation_policy: 'Free cancellation before dispatch.', ...Object.fromEntries(Object.entries(extra).filter(([k]) => k !== 'moq')) });
    ins('product_approvals', { product_id: pid, action: 'approved', remarks: 'Seed' });
  });
  // one pending product for approval flow
  ins('products', { vendor_id: vids[1], category_id: cat.compressor.id, subcategory_id: cat.compressor.subs[0], brand_id: brand.ELGi, name: 'ELGi EG 22 Screw Compressor (pending approval)', model_no: 'EG22', condition: 'new', price: 620000, stock: 2, images: [svg('pending1', 'compressor', 2)], status: 'pending', location_city: 'Ahmedabad', location_state: 'Gujarat' });

  // commission rules
  ins('commission_rules', { scope: 'global', txn_type: 'purchase', mode: 'percent', value: 5 });
  ins('commission_rules', { scope: 'global', txn_type: 'rental', mode: 'percent', value: 8 });
  ins('commission_rules', { scope: 'category', scope_id: cat.tools.id, txn_type: 'purchase', mode: 'percent', value: 8 });
  ins('commission_rules', { scope: 'category', scope_id: cat.earthmoving.id, txn_type: 'purchase', mode: 'percent', value: 3 });

  // coupons
  ins('coupons', { code: 'WELCOME5', description: '5% off your first order (max ₹5,000)', type: 'percent', value: 5, min_order: 10000, max_discount: 5000, per_user_limit: 1, campaign: 'onboarding' });
  ins('coupons', { code: 'FLAT2000', description: '₹2,000 off on orders above ₹50,000', type: 'flat', value: 2000, min_order: 50000, per_user_limit: 3 });
  ins('coupons', { code: 'TOOLS10', description: '10% off power tools', type: 'percent', value: 10, max_discount: 1500, category_id: cat.tools.id, per_user_limit: 5 });

  // banners, CMS, FAQs, announcements
  ins('banners', { title: 'Machines that build India', subtitle: 'CNC, gensets, compressors & earthmovers from verified sellers', image: svg('banner1', 'cnc', 0), link: '/#/search', sort_order: 0 });
  ins('banners', { title: 'Power backup sale', subtitle: 'Silent DG sets with free installation', image: svg('banner3', 'generator', 2), link: '/#/category/' + cat.generator.id, sort_order: 2 });
  const CMS = { about: ['About Mohan Mishra', 'Mohan Mishra is India\'s B2B marketplace for industrial machinery — buy or request quotes from verified sellers with GST invoices and secure escrow payments.'], terms: ['Terms of Use', 'By using the platform you agree to these terms. Payments are held in escrow and released to sellers after delivery. Disputes are mediated by the platform.'], privacy: ['Privacy Policy', 'We collect only the data needed to process orders, invoices and support. We never sell personal data. You may request deletion from your account settings.'], refund: ['Refund & Cancellation Policy', 'Orders can be cancelled free of charge before dispatch. Returns for manufacturing defects within 7 days of delivery. Refunds are processed to the original payment method within 5–7 working days.'], 'vendor-agreement': ['Seller Agreement', 'Sellers agree to list genuine products, honour quoted prices, dispatch within committed timelines and pay platform commission as per the commission schedule.'], shipping: ['Shipping Policy', 'Heavy machinery ships via seller-arranged transport with e-way bill. Delivery timelines are shown on each product.'] };
  Object.entries(CMS).forEach(([slug, [title, content]]) => ins('cms_pages', { slug, title, content, meta_title: title + ' | Mohan Mishra' }));
  [['How does payment protection work?', 'Your payment is held in escrow and released to the seller only after delivery is confirmed.', 'payments'], ['Can I pay an advance and the rest on delivery?', 'Yes — choose the Advance plan at checkout (25% advance), pay the balance before dispatch or on delivery.', 'payments'], ['Do I get a GST invoice?', 'Every order gets a GST-compliant tax invoice from the seller; input tax credit is available when you add your GSTIN.', 'gst'], ['How do I become a seller?', 'Click "Sell on Mohan Mishra", complete GST/PAN/bank KYC and start listing after approval.', 'vendor']].forEach(([q, a, c], i) => ins('faqs', { question: q, answer: a, category: c, sort_order: i }));
  ins('announcements', { title: 'Monsoon service camp', body: 'Free pump & genset health check for orders above ₹50,000 this month.', audience: 'all' });
  ins('announcements', { title: 'Settlement cycle', body: 'Vendor payouts are processed every Tuesday and Friday.', audience: 'vendors' });
  ins('crm_leads', { owner_type: 'admin', name: 'Anil Gupta', company: 'Gupta Infra Projects', mobile: '9811111111', city: 'Lucknow', source: 'website', status: 'new', value: 3500000, kind: 'customer', segment: 'construction' });
  ins('crm_leads', { owner_type: 'admin', name: 'Meera Steel Works', company: 'Meera Steel Works', mobile: '9822222222', city: 'Nagpur', source: 'referral', status: 'contacted', value: 1200000, kind: 'vendor' });
})();
console.log('Seeded', db.PATH, { products: db.one('SELECT COUNT(*) c FROM products').c, vendors: db.one('SELECT COUNT(*) c FROM vendors').c });
module.exports = {};
