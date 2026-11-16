// BlockNexa admin panel. Talks to /api/admin/* with your admin key (kept only for this browser tab).
(function () {
  const $ = (s, r = document) => r.querySelector(s);
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const f2 = n => Number(n).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const day = t => new Date(t).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
  const clock = t => new Date(t).toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit', second: '2-digit' });
  const TYPE = { buy: 'Buy', sell: 'Sell', withdraw: 'Withdraw' }, STAT = { success: 'Success', failed: 'Failed', pending: 'Pending' };
  let KEY = sessionStorage.getItem('bn_admin_key') || '', cur = null, view = { type: 'all', status: 'all' };

  const toast = (m, bad) => { const t = document.createElement('div'); t.className = 'toast' + (bad ? ' bad' : ''); t.textContent = m; document.body.appendChild(t); setTimeout(() => t.remove(), 2800); };
  async function api(path, o = {}) {
    const r = await fetch('/api/admin' + path, { method: o.method || 'GET', headers: { 'x-admin-key': KEY, ...(o.body ? { 'Content-Type': 'application/json' } : {}) }, body: o.body ? JSON.stringify(o.body) : undefined });
    if (o.raw && r.ok) return r;
    const d = await r.json().catch(() => ({}));
    if (r.status === 401) lock();
    if (!r.ok) throw new Error(d.error || 'Request failed');
    return d;
  }

  // Popup. Resolves null (cancelled) or { text, num }.
  function ask(o) {
    return new Promise(resolve => {
      const m = $('#mdl'), c = $('#mcard');
      c.innerHTML = `<h3>${esc(o.title)}</h3>${o.html || ''}
        ${o.num ? `<label class="mut" for="mn">${esc(o.num.label)}</label><input id="mn" type="number" step="0.01" min="0" value="${esc(o.num.value)}" style="margin-top:6px"><div id="prev" class="mut" style="margin:8px 0"></div>` : ''}
        ${o.chips ? `<div class="chips">${o.chips.map(t => `<button type="button" class="chip">${esc(t)}</button>`).join('')}</div>` : ''}
        ${o.text ? `<textarea id="mf" rows="2" maxlength="200" placeholder="${esc(o.text.placeholder || '')}"></textarea>` : ''}
        <p class="merr" id="merr"></p>
        <div class="mbtns"><button class="btn ghost" id="mno">Cancel</button><button class="btn ${o.danger ? 'danger' : ''}" id="myes">${esc(o.ok || 'Confirm')}</button></div>`;
      m.hidden = false;
      const done = v => { m.hidden = true; document.removeEventListener('keydown', key); resolve(v); };
      const key = e => { if (e.key === 'Escape') done(null); }; document.addEventListener('keydown', key);
      c.querySelectorAll('.chip').forEach(b => b.onclick = () => { $('#mf').value = b.textContent; $('#mf').focus(); });
      if (o.num) { const upd = () => { $('#prev').innerHTML = o.num.preview ? o.num.preview(+$('#mn').value) : ''; }; $('#mn').oninput = upd; upd(); }
      $('#mno').onclick = () => done(null);
      $('#myes').onclick = () => {
        const text = o.text ? $('#mf').value.trim() : '', num = o.num ? $('#mn').value : '';
        if (o.text && o.text.required && text.length < 3) return $('#merr').textContent = 'Write a short reason (at least 3 characters).';
        if (o.num && (num === '' || !(+num >= 0))) return $('#merr').textContent = 'Enter a valid number.';
        done({ text, num });
      };
      (o.num ? $('#mn') : o.text ? $('#mf') : $('#myes')).focus();
    });
  }

  // ---------- login ----------
  function lock() { KEY = ''; sessionStorage.removeItem('bn_admin_key'); $('#panel').hidden = true; $('#login').hidden = false; }
  async function enter() {
    KEY = $('#key').value.trim(); $('#lerr').textContent = '';
    try { await api('/ping'); sessionStorage.setItem('bn_admin_key', KEY); $('#login').hidden = true; $('#panel').hidden = false; $('#key').value = ''; $('#q').focus(); }
    catch (e) { KEY = ''; $('#lerr').textContent = e.message; }
  }

  // ---------- search ----------
  async function find(q) {
    if (!q) return;
    try {
      const r = await api('/find?q=' + encodeURIComponent(q));
      if (r.kind === 'user') return openUser(r.uid);
      if (r.kind === 'order') return showOrder(r.order);
      if (r.kind === 'users') return $('#main').innerHTML = `<div class="card"><b>${r.users.length} users match. Pick one:</b>${r.users.map(u => `<button class="row" data-uid="${esc(u.uid)}"><span class="t">${esc(u.uid)}</span><span class="m">${esc(u.email || u.phone || '')}</span></button>`).join('')}</div>`, bind();
      $('#main').innerHTML = '<p class="empty">Nothing found. Try a user ID like BN-123456, an order ID, a 12-digit UTR, a phone number or an email.</p>';
    } catch (e) { toast(e.message, true); }
  }
  async function openUser(uid) { try { cur = await api('/user/' + encodeURIComponent(uid)); view = { type: 'all', status: 'all' }; renderUser(); } catch (e) { toast(e.message, true); } }

  // ---------- user view ----------
  function renderUser() {
    const { user: u, history, adjustments, audit } = cur;
    const list = history.filter(o => (view.type === 'all' || o.kind === view.type) && (view.status === 'all' || o.status === view.status));
    const chip = (grp, v, l) => `<button class="chip ${view[grp] === v ? 'on' : ''}" data-f="${grp}:${v}">${l}</button>`;
    $('#main').innerHTML = `<div class="cols"><section>
      <div class="card head"><div><h2>${esc(u.uid)}</h2><small>${esc(u.email || u.phone || '')} · joined ${day(u.createdAt)}</small></div>${u.suspended ? '<span class="badge failed">Withdrawals suspended</span>' : '<span class="badge success">Active</span>'}</div>
      <div class="filters">${chip('type', 'all', 'All')}${chip('type', 'buy', 'Buy')}${chip('type', 'sell', 'Sell')}${chip('type', 'withdraw', 'Withdrawals')}<span style="width:12px"></span>${chip('status', 'all', 'Any status')}${chip('status', 'success', 'Success')}${chip('status', 'failed', 'Failed')}${chip('status', 'pending', 'Pending')}</div>
      <div>${list.length ? list.map(rowHtml).join('') : '<p class="empty">No orders match these filters.</p>'}</div></section>
      <aside>
        <div class="card"><span class="mut">Current balance</span><div class="big">${f2(u.balance)} <small>USDT</small></div><button class="btn block" id="eb" style="margin:0">Edit balance</button></div>
        <div class="card"><b>Withdrawals and sales</b>
          ${u.suspended ? `<p class="why" style="margin:8px 0">Suspended ${day(u.suspendedAt)} · ${esc(u.suspendReason)}</p><button class="btn ghost block" id="unsusp">Lift suspension</button>`
                        : `<p class="mut" style="margin:8px 0">Allowed. Suspend if you see unusual activity.</p><button class="btn danger block" id="susp">Suspend withdrawals</button>`}</div>
        <div class="card"><b>Recent changes</b>${[...audit.map(a => `<small style="display:block;margin-top:8px">${day(a.at)} ${clock(a.at)} · ${esc(a.action.replace(/_/g, ' '))}${a.details.reason ? ': ' + esc(a.details.reason) : ''}${a.details.change !== undefined ? ' (' + (a.details.change > 0 ? '+' : '') + f2(a.details.change) + ' USDT)' : ''}</small>`)].join('') || '<small style="display:block;margin-top:8px">No admin actions yet.</small>'}</div>
      </aside></div>`;
    bind();
  }
  const rowHtml = o => `<button class="row" data-oid="${esc(o.id)}"><span class="t ${o.kind}">${TYPE[o.kind]}</span><span class="m"><b>#${esc(o.id)} · ${f2(o.usdt)} USDT${o.inr ? ' · ₹' + f2(o.inr) : ''}</b><small>${day(o.at)} ${clock(o.at)}${o.reason ? ' · <span class="why">' + esc(o.reason) + '</span>' : ''}</small></span><span class="badge ${o.status}">${STAT[o.status]}</span></button>`;

  // ---------- order view ----------
  function showOrder(o) {
    const can = s => o.kind === 'buy' ? o.status !== s : o.status === 'pending';
    const kv = (k, v) => v === undefined || v === null || v === '' ? '' : `<div><span>${k}</span><b>${v}</b></div>`;
    $('#main').innerHTML = `<div style="max-width:620px;margin:0 auto"><div class="card"><div class="head"><h2>Order #${esc(o.id)}</h2><span class="badge ${o.status}">${STAT[o.status]}</span></div>
      <div class="kv">
        ${kv('Type', TYPE[o.kind])}${kv('Amount', (o.inr ? '₹' + f2(o.inr) + ' → ' : '') + f2(o.usdt) + ' USDT')}${kv('Rate', o.rate ? '₹' + o.rate + ' per USDT' : '')}
        ${kv('UTR', o.utr ? esc(o.utr) : o.kind === 'buy' ? 'Not submitted yet' : '')}${kv('Paid to UPI', esc(o.upi))}${kv('Wallet', esc(o.address))}${kv('Chain', esc(o.chain && o.chain.toUpperCase()))}${kv('Transaction hash', esc(o.txid))}
        ${kv('User ID', `<button class="link" data-uid="${esc(o.user.uid)}">${esc(o.user.uid)}</button>`)}${kv('User email', esc(o.user.email))}${kv('User phone', esc(o.user.phone))}
        ${kv('Date', day(o.at))}${kv('Time', clock(o.at))}${kv('Last update', day(o.updatedAt) + ' ' + clock(o.updatedAt))}${o.reason ? `<div><span>Failure reason</span><b class="why">${esc(o.reason)}</b></div>` : ''}
      </div>
      <div style="display:flex;gap:10px;margin-top:16px">${can('success') ? '<button class="btn" id="ok">Mark success</button>' : ''}${can('failed') ? '<button class="btn danger" id="bad">Mark failed</button>' : ''}</div>
      ${o.kind !== 'buy' && o.status !== 'pending' ? '<p class="mut" style="margin-top:12px">Finished sells and withdrawals are locked. Use Edit balance on the user to correct anything.</p>' : ''}</div></div>`;
    bind(o);
  }
  async function changeStatus(o, to) {
    let body = { status: to };
    if (to === 'success') {
      const html = o.kind === 'buy' ? `<p>Did <b>₹${f2(o.inr)}</b> arrive in your account${o.utr ? ' with UTR <b>' + esc(o.utr) + '</b>' : ' (the user gave no UTR)'}?</p><p class="mut">The user is credited ${f2(o.usdt)} USDT.</p>`
        : o.kind === 'sell' ? `<p>Confirm you paid <b>₹${f2(o.inr)}</b> to <b>${esc(o.upi)}</b>.</p>` : `<p>Confirm you sent <b>${f2(o.usdt)} USDT</b> to <b>${esc(o.address)}</b>. You can paste the transaction hash below (optional).</p>`;
      const r = await ask({ title: 'Mark as success', html, text: o.kind === 'withdraw' ? { placeholder: '0x… transaction hash (optional)' } : null, ok: 'Yes, mark success' });
      if (!r) return; if (r.text) body.txid = r.text;
    } else {
      const why = o.kind === 'buy' ? ['Payment not received', 'Wrong amount paid', 'Invalid UTR', 'Duplicate order'] : o.kind === 'sell' ? ['Invalid UPI ID', 'Payout failed', 'Please contact support'] : ['Invalid wallet address', 'Wrong network', 'Please contact support'];
      const r = await ask({ title: 'Mark as failed', html: `<p>The user sees this reason.${o.kind !== 'buy' ? ' The USDT returns to their balance.' : o.status === 'success' ? ' The credited USDT is taken back.' : ''}</p>`, chips: why, text: { placeholder: 'Reason shown to the user', required: true }, ok: 'Mark failed', danger: true });
      if (!r) return; body.reason = r.text;
    }
    try { const d = await api(`/orders/${o.id}/status`, { method: 'POST', body }); toast('Order updated'); if (cur) { const i = cur.history.findIndex(x => x.id === o.id); if (i >= 0) cur.history[i] = d.order; } showOrder(d.order); }
    catch (e) { toast(e.message, true); }
  }

  // ---------- user actions ----------
  async function editBalance() {
    const u = cur.user;
    const r = await ask({ title: 'Edit balance', html: `<p>Current balance: <b>${f2(u.balance)} USDT</b>. This adds a correction entry to the user's history, nothing is deleted.</p>`,
      num: { label: 'New balance (USDT)', value: u.balance, preview: v => (+v - u.balance === 0 ? 'No change' : `Change: <b style="color:var(--${v > u.balance ? 'success' : 'error'})">${v > u.balance ? '+' : ''}${f2(v - u.balance)} USDT</b>`) },
      chips: ['Correction after a loss', 'Duplicate credit removed', 'Manual compensation', 'Testing balance'], text: { placeholder: 'Reason (required)', required: true }, ok: 'Save balance' });
    if (!r) return;
    try { await api(`/user/${u.uid}/balance`, { method: 'POST', body: { newBalance: +r.num, expected: u.balance, reason: r.text } }); toast('Balance updated'); openUser(u.uid); }
    catch (e) { toast(e.message, true); }
  }
  async function suspend() {
    const r = await ask({ title: 'Suspend withdrawals', html: '<p>The user cannot withdraw or sell until you lift this. Pending requests stay pending.</p>', chips: ['Suspicious activity', 'Under review', 'Payment dispute'], text: { placeholder: 'Reason (required)', required: true }, ok: 'Suspend now', danger: true });
    if (!r) return;
    try { await api(`/user/${cur.user.uid}/suspend`, { method: 'POST', body: { reason: r.text } }); toast('Withdrawals suspended'); openUser(cur.user.uid); } catch (e) { toast(e.message, true); }
  }
  async function unsuspend() {
    const r = await ask({ title: 'Lift suspension', html: '<p>The user can withdraw and sell again.</p>', text: { placeholder: 'Note (optional)' }, ok: 'Lift suspension' });
    if (!r) return;
    try { await api(`/user/${cur.user.uid}/unsuspend`, { method: 'POST', body: { reason: r.text } }); toast('Suspension lifted'); openUser(cur.user.uid); } catch (e) { toast(e.message, true); }
  }

  // ---------- pending + log + backup ----------
  async function pending() {
    try {
      const list = await api('/pending');
      $('#main').innerHTML = `<h3 style="margin-bottom:6px">Pending (${list.length})</h3><small>Buys with a UTR are first. Click one to review it.</small>` + (list.length ? list.map(o => `<button class="row" data-pid="${esc(o.id)}"><span class="t ${o.kind}">${TYPE[o.kind]}</span><span class="m"><b>#${esc(o.id)} · ${f2(o.usdt)} USDT${o.inr ? ' · ₹' + f2(o.inr) : ''}</b><small>${esc(o.user.uid)} · ${day(o.at)} ${clock(o.at)}${o.kind === 'buy' ? (o.utr ? ' · UTR submitted' : ' · no UTR yet') : ''}</small></span><span class="badge pending">Pending</span></button>`).join('') : '<p class="empty">Nothing is waiting.</p>');
      window._pending = list; bind();
    } catch (e) { toast(e.message, true); }
  }
  async function auditLog() {
    try {
      const l = await api('/audit');
      $('#main').innerHTML = '<h3 style="margin-bottom:6px">Admin log</h3>' + (l.length ? l.map(a => `<div class="row" style="cursor:default"><span class="m"><b>${esc(a.action.replace(/_/g, ' '))}</b><small>${day(a.at)} ${clock(a.at)}${a.target ? ' · ' + esc(a.target) : ''}${a.details.reason ? ' · ' + esc(a.details.reason) : ''}${a.details.order ? ' · order #' + esc(a.details.order) : ''}</small></span></div>`).join('') : '<p class="empty">No actions yet.</p>');
    } catch (e) { toast(e.message, true); }
  }
  async function backup() {
    try { const r = await api('/backup', { raw: true }), a = document.createElement('a'); a.href = URL.createObjectURL(await r.blob()); a.download = 'blocknexa-backup.db'; document.body.appendChild(a); a.click(); a.remove(); toast('Backup downloaded'); }
    catch (e) { toast(e.message, true); }
  }

  // ---------- wiring ----------
  function bind(order) {
    const m = $('#main');
    m.querySelectorAll('[data-uid]').forEach(b => b.onclick = () => openUser(b.dataset.uid));
    m.querySelectorAll('[data-oid]').forEach(b => b.onclick = () => showOrder(cur.history.find(x => x.id === b.dataset.oid)));
    m.querySelectorAll('[data-pid]').forEach(b => b.onclick = () => showOrder(window._pending.find(x => x.id === b.dataset.pid)));
    m.querySelectorAll('[data-f]').forEach(b => b.onclick = () => { const [g, v] = b.dataset.f.split(':'); view[g] = v; renderUser(); });
    if ($('#eb', m)) $('#eb', m).onclick = editBalance; if ($('#susp', m)) $('#susp', m).onclick = suspend; if ($('#unsusp', m)) $('#unsusp', m).onclick = unsuspend;
    if (order) { if ($('#ok', m)) $('#ok', m).onclick = () => changeStatus(order, 'success'); if ($('#bad', m)) $('#bad', m).onclick = () => changeStatus(order, 'failed'); }
  }
  $('#enter').onclick = enter; $('#key').onkeydown = e => { if (e.key === 'Enter') enter(); };
  $('#sf').onsubmit = e => { e.preventDefault(); find($('#q').value.trim()); };
  $('#nPending').onclick = pending; $('#nAudit').onclick = auditLog; $('#nBackup').onclick = backup; $('#nLock').onclick = lock;
  if (KEY) api('/ping').then(() => { $('#login').hidden = true; $('#panel').hidden = false; }).catch(() => {});
})();
