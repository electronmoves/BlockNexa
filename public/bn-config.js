// Settings you can change without touching the app code. (Rates, limits, UPI and wallet addresses live in the backend .env.)
window.BN = { cfg: {
  NAME: 'BlockNexa',                         // platform name
  OTP_SENDER: 'YourOtpUsername',             // username (without @) of the Telegram account that sends the login codes. Users see it so they know the code is genuine
  // ---- Support and community (edit these three lines) ----
  SUPPORT_TELEGRAM: 'YourSupportUsername',   // your support Telegram username, without the @  (or a full https://t.me/... link)
  SUPPORT_EMAIL: 'support@yourdomain.com',   // your dedicated support email
  COMMUNITY_TELEGRAM: 'YourCommunityName'    // your community group or channel username (or a full invite link)
}};
