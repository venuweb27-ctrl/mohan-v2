// Business logic: pricing, orders, payments, settlement, refunds, commission, invoices, rentals.
const crypto = require('crypto');
const { db, E, round2, J, rid, seqNo, gstSplit, nextNumber, post, balance, ACC, notify, notifyAdmins, vendorUserId, stateCodeOf, COMPANY } = require('./core');
const providers = require('./providers');

const S = (k, d) => db.setting(k, d);

// ---------- commission engine ----------
function commissionRule(vendorId, product, txnType = 'purchase') {
  const q = (scope, id) => db.one('SELECT * FROM commission_rules WHERE scope=? AND (scope_id=? OR (? IS NULL AND scope_id IS NULL)) AND txn_type=? AND active=1 ORDER BY id DESC', scope, id, id, txnType);
  return (product && q('product', product.id)) || (product?.subcategory_id && q('category', product.subcategory_id)) || (product?.category_id && q('category', product.category_id)) || q('vendor', vendorId) || q('global', null) || { id: null, mode: 'percent', value: txnType === 'rental' ? 8 : 5, scope: 'default' };
}
function computeCommission(vendorId, lines, txnType = 'purchase') {
  let total = 0; const parts = [];
  for (const l of lines) {
    const p = l.product_id ? db.one('SELECT * FROM products WHERE id=?', l.product_id) : null;
    const r = commissionRule(vendorId, p, txnType);
    const basis = l.taxable;
    const amt = r.mode === 'fixed' ? r.value * (l.qty || 1) : basis * r.value / 100;
    total += amt; parts.push({ rule_id: r.id, basis, mode: r.mode, rate: r.value, amount: round2(amt) });
  }
  return { amount: round2(total), parts };
}

// ---------- pricing ----------
// groups: [{vendor_id, lines:[{product_id,name,hsn,qty,unit_price,gst_rate,discount,transport,installation,category_id}]}]
function priceGroups(groups, posState, coupon) {
  // coupon discount distribution
  let discountTotal = 0;
  if (coupon) {
    const eligible = groups.flatMap(g => g.lines.filter(l => (!coupon.vendor_id || coupon.vendor_id === g.vendor_id) && (!coupon.category_id || coupon.category_id === l.category_id)));
    const base = eligible.reduce((a, l) => a + l.unit_price * l.qty, 0);
    if (base < (coupon.min_order || 0)) throw E.bad(`Coupon requires minimum order of ₹${coupon.min_order}`);
    if (!eligible.length) throw E.bad('Coupon not applicable to these items');
    let disc = coupon.type === 'percent' ? base * coupon.value / 100 : coupon.value;
    if (coupon.max_discount) disc = Math.min(disc, coupon.max_discount);
    disc = Math.min(disc, base); discountTotal = round2(disc);
    let left = discountTotal;
    eligible.forEach((l, i) => { const d = i === eligible.length - 1 ? left : round2(discountTotal * (l.unit_price * l.qty) / base); l.discount = round2((l.discount || 0) + d); left = round2(left - d); });
  }
  const out = { groups: [], subtotal: 0, discount: 0, taxable: 0, cgst: 0, sgst: 0, igst: 0, tax_total: 0, transport: 0, installation: 0 };
  for (const g of groups) {
    const vendor = db.one('SELECT id,business_name,state_code,city,gstin FROM vendors WHERE id=?', g.vendor_id);
    const G = { vendor_id: g.vendor_id, vendor_name: vendor?.business_name, vendor_city: vendor?.city, lines: [], subtotal: 0, discount: 0, taxable: 0, cgst: 0, sgst: 0, igst: 0, transport: 0, installation: 0, total: 0 };
    for (const l of g.lines) {
      const gross = round2(l.unit_price * l.qty);
      const taxable = round2(gross - (l.discount || 0) + (l.transport || 0) + (l.installation || 0));
      const t = gstSplit(taxable, l.gst_rate, vendor?.state_code, posState);
      const L = { ...l, gross, discount: round2(l.discount || 0), taxable, cgst: t.cgst, sgst: t.sgst, igst: t.igst, total: round2(taxable + t.tax) };
      G.lines.push(L);
      for (const k of ['discount', 'taxable', 'cgst', 'sgst', 'igst', 'transport', 'installation', 'total']) G[k] = round2(G[k] + (L[k] || 0));
      G.subtotal = round2(G.subtotal + gross);
    }
    out.groups.push(G);
    for (const k of ['subtotal', 'discount', 'taxable', 'cgst', 'sgst', 'igst', 'transport', 'installation']) out[k] = round2(out[k] + G[k]);
  }
  out.tax_total = round2(out.cgst + out.sgst + out.igst);
  const pf = S('platform_fee', { type: 'fixed', value: 0 });
  out.platform_fee = round2(pf.type === 'percent' ? out.taxable * pf.value / 100 : (out.groups.length ? pf.value : 0));
  out.platform_fee_gst = round2(out.platform_fee * 0.18);
  out.grand_total = round2(out.groups.reduce((a, g) => a + g.total, 0) + out.platform_fee + out.platform_fee_gst);
  out.coupon_discount = discountTotal;
  return out;
}
function loadCoupon(code, userId) {
  if (!code) return null;
  const c = db.one('SELECT * FROM coupons WHERE code=? AND active=1', String(code).toUpperCase());
  if (!c) throw E.bad('Invalid coupon code');
  const t = new Date().toISOString();
  if (c.expires_at && c.expires_at < t) throw E.bad('Coupon expired');
  if (c.starts_at && c.starts_at > t) throw E.bad('Coupon not yet active');
  if (c.usage_limit && c.used_count >= c.usage_limit) throw E.bad('Coupon usage limit reached');
  if (c.customer_id && c.customer_id !== userId) throw E.bad('Coupon not valid for this account');
  if (c.per_user_limit && db.one('SELECT COUNT(*) c FROM coupon_usages WHERE coupon_id=? AND user_id=?', c.id, userId).c >= c.per_user_limit) throw E.bad('You have already used this coupon');
  return c;
}
function productLine(p, qty, withInstall = true) {
  return { product_id: p.id, category_id: p.category_id, name: p.name, hsn: p.hsn, qty, unit_price: p.price, gst_rate: p.gst_rate, transport: round2((p.delivery_charge || 0) * qty), installation: withInstall ? round2((p.installation_charge || 0) * qty) : 0, image: J(p.images, [])[0] };
}
function cartQuote(user, { coupon_code, shipping_address_id } = {}) {
  const rows = db.all(`SELECT c.qty, c.with_installation, p.* FROM cart_items c JOIN products p ON p.id=c.product_id WHERE c.user_id=? ORDER BY p.vendor_id`, user.id);
  const issues = [];
  const byVendor = {};
  for (const r of rows) {
    if (r.status !== 'approved' || !r.active || !r.purchase_available) issues.push({ product_id: r.id, issue: 'unavailable' });
    else if (r.stock < r.qty) issues.push({ product_id: r.id, issue: 'insufficient_stock', available: r.stock });
    else if (r.qty < (r.moq || 1)) issues.push({ product_id: r.id, issue: 'below_moq', moq: r.moq });
    (byVendor[r.vendor_id] ||= { vendor_id: r.vendor_id, lines: [] }).lines.push(productLine(r, r.qty, !!r.with_installation));
  }
  const addr = shipping_address_id ? db.one('SELECT * FROM addresses WHERE id=? AND user_id=?', shipping_address_id, user.id) : db.one('SELECT * FROM addresses WHERE user_id=? ORDER BY is_default DESC, id LIMIT 1', user.id);
  const pos = addr?.state_code || stateCodeOf(addr?.state) || user.state_code;
  const coupon = loadCoupon(coupon_code, user.id);
  const q = priceGroups(Object.values(byVendor), pos, coupon);
  q.place_of_supply = pos; q.issues = issues; q.coupon = coupon ? { code: coupon.code, discount: q.coupon_discount } : null; q.item_count = rows.reduce((a, r) => a + r.qty, 0);
  return q;
}

