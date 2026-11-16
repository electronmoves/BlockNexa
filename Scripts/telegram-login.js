// Run ONCE:  npm run telegram-login
// Logs in to your dedicated sender account and prints the TELEGRAM_SESSION value to paste into .env.
const fs = require('fs'), path = require('path'), readline = require('readline/promises');
try { fs.readFileSync(path.join(__dirname, '..', '.env'), 'utf8').split(/\r?\n/).forEach(l => { const m = l.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/); if (m && !(m[1] in process.env)) process.env[m[1]] = m[2]; }); } catch {}
const { TelegramClient } = require('telegram'), { StringSession } = require('telegram/sessions');
(async () => {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const id = Number(process.env.TELEGRAM_API_ID || await rl.question('API ID: ')), hash = process.env.TELEGRAM_API_HASH || await rl.question('API hash: ');
  const client = new TelegramClient(new StringSession(''), id, hash, { connectionRetries: 5 });
  await client.start({
    phoneNumber: () => rl.question('Phone number of the SENDER account (like +91...): '),
    phoneCode: () => rl.question('Code Telegram just sent you: '),
    password: () => rl.question('Two-step password (press Enter if none): '),
    onError: e => console.log('Problem:', e.message),
  });
  console.log('\nLogged in. Put this line in your .env file (keep it secret, it is a key to that Telegram account):\n');
  console.log('TELEGRAM_SESSION=' + client.session.save() + '\n');
  rl.close(); process.exit(0);
})();