/**
 * checkUser.js
 * Called every time a member joins the server.
 * Orchestrates Rotector + TaseAPI calls, determines priority,
 * auto-bans if criteria are met, and posts a log embed.
 */

const {
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
} = require('discord.js');

const config = require('../../config');
const { checkDiscordUser, checkRobloxUser, checkTaseUser } = require('../utils/apis');
const { isWhitelisted } = require('../utils/data');

// ─── constants ────────────────────────────────────────────────────────────────

const RECENT_MS  = config.RECENT_DAYS * 24 * 60 * 60; // seconds
const BAN_REASON = 'Automated: detected in multiple inappropriate Roblox-related servers.';

// ─── helpers ──────────────────────────────────────────────────────────────────

/** Is a Unix-seconds timestamp within the recent window? */
function isRecent(ts) {
  if (!ts || ts === 0) return false;
  return (Date.now() / 1000) - ts < RECENT_MS;
}

/** Format a Unix-seconds timestamp to a readable date, or 'Unknown'. */
function fmtTs(ts) {
  if (!ts || ts === 0) return 'Unknown';
  return `<t:${ts}:R> (<t:${ts}:f>)`;
}

/** Truncate a string to max length for embed safety. */
function trunc(str, max = 1024) {
  if (!str) return 'N/A';
  return String(str).length > max ? String(str).slice(0, max - 3) + '…' : String(str);
}

// ─── main export ──────────────────────────────────────────────────────────────

/**
 * Run all API checks for a newly joined member and post the result log.
 * @param {GuildMember} member
 */
