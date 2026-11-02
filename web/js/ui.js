// Shared UI kit: API client, router, DOM helpers, toast/modal, canvas charts, tables & forms. No dependencies.
const S = { token: localStorage.getItem('mm_token'), user: JSON.parse(localStorage.getItem('mm_user') || 'null'), cartCount: 0, config: null };
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const inr = n => '₹' + Number(n || 0).toLocaleString('en-IN', { maximumFractionDigits: 2 });
const dt = s => s ? new Date(s.includes('T') || s.endsWith('Z') ? s : s.replace(' ', 'T') + 'Z').toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' }) : '';
const dd = s => s ? new Date(s.length <= 10 ? s : (s.includes('T') ? s : s.replace(' ', 'T') + 'Z')).toLocaleDateString('en-IN', { dateStyle: 'medium' }) : '';
const $ = (s, el = document) => el.querySelector(s); const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const stars = (r, n) => `<span class="stars">${'★'.repeat(Math.round(r || 0))}${'☆'.repeat(5 - Math.round(r || 0))}${n !== undefined ? `<small>${Number(r || 0).toFixed(1)} (${n})</small>` : ''}</span>`;
const TAGC = { approved: 'green', active: 'green', paid: 'green', success: 'green', delivered: 'green', completed: 'green', closed: 'green', accepted: 'green', converted: 'green', processed: 'green', issued: 'green', resolved: 'green', pending: 'amber', partial: 'amber', created: 'amber', open: 'amber', sent: 'amber', requested: 'amber', negotiation: 'amber', revision_requested: 'amber', placed: 'amber', rejected: 'red', cancelled: 'red', failed: 'red', blocked: 'red', suspended: 'red', expired: 'red', returned: 'peach', refunded: 'peach', shipped: 'peach', ongoing: 'peach', in_transit: 'peach' };
const tag = s => s ? `<span class="tag ${TAGC[s] || ''}">${esc(String(s).replace(/_/g, ' '))}</span>` : '';
function toast(msg, err) { const d = document.createElement('div'); d.textContent = msg; if (err) d.className = 'err'; $('#toast').append(d); setTimeout(() => d.remove(), 3200); }
async function api(method, url, body, opts = {}) {
  const headers = {}; if (S.token) headers.authorization = 'Bearer ' + S.token;
  let b; if (body instanceof FormData) b = body; else if (body !== undefined) { headers['content-type'] = 'application/json'; b = JSON.stringify(body); }
  const r = await fetch('/api/v1' + url, { method, headers, body: b });
  if (opts.raw) { if (!r.ok) throw new Error('Download failed'); return r; }
  const d = r.headers.get('content-type')?.includes('json') ? await r.json() : await r.text();
  if (r.status === 401 && S.token && !opts.noLogout) { setAuth(null); toast('Session expired, please log in', 1); go(loginRoute()); }
  if (!r.ok) { const e = new Error(d?.error?.message || 'Request failed'); e.data = d; e.status = r.status; if (!opts.quiet) toast(e.message + (d?.error?.details && Array.isArray(d.error.details) ? ': ' + d.error.details.map(x => x.message || x.field || JSON.stringify(x)).join(', ') : ''), 1); throw e; }
  return d;
}
const GET = (u, o) => api('GET', u, undefined, o), POST = (u, b, o) => api('POST', u, b || {}, o), PATCH = (u, b) => api('PATCH', u, b), DEL = u => api('DELETE', u);
async function download(url, name) { const r = await api('GET', url, undefined, { raw: true }); const blob = await r.blob(); const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 4000); }
async function openPdf(url) { const r = await api('GET', url, undefined, { raw: true }); const blob = await r.blob(); window.open(URL.createObjectURL(blob), '_blank'); }
function setAuth(d) { if (d) { S.token = d.token; S.user = d.user; localStorage.setItem('mm_token', d.token); localStorage.setItem('mm_user', JSON.stringify(d.user)); } else { S.token = null; S.user = null; localStorage.removeItem('mm_token'); localStorage.removeItem('mm_user'); } }
const area = () => location.pathname.startsWith('/admin') ? 'admin' : location.pathname.startsWith('/vendor') ? 'vendor' : 'customer';
const loginRoute = () => '#/login';
const go = h => { if (location.hash === h) route(); else location.hash = h; };
function modal(html, onMount) { const m = $('#modal'); m.innerHTML = `<div class="card">${html}</div>`; m.hidden = false; m.onclick = e => { if (e.target === m) closeModal(); }; onMount && onMount(m.firstChild); return m.firstChild; }
const closeModal = () => { const m = $('#modal'); m.hidden = true; m.innerHTML = ''; };
// ---------- Google Identity Services ----------
function gsiButton(el, onCred) {
  if (!el || !S.config?.google_client_id) return;
  const init = () => { google.accounts.id.initialize({ client_id: S.config.google_client_id, callback: r => onCred(r.credential).catch(() => { }), ux_mode: 'popup' }); google.accounts.id.renderButton(el, { theme: 'outline', size: 'large', shape: 'pill', text: 'continue_with', width: Math.min(el.clientWidth || 320, 400) }); };
  if (window.google?.accounts?.id) return init();
  const s = document.createElement('script'); s.src = 'https://accounts.google.com/gsi/client'; s.async = true; s.onload = init; s.onerror = () => toast('Could not load Google sign-in', 1); document.head.append(s);
}
// ---------- password management ----------
const pwOk = p => p.length >= 8 && /[A-Za-z]/.test(p) && /\d/.test(p);
const pwField = (id, label, ph) => `<label class="pwf">${label}<span class="pwrow"><input type="password" id="${id}" autocomplete="new-password" placeholder="${ph || ''}" maxlength="100"><button type="button" class="btn ghost sm" data-eye="${id}" aria-label="Show password">Show</button></span></label>`;
function pwEyes(root) { root.querySelectorAll('[data-eye]').forEach(b => b.onclick = () => { const i = root.querySelector('#' + b.dataset.eye); const show = i.type === 'password'; i.type = show ? 'text' : 'password'; b.textContent = show ? 'Hide' : 'Show'; b.setAttribute('aria-label', show ? 'Hide password' : 'Show password'); }); }
async function copyText(t) { try { await navigator.clipboard.writeText(t); } catch { const a = document.createElement('textarea'); a.value = t; document.body.append(a); a.select(); document.execCommand('copy'); a.remove(); } toast('Copied to clipboard'); }
function pwResetDlg(id, label) {
  modal(`<h3>Reset / Set password</h3><p class="small muted">For <b>${esc(label || 'user #' + id)}</b>. All of their current sessions will be signed out.</p>
    ${pwField('npw', 'New password', 'At least 8 characters, a letter and a digit')}
    <div class="row wrap" style="gap:8px;margin-top:8px"><button class="btn ghost sm" id="pwgen">Generate password</button></div>
    <div id="pwout" class="pwout" hidden><div class="small"><b>New password</b> — Shown once — share it securely</div><div class="pwrow"><code id="pwval"></code><button class="btn sm" id="pwcopy">Copy</button></div></div>
    <p class="small muted pwnote">Shown once — share it securely. The password is never stored in plain text and cannot be viewed again.</p>
    <div class="row" style="gap:8px;justify-content:flex-end;margin-top:12px"><button class="btn ghost" id="pwclose">Close</button><button class="btn green" id="pwset">Set password</button></div>`, c => {
    pwEyes(c); c.querySelector('#pwclose').onclick = closeModal;
    const shown = p => { c.querySelector('#pwval').textContent = p; c.querySelector('#pwout').hidden = false; c.querySelector('#pwcopy').onclick = () => copyText(p); c.querySelector('#npw').value = ''; };
    c.querySelector('#pwgen').onclick = async () => { if (!confirm('Generate a new password? The current one stops working immediately.')) return; const r = await POST(`/admin/users/${id}/password`, { generate: true }); shown(r.password); toast('Password generated'); };
    c.querySelector('#pwset').onclick = async () => { const p = c.querySelector('#npw').value; if (!pwOk(p)) return toast('Use at least 8 characters with a letter and a digit', 1); await POST(`/admin/users/${id}/password`, { password: p }); shown(p); toast('Password updated'); };
  });
}
function changeMyPwDlg() {
  modal(`<h3>Change my password</h3>${pwField('cpw', 'Current password')}${pwField('npw', 'New password', 'At least 8 characters, a letter and a digit')}${pwField('npw2', 'Confirm new password')}
    <p class="small muted">Other devices signed in to this account will be signed out.</p>
    <div class="row" style="gap:8px;justify-content:flex-end;margin-top:12px"><button class="btn ghost" id="pwclose">Cancel</button><button class="btn green" id="pwsave">Change password</button></div>`, c => {
    pwEyes(c); c.querySelector('#pwclose').onclick = closeModal;
    c.querySelector('#pwsave').onclick = async () => { const cur = c.querySelector('#cpw').value, n = c.querySelector('#npw').value; if (!pwOk(n)) return toast('Use at least 8 characters with a letter and a digit', 1); if (n !== c.querySelector('#npw2').value) return toast('Passwords do not match', 1); await POST('/auth/me/change-password', { current_password: cur, new_password: n }); closeModal(); toast('Password changed'); };
  });
}
function ask(title, fields, submitText = 'Submit') { return new Promise(res => { modal(`<h3>${esc(title)}</h3>${formHtml(fields)}<div class="row mt" style="justify-content:flex-end"><button class="btn ghost" data-x>Cancel</button><button class="btn" data-ok>${esc(submitText)}</button></div>`, el => { $('[data-x]', el).onclick = () => { closeModal(); res(null); }; $('[data-ok]', el).onclick = () => { const v = readForm(el); closeModal(); res(v); }; }); }); }
const confirmBox = t => new Promise(res => modal(`<p>${esc(t)}</p><div class="row" style="justify-content:flex-end"><button class="btn ghost" data-x>No</button><button class="btn" data-ok>Yes</button></div>`, el => { $('[data-x]', el).onclick = () => { closeModal(); res(false); }; $('[data-ok]', el).onclick = () => { closeModal(); res(true); }; }));
// fields: [{k,l,t:'text|number|select|textarea|checkbox|date|password|json',o:[[v,l]],v,req,full}]
function formHtml(fields) { return `<div class="form">${fields.map(f => { const val = f.v ?? ''; const id = 'f_' + f.k; let inp;
  if (f.t === 'select') inp = `<select name="${f.k}" id="${id}">${(f.o || []).map(o => { const [v, l] = Array.isArray(o) ? o : [o, o]; return `<option value="${esc(v)}" ${String(v) === String(val) ? 'selected' : ''}>${esc(l)}</option>`; }).join('')}</select>`;
  else if (f.t === 'textarea' || f.t === 'json') inp = `<textarea name="${f.k}" id="${id}" rows="${f.rows || 3}" data-t="${f.t}">${esc(f.t === 'json' && typeof val !== 'string' ? JSON.stringify(val, null, 2) : val)}</textarea>`;
  else if (f.t === 'checkbox') inp = `<input type="checkbox" name="${f.k}" id="${id}" style="width:auto" ${val ? 'checked' : ''}>`;
  else inp = `<input name="${f.k}" id="${id}" type="${f.t || 'text'}" value="${esc(val)}" ${f.req ? 'required' : ''} ${f.ph ? `placeholder="${esc(f.ph)}"` : ''} step="any">`;
  return `<div class="${f.full || f.t === 'textarea' || f.t === 'json' ? 'full' : ''}"><label for="${id}">${esc(f.l || f.k)}${f.req ? ' <span style="color:var(--red)">*</span>' : ''}</label>${inp}${f.hint ? `<div class="small muted">${esc(f.hint)}</div>` : ''}<div class="ferr" data-err="${f.k}"></div></div>`; }).join('')}</div>`; }
