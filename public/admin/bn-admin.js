// BlockNexa admin panel. Talks to /api/admin/* with your admin key (kept only for this browser tab).
(function () {
  const $ = (s, r = document) => r.querySelector(s);
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const f2 = n => Number(n).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const day = t => new Date(t).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
  const clock = t => new Date(t).toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit', second: '2-digit' });
  const TYPE = { buy: 'Buy', sell: 'Sell', withdraw: 'Withdraw' }, STAT = { success: 'Success', failed: 'Failed', pending: 'Pending' };
  let KEY = sessionStorage.getItem('bn_admin_key') || '', cur = null, view = { type: 'all', status: 'all' };
  let panelMode = '', openOrderId = '', adminEs = null;

  const toast = (m, bad) => { const t = document.createElement('div'); t.className = 'toast' + (bad ? ' bad' : ''); t.textContent = m; document.body.appendChild(t); setTimeout(() => t.remove(), 2800); };
  async function api(path, o = {}) {
    const r = await fetch('/api/admin' + path, { method: o.method || 'GET', cache: 'no-store', headers: { 'x-admin-key': KEY, ...(o.body ? { 'Content-Type': 'application/json' } : {}) }, body: o.body ? JSON.stringify(o.body) : undefined });
    if (o.raw && r.ok) return r;
    const d = await r.json().catch(() => ({}));
    if (r.status === 401 || (r.status === 403 && !o.body)) lock();
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
        ${o.secret ? `<label class="mut" for="ms" style="display:block;margin-top:10px">${esc(o.secret.label || 'Admin key')}</label><input id="ms" type="password" autocomplete="off" placeholder="${esc(o.secret.placeholder || 'Enter admin key')}" style="margin-top:6px">` : ''}
        <p class="merr" id="merr"></p>
        <div class="mbtns"><button class="btn ghost" id="mno">Cancel</button><button class="btn ${o.danger ? 'danger' : ''}" id="myes">${esc(o.ok || 'Confirm')}</button></div>`;
      m.hidden = false;
      const done = v => { m.hidden = true; document.removeEventListener('keydown', key); resolve(v); };
      const key = e => { if (e.key === 'Escape') done(null); }; document.addEventListener('keydown', key);
      c.querySelectorAll('.chip').forEach(b => b.onclick = () => {
        if (o.num && !o.text) { $('#mn').value = parseInt(b.textContent, 10); $('#mn').dispatchEvent(new Event('input')); $('#mn').focus(); }
        else { $('#mf').value = b.textContent; $('#mf').focus(); }
      });
      if (o.num) { const upd = () => { $('#prev').innerHTML = o.num.preview ? o.num.preview(+$('#mn').value) : ''; }; $('#mn').oninput = upd; upd(); }
      if (o.secret) $('#ms').onkeydown = e => { if (e.key === 'Enter') $('#myes').click(); };
      $('#mno').onclick = () => done(null);
      $('#myes').onclick = () => {
        const text = o.text ? $('#mf').value.trim() : '', num = o.num ? $('#mn').value : '', secret = o.secret ? $('#ms').value.trim() : '';
        if (o.text && o.text.required && text.length < 3) return $('#merr').textContent = 'Write a short reason (at least 3 characters).';
        if (o.num && (num === '' || !(+num >= 0))) return $('#merr').textContent = 'Enter a valid number.';
        if (o.secret && !secret) return $('#merr').textContent = 'Enter your admin key to confirm.';
        done({ text, num, secret });
      };
      (o.num ? $('#mn') : o.text ? $('#mf') : o.secret ? $('#ms') : $('#myes')).focus();
    });
  }

  // ---------- login ----------
  let buySellOn = true, activeUpis = [];
  function paintTradeBtn(on) {
    buySellOn = !!on;
    const b = $('#nTrade'); if (!b) return;
    b.textContent = 'Buy & Sell: ' + (buySellOn ? 'ON' : 'OFF');
    b.className = 'btn ' + (buySellOn ? '' : 'danger');
  }
  async function loadSettings() {
    try {
      const s = await api('/settings');
      paintTradeBtn(s.buySellEnabled);
      if (Array.isArray(s.upis)) activeUpis = s.upis;
      const np = $('#nPending'), nc = $('#nCashQr'), nw = $('#nPayouts');
      if (np) np.textContent = s.pendingCount ? `Pending (${s.pendingCount})` : 'Pending';
      if (nw) {
        nw.textContent = s.withdrawPendingCount ? `Payouts (${s.withdrawPendingCount})` : 'Payouts';
        nw.className = 'btn ' + (s.withdrawPendingCount ? '' : 'ghost');
      }
      if (nc) {
        nc.textContent = s.cashQrPendingCount ? `CashQR (${s.cashQrPendingCount})` : 'CashQR';
        nc.className = 'btn ' + (s.cashQrPendingCount ? '' : 'ghost');
      }
    } catch {}
  }
  async function toggleTrade() {
    const next = !buySellOn;
    const r = await ask({
      title: next ? 'Turn Buy, Sell & Withdrawals ON?' : 'Turn Buy, Sell & Withdrawals OFF?',
      html: next
        ? '<p>Users will be able to buy, sell, and withdraw USDT again.</p>'
        : '<p>All users will be blocked from <b>Buy</b>, <b>Sell</b>, and <b>Withdrawals</b>. <b>Deposits</b> will still work.</p>',
      chips: next ? null : ['Back in 15 minutes', 'Back in 30 minutes', 'Back in 50 minutes', 'Under maintenance'],
      text: next ? null : { placeholder: 'Reason shown to users (e.g. Buy & Sell will be on after 50 minutes)' },
      secret: { label: 'Enter admin key to confirm', placeholder: 'Admin key' },
      ok: next ? 'Yes, turn ON' : 'Yes, turn OFF',
      danger: !next
    });
    if (!r) return;
    try { const s = await api('/settings/buy-sell', { method: 'POST', body: { enabled: next, reason: r.text, adminKey: r.secret } }); paintTradeBtn(s.buySellEnabled); toast(s.buySellEnabled ? 'Buy, Sell & Withdrawals turned ON' : 'Buy, Sell & Withdrawals turned OFF (deposits still work)'); }
    catch (e) { toast(e.message, true); }
  }
  let adminReconn = null;
  function stopAdminStream() { clearTimeout(adminReconn); adminReconn = null; if (adminEs) { try { adminEs.close(); } catch {} adminEs = null; } }
  async function startAdminStream() {
    stopAdminStream();
    if (!KEY || typeof EventSource === 'undefined') return;
    try {
      const { ticket } = await api('/events-ticket', { method: 'POST', body: {} });
      if (!KEY || !ticket) return;
      adminEs = new EventSource('/api/admin/events?ticket=' + encodeURIComponent(ticket));
      adminEs.onmessage = e => {
        try {
          const ev = JSON.parse(e.data);
          if (ev.type !== 'admin_sync') return;
          loadSettings();
          if (!$('#mdl').hidden) return;
          if (panelMode === 'pending') pending();
          else if (panelMode === 'payouts') payoutsPanel(false);
          else if (panelMode === 'cashqr') cashQrPanel();
          else if (panelMode === 'order' && openOrderId && (!ev.orderId || ev.orderId === openOrderId)) {
            api('/find?q=' + encodeURIComponent(openOrderId)).then(r => { if (r.kind === 'order' && panelMode === 'order' && openOrderId === r.order.id && $('#mdl').hidden) showOrder(r.order); }).catch(() => {});
          }
        } catch {}
      };
      adminEs.onerror = () => { stopAdminStream(); if (KEY) adminReconn = setTimeout(startAdminStream, 4000); };
    } catch {}
  }
  function lock() { stopAdminStream(); KEY = ''; sessionStorage.removeItem('bn_admin_key'); $('#panel').hidden = true; $('#login').hidden = false; }
  async function enter() {
    KEY = $('#key').value.trim(); $('#lerr').textContent = '';
    try { await api('/ping'); sessionStorage.setItem('bn_admin_key', KEY); $('#login').hidden = true; $('#panel').hidden = false; $('#key').value = ''; $('#q').focus(); startAdminStream(); loadSettings(); pending(); }
    catch (e) { KEY = ''; $('#lerr').textContent = e.message; }
  }

  // ---------- search ----------
  async function find(q) {
    if (!q) return;
    try {
      const r = await api('/find?q=' + encodeURIComponent(q));
      if (r.kind === 'user') return openUser(r.uid);
      if (r.kind === 'order') return showOrder(r.order);
      if (r.kind === 'orders') {
        window._searchOrders = r.orders;
        $('#main').innerHTML = `<div class="card"><b>${r.orders.length} orders match “${esc(q)}”. Pick one:</b>${r.orders.map(o => `<button class="row" data-soid="${esc(o.id)}"><span class="t ${o.kind}">${o.method === 'cashqr' ? 'CashQR' : TYPE[o.kind]}</span><span class="m"><b>#${esc(o.id)} · ${f2(o.usdt)} USDT${o.inr ? ' · ₹' + f2(o.inr) : ''}</b><small>${esc(o.user.uid)} · ${day(o.at)} ${clock(o.at)}</small></span><span class="badge ${o.status}">${STAT[o.status]}</span></button>`).join('')}</div>`;
        return bind();
      }
      if (r.kind === 'users') return $('#main').innerHTML = `<div class="card"><b>${r.users.length} users match. Pick one:</b>${r.users.map(u => `<button class="row" data-uid="${esc(u.uid)}"><span class="t">${esc(u.uid)}</span><span class="m">${esc(u.email || u.phone || '')}</span></button>`).join('')}</div>`, bind();
      $('#main').innerHTML = '<p class="empty">Nothing found. Try a user ID like BN-123456, an order ID (e.g. #A7K2M9), a 12-digit UTR, a phone number or an email.</p>';
    } catch (e) { toast(e.message, true); }
  }
  async function openUser(uid) { panelMode = 'user'; openOrderId = ''; try { cur = await api('/user/' + encodeURIComponent(uid)); view = { type: 'all', status: 'all' }; renderUser(); } catch (e) { toast(e.message, true); } }

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
  const rowHtml = o => `<button class="row" data-oid="${esc(o.id)}"><span class="t ${o.kind}">${o.method === 'cashqr' ? 'CashQR' : TYPE[o.kind]}</span><span class="m"><b>#${esc(o.id)} · ${f2(o.usdt)} USDT${o.inr ? ' · ₹' + f2(o.inr) : ''}</b><small>${day(o.at)} ${clock(o.at)}${o.method === 'cashqr' ? ' · CashQR (ATM)' : ''}${o.reason ? ' · <span class="why">' + esc(o.reason) + '</span>' : ''}</small></span><span class="badge ${o.status}">${STAT[o.status]}</span></button>`;

  // ---------- order view ----------
  const fmtRem = ends => {
    const left = Math.max(0, Math.ceil((ends - Date.now()) / 1000));
    if (left <= 0) return '00:00';
    return `${String(Math.floor(left / 60)).padStart(2, '0')}:${String(left % 60).padStart(2, '0')}`;
  };
  function showOrder(o) {
    panelMode = 'order'; openOrderId = o.id;
    loadSettings();
    const can = s => o.kind === 'buy' ? o.status !== s : o.status === 'pending';
    const kv = (k, v) => v === undefined || v === null || v === '' ? '' : `<div><span>${k}</span><b>${v}</b></div>`;
    const isCqr = o.kind === 'buy' && o.method === 'cashqr';
    const wdLabel = o.kind === 'withdraw' && o.status === 'pending' ? (o.timerEndsAt ? 'Processing' : 'Pending') : STAT[o.status];
    const wdTimerText = o.kind === 'withdraw' && o.status === 'pending'
      ? (o.timerEndsAt ? `${fmtRem(o.timerEndsAt)} remaining (Processing)` : 'Not set (shows Pending to user)') : '';
    const cqrStatusHtml = !isCqr ? '' : o.utr ? `<span style="color:var(--success)">UTR submitted (${esc(o.utr)})</span>`
      : (o.hasQr && o.qrExpiresAt > Date.now()) ? `<span style="color:var(--success)" data-cqr-t="${o.qrExpiresAt}">QR active · ${fmtRem(o.qrExpiresAt)}</span>`
      : o.hasQr ? '<span class="why">QR expired (1 min elapsed) — assign a fresh QR</span>'
      : (o.status === 'pending' && o.expiresAt) ? `<span data-cqr-t="${o.expiresAt}">Waiting for QR · ${fmtRem(o.expiresAt)}</span>`
      : 'Waiting for QR';
    const showQrAssign = o.kind === 'buy' && (o.status === 'pending' || (isCqr && o.status !== 'success'));
    const showAutoWd = o.kind === 'withdraw' && o.status === 'pending';
    const sealHtml = o.kind !== 'withdraw' ? '' : o.sealOk
      ? '<span style="color:var(--success)">✓ Verified (Order + Ledger HMAC)</span>'
      : `<span class="why">⚠ ${esc(o.sealError || 'Seal verification failed')}</span>`;
    const txHtml = o.txid ? `<a class="link mono" href="https://bscscan.com/tx/${encodeURIComponent(o.txid)}" target="_blank" rel="noopener">${esc(o.txid)}</a>` : '';
    $('#main').innerHTML = `<div style="max-width:620px;margin:0 auto"><div class="card"><div class="head"><h2>Order #${esc(o.id)}</h2><span class="badge ${o.status}">${wdLabel}</span></div>
      <div class="kv">
        ${kv('Type', isCqr ? 'Buy · CashQR (ATM)' : TYPE[o.kind])}${kv('Payment method', o.kind === 'buy' ? (isCqr ? 'CashQR (ATM High Limit)' : 'UPI') : '')}${kv('Amount', (o.inr ? '₹' + f2(o.inr) + ' → ' : '') + f2(o.usdt) + ' USDT')}${kv('Rate', o.rate ? '₹' + o.rate + ' per USDT' : '')}
        ${kv('CashQR status', cqrStatusHtml)}
        ${kv('Integrity seal', sealHtml)}
        ${kv('UTR', o.utr ? esc(o.utr) : o.kind === 'buy' ? 'Not submitted yet' : '')}${kv('Paid to UPI', esc(o.upi))}${kv('Wallet', esc(o.address))}${kv('Chain', esc(o.chain && o.chain.toUpperCase()))}${kv('Transaction hash', txHtml)}
        ${kv('Withdraw timer', wdTimerText)}
        ${kv('Payout note', o.payoutError ? `<span class="why">${esc(o.payoutError)}</span>` : '')}
        ${kv('User ID', `<button class="link" data-uid="${esc(o.user.uid)}">${esc(o.user.uid)}</button>`)}${kv('User email', esc(o.user.email))}${kv('User phone', esc(o.user.phone))}
        ${kv('Date', day(o.at))}${kv('Time', clock(o.at))}${kv('Last update', day(o.updatedAt) + ' ' + clock(o.updatedAt))}${o.reason ? `<div><span>Failure reason</span><b class="why">${esc(o.reason)}</b></div>` : ''}
      </div>
      ${showAutoWd ? `<div class="cqr-box" style="border-color:${o.sealOk ? 'var(--primary)' : 'var(--error)'}">
        <div>
          <b>${o.sealOk ? `BSC Hot Wallet Auto-Payout · ${f2(o.usdt)} USDT` : '⚠ Auto-Payout Blocked (Integrity Check Failed)'}</b>
          <small style="display:block;margin-top:3px">${o.sealOk
            ? (o.payoutState === 'broadcasted' ? `Broadcasted on BSC (${esc(o.txid || '')}) — waiting for confirmation.` : '1-click sends BEP20 USDT from your Hot Wallet, saves the BSC transaction hash automatically, and marks this order Success.')
            : esc(o.sealError || 'Order or ledger seal did not match.')}</small>
        </div>
        <div class="cqr-acts">
          <button class="btn" id="ordAutoSend" ${(!o.sealOk || o.payoutState === 'locked' || o.payoutState === 'broadcasted') ? 'disabled' : ''}>${o.payoutState === 'broadcasted' ? 'Waiting BSC confirmation…' : o.payoutState === 'locked' ? 'Sending on BSC…' : `⚡ Approve & Auto-Send ${f2(o.usdt)} USDT`}</button>
          <button class="btn ghost" id="ordGoPayouts">Open Payouts tab</button>
        </div>
      </div>` : ''}
      ${showQrAssign ? `<div class="cqr-box">
        <div>
          <b>${o.hasQr && o.qrExpiresAt > Date.now() ? 'CashQR Active on User Screen' : 'Assign CashQR to User'} · ₹${f2(o.inr)}</b>
          <small style="display:block;margin-top:3px">${o.hasQr && o.qrExpiresAt > Date.now() ? 'User can currently see the 1-minute QR. You can replace or resend a new QR below.' : 'Upload/scan the ATM QR photo, pick a UPI ID, or paste QR text to send a clean 1-minute QR to this order.'}</small>
        </div>
        <input type="file" id="ordQrFile" accept="image/*" capture="environment" hidden>
        <div class="cqr-acts">
          <button class="btn" id="ordAssignQr">${o.hasQr ? 'Replace / Resend QR' : 'Assign QR to Order'}</button>
          <button class="btn ghost" id="ordScanQr">Scan / Upload ATM QR Photo</button>
          <button class="btn ghost" id="ordPasteQr">Paste QR Text</button>
        </div>
      </div>` : ''}
      <div style="display:flex;gap:10px;margin-top:16px;flex-wrap:wrap">${o.kind === 'withdraw' && o.status === 'pending' ? `<button class="btn ghost" id="setTimer">${o.timerEndsAt ? 'Edit timer' : 'Set timer'}</button>` : ''}${can('success') ? '<button class="btn" id="ok">Mark success</button>' : ''}${can('failed') ? '<button class="btn danger" id="bad">Mark failed</button>' : ''}</div>
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
    panelMode = 'pending'; openOrderId = '';
    try {
      loadSettings();
      const list = await api('/pending');
      const lbl = o => {
        if (o.kind === 'withdraw') return o.timerEndsAt ? `Processing (${Math.max(1, Math.ceil((o.timerEndsAt - Date.now()) / 60000))}m)` : 'Pending';
        if (o.kind === 'buy' && o.method === 'cashqr') {
          if (o.utr) return 'UTR submitted';
          if (o.hasQr && o.qrExpiresAt > Date.now()) return `QR active · ${fmtRem(o.qrExpiresAt)}`;
          if (o.expiresAt) return `Waiting QR · ${fmtRem(o.expiresAt)}`;
          return 'Waiting QR';
        }
        return 'Pending';
      };
      const rowP = o => {
        const isCqr = o.kind === 'buy' && o.method === 'cashqr';
        const timerAttr = isCqr && !o.utr ? (o.hasQr && o.qrExpiresAt > Date.now() ? ` data-cqr-t="${o.qrExpiresAt}"` : o.expiresAt ? ` data-cqr-t="${o.expiresAt}"` : '') : '';
        const isWd = o.kind === 'withdraw' && o.sealOk && !o.payoutState;
        return `<div class="row" data-pid="${esc(o.id)}" style="cursor:pointer">
          <span class="t ${o.kind}">${isCqr ? 'CashQR' : TYPE[o.kind]}</span>
          <span class="m"><b>#${esc(o.id)} · ${f2(o.usdt)} USDT${o.inr ? ' · ₹' + f2(o.inr) : ''}</b><small>${esc(o.user.uid)} · ${day(o.at)} ${clock(o.at)}${isCqr ? ' · <b>CashQR (ATM)</b>' : o.upi ? ' · UPI: <b>' + esc(o.upi) + '</b>' : o.address ? ' · <span class="mono">' + esc(o.address.slice(0, 10) + '…' + o.address.slice(-6)) + '</span>' : ''}${o.kind === 'buy' ? (o.utr ? ' · UTR: <b>' + esc(o.utr) + '</b>' : isCqr ? (o.hasQr ? ' · QR sent to user' : ' · Waiting for you to assign QR') : ' · no UTR yet') : ''}</small></span>
          ${isCqr && !o.utr ? `<button type="button" class="btn ub-act" data-assign-pid="${esc(o.id)}">${o.hasQr ? 'Replace QR' : 'Assign QR'}</button>` : ''}
          ${isWd ? `<button type="button" class="btn ub-act" data-send-pid="${esc(o.id)}">Approve &amp; Send</button>` : ''}
          <span class="badge ${o.utr ? 'success' : 'pending'}"${timerAttr}>${lbl(o)}</span>
        </div>`;
      };
      $('#main').innerHTML = `<div class="head" style="margin-bottom:6px"><div><h3>Pending (${list.length})</h3><small>Buys with a UTR are first. Click an order to review it, or click <b>Assign QR</b> on CashQR requests.</small></div></div>` + (list.length ? list.map(rowP).join('') : '<p class="empty">Nothing is waiting.</p>');
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
    m.querySelectorAll('[data-soid]').forEach(b => b.onclick = () => showOrder((window._searchOrders || []).find(x => x.id === b.dataset.soid)));
    m.querySelectorAll('[data-pid]').forEach(b => b.onclick = () => showOrder(window._pending.find(x => x.id === b.dataset.pid)));
    m.querySelectorAll('[data-assign-pid]').forEach(b => b.onclick = e => {
      e.stopPropagation();
      const o = (window._pending || []).find(x => x.id === b.dataset.assignPid);
      if (o) openAssignQrModal(o, () => pending());
    });
    m.querySelectorAll('[data-send-pid]').forEach(b => b.onclick = e => {
      e.stopPropagation();
      const o = (window._pending || []).find(x => x.id === b.dataset.sendPid);
      if (o) approveAndSendPayout(o, () => pending());
    });
    m.querySelectorAll('[data-f]').forEach(b => b.onclick = () => { const [g, v] = b.dataset.f.split(':'); view[g] = v; renderUser(); });
    if ($('#eb', m)) $('#eb', m).onclick = editBalance; if ($('#susp', m)) $('#susp', m).onclick = suspend; if ($('#unsusp', m)) $('#unsusp', m).onclick = unsuspend; if ($('#setPw', m)) $('#setPw', m).onclick = resetPassword;
    if (order) {
      if ($('#ordAutoSend', m)) $('#ordAutoSend', m).onclick = () => approveAndSendPayout(order, upd => showOrder(upd));
      if ($('#ordGoPayouts', m)) $('#ordGoPayouts', m).onclick = () => payoutsPanel(true);
      if ($('#ordAssignQr', m)) $('#ordAssignQr', m).onclick = () => openAssignQrModal(order, upd => showOrder(upd));
      if ($('#ordScanQr', m) && $('#ordQrFile', m)) {
        $('#ordScanQr', m).onclick = () => $('#ordQrFile', m).click();
        $('#ordQrFile', m).onchange = async e => {
          const f = e.target.files && e.target.files[0]; e.target.value = '';
          if (!f) return;
          try { const payload = await decodeQrFromFile(f); await attachCleanQr(order, payload, upd => showOrder(upd)); }
          catch (err) { toast(err.message, true); openAssignQrModal(order, upd => showOrder(upd)); }
        };
      }
      if ($('#ordPasteQr', m)) $('#ordPasteQr', m).onclick = () => openAssignQrModal(order, upd => showOrder(upd));
      if ($('#setTimer', m)) $('#setTimer', m).onclick = async () => {
        const curMins = order.timerEndsAt ? Math.max(1, Math.ceil((order.timerEndsAt - Date.now()) / 60000)) : 60;
        const r = await ask({
          title: order.timerEndsAt ? 'Edit withdraw timer' : 'Set withdraw timer',
          html: '<p>Sets the withdrawal status to <b>Processing</b> with a live countdown shown to the user.</p>',
          num: { label: 'Duration (minutes)', value: curMins, preview: v => v >= 1 && v <= 1440 ? `Countdown: <b>${Math.round(v)}:00</b>` : '<span class="why">Enter 1 to 1440 minutes</span>' },
          chips: ['15 min', '30 min', '45 min', '60 min'],
          ok: 'Save timer'
        });
        if (!r) return;
        const mins = +r.num;
        if (!(mins >= 1 && mins <= 1440)) return toast('Enter a timer between 1 and 1440 minutes.', true);
        try { const d = await api(`/orders/${order.id}/timer`, { method: 'POST', body: { minutes: mins } }); toast(`${mins} min timer set — status is now Processing`); showOrder(d.order); }
        catch (e) { toast(e.message, true); }
      };
      if ($('#ok', m)) $('#ok', m).onclick = () => changeStatus(order, 'success');
      if ($('#bad', m)) $('#bad', m).onclick = () => changeStatus(order, 'failed');
    }
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
          <input id="ubQ" type="search" placeholder="Search by user ID, order ID (#A7K2M9), phone or email" autocomplete="off" spellcheck="false" aria-label="Search users or orders">
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
      if (d.total === 0 && q) {
        const f = await api('/find?q=' + encodeURIComponent(q)).catch(() => ({ kind: 'none' }));
        if (seq !== ubSeq || !$('#ubBody')) return;
        const foundOrders = f.kind === 'order' ? [f.order] : f.kind === 'orders' ? f.orders : [];
        if (foundOrders.length) {
          window._ubOrders = foundOrders;
          body.innerHTML = foundOrders.map(o => `
            <tr>
              <td><button class="uid-link" data-ub-oid="${esc(o.id)}">Order #${esc(o.id)}</button></td>
              <td>${o.method === 'cashqr' ? 'Buy · CashQR' : TYPE[o.kind]} · ${f2(o.usdt)} USDT${o.inr ? ' (₹' + f2(o.inr) + ')' : ''}</td>
              <td>${day(o.at)} ${clock(o.at)}</td>
              <td><span class="badge ${o.status}">${STAT[o.status]}</span></td>
              <td><button class="btn ub-act" data-ub-oid="${esc(o.id)}">Open Order</button></td>
            </tr>`).join('');
          $('#ubCount').textContent = `${foundOrders.length} order match${foundOrders.length === 1 ? '' : 'es'} for “${q}”`;
          $('#ubPages').innerHTML = '';
          $('#main').querySelectorAll('[data-ub-oid]').forEach(b => b.onclick = () => showOrder((window._ubOrders || []).find(x => x.id === b.dataset.ubOid)));
          return;
        }
      }
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
            <button class="btn" data-upi-logs="${esc(u.upi)}">See all logs (${u.allTimeCount})</button>
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
              <small>${activeCount} active UPI${activeCount === 1 ? '' : 's'} in random rotation · ₹${f2(d.totalCollected)} collected since last reset (${d.totalCount} payment${d.totalCount === 1 ? '' : 's'} · ${d.allTimeCount} all-time)</small>
            </div>
            <div style="display:flex;gap:8px;flex-wrap:wrap">
              <button class="btn ghost" id="resetTodayUpi">Reset collection</button>
              <button class="btn danger" id="clearUpiLogs">Clear all logs</button>
              <button class="btn ghost" id="allUpiLogs">See all logs (${d.allTimeCount})</button>
            </div>
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
            <div style="display:flex;gap:8px;flex-wrap:wrap">
              ${d.logs.length ? '<button class="btn danger" id="clearInsideLogs">Clear all logs</button>' : ''}
              <button class="btn ghost" id="backTxLog">← Back to UPI control</button>
            </div>
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
      if ($('#clearInsideLogs', m)) $('#clearInsideLogs', m).onclick = () => clearAllUpiLogs(() => showUpiLogs(upi));
      m.querySelectorAll('[data-uid]').forEach(b => b.onclick = () => openUser(b.dataset.uid));
      m.querySelectorAll('[data-ul-oid]').forEach(b => b.onclick = () => showOrder(window._upiLogs.find(x => x.id === b.dataset.ulOid)));
    } catch (e) { toast(e.message, true); }
  }
  async function clearAllUpiLogs(after) {
    const r = await ask({
      title: 'Clear all transaction logs?',
      html: '<p>Clears all UPI payment logs and resets every UPI card’s <b>Total collected</b> counter back to <b>₹0.00</b>.</p><p class="mut">User account balances and ledger history remain untouched.</p>',
      secret: { label: 'Enter admin key to confirm', placeholder: 'Admin key' },
      ok: 'Clear all logs',
      danger: true
    });
    if (!r) return;
    try { await api('/upis/clear-logs', { method: 'POST', body: { adminKey: r.secret } }); toast('All transaction logs cleared'); after(); }
    catch (err) { toast(err.message, true); }
  }
  function bindTxLog() {
    const m = $('#main');
    if ($('#allUpiLogs', m)) $('#allUpiLogs', m).onclick = () => showUpiLogs('');
    if ($('#clearUpiLogs', m)) $('#clearUpiLogs', m).onclick = () => clearAllUpiLogs(txLog);
    if ($('#resetTodayUpi', m)) $('#resetTodayUpi', m).onclick = async () => {
      const r = await ask({
        title: 'Reset today’s collection',
        html: '<p>Resets every UPI card’s <b>Total collected</b> counter back to <b>₹0.00</b> for a fresh start.</p><p class="mut">No payment logs are deleted — all past orders remain visible in <b>See all logs</b>.</p>',
        secret: { label: 'Enter admin key to confirm', placeholder: 'Admin key' },
        ok: 'Reset to ₹0.00',
        danger: true
      });
      if (!r) return;
      try { await api('/upis/reset', { method: 'POST', body: { adminKey: r.secret } }); toast('Collection counters reset to ₹0.00'); txLog(); }
      catch (err) { toast(err.message, true); }
    };
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
  // ---------- CashQR (ATM high-limit queue + photo-to-clean-QR converter) ----------
  async function decodeQrFromFile(file) {
    const url = URL.createObjectURL(file);
    try {
      const img = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = url; });
      if (window.BarcodeDetector) {
        try {
          const det = new BarcodeDetector({ formats: ['qr_code'] });
          const res = await det.detect(img);
          if (res && res[0] && res[0].rawValue) return res[0].rawValue;
        } catch {}
      }
      if (typeof window.jsQR !== 'function') throw new Error('QR decoder not loaded.');
      const canvas = document.createElement('canvas'), ctx = canvas.getContext('2d', { willReadFrequently: true });
      const crops = [
        [0, 0, img.width, img.height],
        [Math.round(img.width * 0.15), Math.round(img.height * 0.15), Math.round(img.width * 0.7), Math.round(img.height * 0.7)]
      ];
      for (const [sx, sy, sw, sh] of crops) {
        if (sw < 40 || sh < 40) continue;
        for (const maxDim of [900, 1400, 560]) {
          const sc = Math.min(1, maxDim / Math.max(sw, sh));
          const w = Math.max(1, Math.round(sw * sc)), h = Math.max(1, Math.round(sh * sc));
          canvas.width = w; canvas.height = h;
          ctx.drawImage(img, sx, sy, sw, sh, 0, 0, w, h);
          const base = ctx.getImageData(0, 0, w, h);
          let hit = window.jsQR(base.data, w, h, { inversionAttempts: 'attemptBoth' });
          if (hit && hit.data) return hit.data;
          let sum = 0;
          const bd = base.data;
          for (let i = 0; i < bd.length; i += 4) sum += 0.299 * bd[i] + 0.587 * bd[i + 1] + 0.114 * bd[i + 2];
          const avg = sum / (bd.length / 4);
          for (const mult of [0.92, 1.05, 0.8]) {
            const copy = new Uint8ClampedArray(bd);
            for (let i = 0; i < copy.length; i += 4) {
              const v = (0.299 * copy[i] + 0.587 * copy[i + 1] + 0.114 * copy[i + 2]) > avg * mult ? 255 : 0;
              copy[i] = copy[i + 1] = copy[i + 2] = v; copy[i + 3] = 255;
            }
            hit = window.jsQR(copy, w, h, { inversionAttempts: 'attemptBoth' });
            if (hit && hit.data) return hit.data;
          }
        }
      }
      throw new Error('Could not detect a clear QR code in that photo. Crop closer to the ATM QR or paste/generate the QR below.');
    } finally { URL.revokeObjectURL(url); }
  }
  const svgImgHtml = svg => `<img src="data:image/svg+xml;utf8,${encodeURIComponent(svg)}" alt="Clean QR preview">`;
  async function attachCleanQr(order, payload, afterFn) {
    try {
      const p = await api('/cashqr/preview', { method: 'POST', body: { payload } });
      const ok = await ask({
        title: `Send clean QR to #${order.id}?`,
        html: `<p>Amount: <b>₹${f2(order.inr)}</b> · User: <b>${esc(order.user.uid)}</b></p><div class="cqr-prev">${svgImgHtml(p.svg)}</div><p class="mut">Once sent, this CashQR will stay active for <b>1 minute</b> on the user’s screen.</p>`,
        ok: 'Send 1-min QR to user'
      });
      if (!ok) return;
      const res = await api(`/cashqr/${order.id}/qr`, { method: 'POST', body: { payload } });
      toast(`Clean 1-min CashQR sent to #${order.id}`);
      loadSettings();
      if (typeof afterFn === 'function') afterFn(res.order);
      else cashQrPanel();
    } catch (e) { toast(e.message, true); }
  }
  function openAssignQrModal(order, afterFn) {
    const m = $('#mdl'), c = $('#mcard');
    const upiChips = activeUpis.length
      ? `<div style="margin-top:8px"><small class="mut">Or 1-click generate ₹${f2(order.inr)} QR from active UPI:</small><div class="chips">${activeUpis.map(u => `<button type="button" class="chip" data-gen-upi="${esc(u)}">${esc(u)}</button>`).join('')}</div></div>`
      : '';
    c.innerHTML = `<h3>Assign CashQR to #${esc(order.id)}</h3>
      <p>Amount: <b>₹${f2(order.inr)}</b> (${f2(order.usdt)} USDT) · User: <b>${esc(order.user.uid)}</b></p>
      <input type="file" id="mQrFile" accept="image/*" capture="environment" hidden>
      <button type="button" class="btn ghost block" id="mPickQrImg" style="margin:10px 0">📷 Upload / Scan ATM QR Photo (auto-converts to clean QR)</button>
      ${upiChips}
      <label class="mut" for="mQrText" style="display:block;margin-top:8px">QR payload / UPI link (auto-filled from photo or paste below):</label>
      <textarea id="mQrText" rows="2" maxlength="2000" placeholder="upi://pay?pa=... or decoded ATM QR string" style="margin-top:6px"></textarea>
      <div id="mQrPrevWrap" hidden style="text-align:center;margin-top:8px">
        <div class="cqr-prev" id="mQrPrev"></div>
        <small class="mut">Clean 1-minute vector QR preview</small>
      </div>
      <p class="merr" id="merr"></p>
      <div class="mbtns"><button class="btn ghost" id="mno">Cancel</button><button class="btn" id="myes">Send 1-min QR to user</button></div>`;
    m.hidden = false;
    const close = () => { m.hidden = true; document.removeEventListener('keydown', onKey); };
    const onKey = e => { if (e.key === 'Escape') close(); };
    document.addEventListener('keydown', onKey);
    $('#mno', c).onclick = close;
    let prevTimer = null;
    const updatePreview = async val => {
      const txt = (val ?? $('#mQrText', c).value).trim();
      $('#merr', c).textContent = '';
      if (txt.length < 4) { $('#mQrPrevWrap', c).hidden = true; return; }
      try {
        const p = await api('/cashqr/preview', { method: 'POST', body: { payload: txt } });
        if (!$('#mQrPrev', c)) return;
        $('#mQrPrev', c).innerHTML = svgImgHtml(p.svg);
        $('#mQrPrevWrap', c).hidden = false;
      } catch (e) { $('#merr', c).textContent = e.message; }
    };
    $('#mQrText', c).oninput = () => { clearTimeout(prevTimer); prevTimer = setTimeout(() => updatePreview(), 220); };
    c.querySelectorAll('[data-gen-upi]').forEach(b => b.onclick = () => {
      const upi = b.dataset.genUpi;
      const link = `upi://pay?pa=${upi}&pn=BlockNexa&am=${Number(order.inr).toFixed(2)}&cu=INR&tn=${encodeURIComponent('BN ' + order.id)}`;
      $('#mQrText', c).value = link;
      updatePreview(link);
    });
    $('#mPickQrImg', c).onclick = () => $('#mQrFile', c).click();
    $('#mQrFile', c).onchange = async e => {
      const f = e.target.files && e.target.files[0]; e.target.value = '';
      if (!f) return;
      $('#merr', c).textContent = '';
      $('#mPickQrImg', c).textContent = 'Decoding ATM QR photo…';
      try {
        const decoded = await decodeQrFromFile(f);
        $('#mQrText', c).value = decoded;
        $('#mPickQrImg', c).textContent = '✓ ATM QR decoded — change photo';
        await updatePreview(decoded);
      } catch (err) {
        $('#mPickQrImg', c).textContent = '📷 Upload / Scan ATM QR Photo';
        $('#merr', c).textContent = err.message;
      }
    };
    $('#myes', c).onclick = async () => {
      const payload = $('#mQrText', c).value.trim();
      if (payload.length < 4) { $('#merr', c).textContent = 'Upload an ATM QR photo, pick a UPI chip, or paste QR text first.'; return; }
      $('#myes', c).disabled = true;
      try {
        const res = await api(`/cashqr/${order.id}/qr`, { method: 'POST', body: { payload } });
        close();
        toast(`Clean 1-min CashQR sent to #${order.id}`);
        loadSettings();
        if (typeof afterFn === 'function') afterFn(res.order);
        else cashQrPanel();
      } catch (err) {
        $('#myes', c).disabled = false;
        $('#merr', c).textContent = err.message;
      }
    };
    $('#mQrText', c).focus();
  }
  async function cashQrPanel() {
    panelMode = 'cashqr'; openOrderId = '';
    try {
      loadSettings();
      const d = await api('/cashqr');
      const card = o => {
        const badge = o.utr ? '<span class="badge success">UTR submitted</span>'
          : (o.hasQr && o.qrExpiresAt > Date.now()) ? `<span class="badge pending" data-cqr-t="${o.qrExpiresAt}">QR active · ${fmtRem(o.qrExpiresAt)}</span>`
          : `<span class="badge pending" data-cqr-t="${o.expiresAt}">Waiting QR · ${fmtRem(o.expiresAt)}</span>`;
        return `<div class="cqr-card">
          <div class="cqr-top"><div><b>#${esc(o.id)} · ₹${f2(o.inr)}</b> <small>(${f2(o.usdt)} USDT)</small><br><small>${esc(o.user.uid)} · ${esc(o.user.email || o.user.phone || '')} · ${clock(o.at)}</small></div>${badge}</div>
          ${o.utr ? `<small>UTR: <b style="font-family:ui-monospace,Consolas,monospace;color:var(--text)">${esc(o.utr)}</b></small>` : ''}
          <div class="cqr-acts">
            ${!o.utr ? `<button class="btn" data-cqr-assign="${esc(o.id)}">${o.hasQr ? 'Replace / Assign QR' : 'Assign QR'}</button><button class="btn ghost" data-cqr-scan="${esc(o.id)}">${o.hasQr ? 'Replace QR photo' : 'Scan / Upload ATM QR'}</button><button class="btn ghost" data-cqr-paste="${esc(o.id)}">Paste QR text</button>` : ''}
            <button class="btn ghost" data-cqr-open="${esc(o.id)}">Open / Approve</button>
          </div>
        </div>`;
      };
      const hist = d.recent.map(o => `<button class="row" data-cqr-open="${esc(o.id)}"><span class="t buy">CashQR</span><span class="m"><b>#${esc(o.id)} · ₹${f2(o.inr)} · ${f2(o.usdt)} USDT</b><small>${esc(o.user.uid)} · ${day(o.at)} ${clock(o.at)}${o.reason ? ' · <span class="why">' + esc(o.reason) + '</span>' : ''}</small></span><span class="badge ${o.status}">${STAT[o.status]}</span></button>`).join('');
      $('#main').innerHTML = `
        <div class="card">
          <div class="head">
            <div><h2>CashQR · ATM High-Limit Queue</h2><small>First-come, first-served · Upload ATM screen photo or assign a clean 1-minute SVG QR</small></div>
            <div style="display:flex;gap:8px;flex-wrap:wrap">
              <button class="btn ${d.enabled ? '' : 'danger'}" id="cqrToggle">CashQR: ${d.enabled ? 'ON' : 'OFF'}</button>
              <button class="btn ghost" id="cqrRefresh">Refresh</button>
            </div>
          </div>
          <input type="file" id="cqrFile" accept="image/*" capture="environment" hidden>
          <div class="cqr-list">${d.pending.length ? d.pending.map(card).join('') : '<p class="empty">No pending CashQR requests right now.</p>'}</div>
          ${hist ? `<h3 style="margin:20px 0 6px;font-size:15px">Recent CashQR orders</h3>${hist}` : ''}
        </div>`;
      window._cqrList = [...d.pending, ...d.recent];
      const m = $('#main');
      let targetOrder = null;
      $('#cqrRefresh', m).onclick = cashQrPanel;
      $('#cqrToggle', m).onclick = async () => {
        try { const r = await api('/cashqr/toggle', { method: 'POST', body: { enabled: !d.enabled } }); toast(r.enabled ? 'CashQR turned ON' : 'CashQR turned OFF'); cashQrPanel(); }
        catch (e) { toast(e.message, true); }
      };
      $('#cqrFile', m).onchange = async e => {
        const f = e.target.files && e.target.files[0]; e.target.value = '';
        if (!f || !targetOrder) return;
        try { const payload = await decodeQrFromFile(f); await attachCleanQr(targetOrder, payload, () => cashQrPanel()); }
        catch (err) { toast(err.message, true); openAssignQrModal(targetOrder, () => cashQrPanel()); }
      };
      m.querySelectorAll('[data-cqr-assign]').forEach(b => b.onclick = () => {
        const o = window._cqrList.find(x => x.id === b.dataset.cqrAssign);
        if (o) openAssignQrModal(o, () => cashQrPanel());
      });
      m.querySelectorAll('[data-cqr-scan]').forEach(b => b.onclick = () => {
        targetOrder = window._cqrList.find(x => x.id === b.dataset.cqrScan);
        $('#cqrFile', m).click();
      });
      m.querySelectorAll('[data-cqr-paste]').forEach(b => b.onclick = async () => {
        const o = window._cqrList.find(x => x.id === b.dataset.cqrPaste);
        const r = await ask({ title: `Paste QR text for #${o.id}`, text: { placeholder: 'Paste decoded ATM QR string (e.g. upi://pay?...)', required: true }, ok: 'Preview clean QR' });
        if (r) await attachCleanQr(o, r.text, () => cashQrPanel());
      });
      m.querySelectorAll('[data-cqr-open]').forEach(b => b.onclick = () => showOrder(window._cqrList.find(x => x.id === b.dataset.cqrOpen)));
    } catch (e) { toast(e.message, true); }
  }
  setInterval(() => {
    document.querySelectorAll('[data-cqr-t]').forEach(el => {
      const prefix = el.textContent.split('·')[0].trim();
      el.textContent = `${prefix} · ${fmtRem(+el.dataset.cqrT)}`;
    });
  }, 1000);

  // ---------- BSC Hot Wallet Payouts (Option 1: 1-Click Approve & Auto-Send) ----------
  const inFlightPayouts = new Set();
  async function approveAndSendPayout(order, afterFn) {
    if (!order || inFlightPayouts.has(order.id)) return;
    if (!order.sealOk) return toast(order.sealError || 'Integrity seal failed — cannot auto-send.', true);
    const ok = await ask({
      title: `Auto-Send ${f2(order.usdt)} USDT on BSC?`,
      html: `<div class="kv" style="margin:10px 0">
        <div><span>Order</span><b>#${esc(order.id)}</b></div>
        <div><span>User</span><b>${esc(order.user.uid)}</b></div>
        <div><span>Amount</span><b style="color:var(--success)">${f2(order.usdt)} USDT (BEP20)</b></div>
        <div><span>To wallet</span><b class="mono">${esc(order.address)}</b></div>
        <div><span>Security seal</span><b style="color:var(--success)">✓ Order + Ledger Verified</b></div>
      </div><p class="mut">Your Hot Wallet will sign &amp; broadcast this BEP20 transfer, wait for BSC confirmation (~3–5s), fill in the transaction hash automatically, and mark this withdrawal <b>Success</b>.</p>`,
      ok: `Send ${f2(order.usdt)} USDT Now`
    });
    if (!ok) return;
    inFlightPayouts.add(order.id);
    toast(`Sending ${f2(order.usdt)} USDT on BSC for #${order.id}…`);
    try {
      const res = await api(`/payouts/${encodeURIComponent(order.id)}/send`, {
        method: 'POST',
        body: { expectedUsdt: order.usdt, expectedAddress: order.address },
      });
      toast(`✓ Sent ${f2(order.usdt)} USDT! Tx: ${String(res.txHash || '').slice(0, 14)}…`);
      loadSettings();
      if (typeof afterFn === 'function') afterFn(res.order);
      else payoutsPanel(true);
    } catch (e) {
      toast(e.message, true);
      if (panelMode === 'payouts') payoutsPanel(false);
      else if (panelMode === 'order' && openOrderId === order.id) {
        api('/find?q=' + encodeURIComponent(order.id)).then(r => { if (r.kind === 'order') showOrder(r.order); }).catch(() => {});
      }
    } finally {
      inFlightPayouts.delete(order.id);
    }
  }

  async function payoutsPanel(forceRefresh = false) {
    panelMode = 'payouts'; openOrderId = '';
    try {
      loadSettings();
      const d = await api('/payouts' + (forceRefresh ? '?refresh=1' : ''));
      const w = d.wallet || {};
      const explorer = esc(w.explorer || 'https://bscscan.com');
      const walletSetupBanner = !w.configured
        ? `<div class="cqr-box" style="border-color:var(--accent)">
            <div><b>Hot Wallet Not Configured Yet</b>
              <small style="display:block;margin-top:4px">${w.keyInvalid ? '<span class="why">HOT_WALLET_PRIVATE_KEY in .env has an invalid format (must be 64 hex characters).</span>' : 'Add <b>HOT_WALLET_PRIVATE_KEY</b> (your dedicated MetaMask payout account key) to <b>.env</b> / Render Environment Variables and fund it with BEP20 USDT + ~$3 of Smart Chain BNB for gas.'}</small>
            </div>
          </div>`
        : w.rpcError
          ? `<div class="cqr-box" style="border-color:var(--error)"><div><b class="why">BSC RPC Warning</b><small style="display:block;margin-top:4px">${esc(w.rpcError)}</small></div></div>`
          : '';

      const pCard = o => {
        const busy = o.payoutState === 'locked' || o.payoutState === 'broadcasted' || inFlightPayouts.has(o.id);
        const sealBadge = o.sealOk
          ? '<span class="active-badge">✓ Seal &amp; Ledger Verified</span>'
          : '<span class="deact-badge">⚠ Tamper / Seal Mismatch</span>';
        const stateBadge = o.payoutState === 'broadcasted'
          ? '<span class="badge pending">Broadcasted on BSC</span>'
          : o.timerEndsAt ? `<span class="badge pending" data-cqr-t="${o.timerEndsAt}">Processing · ${fmtRem(o.timerEndsAt)}</span>`
          : '<span class="badge pending">Pending</span>';
        return `<div class="cqr-card" style="${o.sealOk ? '' : 'border-color:var(--error)'}">
          <div class="cqr-top">
            <div>
              <b>#${esc(o.id)} · ${f2(o.usdt)} USDT</b> <small>· BSC (BEP20)</small><br>
              <small><button class="link" data-uid="${esc(o.user.uid)}">${esc(o.user.uid)}</button> · ${esc(o.user.email || o.user.phone || '')} · ${day(o.at)} ${clock(o.at)}</small>
            </div>
            <div style="display:flex;gap:6px;align-items:center;flex-wrap:wrap">${sealBadge}${stateBadge}</div>
          </div>
          <div class="mono" style="color:var(--text2)">To: <b style="color:var(--text)">${esc(o.address)}</b></div>
          ${o.txid ? `<small class="mono">Tx: <a class="link" href="${explorer}/tx/${encodeURIComponent(o.txid)}" target="_blank" rel="noopener">${esc(o.txid)}</a></small>` : ''}
          ${!o.sealOk ? `<small class="why"><b>Blocked:</b> ${esc(o.sealError || 'Cryptographic seal verification failed.')}</small>` : ''}
          ${o.payoutError ? `<small class="why">${esc(o.payoutError)}</small>` : ''}
          <div class="cqr-acts">
            <button class="btn" data-pay-send="${esc(o.id)}" ${(!d.enabled || !w.configured || !o.sealOk || busy) ? 'disabled' : ''}>${o.payoutState === 'broadcasted' ? 'Waiting BSC confirmation…' : busy ? 'Sending on BSC…' : `⚡ Approve & Auto-Send ${f2(o.usdt)} USDT`}</button>
            <button class="btn ghost" data-pay-open="${esc(o.id)}">Open / Manual</button>
          </div>
        </div>`;
      };

      const rRow = o => `<div class="row" data-pay-open="${esc(o.id)}" style="cursor:pointer">
        <span class="t withdraw">Withdraw</span>
        <span class="m">
          <b>#${esc(o.id)} · ${f2(o.usdt)} USDT</b>
          <small>${esc(o.user.uid)} · ${day(o.updatedAt)} ${clock(o.updatedAt)} · To <span class="mono">${esc(o.address ? o.address.slice(0, 10) + '…' + o.address.slice(-6) : '')}</span>${o.txid ? ` · Tx: <a class="link mono" data-stop-click="1" href="${explorer}/tx/${encodeURIComponent(o.txid)}" target="_blank" rel="noopener">${esc(o.txid.slice(0, 10))}…</a>` : ''}${o.reason ? ' · <span class="why">' + esc(o.reason) + '</span>' : ''}</small>
        </span>
        <span class="badge ${o.status}">${STAT[o.status]}</span>
      </div>`;

      $('#main').innerHTML = `
        <div class="card">
          <div class="head">
            <div>
              <h2>BSC Hot Wallet Payouts</h2>
              <small>1-click approves, verifies cryptographic order &amp; ledger seals, sends BEP20 USDT on BNB Smart Chain, and saves the tx hash automatically</small>
            </div>
            <div style="display:flex;gap:8px;flex-wrap:wrap">
              <button class="btn ${d.enabled ? '' : 'danger'}" id="payToggle">Payouts: ${d.enabled ? 'ON' : 'OFF'}</button>
              <button class="btn ghost" id="payRefresh">Refresh Wallet</button>
            </div>
          </div>
          ${walletSetupBanner}
          <div class="hw-grid">
            <div class="hw-stat">
              <small class="mut">Hot Wallet Address (BEP20)</small>
              ${w.address ? `<span class="mono" style="color:var(--text)">${esc(w.address)}</span><div style="display:flex;gap:10px;margin-top:4px"><button class="link" id="cpHwAddr" type="button">Copy address</button><a class="link" href="${explorer}/address/${encodeURIComponent(w.address)}" target="_blank" rel="noopener">View on BscScan ↗</a></div>` : '<span class="mut">Not configured (.env)</span>'}
            </div>
            <div class="hw-stat">
              <small class="mut">Hot Wallet USDT</small>
              <b style="color:var(--success)">${w.configured && w.usdt !== null ? f2(w.usdt) + ' USDT' : '—'}</b>
              <small class="mut">Binance-Peg BSC-USD</small>
            </div>
            <div class="hw-stat">
              <small class="mut">BNB Gas Balance</small>
              <b style="color:${w.lowGas ? 'var(--error)' : 'var(--text)'}">${w.configured && w.bnb !== null ? Number(w.bnb).toFixed(5) + ' BNB' : '—'}</b>
              <small class="${w.lowGas ? 'why' : 'mut'}">${w.lowGas ? '⚠ Low gas — top up Smart Chain BNB' : 'Used for BEP20 transfer fees'}</small>
            </div>
            <div class="hw-stat">
              <small class="mut">Sent (Last 24h)</small>
              <b>${f2(d.sent24hUsdt || 0)} USDT</b>
              <small class="mut">${d.pending.length} pending in queue</small>
            </div>
          </div>
          <h3 style="margin:20px 0 6px;font-size:16px">Pending Withdrawals (${d.pending.length})</h3>
          <div class="cqr-list">${d.pending.length ? d.pending.map(pCard).join('') : '<p class="empty">No pending withdrawals right now.</p>'}</div>
          ${d.recent.length ? `<h3 style="margin:22px 0 6px;font-size:15px">Recent Withdrawals &amp; Payout History</h3>${d.recent.map(rRow).join('')}` : ''}
        </div>`;

      window._payList = [...d.pending, ...d.recent];
      const m = $('#main');
      $('#payRefresh', m).onclick = () => payoutsPanel(true);
      if ($('#cpHwAddr', m) && w.address) {
        $('#cpHwAddr', m).onclick = e => {
          navigator.clipboard && navigator.clipboard.writeText(w.address);
          e.target.textContent = 'Copied!';
          setTimeout(() => { e.target.textContent = 'Copy address'; }, 1400);
        };
      }
      $('#payToggle', m).onclick = async () => {
        const next = !d.enabled;
        const r = await ask({
          title: next ? 'Turn Hot Wallet Payouts ON?' : 'Lock Hot Wallet Payouts OFF?',
          html: next
            ? '<p>Re-enables 1-click BSC Hot Wallet payouts from the Admin Panel.</p>'
            : '<p>Locks the Hot Wallet so no automatic BSC transfers can be sent until you turn it back ON with your admin key.</p>',
          secret: { label: 'Enter admin key to confirm', placeholder: 'Admin key' },
          ok: next ? 'Turn Payouts ON' : 'Lock Payouts OFF',
          danger: !next
        });
        if (!r) return;
        try {
          const res = await api('/payouts/toggle', { method: 'POST', body: { enabled: next, adminKey: r.secret } });
          toast(res.enabled ? 'Hot Wallet Payouts turned ON' : 'Hot Wallet Payouts locked OFF');
          payoutsPanel(false);
        } catch (e) { toast(e.message, true); }
      };
      m.querySelectorAll('[data-uid]').forEach(b => b.onclick = () => openUser(b.dataset.uid));
      m.querySelectorAll('[data-stop-click]').forEach(a => a.onclick = e => e.stopPropagation());
      m.querySelectorAll('[data-pay-send]').forEach(b => b.onclick = () => {
        const o = window._payList.find(x => x.id === b.dataset.paySend);
        if (o) approveAndSendPayout(o, () => payoutsPanel(true));
      });
      m.querySelectorAll('[data-pay-open]').forEach(b => b.onclick = () => {
        const o = window._payList.find(x => x.id === b.dataset.payOpen);
        if (o) showOrder(o);
      });
    } catch (e) { toast(e.message, true); }
  }

  $('#nTrade').onclick = toggleTrade;
  $('#nPending').onclick = pending; $('#nPayouts').onclick = () => payoutsPanel(true); $('#nCashQr').onclick = cashQrPanel; $('#nUsers').onclick = () => { panelMode = 'users'; userbase(0); }; $('#nTxLog').onclick = () => { panelMode = 'txlog'; txLog(); }; $('#nNotifs').onclick = () => { panelMode = 'notifs'; pushNotifs(); }; $('#nAudit').onclick = () => { panelMode = 'audit'; auditLog(); }; $('#nBackup').onclick = backup; $('#nLock').onclick = lock;
  if (KEY) api('/ping').then(() => { $('#login').hidden = true; $('#panel').hidden = false; startAdminStream(); loadSettings(); pending(); }).catch(() => {});
})();