// ---------- orders ----------
function createOrder(customer, priced, opts) {
  const tx = db.transaction(() => {
    const order_no = seqNo('MM');
    const orderId = db.insert('orders', {
      order_no, customer_id: customer.id, source: opts.source || 'cart', quotation_id: opts.quotation_id, billing_address: opts.billing, shipping_address: opts.shipping, customer_gstin: opts.gstin || customer.gstin,
      place_of_supply: priced.place_of_supply, subtotal: priced.subtotal, discount: priced.discount, coupon_code: opts.coupon?.code, cgst: priced.cgst, sgst: priced.sgst, igst: priced.igst, tax_total: priced.tax_total,
      transport: priced.transport, installation: priced.installation, platform_fee: priced.platform_fee, platform_fee_gst: priced.platform_fee_gst, grand_total: priced.grand_total,
      payment_plan: opts.payment_plan || 'full', payment_method: opts.payment_method, notes: opts.notes, status: 'placed',
    });
    let i = 0;
    for (const g of priced.groups) {
      i++;
      const comm = computeCommission(g.vendor_id, g.lines, 'purchase');
      const commission_gst = round2(comm.amount * 0.18);
      const gateway_fee = round2(g.total * S('gateway_fee_pct', 2) / 100);
      const tcs = round2(g.taxable * S('tcs_pct', 1) / 100);
      const vendor_net = round2(g.total - comm.amount - commission_gst - gateway_fee - tcs);
      const subId = db.insert('sub_orders', { order_id: orderId, sub_order_no: `${order_no}-${i}`, vendor_id: g.vendor_id, subtotal: g.subtotal, discount: g.discount, taxable: g.taxable, cgst: g.cgst, sgst: g.sgst, igst: g.igst, transport: g.transport, installation: g.installation, total: g.total, commission: comm.amount, commission_gst, gateway_fee, tcs, vendor_net, status: 'placed' });
      comm.parts.forEach(p => db.insert('commissions', { sub_order_id: subId, vendor_id: g.vendor_id, rule_id: p.rule_id, basis: p.basis, mode: p.mode, rate: p.rate, amount: p.amount, gst: round2(p.amount * 0.18) }));
      for (const l of g.lines) {
        db.insert('order_items', { order_id: orderId, sub_order_id: subId, product_id: l.product_id, name: l.name, hsn: l.hsn, qty: l.qty, unit_price: l.unit_price, discount: l.discount, gst_rate: l.gst_rate, taxable: l.taxable, cgst: l.cgst, sgst: l.sgst, igst: l.igst, transport: l.transport, installation: l.installation, total: l.total });
        if (l.product_id && opts.source !== 'quotation_noinv') reserveStock(l.product_id, l.qty, order_no);
      }
      db.insert('order_events', { order_id: orderId, sub_order_id: subId, status: 'placed', note: 'Sub-order created' });
      notify(vendorUserId(g.vendor_id), 'order_new', 'New order received', `Order ${order_no}-${i} worth ₹${g.total}`, { order_id: orderId, sub_order_id: subId });
    }
    if (opts.coupon) { db.run('UPDATE coupons SET used_count=used_count+1 WHERE id=?', opts.coupon.id); db.insert('coupon_usages', { coupon_id: opts.coupon.id, user_id: customer.id, order_id: orderId, discount: priced.coupon_discount }); }
    db.insert('order_events', { order_id: orderId, status: 'placed', note: 'Order placed', by_user: customer.id });
    issueInvoice({ type: 'proforma', order_id: orderId });
    notify(customer.id, 'order_placed', 'Order placed', `Your order ${order_no} for ₹${priced.grand_total} has been placed.`, { order_id: orderId });
    return orderId;
  });
  return tx();
}
function reserveStock(productId, qty, ref) {
  const p = db.one('SELECT * FROM products WHERE id=?', productId);
  if (!p) return;
  if (p.stock < qty) throw E.conflict(`Insufficient stock for ${p.name}`);
  db.run('UPDATE products SET stock=stock-?, reserved=reserved+? WHERE id=?', qty, qty, productId);
  db.insert('inventory_log', { product_id: productId, change: -qty, reason: 'order_reserved', ref });
  const np = p.stock - qty;
  const vu = vendorUserId(p.vendor_id);
  if (np <= 0) notify(vu, 'stock_out', 'Out of stock', `${p.name} is now out of stock`, { product_id: p.id });
  else if (np <= (p.low_stock_threshold || 2)) notify(vu, 'stock_low', 'Low stock', `${p.name} has only ${np} left`, { product_id: p.id });
}
function releaseStock(subId, reason) {
  for (const it of db.all('SELECT * FROM order_items WHERE sub_order_id=? AND product_id IS NOT NULL', subId)) {
    db.run('UPDATE products SET stock=stock+?, reserved=MAX(reserved-?,0) WHERE id=?', it.qty, it.qty, it.product_id);
    db.insert('inventory_log', { product_id: it.product_id, change: it.qty, reason, ref: 'sub:' + subId });
  }
}
function consumeStock(subId) {
  for (const it of db.all('SELECT * FROM order_items WHERE sub_order_id=? AND product_id IS NOT NULL', subId)) {
    db.run('UPDATE products SET reserved=MAX(reserved-?,0), sold=sold+? WHERE id=?', it.qty, it.qty, it.product_id);
    db.insert('inventory_log', { product_id: it.product_id, change: 0, field: 'sold', reason: 'delivered', ref: 'sub:' + subId });
  }
}
function refreshOrderStatus(orderId) {
  const subs = db.all('SELECT status FROM sub_orders WHERE order_id=?', orderId).map(s => s.status);
  let st = 'processing';
  if (subs.every(s => ['cancelled', 'rejected'].includes(s))) st = 'cancelled';
  else if (subs.every(s => ['delivered', 'completed', 'cancelled', 'rejected', 'returned'].includes(s))) st = subs.some(s => s === 'returned') && subs.every(s => ['returned', 'cancelled', 'rejected'].includes(s)) ? 'returned' : 'completed';
  else if (subs.every(s => s === 'placed')) st = 'placed';
  else if (subs.some(s => ['shipped', 'out_for_delivery'].includes(s))) st = 'shipped';
  db.run('UPDATE orders SET status=?, updated_at=CURRENT_TIMESTAMP WHERE id=?', st, orderId);
  return st;
}
const SUB_FLOW = { placed: ['accepted', 'rejected', 'cancelled'], accepted: ['processing', 'packed', 'shipped', 'cancelled'], processing: ['packed', 'shipped', 'cancelled'], packed: ['shipped', 'cancelled'], shipped: ['out_for_delivery', 'delivered'], out_for_delivery: ['delivered'], delivered: ['completed', 'return_requested'], completed: ['return_requested'], return_requested: ['returned', 'completed'], cancel_requested: ['cancelled', 'accepted', 'processing'] };
function setSubStatus(sub, status, user, note, extra = {}) {
  const allowed = SUB_FLOW[sub.status] || [];
  if (!allowed.includes(status) && !(user?.role === 'admin' && extra.force)) throw E.bad(`Cannot move sub-order from ${sub.status} to ${status}`);
  const order = db.one('SELECT * FROM orders WHERE id=?', sub.order_id);
  if (['shipped'].includes(status) && order.payment_status === 'pending' && order.payment_plan === 'full') throw E.bad('Cannot dispatch before payment');
  delete extra.force;
  db.update('sub_orders', sub.id, { status, ...extra, updated_at: new Date().toISOString() });
  db.insert('order_events', { order_id: sub.order_id, sub_order_id: sub.id, status, note, by_user: user?.id });
  if (['rejected', 'cancelled'].includes(status)) { releaseStock(sub.id, 'cancel_restore'); if (order.paid_amount > 0) autoRefundSub(sub.id, `Sub-order ${status}`, user); }
  if (status === 'delivered') { consumeStock(sub.id); db.run('UPDATE sub_orders SET delivered_at=CURRENT_TIMESTAMP WHERE id=?', sub.id); trySettle(sub.id); }
  const msg = { accepted: 'accepted by the seller', rejected: 'rejected by the seller', shipped: 'dispatched', out_for_delivery: 'out for delivery', delivered: 'delivered', cancelled: 'cancelled', returned: 'returned' }[status];
  if (msg) notify(order.customer_id, 'order_' + status, `Order ${msg}`, `${sub.sub_order_no} has been ${msg}.`, { order_id: sub.order_id, sub_order_id: sub.id });
  refreshOrderStatus(sub.order_id);
  return db.one('SELECT * FROM sub_orders WHERE id=?', sub.id);
}
function trySettle(subId) {
  const sub = db.one('SELECT * FROM sub_orders WHERE id=?', subId);
  const order = db.one('SELECT * FROM orders WHERE id=?', sub.order_id);
  if (sub.settled || !['delivered', 'completed'].includes(sub.status) || order.payment_status !== 'paid') return false;
  const net = round2(sub.vendor_net - 0);
  post([{ account: ACC.escrow, debit: sub.total }, { account: ACC.avail(sub.vendor_id), credit: net }, { account: ACC.commission, credit: sub.commission }, { account: ACC.gst, credit: sub.commission_gst }, { account: ACC.fees, credit: sub.gateway_fee }, { account: ACC.tcs, credit: sub.tcs }], 'sub_order', sub.id, `Settlement ${sub.sub_order_no}`);
  db.run('UPDATE sub_orders SET settled=1 WHERE id=?', sub.id);
  issueInvoice({ type: 'commission', sub_order_id: sub.id });
  notify(vendorUserId(sub.vendor_id), 'wallet_credit', 'Wallet credited', `₹${net} credited for ${sub.sub_order_no}`, { sub_order_id: sub.id });
  return true;
}

