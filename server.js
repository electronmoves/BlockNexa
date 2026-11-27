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
const { createBscPayout } = require('./bsc-payout');
const env = (k, d = '') => (process.env[k] === undefined || process.env[k] === '' ? d : process.env[k]);
const num = (k, d) => { const v = Number(env(k, d)); return Number.isFinite(v) ? v : d; };
const IS_PROD = process.env.NODE_ENV === 'production' || !!process.env.RENDER;
const OTP_MODE = env('OTP_TRANSPORT', env('TELEGRAM_SESSION') ? 'telegram' : 'console');
const DEFAULT_UPIS = env('UPI_ID') || (OTP_MODE === 'console' && !IS_PROD ? '123@upi,ishu@upi,example@upi' : '');
const CFG = {
  PORT: num('PORT', 3000),
  BUY_RATE: num('BUY_RATE', 102.5), SELL_RATE: num('SELL_RATE', 100),
  MIN_BUY_USDT: num('MIN_BUY_USDT', 5), MAX_BUY_INR: num('MAX_BUY_INR', 5000), MIN_SELL_USDT: num('MIN_SELL_USDT', 5), MIN_WITHDRAW: num('MIN_WITHDRAW', 5),
  MIN_CASHQR_INR: num('MIN_CASHQR_INR', 2000), MAX_CASHQR_INR: num('MAX_CASHQR_INR', 10000), CASHQR_STEP: num('CASHQR_STEP', 500),
  UPI_ID: /^[\w.\-]{2,}@[\w.\-]{2,}$/.test(env('UPI_ID')) ? env('UPI_ID').toLowerCase() : '', UPI_NAME: env('UPI_NAME', 'BlockNexa').slice(0, 40),
  UPI_IDS: env('UPI_IDS', DEFAULT_UPIS).split(',').map(s => s.trim().toLowerCase()).filter(s => /^[\w.\-]{2,}@[\w.\-]{2,}$/.test(s)),
  DEPOSIT_ADDRESS: /^0x[a-fA-F0-9]{40}$/.test(env('DEPOSIT_ADDRESS')) ? env('DEPOSIT_ADDRESS') : '',
  GOOGLE_CLIENT_ID: env('GOOGLE_CLIENT_ID').trim(),
  OTP_TRANSPORT: OTP_MODE,                                                                  // telegram | console (console only prints the code, for local testing)
  OTP_COOLDOWN_MS: num('OTP_COOLDOWN_SEC', 30) * 1000,
  ADMIN_TELEGRAM: env('ADMIN_TELEGRAM').trim().replace(/^@/, ''),                            // your own Telegram username to receive new order alerts (blank = Saved Messages)
  ADMIN_KEY: env('ADMIN_KEY').trim() || crypto.randomBytes(18).toString('hex'),
  ADMIN_GATE_KEY: env('ADMIN_GATE_KEY').trim(),                                             // optional extra ?key= required on the secret admin route
  ADMIN_PATH: env('ADMIN_PATH', 'tsjsigjijgdigj77sf7sf4').trim().replace(/^\/+|\/+$/g, ''), // secret admin URL path (/admin is always 404)
  ADMIN_IPS: env('ADMIN_IPS').split(',').map(s => s.trim()).filter(Boolean),                // optional: only these IPs may use the admin panel
  APP_SECRET: env('APP_SECRET') || crypto.randomBytes(32).toString('hex'),
  SEAL_SIGNATURES: (env('SEAL_SIGNATURES') || env('SEAL_KEYS')).split(',').map(s => s.trim()).filter(s => s.length >= 8),
  SESSION_DAYS: Math.max(7, num('SESSION_DAYS', 30)),                                       // how long a login lasts (never less than 7 days)
};
CFG.MIN_BUY_INR = Math.ceil(CFG.MIN_BUY_USDT * CFG.BUY_RATE);

