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
        <div class="mbtns">${cancel ? `<button class="btn ghost" id="mno">${esc(cancel)}</button>` : ''}<button class="btn" id="myes">${esc(ok)}</button></div></div>`;
      m.classList.remove('out'); m.hidden = false;
      const key = e => { if (e.key === 'Escape') done(false); };
      const done = v => { document.removeEventListener('keydown', key); m.classList.add('out'); setTimeout(() => { m.hidden = true; m.classList.remove('out'); }, 170); if (prev && prev.focus) prev.focus(); resolve(v); };
      document.addEventListener('keydown', key);
      if ($('#mno')) $('#mno').onclick = () => done(false); $('#myes').onclick = () => done(true); m.onclick = e => { if (e.target === m) done(false); };
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
  BN.state = { rates: null, balance: null, recent: null, activeBuys: null, notifications: null };
  async function req(method, path, body) {
    const r = await fetch(B + path, { method, cache: 'no-store', headers: body ? { 'Content-Type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined, credentials: 'same-origin' });
    const d = await r.json().catch(() => ({}));
    if (r.status === 401 && path !== '/me' && !path.startsWith('/auth') && BN.app && BN.app.expired) BN.app.expired(d.error);
    if (!r.ok) { const e = new Error(d.error || 'Something went wrong. Please try again.'); e.status = r.status; throw e; }
    if (path === '/rates') BN.state.rates = d;
    else if (path === '/balance') BN.state.balance = d;
    else if (path === '/home') { BN.state.balance = d.balance; BN.state.rates = d.rates; BN.state.recent = d.recent; BN.state.activeBuys = d.activeBuys || []; BN.state.notifications = d.notifications; }
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
    home: () => req('GET', '/home'),
    order: id => req('GET', '/orders/' + encodeURIComponent(id)),
    rates: () => req('GET', '/rates'), balance: () => req('GET', '/balance'), history: t => req('GET', '/history/' + t),
    buyCreate: (inr, method = 'upi') => req('POST', '/buy', { inr, method }), buyStatus: id => req('GET', '/buy/' + encodeURIComponent(id)), buyPaid: (id, utr) => req('POST', `/buy/${encodeURIComponent(id)}/paid`, { utr }),
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

  const fmtClock = endsAt => {
    const left = Math.max(0, Math.ceil((endsAt - Date.now()) / 1000));
    if (left <= 0) return '00:00';
    const h = Math.floor(left / 3600), m = Math.floor((left % 3600) / 60), s = left % 60;
    const pad = n => String(n).padStart(2, '0');
    return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`;
  };
  const fmtLeft = endsAt => {
    const left = Math.max(0, Math.ceil((endsAt - Date.now()) / 1000));
    return left <= 0 ? 'finishing…' : `${fmtClock(endsAt)} left`;
  };
  setInterval(() => {
    document.querySelectorAll('[data-ends]').forEach(el => { el.textContent = fmtLeft(+el.dataset.ends); });
    document.querySelectorAll('[data-proc-clock]').forEach(el => {
      const left = Math.max(0, Math.ceil((+el.dataset.procClock - Date.now()) / 1000));
      el.textContent = left <= 0 ? 'Finishing…' : fmtClock(+el.dataset.procClock);
    });
    document.querySelectorAll('[data-buy-left]').forEach(el => {
      const left = Math.max(0, Math.ceil((+el.dataset.buyLeft - Date.now()) / 1000));
      el.textContent = left <= 0 ? 'Expired' : `${fmtClock(+el.dataset.buyLeft)} left`;
    });
  }, 1000);

  function screen(root, title, body, back = '#/home') {
    root.innerHTML = `<div class="wrap"><div class="narrow"><div class="top"><a class="iconbtn" href="${back}" aria-label="Back">${icon('back')}</a><h2 class="ttl">${title}</h2><span style="width:42px"></span></div>${body}</div></div>`;
  }
  const makeReqId = () => (window.crypto && crypto.randomUUID ? crypto.randomUUID() : 'req_' + Date.now() + '_' + Math.random().toString(36).slice(2, 12));

  function orderState(x) {
    if (x.status === 'success') return { cls: 'ok', label: 'Success', isProc: false };
    if (x.status === 'failed') return { cls: 'fail', label: 'Failed', isProc: false };
    const isProc = !!(x.timerEndsAt || x.payoutState === 'broadcasted' || (x.kind === 'buy' && x.utr));
    return isProc ? { cls: 'proc', label: 'Processing', isProc: true } : { cls: 'pend', label: 'Pending', isProc: false };
  }
  function badgeHtml(x) {
    const st = orderState(x);
    return `<span class="badge ${st.cls}">${st.isProc ? '<i class="pdot"></i>' : ''}${st.label}</span>`;
  }
  function row(x, i = 0) {
    const k = KIND[x.kind];
    const txSpan = (x.kind === 'withdraw' && x.txid) ? ` · Tx: ${esc(short(x.txid))}` : '';
    let detail = '';
    if (x.kind === 'buy') {
      if (x.status === 'pending' && !x.utr) {
        const expSpan = x.expiresAt ? ` · <span data-buy-left="${x.expiresAt}" style="color:var(--success);font-weight:700">${fmtClock(x.expiresAt)} left</span>` : '';
        detail = x.method === 'cashqr'
          ? `₹${fmt(x.inr)} · CashQR (${x.hasQr ? 'QR Ready — Tap to Pay' : 'Getting QR — Tap'})${expSpan}`
          : `₹${fmt(x.inr)} · Tap for QR &amp; UTR${expSpan}`;
      } else if (x.status === 'pending' && x.utr) {
        detail = `₹${fmt(x.inr)} · UTR ${esc(x.utr)} · Verifying`;
      } else {
        detail = `₹${fmt(x.inr)}${x.method === 'cashqr' ? ' · CashQR' : ''}${x.utr ? ' · UTR ' + esc(x.utr) : ''}`;
      }
    } else if (x.kind === 'sell') {
      detail = `₹${fmt(x.inr)} to ${esc(x.upi || 'your UPI')}`;
    } else {
      detail = `to ${esc(short(x.address))}${txSpan}`;
    }
    const timerLine = (x.status === 'pending' && x.timerEndsAt)
      ? `<small style="color:#93C5FD;font-weight:700">⏱ Processing · <span data-ends="${x.timerEndsAt}">${fmtLeft(x.timerEndsAt)}</span></small>` : '';
    return `<a class="row tap" href="#/order/${esc(x.id)}" style="--i:${Math.min(i, 10)}"><span class="rico ${k.tone}">${icon(k.ic)}</span><div class="rmid"><b>${k.label} <small>#${esc(x.id)}</small></b>
      <small>${when(x.at)} · ${detail}</small>${timerLine}${x.reason ? `<small class="why">Reason: ${esc(x.reason)}</small>` : ''}</div>
      <div class="rend"><b>${sign[x.kind]}${fmt(x.usdt)} USDT</b>${badgeHtml(x)}</div></a>`;
  }
  function resumeBuyBanner(list) {
    const active = (list || []).filter(o => o.kind === 'buy' && o.status === 'pending' && !o.utr && (!o.expiresAt || o.expiresAt > Date.now()));
    if (!active.length) return '';
    return active.map(o => `<div class="resume-card">
      <div>
        <b>Active Buy Order #${esc(o.id)} · ₹${fmt(o.inr)} (${fmt(o.usdt)} USDT)</b>
        <small>${o.method === 'cashqr'
          ? (o.hasQr ? 'Your CashQR is ready — scan &amp; submit UTR now' : 'Getting your CashQR — tap to open')
          : 'Scan QR or submit your 12-digit UTR'}${o.expiresAt ? ` · <span data-buy-left="${o.expiresAt}" style="color:var(--success);font-weight:700">${fmtClock(o.expiresAt)} left</span>` : ''}</small>
      </div>
      <a class="resume-btn" href="#/order/${esc(o.id)}">${o.method === 'cashqr' && !o.hasQr ? 'Open Order →' : 'View QR &amp; Submit UTR →'}</a>
    </div>`).join('');
  }

  let activeOrderHook = null, activeTradeSync = null;

  function paintHome(root, d) {
    const { balance: bal, rates: rt, recent: rec, notifications: notifs } = d;
    const activeBuys = d.activeBuys || (rec || []).filter(o => o.kind === 'buy' && o.status === 'pending' && !o.utr);
    const q = (h, c, i, t) => `<a href="${h}" class="q ${c}"><span class="lk">${icon(i)}</span>${t}</a>`;
    const tile = (t, i, tone, n, s) => `<a class="tile lk tn-${tone}" href="#/history/${t}"><span class="rico ${tone}">${icon(i)}</span><b>${n}</b><small>${s}</small></a>`;
    const [whole, dec] = fmt(bal.usdt).split('.');
    const blocks = Array.from({ length: 8 }, (_, n) => `<i style="--n:${n}"></i>`).join('');
    root.innerHTML = `<div class="wrap">
      <div class="top htop"><div class="brand"><span class="mark">${icon('cube')}</span>${esc(cfg.NAME)}</div>
        <span class="pill"><i class="dot"></i>Sell <b class="flash">₹${+rt.sell}</b> · Buy <b>₹${+rt.buy}</b></span>
        <div class="top-acts"><a class="iconbtn" href="#/notifications" aria-label="Notifications">${icon('bell')}${notifs.unread ? `<i class="nbadge">${notifs.unread > 9 ? '9+' : notifs.unread}</i>` : ''}</a><a class="iconbtn" href="#/support" aria-label="Support">${icon('help')}</a><a class="iconbtn" href="#/account" aria-label="Account">${icon('user')}</a></div></div>
      ${resumeBuyBanner(activeBuys)}
      <div class="home"><section>
        <div class="wallet"><div class="wtop"><span class="lbl">Your balance</span><span class="chainpill"><i></i>USDT · BSC</span></div>
          <div class="big">${whole}<span class="dec">.${dec}</span><small>USDT</small></div>
          <div class="wfoot"><span class="lbl">≈ ₹${fmt(bal.usdt * rt.sell)} at the sell rate</span><span class="blocks" aria-hidden="true">${blocks}</span></div></div>
        <div class="quick">${q('#/buy', 'g', 'buy', 'Buy')}${q('#/sell', 'b', 'sell', 'Sell')}${q('#/deposit', '', 'dep', 'Deposit')}${q('#/withdraw', '', 'wd', 'Withdraw')}</div>
        <a href="#/sell" class="ratecard lk tn-g"><div><span class="live"><i class="dot"></i>Live rate</span><h3>Sell your USDT for INR</h3><p>Paid in INR straight to your UPI ID</p></div>
          <div class="rt"><b class="flash">₹${+rt.sell}</b><small>per USDT</small></div></a>
      </section><section>
        <h3 class="sec">Records &amp; community</h3>
        <div class="tiles">${tile('buy', 'buy', 'g', 'Buy history', 'INR → USDT')}${tile('sell', 'sell', 'b', 'Sell history', 'USDT → INR')}${tile('withdraw', 'wd', 'l', 'Withdrawals', 'USDT → wallet')}<button type="button" class="tile lk tn-t" id="commBtn"><span class="rico t">${icon('users')}</span><b>Join community</b><small>Coming soon</small></button></div>
        <h3 class="sec">Recent activity</h3><div>${rec.length ? rec.map(row).join('') : '<p class="empty">No activity yet.</p>'}</div>
        <a class="row lk tn-t" href="#/support" style="margin-top:0"><span class="rico t">${icon('help')}</span><div class="rmid"><b>Need help?</b><small>Contact support</small></div></a>
      </section></div></div>`;
    $('#commBtn', root).onclick = communitySoonAlert;
    if (rt.buySellEnabled === false) {
      root.querySelectorAll('a[href="#/buy"], a[href="#/sell"], a[href="#/withdraw"]').forEach(a => a.onclick = e => { e.preventDefault(); buySellOffAlert(rt.buySellReason); });
    }
  }

  async function home(root) {
    activeOrderHook = null; activeTradeSync = null;
    const st = BN.state;
    if (st.balance && st.rates && st.recent && st.notifications) {
      paintHome(root, st);
      api().home().then(d => { if ((location.hash || '#/home').split('/')[1] === 'home') paintHome(root, d); }).catch(() => {});
      return;
    }
    paintHome(root, await api().home());
  }
  const buySellOffAlert = r => ask({ title: 'Service Unavailable', note: r || "Buy, Sell & Withdrawal services are currently disabled. We'll notify you.", ok: 'OK', cancel: '', tone: 'danger', icon: 'warn' });
  const communitySoonAlert = () => ask({ title: 'Community Arriving Soon', note: 'Our official BlockNexa community channel is launching soon. Stay tuned!', ok: 'Got it', cancel: '', tone: 'info', icon: 'users' });
  const cancelOpenModal = () => { const mno = $('#mno'); if (mno) mno.click(); };

  function renderDisabledScreen(root, title, reason) {
    screen(root, title, `<div class="card center"><p class="err" style="margin-top:0">${esc(reason || "Buy, Sell & Withdrawal services are currently disabled. We'll notify you.")}</p><a class="btn ghost" href="#/deposit">Deposit USDT instead</a><a class="btn ghost" href="#/home">Back to home</a></div>`);
  }

  async function buy(root) {
    activeOrderHook = null;
    let rt = BN.state.rates;
    let activeBuys = BN.state.activeBuys;
    if (!rt || !activeBuys) {
      const hm = await api().home();
      rt = hm.rates; activeBuys = hm.activeBuys || [];
    } else {
      api().home().then(hm => {
        activeBuys = hm.activeBuys || [];
        const slot = $('#buyResumeSlot', root);
        if (slot) slot.innerHTML = resumeBuyBanner(activeBuys);
        if (activeTradeSync) activeTradeSync(hm.rates, false);
      }).catch(() => {});
    }
    const renderBuyForm = (showOffPopup) => {
      const min = Math.ceil(rt.minBuyUsdt * rt.buy);
      if (rt.buySellEnabled === false) {
        renderDisabledScreen(root, 'Buy USDT', rt.buySellReason);
        if (showOffPopup) setTimeout(() => buySellOffAlert(rt.buySellReason), 190);
        return;
      }
      const cMin = rt.minCashQrInr || 2000, cMax = rt.maxCashQrInr || 10000, cStep = rt.cashQrStep || 500;
      let method = 'upi';
      screen(root, 'Buy USDT', `<div id="buyResumeSlot">${resumeBuyBanner(activeBuys)}</div><div class="card">
        <div class="pm-tabs" role="tablist">
          <button type="button" class="pm on" data-m="upi"><b>UPI</b><small>₹${fmt(min, 0)}–₹${fmt(rt.maxBuyInr, 0)}</small></button>
          <button type="button" class="pm ${rt.cashQrEnabled === false ? 'off' : ''}" data-m="cashqr" id="pmCashQr"><b>CashQR</b><small id="pmCashQrSub">${rt.cashQrEnabled === false ? 'Unavailable' : `₹${fmt(cMin, 0)}–₹${fmt(cMax, 0)}`}</small></button>
        </div>
        <p class="mut" id="binfo" style="margin-top:12px">₹${+rt.buy} per USDT. Minimum ${rt.minBuyUsdt} USDT (₹${fmt(min, 0)}), maximum ₹${fmt(rt.maxBuyInr, 0)}.</p>
        <label class="field"><span class="pre">₹</span><input id="amt" type="number" inputmode="numeric" placeholder="0" aria-label="Amount in rupees"></label>
        <div class="chips" id="bchips"></div>
        <div class="kv"><div><span>You receive</span><b id="get">0.00 USDT</b></div></div>
        <p class="err" id="err" role="alert"></p><button class="btn" id="go">Continue</button></div>`);
      const amt = $('#amt', root), err = $('#err', root);
      const upd = () => $('#get', root).textContent = fmt((+amt.value || 0) / rt.buy) + ' USDT';
      const paintMethod = () => {
        root.querySelectorAll('.pm').forEach(b => b.classList.toggle('on', b.dataset.m === method));
        err.textContent = '';
        if (method === 'cashqr') {
          $('#binfo', root).textContent = `CashQR: ₹${+rt.buy} per USDT. ₹${fmt(cMin, 0)} to ₹${fmt(cMax, 0)} (multiples of ₹${fmt(cStep, 0)}).`;
          $('#bchips', root).innerHTML = [2000, 4000, 6000, 10000].filter(v => v >= cMin && v <= cMax).map(v => `<button type="button" data-v="${v}">₹${fmt(v, 0)}</button>`).join('');
        } else {
          $('#binfo', root).textContent = `₹${+rt.buy} per USDT. Minimum ${rt.minBuyUsdt} USDT (₹${fmt(min, 0)}), maximum ₹${fmt(rt.maxBuyInr, 0)}.`;
          $('#bchips', root).innerHTML = [1000, 2500, 5000].map(v => `<button type="button" data-v="${v}">₹${fmt(v, 0)}</button>`).join('');
        }
        root.querySelectorAll('#bchips button').forEach(b => b.onclick = () => { amt.value = b.dataset.v; upd(); });
      };
      root.querySelectorAll('.pm').forEach(b => b.onclick = () => {
        if (b.dataset.m === 'cashqr' && rt.cashQrEnabled === false) return toast('CashQR is currently unavailable. Please use UPI.', true);
        method = b.dataset.m; paintMethod();
      });
      paintMethod();
      amt.oninput = upd;
      buy._syncCashQr = () => {
        const btn = $('#pmCashQr', root), sub = $('#pmCashQrSub', root);
        if (!btn || !sub) return;
        btn.classList.toggle('off', rt.cashQrEnabled === false);
        sub.textContent = rt.cashQrEnabled === false ? 'Unavailable' : `₹${fmt(cMin, 0)}–₹${fmt(cMax, 0)}`;
        if (rt.cashQrEnabled === false && method === 'cashqr') {
          cancelOpenModal();
          method = 'upi'; paintMethod();
          toast('CashQR was just turned off — switched to UPI.', true);
        }
      };
      $('#go', root).onclick = async e => {
        if (rt.buySellEnabled === false) { renderBuyForm(true); return; }
        const v = +amt.value; err.textContent = '';
        if (method === 'cashqr') {
          if (rt.cashQrEnabled === false) { buy._syncCashQr(); return; }
          if (!Number.isInteger(v) || v < cMin || v > cMax || v % cStep !== 0) return err.textContent = `Enter an amount between ₹${fmt(cMin, 0)} and ₹${fmt(cMax, 0)} (multiple of ₹${fmt(cStep, 0)}).`;
          if (!await ask({ title: 'Confirm CashQR order', rows: [['Method', 'CashQR'], ['You pay', '₹' + fmt(v)], ['You receive', fmt(v / rt.buy, 4) + ' USDT'], ['Rate', '₹' + rt.buy + ' per USDT']], note: 'Step 1 gets your QR (up to 5 min). Once the QR appears, you have 1 minute to scan & pay.', ok: 'Request CashQR' })) return;
          if (rt.buySellEnabled === false) { renderBuyForm(true); return; }
          e.target.disabled = true;
          try { activeTradeSync = null; const created = await api().buyCreate(v, 'cashqr'); location.hash = '#/order/' + created.id; } catch (x) { err.textContent = msg(x); e.target.disabled = false; }
        } else {
          if (!Number.isInteger(v) || v < min || v > rt.maxBuyInr) return err.textContent = `Enter a whole amount between ₹${fmt(min, 0)} and ₹${fmt(rt.maxBuyInr, 0)}.`;
          if (!await ask({ title: 'Confirm your order', rows: [['You pay', '₹' + fmt(v)], ['You receive', fmt(v / rt.buy, 4) + ' USDT'], ['Rate', '₹' + rt.buy + ' per USDT']], note: 'Next you get a UPI QR code (valid for 5 minutes). Even if you close the site to pay, come back here to view the QR and submit your UTR.', ok: 'Place order' })) return;
          if (rt.buySellEnabled === false) { renderBuyForm(true); return; }
          e.target.disabled = true;
          try { activeTradeSync = null; const created = await api().buyCreate(v, 'upi'); location.hash = '#/order/' + created.id; } catch (x) { err.textContent = msg(x); e.target.disabled = false; }
        }
      };
    };
    activeTradeSync = (newRt, notify = true) => {
      const wasEnabled = rt.buySellEnabled !== false, wasCqr = rt.cashQrEnabled !== false;
      rt = newRt;
      if (rt.buySellEnabled === false && (wasEnabled || $('#go', root))) {
        cancelOpenModal();
        renderBuyForm(notify);
      } else if (rt.buySellEnabled !== false && !wasEnabled && !$('#go', root)) {
        const okBtn = $('#myes'); if (okBtn && !$('#mno')) okBtn.click();
        renderBuyForm(false);
        if (notify) toast('Buy, Sell & Withdrawals are now enabled!');
      } else if ((rt.cashQrEnabled !== false) !== wasCqr && buy._syncCashQr) {
        buy._syncCashQr();
      }
    };
    renderBuyForm(rt.buySellEnabled === false);
  }

  // Dedicated live Order Detail & Active Buy Payment screen (#/order/:id)
  async function order(root, rawId) {
    activeTradeSync = null;
    const id = String(rawId || '').trim().toUpperCase();
    if (!id) { location.hash = '#/home'; return; }
    screen(root, `Order #${esc(id)}`, '<p class="empty">Loading order…</p>');
    let cur;
    try { cur = await api().order(id); }
    catch (e) { screen(root, 'Order not found', `<div class="card center"><p class="err" style="margin-top:0">${esc(msg(e))}</p><a class="btn ghost" href="#/home">Back to home</a></div>`); return; }

    let pollIv = null, tickIv = null;
    const stopTimers = () => { clearInterval(pollIv); pollIv = null; clearInterval(tickIv); tickIv = null; };
    const cleanup = () => { stopTimers(); activeOrderHook = null; };
    window.addEventListener('hashchange', cleanup, { once: true });

    const orderKeySig = x => JSON.stringify([x.status, x.utr, x.hasQr, x.qrExpiresAt, x.timerEndsAt, x.txid, x.reason, x.payoutState]);

    activeOrderHook = ord => {
      if (!ord || ord.id !== cur.id) return;
      if (orderKeySig(ord) === orderKeySig(cur)) return;
      cur = ord;
      paintOrder();
    };

    const kvRow = (label, valHtml) => valHtml ? `<div><span>${esc(label)}</span><b>${valHtml}</b></div>` : '';

    function detailsKvHtml(o) {
      const st = orderState(o);
      const typeLabel = o.kind === 'buy'
        ? (o.method === 'cashqr' ? 'Buy USDT · CashQR' : 'Buy USDT · UPI')
        : o.kind === 'sell' ? 'Sell USDT · UPI Payout' : 'Withdraw USDT · BSC (BEP20)';
      const copyBtn = (idAttr, label = 'Copy') => `<button type="button" class="link" id="${idAttr}" style="padding:0 0 0 8px;font-size:12.5px">${label}</button>`;
      const txHtml = o.txid
        ? `<span class="addr">${esc(short(o.txid))}</span>${copyBtn('cpTx')} · <a class="link" style="padding:0;font-size:12.5px" href="https://bscscan.com/tx/${encodeURIComponent(o.txid)}" target="_blank" rel="noopener">BscScan ↗</a>`
        : '';
      return `<div class="kv" style="text-align:left">
        ${kvRow('Order ID', `#${esc(o.id)}${copyBtn('cpOid')}`)}
        ${kvRow('Type', esc(typeLabel))}
        ${kvRow('Status', badgeHtml(o))}
        ${kvRow(o.kind === 'buy' ? 'USDT to receive' : o.kind === 'sell' ? 'USDT sold' : 'Withdrawal amount', `${fmt(o.usdt, o.kind === 'buy' ? 4 : 2)} USDT`)}
        ${o.inr ? kvRow(o.kind === 'buy' ? 'Amount to pay' : 'INR payout', '₹' + fmt(o.inr)) : ''}
        ${o.rate ? kvRow('Rate', `₹${+o.rate} per USDT`) : ''}
        ${o.upi ? kvRow(o.kind === 'buy' ? 'Pay to UPI ID' : 'Your UPI ID', `${esc(o.upi)}${copyBtn('cpUpi')}`) : ''}
        ${o.utr ? kvRow('UTR / Reference', `<span class="addr">${esc(o.utr)}</span>`) : ''}
        ${o.kind === 'withdraw' ? kvRow('Network', 'BNB Smart Chain (BEP20)') : ''}
        ${o.address ? kvRow('Wallet address', `<span class="addr">${esc(o.address)}</span>${copyBtn('cpAddr')}`) : ''}
        ${txHtml ? kvRow('Transaction hash', txHtml) : ''}
        ${kvRow('Created', esc(when(o.at)))}
        ${o.updatedAt && o.updatedAt !== o.at ? kvRow('Last update', esc(when(o.updatedAt))) : ''}
      </div>`;
    }

    function wireDetailCopies(o) {
      if ($('#cpOid', root)) $('#cpOid', root).onclick = e => copy(o.id, e.target);
      if ($('#cpUpi', root)) $('#cpUpi', root).onclick = e => copy(o.upi, e.target);
      if ($('#cpAddr', root)) $('#cpAddr', root).onclick = e => copy(o.address, e.target);
      if ($('#cpTx', root)) $('#cpTx', root).onclick = e => copy(o.txid, e.target);
    }

    function paintOrder() {
      stopTimers();
      const backHref = `#/history/${cur.kind}`;

      // 1) Active Unpaid CashQR Buy Order (Step 1: Getting QR, Step 2: 1-Min QR + Submit UTR)
      if (cur.kind === 'buy' && cur.status === 'pending' && !cur.utr && cur.method === 'cashqr') {
        if (!cur.hasQr) {
          const exp = cur.expiresAt || (Date.now() + 300000);
          screen(root, `Order #${esc(cur.id)}`, `<div class="card center">
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px"><span class="mut">CashQR · Step 1 of 2</span>${badgeHtml(cur)}</div>
            <div class="steps"><span class="st on">1. Getting QR</span><span class="st">2. Scan &amp; Pay (1 min)</span></div>
            <div class="cqr-spin" aria-hidden="true"></div>
            <h3 style="font:700 19px var(--display)">Getting your CashQR</h3>
            <p class="mut" style="margin-top:6px">You should receive your QR within 5 minutes.</p>
            <div class="note" id="cqrTimer" style="color:var(--text)">Waiting time left: <b>${fmtClock(exp)}</b></div>
            <p class="err" id="err" role="alert"></p>
            ${detailsKvHtml(cur)}
          </div>`, backHref);
          wireDetailCopies(cur);
          const tick = () => {
            const box = $('#cqrTimer', root); if (!box) return stopTimers();
            const left = Math.max(0, Math.ceil((exp - Date.now()) / 1000));
            if (left <= 0) {
              stopTimers();
              box.innerHTML = '<b style="color:var(--error)">Request timed out (5 min)</b>';
              api().order(cur.id).then(s => { cur = s; paintOrder(); }).catch(() => {});
            } else {
              box.innerHTML = `Getting QR · time left: <b>${fmtClock(exp)}</b>`;
            }
          };
          tickIv = setInterval(tick, 1000); tick();
          pollIv = setInterval(async () => {
            try { const s = await api().order(cur.id); if (orderKeySig(s) !== orderKeySig(cur)) { cur = s; paintOrder(); } } catch {}
          }, 2500);
          return;
        }
        const exp = cur.qrExpiresAt || (Date.now() + 60000);
        const qr = `<img class="qr" id="cqrImg" src="/api/v2/buy/${esc(cur.id)}/qr.svg?t=${cur.qrExpiresAt || Date.now()}" alt="CashQR code">`;
        screen(root, `Order #${esc(cur.id)}`, `<div class="card center">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px"><span class="mut">CashQR · Step 2 of 2</span>${badgeHtml(cur)}</div>
          <div class="steps"><span class="st done">1. QR Ready</span><span class="st on">2. Scan &amp; Pay (1 min)</span></div>
          ${qr}
          <p class="mut" style="margin-top:10px">Scan this CashQR and pay exactly <b style="color:var(--text)">₹${fmt(cur.inr)}</b></p>
          <div class="note" id="cqrTimer" style="margin-top:10px;color:var(--text)">QR expires in: <b>${fmtClock(exp)}</b></div>
          <label class="field" style="margin-top:16px"><input id="utr" class="sm" inputmode="numeric" maxlength="12" placeholder="12-digit UTR / reference after paying" aria-label="UTR"></label>
          <p class="err" id="err" role="alert"></p><button class="btn" id="paid">I have paid</button>
          ${detailsKvHtml(cur)}
        </div>`, backHref);
        wireDetailCopies(cur);
        const tick = () => {
          const box = $('#cqrTimer', root); if (!box) return stopTimers();
          const left = Math.max(0, Math.ceil((exp - Date.now()) / 1000));
          if (left <= 0) {
            clearInterval(tickIv);
            box.innerHTML = '<b style="color:var(--error)">QR expired (1 min limit)</b>';
            const img = $('#cqrImg', root); if (img) img.style.opacity = '0.18';
            const btn = $('#paid', root); if (btn) btn.disabled = true;
            const err = $('#err', root); if (err) err.textContent = 'This CashQR expired after 1 minute. Please create a new order.';
          } else {
            box.innerHTML = `QR expires in: <b style="color:var(--${left <= 15 ? 'error' : 'success'})">${fmtClock(exp)}</b>`;
          }
        };
        tickIv = setInterval(tick, 1000); tick();
        $('#utr', root).oninput = e => e.target.value = e.target.value.replace(/\D/g, '');
        $('#paid', root).onclick = async e => {
          const u = $('#utr', root).value, err = $('#err', root);
          if (!/^\d{12}$/.test(u)) return err.textContent = 'Enter the 12-digit UTR / reference number from your payment app.';
          e.target.disabled = true;
          try { const r = await api().buyPaid(cur.id, u); cur = r.order || await api().order(cur.id); toast('UTR submitted — now Processing'); paintOrder(); }
          catch (x) { err.textContent = msg(x); e.target.disabled = false; }
        };
        return;
      }

      // 2) Active Unpaid Standard UPI Buy Order (QR + Copy UPI + 5-min timer + Submit UTR — works even if user closed & reopened site!)
      if (cur.kind === 'buy' && cur.status === 'pending' && !cur.utr) {
        const exp = cur.expiresAt || (cur.at + 300000);
        const qr = `<img class="qr" id="upiQrImg" src="/api/v2/buy/${esc(cur.id)}/qr.svg?t=${cur.at}" alt="UPI QR code">`;
        screen(root, `Order #${esc(cur.id)}`, `<div class="card center">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px"><span class="mut">Pay with UPI</span>${badgeHtml(cur)}</div>
          ${qr}
          <p class="mut" style="margin-top:10px">Scan with any UPI app and pay exactly <b style="color:var(--text)">₹${fmt(cur.inr)}</b></p>
          <div class="note" id="btimer" style="margin-top:10px;color:var(--text)">Time left to pay &amp; submit UTR: <b>${fmtClock(exp)}</b></div>
          <div class="copyrow"><span class="addr">${esc(cur.upi || '')}</span><button class="btn ghost" style="margin:0;width:auto;padding:8px 14px" id="cpMainUpi">Copy UPI</button></div>
          <label class="field" style="margin-top:16px"><input id="utr" class="sm" inputmode="numeric" maxlength="12" placeholder="Enter 12-digit UTR after paying" aria-label="UTR"></label>
          <p class="err" id="err" role="alert"></p>
          <button class="btn" id="paid">Submit UTR · I have paid</button>
          ${detailsKvHtml(cur)}
        </div>`, backHref);
        wireDetailCopies(cur);
        if ($('#cpMainUpi', root)) $('#cpMainUpi', root).onclick = e => copy(cur.upi, e.target);
        const tick = () => {
          const box = $('#btimer', root); if (!box) return stopTimers();
          const left = Math.max(0, Math.ceil((exp - Date.now()) / 1000));
          if (left <= 0) {
            stopTimers();
            box.innerHTML = '<b style="color:var(--error)">Order expired (5 min limit)</b>';
            const img = $('#upiQrImg', root); if (img) img.style.opacity = '0.2';
            const btn = $('#paid', root); if (btn) btn.disabled = true;
            const err = $('#err', root); if (err) err.textContent = 'This order expired after 5 minutes without UTR submission.';
            api().order(cur.id).then(s => { if (s.status !== 'pending') { cur = s; paintOrder(); } }).catch(() => {});
          } else {
            box.innerHTML = `Time left to pay &amp; submit UTR: <b style="color:var(--${left <= 45 ? 'error' : 'success'})">${fmtClock(exp)}</b>`;
          }
        };
        tickIv = setInterval(tick, 1000); tick();
        $('#utr', root).oninput = e => e.target.value = e.target.value.replace(/\D/g, '');
        $('#paid', root).onclick = async e => {
          const u = $('#utr', root).value, err = $('#err', root);
          if (!/^\d{12}$/.test(u)) return err.textContent = 'Enter the 12-digit UTR from your payment app.';
          e.target.disabled = true;
          try { const r = await api().buyPaid(cur.id, u); cur = r.order || await api().order(cur.id); toast('UTR submitted — now Processing'); paintOrder(); }
          catch (x) { err.textContent = msg(x); e.target.disabled = false; }
        };
        return;
      }

      // 3) Full Order Details View (Pending/Processing Withdrawals & Sells, Paid Buys, Completed & Failed Orders)
      const k = KIND[cur.kind] || KIND.buy;
      const st = orderState(cur);
      const headTitle = cur.status === 'success'
        ? (cur.kind === 'buy' ? 'USDT Credited' : cur.kind === 'sell' ? 'INR Payout Sent' : 'Withdrawal Completed')
        : cur.status === 'failed'
          ? (cur.kind === 'withdraw' ? 'Withdrawal Failed' : 'Order Failed')
          : st.isProc
            ? (cur.kind === 'withdraw' ? 'Withdrawal Processing' : cur.kind === 'sell' ? 'Sale Processing' : 'Verifying Payment')
            : (cur.kind === 'withdraw' ? 'Withdrawal Pending' : cur.kind === 'sell' ? 'Sale Pending' : 'Order Pending');

      const statusBanner = cur.status === 'pending' && cur.timerEndsAt
        ? `<div class="proc-box">
            <div>
              <b><span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:#60A5FA;margin-right:7px"></span>Status: Processing</b>
              <small>Your ${cur.kind === 'withdraw' ? 'USDT withdrawal' : cur.kind === 'sell' ? 'INR payout' : 'order'} is being processed now.</small>
            </div>
            <div class="proc-clock" data-proc-clock="${cur.timerEndsAt}">${fmtClock(cur.timerEndsAt)}</div>
          </div>`
        : cur.status === 'pending' && cur.payoutState === 'broadcasted'
          ? `<div class="proc-box"><div><b>Status: Processing on BSC</b><small>Your BEP20 USDT transfer has been broadcasted and is confirming on-chain.</small></div>${badgeHtml(cur)}</div>`
          : cur.status === 'pending' && cur.kind === 'buy' && cur.utr
            ? `<div class="proc-box"><div><b>Status: Processing</b><small>UTR <b>${esc(cur.utr)}</b> received. Your USDT will be credited as soon as payment is verified.</small></div>${badgeHtml(cur)}</div>`
            : cur.status === 'pending'
              ? `<div class="note" style="text-align:left;border-color:rgba(251,191,36,.35)"><b style="color:#FBBF24">Status: Pending</b> — Your ${cur.kind === 'withdraw' ? 'withdrawal' : 'sale'} request has been received and is waiting in queue. This page updates live to <b style="color:#93C5FD">Processing</b> with a countdown as soon as processing starts.</div>`
              : cur.status === 'failed'
                ? `<p class="err" style="text-align:left">${esc(cur.reason || 'This order could not be completed.')}${cur.kind !== 'buy' ? ' Your held USDT has been returned to your balance.' : ''}</p>`
                : '';

      const topVisual = cur.status === 'success'
        ? `<div class="okmark">${icon('check')}${'<i class="pt"></i>'.repeat(8)}</div>`
        : `<div style="display:flex;justify-content:center;margin-bottom:10px"><span class="rico ${k.tone}" style="width:54px;height:54px;border-radius:18px">${icon(k.ic)}</span></div>`;

      screen(root, `${k.label} #${esc(cur.id)}`, `<div class="card center">
        ${topVisual}
        <h3 style="font:700 20px var(--display)">${esc(headTitle)}</h3>
        <div style="margin-top:8px">${badgeHtml(cur)}</div>
        ${statusBanner}
        ${detailsKvHtml(cur)}
        ${cur.txid ? `<a class="btn ghost" href="https://bscscan.com/tx/${encodeURIComponent(cur.txid)}" target="_blank" rel="noopener">View Transaction on BscScan ↗</a>` : ''}
        <a class="btn" href="${backHref}">View ${esc(cur.kind)} history</a>
        <a class="btn ghost" href="#/home">Back to home</a>
      </div>`, backHref);
      wireDetailCopies(cur);

      // Keep polling every 3s while pending so status flips Pending -> Processing -> Success even if SSE is buffered by a proxy
      if (cur.status === 'pending') {
        pollIv = setInterval(async () => {
          if (document.hidden) return;
          try { const s = await api().order(cur.id); if (orderKeySig(s) !== orderKeySig(cur)) { cur = s; paintOrder(); } } catch {}
        }, 3000);
      }
    }

    paintOrder();
  }

  async function sell(root) {
    activeOrderHook = null;
    let [rt, bal] = (BN.state.rates && BN.state.balance) ? [BN.state.rates, BN.state.balance] : await Promise.all([api().rates(), api().balance()]);
    if (BN.state.rates && BN.state.balance) Promise.all([api().rates(), api().balance()]).then(([r2, b2]) => { bal = b2; if ($('#sellAvail', root)) $('#sellAvail', root).textContent = fmt(bal.usdt); if (activeTradeSync) activeTradeSync(r2, false); }).catch(() => {});
    const renderSellForm = (showOffPopup) => {
      if (rt.buySellEnabled === false) {
        renderDisabledScreen(root, 'Sell USDT', rt.buySellReason);
        if (showOffPopup) setTimeout(() => buySellOffAlert(rt.buySellReason), 190);
        return;
      }
      screen(root, 'Sell USDT', `<div class="card"><p class="mut">Sell at <b style="color:var(--success)">₹${+rt.sell}</b> per USDT. Available: <span id="sellAvail">${fmt(bal.usdt)}</span> USDT. Minimum ${rt.minSellUsdt} USDT.</p>
        <label class="field"><input id="amt" type="number" inputmode="decimal" placeholder="Amount in USDT" aria-label="USDT amount"><button class="mini" id="max">Max</button></label>
        <label class="field"><input id="upi" class="sm" placeholder="Your UPI ID (to receive INR)" autocomplete="off" spellcheck="false" aria-label="Your UPI ID"></label>
        <div class="kv"><div><span>You get</span><b id="get">₹0.00</b></div></div>
        <p class="err" id="err" role="alert"></p><button class="btn blue" id="go" style="background:var(--accent);color:#fff">Sell USDT</button></div>`);
      let reqId = makeReqId(), submitting = false;
      const amt = $('#amt', root), upd = () => { reqId = makeReqId(); $('#get', root).textContent = '₹' + fmt((+amt.value || 0) * rt.sell); };
      amt.oninput = upd; $('#upi', root).oninput = () => { reqId = makeReqId(); };
      $('#max', root).onclick = () => { amt.value = Math.floor(bal.usdt * 1e6) / 1e6; upd(); };
      $('#go', root).onclick = async e => {
        if (submitting) return;
        if (rt.buySellEnabled === false) { renderSellForm(true); return; }
        const v = +amt.value, upi = $('#upi', root).value.trim(), err = $('#err', root); err.textContent = '';
        if (!(v >= rt.minSellUsdt)) return err.textContent = `Minimum sale is ${rt.minSellUsdt} USDT.`;
        if (v > bal.usdt) return err.textContent = `Insufficient balance. You have ${fmt(bal.usdt)} USDT.`;
        if (!UPI.test(upi)) return err.textContent = 'Enter a valid UPI ID, like name@bank.';
        submitting = true;
        if (!await ask({ title: 'Confirm sale', rows: [['You sell', fmt(v) + ' USDT'], ['Rate', '₹' + rt.sell + ' per USDT'], ['You get', '₹' + fmt(v * rt.sell)], ['Paid to', upi]], note: 'The USDT is set aside for this order. If the payout fails, it returns to your balance.', ok: 'Sell now' })) { submitting = false; return; }
        if (rt.buySellEnabled === false) { submitting = false; renderSellForm(true); return; }
        e.target.disabled = true;
        try { activeTradeSync = null; const o = await api().sellCreate({ usdt: v, upi, reqId }); location.hash = '#/order/' + o.id; }
        catch (x) { submitting = false; err.textContent = msg(x); e.target.disabled = false; }
      };
    };
    activeTradeSync = (newRt, notify = true) => {
      const wasEnabled = rt.buySellEnabled !== false;
      rt = newRt;
      if (rt.buySellEnabled === false && (wasEnabled || $('#go', root))) { cancelOpenModal(); renderSellForm(notify); }
      else if (rt.buySellEnabled !== false && !wasEnabled && !$('#go', root)) { const okBtn = $('#myes'); if (okBtn && !$('#mno')) okBtn.click(); renderSellForm(false); if (notify) toast('Buy, Sell & Withdrawals are now enabled!'); }
    };
    renderSellForm(rt.buySellEnabled === false);
  }

  async function deposit(root) {
    activeOrderHook = null; activeTradeSync = null;
    const ch = (await api().deposit())[0];
    screen(root, 'Deposit USDT', `<div class="card"><p class="mut">Currently available chain</p>
      <div class="row" style="border-color:var(--primary);cursor:default"><span class="rico g">${icon('dep')}</span><div class="rmid"><b>${esc(ch.short)}</b><small>${esc(ch.name)}</small></div><span class="badge ok">Selected</span></div>
      <div class="copyrow"><span class="addr">${esc(ch.address)}</span><button class="btn ghost" style="margin:0;width:auto;padding:8px 14px" id="cp">Copy</button></div>
      <div class="note">Send only <b>USDT</b> on the <b>${esc(ch.short)} (BEP20)</b> network to this address. Other coins or networks can be lost for good.</div></div>`);
    $('#cp', root).onclick = e => copy(ch.address, e.target);
  }

  async function withdraw(root) {
    activeOrderHook = null;
    let [bal, rt] = (BN.state.balance && BN.state.rates) ? [BN.state.balance, BN.state.rates] : await Promise.all([api().balance(), api().rates()]);
    if (BN.state.balance && BN.state.rates) Promise.all([api().balance(), api().rates()]).then(([b2, r2]) => { bal = b2; if ($('#wdAvail', root)) $('#wdAvail', root).textContent = fmt(bal.usdt) + ' USDT'; if (activeTradeSync) activeTradeSync(r2, false); }).catch(() => {});
    const renderWdForm = (showOffPopup) => {
      const low = bal.usdt < rt.minWithdraw;
      if (rt.buySellEnabled === false) {
        renderDisabledScreen(root, 'Withdraw USDT', rt.buySellReason);
        if (showOffPopup) setTimeout(() => buySellOffAlert(rt.buySellReason), 190);
        return;
      }
      screen(root, 'Withdraw USDT', `<div class="card"><p class="mut">Select your chain</p>
        <div class="row" style="border-color:var(--primary);cursor:default"><span class="rico l">${icon('wd')}</span><div class="rmid"><b>BSC</b><small>BNB Smart Chain (BEP20)</small></div><span class="badge ok">Selected</span></div>
        <div class="kv"><div><span>Available</span><b id="wdAvail">${fmt(bal.usdt)} USDT</b></div></div>
        <label class="field"><input id="amt" type="number" inputmode="decimal" placeholder="Amount in USDT" aria-label="Amount"><button class="mini" id="max">Max</button></label>
        <label class="field"><input id="addr" class="sm" placeholder="Paste your BSC (BEP20) wallet address" autocomplete="off" spellcheck="false" aria-label="Wallet address"></label>
        <p class="err" id="err" role="alert">${low ? `You need at least ${rt.minWithdraw} USDT to withdraw.` : ''}</p>
        <button class="btn" id="go">Confirm withdrawal</button></div>`);
      let reqId = makeReqId(), submitting = false;
      $('#amt', root).oninput = () => { reqId = makeReqId(); };
      $('#addr', root).oninput = () => { reqId = makeReqId(); };
      $('#max', root).onclick = () => { $('#amt', root).value = Math.floor(bal.usdt * 1e6) / 1e6; reqId = makeReqId(); };
      $('#go', root).onclick = async e => {
        if (submitting) return;
        if (rt.buySellEnabled === false) { renderWdForm(true); return; }
        const v = +$('#amt', root).value, a = $('#addr', root).value.trim(), err = $('#err', root); err.textContent = '';
        if (!(v > 0)) return err.textContent = 'Enter the amount you want to withdraw.';
        if (v < rt.minWithdraw) return err.textContent = `Minimum withdrawal is ${rt.minWithdraw} USDT.`;
        if (v > bal.usdt) return err.textContent = `Insufficient balance. You have ${fmt(bal.usdt)} USDT.`;
        if (!ADDR.test(a)) return err.textContent = 'Enter a valid BSC (BEP20) address. It starts with 0x and has 42 characters.';
        submitting = true;
        if (!await ask({ title: 'Confirm withdrawal', rows: [['Amount', v + ' USDT'], ['Network', 'BSC (BEP20)'], ['To address', a]], note: 'Check the address carefully. Crypto sent to a wrong address cannot be recovered.', ok: 'Withdraw' })) { submitting = false; return; }
        if (rt.buySellEnabled === false) { submitting = false; renderWdForm(true); return; }
        e.target.disabled = true;
        try { activeTradeSync = null; const o = await api().withdraw({ amount: v, address: a, reqId }); location.hash = '#/order/' + o.id; }
        catch (x) { submitting = false; err.textContent = msg(x); e.target.disabled = false; }
      };
    };
    activeTradeSync = (newRt, notify = true) => {
      const wasEnabled = rt.buySellEnabled !== false;
      rt = newRt;
      if (rt.buySellEnabled === false && (wasEnabled || $('#go', root))) { cancelOpenModal(); renderWdForm(notify); }
      else if (rt.buySellEnabled !== false && !wasEnabled && !$('#go', root)) { const okBtn = $('#myes'); if (okBtn && !$('#mno')) okBtn.click(); renderWdForm(false); if (notify) toast('Buy, Sell & Withdrawals are now enabled!'); }
    };
    renderWdForm(rt.buySellEnabled === false);
  }

  async function history(root, type) {
    activeOrderHook = null; activeTradeSync = null;
    const t = KIND[type] ? type : 'buy', names = { buy: 'Buy history', sell: 'Sell history', withdraw: 'Withdrawals' };
    screen(root, names[t], '<p class="empty">Loading…</p>');
    const list = await api().history(t);
    if (!list.length) return screen(root, names[t], '<p class="empty">Nothing here yet.</p>');
    screen(root, names[t], `<label class="field" style="margin-top:0;margin-bottom:12px"><input id="hq" class="sm" type="search" placeholder="Search by Order ID (e.g. #${esc(list[0].id)}), amount or status" autocomplete="off" spellcheck="false" aria-label="Search orders"></label><p class="mut" style="font-size:12.5px;margin-bottom:6px">Tap any order to view full details${t === 'buy' ? ' or resume an active QR payment' : ''}.</p><div id="hlist">${list.map(row).join('')}</div>`);
    const hq = $('#hq', root), hlist = $('#hlist', root);
    const filter = () => {
      const q = hq.value.trim().toUpperCase().replace(/^(ORDER|REQUEST|ID)?[\s#:-]+/, '');
      const hit = !q ? list : list.filter(x => {
        const stLbl = orderState(x).label.toUpperCase();
        return String(x.id || '').toUpperCase().includes(q) ||
          String(x.inr || '').includes(q) ||
          String(x.usdt || '').includes(q) ||
          String(x.upi || '').toUpperCase().includes(q) ||
          String(x.utr || '').toUpperCase().includes(q) ||
          String(x.address || '').toUpperCase().includes(q) ||
          String(x.txid || '').toUpperCase().includes(q) ||
          String(x.status || '').toUpperCase().includes(q) ||
          stLbl.includes(q);
      });
      hlist.innerHTML = hit.length ? hit.map(row).join('') : `<p class="empty">No orders match “${esc(hq.value.trim())}”.</p>`;
    };
    hq.oninput = filter;
  }
  function support(root) {
    screen(root, 'Contact support', `<div class="card"><p class="mut">Tell us what happened and share your order or request ID (for example #A7K2M9) so we can find it quickly.</p>
      <a class="btn tg" href="${esc(tg(cfg.SUPPORT_TELEGRAM))}" target="_blank" rel="noopener">${icon('send')}Chat on Telegram</a>
      <a class="btn ghost" href="mailto:${esc(cfg.SUPPORT_EMAIL)}">${icon('mail')}${esc(cfg.SUPPORT_EMAIL)}</a>
      <button type="button" class="btn ghost" id="commBtn">${icon('users')}Join our community</button></div>`);
    $('#commBtn', root).onclick = communitySoonAlert;
  }
  function account(root) {
    const u = BN.app.user();
    screen(root, 'Account', `<div class="card"><div class="kv" style="margin-top:0"><div><span>Account</span><b>${esc(u.email || u.phone || '')}</b></div><div><span>User ID</span><b>${esc(u.uid)}</b></div></div>
      <a class="btn ghost" href="#/password">${icon('lock')}${u.hasPassword ? 'Change password' : 'Set a password'}</a>
      <a class="btn ghost" href="#/support">${icon('help')}Contact support</a>
      <button type="button" class="btn ghost" id="commBtn">${icon('users')}Join our community</button>
      <button class="btn danger" id="out">${icon('logout')}Log out</button></div>`);
    $('#commBtn', root).onclick = communitySoonAlert;
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
  BN.screens = {
    home, buy, order, sell, deposit, withdraw, history, support, account, password, notifications,
    onLive(ev, root) {
      const [, name, arg] = (location.hash || '#/home').split('/');
      if (ev.type === 'settings' && ev.rates) {
        BN.state.rates = ev.rates;
        if (typeof ev.usdt === 'number') BN.state.balance = { usdt: ev.usdt };
        if (activeTradeSync) activeTradeSync(ev.rates, true);
        else if (!name || name === 'home') {
          if (BN.state.balance && BN.state.recent && BN.state.notifications) paintHome(root, BN.state);
          else api().home().then(d => { if (((location.hash || '#/home').split('/')[1] || 'home') === 'home') paintHome(root, d); }).catch(() => {});
        }
        return;
      }
      if (ev.type === 'order' && ev.order) {
        if (activeOrderHook) activeOrderHook(ev.order);
      }
      if (ev.type === 'order' || ev.type === 'sync') {
        if (name === 'order' && arg && activeOrderHook && (!ev.order || ev.order.id !== arg.toUpperCase())) {
          api().order(arg).then(o => { if (activeOrderHook) activeOrderHook(o); }).catch(() => {});
        }
        api().home().then(d => {
          const [, curName, curArg] = (location.hash || '#/home').split('/');
          if (!curName || curName === 'home') paintHome(root, d);
          else if (curName === 'buy' && $('#buyResumeSlot', root)) $('#buyResumeSlot', root).innerHTML = resumeBuyBanner(d.activeBuys || []);
          else if (curName === 'history') {
            const qEl = $('#hq', root), savedQ = qEl ? qEl.value : '';
            history(root, curArg).then(() => { const nq = $('#hq', root); if (nq && savedQ) { nq.value = savedQ; nq.dispatchEvent(new Event('input')); } }).catch(() => {});
          } else if (curName === 'notifications') notifications(root).catch(() => {});
          else if (curName === 'sell' && $('#sellAvail', root)) $('#sellAvail', root).textContent = fmt(d.balance.usdt);
          else if (curName === 'withdraw' && $('#wdAvail', root)) $('#wdAvail', root).textContent = fmt(d.balance.usdt) + ' USDT';
        }).catch(() => {});
      }
    }
  };
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
  let user = null, es = null, watchIv = null, reconnTm = null;

  function stopLive() {
    clearTimeout(reconnTm); reconnTm = null;
    if (es) { try { es.close(); } catch {} es = null; }
    clearInterval(watchIv); watchIv = null;
  }
  function startLive() {
    stopLive();
    if (!user || typeof EventSource === 'undefined') return;
    const connect = () => {
      if (!user) return;
      try {
        es = new EventSource('/api/v2/events');
        es.onmessage = e => {
          try {
            const ev = JSON.parse(e.data);
            if (ev.type === 'deactivated') { showAuth(ev.error); return; }
            if (BN.screens.onLive) BN.screens.onLive(ev, app);
          } catch {}
        };
        es.onerror = () => {
          if (es) { try { es.close(); } catch {} es = null; }
          if (user) { clearTimeout(reconnTm); reconnTm = setTimeout(connect, 3500); }
        };
      } catch {}
    };
    connect();
    // Lightweight fallback sync so Pending -> Processing timers and status updates show up even if a proxy buffers SSE
    const recentSig = list => JSON.stringify((list || []).map(x => [x.id, x.status, x.timerEndsAt, x.utr, x.hasQr, x.txid]));
    watchIv = setInterval(async () => {
      if (!user || document.hidden) return;
      try {
        const [, curName] = (location.hash || '#/home').split('/');
        const hasPending = (BN.state.recent || []).some(x => x.status === 'pending') || (BN.state.activeBuys || []).length > 0;
        if (!curName || curName === 'home' || curName === 'history' || hasPending) {
          const prevR = BN.state.rates ? JSON.stringify([BN.state.rates.buySellEnabled, BN.state.rates.buySellReason, BN.state.rates.cashQrEnabled]) : '';
          const prevO = recentSig(BN.state.recent);
          const prevB = BN.state.balance ? BN.state.balance.usdt : null;
          const d = await BN.api.home();
          const nextR = JSON.stringify([d.rates.buySellEnabled, d.rates.buySellReason, d.rates.cashQrEnabled]);
          if (prevR && prevR !== nextR && BN.screens.onLive) BN.screens.onLive({ type: 'settings', rates: d.rates, usdt: d.balance.usdt }, app);
          else if ((prevO && prevO !== recentSig(d.recent)) || (prevB !== null && prevB !== d.balance.usdt)) {
            if (!curName || curName === 'home') BN.screens.home(app);
            else if (curName === 'history' && BN.screens.onLive) BN.screens.onLive({ type: 'sync' }, app);
          }
          return;
        }
        const prev = BN.state.rates ? JSON.stringify([BN.state.rates.buySellEnabled, BN.state.rates.buySellReason, BN.state.rates.cashQrEnabled]) : '';
        const rt = await BN.api.rates();
        const next = JSON.stringify([rt.buySellEnabled, rt.buySellReason, rt.cashQrEnabled]);
        if (prev && prev !== next && BN.screens.onLive) BN.screens.onLive({ type: 'settings', rates: rt }, app);
      } catch {}
    }, 5000);
  }
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden && user && BN.screens.onLive) BN.screens.onLive({ type: 'sync' }, app);
  });

  function route() {
    if (!user) return;
    const [, name, arg] = (location.hash || '#/home').split('/');
    const fn = BN.screens[name] || BN.screens.home;
    Promise.resolve(fn(app, arg)).catch(e => toast(e.message || 'Something went wrong', true));
    window.scrollTo(0, 0);
  }
  function showAuth(errMsg) {
    user = null; stopLive();
    BN.state = { rates: null, balance: null, recent: null, activeBuys: null, notifications: null };
    app.hidden = true; auth.hidden = false;
    BN.auth.render(auth, (u, opts) => { user = u; auth.hidden = true; app.hidden = false; startLive(); location.hash = opts && opts.setPassword ? '#/password/forgot' : '#/home'; route(); });
    if (errMsg) toast(errMsg, true);
  }
  async function logout() { await BN.api.logout().catch(() => {}); showAuth(); }
  BN.app = { user: () => user, logout, expired: showAuth };
  window.addEventListener('hashchange', route);
  (async function boot() {
    let down = false;
    try { user = await BN.api.session(); } catch (e) { user = null; down = true; }
    if (user) { app.hidden = false; startLive(); route(); } else {
      showAuth();
      if (down) $('.acard', auth).insertAdjacentHTML('afterbegin', '<p class="err">Cannot reach the BlockNexa server. Start it with <b>npm start</b> and open the address it prints (like http://localhost:3000). Do not open this file directly.</p>');
    }
  })();
})();
