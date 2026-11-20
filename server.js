// BlockNexa: backend + site + admin panel in ONE project  |  Node 18+  |  SQLite (better-sqlite3)
// Run with: npm start   ->  site at /   admin panel at /admin
// SECTION 1 settings   2 database   3 helpers   4 login (Telegram code + Google)
//         5 user API   6 admin API   7 start
const fs = require('fs'), path = require('path'), crypto = require('crypto');

/* ============================ SECTION 1: SETTINGS ============================ */
for (const file of [path.join(__dirname, '.env'), '/etc/secrets/.env']) {       // tiny .env loader (real environment variables win)
  try {
    fs.readFileSync(file, 'utf8').split(/\r?\n/).forEach(l => {
      const m = l.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
      if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/\s+#.*$/, '').replace(/^["']|["']$/g, '');
    });
  } catch {}
}
const express = require('express'), Database = require('better-sqlite3'), QRCode = require('qrcode');
const env = (k, d = '') => (process.env[k] === undefined || process.env[k] === '' ? d : process.env[k]);
const num = (k, d) => { const v = Number(env(k, d)); return Number.isFinite(v) ? v : d; };
const CFG = {
  PORT: num('PORT', 3000),
  BUY_RATE: num('BUY_RATE', 102.5), SELL_RATE: num('SELL_RATE', 100),
  MIN_BUY_USDT: num('MIN_BUY_USDT', 5), MAX_BUY_INR: num('MAX_BUY_INR', 10000), MIN_SELL_USDT: num('MIN_SELL_USDT', 5), MIN_WITHDRAW: num('MIN_WITHDRAW', 5),
  UPI_ID: /^[\w.\-]{2,}@[\w.\-]{2,}$/.test(env('UPI_ID')) ? env('UPI_ID').toLowerCase() : '', UPI_NAME: env('UPI_NAME', 'BlockNexa').slice(0, 40),
  UPI_IDS: env('UPI_IDS', env('UPI_ID') || '123@upi,ishu@upi,example@upi').split(',').map(s => s.trim().toLowerCase()).filter(s => /^[\w.\-]{2,}@[\w.\-]{2,}$/.test(s)),
  DEPOSIT_ADDRESS: /^0x[a-fA-F0-9]{40}$/.test(env('DEPOSIT_ADDRESS')) ? env('DEPOSIT_ADDRESS') : '',
  GOOGLE_CLIENT_ID: env('GOOGLE_CLIENT_ID').trim(),
  OTP_TRANSPORT: env('OTP_TRANSPORT', env('TELEGRAM_SESSION') ? 'telegram' : 'console'),   // telegram | console (console only prints the code, for local testing)
  OTP_COOLDOWN_MS: num('OTP_COOLDOWN_SEC', 30) * 1000,
  ADMIN_KEY: env('ADMIN_KEY').trim() || crypto.randomBytes(18).toString('hex'),
  ADMIN_GATE_KEY: env('ADMIN_GATE_KEY').trim(),                                             // optional separate key required in ?key= to even see /admin
  ADMIN_PATH: env('ADMIN_PATH').trim().replace(/^\/+|\/+$/g, ''),                           // optional secret path instead of /admin (4-64 chars: a-z A-Z 0-9 _ -)
  ADMIN_IPS: env('ADMIN_IPS').split(',').map(s => s.trim()).filter(Boolean),                // optional: only these IPs may use the admin panel
  APP_SECRET: env('APP_SECRET') || crypto.randomBytes(32).toString('hex'),
  SESSION_DAYS: Math.max(7, num('SESSION_DAYS', 30)),                                       // how long a login lasts (never less than 7 days)
};
CFG.MIN_BUY_INR = Math.ceil(CFG.MIN_BUY_USDT * CFG.BUY_RATE);

/* ============================ SECTION 2: DATABASE ============================ */
const DATA_DIR = env('DATA_DIR', path.join(__dirname, 'data'));                              // on a host: point this at a persistent disk
fs.mkdirSync(DATA_DIR, { recursive: true });
const DB_FILE = path.join(DATA_DIR, 'blocknexa.db');
const db = new Database(DB_FILE);
db.pragma('journal_mode = WAL'); db.pragma('foreign_keys = ON');
db.exec(`
CREATE TABLE IF NOT EXISTS users(
  id INTEGER PRIMARY KEY, uid TEXT NOT NULL UNIQUE, phone TEXT UNIQUE, email TEXT UNIQUE, google_sub TEXT UNIQUE,
  created_at INTEGER NOT NULL, wd_suspended INTEGER NOT NULL DEFAULT 0, wd_reason TEXT, wd_suspended_at INTEGER);
CREATE TABLE IF NOT EXISTS sessions(token_hash TEXT PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id), created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS otps(phone TEXT PRIMARY KEY, code_hash TEXT, expires_at INTEGER NOT NULL DEFAULT 0, tries INTEGER NOT NULL DEFAULT 0,
  sent_at INTEGER NOT NULL, sends INTEGER NOT NULL, window_start INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS orders(                      -- buys, sells and withdrawals all live here
  id INTEGER PRIMARY KEY AUTOINCREMENT, public_id TEXT NOT NULL UNIQUE, user_id INTEGER NOT NULL REFERENCES users(id),
  type TEXT NOT NULL CHECK(type IN ('buy','sell','withdraw')), status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','success','failed')),
  inr REAL, rate REAL, usdt_micro INTEGER NOT NULL CHECK(usdt_micro > 0), utr TEXT, upi TEXT, address TEXT, chain TEXT, txid TEXT, fail_reason TEXT,
  created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL);
CREATE UNIQUE INDEX IF NOT EXISTS idx_orders_utr ON orders(utr) WHERE utr IS NOT NULL;   -- one UTR can only ever be used once
CREATE INDEX IF NOT EXISTS idx_orders_user ON orders(user_id, id);
CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status, type);
CREATE TABLE IF NOT EXISTS ledger(                      -- balance = SUM of this table. Money is never overwritten, only added to.
  id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL REFERENCES users(id), order_id INTEGER REFERENCES orders(id),
  type TEXT NOT NULL, usdt_micro INTEGER NOT NULL, reason TEXT, admin TEXT, created_at INTEGER NOT NULL);
CREATE INDEX IF NOT EXISTS idx_ledger_user ON ledger(user_id);
CREATE TABLE IF NOT EXISTS audit(id INTEGER PRIMARY KEY AUTOINCREMENT, at INTEGER NOT NULL, action TEXT NOT NULL, target TEXT, details TEXT);
CREATE TABLE IF NOT EXISTS upis(id INTEGER PRIMARY KEY AUTOINCREMENT, upi TEXT NOT NULL UNIQUE, active INTEGER NOT NULL DEFAULT 1, created_at INTEGER NOT NULL);
`);