// ---------- payments ----------
async function initPayment(user, { order_id, rental_id, purpose = 'full', provider, method, amount, idempotency_key }) {
  if (idempotency_key) { const ex = db.one('SELECT * FROM payments WHERE idempotency_key=?', idempotency_key); if (ex) return { payment: ex, checkout: J(ex.raw, {}).checkout, idempotent: true }; }
  let due, target;
  if (order_id) {
    target = db.one('SELECT * FROM orders WHERE id=? AND customer_id=?', order_id, user.id); if (!target) throw E.notFound('Order not found');
    if (['cancelled'].includes(target.status)) throw E.bad('Order is cancelled');
    due = round2(target.grand_total - target.paid_amount);
    if (due <= 0) throw E.bad('Order already fully paid');
    if (purpose === 'advance') amount = round2(target.grand_total * S('advance_pct', 25) / 100);
    else if (purpose === 'partial') { amount = round2(amount); if (!(amount > 0 && amount <= due)) throw E.bad('Invalid partial amount'); }
    else amount = due;
  } else if (rental_id) {
    target = db.one('SELECT * FROM rentals WHERE id=? AND customer_id=?', rental_id, user.id); if (!target) throw E.notFound('Rental not found');
    due = rentalOutstanding(target);
    if (due <= 0) throw E.bad('Nothing due on rental');
    if (purpose === 'advance') { if (!['approved'].includes(target.status)) throw E.bad('Rental must be approved by vendor before advance payment'); amount = round2(target.rent_amount * target.advance_pct / 100 + target.deposit); }
    else amount = due;
  } else throw E.bad('order_id or rental_id required');
  amount = Math.min(amount, due);
  const g = providers.gateway(provider);
  const ref = rid('PAY');
  const created = await g.createOrder({ amount, ref, customer: user });
  const id = db.insert('payments', { ref, user_id: user.id, order_id, rental_id, provider: g.name, method, purpose, amount, status: 'created', gateway_order_id: created.gateway_order_id, idempotency_key, raw: { checkout: created.checkout } });
  return { payment: db.one('SELECT * FROM payments WHERE id=?', id), checkout: created.checkout };
}
async function verifyPayment(payload, viaWebhook = false) {
  const p = db.one('SELECT * FROM payments WHERE gateway_order_id=?', payload.gateway_order_id);
  if (!p) throw E.notFound('Payment not found');
  if (p.status === 'success') return { payment: p, idempotent: true };
  const g = providers.gateways[p.provider];
  const ok = viaWebhook ? true : await g.verify(payload);
  if (!ok) {
    db.update('payments', p.id, { status: 'failed', failure_reason: payload.error || 'Signature verification failed', updated_at: new Date().toISOString() });
    notify(p.user_id, 'payment_failed', 'Payment failed', `Payment ${p.ref} of ₹${p.amount} failed. You can retry from your orders.`, { payment_id: p.id });
    throw E.bad('Payment verification failed');
  }
  if (payload.gateway_payment_id && db.one('SELECT id FROM payments WHERE gateway_payment_id=? AND id<>?', payload.gateway_payment_id, p.id)) throw E.conflict('Duplicate transaction');
  return { payment: markPaid(p, payload.gateway_payment_id || ('pay_' + p.ref), payload.signature) };
}
function markPaid(p, gateway_payment_id, signature) {
  return db.transaction(() => {
    const cur = db.one('SELECT * FROM payments WHERE id=?', p.id);
    if (cur.status === 'success') return cur; // idempotent
    db.update('payments', p.id, { status: 'success', gateway_payment_id, signature, updated_at: new Date().toISOString() });
    post([{ account: ACC.clearing, debit: p.amount }, { account: ACC.escrow, credit: p.amount }], 'payment', p.id, `Payment ${p.ref}`);
    if (p.order_id) {
      const o = db.one('SELECT * FROM orders WHERE id=?', p.order_id);
      const paid = round2(o.paid_amount + p.amount);
      const status = paid >= o.grand_total - 0.01 ? 'paid' : 'partial';
      db.update('orders', o.id, { paid_amount: paid, payment_status: status, payment_method: p.method || p.provider });
      db.insert('order_events', { order_id: o.id, status: 'payment_' + status, note: `₹${p.amount} received (${p.purpose})` });
      issueInvoice({ type: 'receipt', payment_id: p.id });
      if (status === 'paid') {
        if (o.platform_fee > 0) post([{ account: ACC.escrow, debit: o.platform_fee + o.platform_fee_gst }, { account: ACC.platformFee, credit: o.platform_fee }, { account: ACC.gst, credit: o.platform_fee_gst }], 'order', o.id, 'Platform fee');
        for (const s of db.all('SELECT * FROM sub_orders WHERE order_id=?', o.id)) { if (!db.one("SELECT id FROM invoices WHERE sub_order_id=? AND type='tax' AND status='issued'", s.id)) issueInvoice({ type: 'tax', sub_order_id: s.id }); trySettle(s.id); }
        notify(o.customer_id, 'invoice', 'Invoice generated', `Tax invoice(s) for ${o.order_no} are ready to download.`, { order_id: o.id });
      }
      notify(o.customer_id, 'payment_success', 'Payment received', `₹${p.amount} received for ${o.order_no}.`, { order_id: o.id });
      for (const s of db.all('SELECT vendor_id FROM sub_orders WHERE order_id=?', o.id)) notify(vendorUserId(s.vendor_id), 'payment_success', 'Customer payment received', `Order ${o.order_no}: payment ${status}`, { order_id: o.id });
    }
    if (p.rental_id) {
      const r = db.one('SELECT * FROM rentals WHERE id=?', p.rental_id);
      const paid = round2(r.paid_amount + p.amount);
      const upd = { paid_amount: paid };
      if (r.status === 'approved') upd.status = 'confirmed';
      db.update('rentals', r.id, upd);
      issueInvoice({ type: 'receipt', payment_id: p.id });
      notify(r.customer_id, 'rental_payment', 'Rental payment received', `₹${p.amount} received for ${r.rental_no}`, { rental_id: r.id });
      notify(vendorUserId(r.vendor_id), 'rental_payment', 'Rental payment received', `${r.rental_no}: ₹${p.amount}`, { rental_id: r.id });
    }
    return db.one('SELECT * FROM payments WHERE id=?', p.id);
  })();
}

