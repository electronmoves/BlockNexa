# BlockNexa — vibe-check Security Audit Summary

Date: 2026-11-26

## Results Across All 17 Categories

| # | Category | Before | After | Key Protections & Fixes Applied |
|---|----------|--------|-------|---------------------------------|
| 1 | `SECRETS_EXPOSURE` | MEDIUM | **PASS** | `.env` & `*.db` gitignored and verified absent from git history; added `.env.example` with placeholders; disabled placeholder UPIs and raw admin-key logging in production; enforced `dotfiles: 'deny'` & `index: false` on static serving. |
| 2 | `DATABASE_ACCESS` | LOW | **PASS** | Local embedded SQLite (`better-sqlite3`, WAL + `foreign_keys = ON`), never exposed publicly; hardened `DATA_DIR` (`0o700`) and `blocknexa.db` (`0o600`) file permissions. |
| 3 | `AUTH_MIDDLEWARE` | LOW | **PASS** | `requireAuth` runs before all protected `/api/v2` routes (`401`); `adminAuth` runs before all `/api/admin` routes (`401` missing / `403` invalid); replaced URL `?key=` SSE auth with single-use 30s `POST /api/admin/events-ticket` tickets so `ADMIN_KEY` never appears in URLs. |
| 4 | `ACCESS_CONTROL` (IDOR) | PASS | **PASS** | Every user order endpoint (`/buy/:id`, `/buy/:id/paid`, `/buy/:id/qr.svg`, `/history/:type`) enforces `WHERE user_id = req.user.id` separately from session authentication. |
| 5 | `FRONTEND_SECRETS` | PASS | **PASS** | Zero secrets or private keys in `public/`; zero `.js.map` source maps served (`404`). |
| 6 | `SSRF` | PASS | **PASS** | Zero user-supplied URL fetching; Google JWKS URL is server-configured only. |
| 7 | `CSRF` | HIGH | **PASS** | `SameSite=Lax` + `HttpOnly` + automatic `Secure` flag behind HTTPS reverse proxies (`x-forwarded-proto` / `RENDER` / `NODE_ENV=production`) on both `bn_session` and `bn_admin_gate`, plus strict `sameOriginCheck` (`Origin` / `Referer` / `Sec-Fetch-Site`) middleware blocking cross-site `POST`/`PUT`/`PATCH`/`DELETE` (`403`). |
| 8 | `SECURITY_HEADERS` | HIGH | **PASS** | Global middleware sets strict `Content-Security-Policy` (`default-src 'self'`, `script-src 'self' https://accounts.google.com` with no `'unsafe-inline'` or `'unsafe-eval'`, `object-src 'none'`, `base-uri 'self'`, `form-action 'self'`, `frame-ancestors 'none'`), `Strict-Transport-Security: max-age=31536000; includeSubDomains`, `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`, `Permissions-Policy`, and `308` HTTP→HTTPS redirect in production. |
| 9 | `CORS` | PASS | **PASS** | No wildcard `*`, no reflected `Origin`, no `null` origin; cross-origin `OPTIONS` preflights rejected with `403`. |
| 10 | `RATE_LIMITING` | MEDIUM | **PASS** | Fixed `trust proxy` from spoofable boolean `true` to numeric hop count (`1`); keyed `limiter()` by route pattern (`req.baseUrl + req.route.path`) with capped map size (`10,000`); added per-IP failed password login lockout (`10` per 15 min → `429`) alongside per-phone lockout (`5` per 15 min → `429`) and OTP/admin key lockouts. |
| 11 | `SQL_INJECTION` | PASS | **PASS** | 100% of user/admin SQL queries use parameterized `db.prepare(sql)` `?` placeholders. |
| 12 | `XSS` | LOW | **PASS** | All dynamic user strings escaped via `esc(...)` / `textContent`; Admin QR SVG previews isolated inside `<img src="data:image/svg+xml;utf8,...">`; enforced by strict non-inline `script-src` CSP. |
| 13 | `PAYMENT_WEBHOOKS` | N/A | **N/A** | No Stripe or automated webhooks (manual UTR & admin verification). |
| 14 | `FILE_UPLOADS` | N/A | **N/A** | No server file uploads; ATM QR photos are decoded client-side in browser memory and only plain text (`<= 2000` chars, `10kb` JSON limit) reaches the API. |
| 15 | `ERROR_HANDLING` | LOW | **PASS** | `x-powered-by` disabled; explicit `404` JSON handler and global error handler returning generic messages (`400` / `413` / `500`) without stack traces or file paths. |
| 16 | `PASSWORD_HASHING` | PASS | **PASS** | `crypto.scrypt` with random 16-byte salt + 64-byte key + constant-time `crypto.timingSafeEqual` and dummy `scrypt` work for unknown accounts. |
| 17 | `DEPENDENCIES` | LOW | **PASS** | Exact versions pinned in `package.json` (`13.0.3`, `1.6.52`, `5.3.0`, `1.5.4`, `2.26.22`); `package-lock.json` committed; `npm audit --omit=dev` reports **0 vulnerabilities**. |

## Critical Issues Remaining

None (`0` Critical, `0` High, `0` Medium, `0` Low open issues in codebase).

## Manual Production Checklist (For Deployment / Render)

- [ ] Set strong random values in Render Environment Variables for `ADMIN_KEY` (32+ chars), `APP_SECRET` (64-char hex), and `ADMIN_PATH` (custom secret path), and optionally `ADMIN_GATE_KEY` + `ADMIN_IPS`.
- [ ] Set `DATA_DIR` to a persistent Render disk mount path so SQLite data persists across deploys.
- [ ] Set `UPI_IDS` and `DEPOSIT_ADDRESS` to your production payment destinations.
- [ ] Once deployed to HTTPS, run `python3 check.py https://<your-domain>` to confirm CDN/proxy headers match app headers end-to-end.
