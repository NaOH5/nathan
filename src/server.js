/**
 * server.js
 * Lightweight Express HTTP server that receives Google Form submissions
 * from Google Apps Script and forwards them to the appeal handler.
 *
 * Security: every request must include the header
 *   X-Webhook-Secret: <WEBHOOK_SECRET from .env>
 */

const express = require('express');
const config  = require('../config');
const { processAppeal } = require('./handlers/appealHandler');

function createServer(client) {
  const app = express();
  app.use(express.json());

  // ── Health check ─────────────────────────────────────────────────────────
  app.get('/', (_req, res) => res.send('Guardian bot is online.'));

  // ── Appeal webhook ────────────────────────────────────────────────────────
  app.post('/appeal', async (req, res) => {
    // 1. Validate secret
    const secret = req.headers['x-webhook-secret'];
    if (!config.WEBHOOK_SECRET || secret !== config.WEBHOOK_SECRET) {
      console.warn('[webhook] Rejected request — bad or missing secret.');
      return res.status(401).json({ error: 'Unauthorized' });
    }

    // 2. Validate body
    const body = req.body;
    if (!body || typeof body !== 'object') {
      return res.status(400).json({ error: 'Invalid JSON body' });
    }

    // 3. Must have at least a discordUserId or responses array
    if (!body.discordUserId && !body.discord_id && !Array.isArray(body.responses)) {
      return res.status(400).json({ error: 'Missing required fields (discordUserId / responses)' });
    }

    // 4. Process (async — we return 200 immediately so GAS doesn't time out)
    res.status(200).json({ ok: true });

    processAppeal(client, body).catch(err => {
      console.error('[Appeal] processAppeal error:', err);
    });
  });

  return app;
}

module.exports = { createServer };