// ---------- refunds ----------
async function gatewayRefund(orderId, rentalId, amount) {
  const pays = db.all(`SELECT * FROM payments WHERE status='success' AND ${orderId ? 'order_id=?' : 'rental_id=?'} ORDER BY id DESC`, orderId || rentalId);
  let left = amount; const results = [];
  for (const p of pays) {
    if (left <= 0) break;
    const already = db.one("SELECT COALESCE(SUM(amount),0) s FROM refunds WHERE payment_id=? AND status IN ('processed','pending')", p.id).s;
    const room = round2(p.amount - already); if (room <= 0) continue;
    const amt = Math.min(room, left);
    let r; try { r = await providers.gateways[p.provider].refund(p, amt); } catch (e) { r = { id: null, status: 'failed', error: e.message }; }
    results.push({ payment_id: p.id, amount: amt, ...r }); left = round2(left - amt);
  }
  return results;
}
function refundLedger(sub, amount) {
  if (!sub.settled) return post([{ account: ACC.escrow, debit: amount }, { account: ACC.clearing, credit: amount }], 'refund', sub.id, `Refund pre-settlement ${sub.sub_order_no}`);
  const k = amount / sub.total;
  const lines = [{ account: ACC.avail(sub.vendor_id), debit: round2(sub.vendor_net * k) }, { account: ACC.commission, debit: round2(sub.commission * k) }, { account: ACC.gst, debit: round2(sub.commission_gst * k) }, { account: ACC.fees, debit: round2(sub.gateway_fee * k) }, { account: ACC.tcs, debit: round2(sub.tcs * k) }];
  const d = round2(lines.reduce((a, l) => a + l.debit, 0)); lines[0].debit = round2(lines[0].debit + amount - d);
  lines.push({ account: ACC.clearing, credit: amount });
  return post(lines, 'refund', sub.id, `Refund post-settlement ${sub.sub_order_no}`);
}
async function processRefund({ sub_order_id, amount, reason, request_id, user }) {
  const sub = db.one('SELECT * FROM sub_orders WHERE id=?', sub_order_id); if (!sub) throw E.notFound('Sub-order not found');
  const order = db.one('SELECT * FROM orders WHERE id=?', sub.order_id);
  const paidShare = order.paid_amount >= order.grand_total - 0.01 ? sub.total : round2(sub.total * order.paid_amount / order.grand_total);
  const max = round2(paidShare - sub.refunded);
  amount = round2(amount ?? max);
  if (!(amount > 0) || amount > max + 0.01) throw E.bad(`Refund amount must be between 0 and ${max}`);
  const results = await gatewayRefund(order.id, null, amount);
  const failed = results.some(r => r.status === 'failed');
  const refund_no = rid('RF');
  const rfId = db.insert('refunds', { refund_no, payment_id: results[0]?.payment_id, order_id: order.id, sub_order_id: sub.id, request_id, amount, status: failed ? 'failed' : 'processed', gateway_refund_id: results.map(r => r.id).filter(Boolean).join(','), reason, processed_by: user?.id });
  if (failed) throw E.bad('Gateway refund failed: ' + results.find(r => r.status === 'failed').error);
  db.transaction(() => {
    refundLedger(sub, amount);
    const k = amount / sub.total;
    db.run('UPDATE commissions SET reversed=reversed+ROUND(amount*?,2) WHERE sub_order_id=?', k, sub.id);
    db.run('UPDATE sub_orders SET refunded=refunded+? WHERE id=?', amount, sub.id);
    const ref = round2(order.refunded_amount + amount);
    db.update('orders', order.id, { refunded_amount: ref, payment_status: ref >= order.paid_amount - 0.01 ? 'refunded' : 'partially_refunded' });
    issueInvoice({ type: 'credit_note', sub_order_id: sub.id, amount, reason });
    db.insert('order_events', { order_id: order.id, sub_order_id: sub.id, status: 'refunded', note: `₹${amount} refunded: ${reason || ''}`, by_user: user?.id });
  })();
  notify(order.customer_id, 'refund', 'Refund processed', `₹${amount} refunded for ${sub.sub_order_no}`, { order_id: order.id, refund_id: rfId });
  notify(vendorUserId(sub.vendor_id), 'refund', 'Refund adjusted', `₹${amount} refunded on ${sub.sub_order_no}`, { sub_order_id: sub.id });
  return db.one('SELECT * FROM refunds WHERE id=?', rfId);
}
function autoRefundSub(subId, reason, user) { processRefund({ sub_order_id: subId, reason, user }).catch(e => console.error('auto refund failed', e.message)); }

