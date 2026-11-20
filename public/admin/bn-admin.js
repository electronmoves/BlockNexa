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
        <div class="card"><b>Change password</b>
          <p class="mut" style="margin:8px 0">Set a new login password for this user (8+ characters). Logs them out everywhere.</p>
          <input id="newPw" type="text" minlength="8" maxlength="128" placeholder="New password (8+ characters)" autocomplete="off">
          <button class="btn block" id="setPw">Change password</button></div>
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
      const html = o.kind === 'buy' ? `<p>Did <b>₹${f2(o.inr)}</b> arrive on UPI <b>${esc(o.upi || '—')}</b>${o.utr ? ' with UTR <b>' + esc(o.utr) + '</b>' : ' (the user gave no UTR)'}?</p><p class="mut">The user is credited ${f2(o.usdt)} USDT and ₹${f2(o.inr)} is added to <b>${esc(o.upi || '—')}</b>'s Transaction log.</p>`
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
  async function resetPassword() {
    const pw = ($('#newPw') ? $('#newPw').value : '').trim();
    if (pw.length < 8 || pw.length > 128) return toast('Enter a password with 8 to 128 characters.', true);
    const r = await ask({ title: 'Change user password', html: `<p>Set a new password for <b>${esc(cur.user.uid)}</b>? Their active sessions will be logged out.</p>`, ok: 'Change password' });
    if (!r) return;
    try { await api(`/user/${cur.user.uid}/password`, { method: 'POST', body: { password: pw } }); toast('Password updated'); openUser(cur.user.uid); }
    catch (e) { toast(e.message, true); }
  }

  // ---------- pending + log + backup ----------
  async function pending() {
    try {
      const list = await api('/pending');
      $('#main').innerHTML = `<h3 style="margin-bottom:6px">Pending (${list.length})</h3><small>Buys with a UTR are first. Click one to review it.</small>` + (list.length ? list.map(o => `<button class="row" data-pid="${esc(o.id)}"><span class="t ${o.kind}">${TYPE[o.kind]}</span><span class="m"><b>#${esc(o.id)} · ${f2(o.usdt)} USDT${o.inr ? ' · ₹' + f2(o.inr) : ''}</b><small>${esc(o.user.uid)} · ${day(o.at)} ${clock(o.at)}${o.upi ? ' · UPI: <b>' + esc(o.upi) + '</b>' : ''}${o.kind === 'buy' ? (o.utr ? ' · UTR submitted' : ' · no UTR yet') : ''}</small></span><span class="badge pending">Pending</span></button>`).join('') : '<p class="empty">Nothing is waiting.</p>');
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
    if ($('#eb', m)) $('#eb', m).onclick = editBalance; if ($('#susp', m)) $('#susp', m).onclick = suspend; if ($('#unsusp', m)) $('#unsusp', m).onclick = unsuspend; if ($('#setPw', m)) $('#setPw', m).onclick = resetPassword;
    if (order) { if ($('#ok', m)) $('#ok', m).onclick = () => changeStatus(order, 'success'); if ($('#bad', m)) $('#bad', m).onclick = () => changeStatus(order, 'failed'); }
  }
  // ---------- userbase ----------
  // The search box and frame are drawn once; typing only redraws the table, so the box keeps focus.
  let ubPage = 0, ubQ = '', ubSeq = 0, ubTimer = null;
  function userbase(page) {
    ubPage = 0; ubQ = '';
    $('#main').innerHTML = `
      <div class="card ub">
        <div class="head"><div><h2>Userbase</h2><small id="ubCount">Loading…</small></div></div>
        <label class="ub-search">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M11 18a7 7 0 100-14 7 7 0 000 14zM20 20l-4-4"/></svg>
          <input id="ubQ" type="search" placeholder="Search by user ID, phone or email" autocomplete="off" spellcheck="false" aria-label="Search users">
          <kbd id="ubClear" hidden>Esc</kbd>
        </label>
        <div class="ub-wrap"><table class="ub-table">
          <thead><tr><th>User ID</th><th>Email / Phone</th><th>Joined</th><th>Status</th><th>Action</th></tr></thead>
          <tbody id="ubBody"></tbody></table></div>
        <div class="ub-pages" id="ubPages"></div>
      </div>`;
    const box = $('#ubQ');
    box.oninput = () => { clearTimeout(ubTimer); $('#ubClear').hidden = !box.value; ubTimer = setTimeout(() => loadUsers(0, box.value.trim()), 250); };
    box.onkeydown = e => {
      if (e.key === 'Enter') { clearTimeout(ubTimer); loadUsers(0, box.value.trim()); }
      if (e.key === 'Escape' && box.value) { e.stopPropagation(); box.value = ''; box.oninput(); }
    };
    $('#ubClear').onclick = () => { box.value = ''; box.oninput(); box.focus(); };
    box.focus();
    return loadUsers(page || 0, '');
  }
  const mark = (s, q) => { const t = esc(s); if (!q) return t; const i = String(s).toLowerCase().indexOf(q.toLowerCase()); return i < 0 ? t : esc(String(s).slice(0, i)) + '<mark>' + esc(String(s).slice(i, i + q.length)) + '</mark>' + esc(String(s).slice(i + q.length)); };
  async function loadUsers(page, q) {
    const seq = ++ubSeq; ubPage = page; ubQ = q;
    const body = $('#ubBody'); if (!body) return;
    body.classList.add('busy');
    try {
      const d = await api('/users?page=' + page + '&q=' + encodeURIComponent(q));
      if (seq !== ubSeq || !$('#ubBody')) return;                     // an older, slower answer: ignore it
      const totalPages = Math.max(1, Math.ceil(d.total / 50));
      body.innerHTML = d.users.map((u, i) => `
        <tr style="--i:${Math.min(i, 12)}">
          <td><button class="uid-link" data-uid="${esc(u.uid)}">${mark(u.uid, q)}</button></td>
          <td>${u.email || u.phone ? mark(u.email || u.phone, q) : '—'}</td>
          <td>${day(u.createdAt)}</td>
          <td>${u.deactivated
            ? `<span class="deact-badge">Deactivated</span>${u.deactivateReason ? '<small class="ub-why">' + esc(u.deactivateReason) + '</small>' : ''}`
            : '<span class="active-badge">Active</span>'}</td>
          <td>${u.deactivated
            ? `<button class="btn ghost ub-act" data-reactivate="${esc(u.uid)}">Reactivate</button>`
            : `<button class="btn danger ub-act" data-deactivate="${esc(u.uid)}">Deactivate</button>`}</td>
        </tr>`).join('') || `<tr><td colspan="5" class="empty">${q ? 'No users match “' + esc(q) + '”.' : 'No users yet.'}</td></tr>`;
      $('#ubCount').textContent = q ? `${d.total} match${d.total === 1 ? '' : 'es'} for “${q}”` : `${d.total} total users`;
      $('#ubPages').innerHTML = totalPages > 1 ? `
        <button class="btn ghost" id="ubPrev" ${page > 0 ? '' : 'disabled'}>← Prev</button>
        <span>Page ${page + 1} of ${totalPages}</span>
        <button class="btn ghost" id="ubNext" ${page + 1 < totalPages ? '' : 'disabled'}>Next →</button>` : '';
      bindUserbase();
    } catch (e) { toast(e.message, true); }
    finally { if (seq === ubSeq && body) body.classList.remove('busy'); }
  }
  function bindUserbase() {
    const m = $('#main');
    m.querySelectorAll('[data-uid]').forEach(b => b.onclick = () => openUser(b.dataset.uid));
    if ($('#ubPrev', m)) $('#ubPrev', m).onclick = () => loadUsers(ubPage - 1, ubQ);
    if ($('#ubNext', m)) $('#ubNext', m).onclick = () => loadUsers(ubPage + 1, ubQ);
    m.querySelectorAll('[data-deactivate]').forEach(b => b.onclick = async () => {
      const uid = b.dataset.deactivate;
      const r = await ask({
        title: 'Deactivate account',
        html: `<p>Deactivating <b>${esc(uid)}</b> logs this user out everywhere and blocks every way of logging in. You can reactivate them anytime.</p>`,
        chips: ['Suspicious activity', 'Fraud detected', 'Policy violation', 'User request', 'Duplicate account'],
        text: { placeholder: 'Reason for deactivation (required, the user sees it)', required: true },
        ok: 'Deactivate account',
        danger: true
      });
      if (!r) return;
      try { await api(`/user/${encodeURIComponent(uid)}/deactivate`, { method: 'POST', body: { reason: r.text } }); toast('Account deactivated'); loadUsers(ubPage, ubQ); }
      catch (e) { toast(e.message, true); }
    });
    m.querySelectorAll('[data-reactivate]').forEach(b => b.onclick = async () => {
      const uid = b.dataset.reactivate;
      const r = await ask({
        title: 'Reactivate account',
        html: `<p>Reactivating <b>${esc(uid)}</b> will allow this user to log in again.</p>`,
        text: { placeholder: 'Note (optional)' },
        ok: 'Reactivate'
      });
      if (!r) return;
      try { await api(`/user/${encodeURIComponent(uid)}/reactivate`, { method: 'POST', body: { reason: r.text } }); toast('Account reactivated'); loadUsers(ubPage, ubQ); }
      catch (e) { toast(e.message, true); }
    });
  }

  // ---------- transaction log (UPI randomness & collection control) ----------
  async function txLog() {
    try {
      const d = await api('/upis');
      const activeCount = d.upis.filter(u => u.active).length;
      const cards = d.upis.map((u, i) => `
        <div class="upi-card ${u.active ? '' : 'off'}" style="--i:${Math.min(i, 12)}">
          <div class="upi-top">
            <span class="upi-id">${esc(u.upi)}</span>
            ${u.active ? '<span class="active-badge">Active in rotation</span>' : '<span class="deact-badge">Paused</span>'}
          </div>
          <div>
            <small class="mut">Total collected</small>
            <div class="upi-tot">₹${f2(u.totalCollected)}<small>${u.count} payment${u.count === 1 ? '' : 's'} · ${f2(u.totalUsdt)} USDT</small></div>
          </div>
          <div class="upi-meta">
            <div><span>UPI name</span><b>${esc(u.upi)}</b></div>
            <div><span>Total collected</span><b>₹${f2(u.totalCollected)} (${u.count} success${u.pendingCount ? ' · ' + u.pendingCount + ' pending' : ''})</b></div>
            <div><span>Activation date</span><b>${day(u.createdAt)} · ${clock(u.createdAt)}</b></div>
            <div><span>Last payment</span><b>${u.lastAt ? day(u.lastAt) + ' · ' + clock(u.lastAt) : 'No payments yet'}</b></div>
          </div>
          <div class="upi-btns">
            <button class="btn" data-upi-logs="${esc(u.upi)}">See all logs (${u.count})</button>
            <button class="btn ghost sm" data-upi-only="${esc(u.upi)}" title="Pause all other UPIs and use only this one">Use only</button>
            <button class="btn ghost sm" data-upi-toggle="${esc(u.upi)}">${u.active ? 'Pause' : 'Activate'}</button>
            <button class="btn ghost sm" data-upi-del="${esc(u.upi)}" aria-label="Remove UPI">Remove</button>
          </div>
        </div>`).join('');
      $('#main').innerHTML = `
        <div class="card">
          <div class="head">
            <div>
              <h2>Transaction log · UPI Randomness Control</h2>
              <small>${activeCount} active UPI${activeCount === 1 ? '' : 's'} in random rotation · ₹${f2(d.totalCollected)} total collected across ${d.totalCount} successful buy payment${d.totalCount === 1 ? '' : 's'}</small>
            </div>
            <button class="btn ghost" id="allUpiLogs">See all logs (${d.totalCount})</button>
          </div>
          <form class="upi-add" id="upiAddForm">
            <input id="newUpi" placeholder="Add a UPI ID to random rotation (e.g. merchant@upi)" autocomplete="off" spellcheck="false" aria-label="New UPI ID">
            <button class="btn" type="submit">+ Add UPI ID</button>
          </form>
          <div class="upi-grid">${cards || '<p class="empty">No UPI IDs configured yet. Add one above.</p>'}</div>
        </div>`;
      bindTxLog();
    } catch (e) { toast(e.message, true); }
  }
  async function showUpiLogs(upi) {
    try {
      const d = await api('/upis/logs' + (upi ? '?upi=' + encodeURIComponent(upi) : ''));
      window._upiLogs = d.logs;
      const sum = d.summary;
      const rows = d.logs.map((o, i) => `
        <tr style="--i:${Math.min(i, 12)}">
          <td><button class="uid-link" data-ul-oid="${esc(o.id)}">#${esc(o.id)}</button></td>
          <td><button class="uid-link" data-uid="${esc(o.user.uid)}">${esc(o.user.uid)}</button><small style="display:block">${esc(o.user.email || o.user.phone || '')}</small></td>
          <td><b>${esc(o.upi || '—')}</b></td>
          <td><b style="color:var(--success)">₹${f2(o.inr)}</b><small style="display:block">${f2(o.usdt)} USDT @ ₹${o.rate}</small></td>
          <td><span style="font-family:ui-monospace,Consolas,monospace">${esc(o.utr || '—')}</span></td>
          <td>${day(o.updatedAt)}<small style="display:block">${clock(o.updatedAt)}</small></td>
          <td><span class="badge success">Success</span></td>
        </tr>`).join('');
      $('#main').innerHTML = `
        <div class="card">
          <div class="head">
            <div>
              <h2>${upi ? 'UPI Logs · ' + esc(upi) : 'All Successful UPI Payments'}</h2>
              <small>${sum
                ? `UPI name: ${esc(sum.upi)} · Total collected: ₹${f2(sum.totalCollected)} (${sum.count} payment${sum.count === 1 ? '' : 's'}) · Activation date: ${day(sum.createdAt)}`
                : `${d.logs.length} successful payment${d.logs.length === 1 ? '' : 's'}`}</small>
            </div>
            <button class="btn ghost" id="backTxLog">← Back to UPI control</button>
          </div>
          <div class="ub-wrap">
            <table class="ub-table">
              <thead><tr><th>Order ID</th><th>User</th><th>UPI ID</th><th>Amount Paid</th><th>UTR</th><th>Paid At</th><th>Status</th></tr></thead>
              <tbody>${rows || '<tr><td colspan="7" class="empty">No successful payments recorded for this UPI yet.</td></tr>'}</tbody>
            </table>
          </div>
        </div>`;
      const m = $('#main');
      $('#backTxLog', m).onclick = txLog;
      m.querySelectorAll('[data-uid]').forEach(b => b.onclick = () => openUser(b.dataset.uid));
      m.querySelectorAll('[data-ul-oid]').forEach(b => b.onclick = () => showOrder(window._upiLogs.find(x => x.id === b.dataset.ulOid)));
    } catch (e) { toast(e.message, true); }
  }
  function bindTxLog() {
    const m = $('#main');
    if ($('#allUpiLogs', m)) $('#allUpiLogs', m).onclick = () => showUpiLogs('');
    if ($('#upiAddForm', m)) $('#upiAddForm', m).onsubmit = async e => {
      e.preventDefault();
      const v = $('#newUpi', m).value.trim();
      if (!v) return;
      try { await api('/upis', { method: 'POST', body: { upi: v } }); toast('UPI ID added to rotation'); txLog(); }
      catch (err) { toast(err.message, true); }
    };
    m.querySelectorAll('[data-upi-logs]').forEach(b => b.onclick = () => showUpiLogs(b.dataset.upiLogs));
    m.querySelectorAll('[data-upi-only]').forEach(b => b.onclick = async () => {
      try { await api('/upis/only', { method: 'POST', body: { upi: b.dataset.upiOnly } }); toast('Now using only ' + b.dataset.upiOnly); txLog(); }
      catch (err) { toast(err.message, true); }
    });
    m.querySelectorAll('[data-upi-toggle]').forEach(b => b.onclick = async () => {
      try { const r = await api('/upis/toggle', { method: 'POST', body: { upi: b.dataset.upiToggle } }); toast(r.active ? 'UPI activated in rotation' : 'UPI paused'); txLog(); }
      catch (err) { toast(err.message, true); }
    });
    m.querySelectorAll('[data-upi-del]').forEach(b => b.onclick = async () => {
      const u = b.dataset.upiDel;
      const r = await ask({ title: 'Remove UPI ID', html: `<p>Remove <b>${esc(u)}</b> from the rotation pool? Past transaction logs for this UPI will remain intact.</p>`, ok: 'Remove', danger: true });
      if (!r) return;
      try { await api('/upis/delete', { method: 'POST', body: { upi: u } }); toast('UPI removed'); txLog(); }
      catch (err) { toast(err.message, true); }
    });
  }

  // ---------- push notifications ----------
  async function pushNotifs() {
    try {
      const list = await api('/notifications');
      const items = list.map(n => `
        <div class="row" style="cursor:default">
          <span class="t ${n.target === 'ALL' ? 'buy' : 'sell'}">${n.target === 'ALL' ? 'All users' : esc(n.target)}</span>
          <span class="m"><b>${esc(n.title)}</b><small>${esc(n.message)}</small><small>${day(n.at)} ${clock(n.at)}</small></span>
          <button class="btn ghost ub-act" data-del-notif="${n.id}">Delete</button>
        </div>`).join('');
      $('#main').innerHTML = `
        <div class="cols">
          <section>
            <div class="card">
              <div class="head"><h2>Push Notification</h2><small>Send an announcement to everyone or a specific user ID</small></div>
              <form id="nf" style="display:grid;gap:12px;margin-top:14px">
                <div><label class="mut" for="nTarget">Send to</label>
                  <select id="nTarget" style="margin-top:6px"><option value="all">All users (broadcast)</option><option value="user">Specific user ID</option></select></div>
                <div id="nUidWrap" hidden><label class="mut" for="nUid">User ID</label>
                  <input id="nUid" placeholder="e.g. BN-123456" autocomplete="off" style="margin-top:6px"></div>
                <div><label class="mut" for="nTitle">Title</label>
                  <input id="nTitle" maxlength="80" placeholder="Announcement title" style="margin-top:6px"></div>
                <div><label class="mut" for="nMsg">Message</label>
                  <textarea id="nMsg" rows="3" maxlength="500" placeholder="Write the announcement for users…" style="margin-top:6px"></textarea></div>
                <button class="btn" type="submit">Send notification</button>
              </form>
            </div>
          </section>
          <aside>
            <div class="card"><b>Sent notifications (${list.length})</b>
              <div style="margin-top:8px">${items || '<p class="empty">No notifications pushed yet.</p>'}</div>
            </div>
          </aside>
        </div>`;
      const m = $('#main');
      $('#nTarget', m).onchange = e => { $('#nUidWrap', m).hidden = e.target.value !== 'user'; };
      $('#nf', m).onsubmit = async e => {
        e.preventDefault();
        const target = $('#nTarget', m).value, uid = $('#nUid', m).value.trim(), title = $('#nTitle', m).value.trim(), message = $('#nMsg', m).value.trim();
        try { await api('/notifications', { method: 'POST', body: { target, uid, title, message } }); toast('Notification pushed'); pushNotifs(); }
        catch (err) { toast(err.message, true); }
      };
      m.querySelectorAll('[data-del-notif]').forEach(b => b.onclick = async () => {
        try { await api(`/notifications/${b.dataset.delNotif}/delete`, { method: 'POST' }); toast('Notification removed'); pushNotifs(); }
        catch (err) { toast(err.message, true); }
      });
    } catch (e) { toast(e.message, true); }
  }

  $('#enter').onclick = enter; $('#key').onkeydown = e => { if (e.key === 'Enter') enter(); };
  $('#sf').onsubmit = e => { e.preventDefault(); find($('#q').value.trim()); };
  $('#nPending').onclick = pending; $('#nUsers').onclick = () => userbase(0); $('#nTxLog').onclick = txLog; $('#nNotifs').onclick = pushNotifs; $('#nAudit').onclick = auditLog; $('#nBackup').onclick = backup; $('#nLock').onclick = lock;
  if (KEY) api('/ping').then(() => { $('#login').hidden = true; $('#panel').hidden = false; }).catch(() => {});
})();
