// End-to-end API test. Spawns the server on a temp DB (or uses BASE_URL) and walks every core flow.
const { spawn } = require('child_process'); const path = require('path'); const fs = require('fs'); const os = require('os'); const crypto = require('crypto');
const PORT = 4300 + Math.floor(Math.random() * 500);
let BASE = process.env.BASE_URL || `http://127.0.0.1:${PORT}`; let srv;
let pass = 0, fail = 0; const failures = [];
const ok = (c, name, extra) => { if (c) { pass++; console.log('  ✓', name); } else { fail++; failures.push(name); console.log('  ✗', name, extra !== undefined ? JSON.stringify(extra).slice(0, 400) : ''); } };
async function call(method, url, body, token, headers = {}) {
  const r = await fetch(BASE + '/api/v1' + url, { method, headers: { 'content-type': 'application/json', ...(token ? { authorization: 'Bearer ' + token } : {}), ...headers }, body: body === undefined ? undefined : (typeof body === 'string' ? body : JSON.stringify(body)) });
  const ct = r.headers.get('content-type') || ''; const data = ct.includes('json') ? await r.json() : await r.arrayBuffer();
  return { status: r.status, data, ct };
}
const step = t => console.log('\n▶', t);
const must = (r, name, code = [200, 201]) => { const good = [].concat(code).includes(r.status); ok(good, name, good ? undefined : r.data); if (!good) throw new Error('Abort: ' + name); return r.data; };