// ---------- rentals ----------
const UNIT_HOURS = { hour: 1, day: 24, week: 168, month: 720 };
function rentalAvailability(product, start, end, excludeId = 0) {
  const busy = db.one(`SELECT COUNT(*) c FROM rentals WHERE product_id=? AND id<>? AND status IN ('approved','confirmed','active','extension_requested') AND start_at < ? AND end_at > ?`, product.id, excludeId, end, start).c;
  return { units: product.rental_units || 0, booked: busy, available: Math.max(0, (product.rental_units || 0) - busy) };
}
function priceRental(product, unit, duration, posState, rate) {
  const r = rate ?? product['rent_' + { hour: 'hourly', day: 'daily', week: 'weekly', month: 'monthly' }[unit]];
  if (!r) throw E.bad(`No ${unit}ly rental price for this machine`);
  const vendor = db.one('SELECT state_code FROM vendors WHERE id=?', product.vendor_id);
  const rent_amount = round2(r * duration);
  const transport = round2(product.delivery_charge || 0);
  const t = gstSplit(rent_amount + transport, product.gst_rate, vendor.state_code, posState);
  return { rate: r, rent_amount, transport, gst_rate: product.gst_rate, cgst: t.cgst, sgst: t.sgst, igst: t.igst, deposit: product.security_deposit || 0, total: round2(rent_amount + transport + t.tax + (product.security_deposit || 0)) };
}
const rentalOutstanding = r => round2(Math.max(0, rentalDue(r) - (['returned', 'closed'].includes(r.status) ? (r.deposit || 0) : 0) - r.paid_amount));
const rentalDue = r => round2(r.total + (r.late_charge || 0) + (r.damage_charge || 0) + J(r.extension, []).filter(x => x.status === 'approved').reduce((a, x) => a + x.amount, 0));
function closeRental(r, user) {
  r = db.one('SELECT * FROM rentals WHERE id=?', r.id);
  const due = rentalDue(r);
  const charges = round2(due - (r.deposit || 0));
  const balanceDue = round2(charges - r.paid_amount);
  if (balanceDue > 0.01) throw E.bad(`Customer still owes ₹${balanceDue}`);
  const refundDeposit = Math.max(0, round2(-balanceDue));
  const vendorGross = round2(due - r.deposit); // rent + gst + transport + late + damage + extensions
  const taxable = round2(vendorGross / (1 + r.gst_rate / 100));
  const comm = computeCommission(r.vendor_id, [{ product_id: r.product_id, taxable, qty: 1 }], 'rental');
  const cgst = round2(comm.amount * 0.18);
  const net = round2(vendorGross - comm.amount - cgst);
  db.transaction(() => {
    post([{ account: ACC.escrow, debit: vendorGross }, { account: ACC.avail(r.vendor_id), credit: net }, { account: ACC.commission, credit: comm.amount }, { account: ACC.gst, credit: cgst }], 'rental', r.id, `Rental settlement ${r.rental_no}`);
    db.insert('commissions', { rental_id: r.id, vendor_id: r.vendor_id, rule_id: comm.parts[0]?.rule_id, basis: taxable, mode: comm.parts[0]?.mode, rate: comm.parts[0]?.rate, amount: comm.amount, gst: cgst });
    db.update('rentals', r.id, { status: 'closed', deposit_refund: refundDeposit, commission: comm.amount, settled: 1 });
    issueInvoice({ type: 'rental', rental_id: r.id });
  })();
  return { refundDeposit };
}