{ // upgrade an older database: password column and the way each session was opened
  const cols = t => db.prepare(`PRAGMA table_info(${t})`).all().map(c => c.name);
  if (!cols('users').includes('password_hash')) db.exec('ALTER TABLE users ADD COLUMN password_hash TEXT');
  if (!cols('sessions').includes('method')) db.exec('ALTER TABLE sessions ADD COLUMN method TEXT');
  if (!cols('users').includes('deactivated')) db.exec('ALTER TABLE users ADD COLUMN deactivated INTEGER NOT NULL DEFAULT 0');
  if (!cols('users').includes('deactivate_reason')) db.exec('ALTER TABLE users ADD COLUMN deactivate_reason TEXT');
  if (!cols('users').includes('deactivated_at')) db.exec('ALTER TABLE users ADD COLUMN deactivated_at INTEGER');
}

/* ============================ SECTION 3: HELPERS ============================ */
const P = new Map(); const S = sql => { let s = P.get(sql); if (!s) { s = db.prepare(sql); P.set(sql, s); } return s; };
const now = () => Date.now(), micro = x => Math.round(Number(x) * 1e6), usdt = m => m / 1e6, f2 = m => (m / 1e6).toFixed(2);
const sha = x => crypto.createHash('sha256').update(x).digest('hex');
const hmac = x => crypto.createHmac('sha256', CFG.APP_SECRET).update(x).digest('hex');
const same = (a, b) => a.length === b.length && crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));
const ID_CHARS = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';                                          // no look-alike characters
const newOrderId = () => { for (;;) { const id = Array.from({ length: 6 }, () => ID_CHARS[crypto.randomInt(ID_CHARS.length)]).join(''); if (!S('SELECT 1 FROM orders WHERE public_id=?').get(id)) return id; } };
const newUid = () => { for (;;) { const u = 'BN-' + crypto.randomInt(100000, 1000000); if (!S('SELECT 1 FROM users WHERE uid=?').get(u)) return u; } };
const balance = userId => S('SELECT COALESCE(SUM(usdt_micro),0) b FROM ledger WHERE user_id=?').get(userId).b;
const addLedger = (userId, orderId, type, amt, reason, admin) => S('INSERT INTO ledger(user_id,order_id,type,usdt_micro,reason,admin,created_at) VALUES(?,?,?,?,?,?,?)').run(userId, orderId, type, amt, reason || null, admin || null, now());
const audit = (action, target, details) => S('INSERT INTO audit(at,action,target,details) VALUES(?,?,?,?)').run(now(), action, target || null, JSON.stringify(details || {}));
const reasonOf = b => { const r = String((b || {}).reason || '').trim().replace(/\s+/g, ' ').slice(0, 200); return r.length >= 3 ? r : ''; };
const item = o => ({ id: o.public_id, kind: o.type, status: o.status, at: o.created_at, usdt: usdt(o.usdt_micro), inr: o.inr, address: o.address, upi: o.upi, reason: o.fail_reason });
const upiLink = o => `upi://pay?pa=${o.upi || CFG.UPI_ID}&pn=${encodeURIComponent(CFG.UPI_NAME)}&am=${Number(o.inr).toFixed(2)}&cu=INR&tn=${encodeURIComponent('BN ' + o.public_id)}`;
{ // seed initial UPI pool (only when upis table is empty) and migrate any legacy buy orders onto upis
  const t = now();
  if (CFG.UPI_ID) S("UPDATE orders SET upi=? WHERE type='buy' AND (upi IS NULL OR upi='')").run(CFG.UPI_ID);
  if (!S('SELECT 1 FROM upis LIMIT 1').get()) {
    for (const u of CFG.UPI_IDS) S('INSERT OR IGNORE INTO upis(upi,active,created_at) VALUES(?,1,?)').run(u, t);
    for (const r of S("SELECT LOWER(upi) AS upi, MIN(created_at) AS first_at FROM orders WHERE type='buy' AND upi IS NOT NULL AND upi!='' GROUP BY LOWER(upi)").all()) {
      S('INSERT OR IGNORE INTO upis(upi,active,created_at) VALUES(?,1,?)').run(r.upi, r.first_at || t);
    }
  }
}
let lastPickedUpi = '';
const pickRandomUpi = () => {
  const pool = S('SELECT upi FROM upis WHERE active=1').all().map(r => r.upi);
  if (!pool.length) return CFG.UPI_ID || '';
  if (pool.length === 1) return (lastPickedUpi = pool[0]);
  const choices = pool.filter(u => u !== lastPickedUpi);
  const picked = choices[crypto.randomInt(choices.length)];
  return (lastPickedUpi = picked);
};

const app = express();
app.disable('x-powered-by');
if (process.env.TRUST_PROXY) app.set('trust proxy', Number(process.env.TRUST_PROXY) || true);   // set when behind Nginx / Cloudflare
app.use((req, res, next) => { res.set({ 'X-Content-Type-Options': 'nosniff', 'X-Frame-Options': 'DENY', 'Referrer-Policy': 'no-referrer' }); next(); });
app.use(express.json({ limit: '10kb' }));
const hits = new Map(); setInterval(() => hits.clear(), 600000).unref();
const limiter = (max, windowMs = 60000) => (req, res, next) => {
  const k = req.ip + req.path, t = now(), h = (hits.get(k) || []).filter(x => t - x < windowMs);
  if (h.length >= max) return res.status(429).json({ error: 'Too many requests. Please wait a minute and try again.' });
  h.push(t); hits.set(k, h); next();
};

