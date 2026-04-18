/**
 * checkUser.js
 * Called on every guildMemberAdd.
 * - Queries Rotector (Discord) + TaseAPI in parallel
 * - If Roblox accounts are linked, queries Rotector (Roblox)
 * - ONLY posts a log embed if at least one flag was found
 * - Auto-bans if high-priority criteria are met
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

const RECENT_MS  = config.RECENT_DAYS * 24 * 60 * 60;
const BAN_REASON = 'Automated: detected in Condo servers.';

function isRecent(ts) {
  if (!ts || ts === 0) return false;
  return (Date.now() / 1000) - ts < RECENT_MS;
}

function fmtTs(ts) {
  if (!ts || ts === 0) return 'Unknown';
  return `<t:${ts}:R> (<t:${ts}:f>)`;
}

function trunc(str, max = 1024) {
  if (!str) return 'N/A';
  return String(str).length > max ? String(str).slice(0, max - 3) + '…' : String(str);
}

async function checkUser(member) {
  const { guild, user, id: userId } = member;
  const client = guild.client;

  // ── 0. Whitelist check ────────────────────────────────────────────────────
  if (isWhitelisted(userId)) return;

  // ── 1. Call APIs concurrently ─────────────────────────────────────────────
  let rotectorDiscord = null;
  let taseResult      = null;
  const apiErrors     = [];

  const [rdResult, taseRes] = await Promise.allSettled([
    checkDiscordUser(userId),
    checkTaseUser(userId),
  ]);

  if (rdResult.status === 'fulfilled') {
    rotectorDiscord = rdResult.value;
  } else {
    apiErrors.push(`Rotector Discord: ${rdResult.reason?.message || 'unknown error'}`);
  }

  if (taseRes.status === 'fulfilled') {
    taseResult = taseRes.value;
  } else {
    apiErrors.push(`TaseAPI: ${taseRes.reason?.message || 'unknown error'}`);
  }

  // ── 2. Notify error channel if any API completely failed ──────────────────
  if (apiErrors.length > 0) {
    const errCh = await client.channels.fetch(config.ERROR_CHANNEL_ID).catch(() => null);
    if (errCh) {
      errCh.send({
        embeds: [new EmbedBuilder()
          .setColor(0xFFA500)
          .setTitle('⚠️ API Failure on Member Join')
          .setDescription(`**User:** ${user.tag} (\`${userId}\`)\n${apiErrors.map(e => `• ${e}`).join('\n')}`)
          .setTimestamp()
        ]
      }).catch(() => {});
    }
  }

  // ── 3. Roblox lookups for linked accounts ─────────────────────────────────
  const connections   = rotectorDiscord?.connections ?? [];
  const servers       = rotectorDiscord?.servers      ?? [];
  const altAccounts   = rotectorDiscord?.altAccounts  ?? [];
  const robloxResults = [];

  for (const conn of connections) {
    if (!conn.robloxUserId) continue;
    let rblx = null, rblxErr = null;
    try { rblx = await checkRobloxUser(conn.robloxUserId); }
    catch (e) { rblxErr = e.message; }
    robloxResults.push({ conn, data: rblx, error: rblxErr });
  }

  // ── 4. Check if there are ANY flags at all ────────────────────────────────
  const hasRotectorDiscordFlags = servers.length > 0;
  const hasTaseFlag             = taseResult?.found === true;
  const hasRobloxFlags          = robloxResults.some(r => r.data && r.data.flagType > 0);
  const hasAnyFlag              = hasRotectorDiscordFlags || hasTaseFlag || hasRobloxFlags;

  // Completely clean and no API errors → silent return, no log
  if (!hasAnyFlag && apiErrors.length === 0) return;

  // ── 5. Determine severity ─────────────────────────────────────────────────
  let highPriority = false;
  const triggerReasons = [];

  if (hasRotectorDiscordFlags) {
    if (servers.length >= config.SERVER_THRESHOLD) {
      highPriority = true;
      triggerReasons.push(`In **${servers.length}** flagged servers (threshold: ${config.SERVER_THRESHOLD})`);
    }
    const recentServer = servers.find(s => isRecent(s.updatedAt));
    if (recentServer) {
      highPriority = true;
      triggerReasons.push(`Recently seen in **${recentServer.serverName || recentServer.serverId}** (${fmtTs(recentServer.updatedAt)})`);
    }
  }

  for (const { conn, data: rblx } of robloxResults) {
    if (rblx && rblx.flagType > 0 && isRecent(rblx.lastUpdated)) {
      highPriority = true;
      triggerReasons.push(
        `Roblox **${conn.robloxUsername || conn.robloxUserId}** flagged (type ${rblx.flagType}, ${fmtTs(rblx.lastUpdated)})`
      );
    }
  }

  // ── 6. Auto-ban if high priority ──────────────────────────────────────────
  let banned = false;
  if (highPriority) {
    try {
      await user.send(
        `🚫 You have been detected in condo servers. ` +
        `You have been banned. You may appeal here: **${config.APPEAL_LINK}**`
      );
    } catch (_) {}

    try {
      await guild.members.ban(userId, { reason: BAN_REASON });
      banned = true;
    } catch (e) {
      triggerReasons.push(`⚠️ Ban failed: ${e.message}`);
    }
  }

  // ── 7. Build log embed ────────────────────────────────────────────────────
  const colour   = highPriority ? 0xE53935 : 0x43A047;
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
          ? (banned ? '✅ Auto-banned' : '❌ Ban failed — manual action needed')
          : 'No auto-action taken',
        inline: true,
      }
    )
    .setTimestamp();

  // ── Rotector Discord ──────────────────────────────────────────────────────
  if (rdResult.status === 'rejected') {
    embed.addFields({ name: '🕵️ Rotector — Discord', value: '⚠️ API unavailable' });
  } else if (hasRotectorDiscordFlags) {
    const serverList = servers.slice(0, 10).map(s =>
      `• **${s.serverName || s.serverId}** — last seen ${fmtTs(s.updatedAt)}`
    ).join('\n');
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
  }

  // ── TaseAPI ───────────────────────────────────────────────────────────────
  if (taseResult === null && taseRes.status === 'rejected') {
    embed.addFields({ name: '👁️ TaseAPI', value: '⚠️ Unavailable / timed out' });
  } else if (hasTaseFlag) {
    embed.addFields({
      name: '👁️ TaseAPI — Flagged',
      value: trunc(JSON.stringify(taseResult.raw, null, 2), 900),
    });
  }

  // ── Roblox ────────────────────────────────────────────────────────────────
  for (const { conn, data: rblx, error } of robloxResults) {
    if (error) {
      embed.addFields({
        name: `🎮 Roblox: ${conn.robloxUsername || conn.robloxUserId}`,
        value: `⚠️ Lookup failed: ${error}`,
      });
    } else if (rblx && rblx.flagType > 0) {
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
  }

  // ── Trigger reasons ───────────────────────────────────────────────────────
  if (triggerReasons.length > 0) {
    embed.addFields({
      name: highPriority ? '🚨 Ban Triggers' : 'ℹ️ Flags Noted',
      value: trunc(triggerReasons.map(r => `• ${r}`).join('\n')),
    });
  }

  // ── 8. Buttons ────────────────────────────────────────────────────────────
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

  // ── 9. Post log ───────────────────────────────────────────────────────────
  const logCh = await client.channels.fetch(config.LOG_CHANNEL_ID).catch(() => null);
  if (logCh) {
    await logCh.send({ embeds: [embed], components: [row] }).catch(console.error);
  }
}

module.exports = { checkUser };
