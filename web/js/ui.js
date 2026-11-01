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
function ask(title, fields, submitText = 'Submit') { return new Promise(res => { modal(`<h3>${esc(title)}</h3>${formHtml(fields)}<div class="row mt" style="justify-content:flex-end"><button class="btn ghost" data-x>Cancel</button><button class="btn" data-ok>${esc(submitText)}</button></div>`, el => { $('[data-x]', el).onclick = () => { closeModal(); res(null); }; $('[data-ok]', el).onclick = () => { const v = readForm(el); closeModal(); res(v); }; }); }); }
const confirmBox = t => new Promise(res => modal(`<p>${esc(t)}</p><div class="row" style="justify-content:flex-end"><button class="btn ghost" data-x>No</button><button class="btn" data-ok>Yes</button></div>`, el => { $('[data-x]', el).onclick = () => { closeModal(); res(false); }; $('[data-ok]', el).onclick = () => { closeModal(); res(true); }; }));
// fields: [{k,l,t:'text|number|select|textarea|checkbox|date|password|json',o:[[v,l]],v,req,full}]
function formHtml(fields) { return `<div class="form">${fields.map(f => { const val = f.v ?? ''; const id = 'f_' + f.k; let inp;
  if (f.t === 'select') inp = `<select name="${f.k}" id="${id}">${(f.o || []).map(o => { const [v, l] = Array.isArray(o) ? o : [o, o]; return `<option value="${esc(v)}" ${String(v) === String(val) ? 'selected' : ''}>${esc(l)}</option>`; }).join('')}</select>`;
  else if (f.t === 'textarea' || f.t === 'json') inp = `<textarea name="${f.k}" id="${id}" rows="${f.rows || 3}" data-t="${f.t}">${esc(f.t === 'json' && typeof val !== 'string' ? JSON.stringify(val, null, 2) : val)}</textarea>`;
  else if (f.t === 'checkbox') inp = `<input type="checkbox" name="${f.k}" id="${id}" style="width:auto" ${val ? 'checked' : ''}>`;
  else inp = `<input name="${f.k}" id="${id}" type="${f.t || 'text'}" value="${esc(val)}" ${f.req ? 'required' : ''} ${f.ph ? `placeholder="${esc(f.ph)}"` : ''} step="any">`;
  return `<div class="${f.full || f.t === 'textarea' || f.t === 'json' ? 'full' : ''}"><label for="${id}">${esc(f.l || f.k)}</label>${inp}</div>`; }).join('')}</div>`; }