/* ===================== SECTION 4: LOGIN (Telegram code + Google) ===================== */
const SESSION_MS = CFG.SESSION_DAYS * 24 * 3600 * 1000;     // a login lasts this long and is renewed while the user keeps coming back
const cookieOf = (req, n) => (req.headers.cookie || '').split(';').map(c => c.trim().split('=')).find(c => c[0] === n)?.[1];
const cookie = (req, token, ms) => `bn_session=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${Math.floor(ms / 1000)}; Expires=${new Date(now() + ms).toUTCString()}${req.secure ? '; Secure' : ''}`;
const blockedMsg = u => 'This account has been deactivated' + (u.deactivate_reason ? ': ' + u.deactivate_reason : '') + '. Please contact support.';
function startSession(req, res, userId, method) {      // returns false (and answers 403) if the account is deactivated
  const acc = S('SELECT deactivated, deactivate_reason FROM users WHERE id=?').get(userId);
  if (acc && acc.deactivated) { res.status(403).json({ error: blockedMsg(acc) }); return false; }
  const token = crypto.randomBytes(32).toString('hex'), t = now();
  S('DELETE FROM sessions WHERE expires_at<=?').run(t);
  S('INSERT INTO sessions(token_hash,user_id,created_at,expires_at,method) VALUES(?,?,?,?,?)').run(sha(token), userId, t, t + SESSION_MS, method);   // only a hash is stored
  res.append('Set-Cookie', cookie(req, token, SESSION_MS));
  return true;
}
const requireAuth = (req, res, next) => {
  const tok = cookieOf(req, 'bn_session'), t = now();
  const u = tok && S('SELECT u.*, s.method AS s_method, s.created_at AS s_created, s.expires_at AS s_expires, s.token_hash AS s_hash FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token_hash=? AND s.expires_at>?').get(sha(tok), t);
  if (!u) return res.status(401).json({ error: 'Please log in.' });
  if (u.deactivated) { S('DELETE FROM sessions WHERE user_id=?').run(u.id); return res.status(401).json({ error: blockedMsg(u) }); }
  if (u.s_expires - t < SESSION_MS / 2) { S('UPDATE sessions SET expires_at=? WHERE token_hash=?').run(t + SESSION_MS, u.s_hash); res.append('Set-Cookie', cookie(req, tok, SESSION_MS)); }   // renew when half used
  req.user = u; next();
};
const me = u => ({ uid: u.uid, email: u.email || undefined, phone: u.phone || undefined, hasPassword: !!u.password_hash });
const createUser = f => S('SELECT * FROM users WHERE id=?').get(S('INSERT INTO users(uid,phone,email,google_sub,password_hash,created_at) VALUES(?,?,?,?,?,?)').run(newUid(), f.phone || null, f.email || null, f.google_sub || null, f.password_hash || null, now()).lastInsertRowid);
const scrypt = require('util').promisify(crypto.scrypt);
const hashPw = async pw => { const salt = crypto.randomBytes(16); return 'scrypt$' + salt.toString('hex') + '$' + (await scrypt(pw, salt, 64)).toString('hex'); };
const checkPw = async (pw, stored) => {
  const [, sl, h] = String(stored || '').split('$');
  if (!sl || !h) { await scrypt(pw, Buffer.alloc(16), 64); return false; }                 // same work for unknown numbers, so timing gives nothing away
  return same((await scrypt(pw, Buffer.from(sl, 'hex'), 64)).toString('hex'), h);
};
const pwOk = p => typeof p === 'string' && p.length >= 8 && p.length <= 128;

// Sends the one-time code. "telegram" = from YOUR dedicated Telegram account (API ID + hash). "console" = prints it (local testing only).
async function sendOtp(phone, code) {
  const text = `Your BlockNexa code is ${code}. It expires in 5 minutes. Never share it with anyone, our team will never ask for it.`;
  if (CFG.OTP_TRANSPORT === 'console') { console.log(`[OTP console] ${phone} -> ${code}`); return; }
  await require('./otp-telegram').send(phone, text);
}
const inflight = new Set();
const V = express.Router();            // everything the app uses lives under /api/v2

V.post('/auth/otp/request', limiter(15), async (req, res) => {
  const phone = String((req.body || {}).phone || ''), mode = (req.body || {}).mode;
  if (!/^\+91[6-9]\d{9}$/.test(phone)) return res.status(400).json({ error: 'Enter a valid 10-digit Indian mobile number.' });
  if (mode !== 'register' && mode !== 'login') return res.status(400).json({ error: 'Bad request.' });
  const exists = !!S('SELECT 1 FROM users WHERE phone=?').get(phone);
  if (mode === 'register' && exists) return res.status(409).json({ error: 'This number is already registered. Please log in.' });
  if (mode === 'login' && !exists) return res.status(404).json({ error: 'No account found for this number. Please register first.' });
  if (inflight.has(phone)) return res.status(429).json({ error: 'Please wait a moment.' });
  const t = now(), r = S('SELECT * FROM otps WHERE phone=?').get(phone);
  let sends = 1, ws = t;
  if (r) {
    if (t - r.sent_at < CFG.OTP_COOLDOWN_MS) return res.status(429).json({ error: `Please wait ${Math.ceil(CFG.OTP_COOLDOWN_MS / 1000)} seconds before asking for another code.` });
    if (t - r.window_start < 3600000) { if (r.sends >= 5) return res.status(429).json({ error: 'Too many codes requested. Try again in an hour.' }); sends = r.sends + 1; ws = r.window_start; }
  }
  const code = String(crypto.randomInt(0, 1000000)).padStart(6, '0');
  inflight.add(phone);
  try { await sendOtp(phone, code); }
  catch (e) { console.error('OTP send failed:', e.message); return res.status(400).json({ error: 'We could not send a code to this number on Telegram. Check that it has a Telegram account and try again.' }); }
  finally { inflight.delete(phone); }
  S('INSERT INTO otps(phone,code_hash,expires_at,tries,sent_at,sends,window_start) VALUES(?,?,?,0,?,?,?) ON CONFLICT(phone) DO UPDATE SET code_hash=excluded.code_hash,expires_at=excluded.expires_at,tries=0,sent_at=excluded.sent_at,sends=excluded.sends,window_start=excluded.window_start')
    .run(phone, hmac(phone + ':' + code), t + 300000, t, sends, ws);
  res.json({ status: 'sent' });
});

V.post('/auth/otp/verify', limiter(30), async (req, res) => {
  const b = req.body || {}, phone = String(b.phone || ''), code = String(b.code || ''), mode = b.mode;
  const bad = msg => res.status(400).json({ error: msg || 'Invalid or expired code. Please request a new one.' });
  if (!/^\+91[6-9]\d{9}$/.test(phone) || !/^\d{6}$/.test(code) || (mode !== 'register' && mode !== 'login')) return bad();
  if (mode === 'register' && !pwOk(b.password)) return res.status(400).json({ error: 'Choose a password with 8 to 128 characters.' });   // checked before the code is used up
  const r = S('SELECT * FROM otps WHERE phone=?').get(phone);
  if (!r || !r.code_hash || r.expires_at < now()) return bad();
  if (r.tries >= 3) { S('UPDATE otps SET code_hash=NULL WHERE phone=?').run(phone); return bad(); }          // 3 wrong guesses destroy the code
  if (!same(hmac(phone + ':' + code), r.code_hash)) { S('UPDATE otps SET tries=tries+1 WHERE phone=?').run(phone); return bad('Wrong code. Please try again.'); }
  S('UPDATE otps SET code_hash=NULL, expires_at=0 WHERE phone=?').run(phone);                              // a code works once
  let u = S('SELECT * FROM users WHERE phone=?').get(phone);
  if (mode === 'register') { if (u) return res.status(409).json({ error: 'This number is already registered. Please log in.' }); u = createUser({ phone, password_hash: await hashPw(b.password) }); }
  else if (!u) return res.status(404).json({ error: 'No account found for this number. Please register first.' });
  if (startSession(req, res, u.id, 'otp')) res.json(me(u));
});