async function main() {
  if (!process.env.BASE_URL) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mm-e2e-'));
    srv = spawn(process.execPath, [path.join(__dirname, '..', 'src', 'server.js')], { env: { ...process.env, PORT, DB_PATH: path.join(dir, 'test.db'), UPLOAD_DIR: path.join(dir, 'up'), NODE_ENV: 'test', JWT_SECRET: 'test-secret' }, stdio: ['ignore', 'pipe', 'pipe'] });
    srv.stderr.on('data', d => process.stderr.write('[srv] ' + d));
    for (let i = 0; i < 50; i++) { try { if ((await fetch(BASE + '/api/v1/health')).ok) break; } catch { } await new Promise(r => setTimeout(r, 150)); }
  }
  step('Health & catalog');
  must(await call('GET', '/health'), 'health');
  const home = must(await call('GET', '/home'), 'home feed'); ok(home.featured?.length > 0 && home.categories?.length > 0, 'home has featured & categories');
  const search = must(await call('GET', '/products?q=generator&sort=price_asc'), 'search generator'); ok(search.items.length > 0, 'search returns items');
  must(await call('GET', '/search/suggest?q=jc'), 'suggest');
  const rentList = must(await call('GET', '/products?mode=rental'), 'rental filter'); ok(rentList.items.every(p => p.rental_available), 'rental filter only rentals');

  step('Customer OTP registration');
  const mobile = '98' + String(Date.now()).slice(-8);
  const otp = must(await call('POST', '/auth/otp/send', { target: mobile, purpose: 'login' }), 'send otp'); ok(!!otp.dev_code, 'dev otp code exposed in non-prod');
  const bad = await call('POST', '/auth/otp/verify', { target: mobile, code: '000000' }); ok(bad.status === 400, 'wrong otp rejected');
  const login = must(await call('POST', '/auth/otp/verify', { target: mobile, code: otp.dev_code, name: 'E2E Buyer', account_type: 'business', business_name: 'E2E Industries' }), 'verify otp'); ok(login.is_new && login.token, 'new customer + token');
  const C = login.token;
  const g = must(await call('POST', '/auth/google', { id_token: 'mock:e2e.google@example.com:Google User' }), 'google mock login'); ok(!!g.token, 'google token');
  const addr = must(await call('POST', '/auth/me/addresses', { label: 'Plant', name: 'E2E Buyer', mobile, line1: 'Plot 9, GIDC', city: 'Vapi', state: 'Gujarat', pincode: '396195' }, C), 'add address');
  const A = addr.id || addr.address?.id || addr.items?.[0]?.id;

  step('Browse, wishlist, cart, checkout');
  const prod = search.items.find(p => p.purchase_available && p.stock > 0) || search.items[0];
  const pd = must(await call('GET', '/products/' + prod.id, undefined, C), 'product detail'); ok(!!pd.price_breakup || !!pd.product, 'price breakup present');
  must(await call('POST', '/wishlist', { product_id: prod.id }, C), 'wishlist add');
  must(await call('POST', '/cart/items', { product_id: prod.id, qty: 1 }, C), 'cart add');
  const tools = must(await call('GET', '/products?q=Bosch'), 'find small item');
  must(await call('POST', '/cart/items', { product_id: tools.items[0].id, qty: 2 }, C), 'cart add 2nd vendor item');
  const cart = must(await call('GET', '/cart', undefined, C), 'get cart'); ok(cart.groups?.length >= 1 && cart.grand_total > 0, 'cart totals', cart);
  const order = must(await call('POST', '/checkout', { billing_address_id: A, shipping_address_id: A, payment_plan: 'full' }, C), 'checkout');
  ok(order.sub_orders.length >= 1 && order.grand_total > 0, 'order with sub-orders');
  ok(order.igst > 0 || order.sub_orders.some(s => s.igst > 0), 'inter-state IGST applied (Gujarat buyer)');

  step('Mock payment: fail then succeed, webhook');
  const p1 = must(await call('POST', '/payments/init', { order_id: order.id, purpose: 'full', provider: 'mock' }, C, { 'Idempotency-Key': 'k-' + order.id }), 'init payment');
  const p1b = must(await call('POST', '/payments/init', { order_id: order.id, purpose: 'full', provider: 'mock' }, C, { 'Idempotency-Key': 'k-' + order.id }), 'init idempotent'); ok(p1b.payment.id === p1.payment.id, 'idempotency key returns same payment');
  const f = await call('POST', '/payments/mock/complete', { gateway_order_id: p1.payment.gateway_order_id, outcome: 'failure' }, C); ok(f.status === 402, 'mock failure → 402');
  const p2 = must(await call('POST', `/payments/${p1.payment.id}/retry`, {}, C), 'retry payment');
  const okPay = must(await call('POST', '/payments/mock/complete', { gateway_order_id: p2.payment.gateway_order_id, outcome: 'success' }, C), 'mock success'); ok(okPay.payment.status === 'success', 'payment success');
  const body = JSON.stringify({ id: 'evt_' + Date.now(), event: 'payment.captured', gateway_order_id: p2.payment.gateway_order_id, gateway_payment_id: okPay.payment.gateway_payment_id });
  const badHook = await call('POST', '/webhooks/mock', body, null, { 'x-mock-signature': 'nope' }); ok(badHook.status === 401, 'webhook bad signature → 401');
  const sig = crypto.createHmac('sha256', 'mock_webhook').update(body).digest('hex');
  must(await call('POST', '/webhooks/mock', body, null, { 'x-mock-signature': sig }), 'webhook verified');
  const dup = must(await call('POST', '/webhooks/mock', body, null, { 'x-mock-signature': sig }), 'webhook replay'); ok(dup.duplicate === true, 'webhook idempotent');
  let od = must(await call('GET', '/orders/' + order.id, undefined, C), 'order detail'); ok(od.payment_status === 'paid', 'order paid'); ok(od.invoices.some(i => i.type === 'tax'), 'tax invoice issued');

  step('Vendor accept → dispatch → deliver → wallet');
  const sub = od.sub_orders.find(s => s.items.some(i => i.product_id === prod.id));
  const vendorEmail = 'vendor' + sub.vendor_id + '@mohanmishra.in';
  const V = must(await call('POST', '/auth/login', { identifier: vendorEmail, password: 'Vendor@123' }), 'vendor login').token;
  const vdash = must(await call('GET', '/vendor/dashboard', undefined, V), 'vendor dashboard'); ok(vdash.orders.pending >= 1, 'vendor sees pending order');
  must(await call('POST', `/vendor/orders/${sub.id}/status`, { status: 'accepted' }, V), 'vendor accept');
  must(await call('POST', `/vendor/orders/${sub.id}/status`, { status: 'packed' }, V), 'vendor packed');
  must(await call('POST', `/vendor/orders/${sub.id}/status`, { status: 'shipped', courier: 'VRL Logistics', tracking_no: 'VRL123456', eta: '2026-11-08' }, V), 'vendor dispatch');
  must(await call('POST', `/vendor/orders/${sub.id}/status`, { status: 'delivered' }, V), 'vendor delivered');
  const w = must(await call('GET', '/vendor/wallet', undefined, V), 'vendor wallet'); ok(w.available > 0, 'wallet credited on delivery', w);
  const st = must(await call('GET', `/vendor/orders/${sub.id}`, undefined, V), 'vendor sub detail'); ok(st.status === 'delivered' && st.tracking_no === 'VRL123456', 'tracking saved');

  step('Withdrawal → admin payout → settlement invoice');
  const ADM = must(await call('POST', '/auth/login', { identifier: 'admin@mohanmishra.in', password: 'Admin@123' }), 'admin login').token;
  const wd = must(await call('POST', '/vendor/withdrawals', { amount: Math.min(1000, Math.floor(w.available)) >= 1000 ? 1000 : Math.floor(w.available) }, V), 'withdrawal request', [201]);
  const w2 = must(await call('GET', '/vendor/wallet', undefined, V), 'wallet after request'); ok(Math.abs(w2.onhold - wd.amount) < 0.01, 'amount moved to on-hold');
  const paid = must(await call('POST', `/admin/withdrawals/${wd.id}/action`, { action: 'pay', provider: 'mock' }, ADM), 'admin payout (mock)'); ok(paid.status === 'paid' && !!paid.utr, 'withdrawal paid with UTR');
  const inv = must(await call('GET', '/admin/invoices?type=settlement', undefined, ADM), 'settlement invoices'); ok(inv.items.length >= 1, 'settlement statement issued');
  const led = must(await call('GET', '/admin/ledger', undefined, ADM), 'ledger'); ok(led.trial_balance_ok, 'double-entry ledger balances', led.balances);

  step('Invoices (PDF)');
  const tax = od.invoices.find(i => i.type === 'tax');
  const pdf = await call('GET', `/invoices/${tax.id}/pdf`, undefined, C); ok(pdf.status === 200 && pdf.ct.includes('pdf') && Buffer.from(pdf.data).slice(0, 4).toString() === '%PDF', 'invoice PDF downloads');
  const invd = must(await call('GET', `/invoices/${tax.id}`, undefined, C), 'invoice detail'); ok(/\/\d{2}-\d{2}\/\d{5}$/.test(invd.invoice_no), 'FY-wise invoice number ' + invd.invoice_no);

  step('Review after delivery');
  must(await call('POST', '/reviews', { order_id: order.id, product_id: prod.id, rating: 5, title: 'Great machine', comment: 'Smooth delivery' }, C), 'review posted');

  step('Return → refund (credit note)');
  must(await call('POST', `/orders/${order.id}/requests`, { type: 'return', sub_order_id: sub.id, reason: 'Motor noise' }, C), 'return request', [200, 201]);
  const reqs = must(await call('GET', '/vendor/requests?status=open', undefined, V), 'vendor requests');
  const rr = reqs.items.find(r => r.sub_order_id === sub.id);
  const resp = must(await call('POST', `/vendor/requests/${rr.id}/respond`, { action: 'approve', note: 'Pickup arranged' }, V), 'vendor approves return'); ok(resp.status === 'approved', 'request approved');
  od = must(await call('GET', '/orders/' + order.id, undefined, C), 'order after refund'); ok(od.refunded_amount > 0, 'refund recorded', { refunded: od.refunded_amount }); ok(od.invoices.some(i => i.type === 'credit_note'), 'credit note issued');
  ok(must(await call('GET', '/admin/ledger', undefined, ADM), 'ledger after refund').trial_balance_ok, 'ledger still balances after refund');

  step('Enquiry → quotation → negotiation → order');
  const gp = must(await call('GET', '/products?q=Kirloskar%20Green'), 'find genset').items[0];
  const enq = must(await call('POST', '/enquiries', { product_id: gp.id, title: 'Need 2 x 62.5 kVA gensets', requirements: 'With AMF panel', qty: 2, location: 'Vapi' }, C), 'create enquiry', [201]);
  const genVendor = must(await call('POST', '/auth/login', { identifier: 'vendor' + gp.vendor_id + '@mohanmishra.in', password: 'Vendor@123' }), 'genset vendor login').token;
  const ven = must(await call('GET', '/vendor/enquiries', undefined, genVendor), 'vendor enquiries'); ok(ven.items.some(e => e.id === enq.id), 'vendor received enquiry');
  const q1 = must(await call('POST', '/vendor/quotations', { enquiry_id: enq.id, items: [{ product_id: gp.id, name: gp.name, qty: 2, unit_price: 830000, gst_rate: 18, hsn: '8502' }], transport: 20000, installation: 15000, payment_terms: '25% advance, balance before dispatch', delivery_timeline: '10 days' }, genVendor), 'vendor sends quotation', [201]);
  must(await call('POST', `/quotations/${q1.id}/revision`, { note: 'Please match 8.1L each', counter_price: 810000 }, C), 'customer negotiates');
  const q2 = must(await call('POST', `/vendor/quotations/${q1.id}/revise`, { items: [{ product_id: gp.id, name: gp.name, qty: 2, unit_price: 815000, gst_rate: 18, hsn: '8502' }] }, genVendor), 'vendor revises', [201]); ok(q2.version === 2, 'quotation v2');
  must(await call('POST', `/vendor/quotations/${q2.id}/proforma`, {}, genVendor), 'quotation proforma invoice', [201]);
  must(await call('POST', `/quotations/${q2.id}/accept`, {}, C), 'customer accepts');
  const qo = must(await call('POST', `/quotations/${q2.id}/convert`, { billing_address_id: A, shipping_address_id: A, payment_plan: 'advance' }, C), 'convert to order', [201]); ok(qo.source === 'quotation', 'order source = quotation');
  const adv = must(await call('POST', '/payments/init', { order_id: qo.id, purpose: 'advance', provider: 'mock' }, C), 'init advance');
  must(await call('POST', '/payments/mock/complete', { gateway_order_id: adv.payment.gateway_order_id }, C), 'pay advance');
  const qod = must(await call('GET', '/orders/' + qo.id, undefined, C), 'quote order'); ok(qod.payment_status === 'partial', 'advance → partial payment');
  const bal = must(await call('POST', '/payments/init', { order_id: qo.id, purpose: 'balance', provider: 'mock' }, C), 'init balance');
  must(await call('POST', '/payments/mock/complete', { gateway_order_id: bal.payment.gateway_order_id }, C), 'pay balance');
  ok(must(await call('GET', '/orders/' + qo.id, undefined, C), 'quote order paid').payment_status === 'paid', 'balance → fully paid');

  step('Rental: request → approve → advance → start → return → close (deposit refund)');
  const rp = must(await call('GET', '/products?q=Kirloskar%205%20kVA'), 'find rental').items[0];
  const start = new Date(Date.now() + 2 * 864e5).toISOString();
  const rq = must(await call('POST', '/rentals/quote', { product_id: rp.id, unit: 'day', duration: 3, start_at: start, address_id: A }, C), 'rental quote'); ok(rq.total > 0, 'rental priced');
  const rent = must(await call('POST', '/rentals', { product_id: rp.id, unit: 'day', duration: 3, start_at: start, address_id: A }, C), 'rental request', [201]);
  const RV = must(await call('POST', '/auth/login', { identifier: 'vendor' + rp.vendor_id + '@mohanmishra.in', password: 'Vendor@123' }), 'rental vendor login').token;
  must(await call('POST', `/vendor/rentals/${rent.id}/action`, { action: 'approve' }, RV), 'vendor approves rental');
  const ra = must(await call('POST', '/payments/init', { rental_id: rent.id, purpose: 'advance', provider: 'mock' }, C), 'rental advance init');
  must(await call('POST', '/payments/mock/complete', { gateway_order_id: ra.payment.gateway_order_id }, C), 'rental advance paid');
  const rb0 = must(await call('POST', '/payments/init', { rental_id: rent.id, purpose: 'balance', provider: 'mock' }, C), 'rental balance+deposit init');
  must(await call('POST', '/payments/mock/complete', { gateway_order_id: rb0.payment.gateway_order_id }, C), 'rental balance+deposit paid');
  must(await call('POST', `/vendor/rentals/${rent.id}/action`, { action: 'start' }, RV), 'rental started');
  must(await call('POST', `/rentals/${rent.id}/extend`, { duration: 1 }, C), 'extension requested');
  must(await call('POST', `/vendor/rentals/${rent.id}/action`, { action: 'extension_approve' }, RV), 'extension approved');
  must(await call('POST', `/vendor/rentals/${rent.id}/action`, { action: 'return', late_charge: 0, damage_charge: 0 }, RV), 'machine returned');
  let rd = must(await call('GET', `/rentals/${rent.id}`, undefined, C), 'rental detail');
  if (rd.amount_due > 0) { const rb = must(await call('POST', '/payments/init', { rental_id: rent.id, purpose: 'balance', provider: 'mock' }, C), 'rental extension charges init'); must(await call('POST', '/payments/mock/complete', { gateway_order_id: rb.payment.gateway_order_id }, C), 'rental extension charges paid'); }
  must(await call('POST', `/vendor/rentals/${rent.id}/action`, { action: 'close' }, RV), 'rental closed');
  rd = must(await call('GET', `/rentals/${rent.id}`, undefined, C), 'rental final'); ok(rd.status === 'closed' && rd.deposit_refund > 0, 'deposit refunded', { st: rd.status, dr: rd.deposit_refund }); ok(rd.invoices?.some(i => i.type === 'rental'), 'rental invoice');
  ok(must(await call('GET', '/admin/ledger', undefined, ADM), 'ledger final').trial_balance_ok, 'ledger balances at end');

  step('Cancellation before dispatch (auto refund)');
  must(await call('POST', '/cart/items', { product_id: tools.items[0].id, qty: 1 }, C), 'cart add');
  const o3 = must(await call('POST', '/checkout', { billing_address_id: A, shipping_address_id: A }, C), 'checkout 3');
  const p3 = must(await call('POST', '/payments/init', { order_id: o3.id, provider: 'mock' }, C), 'init 3');
  must(await call('POST', '/payments/mock/complete', { gateway_order_id: p3.payment.gateway_order_id }, C), 'pay 3');
  must(await call('POST', `/orders/${o3.id}/cancel`, { reason: 'Ordered by mistake' }, C), 'cancel order');
  const o3d = must(await call('GET', '/orders/' + o3.id, undefined, C), 'cancelled order'); ok(o3d.status === 'cancelled' && o3d.refunded_amount > 0, 'auto refund on cancel', { s: o3d.status, r: o3d.refunded_amount });

  step('Vendor onboarding + KYC + product approval');
  const vm = '97' + String(Date.now()).slice(-8);
  const vo = must(await call('POST', '/auth/otp/send', { target: vm, purpose: 'register' }), 'vendor otp');
  const nv = must(await call('POST', '/vendor/register', { name: 'New Seller', mobile: vm, password: 'Seller@1234', otp: vo.dev_code, business_name: 'E2E Machine Mart', gstin: '27AAFCE9999F1Z9', city: 'Mumbai', state: 'Maharashtra', address: 'Andheri' }), 'vendor register', [201]);
  const NV = nv.token;
  must(await call('PATCH', '/vendor/bank', { bank_account_name: 'E2E Machine Mart', bank_account_no: '123456789012', bank_ifsc: 'HDFC0000001' }, NV), 'bank details');
  must(await call('POST', '/vendor/docs', { doc_type: 'gst_certificate', file_url: '/uploads/x.pdf' }, NV), 'doc 1', [201]);
  must(await call('POST', '/vendor/docs', { doc_type: 'pan_card', file_url: '/uploads/y.pdf' }, NV), 'doc 2', [201]);
  must(await call('POST', '/vendor/agreements', { agreement: true, commission_agreement: true }, NV), 'agreements');
  must(await call('PATCH', '/vendor/profile', { pan: 'AAFCE9999F', pincode: '400069' }, NV), 'profile');
  must(await call('POST', '/vendor/submit-kyc', {}, NV), 'submit kyc');
  const blocked = await call('POST', '/vendor/products', { name: 'X', category_id: 1, price: 10 }, NV); ok(blocked.status === 403, 'inactive vendor cannot list');
  must(await call('POST', `/admin/vendors/${nv.vendor.id}/kyc`, { action: 'approve' }, ADM), 'admin approves KYC');
  const np = must(await call('POST', '/vendor/products', { name: 'E2E Hydraulic Press 50T', category_id: 1, price: 250000, stock: 3, gst_rate: 18, specs: { Capacity: '50 T' } }, NV), 'vendor creates product', [201]); ok(np.status === 'pending', 'product pending approval');
  must(await call('POST', `/admin/products/${np.id}/review`, { action: 'approve' }, ADM), 'admin approves product');
  ok((await call('GET', '/products/' + np.id)).status === 200, 'approved product visible publicly');

  step('Staff permissions, CRM, reports');
  const FIN = must(await call('POST', '/auth/login', { identifier: 'finance@mohanmishra.in', password: 'Staff@123' }), 'finance staff login').token;
  ok((await call('GET', '/admin/withdrawals', undefined, FIN)).status === 200, 'finance can view withdrawals');
  ok((await call('GET', '/admin/settings', undefined, FIN)).status === 403, 'finance blocked from settings');
  const lead = must(await call('POST', '/admin/crm/leads', { name: 'CRM Lead', mobile: '9811122233', company: 'Lead Co', value: 500000 }, ADM), 'crm lead', [201]);
  must(await call('POST', `/admin/crm/leads/${lead.id}/call`, {}, ADM), 'click-to-call (mock)', [200, 201]);
  const csv = await call('GET', '/admin/reports/gst?format=csv', undefined, ADM); ok(csv.status === 200 && csv.ct.includes('csv'), 'GST report CSV');
  must(await call('GET', '/admin/dashboard', undefined, ADM), 'admin dashboard');
  ok((await call('GET', '/admin/dashboard', undefined, C)).status === 403, 'customer blocked from admin');
  ok((await call('GET', '/vendor/dashboard', undefined, C)).status === 403, 'customer blocked from vendor');

  step('Admin product management & invoice generation');
  const pv = must(await call('GET', '/admin/product-vendors', undefined, ADM), 'product vendor list'); ok(pv.items.some(x => x.business_name === 'Mohan Mishra Direct'), 'house vendor available');
  const cats = must(await call('GET', '/admin/categories?limit=50', undefined, ADM), 'categories'); const cat = cats.items[0];
  const badP = await call('POST', '/admin/products', { name: '', category_id: cat.id, gst_rate: 7 }, ADM); ok(badP.status === 400, 'invalid product rejected');
  const ap = must(await call('POST', '/admin/products', { name: 'E2E Admin Excavator 20T', category_id: cat.id, condition: 'used', operating_hours: 3200, mfg_year: 2019, price: 2500000, gst_rate: 18, hsn: '84295200', stock: 2, specs: { 'Bucket capacity': '1 m3' }, featured: true }, ADM), 'admin creates house product', [201]);
  ok(ap.status === 'approved' && ap.operating_hours === 3200, 'house product approved with operating hours');
  const ed = must(await call('PUT', `/admin/products/${ap.id}`, { price: 2400000, rental_terms: 'Min 7 days' }, ADM), 'admin edits product'); ok(ed.price === 2400000, 'price updated');
  const imp = must(await call('POST', '/admin/products/import', { csv: `name,category_id,price,gst_rate,hsn,stock\nCSV Concrete Mixer,${cat.id},450000,18,84743110,3\nBad Row,${cat.id},10,9,,1` }, ADM), 'admin CSV import'); ok(imp.imported === 1 && imp.failed === 1, 'CSV import reports per-row errors');
  must(await call('DELETE', `/admin/products/${ap.id}`, undefined, ADM), 'admin deletes product');
  const src = must(await call('GET', '/admin/invoice-sources', undefined, ADM), 'invoice sources'); ok(src.sub_orders.length > 0, 'sub-orders available for invoicing');
  const gi = must(await call('POST', '/admin/invoices/generate', { type: 'commission', sub_order_id: src.sub_orders[0].id }, ADM), 'generate commission invoice', [201]); ok(/\/\d\d-\d\d\//.test(gi.invoice.invoice_no), 'FY-wise invoice number');
  const ss = must(await call('POST', '/admin/invoices/generate', { type: 'settlement', vendor_id: src.vendors[0].id }, ADM), 'generate settlement statement', [201]); ok(!!ss.invoice.invoice_no, 'settlement statement numbered');
  const srch = must(await call('GET', '/admin/invoices/search?type=commission', undefined, ADM), 'invoice search'); ok(srch.items.length >= 1, 'invoice search filters by type');
  const ipdf = await call('GET', `/invoices/${gi.invoice.id}/pdf`, undefined, ADM); ok(ipdf.status === 200 && ipdf.ct.includes('pdf'), 'invoice PDF renders');
  const is = must(await call('GET', '/admin/invoice-settings', undefined, ADM), 'invoice settings'); ok(!!is.prefixes.tax, 'prefixes present');
  ok((await call('PUT', '/admin/invoice-settings', { prefixes: { tax: 'bad prefix!' } }, ADM)).status === 400, 'invalid prefix rejected');
  must(await call('PUT', '/admin/invoice-settings', { template: { terms: 'E2E terms', signatory: 'Director' } }, ADM), 'save invoice template');
  const vi = must(await call('GET', '/vendor/invoices', undefined, V), 'vendor invoices'); ok(Array.isArray(vi.items), 'vendor invoice list');
  const vs = must(await call('GET', '/vendor/invoice-sources', undefined, V), 'vendor invoice sources');
  must(await call('POST', '/vendor/invoices/generate', { type: 'settlement' }, V), 'vendor settlement statement', [201]);
  ok((await call('POST', '/vendor/invoices/generate', { type: 'tax', sub_order_id: 999999 }, V)).status === 404, 'vendor cannot invoice foreign sub-order');

  step('Admin create order');
  const op = must(await call('GET', '/admin/order-products?q=', undefined, ADM), 'admin order-products'); ok(op.items.length > 0, 'purchasable machines listed');
  const cl = must(await call('GET', '/admin/customers?q=rahul', undefined, ADM), 'find customer'); const cid = (cl.items || cl)[0].id;
  ok((await call('POST', '/admin/orders', { customer_id: cid, items: '[]' }, ADM)).status === 400, 'empty admin order rejected');
  const ao = must(await call('POST', '/admin/orders', { customer_id: cid, items: JSON.stringify([{ product_id: op.items.find(p => p.stock > 0).id, qty: 1 }]), new_address: JSON.stringify({ name: 'Site', mobile: '9876500000', line1: 'Plot 1', city: 'Chennai', state: 'Tamil Nadu', pincode: '600001' }) }, ADM), 'admin creates order for customer', [201]);
  ok(!!(ao.order_no || ao.order?.order_no), 'admin order numbered');

  step('CRM convert + inventory + TDS');
  const ld = must(await call('POST', '/admin/crm/leads', { name: 'Ravi Builders', company: 'Ravi Infra Pvt Ltd', mobile: '7' + String(Date.now()).slice(-9), city: 'Nagpur', value: 850000 }, ADM), 'lead created', [201]);
  ok((await call('POST', `/admin/crm/leads/${ld.id}/convert`, { to: 'quotation' }, ADM)).status === 400, 'quotation convert needs a machine');
  const cv = must(await call('POST', `/admin/crm/leads/${ld.id}/convert`, { to: 'customer' }, ADM), 'lead → customer', [201]); ok(cv.customer_created && cv.customer_id > 0, 'customer account created from lead ' + JSON.stringify(cv));
  const cq = must(await call('POST', `/admin/crm/leads/${ld.id}/convert`, { to: 'quotation', product_id: op.items[0].id, qty: 2 }, ADM), 'lead → quotation request', [201]); ok(!!cq.enquiry_no && cq.vendors >= 1 && cq.customer_id === cv.customer_id, 'RFQ raised to sellers for same customer');
  const co = must(await call('POST', `/admin/crm/leads/${ld.id}/convert`, { to: 'order' }, ADM), 'lead → order handoff', [201]); ok(co.next.includes('customer=' + cv.customer_id), 'order handoff prefilled');
  const ldd = must(await call('GET', `/admin/crm/leads/${ld.id}`, undefined, ADM), 'lead detail'); ok(ldd.status === 'proposal' && ldd.activities.some(a => /Converted/.test(a.content)), 'lead stage + activity updated');
  const stk = must(await call('GET', '/admin/inventory?stock=', undefined, ADM), 'admin inventory'); ok(stk.summary.skus > 0 && stk.items.length > 0, 'inventory summary across sellers');
  ok((await call('PATCH', `/admin/inventory/${stk.items[0].id}`, { stock: -1 }, ADM)).status === 400, 'negative stock rejected');
  const adj = must(await call('PATCH', `/admin/inventory/${stk.items[0].id}`, { stock: 42, note: 'cycle count' }, ADM), 'stock adjusted'); ok(adj.stock === 42, 'stock persisted');
  const aod = must(await call('GET', `/admin/orders/${ao.id || ao.order?.id}`, undefined, ADM), 'admin order detail'); const so = (aod.sub_orders || aod.order?.sub_orders || [])[0]; ok(so && so.tds > 0 && so.tcs > 0, 'TCS (s.52) and TDS (s.194-O) withheld on sub-order');

  step('Support');
  must(await call('POST', '/tickets', { subject: 'Need installation help', message: 'Please call', category: 'order' }, C), 'ticket created', [201]);
  const notes = must(await call('GET', '/notifications', undefined, C), 'notifications'); ok(notes.items.length > 3, 'customer has notifications');

  step('Play Store: legal pages, deletion requests, app links');
  for (const u of ['/privacy', '/terms', '/delete-account']) { const r = await fetch(BASE + u); const t = await r.text(); ok(r.status === 200 && /Mohan Mishra Multitrade Private Limited/.test(t), `${u} page served`); }
  ok(/enterprisesconsolemohanmishra@gmail\.com/.test(await (await fetch(BASE + '/privacy')).text()), 'privacy policy has deletion contact email');
  const dr = must(await call('POST', '/public/deletion-request', { name: 'Rahul', contact: 'rahul@example.com', reason: 'test' }), 'public deletion request', [201]); ok(dr.id > 0, 'deletion request recorded');
  ok((await call('POST', '/public/deletion-request', {})).status === 400, 'deletion request needs contact');
  const al = await (await fetch(BASE + '/.well-known/assetlinks.json')).json(); const fps = al[0]?.target?.sha256_cert_fingerprints || [];
  ok(al[0]?.target?.package_name === 'com.app.mmpl', 'assetlinks package com.app.mmpl');
  ok(fps.includes('68:D0:66:C1:D3:E9:30:1D:32:4D:F5:74:2B:5E:0C:DC:24:D3:3B:50:85:6B:32:35:10:BD:58:33:62:43:59:47') && fps.some(f => f.startsWith('F0:EF:2B')), 'assetlinks has Play signing + upload certs');
}
main().catch(e => { if (!String(e.message).startsWith('Abort')) { fail++; failures.push(e.message); console.error(e); } })
  .finally(() => { console.log(`\n${pass} passed, ${fail} failed`); if (failures.length) console.log('Failures:', failures); srv?.kill(); process.exit(fail ? 1 : 0); });