/* ============================ SECTION 2: DATABASE ============================ */
const DATA_DIR = env('DATA_DIR', path.join(__dirname, 'data'));                              // on a host: point this at a persistent disk
fs.mkdirSync(DATA_DIR, { recursive: true, mode: 0o700 });
const DB_FILE = path.join(DATA_DIR, 'blocknexa.db');
const db = new Database(DB_FILE);
try { fs.chmodSync(DB_FILE, 0o600); } catch {}
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
CREATE TABLE IF NOT EXISTS upis(id INTEGER PRIMARY KEY AUTOINCREMENT, upi TEXT NOT NULL UNIQUE, active INTEGER NOT NULL DEFAULT 1, reset_at INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS notifications(
  id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER REFERENCES users(id),
  title TEXT NOT NULL, message TEXT NOT NULL, created_at INTEGER NOT NULL);
CREATE INDEX IF NOT EXISTS idx_notif_user ON notifications(user_id, id);
CREATE TABLE IF NOT EXISTS notification_reads(
  user_id INTEGER PRIMARY KEY REFERENCES users(id), last_read_at INTEGER NOT NULL DEFAULT 0);
CREATE TABLE IF NOT EXISTS settings(key TEXT PRIMARY KEY, value TEXT NOT NULL);
`);

{ // upgrade an older database: password column and the way each session was opened
  const cols = t => db.prepare(`PRAGMA table_info(${t})`).all().map(c => c.name);
  if (!cols('users').includes('password_hash')) db.exec('ALTER TABLE users ADD COLUMN password_hash TEXT');
  if (!cols('sessions').includes('method')) db.exec('ALTER TABLE sessions ADD COLUMN method TEXT');
  if (!cols('users').includes('deactivated')) db.exec('ALTER TABLE users ADD COLUMN deactivated INTEGER NOT NULL DEFAULT 0');
  if (!cols('users').includes('deactivate_reason')) db.exec('ALTER TABLE users ADD COLUMN deactivate_reason TEXT');
  if (!cols('users').includes('deactivated_at')) db.exec('ALTER TABLE users ADD COLUMN deactivated_at INTEGER');
  if (!cols('upis').includes('reset_at')) db.exec('ALTER TABLE upis ADD COLUMN reset_at INTEGER NOT NULL DEFAULT 0');
  if (!cols('orders').includes('expires_at')) db.exec('ALTER TABLE orders ADD COLUMN expires_at INTEGER');
  if (!cols('orders').includes('timer_ends_at')) db.exec('ALTER TABLE orders ADD COLUMN timer_ends_at INTEGER');
  if (!cols('orders').includes('pay_method')) db.exec("ALTER TABLE orders ADD COLUMN pay_method TEXT NOT NULL DEFAULT 'upi'");
  if (!cols('orders').includes('qr_payload')) db.exec('ALTER TABLE orders ADD COLUMN qr_payload TEXT');
  if (!cols('orders').includes('qr_expires_at')) db.exec('ALTER TABLE orders ADD COLUMN qr_expires_at INTEGER');
  if (!cols('orders').includes('req_id')) db.exec('ALTER TABLE orders ADD COLUMN req_id TEXT');
  if (!cols('orders').includes('order_sig')) db.exec('ALTER TABLE orders ADD COLUMN order_sig TEXT');
  if (!cols('orders').includes('payout_state')) db.exec('ALTER TABLE orders ADD COLUMN payout_state TEXT');
  if (!cols('orders').includes('payout_error')) db.exec('ALTER TABLE orders ADD COLUMN payout_error TEXT');
  if (!cols('ledger').includes('sig')) db.exec('ALTER TABLE ledger ADD COLUMN sig TEXT');
  db.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_orders_req_id ON orders(user_id, req_id) WHERE req_id IS NOT NULL');
}

/* ============================ SECTION 3: HELPERS ============================ */
const P = new Map(); const S = sql => { let s = P.get(sql); if (!s) { s = db.prepare(sql); P.set(sql, s); } return s; };
const now = () => Date.now(), micro = x => Math.round(Number(x) * 1e6), usdt = m => m / 1e6, f2 = m => (m / 1e6).toFixed(2);
const sha = x => crypto.createHash('sha256').update(x).digest('hex');
const hmac = x => crypto.createHmac('sha256', CFG.APP_SECRET).update(x).digest('hex');
const same = (a, b) => typeof a === 'string' && typeof b === 'string' && a.length === b.length && crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));
const ID_CHARS = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';                                          // no look-alike characters
const newOrderId = () => { for (;;) { const id = Array.from({ length: 6 }, () => ID_CHARS[crypto.randomInt(ID_CHARS.length)]).join(''); if (!S('SELECT 1 FROM orders WHERE public_id=?').get(id)) return id; } };
const newUid = () => { for (;;) { const u = 'BN-' + crypto.randomInt(100000, 1000000); if (!S('SELECT 1 FROM users WHERE uid=?').get(u)) return u; } };
const balance = userId => S('SELECT COALESCE(SUM(usdt_micro),0) b FROM ledger WHERE user_id=?').get(userId).b;
const sealKeysConfigured = () => CFG.SEAL_SIGNATURES.length > 0;
const signWithRing = payload => {
  if (!sealKeysConfigured()) return null;
  const k = CFG.SEAL_SIGNATURES[crypto.randomInt(CFG.SEAL_SIGNATURES.length)];
  return crypto.createHmac('sha256', CFG.APP_SECRET + ':' + k).update(payload).digest('hex');
};
const verifyWithRing = (payload, sig) => {
  if (!sealKeysConfigured() || typeof sig !== 'string' || !/^[a-f0-9]{64}$/.test(sig)) return false;
  const sigBuf = Buffer.from(sig);
  let matched = 0;
  for (const k of CFG.SEAL_SIGNATURES) {
    const cand = Buffer.from(crypto.createHmac('sha256', CFG.APP_SECRET + ':' + k).update(payload).digest('hex'));
    if (cand.length === sigBuf.length && crypto.timingSafeEqual(cand, sigBuf)) matched = 1;
  }
  return matched === 1;
};
const ledgerPayload = (prevSig, userId, orderId, type, amt, createdAt) =>
  `ledger-v2:${prevSig || 'GENESIS'}:${userId}:${orderId || 0}:${type}:${amt}:${createdAt}`;
const buyOrderPayload = (pid, userId, inr, usdtMicro, createdAt) =>
  `buy-seal-v2:${pid}:${userId}:${Math.round(Number(inr || 0) * 100)}:${usdtMicro}:${createdAt}`;
const sellOrderPayload = (pid, userId, usdtMicro, inr, upi, createdAt) =>
  `sell-seal-v2:${pid}:${userId}:${usdtMicro}:${Math.round(Number(inr || 0) * 100)}:${String(upi || '').trim().toLowerCase()}:${createdAt}`;
const wdOrderPayload = (pid, userId, usdtMicro, address, createdAt) =>
  `wd-seal-v2:${pid}:${userId}:${usdtMicro}:${String(address || '').trim().toLowerCase()}:${createdAt}`;
const orderPayloadOf = o => o.type === 'buy'
  ? buyOrderPayload(o.public_id, o.user_id, o.inr, o.usdt_micro, o.created_at)
  : o.type === 'sell'
    ? sellOrderPayload(o.public_id, o.user_id, o.usdt_micro, o.inr, o.upi, o.created_at)
    : wdOrderPayload(o.public_id, o.user_id, o.usdt_micro, o.address, o.created_at);

const addLedger = (userId, orderId, type, amt, reason, admin) => {
  const t = now();
  const prev = S('SELECT sig FROM ledger WHERE user_id=? ORDER BY id DESC LIMIT 1').get(userId);
  const sig = signWithRing(ledgerPayload(prev && prev.sig, userId, orderId, type, amt, t));
  return S('INSERT INTO ledger(user_id,order_id,type,usdt_micro,reason,admin,created_at,sig) VALUES(?,?,?,?,?,?,?,?)')
    .run(userId, orderId, type, amt, reason || null, admin || null, t, sig);
};
const bscPayout = createBscPayout();
{ // One-time baseline v2 ring-seal migration for pre-existing legitimate rows (locked by both settings + .seal_v2.lock file)
  const lockFile = path.join(DATA_DIR, '.seal_v2.lock');
  const mark = S("SELECT value FROM settings WHERE key='seals_v2_initialized'").get();
  if (sealKeysConfigured() && !mark && !fs.existsSync(lockFile)) {
    db.transaction(() => {
      for (const o of S('SELECT * FROM orders ORDER BY id ASC').all()) {
        if (!verifyWithRing(orderPayloadOf(o), o.order_sig)) {
          S('UPDATE orders SET order_sig=? WHERE id=?').run(signWithRing(orderPayloadOf(o)), o.id);
        }
      }
      for (const u of S('SELECT id FROM users ORDER BY id ASC').all()) {
        let prevSig = null;
        for (const r of S('SELECT * FROM ledger WHERE user_id=? ORDER BY id ASC').all(u.id)) {
          const sig = signWithRing(ledgerPayload(prevSig, r.user_id, r.order_id, r.type, r.usdt_micro, r.created_at));
          S('UPDATE ledger SET sig=? WHERE id=?').run(sig, r.id);
          prevSig = sig;
        }
      }
      const lockSig = signWithRing('seals-v2-init-locked');
      S("INSERT INTO settings(key,value) VALUES('seals_v2_initialized',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").run(lockSig);
    })();
    try { fs.writeFileSync(lockFile, String(now()), { mode: 0o600 }); } catch {}
  }
}

function verifyUserLedger(userId) {
  if (!sealKeysConfigured()) {
    return { ok: false, tamper: false, missingKeys: true, reason: 'SEAL_SIGNATURES missing in .env — add your 10 internal seal signatures to enable verification.' };
  }
  const rows = S('SELECT * FROM ledger WHERE user_id=? ORDER BY id ASC').all(userId);
  let prevSig = null, sum = 0;
  for (const r of rows) {
    if (!verifyWithRing(ledgerPayload(prevSig, r.user_id, r.order_id, r.type, r.usdt_micro, r.created_at), r.sig)) {
      return { ok: false, tamper: true, reason: 'User ledger signature chain broken (forged or altered balance entry detected).' };
    }
    if (r.type === 'buy_credit' && r.order_id) {
      const bo = S('SELECT * FROM orders WHERE id=?').get(r.order_id);
      if (!bo || bo.type !== 'buy' || bo.user_id !== userId || bo.usdt_micro !== r.usdt_micro || !verifyWithRing(orderPayloadOf(bo), bo.order_sig)) {
        return { ok: false, tamper: true, reason: 'Ledger buy_credit does not match a valid sealed Buy order (forged Buy credit detected).' };
      }
    }
    prevSig = r.sig;
    sum += r.usdt_micro;
  }
  if (sum < 0) return { ok: false, tamper: true, reason: 'User ledger balance is negative (' + f2(sum) + ' USDT).' };
  return { ok: true, rows, balanceMicro: sum };
}

function verifyOrderIntegrity(o) {
  if (!o) return { ok: false, reason: 'Order not found.', tamper: false };
  if (!sealKeysConfigured()) {
    return { ok: false, tamper: false, missingKeys: true, reason: 'SEAL_SIGNATURES missing in .env — add your 10 internal seal signatures to enable verification.' };
  }
  if (o.type === 'buy') {
    if (!verifyWithRing(buyOrderPayload(o.public_id, o.user_id, o.inr, o.usdt_micro, o.created_at), o.order_sig)) {
      return { ok: false, tamper: true, reason: `Buy order seal mismatch (possible database tampering on Buy #${o.public_id}).` };
    }
    const led = verifyUserLedger(o.user_id);
    if (!led.ok) return led;
    return { ok: true };
  }
  if (o.type === 'sell') {
    if (!/^[\w.\-]{2,}@[\w.\-]{2,}$/.test(String(o.upi || '').trim())) {
      return { ok: false, tamper: false, reason: 'Invalid payout UPI format on sell order.' };
    }
    if (!verifyWithRing(sellOrderPayload(o.public_id, o.user_id, o.usdt_micro, o.inr, o.upi, o.created_at), o.order_sig)) {
      return { ok: false, tamper: true, reason: `Sell order seal mismatch (possible forged UPI or amount on Sell #${o.public_id}).` };
    }
    const led = verifyUserLedger(o.user_id);
    if (!led.ok) return led;
    if (!led.rows.some(r => r.order_id === o.id && r.type === 'sell_hold' && r.usdt_micro === -o.usdt_micro)) {
      return { ok: false, tamper: true, reason: `Missing matching sell_hold ledger deduction for Sell #${o.public_id}.` };
    }
    return { ok: true };
  }
  if (o.type === 'withdraw') {
    if (o.chain !== 'bsc' || !/^0x[a-fA-F0-9]{40}$/.test(String(o.address || ''))) {
      return { ok: false, reason: 'Invalid withdrawal network or wallet format.', tamper: false };
    }
    const addrOk = bscPayout.validateAddressSync(o.address, CFG.DEPOSIT_ADDRESS);
    if (!addrOk.ok) return { ok: false, reason: addrOk.error, tamper: false };
    if (!verifyWithRing(wdOrderPayload(o.public_id, o.user_id, o.usdt_micro, o.address, o.created_at), o.order_sig)) {
      return { ok: false, tamper: true, reason: `Withdrawal seal mismatch (possible forged wallet or amount on Withdraw #${o.public_id}).` };
    }
    const led = verifyUserLedger(o.user_id);
    if (!led.ok) return led;
    if (!led.rows.some(r => r.order_id === o.id && r.type === 'withdraw_hold' && r.usdt_micro === -o.usdt_micro)) {
      return { ok: false, tamper: true, reason: `Missing matching withdraw_hold ledger deduction for Withdraw #${o.public_id}.` };
    }
    return { ok: true, checksumAddress: addrOk.checksum };
  }
  return { ok: false, reason: 'Unknown order type.', tamper: false };
}
const payoutsEnabled = () => { const r = S("SELECT value FROM settings WHERE key='payouts_enabled'").get(); return !r || r.value !== '0'; };
const audit = (action, target, details) => S('INSERT INTO audit(at,action,target,details) VALUES(?,?,?,?)').run(now(), action, target || null, JSON.stringify(details || {}));
const reasonOf = b => { const r = String((b || {}).reason || '').trim().replace(/\s+/g, ' ').slice(0, 200); return r.length >= 3 ? r : ''; };
const item = o => ({
  id: o.public_id,
  kind: o.type,
  status: o.status,
  at: o.created_at,
  updatedAt: o.updated_at || o.created_at,
  usdt: usdt(o.usdt_micro),
  inr: o.inr || undefined,
  rate: o.rate || undefined,
  address: o.address || undefined,
  chain: o.chain || undefined,
  txid: o.txid || undefined,
  upi: o.upi || undefined,
  utr: o.utr || undefined,
  reason: o.fail_reason || undefined,
  method: o.pay_method || 'upi',
  hasQr: !!o.qr_payload,
  qrExpiresAt: o.qr_expires_at || undefined,
  expiresAt: o.expires_at || undefined,
  timerEndsAt: o.timer_ends_at || undefined,
  payoutState: o.payout_state === 'broadcasted' ? 'broadcasted' : undefined,
});
const buySellEnabled = () => { const r = S("SELECT value FROM settings WHERE key='buy_sell_enabled'").get(); return !r || r.value !== '0'; };
const cashQrEnabled = () => { const r = S("SELECT value FROM settings WHERE key='cashqr_enabled'").get(); return !r || r.value !== '0'; };
const buySellReason = () => { const r = S("SELECT value FROM settings WHERE key='buy_sell_reason'").get(); return (r && r.value) || ''; };
const BUY_SELL_OFF_MSG = "Buy, Sell & Withdrawal services are currently disabled. We'll notify you.";
const buySellOffMsg = () => buySellReason() || BUY_SELL_OFF_MSG;
const BUY_EXPIRE_MS = 5 * 60 * 1000;
const CASHQR_TTL_MS = 60 * 1000;
const WITHDRAW_TIMER_MS = 60 * 60 * 1000;
const ratesPayload = () => ({ buy: CFG.BUY_RATE, sell: CFG.SELL_RATE, minBuyUsdt: CFG.MIN_BUY_USDT, maxBuyInr: CFG.MAX_BUY_INR, minSellUsdt: CFG.MIN_SELL_USDT, minWithdraw: CFG.MIN_WITHDRAW, minCashQrInr: CFG.MIN_CASHQR_INR, maxCashQrInr: CFG.MAX_CASHQR_INR, cashQrStep: CFG.CASHQR_STEP, cashQrEnabled: cashQrEnabled(), googleClientId: CFG.GOOGLE_CLIENT_ID, buySellEnabled: buySellEnabled(), buySellReason: buySellReason() });