function readForm(el) { const o = {}; $$('input,select,textarea', el).forEach(i => { if (!i.name) return; let v = i.type === 'checkbox' ? i.checked : i.value; if (i.type === 'number' && v !== '') v = Number(v); if (i.dataset.t === 'json' && v) { try { v = JSON.parse(v); } catch { toast('Invalid JSON in ' + i.name, 1); } } if (v === '' ) return; o[i.name] = v; }); return o; }
// table: cols [{k,l,f:(row)=>html}] ; actions (row)=>html
function table(rows, cols, actions) { if (!rows?.length) return `<div class="empty">Nothing here yet.</div>`; return `<div class="tablewrap"><table><thead><tr>${cols.map(c => `<th>${esc(c.l || c.k)}</th>`).join('')}${actions ? '<th></th>' : ''}</tr></thead><tbody>${rows.map(r => `<tr>${cols.map(c => `<td>${c.f ? c.f(r) : esc(r[c.k])}</td>`).join('')}${actions ? `<td class="right" style="white-space:nowrap">${actions(r)}</td>` : ''}</tr>`).join('')}</tbody></table></div>`; }
function pager(d, cb) { if (!d || d.pages <= 1) return ''; const id = 'pg' + Math.random().toString(36).slice(2); setTimeout(() => { const el = document.getElementById(id); if (el) el.onclick = e => { const p = e.target.dataset.p; if (p) cb(+p); }; }); return `<div class="row mt" id="${id}" style="justify-content:center">${d.page > 1 ? `<button class="pill" data-p="${d.page - 1}">‹ Prev</button>` : ''}<span class="muted small">Page ${d.page} of ${d.pages} · ${d.total} items</span>${d.page < d.pages ? `<button class="pill" data-p="${d.page + 1}">Next ›</button>` : ''}</div>`; }
// ---- charts (canvas) ----
function chart(canvas, type, labels, series, opts = {}) {
  const dpr = window.devicePixelRatio || 1; const W = canvas.clientWidth || 600, H = opts.h || 220; canvas.width = W * dpr; canvas.height = H * dpr; canvas.style.height = H + 'px';
  const c = canvas.getContext('2d'); c.scale(dpr, dpr); c.font = '11px system-ui'; const cols = ['#6d7cff', '#ff9f7f', '#22c55e', '#b18cff', '#f5b301', '#38bdf8'];
  if (!labels.length) { c.fillStyle = '#6b7090'; c.fillText('No data yet', W / 2 - 30, H / 2); return; }
  if (type === 'donut') { const tot = series[0].reduce((a, b) => a + b, 0) || 1; let a0 = -Math.PI / 2; const r = Math.min(W * .3, H / 2 - 10), cx = r + 20, cy = H / 2;
    series[0].forEach((v, i) => { const a1 = a0 + v / tot * Math.PI * 2; c.beginPath(); c.moveTo(cx, cy); c.arc(cx, cy, r, a0, a1); c.fillStyle = cols[i % cols.length]; c.fill(); a0 = a1; });
    c.beginPath(); c.arc(cx, cy, r * .58, 0, 7); c.fillStyle = 'rgba(255,255,255,.9)'; c.fill();
    labels.forEach((l, i) => { const y = 20 + i * 18; if (y > H - 6) return; c.fillStyle = cols[i % cols.length]; c.fillRect(cx + r + 24, y - 9, 10, 10); c.fillStyle = '#1f2340'; c.fillText(`${l} (${opts.money ? inr(series[0][i]) : series[0][i]})`, cx + r + 40, y); }); return; }
  const pl = 54, pb = 24, pt = 10, pr = 10; const max = Math.max(1, ...series.flat()) * 1.1; const n = labels.length; const cw = (W - pl - pr) / n;
  c.strokeStyle = 'rgba(120,130,200,.18)'; c.fillStyle = '#6b7090';
  for (let i = 0; i <= 4; i++) { const y = pt + (H - pt - pb) * i / 4; c.beginPath(); c.moveTo(pl, y); c.lineTo(W - pr, y); c.stroke(); const v = max * (1 - i / 4); c.fillText(v >= 1e5 ? (v / 1e5).toFixed(1) + 'L' : v >= 1e3 ? (v / 1e3).toFixed(0) + 'k' : v.toFixed(0), 4, y + 4); }
  const step = Math.ceil(n / Math.floor((W - pl) / 60)); labels.forEach((l, i) => { if (i % step === 0) c.fillText(String(l).slice(-5), pl + cw * i + cw / 2 - 14, H - 6); });
  series.forEach((s, si) => { c.strokeStyle = c.fillStyle = cols[si % cols.length];
    if (type === 'bar') { const bw = cw * .7 / series.length; s.forEach((v, i) => { const h = (H - pt - pb) * v / max; c.beginPath(); c.roundRect ? c.roundRect(pl + cw * i + cw * .15 + bw * si, H - pb - h, bw, h, 5) : c.rect(pl + cw * i + cw * .15 + bw * si, H - pb - h, bw, h); c.fill(); }); }
    else { const g = c.createLinearGradient(0, pt, 0, H - pb); g.addColorStop(0, cols[si] + '55'); g.addColorStop(1, cols[si] + '00'); c.beginPath(); s.forEach((v, i) => { const x = pl + cw * i + cw / 2, y = H - pb - (H - pt - pb) * v / max; i ? c.lineTo(x, y) : c.moveTo(x, y); }); c.lineWidth = 2.5; c.stroke(); c.lineTo(pl + cw * (n - .5), H - pb); c.lineTo(pl + cw / 2, H - pb); c.fillStyle = g; c.fill(); } });
}
const img = (src, alt = '') => `<img src="${esc(src || '/img/seed/placeholder.svg')}" alt="${esc(alt)}" loading="lazy" onerror="this.src='/img/logo.svg'">`;
const imgsOf = p => { try { return typeof p.images === 'string' ? JSON.parse(p.images) : (p.images || []); } catch { return []; } };
// ---- router ----
const ROUTES = { customer: [], vendor: [], admin: [] };
function on(a, pattern, fn) { ROUTES[a].push([new RegExp('^' + pattern.replace(/:(\w+)/g, '([^/]+)') + '$'), fn]); }
async function route() {
  const h = (location.hash.slice(1) || '/').split('?')[0]; const q = Object.fromEntries(new URLSearchParams(location.hash.split('?')[1] || ''));
  const a = area(); window.scrollTo(0, 0);
  for (const [re, fn] of ROUTES[a]) { const m = h.match(re); if (m) { try { await fn(q, ...m.slice(1).map(decodeURIComponent)); } catch (e) { console.error(e); if (!e.status) toast(e.message, 1); } return; } }
  ROUTES[a][0][1](q);
}
window.addEventListener('hashchange', route);
