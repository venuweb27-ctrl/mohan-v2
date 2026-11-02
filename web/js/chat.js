// In-app chat UI (customer, seller hub, admin): thread list, M3 chat bubbles, input bar, image attachments, short polling, unread badges, WhatsApp.
const CH = { poll: null, lastId: 0, badgeT: null };
const waNumber = () => (S.config?.whatsapp_number || '919522224488');
const waLink = text => `https://wa.me/${waNumber()}?text=${encodeURIComponent(text || 'Hi Mohan Mishra, I need help.')}`;
const waBtn = (text, label = 'Chat on WhatsApp', cls = '') => `<a class="btn wa ${cls}" href="${esc(waLink(text))}" target="_blank" rel="noopener" aria-label="${esc(label)}"><svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M12 2a10 10 0 0 0-8.6 15.1L2 22l5-1.3A10 10 0 1 0 12 2zm0 18.2a8.2 8.2 0 0 1-4.2-1.2l-.3-.2-3 .8.8-2.9-.2-.3A8.2 8.2 0 1 1 12 20.2zm4.5-6.1c-.2-.1-1.5-.7-1.7-.8s-.4-.1-.6.1-.7.8-.8 1-.3.2-.5.1a6.7 6.7 0 0 1-3.3-2.9c-.3-.4.3-.4.7-1.3a.5.5 0 0 0 0-.5l-.8-1.8c-.2-.5-.4-.4-.6-.4h-.5a1 1 0 0 0-.7.3 3 3 0 0 0-.9 2.2 5.1 5.1 0 0 0 1.1 2.7 11.6 11.6 0 0 0 4.5 3.9c1.6.7 2.3.8 3.1.6a2.7 2.7 0 0 0 1.8-1.2 2.2 2.2 0 0 0 .1-1.2c0-.1-.2-.2-.4-.3z"/></svg><span>${esc(label)}</span></a>`;
const chatBadge = () => `<em class="badge chatbadge" hidden></em>`;
async function chatBadges() {
  clearTimeout(CH.badgeT); if (!S.token || !S.user) return $$('.chatbadge').forEach(b => b.hidden = true);
  const u = await GET('/chat/unread', { quiet: 1, noLogout: 1 }).catch(() => null);
  if (u) $$('.chatbadge').forEach(b => { b.textContent = u.total > 99 ? '99+' : u.total; b.hidden = !u.total; });
  CH.badgeT = setTimeout(chatBadges, document.hidden ? 60000 : 30000);
}
window.addEventListener('hashchange', () => setTimeout(chatBadges, 400));
const chatShell = (title, inner, thread) => area() === 'admin' ? as(title, inner) : area() === 'vendor' ? vs(title, inner) : (shell(`<div class="chatpage">${inner}</div>`), document.body.classList.toggle('chatmode', !!thread));
const tAgo = s => { if (!s) return ''; const d = new Date(s.replace(' ', 'T') + 'Z'); const n = new Date(); return d.toDateString() === n.toDateString() ? d.toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' }) : d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' }); };
const tTime = s => new Date(s.replace(' ', 'T') + 'Z').toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' });
const tDay = s => { const d = new Date(s.replace(' ', 'T') + 'Z'); const n = new Date(); const y = new Date(Date.now() - 864e5); return d.toDateString() === n.toDateString() ? 'Today' : d.toDateString() === y.toDateString() ? 'Yesterday' : d.toLocaleDateString('en-IN', { dateStyle: 'medium' }); };