// ---- Log in with phone + password (no code needed)
const pwFails = new Map(); setInterval(() => pwFails.clear(), 900000).unref();
V.post('/auth/login/password', limiter(30), async (req, res) => {
  const b = req.body || {}, phone = String(b.phone || ''), pw = String(b.password || '').slice(0, 200);
  const bad = () => res.status(401).json({ error: 'Wrong number or password. You can also log in with a Telegram code.' });
  if (!/^\+91[6-9]\d{9}$/.test(phone)) return bad();
  const t = now(), f = (pwFails.get(phone) || []).filter(x => t - x < 900000); pwFails.set(phone, f);
  if (f.length >= 5) return res.status(429).json({ error: 'Too many wrong attempts. Wait 15 minutes, or log in with a Telegram code.' });
  const u = S('SELECT * FROM users WHERE phone=?').get(phone);
  if (!(await checkPw(pw, u && u.password_hash)) || !u) { f.push(t); return bad(); }
  pwFails.delete(phone); if (startSession(req, res, u.id, 'password')) res.json(me(u));
});

// ---- Continue with Google: we check Google's signed token ourselves (signature, audience, expiry, verified email)
const JWKS_URL = env('GOOGLE_JWKS_URL', 'https://www.googleapis.com/oauth2/v3/certs');
let jwks = { keys: [], at: 0 };
async function googleKeys(force) {
  if (!force && jwks.keys.length && now() - jwks.at < 3600000) return jwks.keys;
  const r = await fetch(JWKS_URL); if (!r.ok) throw new Error('keys');
  jwks = { keys: (await r.json()).keys || [], at: now() }; return jwks.keys;
}
async function verifyGoogle(token) {
  const parts = String(token || '').split('.'); if (parts.length !== 3) throw new Error('format');
  const dec = x => Buffer.from(x, 'base64url'), header = JSON.parse(dec(parts[0])), p = JSON.parse(dec(parts[1]));
  if (header.alg !== 'RS256') throw new Error('alg');
  const key = (await googleKeys()).find(k => k.kid === header.kid) || (await googleKeys(true)).find(k => k.kid === header.kid);
  if (!key || !crypto.verify('RSA-SHA256', Buffer.from(parts[0] + '.' + parts[1]), crypto.createPublicKey({ key, format: 'jwk' }), dec(parts[2]))) throw new Error('signature');
  if (!['https://accounts.google.com', 'accounts.google.com'].includes(p.iss) || p.aud !== CFG.GOOGLE_CLIENT_ID || !(p.exp > now() / 1000 - 30)) throw new Error('claims');
  if (!p.sub || !p.email || !(p.email_verified === true || p.email_verified === 'true')) throw new Error('email');
  return p;
}
V.post('/auth/google', limiter(20), async (req, res) => {
  if (!CFG.GOOGLE_CLIENT_ID) return res.status(503).json({ error: 'Google sign-in is not set up yet.' });
  const fail = () => res.status(401).json({ error: 'Google sign-in failed. Please try again.' });
  let g; try { g = await verifyGoogle((req.body || {}).credential); } catch { return fail(); }
  const email = String(g.email).toLowerCase();
  if (!/^[^\s@<>"'&]+@[^\s@<>"'&]+\.[^\s@<>"'&]+$/.test(email) || email.length > 254) return fail();
  let u = S('SELECT * FROM users WHERE google_sub=?').get(g.sub) || S('SELECT * FROM users WHERE email=?').get(email);
  if (u && u.google_sub && u.google_sub !== g.sub) return fail();
  if (!u) u = createUser({ email, google_sub: g.sub }); else if (!u.google_sub) S('UPDATE users SET google_sub=? WHERE id=?').run(g.sub, u.id);
  if (startSession(req, res, u.id, 'google')) res.json(me(u));
});
V.post('/auth/logout', (req, res) => {
  const tok = cookieOf(req, 'bn_session'); if (tok) S('DELETE FROM sessions WHERE token_hash=?').run(sha(tok));
  res.append('Set-Cookie', 'bn_session=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0'); res.json({ ok: true });
});

/* ============================ SECTION 5: USER API ============================ */
V.get('/rates', (req, res) => res.json({ buy: CFG.BUY_RATE, sell: CFG.SELL_RATE, minBuyUsdt: CFG.MIN_BUY_USDT, maxBuyInr: CFG.MAX_BUY_INR, minSellUsdt: CFG.MIN_SELL_USDT, minWithdraw: CFG.MIN_WITHDRAW, googleClientId: CFG.GOOGLE_CLIENT_ID }));
V.use(['/me', '/account', '/balance', '/history', '/buy', '/sell', '/withdraw', '/deposit'], requireAuth);
V.get('/me', (req, res) => res.json(me(req.user)));
V.post('/account/password', limiter(10), async (req, res) => {
  const b = req.body || {}, u = req.user, t = now(), cur = String(b.current || '').slice(0, 200);
  if (!pwOk(b.next)) return res.status(400).json({ error: 'The new password must have 8 to 128 characters.' });
  const freshCode = u.s_method === 'otp' && t - u.s_created < 600000;            // logged in with a Telegram code in the last 10 minutes (the "forgot password" path)
  if (u.password_hash && !freshCode && !(await checkPw(cur, u.password_hash))) return res.status(400).json({ error: 'Your current password is wrong.' });
  S('UPDATE users SET password_hash=? WHERE id=?').run(await hashPw(b.next), u.id);
  S('DELETE FROM sessions WHERE user_id=? AND token_hash!=?').run(u.id, u.s_hash);   // every other device is logged out
  res.json({ ok: true });
});
V.get('/balance', (req, res) => res.json({ usdt: usdt(balance(req.user.id)) }));
V.get('/deposit', (req, res) => res.json(CFG.DEPOSIT_ADDRESS ? [{ short: 'BSC', name: 'BNB Smart Chain (BEP20)', address: CFG.DEPOSIT_ADDRESS }] : []));
V.get('/history/:type', (req, res) => {
  const t = req.params.type;
  if (t === 'all') return res.json(S('SELECT * FROM orders WHERE user_id=? ORDER BY id DESC LIMIT 6').all(req.user.id).map(item));
  if (!['buy', 'sell', 'withdraw'].includes(t)) return res.status(404).json({ error: 'Not found.' });
  res.json(S('SELECT * FROM orders WHERE user_id=? AND type=? ORDER BY id DESC LIMIT 100').all(req.user.id, t).map(item));
});

