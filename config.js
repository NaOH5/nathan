require('dotenv').config();

module.exports = {
  // ── Discord ──────────────────────────────────────────────
  TOKEN:           process.env.DISCORD_TOKEN,
  CLIENT_ID:       process.env.CLIENT_ID,
  GUILD_ID:        process.env.GUILD_ID,

  // ── Channels ─────────────────────────────────────────────
  LOG_CHANNEL_ID:      process.env.LOG_CHANNEL_ID,      // join-check logs
  MOD_LOG_CHANNEL_ID:  process.env.MOD_LOG_CHANNEL_ID,  // staff action logs
  APPEAL_CHANNEL_ID:   process.env.APPEAL_CHANNEL_ID,   // appeal threads
  ERROR_CHANNEL_ID:    process.env.ERROR_CHANNEL_ID,    // API error alerts

  // ── Roles ─────────────────────────────────────────────────
  STAFF_ROLE_ID: process.env.STAFF_ROLE_ID,

  // ── External APIs ─────────────────────────────────────────
  ROTECTOR_API_KEY: process.env.ROTECTOR_API_KEY,
  TASE_API_KEY:     process.env.TASE_API_KEY,

  // ── Appeal / Webhook ──────────────────────────────────────
  APPEAL_LINK:     process.env.APPEAL_LINK     || 'https://your-appeal-form-link.com',
  WEBHOOK_SECRET:  process.env.WEBHOOK_SECRET  || '',

  // ── Thresholds ────────────────────────────────────────────
  SERVER_THRESHOLD: parseInt(process.env.SERVER_THRESHOLD) || 6,
  RECENT_DAYS:      parseInt(process.env.RECENT_DAYS)      || 30,

  // ── HTTP server ───────────────────────────────────────────
  PORT: parseInt(process.env.PORT) || 3000,

  // ── API base URLs ─────────────────────────────────────────
  ROTECTOR_BASE: 'https://roscoe.rotector.com/v1',
  TASE_BASE:     'https://api.tasebot.org/v2',
};