// ---------- invoices ----------
function company() { return COMPANY(); }
function partyFromVendor(v) { return { name: v.business_name, gstin: v.gstin, address: [v.address, v.city, v.state, v.pincode].filter(Boolean).join(', '), state_code: v.state_code }; }
function issueInvoice(o) {
  const prefixes = S('invoice_prefixes', { tax: 'MMT', proforma: 'MMPF', commission: 'MMC', credit_note: 'MMCN', debit_note: 'MMDN', receipt: 'MMRC', rental: 'MMRT', settlement: 'MMST', quotation: 'MMQI' });
  const co = company();
  let row = { type: o.type, created_by: o.user_id };
  if (o.type === 'proforma' || (o.type === 'tax' && o.order_id)) {
    const ord = db.one('SELECT * FROM orders WHERE id=?', o.order_id); const items = db.all('SELECT * FROM order_items WHERE order_id=?', ord.id); const cust = db.one('SELECT * FROM users WHERE id=?', ord.customer_id);
    Object.assign(row, { order_id: ord.id, customer_id: cust.id, seller: { name: co.name, gstin: co.gstin, address: co.address }, buyer: { name: J(ord.billing_address, {}).name || cust.name, gstin: ord.customer_gstin, address: addrText(J(ord.billing_address, {})) }, seller_gstin: co.gstin, buyer_gstin: ord.customer_gstin, place_of_supply: ord.place_of_supply, items, taxable: round2(ord.subtotal - ord.discount + ord.transport + ord.installation), cgst: ord.cgst, sgst: ord.sgst, igst: ord.igst, discount: ord.discount, charges: round2(ord.transport + ord.installation + ord.platform_fee + ord.platform_fee_gst), total: ord.grand_total, notes: o.type === 'proforma' ? 'Proforma invoice – not a tax invoice' : null });
  } else if (o.type === 'tax') {
    const sub = db.one('SELECT * FROM sub_orders WHERE id=?', o.sub_order_id); const ord = db.one('SELECT * FROM orders WHERE id=?', sub.order_id); const v = db.one('SELECT * FROM vendors WHERE id=?', sub.vendor_id); const cust = db.one('SELECT * FROM users WHERE id=?', ord.customer_id);
    Object.assign(row, { order_id: ord.id, sub_order_id: sub.id, vendor_id: v.id, customer_id: cust.id, seller: partyFromVendor(v), buyer: { name: J(ord.billing_address, {}).name || cust.business_name || cust.name, gstin: ord.customer_gstin, address: addrText(J(ord.billing_address, {})) }, seller_gstin: v.gstin, buyer_gstin: ord.customer_gstin, place_of_supply: ord.place_of_supply, items: db.all('SELECT * FROM order_items WHERE sub_order_id=?', sub.id), taxable: sub.taxable, cgst: sub.cgst, sgst: sub.sgst, igst: sub.igst, discount: sub.discount, charges: round2(sub.transport + sub.installation), total: sub.total });
    row._prefix = `${prefixes.tax}V${v.id}`;
    if (S('einvoice_enabled', true) && ord.customer_gstin) { row.irn = crypto.createHash('sha256').update(`${v.gstin}|${row._prefix}|${Date.now()}`).digest('hex'); row.notes = 'IRN generated in MOCK mode (no IRP credentials configured)'; }
    if (sub.total >= 50000) row.ewaybill_no = 'EWB-MOCK-' + crypto.randomInt(100000000, 999999999);
  } else if (o.type === 'commission') {
    const sub = db.one('SELECT * FROM sub_orders WHERE id=?', o.sub_order_id); const v = db.one('SELECT * FROM vendors WHERE id=?', sub.vendor_id);
    const t = gstSplit(sub.commission, 18, co.state_code, v.state_code);
    Object.assign(row, { sub_order_id: sub.id, order_id: sub.order_id, vendor_id: v.id, seller: { name: co.name, gstin: co.gstin, address: co.address }, buyer: partyFromVendor(v), seller_gstin: co.gstin, buyer_gstin: v.gstin, place_of_supply: v.state_code, items: [{ name: `Marketplace commission on ${sub.sub_order_no}`, hsn: '998599', qty: 1, unit_price: sub.commission, taxable: sub.commission, gst_rate: 18, ...t }], taxable: sub.commission, cgst: t.cgst, sgst: t.sgst, igst: t.igst, total: round2(sub.commission + t.tax) });
  } else if (o.type === 'credit_note' || o.type === 'debit_note') {
    const sub = db.one('SELECT * FROM sub_orders WHERE id=?', o.sub_order_id); const v = db.one('SELECT * FROM vendors WHERE id=?', sub.vendor_id); const ord = db.one('SELECT * FROM orders WHERE id=?', sub.order_id);
    const orig = db.one("SELECT * FROM invoices WHERE sub_order_id=? AND type='tax' ORDER BY id DESC", sub.id);
    const k = o.amount / sub.total;
    Object.assign(row, { sub_order_id: sub.id, order_id: ord.id, vendor_id: v.id, customer_id: ord.customer_id, ref_invoice_id: orig?.id, seller: partyFromVendor(v), buyer: { name: J(ord.billing_address, {}).name, gstin: ord.customer_gstin }, seller_gstin: v.gstin, buyer_gstin: ord.customer_gstin, place_of_supply: ord.place_of_supply, items: [{ name: (o.type === 'credit_note' ? 'Credit against ' : 'Debit against ') + (orig?.invoice_no || sub.sub_order_no), qty: 1, unit_price: round2(sub.taxable * k), taxable: round2(sub.taxable * k) }], taxable: round2(sub.taxable * k), cgst: round2(sub.cgst * k), sgst: round2(sub.sgst * k), igst: round2(sub.igst * k), total: round2(o.amount), notes: o.reason });
  } else if (o.type === 'receipt') {
    const p = db.one('SELECT * FROM payments WHERE id=?', o.payment_id); const cust = db.one('SELECT * FROM users WHERE id=?', p.user_id);
    Object.assign(row, { order_id: p.order_id, rental_id: p.rental_id, customer_id: cust.id, seller: { name: co.name, gstin: co.gstin, address: co.address }, buyer: { name: cust.name }, items: [{ name: `Payment ${p.ref} (${p.purpose}) via ${p.provider}/${p.method || '-'}`, qty: 1, unit_price: p.amount, taxable: 0 }], total: p.amount, notes: 'Payment receipt – gateway ref ' + (p.gateway_payment_id || '') });
  } else if (o.type === 'rental') {
    const r = db.one('SELECT * FROM rentals WHERE id=?', o.rental_id); const v = db.one('SELECT * FROM vendors WHERE id=?', r.vendor_id); const cust = db.one('SELECT * FROM users WHERE id=?', r.customer_id); const p = db.one('SELECT * FROM products WHERE id=?', r.product_id);
    const ext = J(r.extension, []).filter(x => x.status === 'approved').reduce((a, x) => a + x.amount, 0);
    const items = [{ name: `Rental: ${p.name} (${r.duration} ${r.unit}${r.duration > 1 ? 's' : ''} @ ₹${r.rate})`, hsn: '997313', qty: 1, unit_price: r.rent_amount, taxable: r.rent_amount, gst_rate: r.gst_rate }];
    if (r.transport) items.push({ name: 'Transportation', qty: 1, unit_price: r.transport, taxable: r.transport });
    if (ext) items.push({ name: 'Extension charges (incl. GST)', qty: 1, unit_price: ext });
    if (r.late_charge) items.push({ name: 'Late return charges', qty: 1, unit_price: r.late_charge });
    if (r.damage_charge) items.push({ name: 'Damage charges', qty: 1, unit_price: r.damage_charge });
    Object.assign(row, { rental_id: r.id, vendor_id: v.id, customer_id: cust.id, seller: partyFromVendor(v), buyer: { name: cust.business_name || cust.name, gstin: cust.gstin }, seller_gstin: v.gstin, buyer_gstin: cust.gstin, items, taxable: round2(r.rent_amount + r.transport), cgst: r.cgst, sgst: r.sgst, igst: r.igst, charges: round2(ext + r.late_charge + r.damage_charge), total: round2(rentalDue(r) - r.deposit), notes: `Security deposit ₹${r.deposit} held separately; refund ₹${r.deposit_refund ?? 0}` });
  } else if (o.type === 'settlement') {
    const w = db.one('SELECT * FROM withdrawals WHERE id=?', o.withdrawal_id); const v = db.one('SELECT * FROM vendors WHERE id=?', w.vendor_id);
    Object.assign(row, { withdrawal_id: w.id, vendor_id: v.id, seller: { name: co.name }, buyer: partyFromVendor(v), items: [{ name: `Withdrawal ${w.withdrawal_no} payout (UTR ${w.utr || '-'})`, qty: 1, unit_price: w.amount }, { name: 'Processing fee', qty: 1, unit_price: -w.fee }], total: w.net, notes: 'Vendor settlement statement' });
  } else if (o.type === 'quotation') {
    const q = db.one('SELECT * FROM quotations WHERE id=?', o.quotation_id); const v = db.one('SELECT * FROM vendors WHERE id=?', q.vendor_id); const cust = db.one('SELECT * FROM users WHERE id=?', q.customer_id);
    Object.assign(row, { quotation_id: q.id, vendor_id: v.id, customer_id: cust.id, seller: partyFromVendor(v), buyer: { name: cust.business_name || cust.name, gstin: cust.gstin }, seller_gstin: v.gstin, buyer_gstin: cust.gstin, items: J(q.items, []), taxable: q.taxable, cgst: q.cgst, sgst: q.sgst, igst: q.igst, discount: q.discount, charges: round2(q.transport + q.installation), total: q.total, notes: 'Proforma against quotation ' + q.quote_no });
    row.type = 'proforma';
  } else if (o.type === 'manual') {
    Object.assign(row, o.data, { type: o.data.type || 'tax' });
  }
  const prefix = row._prefix || prefixes[row.type] || 'MMX'; delete row._prefix;
  const { no, fy } = nextNumber(prefix);
  row.invoice_no = no; row.fy = fy;
  const id = db.insert('invoices', row);
  return db.one('SELECT * FROM invoices WHERE id=?', id);
}
const addrText = a => a ? [a.name, a.line1, a.line2, a.city, a.state, a.pincode].filter(Boolean).join(', ') : '';