V.post('/buy', limiter(20), (req, res) => {
  const inr = Number((req.body || {}).inr), upi = pickRandomUpi();
  if (!upi) return res.status(503).json({ error: 'Payments are not set up yet. Please contact support.' });
  if (!Number.isInteger(inr) || inr < CFG.MIN_BUY_INR || inr > CFG.MAX_BUY_INR) return res.status(400).json({ error: `Enter a whole amount between ₹${CFG.MIN_BUY_INR} and ₹${CFG.MAX_BUY_INR}.` });
  if (S("SELECT COUNT(*) c FROM orders WHERE user_id=? AND type='buy' AND status='pending'").get(req.user.id).c >= 5) return res.status(429).json({ error: 'You already have 5 buy orders waiting. Finish or wait for them first.' });
  const pid = newOrderId(), t = now();
  S("INSERT INTO orders(public_id,user_id,type,inr,rate,usdt_micro,upi,created_at,updated_at) VALUES(?,?,'buy',?,?,?,?,?,?)").run(pid, req.user.id, inr, CFG.BUY_RATE, Math.round(inr * 1e6 / CFG.BUY_RATE), upi, t, t);
  res.status(201).json({ ...item(S('SELECT * FROM orders WHERE public_id=?').get(pid)), upi });
});
V.post('/buy/:id/paid', limiter(20), (req, res) => {
  const o = S("SELECT * FROM orders WHERE public_id=? AND user_id=? AND type='buy'").get(String(req.params.id).toUpperCase(), req.user.id);
  if (!o) return res.status(404).json({ error: 'Order not found.' });
  const utr = String((req.body || {}).utr || '').trim();
  if (!/^\d{12}$/.test(utr)) return res.status(400).json({ error: 'Enter the 12-digit UPI reference number (UTR) from your payment app.' });
  try { if (S("UPDATE orders SET utr=?, updated_at=? WHERE id=? AND status='pending'").run(utr, now(), o.id).changes !== 1) return res.status(409).json({ error: 'This order is no longer waiting for payment.' }); }
  catch { return res.status(409).json({ error: 'This reference number was already used on another order.' }); }
  res.json({ ok: true });
});
V.get('/buy/:id/qr.svg', async (req, res) => {
  const o = S("SELECT * FROM orders WHERE public_id=? AND user_id=? AND type='buy' AND status='pending'").get(String(req.params.id).toUpperCase(), req.user.id);
  if (!o || !(o.upi || CFG.UPI_ID)) return res.sendStatus(404);
  res.set({ 'Content-Type': 'image/svg+xml', 'Cache-Control': 'no-store' });
  res.send(await QRCode.toString(upiLink(o), { type: 'svg', margin: 2, errorCorrectionLevel: 'M' }));
});

// Sells and withdrawals take the USDT out of the balance straight away ("hold"). A failure gives it back.
const createOut = db.transaction((user, type, m, x) => {
  const fresh = S('SELECT * FROM users WHERE id=?').get(user.id);
  if (fresh.wd_suspended) return { err: 'Withdrawals and sales are paused for your account. Please contact support.', code: 403 };
  const bal = balance(user.id);
  if (bal < m) return { err: `Insufficient balance. You have ${f2(bal)} USDT.`, code: 400 };
  const pid = newOrderId(), t = now();
  const r = S('INSERT INTO orders(public_id,user_id,type,usdt_micro,inr,rate,upi,address,chain,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)')
    .run(pid, user.id, type, m, x.inr || null, x.rate || null, x.upi || null, x.address || null, x.chain || null, t, t);
  addLedger(user.id, r.lastInsertRowid, type === 'sell' ? 'sell_hold' : 'withdraw_hold', -m);
  return { order: S('SELECT * FROM orders WHERE id=?').get(r.lastInsertRowid) };
});
V.post('/sell', limiter(20), (req, res) => {
  const b = req.body || {}, v = Number(b.usdt), upi = String(b.upi || '').trim();
  if (!(v >= CFG.MIN_SELL_USDT)) return res.status(400).json({ error: `Minimum sale is ${CFG.MIN_SELL_USDT} USDT.` });
  if (!/^[\w.\-]{2,}@[\w.\-]{2,}$/.test(upi)) return res.status(400).json({ error: 'Enter a valid UPI ID, like name@bank.' });
  const r = createOut(req.user, 'sell', micro(v), { inr: Math.round(v * CFG.SELL_RATE * 100) / 100, rate: CFG.SELL_RATE, upi });
  if (r.err) return res.status(r.code).json({ error: r.err });
  res.status(201).json(item(r.order));
});
V.post('/withdraw', limiter(20), (req, res) => {
  const b = req.body || {}, v = Number(b.amount), address = String(b.address || '').trim();
  if (b.chain !== 'bsc') return res.status(400).json({ error: 'Select a supported chain.' });
  if (!/^0x[a-fA-F0-9]{40}$/.test(address)) return res.status(400).json({ error: 'Enter a valid BSC (BEP20) address. It starts with 0x and has 42 characters.' });
  if (!(v >= CFG.MIN_WITHDRAW)) return res.status(400).json({ error: `Minimum withdrawal is ${CFG.MIN_WITHDRAW} USDT.` });
  const r = createOut(req.user, 'withdraw', micro(v), { address, chain: 'bsc' });
  if (r.err) return res.status(r.code).json({ error: r.err });
  res.status(201).json(item(r.order));
});
app.use('/api/v2', V);

/* ============================ SECTION 6: ADMIN API ============================ */
const A = express.Router();
const cleanIp = ip => String(ip || '').replace(/^::ffff:/, '');
const ipOk = (req, res, next) => (CFG.ADMIN_IPS.length && !CFG.ADMIN_IPS.map(cleanIp).includes(cleanIp(req.ip))) ? res.sendStatus(404) : next();
const keyFails = new Map(); setInterval(() => keyFails.clear(), 900000).unref();
const adminAuth = (req, res, next) => {
  if ((keyFails.get(req.ip) || 0) >= 10) return res.status(429).json({ error: 'Too many wrong keys. Try again in 15 minutes.' });
  const a = Buffer.from(String(req.get('x-admin-key') || '')), b = Buffer.from(CFG.ADMIN_KEY);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) { keyFails.set(req.ip, (keyFails.get(req.ip) || 0) + 1); return res.status(401).json({ error: 'Wrong admin key.' }); }
  next();
};
A.use(ipOk, limiter(240), adminAuth);
const userView = u => ({ uid: u.uid, email: u.email, phone: u.phone, createdAt: u.created_at, suspended: !!u.wd_suspended, suspendReason: u.wd_reason, suspendedAt: u.wd_suspended_at, balance: usdt(balance(u.id)) });
const orderView = o => { const u = S('SELECT * FROM users WHERE id=?').get(o.user_id); return { ...item(o), utr: o.utr, txid: o.txid, chain: o.chain, rate: o.rate, updatedAt: o.updated_at, user: { uid: u.uid, email: u.email, phone: u.phone } }; };