async function checkUser(member) {
  const { guild, user, id: userId } = member;
  const client = guild.client;

  // ── 0. Whitelist check ────────────────────────────────────────────────────
  if (isWhitelisted(userId)) return; // silently skip

  // ── 1. Call all APIs concurrently ─────────────────────────────────────────
  let rotectorDiscord = null;
  let taseResult      = null;
  let rotectorErrors  = [];

  const [rdResult, taseRes] = await Promise.allSettled([
    checkDiscordUser(userId),
    checkTaseUser(userId),
  ]);

  if (rdResult.status === 'fulfilled') {
    rotectorDiscord = rdResult.value; // null = clean
  } else {
    rotectorErrors.push(`Rotector Discord: ${rdResult.reason?.message || 'unknown error'}`);
  }

  if (taseRes.status === 'fulfilled') {
    taseResult = taseRes.value; // null = API down
  } else {
    rotectorErrors.push(`TaseAPI: ${taseRes.reason?.message || 'unknown error'}`);
  }

  // ── 2. If ANY API completely failed, notify error channel ─────────────────
  if (rotectorErrors.length > 0) {
    const errCh = await client.channels.fetch(config.ERROR_CHANNEL_ID).catch(() => null);
    if (errCh) {
      errCh.send({
        embeds: [new EmbedBuilder()
          .setColor(0xFFA500)
          .setTitle('⚠️ API Failure on Member Join')
          .setDescription(
            `**User:** ${user.tag} (${userId})\n` +
            `**Errors:**\n${rotectorErrors.map(e => `• ${e}`).join('\n')}`
          )
          .setTimestamp()
        ]
      }).catch(() => {});
    }
  }

  // ── 3. Roblox lookup (if Discord record has connections) ──────────────────
  const robloxResults = [];
  const connections   = rotectorDiscord?.connections ?? [];
  const altAccounts   = rotectorDiscord?.altAccounts  ?? [];
  const servers       = rotectorDiscord?.servers       ?? [];

  for (const conn of connections) {
    if (!conn.robloxUserId) continue;
    let rblx = null;
    let rblxErr = null;
    try {
      rblx = await checkRobloxUser(conn.robloxUserId);
    } catch (e) {
      rblxErr = e.message;
    }
    robloxResults.push({ conn, data: rblx, error: rblxErr });
  }

  // ── 4. Determine severity ─────────────────────────────────────────────────
  let highPriority = false;
  const triggerReasons = [];

  // Discord triggers
  if (servers.length >= config.SERVER_THRESHOLD) {
    highPriority = true;
    triggerReasons.push(`In **${servers.length}** flagged servers (threshold: ${config.SERVER_THRESHOLD})`);
  }
  const recentServer = servers.find(s => isRecent(s.updatedAt));
  if (recentServer) {
    highPriority = true;
    triggerReasons.push(
      `Recently seen in **${recentServer.serverName || recentServer.serverId}** (${fmtTs(recentServer.updatedAt)})`
    );
  }

  // Roblox triggers
  for (const { conn, data: rblx } of robloxResults) {
    if (rblx && rblx.flagType > 0 && isRecent(rblx.lastUpdated)) {
      highPriority = true;
      triggerReasons.push(
        `Roblox account **${conn.robloxUsername || conn.robloxUserId}** flagged (type ${rblx.flagType}, ${fmtTs(rblx.lastUpdated)})`
      );
    }
  }

  // ── 5. Auto-ban if high priority ──────────────────────────────────────────
  let banned = false;
  if (highPriority) {
    // DM first (fails gracefully if DMs are closed)
    try {
      await user.send(
        `🚫 You have been detected in multiple inappropriate servers. ` +
        `You have been banned. You may appeal your ban here: **${config.APPEAL_LINK}**`
      );
    } catch (_) { /* DMs closed — continue */ }

    try {
      await guild.members.ban(userId, { reason: BAN_REASON });
      banned = true;
    } catch (e) {
      triggerReasons.push(`⚠️ Ban failed: ${e.message}`);
    }
  }

  // ── 6. Build log embed ────────────────────────────────────────────────────
  const colour = highPriority ? 0xE53935 : 0x43A047;
  const priority = highPriority ? '🔴 HIGH PRIORITY' : '🟢 LOW PRIORITY';

  const embed = new EmbedBuilder()
    .setColor(colour)
    .setTitle(`${priority} — Member Join Scan`)
    .setThumbnail(user.displayAvatarURL({ size: 128 }))
    .addFields(
      {
        name: '👤 User',
        value: `${user.tag}\nID: \`${userId}\`\nBot: ${user.bot ? 'Yes' : 'No'}\nCreated: <t:${Math.floor(user.createdTimestamp / 1000)}:R>`,
        inline: true,
      },
      {
        name: '⚙️ Action',
        value: highPriority
          ? (banned ? '✅ Auto-banned' : '❌ Ban failed — manual action required')
          : 'No auto-action taken',
        inline: true,
      }
    )
    .setTimestamp();

  // ── Rotector Discord ──────────────────────────────────────────────────────
  if (rotectorDiscord) {
    const serverList = servers.slice(0, 10).map(s =>
      `• **${s.serverName || s.serverId}** — last seen ${fmtTs(s.updatedAt)}`
    ).join('\n') || 'None';

    embed.addFields({
      name: `🕵️ Rotector — Discord (${servers.length} flagged server${servers.length !== 1 ? 's' : ''})`,
      value: trunc(serverList),
    });

    if (altAccounts.length > 0) {
      embed.addFields({
        name: `🔁 Alt Accounts (${altAccounts.length})`,
        value: trunc(
          altAccounts.slice(0, 5).map(a =>
            `• ${a.robloxUsername || 'Unknown'} (ID: ${a.robloxUserId}) — ${fmtTs(a.detectedAt)}`
          ).join('\n')
        ),
      });
    }
  } else if (rdResult.status === 'rejected') {
    embed.addFields({ name: '🕵️ Rotector — Discord', value: '⚠️ API unavailable' });
  } else {
    embed.addFields({ name: '🕵️ Rotector — Discord', value: '✅ Not in database' });
  }

  // ── TaseAPI ───────────────────────────────────────────────────────────────
  if (taseResult === null) {
    embed.addFields({ name: '👁️ TaseAPI', value: '⚠️ Unavailable / timed out' });
  } else if (!taseResult.found) {
    embed.addFields({ name: '👁️ TaseAPI', value: '✅ Not found' });
  } else {
    embed.addFields({
      name: '👁️ TaseAPI — Flagged',
      value: trunc(JSON.stringify(taseResult.raw, null, 2), 900),
    });
  }

  // ── Roblox checks ─────────────────────────────────────────────────────────
  for (const { conn, data: rblx, error } of robloxResults) {
    if (error) {
      embed.addFields({
        name: `🎮 Roblox: ${conn.robloxUsername || conn.robloxUserId}`,
        value: `⚠️ Lookup failed: ${error}`,
      });
      continue;
    }
    if (!rblx) {
      embed.addFields({
        name: `🎮 Roblox: ${conn.robloxUsername || conn.robloxUserId}`,
        value: '✅ Not flagged',
      });
      continue;
    }

    const reasonLines = Object.entries(rblx.reasons ?? {}).map(([k, v]) =>
      `**${k}**: ${v.message} (confidence: ${Math.round((v.confidence ?? 0) * 100)}%)`
    ).join('\n') || 'No reasons listed';

    embed.addFields({
      name: `🎮 Roblox: ${conn.robloxUsername || conn.robloxUserId} (ID: ${conn.robloxUserId})`,
      value: trunc(
        `Flag type: **${rblx.flagType}** | Confidence: **${Math.round((rblx.confidence ?? 0) * 100)}%**\n` +
        `Last updated: ${fmtTs(rblx.lastUpdated)}\n${reasonLines}`
      ),
    });
  }

  // ── Trigger reasons ───────────────────────────────────────────────────────
  if (triggerReasons.length > 0) {
    embed.addFields({
      name: highPriority ? '🚨 Ban Triggers' : 'ℹ️ Flags Noted',
      value: trunc(triggerReasons.map(r => `• ${r}`).join('\n')),
    });
  }

  // ── 7. Build action buttons ───────────────────────────────────────────────
  const row = new ActionRowBuilder();

  if (highPriority) {
    row.addComponents(
      new ButtonBuilder()
        .setCustomId(`unban:${userId}`)
        .setLabel('🔓 Unban')
        .setStyle(ButtonStyle.Success)
    );
  } else {
    row.addComponents(
      new ButtonBuilder()
        .setCustomId(`ban:${userId}`)
        .setLabel('🔨 Ban')
        .setStyle(ButtonStyle.Danger),
      new ButtonBuilder()
        .setCustomId(`whitelist:${userId}`)
        .setLabel('✅ Whitelist')
        .setStyle(ButtonStyle.Secondary),
      new ButtonBuilder()
        .setCustomId(`contact:${userId}`)
        .setLabel('📨 Contact')
        .setStyle(ButtonStyle.Primary)
    );
  }

  // ── 8. Post to log channel ────────────────────────────────────────────────
  const logCh = await client.channels.fetch(config.LOG_CHANNEL_ID).catch(() => null);
  if (logCh) {
    await logCh.send({ embeds: [embed], components: [row] }).catch(console.error);
  }
}

module.exports = { checkUser };
