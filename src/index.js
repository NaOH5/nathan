/**
 * index.js — entry point
 */

const {
  Client,
  GatewayIntentBits,
  Partials,
} = require('discord.js');
const fs     = require('fs');
const path   = require('path');
const http   = require('http');
const https  = require('https');
const config = require('../config');
const { createServer } = require('./server');

// ── Discord client ────────────────────────────────────────────────────────────

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.DirectMessages,
  ],
  partials: [Partials.Channel],
});

// ── Auto-load events ──────────────────────────────────────────────────────────

const eventsDir = path.join(__dirname, 'events');
fs.readdirSync(eventsDir)
  .filter(f => f.endsWith('.js'))
  .forEach(file => {
    const event = require(path.join(eventsDir, file));
    if (event.once) {
      client.once(event.name, (...args) => event.execute(...args));
    } else {
      client.on(event.name, (...args) => event.execute(...args));
    }
  });

// ── Ready ─────────────────────────────────────────────────────────────────────

client.once('ready', () => {
  console.log(`✅ Logged in as ${client.user.tag}`);
  console.log(`   Guilds: ${client.guilds.cache.size}`);
  startSelfPing();
});

// ── Self-ping to prevent Render free tier from sleeping ───────────────────────
// Pings own /ping endpoint every 10 minutes from inside the process.
// Works even if UptimeRobot is delayed or down.

function startSelfPing() {
  const renderUrl = process.env.RENDER_EXTERNAL_URL; // auto-set by Render
  if (!renderUrl) {
    console.log('[self-ping] RENDER_EXTERNAL_URL not set — skipping self-ping (local dev mode)');
    return;
  }

  const pingUrl = `${renderUrl}/ping`;
  const lib     = pingUrl.startsWith('https') ? https : http;

  const ping = () => {
    lib.get(pingUrl, (res) => {
      console.log(`[self-ping] ${new Date().toISOString()} — status ${res.statusCode}`);
    }).on('error', (err) => {
      console.warn(`[self-ping] Failed: ${err.message}`);
    });
  };

  // First ping after 1 minute, then every 10 minutes
  setTimeout(() => {
    ping();
    setInterval(ping, 10 * 60 * 1000);
  }, 60 * 1000);

  console.log(`[self-ping] Scheduled — will ping ${pingUrl} every 10 minutes`);
}

// ── Global error handling ─────────────────────────────────────────────────────

client.on('error', err => console.error('[Discord client error]', err));
process.on('unhandledRejection', err => console.error('[Unhandled rejection]', err));

// ── Start HTTP server ─────────────────────────────────────────────────────────

const app = createServer(client);
app.listen(config.PORT, () => {
  console.log(`🌐 Webhook server listening on port ${config.PORT}`);
});

// ── Login ─────────────────────────────────────────────────────────────────────

client.login(config.TOKEN);