A.get('/ping', (req, res) => res.json({ ok: true }));
A.get('/find', (req, res) => {
  const raw = String(req.query.q || '').trim().slice(0, 80); if (!raw) return res.json({ kind: 'none' });
  const up = raw.toUpperCase(), digits = raw.replace(/\D/g, '');
  let u, o;
  if (/^BN-?\d{6}$/.test(up)) u = S('SELECT * FROM users WHERE uid=?').get('BN-' + up.replace(/\D/g, ''));
  else if (/^\d{12}$/.test(raw)) o = S('SELECT * FROM orders WHERE utr=?').get(raw);
  else if (/^[A-Z0-9]{6}$/.test(up)) { o = S('SELECT * FROM orders WHERE public_id=?').get(up); if (!o && /^\d{6}$/.test(up)) u = S('SELECT * FROM users WHERE uid=?').get('BN-' + up); }
  if (o) return res.json({ kind: 'order', order: orderView(o) });
  if (u) return res.json({ kind: 'user', uid: u.uid });
  const like = '%' + raw.toLowerCase().replace(/[%_]/g, '') + '%', ph = digits.length >= 6 ? '%' + digits + '%' : 'no-phone-match';
  const list = S('SELECT * FROM users WHERE LOWER(COALESCE(email,\'\')) LIKE ? OR phone LIKE ? ORDER BY id DESC LIMIT 20').all(like, ph);
  if (list.length === 1) return res.json({ kind: 'user', uid: list[0].uid });
  res.json(list.length ? { kind: 'users', users: list.map(x => ({ uid: x.uid, email: x.email, phone: x.phone })) } : { kind: 'none' });
});
A.get('/user/:uid', (req, res) => {
  const u = S('SELECT * FROM users WHERE uid=?').get(String(req.params.uid).toUpperCase());
  if (!u) return res.status(404).json({ error: 'User not found.' });
  res.json({
    user: userView(u),
    history: S('SELECT * FROM orders WHERE user_id=? ORDER BY id DESC LIMIT 300').all(u.id).map(orderView),
    adjustments: S("SELECT usdt_micro, reason, created_at FROM ledger WHERE user_id=? AND type='adjustment' ORDER BY id DESC LIMIT 20").all(u.id).map(x => ({ amount: usdt(x.usdt_micro), reason: x.reason, at: x.created_at })),
    audit: S('SELECT at, action, details FROM audit WHERE target=? ORDER BY id DESC LIMIT 20').all(u.uid).map(x => ({ at: x.at, action: x.action, details: JSON.parse(x.details || '{}') })),
  });
});
A.get('/pending', (req, res) => res.json(S("SELECT * FROM orders WHERE status='pending' ORDER BY (utr IS NULL AND type='buy'), id").all().map(orderView)));
A.get('/audit', (req, res) => res.json(S('SELECT at, action, target, details FROM audit ORDER BY id DESC LIMIT 100').all().map(x => ({ at: x.at, action: x.action, target: x.target, details: JSON.parse(x.details || '{}') }))));

// Change an order's status. Money moves are written to the ledger inside one transaction, so nothing can be credited twice.
const setStatus = db.transaction((pid, to, reason, txid) => {
  const o = S('SELECT * FROM orders WHERE public_id=?').get(pid);
  if (!o) return { err: 'Order not found.', code: 404 };
  if (o.status === to) return { err: `This order is already ${to}.`, code: 409 };
  if (o.type !== 'buy' && o.status !== 'pending') return { err: 'Only pending sells and withdrawals can be updated. Use Edit balance for corrections.', code: 409 };
  if (o.type === 'buy') {
    if (to === 'success') addLedger(o.user_id, o.id, 'buy_credit', o.usdt_micro, null, 'admin');
    else if (o.status === 'success') {                      // success -> failed: take the credit back
      if (balance(o.user_id) < o.usdt_micro) return { err: 'The user has already spent this USDT. Use Edit balance to correct it instead.', code: 409 };
      addLedger(o.user_id, o.id, 'buy_reversal', -o.usdt_micro, reason, 'admin');
    }
  } else if (to === 'failed') addLedger(o.user_id, o.id, o.type === 'sell' ? 'sell_refund' : 'withdraw_refund', o.usdt_micro, reason, 'admin');
  S('UPDATE orders SET status=?, fail_reason=?, txid=COALESCE(?,txid), updated_at=? WHERE id=?').run(to, to === 'failed' ? reason : null, txid || null, now(), o.id);
  audit('order_' + to, S('SELECT uid FROM users WHERE id=?').get(o.user_id).uid, { order: o.public_id, type: o.type, from: o.status, reason: reason || undefined, txid: txid || undefined });
  return { order: S('SELECT * FROM orders WHERE id=?').get(o.id) };
});
A.post('/orders/:id/status', (req, res) => {
  const to = (req.body || {}).status, reason = reasonOf(req.body), txid = String((req.body || {}).txid || '').trim();
  if (!['success', 'failed'].includes(to)) return res.status(400).json({ error: 'Status must be success or failed.' });
  if (to === 'failed' && !reason) return res.status(400).json({ error: 'Write a short reason (at least 3 characters). The user will see it.' });
  if (txid && !/^0x[a-fA-F0-9]{64}$/.test(txid)) return res.status(400).json({ error: 'That transaction hash does not look right (0x + 64 characters).' });
  const r = setStatus(String(req.params.id).toUpperCase(), to, reason, txid);
  if (r.err) return res.status(r.code).json({ error: r.err });
  res.json({ order: orderView(r.order) });
});

const editBalance = db.transaction((u, newMicro, expectedMicro, reason) => {
  const cur = balance(u.id);
  if (expectedMicro !== null && expectedMicro !== cur) return { err: 'This balance just changed. Reload the user and try again.', code: 409 };
  const delta = newMicro - cur; if (delta === 0) return { err: 'The balance is already that amount.', code: 400 };
  addLedger(u.id, null, 'adjustment', delta, reason, 'admin');
  audit('balance_edit', u.uid, { from: usdt(cur), to: usdt(newMicro), change: usdt(delta), reason });
  return { balance: usdt(newMicro), change: usdt(delta) };
});
A.post('/user/:uid/balance', (req, res) => {
  const u = S('SELECT * FROM users WHERE uid=?').get(String(req.params.uid).toUpperCase()); if (!u) return res.status(404).json({ error: 'User not found.' });
  const b = req.body || {}, nb = Number(b.newBalance), reason = reasonOf(b);
  if (!Number.isFinite(nb) || nb < 0 || nb > 1e7) return res.status(400).json({ error: 'Enter a valid new balance (0 or more).' });
  if (!reason) return res.status(400).json({ error: 'Write a short reason for this change.' });
  const r = editBalance(u, micro(nb), b.expected === undefined ? null : micro(b.expected), reason);
  if (r.err) return res.status(r.code).json({ error: r.err }); res.json(r);
});
A.post('/user/:uid/suspend', (req, res) => {
  const u = S('SELECT * FROM users WHERE uid=?').get(String(req.params.uid).toUpperCase()); if (!u) return res.status(404).json({ error: 'User not found.' });
  const reason = reasonOf(req.body); if (!reason) return res.status(400).json({ error: 'Write a short reason.' });
  S('UPDATE users SET wd_suspended=1, wd_reason=?, wd_suspended_at=? WHERE id=?').run(reason, now(), u.id);
  audit('suspend_withdrawals', u.uid, { reason }); res.json({ ok: true });
});
A.post('/user/:uid/unsuspend', (req, res) => {
  const u = S('SELECT * FROM users WHERE uid=?').get(String(req.params.uid).toUpperCase()); if (!u) return res.status(404).json({ error: 'User not found.' });
  S('UPDATE users SET wd_suspended=0, wd_reason=NULL, wd_suspended_at=NULL WHERE id=?').run(u.id);
  audit('lift_suspension', u.uid, { reason: reasonOf(req.body) || undefined }); res.json({ ok: true });
});
A.get('/backup', async (req, res) => {                                         // a safe copy of the whole database
  const tmp = path.join(DATA_DIR, `backup-${now()}.db`);
  try { await db.backup(tmp); audit('backup', null, {}); res.download(tmp, `blocknexa-backup-${new Date().toISOString().slice(0, 10)}.db`, () => fs.unlink(tmp, () => {})); }
  catch { fs.unlink(tmp, () => {}); res.status(500).json({ error: 'Backup failed.' }); }
});

