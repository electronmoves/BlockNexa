# Security Rules (vibe-check)

These rules apply to all code generated in this project. They are non-negotiable.

## Secrets

- NEVER put API keys, database credentials, admin keys, or Telegram sessions in frontend code (`public/`).
- NEVER hardcode credentials in source files. Use environment variables loaded server-side only.
- The `.env` file MUST be in `.gitignore` before any commit.
- Use `.env.example` with placeholder values only, never real credentials.

## Database

- All SQLite database files (`data/*.db`, `*.db-wal`, `*.db-shm`) MUST stay outside `public/` and be ignored in `.gitignore` with restrictive file permissions (`0o600`).
- NEVER deserialize untrusted data; use JSON (`express.json({ limit: '10kb' })`) for all network data exchange.

## Authentication and Authorization

- EVERY API route under `/api/v2` that returns or modifies user data MUST run `requireAuth` middleware BEFORE the handler and return `401` when unauthenticated.
- EVERY route that takes a resource ID (`:id`) MUST verify `user_id = req.user.id` separately from authentication so no user can read or mutate another user's orders (IDOR prevention).
- Admin endpoints under `/api/admin` MUST verify the admin key via constant-time `crypto.timingSafeEqual` (or single-use ticket for SSE), returning `401` when missing and `403` when invalid, and NEVER pass `ADMIN_KEY` in URL query parameters in the browser.
- Session and gate cookies MUST set `HttpOnly`, `SameSite=Lax`, and `Secure` in production/HTTPS.

## Input and Output

- NEVER concatenate user input into SQL queries. ALWAYS use parameterized `db.prepare(sql)` `?` placeholders.
- NEVER inject unsanitized user-supplied strings into `innerHTML`; always escape via `esc(...)` or `textContent`, and isolate dynamic SVGs inside `<img>` `data:` URIs or `/qr.svg` endpoints.
- ALL user input MUST be validated server-side (`Number.isInteger`, regex checks, length bounds).

## Security Headers & Content Security Policy

- Set these headers on ALL responses via global middleware:
  - `Content-Security-Policy` with explicit `default-src 'self'`, `script-src` without `'unsafe-inline'` or `'unsafe-eval'`, `object-src 'none'`, `base-uri 'self'`, `form-action 'self'`, and `frame-ancestors 'none'`
  - `Strict-Transport-Security: max-age=31536000; includeSubDomains`
  - `X-Frame-Options: DENY`
  - `X-Content-Type-Options: nosniff`
  - `Referrer-Policy: strict-origin-when-cross-origin`

## CORS & CSRF

- NEVER set `Access-Control-Allow-Origin: *` or reflect arbitrary `Origin` headers.
- Every state-changing endpoint (`POST`, `PUT`, `PATCH`, `DELETE`) MUST enforce `SameSite=Lax` cookies AND server-side `Origin` / `Sec-Fetch-Site` validation (`sameOriginCheck`).
- NEVER perform state changes on `GET` requests.

## Rate Limiting & Proxy Trust

- Login, OTP, order creation, and admin authentication MUST enforce rate limiting and lockout (`429`).
- NEVER set Express `trust proxy` to boolean `true` (which trusts spoofable leftmost `X-Forwarded-For` headers); use numeric hop count (`1`).

## Error Handling & Production Exposure

- NEVER expose stack traces, SQL errors, file paths, or library versions (`app.disable('x-powered-by')`) in HTTP responses.
- NEVER serve `.env`, `.git/`, database dumps, source maps (`.js.map`), or directory listings (`index: false`, `dotfiles: 'deny'`).

## Password Hashing & Dependencies

- ALWAYS use `crypto.scrypt` (with random 16-byte salt and constant-time comparison) for password hashing — never MD5, SHA-1, or plain SHA-256.
- Pin exact dependency versions in `package.json` (no `^` or `~`) and commit `package-lock.json`.