function invoicePdf(inv, res) {
  const PDFDocument = require('pdfkit');
  const doc = new PDFDocument({ size: 'A4', margin: 40 });
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `inline; filename="${inv.invoice_no.replace(/\//g, '-')}.pdf"`);
  doc.pipe(res);
  const title = { tax: 'TAX INVOICE', proforma: 'PROFORMA INVOICE', commission: 'COMMISSION TAX INVOICE', credit_note: 'CREDIT NOTE', debit_note: 'DEBIT NOTE', receipt: 'PAYMENT RECEIPT', rental: 'RENTAL TAX INVOICE', settlement: 'SETTLEMENT STATEMENT' }[inv.type] || 'INVOICE';
  const seller = J(inv.seller, {}), buyer = J(inv.buyer, {});
  doc.rect(0, 0, 595, 90).fill('#eef1ff'); doc.fillColor('#2b2f55').fontSize(20).text('Mohan Mishra', 40, 28); doc.fontSize(9).fillColor('#666').text('Machinery & Industrial Equipment Marketplace', 40, 52);
  doc.fontSize(14).fillColor('#2b2f55').text(title, 300, 30, { width: 255, align: 'right' }); doc.fontSize(9).fillColor('#333').text(`No: ${inv.invoice_no}\nDate: ${inv.created_at}\nFY: ${inv.fy}${inv.status === 'cancelled' ? '\nSTATUS: CANCELLED' : ''}`, 300, 50, { width: 255, align: 'right' });
  doc.fillColor('#000').fontSize(10).text('Seller', 40, 110, { underline: true }).fontSize(9).text(`${seller.name || ''}\n${seller.address || ''}\nGSTIN: ${seller.gstin || 'N/A'}`, 40, 125, { width: 250 });
  doc.fontSize(10).text('Bill To', 310, 110, { underline: true }).fontSize(9).text(`${buyer.name || ''}\n${buyer.address || ''}\nGSTIN: ${buyer.gstin || 'Unregistered'}\nPlace of supply: ${inv.place_of_supply || '-'}`, 310, 125, { width: 245 });
  let y = 200;
  doc.rect(40, y, 515, 18).fill('#2b2f55'); doc.fillColor('#fff').fontSize(8);
  [['#', 45], ['Description', 60], ['HSN', 285], ['Qty', 330], ['Rate', 365], ['Taxable', 420], ['GST%', 480], ['Amount', 510]].forEach(([t, x]) => doc.text(t, x, y + 5));
  doc.fillColor('#000'); y += 22;
  J(inv.items, []).forEach((it, i) => {
    doc.text(String(i + 1), 45, y).text(it.name || '', 60, y, { width: 220 }).text(it.hsn || '', 285, y).text(String(it.qty ?? 1), 330, y).text(fmt(it.unit_price), 365, y).text(fmt(it.taxable), 420, y).text(it.gst_rate != null ? String(it.gst_rate) : '', 480, y).text(fmt(it.total ?? it.unit_price * (it.qty || 1)), 505, y);
    y += Math.max(16, doc.heightOfString(it.name || '', { width: 220 }) + 4);
    if (y > 700) { doc.addPage(); y = 50; }
  });
  y += 10; doc.moveTo(300, y).lineTo(555, y).stroke('#ccc'); y += 6;
  const rows = [['Discount', inv.discount], ['Taxable value', inv.taxable], ['CGST', inv.cgst], ['SGST', inv.sgst], ['IGST', inv.igst], ['Other charges', inv.charges]].filter(r => r[1]);
  rows.forEach(([k, val]) => { doc.text(k, 310, y).text('₹ ' + fmt(val).replace('₹', ''), 450, y, { width: 100, align: 'right' }); y += 14; });
  doc.fontSize(11).text('Total', 310, y + 4).text('INR ' + fmt(inv.total), 420, y + 4, { width: 130, align: 'right' }); y += 30;
  doc.fontSize(8).fillColor('#555');
  if (inv.irn) doc.text(`IRN: ${inv.irn}`, 40, y), y += 12;
  if (inv.ewaybill_no) doc.text(`E-way bill: ${inv.ewaybill_no}`, 40, y), y += 12;
  if (inv.notes) doc.text(inv.notes, 40, y, { width: 515 }), y += 14;
  doc.text('This is a computer generated document.', 40, 780, { width: 515, align: 'center' });
  doc.end();
}
const fmt = n => (n == null || n === '') ? '' : Number(n).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