// All users list (for Userbase tab). ?q= searches user ID, email and phone; ?page= pages through 50 at a time.
A.get('/users', (req, res) => {
  const page = Math.max(0, parseInt(req.query.page) || 0);
  const limit = 50;
  const q = String(req.query.q || '').trim().slice(0, 80).toLowerCase().replace(/[%_\\]/g, '');
  const where = q ? "WHERE LOWER(uid) LIKE ? OR LOWER(COALESCE(email,'')) LIKE ? OR COALESCE(phone,'') LIKE ?" : '';
  const args = q ? Array(3).fill('%' + q + '%') : [];
  const rows = S(`SELECT * FROM users ${where} ORDER BY id DESC LIMIT ? OFFSET ?`).all(...args, limit, page * limit);
  const total = S(`SELECT COUNT(*) c FROM users ${where}`).get(...args).c;
  res.json({
    total,
    page,
    q,
    users: rows.map(u => ({
      uid: u.uid,
      email: u.email || null,
      phone: u.phone || null,
      createdAt: u.created_at,
      suspended: !!u.wd_suspended,
      deactivated: !!u.deactivated,
      deactivatedAt: u.deactivated_at || null,
      deactivateReason: u.deactivate_reason || null,
    }))
  });
});

// Deactivate a user account (admin action)
A.post('/user/:uid/deactivate', (req, res) => {
  const u = S('SELECT * FROM users WHERE uid=?').get(String(req.params.uid).toUpperCase());
  if (!u) return res.status(404).json({ error: 'User not found.' });
  const reason = reasonOf(req.body);
  if (!reason) return res.status(400).json({ error: 'Write a short reason for deactivation.' });
  if (u.deactivated) return res.status(409).json({ error: 'This account is already deactivated.' });
  S('UPDATE users SET deactivated=1, deactivate_reason=?, deactivated_at=? WHERE id=?').run(reason, now(), u.id);
  S('DELETE FROM sessions WHERE user_id=?').run(u.id);                          // log them out everywhere right away
  audit('deactivate_user', u.uid, { reason });
  res.json({ ok: true });
});

// Reactivate a user account (admin action)
A.post('/user/:uid/reactivate', (req, res) => {
  const u = S('SELECT * FROM users WHERE uid=?').get(String(req.params.uid).toUpperCase());
  if (!u) return res.status(404).json({ error: 'User not found.' });
  if (!u.deactivated) return res.status(409).json({ error: 'This account is not deactivated.' });
  S('UPDATE users SET deactivated=0, deactivate_reason=NULL, deactivated_at=NULL WHERE id=?').run(u.id);
  audit('reactivate_user', u.uid, { reason: reasonOf(req.body) || undefined });
  res.json({ ok: true });
});

// ==================== UPI RANDOMNESS & TRANSACTION LOG ====================
const upiSummary = u => {
  const s = S("SELECT COALESCE(SUM(inr),0) AS totalInr, COALESCE(SUM(usdt_micro),0) AS totalUsdtMicro, COUNT(*) AS count, MAX(updated_at) AS lastAt FROM orders WHERE type='buy' AND status='success' AND LOWER(upi)=LOWER(?)").get(u.upi);
  const p = S("SELECT COUNT(*) AS c FROM orders WHERE type='buy' AND status='pending' AND LOWER(upi)=LOWER(?)").get(u.upi);
  return { id: u.id, upi: u.upi, active: !!u.active, createdAt: u.created_at, totalCollected: Math.round((s.totalInr || 0) * 100) / 100, totalUsdt: usdt(s.totalUsdtMicro || 0), count: s.count || 0, pendingCount: p.c || 0, lastAt: s.lastAt || null };
};
A.get('/upis', (req, res) => {
  const upis = S('SELECT * FROM upis ORDER BY active DESC, id ASC').all().map(upiSummary);
  res.json({
    upis,
    totalCollected: Math.round(upis.reduce((a, x) => a + x.totalCollected, 0) * 100) / 100,
    totalCount: upis.reduce((a, x) => a + x.count, 0),
  });
});
A.post('/upis', (req, res) => {
  const upi = String((req.body || {}).upi || '').trim().toLowerCase();
  if (!/^[\w.\-]{2,}@[\w.\-]{2,}$/.test(upi)) return res.status(400).json({ error: 'Enter a valid UPI ID, like name@upi.' });
  if (S('SELECT 1 FROM upis WHERE LOWER(upi)=?').get(upi)) return res.status(409).json({ error: 'This UPI ID is already in the list.' });
  const t = now(), exclusive = !!(req.body || {}).exclusive;
  if (exclusive) S('UPDATE upis SET active=0').run();
  S('INSERT INTO upis(upi,active,created_at) VALUES(?,1,?)').run(upi, t);
  audit('upi_add', upi, { exclusive });
  res.status(201).json(upiSummary(S('SELECT * FROM upis WHERE LOWER(upi)=?').get(upi)));
});
A.post('/upis/only', (req, res) => {
  const upi = String((req.body || {}).upi || '').trim().toLowerCase();
  const row = S('SELECT * FROM upis WHERE LOWER(upi)=?').get(upi);
  if (!row) return res.status(404).json({ error: 'UPI ID not found.' });
  S('UPDATE upis SET active = CASE WHEN id=? THEN 1 ELSE 0 END').run(row.id);
  audit('upi_use_only', row.upi, {});
  res.json(upiSummary(S('SELECT * FROM upis WHERE id=?').get(row.id)));
});
A.post('/upis/toggle', (req, res) => {
  const upi = String((req.body || {}).upi || '').trim().toLowerCase();
  const row = S('SELECT * FROM upis WHERE LOWER(upi)=?').get(upi);
  if (!row) return res.status(404).json({ error: 'UPI ID not found.' });
  const next = row.active ? 0 : 1;
  S('UPDATE upis SET active=? WHERE id=?').run(next, row.id);
  audit(next ? 'upi_enable' : 'upi_pause', row.upi, {});
  res.json(upiSummary(S('SELECT * FROM upis WHERE id=?').get(row.id)));
});
A.post('/upis/delete', (req, res) => {
  const upi = String((req.body || {}).upi || '').trim().toLowerCase();
  const row = S('SELECT * FROM upis WHERE LOWER(upi)=?').get(upi);
  if (!row) return res.status(404).json({ error: 'UPI ID not found.' });
  S('DELETE FROM upis WHERE id=?').run(row.id);
  audit('upi_remove', row.upi, {});
  res.json({ ok: true });
});
A.get('/upis/logs', (req, res) => {
  const upi = String(req.query.upi || '').trim();
  const rows = upi
    ? S("SELECT * FROM orders WHERE type='buy' AND status='success' AND LOWER(upi)=LOWER(?) ORDER BY updated_at DESC, id DESC LIMIT 300").all(upi)
    : S("SELECT * FROM orders WHERE type='buy' AND status='success' ORDER BY updated_at DESC, id DESC LIMIT 300").all();
  const meta = upi ? S('SELECT * FROM upis WHERE LOWER(upi)=LOWER(?)').get(upi) : null;
  res.json({
    upi: upi || null,
    summary: meta ? upiSummary(meta) : null,
    logs: rows.map(orderView),
  });
});