function readForm(el) { const o = {}; $$('input,select,textarea', el).forEach(i => { if (!i.name) return; let v = i.type === 'checkbox' ? i.checked : i.value; if (i.type === 'number' && v !== '') v = Number(v); if (i.dataset.t === 'json' && v) { try { v = JSON.parse(v); } catch { toast('Invalid JSON in ' + i.name, 1); } } if (v === '' ) return; o[i.name] = v; }); return o; }
// table: cols [{k,l,f:(row)=>html}] ; actions (row)=>html
function table(rows, cols, actions) { if (!rows?.length) return `<div class="empty">Nothing here yet.</div>`; return `<div class="tablewrap"><table><thead><tr>${cols.map(c => `<th>${esc(c.l || c.k)}</th>`).join('')}${actions ? '<th></th>' : ''}</tr></thead><tbody>${rows.map(r => `<tr>${cols.map(c => `<td>${c.f ? c.f(r) : esc(r[c.k])}</td>`).join('')}${actions ? `<td class="right" style="white-space:nowrap">${actions(r)}</td>` : ''}</tr>`).join('')}</tbody></table></div>`; }
function pager(d, cb) { if (!d || d.pages <= 1) return ''; const id = 'pg' + Math.random().toString(36).slice(2); setTimeout(() => { const el = document.getElementById(id); if (el) el.onclick = e => { const p = e.target.dataset.p; if (p) cb(+p); }; }); return `<div class="row mt" id="${id}" style="justify-content:center">${d.page > 1 ? `<button class="pill" data-p="${d.page - 1}">‹ Prev</button>` : ''}<span class="muted small">Page ${d.page} of ${d.pages} · ${d.total} items</span>${d.page < d.pages ? `<button class="pill" data-p="${d.page + 1}">Next ›</button>` : ''}</div>`; }
// ---- charts (canvas) ----
// Fill a sparse [{day,total}] series into a continuous last-N-days series (zeros for missing days).
function daySeries(rows, days = 30) { const m = {}; (rows || []).forEach(r => { m[r.day || r.d] = +r.total || 0; }); const out = []; for (let i = days - 1; i >= 0; i--) { const d = new Date(Date.now() - i * 864e5); const k = new Date(d.getTime() - d.getTimezoneOffset() * 6e4).toISOString().slice(0, 10); out.push([k.slice(5), m[k] || 0]); } return out; }
function chart(canvas, type, labels, series, opts = {}) {
  const dpr = window.devicePixelRatio || 1; const W = canvas.clientWidth || 600, H = opts.h || 220; canvas.width = W * dpr; canvas.height = H * dpr; canvas.style.height = H + 'px';
  const c = canvas.getContext('2d'); c.scale(dpr, dpr); c.font = '11px system-ui'; const cs = getComputedStyle(document.documentElement), cv = (k, d) => (cs.getPropertyValue(k) || '').trim() || d; const ink = cv('--md-on-surface-variant', '#475569'), ink2 = cv('--md-on-surface', '#1F2937'), grid = cv('--md-outline-variant', '#E2E8F0'), surf = cv('--md-surface-container-lowest', '#ffffff'); const cols = [cv('--chart-1', '#123B65'), cv('--chart-2', '#F59E0B'), '#16A34A', '#5B7FA6', '#DC2626', '#0EA5E9'];
  labels = (labels || []).map(l => l == null || l === '' ? '—' : String(l)); series = (series || [[]]).map(a => (a || []).map(v => Number.isFinite(+v) ? +v : 0));
  if (!labels.length || !series.flat().some(v => v > 0)) { c.fillStyle = ink; c.fillText('No data yet', W / 2 - 30, H / 2); return; }
  if (type === 'donut') { const tot = series[0].reduce((a, b) => a + b, 0) || 1; let a0 = -Math.PI / 2; const r = Math.min(W * .3, H / 2 - 10), cx = r + 20, cy = H / 2;
    series[0].forEach((v, i) => { const a1 = a0 + v / tot * Math.PI * 2; c.beginPath(); c.moveTo(cx, cy); c.arc(cx, cy, r, a0, a1); c.fillStyle = cols[i % cols.length]; c.fill(); a0 = a1; });
    c.beginPath(); c.arc(cx, cy, r * .58, 0, 7); c.fillStyle = surf; c.fill();
    labels.forEach((l, i) => { const y = 20 + i * 18; if (y > H - 6) return; c.fillStyle = cols[i % cols.length]; c.fillRect(cx + r + 24, y - 9, 10, 10); c.fillStyle = ink2; c.fillText(`${String(l).replace(/_/g, ' ')} (${opts.money ? inr(series[0][i]) : series[0][i]})`, cx + r + 40, y); }); return; }
  const pl = 54, pb = 24, pt = 10, pr = 10; const max = Math.max(1, ...series.flat()) * 1.1; const n = labels.length; const cw = (W - pl - pr) / n;
  c.strokeStyle = grid; c.fillStyle = ink;
  for (let i = 0; i <= 4; i++) { const y = pt + (H - pt - pb) * i / 4; c.beginPath(); c.moveTo(pl, y); c.lineTo(W - pr, y); c.stroke(); const v = max * (1 - i / 4); c.fillText(v >= 1e5 ? (v / 1e5).toFixed(1) + 'L' : v >= 1e3 ? (v / 1e3).toFixed(0) + 'k' : v.toFixed(0), 4, y + 4); }
  const step = Math.ceil(n / Math.floor((W - pl) / 60)); labels.forEach((l, i) => { if (i % step === 0) c.fillText(String(l).slice(-5), pl + cw * i + cw / 2 - 14, H - 6); });
  series.forEach((s, si) => { c.strokeStyle = c.fillStyle = cols[si % cols.length];
    if (type === 'bar') { const bw = cw * .7 / series.length; s.forEach((v, i) => { const h = (H - pt - pb) * v / max; c.beginPath(); c.roundRect ? c.roundRect(pl + cw * i + cw * .15 + bw * si, H - pb - h, bw, h, 5) : c.rect(pl + cw * i + cw * .15 + bw * si, H - pb - h, bw, h); c.fill(); }); }
    else { const g = c.createLinearGradient(0, pt, 0, H - pb); g.addColorStop(0, cols[si % cols.length] + '40'); g.addColorStop(1, cols[si % cols.length] + '00'); c.beginPath(); s.forEach((v, i) => { const x = pl + cw * i + cw / 2, y = H - pb - (H - pt - pb) * v / max; i ? c.lineTo(x, y) : c.moveTo(x, y); }); c.lineWidth = 2.5; c.stroke(); s.forEach((v, i) => { const x = pl + cw * i + cw / 2, y = H - pb - (H - pt - pb) * v / max; c.beginPath(); c.arc(x, y, 3.5, 0, 7); c.fillStyle = cols[si % cols.length]; c.fill(); }); c.beginPath(); s.forEach((v, i) => { const x = pl + cw * i + cw / 2, y = H - pb - (H - pt - pb) * v / max; i ? c.lineTo(x, y) : c.moveTo(x, y); }); c.lineTo(pl + cw * (n - .5), H - pb); c.lineTo(pl + cw / 2, H - pb); c.fillStyle = g; c.fill(); } });
}
const img = (src, alt = '') => `<img src="${esc(src || '/img/seed/placeholder.svg')}" alt="${esc(alt)}" loading="lazy" decoding="async" onerror="this.src='/assets/brand/logo-rounded.png'">`;
const imgsOf = p => { try { return typeof p.images === 'string' ? JSON.parse(p.images) : (p.images || []); } catch { return []; } };
// Persistent panel shell: sidebar renders once per area/brand; navigation only swaps #pmain.
const NAVICON = { Overview: 'M3 13h8V3H3zm10 8h8V11h-8zM3 21h8v-6H3zm10-18v6h8V3z', Users: 'M16 11a4 4 0 1 0-4-4 4 4 0 0 0 4 4zM8 11a3 3 0 1 0-3-3 3 3 0 0 0 3 3zm8 2c-2.7 0-8 1.3-8 4v3h16v-3c0-2.7-5.3-4-8-4zM8 13c-.3 0-.7 0-1 .1C4.6 13.4 0 14.6 0 17v3h6v-3c0-1.5.8-2.8 2-3.8z', Catalog: 'M4 4h7v7H4zm9 0h7v7h-7zM4 13h7v7H4zm9 0h7v7h-7z', Commerce: 'M7 4h-2l-1 2H2v2h2l3.6 7.6L6.2 18A2 2 0 0 0 8 21h12v-2H8l1.1-2h7.4a2 2 0 0 0 1.8-1l3.6-6.5L20 8H6.2z', Sales: 'M7 4h-2l-1 2H2v2h2l3.6 7.6L6.2 18A2 2 0 0 0 8 21h12v-2H8l1.1-2h7.4a2 2 0 0 0 1.8-1l3.6-6.5L20 8H6.2z', Finance: 'M3 6h18v12H3zm9 3a3 3 0 1 0 3 3 3 3 0 0 0-3-3zM5 8v2a2 2 0 0 0 2-2zm12 0a2 2 0 0 0 2 2V8z', Money: 'M3 6h18v12H3zm9 3a3 3 0 1 0 3 3 3 3 0 0 0-3-3z', Invoices: 'M6 2h9l5 5v15H6zm8 1v5h5M9 12h8M9 16h8M9 8h3', Marketing: 'M3 10v4h4l5 4V6L7 10zm13.5 2A4.5 4.5 0 0 0 14 8v8a4.5 4.5 0 0 0 2.5-4z', Support: 'M12 2a10 10 0 1 0 10 10A10 10 0 0 0 12 2zm1 17h-2v-2h2zm2-7.3-.9.9A3.4 3.4 0 0 0 13 15h-2v-.5a4 4 0 0 1 1.2-2.8l1.2-1.3A2 2 0 1 0 10 9H8a4 4 0 1 1 7 2.7z', System: 'M19.4 13a7.6 7.6 0 0 0 0-2l2.1-1.6-2-3.5-2.5 1a7.3 7.3 0 0 0-1.7-1L15 3h-4l-.4 2.9a7.3 7.3 0 0 0-1.7 1l-2.5-1-2 3.5L6.6 11a7.6 7.6 0 0 0 0 2l-2.1 1.6 2 3.5 2.5-1a7.3 7.3 0 0 0 1.7 1L11 21h4l.4-2.9a7.3 7.3 0 0 0 1.7-1l2.5 1 2-3.5zM13 15.5A3.5 3.5 0 1 1 16.5 12 3.5 3.5 0 0 1 13 15.5z', Team: 'M16 11a4 4 0 1 0-4-4 4 4 0 0 0 4 4zm0 2c-2.7 0-8 1.3-8 4v3h16v-3c0-2.7-5.3-4-8-4z' };
const navIcon = g => `<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path fill="currentColor" d="${NAVICON[g] || NAVICON.Catalog}"/></svg>`;
function navActive() { const h = (location.hash || '#/').split('?')[0]; let best = null, bl = 0;
  $$('#sidenav a[data-nav]').forEach(a => { const href = a.getAttribute('href'); const m = h === href || (href !== '#/' && h.startsWith(href + '/')); if (m && href.length > bl) { best = a; bl = href.length; } });
  $$('#sidenav a.on').forEach(a => a !== best && a.classList.remove('on')); if (best) { best.classList.add('on'); const sn = $('#sidenav .navscroll'), r = best.getBoundingClientRect(), sr = sn.getBoundingClientRect(); if (r.top < sr.top || r.bottom > sr.bottom) best.scrollIntoView({ block: 'nearest' }); } }
