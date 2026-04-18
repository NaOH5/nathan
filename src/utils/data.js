/**
 * index.js — entry point
 *
 * Starts the Discord gateway client and the Express webhook server
 * on the same process.
 */

const {
  Client,
  GatewayIntentBits,
  Partials,
} = require('discord.js');
const fs     = require('fs');
const path   = require('path');
const config = require('../config');
const { createServer } = require('./server');

// ── Discord client ────────────────────────────────────────────────────────────

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,    // required for guildMemberAdd
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.DirectMessages,
  ],
  partials: [Partials.Channel], // needed for DMs
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

// ── Ready event ───────────────────────────────────────────────────────────────

client.once('ready', () => {
  console.log(`✅ Logged in as ${client.user.tag}`);
  console.log(`   Guilds: ${client.guilds.cache.size}`);
});

// ── Global error handling ─────────────────────────────────────────────────────

client.on('error', err => console.error('[Discord client error]', err));
process.on('unhandledRejection', err => console.error('[Unhandled rejection]', err));

// ── Start HTTP server ─────────────────────────────────────────────────────────
// The Express server shares the same process as the bot so it can pass
// the Discord client directly to appeal handlers.

const app = createServer(client);
app.listen(config.PORT, () => {
  console.log(`🌐 Webhook server listening on port ${config.PORT}`);
  console.log(`   Appeal endpoint: POST /appeal`);
});

// ── Login ─────────────────────────────────────────────────────────────────────

client.login(config.TOKEN);