app.use('/api/admin', A);

/* ================================= SECTION 7: START ================================= */
const PUBLIC = path.join(__dirname, 'public'), ADMIN = path.join(PUBLIC, 'admin');   // the site is public/, the admin panel is public/admin/
const ADMIN_ROUTE = /^[a-zA-Z0-9_-]{4,64}$/.test(CFG.ADMIN_PATH) ? '/' + CFG.ADMIN_PATH : '/admin';
const GATE_KEY = CFG.ADMIN_GATE_KEY || CFG.ADMIN_KEY;
const GATE_MS = 12 * 3600 * 1000;
const gateSig = exp => hmac('admin-gate:' + GATE_KEY + ':' + exp);
const hasGateCookie = req => {
  const raw = cookieOf(req, 'bn_admin_gate');
  if (!raw || !raw.includes('.')) return false;
  const [expStr, sig] = raw.split('.');
  const exp = Number(expStr);
  return Number.isFinite(exp) && exp > now() && /^[a-f0-9]{64}$/.test(sig) && same(sig, gateSig(expStr));
};
const adminGate = (req, res, next) => {
  if (CFG.ADMIN_PATH && ADMIN_ROUTE !== '/admin' && !CFG.ADMIN_GATE_KEY) return next();
  if (hasGateCookie(req)) return next();
  const k = typeof req.query.key === 'string' ? req.query.key.trim() : '';
  if (k && (keyFails.get(req.ip) || 0) < 10) {
    const a = Buffer.from(k), b = Buffer.from(GATE_KEY);
    if (a.length === b.length && crypto.timingSafeEqual(a, b)) {
      const exp = String(now() + GATE_MS);
      res.append('Set-Cookie', `bn_admin_gate=${exp}.${gateSig(exp)}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${GATE_MS / 1000}${req.secure ? '; Secure' : ''}`);
      return res.redirect(ADMIN_ROUTE + '/bn-admin.html');
    }
    keyFails.set(req.ip, (keyFails.get(req.ip) || 0) + 1);
  }
  return res.sendStatus(404);
};
app.get([ADMIN_ROUTE, ADMIN_ROUTE + '/'], ipOk, adminGate, (req, res) => res.redirect(ADMIN_ROUTE + '/bn-admin.html'));
app.use(ADMIN_ROUTE, ipOk, adminGate, express.static(ADMIN));
app.get('/', (req, res) => res.sendFile('blocknexa.html', { root: PUBLIC }));   // root: works even if the project folder path has a dot-folder in it
app.use(express.static(PUBLIC, { index: false }));      // (/admin is handled above, behind the key gate & optional IP lock)
app.use((err, req, res, next) => res.status(400).json({ error: 'Bad request.' }));
app.listen(CFG.PORT, err => {
  if (err) { console.error(err.code === 'EADDRINUSE' ? `PORT ${CFG.PORT} IS ALREADY IN USE. Close the other server and try again.` : err); process.exit(1); }
  const c = q => S(q).get().c;
  console.log(`BlockNexa running on http://localhost:${CFG.PORT}   (admin panel: ${ADMIN_ROUTE}${(ADMIN_ROUTE === '/admin' || CFG.ADMIN_GATE_KEY) ? '?key=YOUR_KEY' : ''})`);
  console.log(`Database: ${DB_FILE}  (${c('SELECT COUNT(*) c FROM users')} users, ${c('SELECT COUNT(*) c FROM orders')} orders)`);
  console.log(`Buy ₹${CFG.BUY_RATE} (min ₹${CFG.MIN_BUY_INR}, max ₹${CFG.MAX_BUY_INR}) | Sell ₹${CFG.SELL_RATE} | min withdraw ${CFG.MIN_WITHDRAW} USDT`);
  console.log(`Logins last ${CFG.SESSION_DAYS} days (renewed while people keep using the site)`);
  console.log(CFG.OTP_TRANSPORT === 'telegram' ? 'Login codes: sent from your Telegram account' : 'WARNING: login codes are only PRINTED here (OTP_TRANSPORT=console). Real users will not receive them. Set the Telegram values in .env.');
  console.log(CFG.GOOGLE_CLIENT_ID ? 'Google sign-in: ON' : 'Google sign-in: off (set GOOGLE_CLIENT_ID)');
  if (!S('SELECT 1 FROM upis WHERE active=1').get()) console.log('WARNING: no active UPI IDs are set, so buying is switched off.');
  if (!CFG.DEPOSIT_ADDRESS) console.log('WARNING: DEPOSIT_ADDRESS is not set, so the deposit page is empty.');
  if (!env('ADMIN_KEY').trim()) console.log('WARNING: ADMIN_KEY is not set. Temporary admin key for this run:', CFG.ADMIN_KEY);
  else console.log(`Admin key: configured from environment (${CFG.ADMIN_KEY.length} chars)`);
  if (process.env.RENDER && !process.env.DATA_DIR) console.log('WARNING: running on Render without DATA_DIR. The database is ERASED on every restart. Add a persistent disk.');
});