// Real-time Server-Sent Events (SSE) hub so open User & Admin screens update immediately without refresh
const userStreams = new Map(), adminStreams = new Set();
const sseWrite = (res, payload) => { try { res.write('data: ' + JSON.stringify(payload) + '\n\n'); } catch {} };
const sseHeaders = res => { res.set({ 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache, no-transform', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' }); if (res.flushHeaders) res.flushHeaders(); };
const pushUser = (userId, payload) => { const set = userStreams.get(userId); if (set) for (const r of set) sseWrite(r, payload); };
const pushAllUsers = payload => { for (const set of userStreams.values()) for (const r of set) sseWrite(r, payload); };
const pushAdmins = payload => { for (const r of adminStreams) sseWrite(r, payload); };
setInterval(() => {
  for (const set of userStreams.values()) for (const r of set) { try { r.write(':ping\n\n'); } catch {} }
  for (const r of adminStreams) { try { r.write(':ping\n\n'); } catch {} }
}, 20000).unref();

const expireOrders = () => {
  const t = now();
  const c1 = S("UPDATE orders SET status='failed', fail_reason='Order expired after 5 minutes without payment.', updated_at=? WHERE type='buy' AND COALESCE(pay_method,'upi')='upi' AND utr IS NULL AND status='pending' AND expires_at IS NOT NULL AND expires_at<=?").run(t, t).changes;
  const c2 = S("UPDATE orders SET status='failed', fail_reason='CashQR request timed out after 5 minutes.', updated_at=? WHERE type='buy' AND pay_method='cashqr' AND qr_payload IS NULL AND status='pending' AND expires_at IS NOT NULL AND expires_at<=?").run(t, t).changes;
  const c3 = S("UPDATE orders SET status='failed', fail_reason='CashQR expired after 1 minute without payment.', updated_at=? WHERE type='buy' AND pay_method='cashqr' AND qr_payload IS NOT NULL AND utr IS NULL AND status='pending' AND qr_expires_at IS NOT NULL AND qr_expires_at<=?").run(t, t).changes;
  if (c1 + c2 + c3 > 0) { pushAllUsers({ type: 'sync' }); pushAdmins({ type: 'admin_sync' }); }
};
setInterval(expireOrders, 10000).unref();
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
// Never set trust proxy to boolean `true` (which trusts spoofable leftmost X-Forwarded-For); use numeric hop count (default 1 in prod/Render)
if (process.env.TRUST_PROXY !== '0' && (process.env.TRUST_PROXY || IS_PROD)) {
  const hops = parseInt(process.env.TRUST_PROXY, 10);
  app.set('trust proxy', Number.isInteger(hops) && hops > 0 ? hops : 1);
}
const CSP_HEADER = [
  "default-src 'self'",
  "script-src 'self' https://accounts.google.com",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com https://accounts.google.com",
  "font-src 'self' https://fonts.gstatic.com data:",
  "img-src 'self' data: blob:",
  "connect-src 'self' https://accounts.google.com",
  "frame-src https://accounts.google.com",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join('; ');
const isHttpsReq = req => req.secure || String(req.get('x-forwarded-proto') || '').split(',')[0].trim().toLowerCase() === 'https';
app.use((req, res, next) => {
  res.set({
    'Content-Security-Policy': CSP_HEADER,
    'Strict-Transport-Security': 'max-age=31536000; includeSubDomains',
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
    'Permissions-Policy': 'camera=(self), microphone=(), geolocation=()',
  });
  if (IS_PROD && String(req.get('x-forwarded-proto') || '').split(',')[0].trim().toLowerCase() === 'http') {
    const host = String(req.get('host') || '').replace(/[^a-zA-Z0-9.\-:]/g, '');
    if (host) return res.redirect(308, 'https://' + host + req.originalUrl);
  }
  next();
});
// Reject cross-origin OPTIONS preflights and cross-site state-changing requests (CSRF + CORS defense-in-depth)
const sameOriginCheck = (req, res, next) => {
  const host = String(req.get('x-forwarded-host') || req.get('host') || '').split(',')[0].trim().toLowerCase();
  const origin = req.get('origin');
  if (req.method === 'OPTIONS') {
    if (origin) {
      let oHost = ''; try { oHost = new URL(origin).host.toLowerCase(); } catch {}
      if (!oHost || oHost !== host) return res.sendStatus(403);
    }
    return next();
  }
  if (!['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method)) return next();
  if (String(req.get('sec-fetch-site') || '').toLowerCase() === 'cross-site') {
    return res.status(403).json({ error: 'Cross-site request blocked.' });
  }
  if (origin) {
    let oHost = ''; try { oHost = new URL(origin).host.toLowerCase(); } catch {}
    if (!oHost || oHost !== host) return res.status(403).json({ error: 'Cross-origin request blocked.' });
  } else if (req.get('referer')) {
    let rHost = ''; try { rHost = new URL(req.get('referer')).host.toLowerCase(); } catch {}
    if (!rHost || rHost !== host) return res.status(403).json({ error: 'Cross-origin request blocked.' });
  }
  next();
};
app.use('/api', sameOriginCheck);
app.use(express.json({ limit: '10kb' }));
const hits = new Map(); setInterval(() => hits.clear(), 600000).unref();
const limiter = (max, windowMs = 60000) => (req, res, next) => {
  const routeKey = req.baseUrl + (req.route ? req.route.path : req.path);
  const k = req.ip + ':' + routeKey, t = now(), h = (hits.get(k) || []).filter(x => t - x < windowMs);
  if (h.length >= max) return res.status(429).json({ error: 'Too many requests. Please wait a minute and try again.' });
  if (!hits.has(k) && hits.size >= 10000) hits.delete(hits.keys().next().value);
  h.push(t); hits.set(k, h); next();
};

/* ===================== SECTION 4: LOGIN (Telegram code + Google) ===================== */
const SESSION_MS = CFG.SESSION_DAYS * 24 * 3600 * 1000;     // a login lasts this long and is renewed while the user keeps coming back
const cookieOf = (req, n) => (req.headers.cookie || '').split(';').map(c => c.trim().split('=')).find(c => c[0] === n)?.[1];
const cookieSecureFlag = req => {
  const h = String(req.hostname || '').toLowerCase();
  const isLocal = h === 'localhost' || h === '127.0.0.1' || h === '::1';
  return (isHttpsReq(req) || (IS_PROD && !isLocal)) ? '; Secure' : '';
};
const cookie = (req, token, ms) => `bn_session=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${Math.floor(ms / 1000)}; Expires=${new Date(now() + ms).toUTCString()}${cookieSecureFlag(req)}`;
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
function notifyAdminText(text) {
  if (CFG.OTP_TRANSPORT !== 'telegram') {
    console.log(`[ADMIN TG ${CFG.ADMIN_TELEGRAM ? '@' + CFG.ADMIN_TELEGRAM : 'Saved Messages'}] ${text.replace(/\n/g, ' | ')}`);
    return;
  }
  require('./otp-telegram').sendToUser(CFG.ADMIN_TELEGRAM || 'me', text)
    .catch(e => console.error('Admin Telegram notify failed:', e.message));
}
function notifyAdminOrder(order, user, event = 'New order received') {
  const pendingCount = S("SELECT COUNT(*) c FROM orders WHERE status='pending'").get().c;
  const amt = order.inr ? `₹${Number(order.inr).toFixed(2)} (${f2(order.usdt_micro)} USDT)` : `${f2(order.usdt_micro)} USDT`;
  const targetInfo = order.type === 'buy'
    ? ((order.pay_method === 'cashqr' ? 'Method: CashQR (ATM)' : `UPI: ${order.upi}`) + (order.utr ? ` | UTR: ${order.utr}` : ''))
    : order.type === 'sell'
      ? `Pay to UPI: ${order.upi}`
      : `Wallet: ${order.address}`;
  const text = `🔔 BlockNexa: ${event}\n` +
    `Order: #${order.public_id} (${order.type.toUpperCase()})\n` +
    `User: ${user.uid}\n` +
    `Amount: ${amt}\n` +
    `${targetInfo}\n` +
    `Pending orders in Admin Panel: ${pendingCount}`;
  notifyAdminText(text);
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
const pwFails = new Map(), ipPwFails = new Map();
setInterval(() => { pwFails.clear(); ipPwFails.clear(); }, 900000).unref();
V.post('/auth/login/password', limiter(20), async (req, res) => {
  const b = req.body || {}, phone = String(b.phone || ''), pw = String(b.password || '').slice(0, 200);
  const bad = () => res.status(401).json({ error: 'Wrong number or password. You can also log in with a Telegram code.' });
  const t = now();
  const ipList = (ipPwFails.get(req.ip) || []).filter(x => t - x < 900000); ipPwFails.set(req.ip, ipList);
  if (ipList.length >= 10) return res.status(429).json({ error: 'Too many failed login attempts from this network. Wait 15 minutes.' });
  if (!/^\+91[6-9]\d{9}$/.test(phone)) { ipList.push(t); return bad(); }
  const f = (pwFails.get(phone) || []).filter(x => t - x < 900000); pwFails.set(phone, f);
  if (f.length >= 5) return res.status(429).json({ error: 'Too many wrong attempts. Wait 15 minutes, or log in with a Telegram code.' });
  const u = S('SELECT * FROM users WHERE phone=?').get(phone);
  if (!(await checkPw(pw, u && u.password_hash)) || !u) { f.push(t); ipList.push(t); return bad(); }
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
V.use((req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });
V.get('/rates', (req, res) => res.json(ratesPayload()));
V.use(['/me', '/home', '/events', '/orders', '/account', '/balance', '/history', '/buy', '/sell', '/withdraw', '/deposit', '/notifications'], requireAuth);
V.get('/me', (req, res) => res.json(me(req.user)));
V.get('/home', (req, res) => {
  expireOrders();
  const uid = req.user.id, t = now();
  const rd = S('SELECT last_read_at FROM notification_reads WHERE user_id=?').get(uid);
  const lastRead = rd ? rd.last_read_at : 0;
  const nRows = S('SELECT id, user_id, title, message, created_at FROM notifications WHERE user_id IS NULL OR user_id=? ORDER BY id DESC LIMIT 50').all(uid);
  const nList = nRows.map(n => ({ id: n.id, title: n.title, message: n.message, at: n.created_at, personal: n.user_id !== null, unread: n.created_at > lastRead }));
  const activeBuys = S("SELECT * FROM orders WHERE user_id=? AND type='buy' AND status='pending' AND utr IS NULL AND (expires_at IS NULL OR expires_at>?) ORDER BY id DESC LIMIT 5").all(uid, t).map(item);
  res.json({
    balance: { usdt: usdt(balance(uid)) },
    rates: ratesPayload(),
    activeBuys,
    recent: S('SELECT * FROM orders WHERE user_id=? ORDER BY id DESC LIMIT 8').all(uid).map(item),
    notifications: { unread: nList.filter(n => n.unread).length, list: nList }
  });
});
V.get('/orders/:id', (req, res) => {
  expireOrders();
  const o = S('SELECT * FROM orders WHERE public_id=? AND user_id=?').get(String(req.params.id).toUpperCase(), req.user.id);
  if (!o) return res.status(404).json({ error: 'Order not found.' });
  res.json(item(o));
});
V.get('/events', (req, res) => {
  sseHeaders(res);
  const uid = req.user.id;
  let set = userStreams.get(uid);
  if (!set) { set = new Set(); userStreams.set(uid, set); }
  set.add(res);
  sseWrite(res, { type: 'settings', rates: ratesPayload(), usdt: usdt(balance(uid)) });
  req.on('close', () => { set.delete(res); if (!set.size) userStreams.delete(uid); });
});
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
V.get('/notifications', (req, res) => {
  const rd = S('SELECT last_read_at FROM notification_reads WHERE user_id=?').get(req.user.id);
  const lastRead = rd ? rd.last_read_at : 0;
  const rows = S('SELECT id, user_id, title, message, created_at FROM notifications WHERE user_id IS NULL OR user_id=? ORDER BY id DESC LIMIT 50').all(req.user.id);
  const list = rows.map(n => ({ id: n.id, title: n.title, message: n.message, at: n.created_at, personal: n.user_id !== null, unread: n.created_at > lastRead }));
  res.json({ unread: list.filter(n => n.unread).length, list });
});
V.post('/notifications/read', (req, res) => {
  S('INSERT INTO notification_reads(user_id,last_read_at) VALUES(?,?) ON CONFLICT(user_id) DO UPDATE SET last_read_at=excluded.last_read_at').run(req.user.id, now());
  res.json({ ok: true });
});
V.get('/history/:type', (req, res) => {
  expireOrders();
  const t = req.params.type;
  if (t === 'all') return res.json(S('SELECT * FROM orders WHERE user_id=? ORDER BY id DESC LIMIT 6').all(req.user.id).map(item));
  if (!['buy', 'sell', 'withdraw'].includes(t)) return res.status(404).json({ error: 'Not found.' });
  res.json(S('SELECT * FROM orders WHERE user_id=? AND type=? ORDER BY id DESC LIMIT 100').all(req.user.id, t).map(item));
});

V.post('/buy', limiter(20), (req, res) => {
  expireOrders();
  if (!buySellEnabled()) return res.status(503).json({ error: buySellOffMsg() });
  const b = req.body || {}, inr = Number(b.inr), method = b.method === 'cashqr' ? 'cashqr' : 'upi';
  if (S("SELECT COUNT(*) c FROM orders WHERE user_id=? AND type='buy' AND status='pending'").get(req.user.id).c >= 5) return res.status(429).json({ error: 'You already have 5 buy orders waiting. Finish or wait for them first.' });
  const pid = newOrderId(), t = now(), exp = t + BUY_EXPIRE_MS;
  if (method === 'cashqr') {
    if (!cashQrEnabled()) return res.status(503).json({ error: 'CashQR is currently unavailable. Please use UPI.' });
    if (!Number.isInteger(inr) || inr < CFG.MIN_CASHQR_INR || inr > CFG.MAX_CASHQR_INR || inr % CFG.CASHQR_STEP !== 0) {
      return res.status(400).json({ error: `Enter an ATM amount between ₹${CFG.MIN_CASHQR_INR} and ₹${CFG.MAX_CASHQR_INR} (multiple of ₹${CFG.CASHQR_STEP}).` });
    }
    const um = Math.round(inr * 1e6 / CFG.BUY_RATE);
    const sig = signWithRing(buyOrderPayload(pid, req.user.id, inr, um, t));
    S("INSERT INTO orders(public_id,user_id,type,pay_method,inr,rate,usdt_micro,order_sig,expires_at,created_at,updated_at) VALUES(?,?,'buy','cashqr',?,?,?,?,?,?,?)").run(pid, req.user.id, inr, CFG.BUY_RATE, um, sig, exp, t, t);
    const created = S('SELECT * FROM orders WHERE public_id=?').get(pid);
    notifyAdminOrder(created, req.user, 'New CashQR request (upload ATM QR within 5 min)');
    pushUser(req.user.id, { type: 'sync' }); pushAdmins({ type: 'admin_sync', orderId: created.public_id });
    return res.status(201).json(item(created));
  }
  const upi = pickRandomUpi();
  if (!upi) return res.status(503).json({ error: 'Payments are not set up yet. Please contact support.' });
  if (!Number.isInteger(inr) || inr < CFG.MIN_BUY_INR || inr > CFG.MAX_BUY_INR) return res.status(400).json({ error: `Enter a whole amount between ₹${CFG.MIN_BUY_INR} and ₹${CFG.MAX_BUY_INR}.` });
  const um = Math.round(inr * 1e6 / CFG.BUY_RATE);
  const sig = signWithRing(buyOrderPayload(pid, req.user.id, inr, um, t));
  S("INSERT INTO orders(public_id,user_id,type,pay_method,inr,rate,usdt_micro,upi,order_sig,expires_at,created_at,updated_at) VALUES(?,?,'buy','upi',?,?,?,?,?,?,?,?)").run(pid, req.user.id, inr, CFG.BUY_RATE, um, upi, sig, exp, t, t);
  const created = S('SELECT * FROM orders WHERE public_id=?').get(pid);
  notifyAdminOrder(created, req.user, 'New BUY order received');
  pushUser(req.user.id, { type: 'sync' }); pushAdmins({ type: 'admin_sync', orderId: created.public_id });
  res.status(201).json({ ...item(created), upi });
});
V.get('/buy/:id', (req, res) => {
  expireOrders();
  const o = S("SELECT * FROM orders WHERE public_id=? AND user_id=? AND type='buy'").get(String(req.params.id).toUpperCase(), req.user.id);
  if (!o) return res.status(404).json({ error: 'Order not found.' });
  res.json(item(o));
});
V.post('/buy/:id/paid', limiter(20), (req, res) => {
  expireOrders();
  const o = S("SELECT * FROM orders WHERE public_id=? AND user_id=? AND type='buy'").get(String(req.params.id).toUpperCase(), req.user.id);
  if (!o) return res.status(404).json({ error: 'Order not found.' });
  if (o.status !== 'pending') return res.status(409).json({ error: o.fail_reason || 'This order is no longer waiting for payment.' });
  if (o.pay_method === 'cashqr' && !o.qr_payload) return res.status(409).json({ error: 'Please wait for your CashQR to arrive first.' });
  const utr = String((req.body || {}).utr || '').trim();
  if (!/^\d{12}$/.test(utr)) return res.status(400).json({ error: 'Enter the 12-digit reference / UTR number from your payment app.' });
  try { if (S("UPDATE orders SET utr=?, updated_at=? WHERE id=? AND status='pending'").run(utr, now(), o.id).changes !== 1) return res.status(409).json({ error: 'This order is no longer waiting for payment.' }); }
  catch { return res.status(409).json({ error: 'This reference number was already used on another order.' }); }
  const fresh = S('SELECT * FROM orders WHERE id=?').get(o.id);
  notifyAdminOrder(fresh, req.user, o.pay_method === 'cashqr' ? 'Payment submitted for CashQR order' : 'UTR submitted for BUY order');
  pushUser(req.user.id, { type: 'order', order: item(fresh) }); pushAdmins({ type: 'admin_sync', orderId: o.public_id });
  res.json({ ok: true, order: item(fresh) });
});
V.get('/buy/:id/qr.svg', async (req, res) => {
  expireOrders();
  const o = S("SELECT * FROM orders WHERE public_id=? AND user_id=? AND type='buy' AND status='pending'").get(String(req.params.id).toUpperCase(), req.user.id);
  if (!o) return res.sendStatus(404);
  if (o.pay_method === 'cashqr') {
    if (!o.qr_payload || !o.qr_expires_at || o.qr_expires_at <= now()) return res.sendStatus(404);
    res.set({ 'Content-Type': 'image/svg+xml', 'Cache-Control': 'no-store' });
    return res.send(await QRCode.toString(o.qr_payload, { type: 'svg', margin: 2, errorCorrectionLevel: 'M' }));
  }
  if (!(o.upi || CFG.UPI_ID)) return res.sendStatus(404);
  res.set({ 'Content-Type': 'image/svg+xml', 'Cache-Control': 'no-store' });
  res.send(await QRCode.toString(upiLink(o), { type: 'svg', margin: 2, errorCorrectionLevel: 'M' }));
});

// Sells and withdrawals take the USDT out of the balance straight away ("hold"). A failure gives it back.
const cleanReqId = raw => { const s = String(raw || '').trim(); return /^[a-zA-Z0-9_-]{8,64}$/.test(s) ? s : null; };
const createOut = db.transaction((user, type, m, x) => {
  const reqId = cleanReqId(x.reqId);
  if (reqId) {
    const existing = S('SELECT * FROM orders WHERE user_id=? AND req_id=?').get(user.id, reqId);
    if (existing) return { order: existing, duplicate: true };
  }
  const t = now();
  const destCol = type === 'withdraw' ? 'LOWER(COALESCE(address,\'\'))=LOWER(?)' : 'LOWER(COALESCE(upi,\'\'))=LOWER(?)';
  const destVal = type === 'withdraw' ? String(x.address || '') : String(x.upi || '');
  const recentDup = S(`SELECT public_id FROM orders WHERE user_id=? AND type=? AND status='pending' AND usdt_micro=? AND ${destCol} AND created_at>? LIMIT 1`)
    .get(user.id, type, m, destVal, t - 15000);
  if (recentDup) {
    return { err: `Duplicate request prevented — your ${type} request #${recentDup.public_id} is already submitted.`, code: 409 };
  }
  const fresh = S('SELECT * FROM users WHERE id=?').get(user.id);
  if (fresh.wd_suspended) return { err: 'Withdrawals and sales are paused for your account. Please contact support.', code: 403 };
  const bal = balance(user.id);
  if (bal < m) return { err: `Insufficient balance. You have ${f2(bal)} USDT.`, code: 400 };
  const pid = newOrderId();
  const sig = signWithRing(type === 'withdraw'
    ? wdOrderPayload(pid, user.id, m, x.address, t)
    : sellOrderPayload(pid, user.id, m, x.inr, x.upi, t));
  const r = S('INSERT INTO orders(public_id,user_id,type,usdt_micro,inr,rate,upi,address,chain,req_id,order_sig,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)')
    .run(pid, user.id, type, m, x.inr || null, x.rate || null, x.upi || null, x.address || null, x.chain || null, reqId, sig, t, t);
  addLedger(user.id, r.lastInsertRowid, type === 'sell' ? 'sell_hold' : 'withdraw_hold', -m);
  return { order: S('SELECT * FROM orders WHERE id=?').get(r.lastInsertRowid) };
});
V.post('/sell', limiter(20), (req, res) => {
  if (!buySellEnabled()) return res.status(503).json({ error: buySellOffMsg() });
  const b = req.body || {}, v = Number(b.usdt), upi = String(b.upi || '').trim();
  if (!(v >= CFG.MIN_SELL_USDT)) return res.status(400).json({ error: `Minimum sale is ${CFG.MIN_SELL_USDT} USDT.` });
  if (!/^[\w.\-]{2,}@[\w.\-]{2,}$/.test(upi)) return res.status(400).json({ error: 'Enter a valid UPI ID, like name@bank.' });
  const r = createOut(req.user, 'sell', micro(v), { inr: Math.round(v * CFG.SELL_RATE * 100) / 100, rate: CFG.SELL_RATE, upi, reqId: b.reqId });
  if (r.err) return res.status(r.code).json({ error: r.err });
  if (!r.duplicate) {
    notifyAdminOrder(r.order, req.user, 'New SELL order received');
    pushUser(req.user.id, { type: 'sync' }); pushAdmins({ type: 'admin_sync', orderId: r.order.public_id });
  }
  res.status(r.duplicate ? 200 : 201).json(item(r.order));
});
V.post('/withdraw', limiter(20), (req, res) => {
  if (!buySellEnabled()) return res.status(503).json({ error: buySellOffMsg() });
  const b = req.body || {}, v = Number(b.amount), address = String(b.address || '').trim();
  if (b.chain !== 'bsc') return res.status(400).json({ error: 'Select a supported chain.' });
  if (!/^0x[a-fA-F0-9]{40}$/.test(address)) return res.status(400).json({ error: 'Enter a valid BSC (BEP20) address. It starts with 0x and has 42 characters.' });
  const addrSafety = bscPayout.validateAddressSync(address, CFG.DEPOSIT_ADDRESS);
  if (!addrSafety.ok) return res.status(400).json({ error: addrSafety.error });
  if (!(v >= CFG.MIN_WITHDRAW)) return res.status(400).json({ error: `Minimum withdrawal is ${CFG.MIN_WITHDRAW} USDT.` });
  const r = createOut(req.user, 'withdraw', micro(v), { address: addrSafety.checksum, chain: 'bsc', reqId: b.reqId });
  if (r.err) return res.status(r.code).json({ error: r.err });
  if (!r.duplicate) {
    notifyAdminOrder(r.order, req.user, 'New WITHDRAW order received');
    pushUser(req.user.id, { type: 'sync' }); pushAdmins({ type: 'admin_sync', orderId: r.order.public_id });
  }
  res.status(r.duplicate ? 200 : 201).json(item(r.order));
});
app.use('/api/v2', V);

/* ============================ SECTION 6: ADMIN API ============================ */
const A = express.Router();
const cleanIp = ip => String(ip || '').replace(/^::ffff:/, '');
const ipOk = (req, res, next) => (CFG.ADMIN_IPS.length && !CFG.ADMIN_IPS.map(cleanIp).includes(cleanIp(req.ip))) ? res.sendStatus(404) : next();
const keyFails = new Map(), adminTickets = new Map();
setInterval(() => {
  keyFails.clear();
  const t = now();
  for (const [k, exp] of adminTickets) if (exp <= t) adminTickets.delete(k);
}, 900000).unref();
const adminAuth = (req, res, next) => {
  if ((keyFails.get(req.ip) || 0) >= 10) return res.status(429).json({ error: 'Too many wrong keys. Try again in 15 minutes.' });
  if (req.path === '/events' && typeof req.query.ticket === 'string') {
    const exp = adminTickets.get(req.query.ticket);
    adminTickets.delete(req.query.ticket);
    if (exp && exp > now()) return next();
  }
  const rawHdr = req.get('x-admin-key');
  const rawKey = rawHdr || (req.path === '/events' && typeof req.query.key === 'string' ? req.query.key : '');
  if (!rawKey) return res.status(401).json({ error: 'Admin authentication required.' });
  const a = Buffer.from(String(rawKey)), b = Buffer.from(CFG.ADMIN_KEY);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) { keyFails.set(req.ip, (keyFails.get(req.ip) || 0) + 1); return res.status(403).json({ error: 'Wrong admin key.' }); }
  next();
};
A.use(ipOk, limiter(240), adminAuth, (req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });
const userView = u => ({ uid: u.uid, email: u.email, phone: u.phone, createdAt: u.created_at, suspended: !!u.wd_suspended, suspendReason: u.wd_reason, suspendedAt: u.wd_suspended_at, balance: usdt(balance(u.id)) });
const orderView = o => {
  const u = S('SELECT * FROM users WHERE id=?').get(o.user_id);
  const v = verifyOrderIntegrity(o);
  const extra = {
    payoutState: o.payout_state || null,
    payoutError: o.payout_error || null,
    sealOk: v.ok,
    sealError: v.ok ? null : v.reason,
    tamper: !!v.tamper,
    missingKeys: !!v.missingKeys,
  };
  return { ...item(o), utr: o.utr, txid: o.txid, chain: o.chain, rate: o.rate, updatedAt: o.updated_at, ...extra, user: { uid: u.uid, email: u.email, phone: u.phone } };
};

const handleTamperBlock = (o, integrity) => {
  const u = S('SELECT uid FROM users WHERE id=?').get(o.user_id);
  S("INSERT INTO settings(key,value) VALUES('payouts_enabled','0') ON CONFLICT(key) DO UPDATE SET value='0'").run();
  S('UPDATE orders SET payout_error=?, updated_at=? WHERE id=?').run(integrity.reason, now(), o.id);
  audit('security_tamper_blocked', u && u.uid, { order: o.public_id, type: o.type, reason: integrity.reason });
  notifyAdminText(`🚨 SECURITY ALERT (BlockNexa)\nTampered ${o.type.toUpperCase()} order or forged ledger blocked!\nOrder: #${o.public_id}\nUser: ${(u && u.uid) || o.user_id}\nReason: ${integrity.reason}\nHot Wallet Payouts have been AUTOMATICALLY LOCKED OFF.`);
  pushAdmins({ type: 'admin_sync', orderId: o.public_id });
};

A.get('/ping', (req, res) => res.json({ ok: true }));
A.post('/events-ticket', (req, res) => {
  const ticket = crypto.randomBytes(24).toString('hex');
  if (adminTickets.size >= 500) adminTickets.delete(adminTickets.keys().next().value);
  adminTickets.set(ticket, now() + 30000);
  res.json({ ticket });
});
A.get('/events', (req, res) => {
  sseHeaders(res);
  adminStreams.add(res);
  sseWrite(res, { type: 'admin_init' });
  req.on('close', () => adminStreams.delete(res));
});
A.get('/find', (req, res) => {
  expireOrders();
  const raw = String(req.query.q || '').trim().slice(0, 80); if (!raw) return res.json({ kind: 'none' });
  const up = raw.toUpperCase(), digits = raw.replace(/\D/g, '');
  const token = up.replace(/^(ORDER|REQUEST|ID)?[\s#:*-]+/, '').trim();
  const hashMatch = up.match(/#([A-Z0-9]{6})\b/);
  const ordCode = hashMatch ? hashMatch[1] : (/^[A-Z0-9]{6}$/.test(token) ? token : '');
  let u, o;
  if (/^BN-?\d{6}$/.test(token)) u = S('SELECT * FROM users WHERE uid=?').get('BN-' + token.replace(/\D/g, ''));
  else if (/^\d{12}$/.test(digits)) o = S('SELECT * FROM orders WHERE utr=?').get(digits);
  else if (ordCode) {
    o = S('SELECT * FROM orders WHERE UPPER(public_id)=?').get(ordCode);
    if (!o && /^\d{6}$/.test(ordCode)) u = S('SELECT * FROM users WHERE uid=?').get('BN-' + ordCode);
  } else if (/^0X[A-F0-9]{64}$/.test(token)) {
    o = S('SELECT * FROM orders WHERE LOWER(txid)=LOWER(?)').get(token);
  }
  if (o) return res.json({ kind: 'order', order: orderView(o) });
  if (u) return res.json({ kind: 'user', uid: u.uid });
  const cleanTok = token.replace(/[%_\\]/g, '');
  const ordLike = cleanTok.length >= 2 ? '%' + cleanTok + '%' : 'no-order-match';
  const orders = S("SELECT * FROM orders WHERE UPPER(public_id) LIKE ? OR COALESCE(utr,'') LIKE ? OR UPPER(COALESCE(txid,'')) LIKE ? OR UPPER(COALESCE(address,'')) LIKE ? ORDER BY id DESC LIMIT 20").all(ordLike, ordLike, ordLike, ordLike);
  if (orders.length === 1) return res.json({ kind: 'order', order: orderView(orders[0]) });
  if (orders.length > 1) return res.json({ kind: 'orders', orders: orders.map(orderView) });
  const like = '%' + raw.toLowerCase().replace(/[%_]/g, '') + '%', ph = digits.length >= 6 ? '%' + digits + '%' : 'no-phone-match';
  const list = S('SELECT * FROM users WHERE LOWER(COALESCE(email,\'\')) LIKE ? OR phone LIKE ? OR UPPER(uid) LIKE ? ORDER BY id DESC LIMIT 20').all(like, ph, ordLike);
  if (list.length === 1) return res.json({ kind: 'user', uid: list[0].uid });
  res.json(list.length ? { kind: 'users', users: list.map(x => ({ uid: x.uid, email: x.email, phone: x.phone })) } : { kind: 'none' });
});
A.get('/user/:uid', (req, res) => {
  expireOrders();
  const u = S('SELECT * FROM users WHERE uid=?').get(String(req.params.uid).toUpperCase());
  if (!u) return res.status(404).json({ error: 'User not found.' });
  res.json({
    user: userView(u),
    history: S('SELECT * FROM orders WHERE user_id=? ORDER BY id DESC LIMIT 300').all(u.id).map(orderView),
    adjustments: S("SELECT usdt_micro, reason, created_at FROM ledger WHERE user_id=? AND type='adjustment' ORDER BY id DESC LIMIT 20").all(u.id).map(x => ({ amount: usdt(x.usdt_micro), reason: x.reason, at: x.created_at })),
    audit: S('SELECT at, action, details FROM audit WHERE target=? ORDER BY id DESC LIMIT 20').all(u.uid).map(x => ({ at: x.at, action: x.action, details: JSON.parse(x.details || '{}') })),
  });
});
A.get('/pending', (req, res) => { expireOrders(); res.json(S("SELECT * FROM orders WHERE status='pending' ORDER BY (utr IS NULL AND type='buy'), id").all().map(orderView)); });
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
  const pid = String(req.params.id).toUpperCase();
  if (to === 'success' && sealKeysConfigured()) {
    const existing = S('SELECT * FROM orders WHERE public_id=?').get(pid);
    if (existing) {
      const integrity = verifyOrderIntegrity(existing);
      if (!integrity.ok) {
        if (integrity.tamper) {
          handleTamperBlock(existing, integrity);
          return res.status(403).json({ error: integrity.reason + ' Approval blocked & Payouts auto-locked OFF for safety.' });
        }
        return res.status(400).json({ error: integrity.reason });
      }
    }
  }
  const r = setStatus(pid, to, reason, txid);
  if (r.err) return res.status(r.code).json({ error: r.err });
  pushUser(r.order.user_id, { type: 'order', order: item(r.order) }); pushAdmins({ type: 'admin_sync', orderId: r.order.public_id });
  res.json({ order: orderView(r.order) });
});
A.post('/orders/:id/timer', (req, res) => {
  const pid = String(req.params.id).toUpperCase(), o = S('SELECT * FROM orders WHERE public_id=?').get(pid);
  if (!o) return res.status(404).json({ error: 'Order not found.' });
  if (o.status !== 'pending') return res.status(409).json({ error: 'Timer can only be set on pending orders.' });
  const raw = (req.body || {}).minutes;
  const mins = raw === undefined ? 60 : Number(raw);
  if (!Number.isFinite(mins) || mins < 1 || mins > 1440) return res.status(400).json({ error: 'Enter a timer between 1 and 1440 minutes.' });
  const t = now(), endsAt = t + Math.round(mins * 60 * 1000);
  S('UPDATE orders SET timer_ends_at=?, updated_at=? WHERE id=?').run(endsAt, t, o.id);
  audit('order_timer_set', S('SELECT uid FROM users WHERE id=?').get(o.user_id).uid, { order: o.public_id, type: o.type, minutes: Math.round(mins * 100) / 100, endsAt });
  const fresh = S('SELECT * FROM orders WHERE id=?').get(o.id);
  pushUser(o.user_id, { type: 'order', order: item(fresh) }); pushAdmins({ type: 'admin_sync', orderId: o.public_id });
  res.json({ order: orderView(fresh) });
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
  if (r.err) return res.status(r.code).json({ error: r.err });
  pushUser(u.id, { type: 'sync' }); pushAdmins({ type: 'admin_sync' });
  res.json(r);
});
A.post('/user/:uid/suspend', (req, res) => {
  const u = S('SELECT * FROM users WHERE uid=?').get(String(req.params.uid).toUpperCase()); if (!u) return res.status(404).json({ error: 'User not found.' });
  const reason = reasonOf(req.body); if (!reason) return res.status(400).json({ error: 'Write a short reason.' });
  S('UPDATE users SET wd_suspended=1, wd_reason=?, wd_suspended_at=? WHERE id=?').run(reason, now(), u.id);
  audit('suspend_withdrawals', u.uid, { reason });
  pushUser(u.id, { type: 'sync' }); pushAdmins({ type: 'admin_sync' });
  res.json({ ok: true });
});
A.post('/user/:uid/unsuspend', (req, res) => {
  const u = S('SELECT * FROM users WHERE uid=?').get(String(req.params.uid).toUpperCase()); if (!u) return res.status(404).json({ error: 'User not found.' });
  S('UPDATE users SET wd_suspended=0, wd_reason=NULL, wd_suspended_at=NULL WHERE id=?').run(u.id);
  audit('lift_suspension', u.uid, { reason: reasonOf(req.body) || undefined });
  pushUser(u.id, { type: 'sync' }); pushAdmins({ type: 'admin_sync' });
  res.json({ ok: true });
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
  pushUser(u.id, { type: 'deactivated', error: blockedMsg({ deactivate_reason: reason }) }); pushAdmins({ type: 'admin_sync' });
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

// Reset a user's password directly by UID (admin action)
A.post('/user/:uid/password', async (req, res) => {
  const u = S('SELECT * FROM users WHERE uid=?').get(String(req.params.uid).toUpperCase());
  if (!u) return res.status(404).json({ error: 'User not found.' });
  const pw = String((req.body || {}).password || '');
  if (!pwOk(pw)) return res.status(400).json({ error: 'Password must be 8 to 128 characters.' });
  S('UPDATE users SET password_hash=? WHERE id=?').run(await hashPw(pw), u.id);
  S('DELETE FROM sessions WHERE user_id=?').run(u.id);
  audit('reset_password', u.uid, {});
  res.json({ ok: true });
});

// ==================== PUSH NOTIFICATIONS ====================
A.get('/notifications', (req, res) => {
  const rows = S('SELECT n.id, n.title, n.message, n.created_at, u.uid AS target_uid FROM notifications n LEFT JOIN users u ON u.id=n.user_id ORDER BY n.id DESC LIMIT 100').all();
  res.json(rows.map(n => ({ id: n.id, title: n.title, message: n.message, at: n.created_at, target: n.target_uid || 'ALL' })));
});
A.post('/notifications', (req, res) => {
  const b = req.body || {};
  const title = String(b.title || '').trim().replace(/\s+/g, ' ').slice(0, 80);
  const message = String(b.message || '').trim().slice(0, 500);
  if (title.length < 2) return res.status(400).json({ error: 'Enter a title (at least 2 characters).' });
  if (message.length < 2) return res.status(400).json({ error: 'Enter an announcement message.' });
  let targetUser = null;
  if (b.target === 'user') {
    const uid = String(b.uid || '').trim().toUpperCase();
    targetUser = S('SELECT * FROM users WHERE uid=?').get(uid);
    if (!targetUser) return res.status(404).json({ error: 'User ID not found (example: BN-123456).' });
  }
  const t = now();
  const r = S('INSERT INTO notifications(user_id,title,message,created_at) VALUES(?,?,?,?)').run(targetUser ? targetUser.id : null, title, message, t);
  audit('push_notification', targetUser ? targetUser.uid : 'ALL', { title });
  targetUser ? pushUser(targetUser.id, { type: 'sync' }) : pushAllUsers({ type: 'sync' });
  pushAdmins({ type: 'admin_sync' });
  res.status(201).json({ id: Number(r.lastInsertRowid), title, message, at: t, target: targetUser ? targetUser.uid : 'ALL' });
});
A.post('/notifications/:id/delete', (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) return res.status(400).json({ error: 'Invalid ID.' });
  S('DELETE FROM notifications WHERE id=?').run(id);
  pushAllUsers({ type: 'sync' }); pushAdmins({ type: 'admin_sync' });
  res.json({ ok: true });
});

// ==================== GLOBAL SERVICE SETTINGS ====================
const checkAdminKey = (req, k) => {
  if ((keyFails.get(req.ip) || 0) >= 10) return { err: 'Too many wrong keys. Try again in 15 minutes.', code: 429 };
  const a = Buffer.from(String(k || '').trim()), b = Buffer.from(CFG.ADMIN_KEY);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    keyFails.set(req.ip, (keyFails.get(req.ip) || 0) + 1);
    return { err: 'Wrong admin key.', code: 403 };
  }
  return null;
};
A.get('/settings', (req, res) => {
  expireOrders();
  const pendingCount = S("SELECT COUNT(*) c FROM orders WHERE status='pending'").get().c;
  const cashQrPendingCount = S("SELECT COUNT(*) c FROM orders WHERE type='buy' AND pay_method='cashqr' AND status='pending'").get().c;
  const withdrawPendingCount = S("SELECT COUNT(*) c FROM orders WHERE type='withdraw' AND status='pending'").get().c;
  const upis = S('SELECT upi FROM upis WHERE active=1 ORDER BY id ASC').all().map(r => r.upi);
  res.json({ buySellEnabled: buySellEnabled(), buySellReason: buySellReason(), cashQrEnabled: cashQrEnabled(), payoutsEnabled: payoutsEnabled(), sealKeysConfigured: sealKeysConfigured(), sealKeysCount: CFG.SEAL_SIGNATURES.length, pendingCount, cashQrPendingCount, withdrawPendingCount, upis });
});
A.post('/settings/buy-sell', (req, res) => {
  const b = req.body || {}, bad = checkAdminKey(req, b.adminKey);
  if (bad) return res.status(bad.code).json({ error: bad.err });
  const enabled = !!b.enabled;
  const reason = enabled ? '' : String(b.reason || '').trim().replace(/\s+/g, ' ').slice(0, 200);
  S("INSERT INTO settings(key,value) VALUES('buy_sell_enabled',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").run(enabled ? '1' : '0');
  S("INSERT INTO settings(key,value) VALUES('buy_sell_reason',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").run(reason);
  audit(enabled ? 'enable_buy_sell' : 'disable_buy_sell', null, reason ? { reason } : {});
  pushAllUsers({ type: 'settings', rates: ratesPayload() }); pushAdmins({ type: 'admin_sync' });
  res.json({ buySellEnabled: enabled, buySellReason: reason });
});

// ==================== UPI RANDOMNESS & TRANSACTION LOG ====================
const upiLogsClearedAt = () => { const r = S("SELECT value FROM settings WHERE key='upi_logs_cleared_at'").get(); return Number(r && r.value) || 0; };
const upiSummary = u => {
  const clearedAt = upiLogsClearedAt(), since = Math.max(u.reset_at || 0, clearedAt);
  const s = S("SELECT COALESCE(SUM(inr),0) AS totalInr, COALESCE(SUM(usdt_micro),0) AS totalUsdtMicro, COUNT(*) AS count, MAX(updated_at) AS lastAt FROM orders WHERE type='buy' AND status='success' AND LOWER(upi)=LOWER(?) AND updated_at>=?").get(u.upi, since);
  const all = S("SELECT COUNT(*) AS c FROM orders WHERE type='buy' AND status='success' AND LOWER(upi)=LOWER(?) AND updated_at>=?").get(u.upi, clearedAt);
  const p = S("SELECT COUNT(*) AS c FROM orders WHERE type='buy' AND status='pending' AND LOWER(upi)=LOWER(?)").get(u.upi);
  return { id: u.id, upi: u.upi, active: !!u.active, createdAt: u.created_at, resetAt: since, totalCollected: Math.round((s.totalInr || 0) * 100) / 100, totalUsdt: usdt(s.totalUsdtMicro || 0), count: s.count || 0, allTimeCount: all.c || 0, pendingCount: p.c || 0, lastAt: s.lastAt || null };
};
A.get('/upis', (req, res) => {
  const upis = S('SELECT * FROM upis ORDER BY active DESC, id ASC').all().map(upiSummary);
  res.json({
    upis,
    totalCollected: Math.round(upis.reduce((a, x) => a + x.totalCollected, 0) * 100) / 100,
    totalCount: upis.reduce((a, x) => a + x.count, 0),
    allTimeCount: upis.reduce((a, x) => a + x.allTimeCount, 0),
  });
});
A.post('/upis/reset', (req, res) => {
  const bad = checkAdminKey(req, (req.body || {}).adminKey);
  if (bad) return res.status(bad.code).json({ error: bad.err });
  const t = now();
  S('UPDATE upis SET reset_at=?').run(t);
  audit('upi_reset_collection', 'ALL', { resetAt: t });
  res.json({ ok: true, resetAt: t });
});
A.post('/upis/clear-logs', (req, res) => {
  const bad = checkAdminKey(req, (req.body || {}).adminKey);
  if (bad) return res.status(bad.code).json({ error: bad.err });
  const t = now();
  S("INSERT INTO settings(key,value) VALUES('upi_logs_cleared_at',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").run(String(t));
  S('UPDATE upis SET reset_at=?').run(t);
  audit('upi_clear_logs', 'ALL', { clearedAt: t });
  res.json({ ok: true, clearedAt: t });
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
  const upi = String(req.query.upi || '').trim(), clearedAt = upiLogsClearedAt();
  const rows = upi
    ? S("SELECT * FROM orders WHERE type='buy' AND status='success' AND LOWER(upi)=LOWER(?) AND updated_at>=? ORDER BY updated_at DESC, id DESC LIMIT 300").all(upi, clearedAt)
    : S("SELECT * FROM orders WHERE type='buy' AND status='success' AND updated_at>=? ORDER BY updated_at DESC, id DESC LIMIT 300").all(clearedAt);
  const meta = upi ? S('SELECT * FROM upis WHERE LOWER(upi)=LOWER(?)').get(upi) : null;
  res.json({
    upi: upi || null,
    summary: meta ? upiSummary(meta) : null,
    logs: rows.map(orderView),
  });
});

// ==================== CASHQR (ATM HIGH-LIMIT QUEUE) ====================
A.get('/cashqr', (req, res) => {
  expireOrders();
  const pending = S("SELECT * FROM orders WHERE type='buy' AND pay_method='cashqr' AND status='pending' ORDER BY id ASC").all().map(orderView);
  const recent = S("SELECT * FROM orders WHERE type='buy' AND pay_method='cashqr' AND status!='pending' ORDER BY id DESC LIMIT 20").all().map(orderView);
  res.json({ enabled: cashQrEnabled(), pending, recent });
});
A.post('/cashqr/toggle', (req, res) => {
  const enabled = !!(req.body || {}).enabled;
  S("INSERT INTO settings(key,value) VALUES('cashqr_enabled',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").run(enabled ? '1' : '0');
  audit(enabled ? 'enable_cashqr' : 'disable_cashqr', null, {});
  pushAllUsers({ type: 'settings', rates: ratesPayload() }); pushAdmins({ type: 'admin_sync' });
  res.json({ enabled });
});
A.post('/cashqr/preview', async (req, res) => {
  const payload = String((req.body || {}).payload || '').trim();
  if (payload.length < 4 || payload.length > 2000) return res.status(400).json({ error: 'Invalid QR text.' });
  const svg = await QRCode.toString(payload, { type: 'svg', margin: 2, errorCorrectionLevel: 'M' });
  res.json({ svg });
});
A.post('/cashqr/:id/qr', (req, res) => {
  expireOrders();
  const pid = String(req.params.id).toUpperCase(), o = S("SELECT * FROM orders WHERE public_id=? AND type='buy'").get(pid);
  if (!o) return res.status(404).json({ error: 'Buy order not found.' });
  if (o.status === 'success') return res.status(409).json({ error: 'This order is already marked as success.' });
  if (o.status !== 'pending' && o.pay_method !== 'cashqr') return res.status(409).json({ error: o.fail_reason || 'This order is no longer pending.' });
  const payload = String((req.body || {}).payload || '').trim();
  if (payload.length < 4 || payload.length > 2000) return res.status(400).json({ error: 'QR data is empty or invalid.' });
  const t = now(), qrExp = t + CASHQR_TTL_MS, ordExp = Math.max(o.expires_at || 0, qrExp + 60000);
  S("UPDATE orders SET pay_method='cashqr', status='pending', fail_reason=NULL, qr_payload=?, qr_expires_at=?, expires_at=?, updated_at=? WHERE id=?").run(payload, qrExp, ordExp, t, o.id);
  audit('cashqr_attached', S('SELECT uid FROM users WHERE id=?').get(o.user_id).uid, { order: o.public_id, qrExpiresAt: qrExp });
  const fresh = S('SELECT * FROM orders WHERE id=?').get(o.id);
  pushUser(o.user_id, { type: 'order', order: item(fresh) }); pushAdmins({ type: 'admin_sync', orderId: o.public_id });
  res.json({ order: orderView(fresh) });
});

// ==================== BSC HOT WALLET PAYOUTS (OPTION 1: 1-CLICK ADMIN APPROVE & SEND) ====================
let reconcilingPayouts = false;
async function reconcileBroadcastedPayouts() {
  if (reconcilingPayouts) return;
  const stuck = S("SELECT * FROM orders WHERE type='withdraw' AND status='pending' AND payout_state='broadcasted' AND txid IS NOT NULL").all();
  if (!stuck.length) return;
  reconcilingPayouts = true;
  try {
    for (const o of stuck) {
      const check = await bscPayout.verifyTxOnChain({ txHash: o.txid, to: o.address, usdtMicro: o.usdt_micro });
      if (check.state === 'confirmed') {
        const t = now();
        if (S("UPDATE orders SET status='success', payout_state='confirmed', payout_error=NULL, fail_reason=NULL, updated_at=? WHERE id=? AND status='pending'").run(t, o.id).changes === 1) {
          const u = S('SELECT uid FROM users WHERE id=?').get(o.user_id);
          audit('auto_payout_reconciled', u && u.uid, { order: o.public_id, txid: o.txid, blockNumber: check.blockNumber });
          const fresh = S('SELECT * FROM orders WHERE id=?').get(o.id);
          pushUser(o.user_id, { type: 'order', order: item(fresh) }); pushAdmins({ type: 'admin_sync', orderId: o.public_id });
        }
      } else if (check.state === 'reverted') {
        S("UPDATE orders SET payout_state=NULL, txid=NULL, payout_error='Previous broadcast reverted on-chain (0 USDT moved). Safe to retry.', updated_at=? WHERE id=? AND status='pending'").run(now(), o.id);
        pushAdmins({ type: 'admin_sync', orderId: o.public_id });
      }
    }
  } finally { reconcilingPayouts = false; }
}
setInterval(() => { reconcileBroadcastedPayouts().catch(() => {}); }, 20000).unref();
setTimeout(() => { reconcileBroadcastedPayouts().catch(() => {}); }, 1500).unref();

A.get('/payouts', async (req, res) => {
  expireOrders();
  await reconcileBroadcastedPayouts().catch(() => {});
  const wallet = await bscPayout.getStatus(req.query.refresh === '1');
  const pending = S("SELECT * FROM orders WHERE type='withdraw' AND status='pending' ORDER BY id ASC").all().map(orderView);
  const recent = S("SELECT * FROM orders WHERE type='withdraw' AND status!='pending' ORDER BY updated_at DESC, id DESC LIMIT 30").all().map(orderView);
  const since24h = now() - 24 * 3600 * 1000;
  const sent24hMicro = S("SELECT COALESCE(SUM(usdt_micro),0) s FROM orders WHERE type='withdraw' AND status='success' AND updated_at>=?").get(since24h).s;
  res.json({ enabled: payoutsEnabled(), sealKeysConfigured: sealKeysConfigured(), sealKeysCount: CFG.SEAL_SIGNATURES.length, wallet, sent24hUsdt: usdt(sent24hMicro), pending, recent });
});

A.post('/payouts/toggle', (req, res) => {
  const b = req.body || {}, bad = checkAdminKey(req, b.adminKey);
  if (bad) return res.status(bad.code).json({ error: bad.err });
  const enabled = !!b.enabled;
  S("INSERT INTO settings(key,value) VALUES('payouts_enabled',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").run(enabled ? '1' : '0');
  audit(enabled ? 'enable_payouts' : 'disable_payouts', null, {});
  pushAdmins({ type: 'admin_sync' });
  res.json({ enabled });
});

A.post('/payouts/:id/send', limiter(30), async (req, res) => {
  if (!payoutsEnabled()) return res.status(503).json({ error: 'Hot Wallet Payouts are switched OFF. Turn Payouts ON first.' });
  const pid = String(req.params.id).toUpperCase();
  const o = S("SELECT * FROM orders WHERE public_id=? AND type='withdraw'").get(pid);
  if (!o) return res.status(404).json({ error: 'Withdrawal order not found.' });
  if (o.status !== 'pending') return res.status(409).json({ error: `This withdrawal is already ${o.status}.` });

  // WYSIWYS check: confirm the amount and wallet shown on the admin's screen match the DB row
  const b = req.body || {};
  if (b.expectedAddress && String(b.expectedAddress).trim().toLowerCase() !== String(o.address || '').trim().toLowerCase()) {
    return res.status(409).json({ error: 'Address mismatch between screen and database. Reload and inspect this order.' });
  }
  if (b.expectedUsdt !== undefined && micro(b.expectedUsdt) !== o.usdt_micro) {
    return res.status(409).json({ error: 'USDT amount mismatch between screen and database. Reload and inspect this order.' });
  }

  // Cryptographic anti-forgery verification (10-key SEAL_SIGNATURES Order Seal + User Ledger Hash-Chain)
  const integrity = verifyOrderIntegrity(o);
  if (!integrity.ok) {
    if (integrity.tamper) {
      handleTamperBlock(o, integrity);
      return res.status(403).json({ error: integrity.reason + ' Payouts have been auto-locked OFF for safety.' });
    }
    return res.status(400).json({ error: integrity.reason });
  }

  // If previously broadcasted (e.g. server restarted mid-confirmation), reconcile instead of double-sending
  if (o.payout_state === 'broadcasted' && o.txid) {
    await reconcileBroadcastedPayouts();
    const after = S('SELECT * FROM orders WHERE id=?').get(o.id);
    if (after.status === 'success') return res.json({ order: orderView(after), txHash: after.txid });
    if (after.payout_state === 'broadcasted') {
      return res.status(409).json({ error: `Transaction ${after.txid} is already broadcasted on BSC and waiting for confirmation. Never re-send while pending.` });
    }
  }

  // Atomic SQLite lock: guarantees admin double-clicks can NEVER trigger two transfers
  if (S("UPDATE orders SET payout_state='locked', payout_error=NULL, updated_at=? WHERE id=? AND status='pending' AND payout_state IS NULL").run(now(), o.id).changes !== 1) {
    return res.status(409).json({ error: 'This withdrawal is already being processed or sent.' });
  }
  pushAdmins({ type: 'admin_sync', orderId: o.public_id });

  const u = S('SELECT * FROM users WHERE id=?').get(o.user_id);
  try {
    const result = await bscPayout.sendUsdt({
      to: integrity.checksumAddress,
      usdtMicro: o.usdt_micro,
      depositAddress: CFG.DEPOSIT_ADDRESS,
      onSigned: txHash => {
        S("UPDATE orders SET txid=?, payout_state='broadcasted', updated_at=? WHERE id=?").run(txHash, now(), o.id);
        pushAdmins({ type: 'admin_sync', orderId: o.public_id });
      },
    });
    const t = now();
    S("UPDATE orders SET status='success', txid=?, payout_state='confirmed', payout_error=NULL, fail_reason=NULL, updated_at=? WHERE id=?").run(result.txHash, t, o.id);
    audit('auto_payout_sent', u.uid, { order: o.public_id, usdt: usdt(o.usdt_micro), to: integrity.checksumAddress, txid: result.txHash, blockNumber: result.blockNumber });
    const fresh = S('SELECT * FROM orders WHERE id=?').get(o.id);
    const wStat = await bscPayout.getStatus(true).catch(() => null);
    notifyAdminText(
      `✅ BlockNexa Auto-Payout Sent\n` +
      `Order: #${o.public_id}\n` +
      `User: ${u.uid}\n` +
      `Sent: ${f2(o.usdt_micro)} USDT (BEP20)\n` +
      `To: ${integrity.checksumAddress}\n` +
      `Tx: ${result.txHash}` +
      (wStat && wStat.usdt !== null ? `\nHot Wallet Remaining: ${Number(wStat.usdt).toFixed(2)} USDT | ${Number(wStat.bnb).toFixed(4)} BNB` : '')
    );
    pushUser(o.user_id, { type: 'order', order: item(fresh) }); pushAdmins({ type: 'admin_sync', orderId: o.public_id });
    res.json({ order: orderView(fresh), txHash: result.txHash, blockNumber: result.blockNumber });
  } catch (err) {
    const msg = err && err.message ? err.message : 'BSC payout failed.';
    if (err && err.safeToUnlock) {
      S('UPDATE orders SET payout_state=NULL, txid=CASE WHEN ? THEN NULL ELSE txid END, payout_error=?, updated_at=? WHERE id=?')
        .run(err.reverted ? 1 : 0, msg.slice(0, 240), now(), o.id);
      pushAdmins({ type: 'admin_sync', orderId: o.public_id });
      return res.status(400).json({ error: msg });
    }
    S('UPDATE orders SET payout_error=?, updated_at=? WHERE id=?').run(msg.slice(0, 240), now(), o.id);
    pushAdmins({ type: 'admin_sync', orderId: o.public_id });
    return res.status(202).json({ error: msg, txHash: err && err.txHash });
  }
});

app.use('/api/admin', A);

/* ================================= SECTION 7: START ================================= */
const PUBLIC = path.join(__dirname, 'public'), ADMIN = path.join(PUBLIC, 'admin');   // the site is public/, the admin panel is public/admin/
const NO_CACHE_STATIC = { index: false, dotfiles: 'deny', etag: true, maxAge: 0, setHeaders: res => res.set('Cache-Control', 'no-cache') };
const ADMIN_ROUTE = /^[a-zA-Z0-9_-]{8,64}$/.test(CFG.ADMIN_PATH) && CFG.ADMIN_PATH.toLowerCase() !== 'admin' ? '/' + CFG.ADMIN_PATH : '/tsjsigjijgdigj77sf7sf4';
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
  if (!CFG.ADMIN_GATE_KEY) return next();   // secret route itself is the gate unless ADMIN_GATE_KEY is also set
  if (hasGateCookie(req)) return next();
  const k = typeof req.query.key === 'string' ? req.query.key.trim() : '';
  if (k && (keyFails.get(req.ip) || 0) < 10) {
    const a = Buffer.from(k), b = Buffer.from(GATE_KEY);
    if (a.length === b.length && crypto.timingSafeEqual(a, b)) {
      const exp = String(now() + GATE_MS);
      res.append('Set-Cookie', `bn_admin_gate=${exp}.${gateSig(exp)}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${GATE_MS / 1000}${cookieSecureFlag(req)}`);
      return res.redirect(ADMIN_ROUTE + '/bn-admin.html');
    }
    keyFails.set(req.ip, (keyFails.get(req.ip) || 0) + 1);
  }
  return res.sendStatus(404);
};
app.use('/admin', (req, res) => res.sendStatus(404));                                   // /admin and /admin/* are ALWAYS 404 (never exposed via public/)
app.get([ADMIN_ROUTE, ADMIN_ROUTE + '/'], ipOk, adminGate, (req, res) => res.redirect(ADMIN_ROUTE + '/bn-admin.html'));
app.use(ADMIN_ROUTE, ipOk, adminGate, express.static(ADMIN, NO_CACHE_STATIC));
app.get('/', (req, res) => { res.set('Cache-Control', 'no-cache'); res.sendFile('blocknexa.html', { root: PUBLIC }); });   // root: works even if the project folder path has a dot-folder in it
app.use(express.static(PUBLIC, NO_CACHE_STATIC));      // (/admin is blocked above; admin static is only served on ADMIN_ROUTE)
app.use((req, res) => res.status(404).json({ error: 'Not found.' }));
app.use((err, req, res, next) => {
  if (err && (err.type === 'entity.parse.failed' || err instanceof URIError || err.status === 400 || err.statusCode === 400)) {
    return res.status(400).json({ error: 'Bad request.' });
  }
  if (err && err.type === 'entity.too.large') return res.status(413).json({ error: 'Request payload too large.' });
  console.error('Unhandled error:', err && err.message ? err.message : err);
  res.status(500).json({ error: 'Something went wrong.' });
});
app.listen(CFG.PORT, err => {
  if (err) { console.error(err.code === 'EADDRINUSE' ? `PORT ${CFG.PORT} IS ALREADY IN USE. Close the other server and try again.` : err); process.exit(1); }
  const c = q => S(q).get().c;
  console.log(`BlockNexa running on http://localhost:${CFG.PORT}   (admin panel: ${ADMIN_ROUTE}${CFG.ADMIN_GATE_KEY ? '?key=YOUR_GATE_KEY' : ''})`);
  console.log(`Database: ${DB_FILE}  (${c('SELECT COUNT(*) c FROM users')} users, ${c('SELECT COUNT(*) c FROM orders')} orders)`);
  console.log(`Buy ₹${CFG.BUY_RATE} (min ₹${CFG.MIN_BUY_INR}, max ₹${CFG.MAX_BUY_INR}) | Sell ₹${CFG.SELL_RATE} | min withdraw ${CFG.MIN_WITHDRAW} USDT`);
  console.log(`Logins last ${CFG.SESSION_DAYS} days (renewed while people keep using the site)`);
  console.log(CFG.OTP_TRANSPORT === 'telegram' ? `Login codes & order alerts: Telegram (${CFG.ADMIN_TELEGRAM ? '@' + CFG.ADMIN_TELEGRAM : 'Saved Messages'})` : 'WARNING: login codes are only PRINTED here (OTP_TRANSPORT=console). Real users will not receive them. Set the Telegram values in .env.');
  console.log(CFG.GOOGLE_CLIENT_ID ? 'Google sign-in: ON' : 'Google sign-in: off (set GOOGLE_CLIENT_ID)');
  if (!S('SELECT 1 FROM upis WHERE active=1').get()) console.log('WARNING: no active UPI IDs are set, so buying is switched off.');
  if (!CFG.DEPOSIT_ADDRESS) console.log('WARNING: DEPOSIT_ADDRESS is not set, so the deposit page is empty.');
  if (!env('ADMIN_KEY').trim()) console.log(IS_PROD ? 'CRITICAL WARNING: ADMIN_KEY is not set in environment! Set ADMIN_KEY immediately.' : 'WARNING: ADMIN_KEY is not set. Temporary local admin key: ' + CFG.ADMIN_KEY);
  else console.log(`Admin key: configured from environment (${CFG.ADMIN_KEY.length} chars)`);
  console.log(sealKeysConfigured() ? `Seal signatures: ${CFG.SEAL_SIGNATURES.length} secret signature(s) active in ring` : 'WARNING: SEAL_SIGNATURES is not set in .env — Seal & Ledger verification is locked until configured.');
  if (!env('APP_SECRET').trim() && IS_PROD) console.log('WARNING: APP_SECRET is not set in environment; user sessions will reset on server restart.');
  if (process.env.RENDER && !process.env.DATA_DIR) console.log('WARNING: running on Render without DATA_DIR. The database is ERASED on every restart. Add a persistent disk.');
});