async function chatList(q) {
  const inPanel = area() !== 'customer'; if (!S.token) { if (inPanel) return go('#/'); return needLogin(); }
  const mod = ['admin', 'staff'].includes(S.user?.role); const f = { kind: q.kind || '', q: q.q || '' };
  const qs = new URLSearchParams(Object.fromEntries(Object.entries(f).filter(([, v]) => v))).toString();
  const d = await GET('/chat/threads' + (qs ? '?' + qs : ''));
  const head = `<div class="chathead-list"><div class="row between wrap" style="gap:8px">${inPanel ? '' : '<h1>Messages</h1>'}
    <div class="row wrap" style="gap:8px">${mod ? '' : `<button class="btn sm" id="newsupport">${ic('headset', 18)} Chat with support</button>${waBtn(`Hi Mohan Mishra, I need help (${S.user?.name || ''}).`, 'WhatsApp', 'sm')}`}</div></div>
    ${mod ? `<form class="row wrap chatfilter" id="cf" style="gap:8px"><select name="kind"><option value="">All threads</option><option value="support" ${f.kind === 'support' ? 'selected' : ''}>Support</option><option value="vendor" ${f.kind === 'vendor' ? 'selected' : ''}>Customer ↔ seller</option></select><input name="q" placeholder="Search name, product, order" value="${esc(f.q)}"><button class="btn sm">Filter</button></form>` : ''}</div>`;
  const rows = d.data.map(t => `<a class="chatrow ${t.unread ? 'unread' : ''}" href="#/chat/${t.id}" data-thread="${t.id}"><span class="avatar">${t.kind === 'support' ? ic('headset', 18) : esc((t.title || '?')[0])}</span>
    <span class="grow"><span class="row between"><b class="ellip">${esc(t.title)}</b><small class="muted">${tAgo(t.last_at)}</small></span>
    <span class="small muted ellip">${esc(t.context || '')}${t.status === 'closed' ? ' · closed' : ''}</span><span class="row between"><span class="small ellip">${esc(t.last_message || '')}</span>${t.unread ? `<em class="cbadge">${t.unread}</em>` : ''}</span></span></a>`).join('');
  chatShell('Messages', `${head}<div class="card chatlist">${rows || `<div class="empty"><p class="muted">No conversations yet.</p>${area() === 'customer' ? '<p class="small muted">Use “Chat with seller” on any product or order, or chat with our support team.</p>' : ''}</div>`}</div>`);
  if ($('#newsupport')) $('#newsupport').onclick = async () => { const t = await POST('/chat/threads', { kind: 'support' }); go('#/chat/' + t.id); };
  if ($('#cf')) $('#cf').onsubmit = e => { e.preventDefault(); const fd = new FormData(e.target); go('#/chats?' + new URLSearchParams([...fd].filter(([, v]) => v)).toString()); };
  chatBadges();
}
function bubble(m, t) {
  if (m.type === 'system') return `<div class="msys" data-mid="${m.id}"><span>${esc(m.body)} · ${tTime(m.created_at)}</span></div>`;
  const imgs = (m.attachments || []).map(a => `<a href="${esc(a.url)}" target="_blank" rel="noopener"><img src="${esc(a.url)}" alt="Image" loading="lazy"></a>`).join('');
  const who = !m.mine && (t.kind === 'support' || !t.is_party || ['admin', 'staff'].includes(m.sender_role)) ? `<span class="mwho">${esc(m.sender_name || '')}</span>` : '';
  const seen = m.mine && t.seen_upto >= m.id ? '<span class="seen" title="Seen">✓✓</span>' : m.mine ? '<span class="seen dim" title="Sent">✓</span>' : '';
  return `<div class="mrow ${m.mine ? 'me' : ''}" data-mid="${m.id}"><div class="bub ${m.deleted ? 'del' : ''}">${who}${m.deleted ? '<i>Message removed by moderator</i>' : `${imgs ? `<div class="mimgs">${imgs}</div>` : ''}${m.body ? `<div class="mtext">${esc(m.body)}</div>` : ''}`}
    <span class="mmeta">${tTime(m.created_at)} ${seen}${t.can_moderate && !m.deleted ? `<button class="mdel" data-del="${m.id}" aria-label="Remove message" title="Remove message">✕</button>` : ''}</span></div></div>`;
}
function renderMsgs(list, t, append) {
  const box = $('#msgs'); if (!box) return; let lastDay = append ? box.dataset.day : '';
  const html = list.map(m => { const d = tDay(m.created_at); const sep = d !== lastDay ? `<div class="mday"><span>${d}</span></div>` : ''; lastDay = d; return sep + bubble(m, t); }).join('');
  const nearBottom = box.scrollHeight - box.scrollTop - box.clientHeight < 120;
  if (append) box.insertAdjacentHTML('beforeend', html); else box.innerHTML = html || '<div class="empty small muted" style="padding:24px;text-align:center">Say hello 👋</div>';
  box.dataset.day = lastDay; if (list.length) CH.lastId = Math.max(CH.lastId, ...list.map(m => m.id));
  if (!append || nearBottom || list.some(m => m.mine)) box.scrollTop = box.scrollHeight;
}
async function chatThread(q, id) {
  if (!S.token) { if (area() === 'customer') needLogin(); else go('#/'); return; }
  clearInterval(CH.poll); CH.lastId = 0; let t = await GET('/chat/threads/' + id); CH.t = t;
  const ctxLink = t.product_id ? (area() === 'customer' ? `#/p/${t.product_id}` : '') : t.order_id ? `#/orders/${t.order_id}` : '';
  const actions = t.can_moderate ? `${!t.is_party && !t.joined ? '<button class="btn sm" id="cjoin">Join conversation</button>' : ''}<button class="btn ghost sm" id="cstat">${t.status === 'closed' ? 'Reopen' : 'Close'}</button>` : (t.kind === 'vendor' && area() === 'customer' ? waBtn(`Hi, about ${t.context || 'my enquiry'} (Mohan Mishra chat #${t.id})`, 'WhatsApp', 'sm') : '');
  chatShell(t.title, `<div class="chatwrap card"><div class="chathead"><a class="iconbtn" href="#/chats" aria-label="Back to messages">${ic('back', 20)}</a><span class="avatar">${t.kind === 'support' ? ic('headset', 18) : esc((t.title || '?')[0])}</span>
    <div class="grow" style="min-width:0"><b class="ellip">${esc(t.title)}</b><div class="small muted ellip">${ctxLink ? `<a href="${ctxLink}">${esc(t.context)}</a>` : esc(t.context || '')}${t.status === 'closed' ? ' · <span class="tag">closed</span>' : ''}</div></div><div class="row" style="gap:6px">${actions}</div></div>
    <div class="msgs" id="msgs" role="log" aria-live="polite"></div>
    ${t.can_post ? `<form class="chatbar" id="cbar"><input type="file" id="cfile" accept="image/*" hidden><button type="button" class="iconbtn" id="cattach" aria-label="Attach image" title="Attach image (max ${t.max_image_mb} MB)">${ic('image', 20)}</button>
      <div class="cprev" id="cprev" hidden></div><textarea id="cmsg" rows="1" maxlength="${t.max_len}" placeholder="Type a message" aria-label="Message"></textarea><button class="fab" id="csend" aria-label="Send">${ic('send', 20)}</button></form>` : `<div class="chatbar closed small muted">This conversation is closed.</div>`}</div>`, true);
  renderMsgs(t.messages, t); chatBadges();
  let att = [];
  const box = $('#msgs');
  box.onclick = async e => { const b = e.target.closest('[data-del]'); if (!b) return; if (!confirm('Remove this message for everyone?')) return; await DEL('/chat/messages/' + b.dataset.del); const row = box.querySelector(`[data-mid="${b.dataset.del}"] .bub`); if (row) { row.classList.add('del'); row.innerHTML = '<i>Message removed by moderator</i>'; } toast('Message removed'); };
  if ($('#cjoin')) $('#cjoin').onclick = async () => { await POST(`/chat/threads/${id}/join`); route(); };
  if ($('#cstat')) $('#cstat').onclick = async () => { await POST(`/chat/threads/${id}/status`, { status: t.status === 'closed' ? 'open' : 'closed' }); route(); };
  const ta = $('#cmsg'), form = $('#cbar');
  if (form) {
    const grow = () => { ta.style.height = 'auto'; ta.style.height = Math.min(ta.scrollHeight, 140) + 'px'; }; ta.oninput = grow;
    ta.onkeydown = e => { if (e.key === 'Enter' && !e.shiftKey && !matchMedia('(pointer:coarse)').matches) { e.preventDefault(); form.requestSubmit(); } };
    $('#cattach').onclick = () => $('#cfile').click();
    $('#cfile').onchange = async () => { const f = $('#cfile').files[0]; $('#cfile').value = ''; if (!f) return; if (!/^image\//.test(f.type)) return toast('Only images can be attached', 1); if (f.size > t.max_image_mb * 1048576) return toast(`Image too large (max ${t.max_image_mb} MB)`, 1);
      const fd = new FormData(); fd.append('files', f); const r = await api('POST', '/uploads', fd); att = [r.items[0].url]; const p = $('#cprev'); p.hidden = false; p.innerHTML = `<img src="${esc(att[0])}" alt=""><button type="button" aria-label="Remove image">✕</button>`; p.querySelector('button').onclick = () => { att = []; p.hidden = true; p.innerHTML = ''; }; };
    form.onsubmit = async e => { e.preventDefault(); const body = ta.value.trim(); if (!body && !att.length) return; $('#csend').disabled = true;
      try { const r = await POST(`/chat/threads/${id}/messages`, { body, attachments: att, after: CH.lastId }); ta.value = ''; grow(); att = []; $('#cprev').hidden = true; $('#cprev').innerHTML = ''; CH.t = { ...CH.t, seen_upto: r.seen_upto }; renderMsgs(r.messages, CH.t, true); } finally { $('#csend').disabled = false; ta.focus(); } };
  }
  const hash = location.hash;
  CH.poll = setInterval(async () => { if (location.hash !== hash) return clearInterval(CH.poll); if (document.hidden) return;
    const r = await GET(`/chat/threads/${id}?after=${CH.lastId}`, { quiet: 1, noLogout: 1 }).catch(() => null); if (!r) return;
    if (r.messages.length) renderMsgs(r.messages, { ...CH.t, seen_upto: r.seen_upto }, true);
    if (r.seen_upto !== CH.t.seen_upto) { CH.t.seen_upto = r.seen_upto; $$('#msgs .mrow.me').forEach(el => { const s = el.querySelector('.seen'); if (s && +el.dataset.mid <= r.seen_upto) { s.textContent = '✓✓'; s.classList.remove('dim'); } }); }
  }, S.config?.chat_poll_ms || 5000);
}
// Start a chat from product / order pages (customer)
async function chatWithSeller(opts) { if (needLogin()) return; if (S.user?.role !== 'customer') return toast('Sign in with a customer account to chat with sellers', 1); const t = await POST('/chat/threads', { kind: 'vendor', ...opts }); go('#/chat/' + t.id); }
for (const a of ['customer', 'vendor', 'admin']) { onFirst(a, '/chats', chatList); onFirst(a, '/chat/:id', chatThread); }
window.addEventListener('hashchange', () => { if (!/^#\/chat\//.test(location.hash)) { clearInterval(CH.poll); document.body.classList.remove('chatmode'); } });
setTimeout(chatBadges, 1500);
