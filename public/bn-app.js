/* ==================================================================
   BLOCKNEXA APP  (all the app code in one file)
   Settings you edit live in bn-config.js. Search for a SECTION to jump:
     SECTION 1  HELPERS          icons, formatting, popup, toast, copy
     SECTION 2  SERVER CALLS     every request to the backend + the API list
     SECTION 3  LOGIN / REGISTER phone + Telegram code, Google
     SECTION 4  SCREENS          home, buy, sell, deposit, withdraw, history, support, account
     SECTION 5  START            starts the app and switches screens
   ================================================================== */

/* ============================================================
   SECTION 1  HELPERS
   icons, formatting, confirm popup, toast, copy
   ============================================================ */
// Small shared helpers: icons, formatting, popup, toast, copy.
(function () {
  const BN = window.BN;
  const P = {
    home: 'M3 11l9-8 9 8M5 10v10h14V10', buy: 'M12 5v14M6 13l6 6 6-6', sell: 'M12 19V5M6 11l6-6 6 6',
    dep: 'M3 10h18M5 10v8M10 10v8M14 10v8M19 10v8M3 20h18M12 3l9 5H3z', wd: 'M4 7h16v12H4zM4 7l2-3h12l2 3M15 13h3',
    back: 'M15 5l-7 7 7 7', copy: 'M9 9h10v10H9zM5 15V5h10', check: 'M5 12.5l4.5 4.5L19 7.5', x: 'M6 6l12 12M18 6L6 18',
    user: 'M12 12a4 4 0 100-8 4 4 0 000 8zM4 21a8 8 0 0116 0', send: 'M21 3L3 10.5l7 2.5 2.5 7L21 3zM10 13l11-10',
    warn: 'M12 9v4M12 17h.01M10.3 3.9L2.4 18a2 2 0 001.7 3h15.8a2 2 0 001.7-3L13.7 3.9a2 2 0 00-3.4 0z',
    eye: 'M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12zM12 15a3 3 0 100-6 3 3 0 000 6z', lock: 'M7 11V8a5 5 0 0110 0v3M5 11h14v9H5z',
    shield: 'M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z', cube: 'M12 3l8 4.5v9L12 21l-8-4.5v-9L12 3zM12 12l8-4.5M12 12v9M12 12L4 7.5', mail: 'M4 6h16v12H4zM4 7l8 6 8-6', users: 'M16 11a3 3 0 100-6 3 3 0 000 6zM8 11a3 3 0 100-6 3 3 0 000 6zM2 20a6 6 0 0112 0M14 20a6 6 0 018 0', help: 'M12 17h.01M9.1 9a3 3 0 115.2 2c-.8.8-2.3 1.2-2.3 3M12 21a9 9 0 100-18 9 9 0 000 18z', logout: 'M9 4H5a1 1 0 00-1 1v14a1 1 0 001 1h4M16 8l4 4-4 4M20 12H9', clock: 'M12 7v5l3 2M12 21a9 9 0 100-18 9 9 0 000 18z', bell: 'M18 8A6 6 0 006 8c0 7-3 9-3 9h18s-3-2-3-9M13.7 21a2 2 0 01-3.4 0'
  };
  // every icon gets an i-<name> class, so the CSS can nudge it the way its action goes (buy down, sell up, withdraw right...)
  const icon = (n, c = '') => `<svg class="ic i-${n} ${c}" viewBox="0 0 24 24" aria-hidden="true"><path pathLength="100" d="${P[n]}"/></svg>`;
  // Hexagon press: a small hexagon spreads from the exact point a button is pressed. One listener for the whole app.
  document.addEventListener('pointerdown', e => {
    const b = e.target.closest('.btn, .chips button');
    if (!b || b.disabled || matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const r = b.getBoundingClientRect(), h = document.createElement('span');
    h.className = 'hexrip'; h.style.left = (e.clientX - r.left) + 'px'; h.style.top = (e.clientY - r.top) + 'px';
    b.appendChild(h); setTimeout(() => h.remove(), 650);
  });
  const LOCKS = '<i class="lock tl"></i><i class="lock br"></i>';   // the two corner brackets used by the popup and the toast
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const fmt = (n, d = 2) => Number(n).toLocaleString('en-IN', { minimumFractionDigits: d, maximumFractionDigits: d });
  const when = t => new Date(t).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });
  const $ = (s, r = document) => r.querySelector(s);
  const short = a => String(a).slice(0, 8) + '…' + String(a).slice(-6);

  // Notification capsule: slides in from the top, hexagon badge, a thin line shows how long it stays.
  function toast(msg, bad) {
    const t = document.createElement('div'); t.className = 'toast' + (bad ? ' bad' : ''); t.setAttribute('role', bad ? 'alert' : 'status');
    t.innerHTML = `${LOCKS}<span class="tmark">${icon(bad ? 'x' : 'check')}</span><span>${esc(msg)}</span>`;
    $('#toasts').appendChild(t);
    setTimeout(() => { t.classList.add('out'); setTimeout(() => t.remove(), 260); }, 3000);
  }
  // BlockNexa popup: glass card, glowing animated edge, hexagon orb with a drawn icon. Resolves true / false.
  // tone: '' (green-blue, default) | 'danger' (red) | 'info' (blue)
  function ask({ title, rows = [], note = '', ok = 'Confirm', cancel = 'Cancel', danger = false, tone = '', icon: ic = '' }) {
    return new Promise(resolve => {
      const m = $('#modal'), prev = document.activeElement, t = danger ? 'danger' : tone;
      m.innerHTML = `<div class="mcard ${t}" role="dialog" aria-modal="true" aria-labelledby="mtitle">${LOCKS}
        <div class="orb"><i class="hex r"></i><i class="hex r r2"></i><i class="hex"></i><i class="hex core"></i>${icon(ic || (t === 'danger' ? 'warn' : t === 'info' ? 'shield' : 'check'))}</div>
        <h3 id="mtitle">${esc(title)}</h3>
        ${rows.length ? `<div class="kv">${rows.map(r => `<div><span>${esc(r[0])}</span><b>${esc(r[1])}</b></div>`).join('')}</div>` : ''}
        ${note ? `<p class="mnote">${esc(note)}</p>` : ''}
        <div class="mbtns"><button class="btn ghost" id="mno">${esc(cancel)}</button><button class="btn" id="myes">${esc(ok)}</button></div></div>`;
      m.classList.remove('out'); m.hidden = false;
      const key = e => { if (e.key === 'Escape') done(false); };
      const done = v => { document.removeEventListener('keydown', key); m.classList.add('out'); setTimeout(() => { m.hidden = true; m.classList.remove('out'); }, 170); if (prev && prev.focus) prev.focus(); resolve(v); };
      document.addEventListener('keydown', key);
      $('#mno').onclick = () => done(false); $('#myes').onclick = () => done(true); m.onclick = e => { if (e.target === m) done(false); };
      $('#myes').focus();
    });
  }
  function copy(text, btn) {
    const done = () => { const o = btn.textContent; btn.textContent = 'Copied'; setTimeout(() => btn.textContent = o, 1400); };
    if (navigator.clipboard && window.isSecureContext) navigator.clipboard.writeText(text).then(done);
    else { const a = document.createElement('textarea'); a.value = text; document.body.appendChild(a); a.select(); try { document.execCommand('copy'); done(); } catch (e) {} a.remove(); }
  }
  const GOOGLE = '<svg viewBox="0 0 48 48" width="20" height="20"><path fill="#EA4335" d="M24 9.5c3.5 0 6.6 1.2 9.1 3.6l6.8-6.8C35.8 2.4 30.3 0 24 0 14.6 0 6.5 5.4 2.6 13.2l7.9 6.1C12.4 13.6 17.7 9.5 24 9.5z"/><path fill="#4285F4" d="M46.5 24.5c0-1.6-.1-3.1-.4-4.5H24v9h12.7c-.6 3-2.3 5.5-4.8 7.2l7.5 5.8c4.4-4.1 7.1-10.1 7.1-17.5z"/><path fill="#FBBC05" d="M10.5 28.7a14.5 14.5 0 010-9.4l-7.9-6.1a24 24 0 000 21.6l7.9-6.1z"/><path fill="#34A853" d="M24 48c6.5 0 11.9-2.1 15.9-5.8l-7.5-5.8c-2.1 1.4-4.8 2.3-8.4 2.3-6.3 0-11.6-4.1-13.5-9.8l-7.9 6.1C6.5 42.6 14.6 48 24 48z"/></svg>';
  const tg = x => /^https?:\/\//.test(x) ? x : 'https://t.me/' + String(x).replace(/^@/, '');   // username or full link -> link
  BN.ui = { icon, esc, fmt, when, $, short, toast, ask, copy, tg, GOOGLE };
})();