// ---------- wallet ----------
function vendorWallet(vid) {
  const available = balance(ACC.avail(vid)), onhold = balance(ACC.hold(vid));
  const pending = round2(db.one(`SELECT COALESCE(SUM(s.vendor_net - s.refunded),0) s FROM sub_orders s JOIN orders o ON o.id=s.order_id WHERE s.vendor_id=? AND s.settled=0 AND o.paid_amount>0 AND s.status NOT IN ('cancelled','rejected','returned')`, vid).s);
  const withdrawn = round2(db.one("SELECT COALESCE(SUM(amount),0) s FROM withdrawals WHERE vendor_id=? AND status='paid'", vid).s);
  const gross = round2(db.one(`SELECT COALESCE(SUM(total),0) s FROM sub_orders WHERE vendor_id=? AND status NOT IN ('cancelled','rejected')`, vid).s);
  const commission = round2(db.one('SELECT COALESCE(SUM(amount-reversed),0) s FROM commissions WHERE vendor_id=?', vid).s);
  const earnings = round2(db.one(`SELECT COALESCE(SUM(credit-debit),0) s FROM ledger_entries WHERE account=? AND ref_type IN ('sub_order','rental','refund')`, ACC.avail(vid)).s);
  return { available, onhold, pending_settlement: pending, withdrawn, gross_sales: gross, commission, net_earnings: earnings, min_withdrawal: S('min_withdrawal', 1000), withdrawal_fee: S('withdrawal_fee', 0) };
}

module.exports = { rentalOutstanding, commissionRule, computeCommission, priceGroups, loadCoupon, productLine, cartQuote, createOrder, setSubStatus, refreshOrderStatus, trySettle, releaseStock, initPayment, verifyPayment, markPaid, processRefund, gatewayRefund, rentalAvailability, priceRental, rentalDue, closeRental, UNIT_HOURS, issueInvoice, invoicePdf, vendorWallet, addrText, SUB_FLOW };
