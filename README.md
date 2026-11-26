# BlockNexa

One project: the website, the admin panel and the backend, started with one command.

## Run it
1. `npm install`
2. Copy `.env.example` to `.env` and fill it in (at least `ADMIN_KEY`, `APP_SECRET`, `UPI_IDS`, `DEPOSIT_ADDRESS`).
3. Telegram login codes (once): put `TELEGRAM_API_ID` and `TELEGRAM_API_HASH` in `.env`, run `npm run telegram-login`, paste the printed `TELEGRAM_SESSION` line into `.env`.
4. `npm start`
   - Website: http://localhost:3000
   - Admin panel: `http://localhost:3000/<ADMIN_PATH>` (asks for your `ADMIN_KEY`; `/admin` is disabled and returns 404)

Without the Telegram values the server only PRINTS login codes in the terminal (fine for testing on your own PC).

## Folders
```
server.js            the backend (login, orders, wallet, admin API) and serves everything below
otp-telegram.js      sends login codes from your Telegram account
Scripts/             telegram-login.js (run once)
public/              the website the users see
  blocknexa.html, bn-config.js, bn-app.js, bn-style.css
  admin/             the admin panel: bn-admin.html, bn-admin.js, jsQR.js
data/                created on first start: the database (never commit it)
```

## Settings
- Names, support and community links: `public/bn-config.js`
- Colors: top of `public/bn-style.css`
- Rates, limits, UPI IDs, wallet address, keys: `.env`

## Going live (important)
- Put the database on a PERSISTENT disk: set `DATA_DIR` in `.env` to that folder.
- Use HTTPS. Behind Nginx, Render, or Cloudflare set `TRUST_PROXY=1`.
- Set `ADMIN_PATH` to your secret route, `ADMIN_KEY`, `APP_SECRET`, and optional `ADMIN_IPS` / `ADMIN_GATE_KEY`.
- Download a backup from the admin panel every few days and keep it off the server.