// Mobile bottom navigation for panels (top sections + "More" opens the full drawer)
const PBOTTOM = { admin: [['#/', 'dashboard', 'Home'], ['#/orders', 'package', 'Orders'], ['#/products', 'tag', 'Products'], ['#/crm', 'users', 'CRM']], vendor: [['#/', 'dashboard', 'Home'], ['#/orders', 'package', 'Orders'], ['#/products', 'tag', 'Products'], ['#/wallet', 'wallet', 'Wallet']] };
function pbottom(key) { const a = area(); const items = PBOTTOM[a] || []; return `<nav class="bottomnav pbnav" id="pbnav" aria-label="Quick navigation">${items.map(([h, i, l]) => `<a href="${h}" data-bn="${h}">${ic(i)}<span>${l}</span></a>`).join('')}<a href="#" id="pbmore" data-bn="more">${ic('more')}<span>More</span></a></nav>`; }
function pbActive() { const h = (location.hash || '#/').split('?')[0]; const items = $$('#pbnav a[data-bn]'); let hit = false; items.forEach(a => { const on = a.dataset.bn !== 'more' && (h === a.dataset.bn || (a.dataset.bn !== '#/' && h.startsWith(a.dataset.bn + '/'))); a.classList.toggle('on', on); hit ||= on; }); const m = $('#pbmore'); if (m) m.classList.toggle('on', !hit); }
function pshell(nav, title, inner, brand) {
  const key = area() + ':' + brand; let root = $('#app > .panel');
  if (!root || root.dataset.key !== key) {
    $('#app').innerHTML = `<div class="panel" data-key="${esc(key)}">
      <aside class="sidenav" id="sidenav"><div class="sidebrand"><a class="logo" href="#/"><img src="/assets/brand/logo-rounded.png" alt=""><span><b>Mohan Mishra</b><small>${esc(brand)}</small></span></a><button class="iconbtn only-m" id="navclose" aria-label="Close menu">${ic('x', 20)}</button></div>
      <nav class="navscroll">${nav.map(([g, items]) => `<div class="navgroup"><h4>${navIcon(g)}<span>${esc(g)}</span></h4>${items.map(([href, l]) => `<a data-nav href="${href}">${esc(l)}</a>`).join('')}</div>`).join('')}</nav>
      <div class="sidefoot"><div class="me"><span class="avatar">${esc((S.user?.name || '?')[0])}</span><span><b>${esc(S.user?.name || '')}</b><small>${esc(S.user?.role || '')}</small></span></div><a href="#" id="mypw" class="btn ghost sm">Password</a><a href="#" id="logout" class="btn ghost sm">Log out</a></div></aside>
      <div class="navshade" id="navshade"></div>
      <div class="pmainwrap" id="pscroll"><header class="ptop"><button class="iconbtn only-m" id="navopen" aria-label="Open menu">${ic('menu', 20)}</button><div><div class="crumb" id="pcrumb"></div><h1 id="ptitle"></h1></div><div class="grow"></div><button class="iconbtn" data-theme-toggle aria-label="Toggle dark theme">${ic(themeGet() === 'dark' ? 'sun' : 'moon', 20)}</button><a class="pill hide-m" href="/" target="_blank">${ic('external', 18)} Storefront</a></header><main id="pmain" class="stack"></main></div>${pbottom(key)}</div>`;
    $('#mypw').onclick = e => { e.preventDefault(); changeMyPwDlg(); }; $('#logout').onclick = async e => { e.preventDefault(); await POST('/auth/logout').catch(() => { }); setAuth(null); location.hash = '#/'; route(); };
    const close = () => document.body.classList.remove('navopen');
    $('#navopen').onclick = () => document.body.classList.add('navopen'); $('#pbmore').onclick = e => { e.preventDefault(); document.body.classList.add('navopen'); }; $('#navclose').onclick = close; $('#navshade').onclick = close;
    $('#sidenav .navscroll').addEventListener('click', e => { if (e.target.closest('a')) close(); });
    const k = 'mm_navscroll_' + key; const ns = $('#sidenav .navscroll'); ns.scrollTop = +sessionStorage.getItem(k) || 0; ns.addEventListener('scroll', () => sessionStorage.setItem(k, ns.scrollTop), { passive: true });
  }
  $('#ptitle').textContent = title; const grp = nav.find(([, items]) => items.some(([h]) => (location.hash || '#/').split('?')[0] === h)); $('#pcrumb').textContent = (grp ? grp[0] + ' / ' : '') + brand;
  document.title = title + ' · ' + brand + ' · Mohan Mishra';
  $('#pmain').innerHTML = inner || `<div class="skeleton"></div><div class="skeleton short"></div>`; navActive(); pbActive();
}
// ---- router ----
const ROUTES = { customer: [], vendor: [], admin: [] };
function on(a, pattern, fn) { ROUTES[a].push([new RegExp('^' + pattern.replace(/:(\w+)/g, '([^/]+)') + '$'), fn]); }
async function route() {
  const h = (location.hash.slice(1) || '/').split('?')[0]; const q = Object.fromEntries(new URLSearchParams(location.hash.split('?')[1] || ''));
  const a = area(); const ps = $('#pscroll'); if (a !== 'customer' && ps) ps.scrollTop = 0; else window.scrollTo(0, 0);
  for (const [re, fn] of ROUTES[a]) { const m = h.match(re); if (m) { try { await fn(q, ...m.slice(1).map(decodeURIComponent)); } catch (e) { console.error(e); if (!e.status) toast(e.message, 1); } return; } }
  (ROUTES[a].find(r => r[0].test('/')) || ROUTES[a][0])[1](q);
}
function onFirst(a, pattern, fn) { ROUTES[a].unshift([new RegExp('^' + pattern.replace(/:(\w+)/g, '([^/]+)') + '$'), fn]); }
// Inline field errors from API {error:{details:[{field,message}] | {field:msg}}}
function showErrs(el, e) { $$('.ferr', el).forEach(x => x.textContent = ''); $$('.invalid', el).forEach(x => x.classList.remove('invalid')); const d = e?.data?.error?.details; const list = Array.isArray(d) ? d : d && typeof d === 'object' ? Object.entries(d).map(([field, message]) => ({ field, message })) : []; let first;
  list.forEach(({ field, message }) => { const k = String(field).split('.')[0]; const inp = $(`[name="${k}"]`, el) || $(`[data-field="${k}"]`, el); const fe = $(`[data-err="${k}"]`, el); if (inp) inp.classList.add('invalid'); if (fe) fe.textContent = (fe.textContent ? fe.textContent + '; ' : '') + message; first ||= inp || fe; });
  if (first) first.scrollIntoView({ block: 'center', behavior: 'smooth' }); return list.length; }
window.addEventListener('hashchange', route);