/* ============================================================
   SECTION 2  SERVER CALLS
   Every request to the backend lives here. The API list is the first lines below.
   ============================================================ */
// ALL server calls live here. The screens only use BN.api.*, so the backend can change without touching the UI.
// (This list matches backend/server.js. If a request answers 401 after login, the app returns to the login screen.)
//
// API CONTRACT (what the real backend must provide), all JSON under /api/v2:
//   GET  /me                        -> { uid, email?, phone?, hasPassword }        401 if logged out
//   POST /auth/logout
//   POST /auth/google      {credential}                 -> user
//   POST /auth/otp/request {phone, mode}   mode = 'register' | 'login'  -> { status:'sent' }
//        errors: 409 "This number is already registered. Please log in."  /  404 "No account found for this number. Please register first."
//                400 "We could not reach this number on Telegram. Check that it has a Telegram account."
//   POST /auth/otp/verify  {phone, code, mode, password?}   -> user   (mode 'register' needs a password of 8+ characters and creates the account)
//   POST /auth/login/password {phone, password}             -> user   (no code needed)
//   POST /account/password {current?, next}                 -> { ok }  (current is not needed right after a Telegram-code login)
//   GET  /rates   (public)          -> { buy, sell, minBuyUsdt, maxBuyInr, minSellUsdt, minWithdraw, googleClientId }
//   GET  /balance                   -> { usdt }
//   GET  /history/:type             -> buy | sell | withdraw | all   (each item: id, status, at, usdt, inr?, address?, reason?)
//   POST /buy {inr} -> order + { upi }     POST /buy/:id/paid {utr}     GET /buy/:id/qr.svg
//   POST /sell {usdt, upi} -> order        (the USDT is taken from the balance and held)
//   POST /withdraw {chain, amount, address} -> order
//   GET  /deposit                   -> [{ short, name, address }]
// Errors: HTTP 4xx with { error: "message the user can read" }
(function () {
  const BN = window.BN, B = '/api/v2';
  async function req(method, path, body) {
    const r = await fetch(B + path, { method, headers: body ? { 'Content-Type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined, credentials: 'same-origin' });
    const d = await r.json().catch(() => ({}));
    if (r.status === 401 && path !== '/me' && !path.startsWith('/auth') && BN.app && BN.app.expired) BN.app.expired();
    if (!r.ok) { const e = new Error(d.error || 'Something went wrong. Please try again.'); e.status = r.status; throw e; }
    return d;
  }
  const live = {
    session: () => req('GET', '/me').catch(e => e.status === 401 ? null : Promise.reject(e)),
    logout: () => req('POST', '/auth/logout'),
    google: credential => req('POST', '/auth/google', { credential }),
    otpRequest: (phone, mode) => req('POST', '/auth/otp/request', { phone, mode }),
    otpVerify: (phone, code, mode, password) => req('POST', '/auth/otp/verify', { phone, code, mode, password }),
    loginPassword: (phone, password) => req('POST', '/auth/login/password', { phone, password }),
    setPassword: b => req('POST', '/account/password', b),
    rates: () => req('GET', '/rates'), balance: () => req('GET', '/balance'), history: t => req('GET', '/history/' + t),
    buyCreate: inr => req('POST', '/buy', { inr }), buyPaid: (id, utr) => req('POST', `/buy/${id}/paid`, { utr }),
    sellCreate: b => req('POST', '/sell', b), withdraw: b => req('POST', '/withdraw', { chain: 'bsc', ...b }), deposit: () => req('GET', '/deposit'),
    notifications: () => req('GET', '/notifications'), notificationsRead: () => req('POST', '/notifications/read')
  };
  BN.api = live;
})();

/* ============================================================
   SECTION 3  LOGIN / REGISTER
   Phone number + Telegram code, or Google
   ============================================================ */
(function () {
  const BN = window.BN, { icon, esc, $, tg, toast, GOOGLE } = BN.ui;
  function render(root, done) {
    let phone = '', regPw = '', timer = null;
    const brand = `<div class="brand"><span class="mark">${icon('cube')}</span>${esc(BN.cfg.NAME)}</div>`;
    const set = h => { root.innerHTML = `<div class="acard">${brand}${h}</div>`; };
    const err = m => { const e = $('#aerr', root); if (e) { e.textContent = ''; void e.offsetWidth; e.textContent = m || ''; } };
    const busy = (b, on, label) => { b.disabled = on; b.innerHTML = on ? 'Please wait…' : label; };
    const fail = e => err(e.message || 'Something went wrong. Please try again.');
    const phoneField = '<label class="field"><span class="pre">+91</span><input id="num" class="sm" type="tel" inputmode="numeric" maxlength="10" placeholder="10-digit mobile number" autocomplete="tel-national" aria-label="Mobile number"></label>';
    const pwField = (id, ph, ac) => `<label class="field"><input id="${id}" class="sm" type="password" placeholder="${ph}" autocomplete="${ac}" aria-label="${ph}"><button type="button" class="eye" data-eye="${id}" aria-label="Show password">${icon('eye')}</button></label>`;
    const wire = () => {
      root.querySelectorAll('[data-eye]').forEach(b => b.onclick = () => { const i = $('#' + b.dataset.eye, root); i.type = i.type === 'password' ? 'text' : 'password'; b.classList.toggle('on', i.type === 'text'); });
      const n = $('#num', root); if (n) n.oninput = e => { e.target.value = e.target.value.replace(/\D/g, ''); };
    };
    const validPhone = () => { const n = $('#num', root).value; if (!/^[6-9]\d{9}$/.test(n)) { err('Enter a valid 10-digit Indian mobile number.'); return null; } return '+91' + n; };
    const onEnter = (sel, btn) => { const el = $(sel, root); if (el) el.onkeydown = e => { if (e.key === 'Enter') $(btn, root).click(); }; };

    function choose() {
      set(`<h1>Welcome to ${esc(BN.cfg.NAME)}</h1><p class="mut sub">Create your account or log in.</p>
        <button class="btn" id="reg" style="margin-top:0">Register your account</button>
        <button class="btn ghost" id="log">Login to your account</button>
        <div class="or"><span>or</span></div><div id="gslot"></div>
        <p class="err" id="aerr" role="alert"></p>
        <p class="fine">By continuing you agree to the terms of service.</p>
        <p class="fine" style="margin-top:8px">Need help? <a class="link" style="padding:0" href="${esc(tg(BN.cfg.SUPPORT_TELEGRAM))}" target="_blank" rel="noopener">Telegram support</a></p>`);
      $('#reg', root).onclick = registerForm; $('#log', root).onclick = loginForm;
      initGoogle($('#gslot', root));
    }
    // Our own good-looking button on top; Google's real (invisible) button sits above it so the click is handled by Google.
    async function initGoogle(slot) {
      let id = ''; try { id = (await BN.api.rates()).googleClientId || ''; } catch (e) {}
      if (!id) { slot.hidden = true; if (slot.previousElementSibling) slot.previousElementSibling.hidden = true; return; }
      slot.innerHTML = `<div class="gwrap"><div class="gface">${GOOGLE}<span>Continue with Google</span></div><div class="gover" id="gover"></div></div>`;
      const s = document.createElement('script'); s.src = 'https://accounts.google.com/gsi/client'; s.async = true;
      s.onload = () => {
        if (!window.google || !google.accounts) return;
        google.accounts.id.initialize({ client_id: id, callback: r => BN.api.google(r.credential).then(done, fail) });
        google.accounts.id.renderButton($('#gover', root), { theme: 'filled_black', size: 'large', shape: 'pill', text: 'continue_with', width: Math.min(400, Math.max(200, $('.gwrap', root).clientWidth)) });
      };
      s.onerror = () => { const w = $('.gwrap', root); if (w) w.onclick = () => toast('Google sign-in could not load. Check your connection or any ad blocker.', true); };
      document.head.appendChild(s);
    }

    function registerForm() {
      set(`<h1>Create your account</h1><p class="mut sub">Your mobile number and a password. We confirm the number with a code on Telegram.</p>
        ${phoneField}${pwField('pw', 'Choose a password (8+ characters)', 'new-password')}${pwField('pw2', 'Repeat the password', 'new-password')}
        <label class="chk"><input type="checkbox" id="tos"><span>I agree to the terms of service</span></label>
        <p class="err" id="aerr" role="alert"></p>
        <button class="btn" id="send">Send code on Telegram</button><button class="btn ghost" id="back">Back</button>
        <button class="link" id="sw" style="display:block;margin:8px auto 0">Already have an account? Log in</button>`);
      wire(); $('#back', root).onclick = choose; $('#sw', root).onclick = loginForm;
      $('#send', root).onclick = async e => {
        const ph = validPhone(); if (!ph) return;
        const pw = $('#pw', root).value;
        if (pw.length < 8 || pw.length > 128) return err('Choose a password with at least 8 characters.');
        if (pw !== $('#pw2', root).value) return err('The two passwords do not match.');
        if (!$('#tos', root).checked) return err('Please agree to the terms of service to continue.');
        phone = ph; regPw = pw; busy(e.target, true);
        try { await BN.api.otpRequest(phone, 'register'); otp('register'); }
        catch (x) { fail(x); busy(e.target, false, 'Send code on Telegram'); }
      };
    }
    function loginForm() {
      set(`<h1>Welcome back</h1><p class="mut sub">Log in with your mobile number and password.</p>
        ${phoneField}${pwField('pw', 'Your password', 'current-password')}
        <p class="err" id="aerr" role="alert"></p>
        <button class="btn" id="login">Log in</button>
        <div class="two"><button class="link" id="viaCode">Log in with a Telegram code</button><button class="link" id="forgot">Forgot password?</button></div>
        <button class="btn ghost" id="back" style="margin-top:6px">Back</button>
        <button class="link" id="sw" style="display:block;margin:8px auto 0">New here? Register your account</button>`);
      wire(); onEnter('#pw', '#login'); $('#back', root).onclick = choose; $('#sw', root).onclick = registerForm;
      $('#viaCode', root).onclick = () => codeForm(false); $('#forgot', root).onclick = () => codeForm(true);
      $('#login', root).onclick = async e => {
        const ph = validPhone(); if (!ph) return;
        const pw = $('#pw', root).value; if (!pw) return err('Enter your password.');
        busy(e.target, true);
        try { done(await BN.api.loginPassword(ph, pw)); } catch (x) { fail(x); busy(e.target, false, 'Log in'); }
      };
    }
    function codeForm(forgot) {
      set(`<h1>${forgot ? 'Reset your password' : 'Log in with a code'}</h1>
        <p class="mut sub">${forgot ? 'We send a code to your Telegram. After you log in you can choose a new password.' : 'We send a 6-digit code to your Telegram.'}</p>
        ${phoneField}<p class="err" id="aerr" role="alert"></p>
        <button class="btn" id="send">Send code on Telegram</button><button class="btn ghost" id="back">Back</button>`);
      wire(); onEnter('#num', '#send'); $('#back', root).onclick = loginForm;
      $('#send', root).onclick = async e => {
        const ph = validPhone(); if (!ph) return;
        phone = ph; busy(e.target, true);
        try { await BN.api.otpRequest(phone, 'login'); otp('login', forgot); }
        catch (x) { fail(x); busy(e.target, false, 'Send code on Telegram'); }
      };
    }
    function otp(mode, forgot) {
      let left = 30; const sender = BN.cfg.OTP_SENDER;
      set(`<h1>Enter the code</h1><p class="mut sub">We sent a 6-digit code to your Telegram for <b>${esc(phone)}</b>. Look for a message from <b>@${esc(sender)}</b>.</p>
        <label class="field"><input id="code" class="otp" type="text" inputmode="numeric" autocomplete="one-time-code" maxlength="6" placeholder="······" aria-label="6-digit code"></label>
        <p class="err" id="aerr" role="alert"></p>
        <button class="btn" id="ver">${mode === 'register' ? 'Verify and create account' : 'Verify and log in'}</button>
        <button class="link" id="again" style="display:block;margin:10px auto 0" disabled></button>`);
      const code = $('#code', root), ver = $('#ver', root), again = $('#again', root), vlabel = ver.textContent;
      const tick = () => { again.disabled = left > 0; again.textContent = left > 0 ? `Resend code in ${left}s` : 'Resend code'; if (left > 0) { left--; timer = setTimeout(tick, 1000); } };
      clearTimeout(timer); tick(); code.focus();
      const submit = async () => {
        if (!/^\d{6}$/.test(code.value)) return err('Enter the 6-digit code.');
        busy(ver, true);
        try { clearTimeout(timer); done(await BN.api.otpVerify(phone, code.value, mode, mode === 'register' ? regPw : undefined), forgot ? { setPassword: true } : undefined); }
        catch (x) { fail(x); busy(ver, false, vlabel); code.select(); }
      };
      code.oninput = () => { code.value = code.value.replace(/\D/g, ''); if (code.value.length === 6) submit(); };
      ver.onclick = submit;
      again.onclick = async () => { left = 30; tick(); try { await BN.api.otpRequest(phone, mode); } catch (x) { fail(x); } };
    }
    choose();
  }
  BN.auth = { render };
})();

/* ============================================================
   SECTION 4  SCREENS
   home, buy, sell, deposit, withdraw, histories, support, account
   ============================================================ */
// All screens: home, buy, sell, deposit, withdraw, history.
(function () {
  const BN = window.BN, { icon, esc, fmt, when, $, short, toast, ask, copy, tg } = BN.ui, api = () => BN.api, cfg = BN.cfg;
  const KIND = { buy: { label: 'Buy', ic: 'buy', tone: 'g' }, sell: { label: 'Sell', ic: 'sell', tone: 'b' }, withdraw: { label: 'Withdraw', ic: 'wd', tone: 'l' } };
  const ST = { success: ['ok', 'Success'], failed: ['fail', 'Failed'], pending: ['wait', 'Processing'] };
  const UPI = /^[\w.\-]{2,}@[\w.\-]{2,}$/, ADDR = /^0x[a-fA-F0-9]{40}$/;
  const msg = e => e.message || 'Something went wrong. Please try again.';
  const sign = { buy: '+', sell: '−', withdraw: '−' };

  function screen(root, title, body, back = '#/home') {
    root.innerHTML = `<div class="wrap"><div class="narrow"><div class="top"><a class="iconbtn" href="${back}" aria-label="Back">${icon('back')}</a><h2 class="ttl">${title}</h2><span style="width:42px"></span></div>${body}</div></div>`;
  }
  function row(x, i = 0) {
    const k = KIND[x.kind], [c, l] = ST[x.status];
    const detail = x.kind === 'buy' ? `₹${fmt(x.inr)} paid` : x.kind === 'sell' ? `₹${fmt(x.inr)} to your UPI` : `to ${short(x.address)}`;
    return `<div class="row" style="--i:${Math.min(i, 10)}"><span class="rico ${k.tone}">${icon(k.ic)}</span><div class="rmid"><b>${k.label} <small>#${esc(x.id)}</small></b>
      <small>${when(x.at)} · ${detail}</small>${x.reason ? `<small class="why">Reason: ${esc(x.reason)}</small>` : ''}</div>
      <div class="rend"><b>${sign[x.kind]}${fmt(x.usdt)} USDT</b><span class="badge ${c}">${l}</span></div></div>`;
  }
  function done(root, title, text, rows, hist) {
    screen(root, title, `<div class="card center"><div class="okmark">${icon('check')}${'<i class="pt"></i>'.repeat(8)}</div><h3 style="font:700 20px var(--display)">${esc(text)}</h3>
      <div class="kv" style="text-align:left">${rows.map(r => `<div><span>${esc(r[0])}</span><b>${esc(r[1])}</b></div>`).join('')}</div>
      <a class="btn" href="#/history/${hist}">View history</a><a class="btn ghost" href="#/home">Back to home</a></div>`);
  }

  async function home(root) {
    const [bal, rt, rec, notifs] = await Promise.all([api().balance(), api().rates(), api().history('all'), api().notifications().catch(() => ({ unread: 0, list: [] }))]);
    const q = (h, c, i, t) => `<a href="${h}" class="q ${c}"><span class="lk">${icon(i)}</span>${t}</a>`;
    const tile = (t, i, tone, n, s) => `<a class="tile lk tn-${tone}" href="#/history/${t}"><span class="rico ${tone}">${icon(i)}</span><b>${n}</b><small>${s}</small></a>`;
    const [whole, dec] = fmt(bal.usdt).split('.');
    const blocks = Array.from({ length: 8 }, (_, n) => `<i style="--n:${n}"></i>`).join('');
    root.innerHTML = `<div class="wrap">
      <div class="top htop"><div class="brand"><span class="mark">${icon('cube')}</span>${esc(cfg.NAME)}</div>
        <span class="pill"><i class="dot"></i>Sell <b class="flash">₹${+rt.sell}</b> · Buy <b>₹${+rt.buy}</b></span>
        <div class="top-acts"><a class="iconbtn" href="#/notifications" aria-label="Notifications">${icon('bell')}${notifs.unread ? `<i class="nbadge">${notifs.unread > 9 ? '9+' : notifs.unread}</i>` : ''}</a><a class="iconbtn" href="#/support" aria-label="Support">${icon('help')}</a><a class="iconbtn" href="#/account" aria-label="Account">${icon('user')}</a></div></div>
      <div class="home"><section>
        <div class="wallet"><div class="wtop"><span class="lbl">Your balance</span><span class="chainpill"><i></i>USDT · BSC</span></div>
          <div class="big">${whole}<span class="dec">.${dec}</span><small>USDT</small></div>
          <div class="wfoot"><span class="lbl">≈ ₹${fmt(bal.usdt * rt.sell)} at the sell rate</span><span class="blocks" aria-hidden="true">${blocks}</span></div></div>
        <div class="quick">${q('#/buy', 'g', 'buy', 'Buy')}${q('#/sell', 'b', 'sell', 'Sell')}${q('#/deposit', '', 'dep', 'Deposit')}${q('#/withdraw', '', 'wd', 'Withdraw')}</div>
        <a href="#/sell" class="ratecard lk tn-g"><div><span class="live"><i class="dot"></i>Live rate</span><h3>Sell your USDT for INR</h3><p>Paid in INR straight to your UPI ID</p></div>
          <div class="rt"><b class="flash">₹${+rt.sell}</b><small>per USDT</small></div></a>
      </section><section>
        <h3 class="sec">Records &amp; community</h3>
        <div class="tiles">${tile('buy', 'buy', 'g', 'Buy history', 'INR → USDT')}${tile('sell', 'sell', 'b', 'Sell history', 'USDT → INR')}${tile('withdraw', 'wd', 'l', 'Withdrawals', 'USDT → wallet')}<a class="tile lk tn-t" href="${esc(tg(cfg.COMMUNITY_TELEGRAM))}" target="_blank" rel="noopener"><span class="rico t">${icon('users')}</span><b>Join community</b><small>Telegram</small></a></div>
        <h3 class="sec">Recent activity</h3><div>${rec.length ? rec.map(row).join('') : '<p class="empty">No activity yet.</p>'}</div>
        <a class="row lk tn-t" href="#/support" style="margin-top:0"><span class="rico t">${icon('help')}</span><div class="rmid"><b>Need help?</b><small>Contact support</small></div></a>
      </section></div></div>`;
  }

  async function buy(root) {
    const rt = await api().rates(), min = Math.ceil(rt.minBuyUsdt * rt.buy);
    screen(root, 'Buy USDT', `<div class="card"><p class="mut">₹${+rt.buy} per USDT. Minimum ${rt.minBuyUsdt} USDT (₹${fmt(min, 0)}), maximum ₹${fmt(rt.maxBuyInr, 0)}.</p>
      <label class="field"><span class="pre">₹</span><input id="amt" type="number" inputmode="numeric" placeholder="0" aria-label="Amount in rupees"></label>
      <div class="chips">${[1000, 2500, 5000].map(v => `<button data-v="${v}">₹${fmt(v, 0)}</button>`).join('')}</div>
      <div class="kv"><div><span>You receive</span><b id="get">0.00 USDT</b></div></div>
      <p class="err" id="err" role="alert"></p><button class="btn" id="go">Continue</button></div>`);
    const amt = $('#amt', root), upd = () => $('#get', root).textContent = fmt((+amt.value || 0) / rt.buy) + ' USDT';
    amt.oninput = upd; root.querySelectorAll('.chips button').forEach(b => b.onclick = () => { amt.value = b.dataset.v; upd(); });
    $('#go', root).onclick = async e => {
      const v = +amt.value, err = $('#err', root); err.textContent = '';
      if (!Number.isInteger(v) || v < min || v > rt.maxBuyInr) return err.textContent = `Enter a whole amount between ₹${fmt(min, 0)} and ₹${fmt(rt.maxBuyInr, 0)}.`;
      if (!await ask({ title: 'Confirm your order', rows: [['You pay', '₹' + fmt(v)], ['You receive', fmt(v / rt.buy, 4) + ' USDT'], ['Rate', '₹' + rt.buy + ' per USDT']], note: 'Next you get a UPI QR code. Pay exactly this amount.', ok: 'Place order' })) return;
      e.target.disabled = true;
      try { pay(root, await api().buyCreate(v)); } catch (x) { err.textContent = msg(x); e.target.disabled = false; }
    };
  }
  function pay(root, o) {
    const qr = `<img class="qr" src="/api/v2/buy/${esc(o.id)}/qr.svg" alt="UPI QR code">`;
    screen(root, 'Pay with UPI', `<div class="card center">${qr}<p class="mut" style="margin-top:10px">Scan with any UPI app and pay exactly <b style="color:var(--text)">₹${fmt(o.inr)}</b></p>
      <div class="copyrow"><span class="addr">${esc(o.upi)}</span><button class="btn ghost" style="margin:0;width:auto;padding:8px 14px" id="cp">Copy</button></div>
      <label class="field" style="margin-top:18px"><input id="utr" class="sm" inputmode="numeric" maxlength="12" placeholder="12-digit UTR after paying" aria-label="UTR"></label>
      <p class="err" id="err" role="alert"></p><button class="btn" id="paid">I have paid</button></div>`);
    $('#cp', root).onclick = e => copy(o.upi, e.target);
    $('#utr', root).oninput = e => e.target.value = e.target.value.replace(/\D/g, '');
    $('#paid', root).onclick = async e => {
      const u = $('#utr', root).value, err = $('#err', root);
      if (!/^\d{12}$/.test(u)) return err.textContent = 'Enter the 12-digit UTR from your payment app.';
      e.target.disabled = true;
      try { await api().buyPaid(o.id, u); done(root, 'Payment submitted', 'We are checking your payment', [['Order', '#' + o.id], ['Amount', '₹' + fmt(o.inr)], ['You receive', fmt(o.usdt, 4) + ' USDT'], ['Status', 'Processing']], 'buy'); }
      catch (x) { err.textContent = msg(x); e.target.disabled = false; }
    };
  }

  async function sell(root) {
    const [rt, bal] = await Promise.all([api().rates(), api().balance()]);
    screen(root, 'Sell USDT', `<div class="card"><p class="mut">Sell at <b style="color:var(--success)">₹${+rt.sell}</b> per USDT. Available: ${fmt(bal.usdt)} USDT. Minimum ${rt.minSellUsdt} USDT.</p>
      <label class="field"><input id="amt" type="number" inputmode="decimal" placeholder="Amount in USDT" aria-label="USDT amount"><button class="mini" id="max">Max</button></label>
      <label class="field"><input id="upi" class="sm" placeholder="Your UPI ID (to receive INR)" autocomplete="off" spellcheck="false" aria-label="Your UPI ID"></label>
      <div class="kv"><div><span>You get</span><b id="get">₹0.00</b></div></div>
      <p class="err" id="err" role="alert"></p><button class="btn blue" id="go" style="background:var(--accent);color:#fff">Sell USDT</button></div>`);
    const amt = $('#amt', root), upd = () => $('#get', root).textContent = '₹' + fmt((+amt.value || 0) * rt.sell);
    amt.oninput = upd; $('#max', root).onclick = () => { amt.value = Math.floor(bal.usdt * 1e6) / 1e6; upd(); };
    $('#go', root).onclick = async e => {
      const v = +amt.value, upi = $('#upi', root).value.trim(), err = $('#err', root); err.textContent = '';
      if (!(v >= rt.minSellUsdt)) return err.textContent = `Minimum sale is ${rt.minSellUsdt} USDT.`;
      if (v > bal.usdt) return err.textContent = `Insufficient balance. You have ${fmt(bal.usdt)} USDT.`;
      if (!UPI.test(upi)) return err.textContent = 'Enter a valid UPI ID, like name@bank.';
      if (!await ask({ title: 'Confirm sale', rows: [['You sell', fmt(v) + ' USDT'], ['Rate', '₹' + rt.sell + ' per USDT'], ['You get', '₹' + fmt(v * rt.sell)], ['Paid to', upi]], note: 'The USDT is set aside for this order. If the payout fails, it returns to your balance.', ok: 'Sell now' })) return;
      e.target.disabled = true;
      try { const o = await api().sellCreate({ usdt: v, upi }); done(root, 'Sale requested', 'We will pay your UPI soon', [['Order', '#' + o.id], ['You sold', fmt(o.usdt) + ' USDT'], ['You get', '₹' + fmt(o.inr)], ['Paid to', o.upi], ['Status', 'Processing']], 'sell'); }
      catch (x) { err.textContent = msg(x); e.target.disabled = false; }
    };
  }

  async function deposit(root) {
    const ch = (await api().deposit())[0];
    screen(root, 'Deposit USDT', `<div class="card"><p class="mut">Currently available chain</p>
      <div class="row" style="border-color:var(--primary);cursor:default"><span class="rico g">${icon('dep')}</span><div class="rmid"><b>${esc(ch.short)}</b><small>${esc(ch.name)}</small></div><span class="badge ok">Selected</span></div>
      <div class="copyrow"><span class="addr">${esc(ch.address)}</span><button class="btn ghost" style="margin:0;width:auto;padding:8px 14px" id="cp">Copy</button></div>
      <div class="note">Send only <b>USDT</b> on the <b>${esc(ch.short)} (BEP20)</b> network to this address. Other coins or networks can be lost for good.</div></div>`);
    $('#cp', root).onclick = e => copy(ch.address, e.target);
  }

  async function withdraw(root) {
    const [bal, rt] = await Promise.all([api().balance(), api().rates()]), low = bal.usdt < rt.minWithdraw;
    screen(root, 'Withdraw USDT', `<div class="card"><p class="mut">Select your chain</p>
      <div class="row" style="border-color:var(--primary);cursor:default"><span class="rico l">${icon('wd')}</span><div class="rmid"><b>BSC</b><small>BNB Smart Chain (BEP20)</small></div><span class="badge ok">Selected</span></div>
      <div class="kv"><div><span>Available</span><b>${fmt(bal.usdt)} USDT</b></div></div>
      <label class="field"><input id="amt" type="number" inputmode="decimal" placeholder="Amount in USDT" aria-label="Amount"><button class="mini" id="max">Max</button></label>
      <label class="field"><input id="addr" class="sm" placeholder="Paste your BSC (BEP20) wallet address" autocomplete="off" spellcheck="false" aria-label="Wallet address"></label>
      <p class="err" id="err" role="alert">${low ? `You need at least ${rt.minWithdraw} USDT to withdraw.` : ''}</p>
      <button class="btn" id="go">Confirm withdrawal</button></div>`);
    $('#max', root).onclick = () => $('#amt', root).value = Math.floor(bal.usdt * 1e6) / 1e6;
    $('#go', root).onclick = async e => {
      const v = +$('#amt', root).value, a = $('#addr', root).value.trim(), err = $('#err', root); err.textContent = '';
      if (!(v > 0)) return err.textContent = 'Enter the amount you want to withdraw.';
      if (v < rt.minWithdraw) return err.textContent = `Minimum withdrawal is ${rt.minWithdraw} USDT.`;
      if (v > bal.usdt) return err.textContent = `Insufficient balance. You have ${fmt(bal.usdt)} USDT.`;
      if (!ADDR.test(a)) return err.textContent = 'Enter a valid BSC (BEP20) address. It starts with 0x and has 42 characters.';
      if (!await ask({ title: 'Confirm withdrawal', rows: [['Amount', v + ' USDT'], ['Network', 'BSC (BEP20)'], ['To address', a]], note: 'Check the address carefully. Crypto sent to a wrong address cannot be recovered.', ok: 'Withdraw' })) return;
      e.target.disabled = true;
      try { const o = await api().withdraw({ amount: v, address: a }); done(root, 'Withdrawal requested', 'We will send it shortly', [['Request', '#' + o.id], ['Amount', fmt(o.usdt) + ' USDT'], ['To', short(o.address)], ['Status', 'Processing']], 'withdraw'); }
      catch (x) { err.textContent = msg(x); e.target.disabled = false; }
    };
  }

  async function history(root, type) {
    const t = KIND[type] ? type : 'buy', names = { buy: 'Buy history', sell: 'Sell history', withdraw: 'Withdrawals' };
    screen(root, names[t], '<p class="empty">Loading…</p>');
    const list = await api().history(t);
    screen(root, names[t], list.length ? list.map(row).join('') : '<p class="empty">Nothing here yet.</p>');
  }
  function support(root) {
    screen(root, 'Contact support', `<div class="card"><p class="mut">Tell us what happened and share your order or request ID (for example #A7K2M9) so we can find it quickly.</p>
      <a class="btn tg" href="${esc(tg(cfg.SUPPORT_TELEGRAM))}" target="_blank" rel="noopener">${icon('send')}Chat on Telegram</a>
      <a class="btn ghost" href="mailto:${esc(cfg.SUPPORT_EMAIL)}">${icon('mail')}${esc(cfg.SUPPORT_EMAIL)}</a>
      <a class="btn ghost" href="${esc(tg(cfg.COMMUNITY_TELEGRAM))}" target="_blank" rel="noopener">${icon('users')}Join our community</a></div>`);
  }
  function account(root) {
    const u = BN.app.user();
    screen(root, 'Account', `<div class="card"><div class="kv" style="margin-top:0"><div><span>Account</span><b>${esc(u.email || u.phone || '')}</b></div><div><span>User ID</span><b>${esc(u.uid)}</b></div></div>
      <a class="btn ghost" href="#/password">${icon('lock')}${u.hasPassword ? 'Change password' : 'Set a password'}</a>
      <a class="btn ghost" href="#/support">${icon('help')}Contact support</a>
      <a class="btn ghost" href="${esc(tg(cfg.COMMUNITY_TELEGRAM))}" target="_blank" rel="noopener">${icon('users')}Join our community</a>
      <button class="btn danger" id="out">${icon('logout')}Log out</button></div>`);
    $('#out', root).onclick = () => BN.app.logout();
  }
  function password(root, arg) {
    const u = BN.app.user(), forgot = arg === 'forgot', needCur = u.hasPassword && !forgot;
    const fld = (id, ph, ac) => `<label class="field"><input id="${id}" class="sm" type="password" placeholder="${ph}" autocomplete="${ac}" aria-label="${ph}"><button type="button" class="eye" data-eye="${id}" aria-label="Show password">${icon('eye')}</button></label>`;
    screen(root, u.hasPassword ? 'Change password' : 'Set a password', `<div class="card"><p class="mut">${forgot ? 'You proved your number with a Telegram code. Choose a new password. Next time you can log in without a code.' : u.hasPassword ? 'Your other devices will be logged out.' : 'With a password you can log in without waiting for a code.'}</p>
      ${needCur ? fld('cur', 'Current password', 'current-password') : ''}${fld('nw', 'New password (8+ characters)', 'new-password')}${fld('nw2', 'Repeat the new password', 'new-password')}
      <p class="err" id="err" role="alert"></p><button class="btn" id="save">Save password</button></div>`, forgot ? '#/home' : '#/account');
    root.querySelectorAll('[data-eye]').forEach(b => b.onclick = () => { const i = $('#' + b.dataset.eye, root); i.type = i.type === 'password' ? 'text' : 'password'; b.classList.toggle('on', i.type === 'text'); });
    $('#save', root).onclick = async e => {
      const nw = $('#nw', root).value, err = $('#err', root); err.textContent = '';
      if (nw.length < 8 || nw.length > 128) return err.textContent = 'Choose a password with at least 8 characters.';
      if (nw !== $('#nw2', root).value) return err.textContent = 'The two passwords do not match.';
      e.target.disabled = true;
      try { await api().setPassword({ current: needCur ? $('#cur', root).value : undefined, next: nw }); u.hasPassword = true; toast('Password saved'); location.hash = '#/home'; }
      catch (x) { err.textContent = msg(x); e.target.disabled = false; }
    };
  }
  async function notifications(root) {
    screen(root, 'Notifications', '<p class="empty">Loading…</p>');
    const d = await api().notifications();
    if (d.unread) api().notificationsRead().catch(() => {});
    const body = d.list.length ? d.list.map((n, i) => `
      <div class="ncard ${n.unread ? 'unr' : ''}" style="--i:${Math.min(i, 10)}">
        <div class="ntop"><b>${esc(n.title)}</b><span class="badge ${n.personal ? 'ok' : 'wait'}">${n.personal ? 'Personal' : 'Announcement'}</span></div>
        <p>${esc(n.message)}</p>
        <small>${when(n.at)}</small>
      </div>`).join('') : '<div class="card"><p class="empty">No notifications yet.</p></div>';
    screen(root, 'Notifications', body);
  }
  BN.screens = { home, buy, sell, deposit, withdraw, history, support, account, password, notifications };
})();

/* ============================================================
   SECTION 5  START
   Checks login, shows the login screen or the app, switches screens by the # address
   ============================================================ */
// Starts the app: checks login, shows the login screen or the app, and switches screens by the # address.
(function () {
  const BN = window.BN, { $, toast } = BN.ui;
  document.title = BN.cfg.NAME;
  const app = $('#app'), auth = $('#auth');
  let user = null;

  function route() {
    if (!user) return;
    const [, name, arg] = (location.hash || '#/home').split('/');
    const fn = BN.screens[name] || BN.screens.home;
    Promise.resolve(fn(app, arg)).catch(e => toast(e.message || 'Something went wrong', true));
    window.scrollTo(0, 0);
  }
  function showAuth() {
    user = null; app.hidden = true; auth.hidden = false;
    BN.auth.render(auth, (u, opts) => { user = u; auth.hidden = true; app.hidden = false; location.hash = opts && opts.setPassword ? '#/password/forgot' : '#/home'; route(); });
  }
  async function logout() { await BN.api.logout().catch(() => {}); showAuth(); }
  BN.app = { user: () => user, logout, expired: showAuth };
  window.addEventListener('hashchange', route);
  (async function boot() {
    let down = false;
    try { user = await BN.api.session(); } catch (e) { user = null; down = true; }
    if (user) { app.hidden = false; route(); } else {
      showAuth();
      if (down) $('.acard', auth).insertAdjacentHTML('afterbegin', '<p class="err">Cannot reach the BlockNexa server. Start it with <b>npm start</b> and open the address it prints (like http://localhost:3000). Do not open this file directly.</p>');
    }
  })();
})();
