// CRM router factory: scope = 'admin' (platform CRM) or 'vendor' (vendor's own leads)
const express = require('express');
const { db, E, wrap, v, pageResult, notify, audit, rid, seqNo, vendorUserId } = require('../core');
const bcrypt = require('bcryptjs');
const providers = require('../providers');
module.exports = function crm(scope) {
  const r = express.Router();
  const own = (req) => scope === 'vendor' ? ['owner_type=? AND vendor_id=?', ['vendor', req.vendor.id]] : ["owner_type='admin'", []];
  const leadOf = (req) => { const [w, p] = own(req); const l = db.one(`SELECT * FROM crm_leads WHERE id=? AND ${w}`, req.params.id, ...p); if (!l) throw E.notFound('Lead not found'); return l; };
  const RULES = { name: 'string|required|max:120', company: 'string|max:160', mobile: 'mobile', email: 'email', gstin: 'gstin', city: 'string|max:80', source: 'string|max:40', status: 'enum|in:new,contacted,qualified,proposal,negotiation,won,lost', value: 'number', segment: 'string|max:40', kind: 'enum|in:customer,vendor', assigned_to: 'int', next_followup: 'string', tags: 'string|max:200' };
  r.get('/leads', (req, res) => {
    const [w, p] = own(req); const wh = [w]; const ps = [...p];
    for (const k of ['status', 'source', 'kind', 'segment', 'assigned_to']) if (req.query[k]) { wh.push(`${k}=?`); ps.push(req.query[k]); }
    if (req.query.q) { wh.push('(name LIKE ? OR company LIKE ? OR mobile LIKE ? OR email LIKE ?)'); const l = `%${req.query.q}%`; ps.push(l, l, l, l); }
    if (req.query.due === '1') wh.push("next_followup IS NOT NULL AND next_followup <= datetime('now','+1 day')");
    res.json(pageResult(`SELECT * FROM crm_leads WHERE ${wh.join(' AND ')} ORDER BY COALESCE(next_followup,'9999') ASC, id DESC`, ps, req));
  });
  r.get('/pipeline', (req, res) => { const [w, p] = own(req); res.json({ stages: db.all(`SELECT status, COUNT(*) count, COALESCE(SUM(value),0) value FROM crm_leads WHERE ${w} GROUP BY status`, ...p), followups_due: db.one(`SELECT COUNT(*) c FROM crm_leads WHERE ${w} AND next_followup <= datetime('now','+1 day') AND status NOT IN ('won','lost')`, ...p).c, conversion_rate: (() => { const t = db.one(`SELECT COUNT(*) c, SUM(status='won') w FROM crm_leads WHERE ${w}`, ...p); return t.c ? Math.round(100 * (t.w || 0) / t.c) : 0; })() }); });
  r.post('/leads', wrap((req, res) => { const b = v(req.body, RULES); const id = db.insert('crm_leads', { ...b, owner_type: scope, vendor_id: scope === 'vendor' ? req.vendor.id : null, created_by: req.user.id }); audit(req, 'crm.lead_create', 'crm_lead', id); res.status(201).json(db.one('SELECT * FROM crm_leads WHERE id=?', id)); }));
  r.get('/leads/:id', wrap((req, res) => { const l = leadOf(req); l.activities = db.all('SELECT a.*, u.name by_name FROM crm_activities a LEFT JOIN users u ON u.id=a.by_user WHERE lead_id=? ORDER BY a.id DESC', l.id); l.calls = db.all('SELECT * FROM call_logs WHERE lead_id=? ORDER BY id DESC', l.id); if (l.customer_id) { l.orders = db.all('SELECT id,order_no,grand_total,status,created_at FROM orders WHERE customer_id=? ORDER BY id DESC LIMIT 10', l.customer_id); l.enquiries = db.all('SELECT id,enquiry_no,title,status FROM enquiries WHERE customer_id=? ORDER BY id DESC LIMIT 10', l.customer_id); } res.json(l); }));
  r.patch('/leads/:id', wrap((req, res) => { const l = leadOf(req); const rules = Object.fromEntries(Object.entries(RULES).map(([k, x]) => [k, x.replace('|required', '')])); const b = v(req.body, rules); if (b.status === 'won' && l.status !== 'won') b.converted_at = new Date().toISOString(); db.update('crm_leads', l.id, { ...b, updated_at: new Date().toISOString() }); if (b.status && b.status !== l.status) db.insert('crm_activities', { lead_id: l.id, type: 'status', content: `${l.status} → ${b.status}`, by_user: req.user.id }); if (b.assigned_to) notify(b.assigned_to, 'crm_assigned', 'Lead assigned to you', l.name, { lead_id: l.id }); res.json(db.one('SELECT * FROM crm_leads WHERE id=?', l.id)); }));
  r.delete('/leads/:id', wrap((req, res) => { const l = leadOf(req); db.run('DELETE FROM crm_activities WHERE lead_id=?', l.id); db.run('DELETE FROM crm_leads WHERE id=?', l.id); res.json({ ok: true }); }));
  r.post('/leads/:id/activities', wrap((req, res) => {
    const l = leadOf(req); const b = v(req.body, { type: 'enum|required|in:note,call,meeting,email,whatsapp,reminder,task,followup', content: 'string|max:4000', due_at: 'string' });
    const id = db.insert('crm_activities', { lead_id: l.id, ...b, by_user: req.user.id });
    if (['reminder', 'followup', 'meeting', 'task'].includes(b.type) && b.due_at) db.update('crm_leads', l.id, { next_followup: b.due_at });
    if (l.status === 'new' && ['call', 'meeting', 'email', 'whatsapp'].includes(b.type)) db.update('crm_leads', l.id, { status: 'contacted' });
    res.status(201).json(db.one('SELECT * FROM crm_activities WHERE id=?', id));
  }));
  // Convert a lead: to=customer (find or create the customer account and link it), to=quotation (raise an RFQ/enquiry
  // to sellers on the customer's behalf; quotations then arrive from vendors), to=order (link customer and hand off to
  // the admin Create order screen). Admin scope only for quotation/order.
  r.post('/leads/:id/convert', wrap((req, res) => {
    const l = leadOf(req);
    const b = v(req.body, { to: 'enum|required|in:customer,quotation,order', title: 'string|max:200', requirements: 'string|max:4000', qty: 'int', product_id: 'int', category_id: 'int', location: 'string|max:120' });
    if (b.to !== 'customer' && scope !== 'admin') throw E.bad('Only the platform CRM can convert to quotation or order');
    if (b.to === 'quotation' && !b.product_id && !b.category_id) throw E.bad('Choose a machine or category for the quotation request', { product_id: 'Select a machine or a category' });
    if (b.product_id && !db.one('SELECT id FROM products WHERE id=?', b.product_id)) throw E.notFound('Product not found');
    let cust = l.customer_id ? db.one('SELECT * FROM users WHERE id=?', l.customer_id) : null;
    if (!cust && (l.email || l.mobile)) cust = db.one("SELECT * FROM users WHERE role='customer' AND ((email IS NOT NULL AND email=?) OR (mobile IS NOT NULL AND mobile=?))", l.email || '-', l.mobile || '-');
    let created = false;
    if (!cust) {
      if (!l.email && !l.mobile) throw E.bad('Add a mobile number or email to the lead before converting', { mobile: 'Mobile or email is required to create the customer account' });
      const uid = db.insert('users', { role: 'customer', name: l.name, email: l.email || null, mobile: l.mobile || null, business_name: l.company || null, gstin: l.gstin || null, account_type: l.company || l.gstin ? 'business' : 'individual', status: 'active', password_hash: bcrypt.hashSync(rid('pw'), 10), created_by: req.user.id });
      cust = db.one('SELECT * FROM users WHERE id=?', uid); created = true;
    }
    const upd = { customer_id: cust.id, updated_at: new Date().toISOString() };
    if (['new', 'contacted'].includes(l.status)) upd.status = 'qualified';
    const out = { lead_id: l.id, to: b.to, customer_id: cust.id, customer_created: created };
    if (b.to === 'quotation') {
      let category_id = b.category_id; let vendors = [];
      if (b.product_id) { const p = db.one('SELECT vendor_id, category_id FROM products WHERE id=?', b.product_id); if (!p) throw E.notFound('Product not found'); vendors = [p.vendor_id]; category_id ||= p.category_id; }
      if (!vendors.length) vendors = db.all("SELECT DISTINCT p.vendor_id FROM products p JOIN vendors v ON v.id=p.vendor_id WHERE (p.category_id=? OR p.subcategory_id=?) AND v.status='active' LIMIT 10", category_id, category_id).map(r => r.vendor_id);
      vendors = vendors.filter(id => db.one("SELECT id FROM vendors WHERE id=? AND status='active'", id));
      if (!vendors.length) throw E.bad('No active seller found for this machine/category');
      const eid = db.insert('enquiries', { enquiry_no: seqNo('ENQ'), customer_id: cust.id, product_id: b.product_id || null, category_id, type: 'quotation', title: b.title || `Quotation for ${l.company || l.name}`, requirements: b.requirements || '', qty: b.qty || 1, location: b.location || l.city || '', docs: [] });
      for (const vid of vendors) { db.run('INSERT OR IGNORE INTO enquiry_vendors(enquiry_id,vendor_id) VALUES(?,?)', eid, vid); notify(vendorUserId(vid), 'enquiry_new', 'New enquiry', b.title || 'Quotation request', { enquiry_id: eid }); }
      upd.enquiry_id = eid; if (['new', 'contacted', 'qualified'].includes(l.status)) upd.status = 'proposal';
      Object.assign(out, { enquiry_id: eid, enquiry_no: db.one('SELECT enquiry_no FROM enquiries WHERE id=?', eid).enquiry_no, vendors: vendors.length });
    }
    if (b.to === 'order') out.next = `/admin/#/orders/new?customer=${cust.id}`;
    db.update('crm_leads', l.id, upd);
    db.insert('crm_activities', { lead_id: l.id, type: 'note', content: `Converted to ${b.to}${created ? ' (new customer account created)' : ''}${out.enquiry_no ? ' · ' + out.enquiry_no : ''}`, by_user: req.user.id });
    audit(req, 'crm.lead_convert', 'crm_lead', l.id, out);
    res.status(201).json(out);
  }));
  r.post('/activities/:aid/done', wrap((req, res) => { db.run('UPDATE crm_activities SET done=1 WHERE id=?', req.params.aid); res.json({ ok: true }); }));
  // click-to-call (Twilio if configured, else tel: link / mock) + call log
  r.post('/leads/:id/call', wrap(async (req, res) => {
    const l = leadOf(req); if (!l.mobile) throw E.bad('Lead has no mobile number');
    const out = await providers.telephony.call(req.user.mobile, l.mobile);
    const id = db.insert('call_logs', { lead_id: l.id, by_user: req.user.id, to_number: l.mobile, provider: out.provider, status: out.status, sid: out.sid });
    db.insert('crm_activities', { lead_id: l.id, type: 'call', content: `Call ${out.status} via ${out.provider}`, by_user: req.user.id });
    res.json({ call_id: id, ...out, dial: out.dial || 'tel:+91' + l.mobile, whatsapp: `https://wa.me/91${l.mobile}` });
  }));
  r.patch('/calls/:cid', wrap((req, res) => { const b = v(req.body, { duration: 'int', outcome: 'string|max:500', status: 'string|max:30' }); db.update('call_logs', +req.params.cid, b); res.json(db.one('SELECT * FROM call_logs WHERE id=?', req.params.cid)); }));
  r.get('/calls', (req, res) => { const [w, p] = own(req); res.json(pageResult(`SELECT c.*, l.name lead_name FROM call_logs c JOIN crm_leads l ON l.id=c.lead_id WHERE ${w.replace(/(owner_type|vendor_id)/g, 'l.$1')} ORDER BY c.id DESC`, p, req)); });
  r.get('/followups', (req, res) => { const [w, p] = own(req); res.json({ items: db.all(`SELECT a.*, l.name lead_name, l.mobile FROM crm_activities a JOIN crm_leads l ON l.id=a.lead_id WHERE ${w.replace(/(owner_type|vendor_id)/g, 'l.$1')} AND a.done=0 AND a.due_at IS NOT NULL ORDER BY a.due_at LIMIT 100`, ...p) }); });
  return r;
};
