// Sends the login code from YOUR dedicated Telegram account (a user account, using your API ID and API hash).
// Only loaded when OTP_TRANSPORT=telegram. Needs TELEGRAM_API_ID, TELEGRAM_API_HASH and TELEGRAM_SESSION in .env.
const { TelegramClient, Api } = require('telegram');
const { StringSession } = require('telegram/sessions');
const bigInt = require('big-integer');
let client = null, connecting = null;

async function getClient() {
  if (client && client.connected) return client;
  if (connecting) return connecting;
  const id = Number(process.env.TELEGRAM_API_ID), hash = process.env.TELEGRAM_API_HASH, session = process.env.TELEGRAM_SESSION;
  if (!id || !hash || !session) throw new Error('Telegram is not set up: add TELEGRAM_API_ID, TELEGRAM_API_HASH and TELEGRAM_SESSION to .env');
  connecting = (async () => {
    const c = new TelegramClient(new StringSession(session), id, hash, { connectionRetries: 5 });
    await c.connect();
    if (!(await c.checkAuthorization())) throw new Error('The Telegram session is no longer valid. Run "npm run telegram-login" again.');
    client = c; return c;
  })().finally(() => { connecting = null; });
  return connecting;
}

async function send(phone, text) {
  const c = await getClient();
  // Look the number up on Telegram (this briefly adds it to the sender account's contacts), send, then remove it again.
  const found = await c.invoke(new Api.contacts.ImportContacts({ contacts: [new Api.InputPhoneContact({ clientId: bigInt(Date.now()), phone, firstName: 'BlockNexa', lastName: 'User' })] }));
  const user = found.users && found.users[0];
  if (!user) throw new Error('this number is not on Telegram, or hides itself from number search');
  try { await c.sendMessage(user, { message: text }); }
  finally { c.invoke(new Api.contacts.DeleteContacts({ id: [user] })).catch(() => {}); }
}
module.exports = { send };
