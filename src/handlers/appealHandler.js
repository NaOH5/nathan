/**
 * appealHandler.js
 *
 * Two responsibilities:
 *  1. processAppeal(client, formData) — called by the Express webhook when
 *     Google Forms sends a submission. Creates a thread and posts the appeal.
 *
 *  2. routeAppealButton(interaction) — handles all appeal:* button presses.
 *
 * Appeal button customId patterns:
 *   appeal:agree:<threadId>
 *   appeal:disagree:<threadId>
 *   appeal:unban:<userId>:<threadId>
 *   appeal:discard:<threadId>
 */

const {
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ThreadAutoArchiveDuration,
} = require('discord.js');

const config = require('../../config');
const { isWhitelisted, addToWhitelist, getAppeal, createAppeal, castVote, discardAppeal } = require('../utils/data');

// ─── thread name generator ────────────────────────────────────────────────────

const WORDS = [
  'ALPHA', 'BRAVO', 'CHARLIE', 'DELTA', 'ECHO', 'FOXTROT', 'GOLF', 'HOTEL',
  'INDIA', 'JULIET', 'KILO', 'LIMA', 'MIKE', 'NOVEMBER', 'OSCAR', 'PAPA',
  'QUEBEC', 'ROMEO', 'SIERRA', 'TANGO', 'UNIFORM', 'VICTOR', 'WHISKEY',
  'XRAY', 'YANKEE', 'ZULU',
  'AMBER', 'BLAZE', 'CEDAR', 'DRAKE', 'EMBER', 'FLINT', 'GROVE', 'HAWK',
  'IRIS', 'JADE', 'KESTREL', 'LANCE', 'MAPLE', 'NOVA', 'OAK', 'PINE',
  'QUARTZ', 'RAVEN', 'STORM', 'TITAN', 'ULTRA', 'VIPER', 'WOLF',
];

function randomThreadName() {
  const word = WORDS[Math.floor(Math.random() * WORDS.length)];
  const num  = String(Math.floor(100 + Math.random() * 900)); // 100–999
  return `${word}-${num}`;
}

// ─── vote display helper ──────────────────────────────────────────────────────

function buildVoteBar(agree, disagree) {
  const total = agree + disagree;
  if (total === 0) return '✅ Agree: **0**  |  ❌ Disagree: **0**  —  No votes yet';
  const pct = Math.round((agree / total) * 100);
  return `✅ Agree: **${agree}**  |  ❌ Disagree: **${disagree}**  |  **${pct}% / ${100 - pct}%**`;
}

// ─── build the appeal message components ─────────────────────────────────────

function buildAppealEmbed(formData, appeal) {
  const embed = new EmbedBuilder()
    .setColor(0x7E57C2)
    .setTitle('📋 Appeal Submission')
    .setDescription('A banned user has submitted an appeal. Review the information below and vote.')
    .setTimestamp();

  // Dynamic form fields — Google Apps Script sends { responses: [{question, answer}] }
  const responses = formData.responses || [];
  for (const { question, answer } of responses) {
    if (!question) continue;
    embed.addFields({
      name: String(question).slice(0, 256),
      value: String(answer || 'No answer provided').slice(0, 1024),
    });
  }

  // Discord ID field (Google Form should ask for this)
  const discordId = formData.discordUserId || formData.discord_id || null;
  if (discordId) {
    embed.addFields({ name: '🆔 Discord User ID', value: `\`${discordId}\``, inline: true });
  }

  // Vote tally at the bottom
  const a = appeal?.agree?.length    ?? 0;
  const d = appeal?.disagree?.length ?? 0;
  embed.addFields({ name: '📊 Current Votes', value: buildVoteBar(a, d) });

  return embed;
}

function buildAppealButtons(userId, threadId, discarded = false) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`appeal:agree:${threadId}`)
      .setLabel('✅ Agree')
      .setStyle(ButtonStyle.Success)
      .setDisabled(discarded),
    new ButtonBuilder()
      .setCustomId(`appeal:disagree:${threadId}`)
      .setLabel('❌ Disagree')
      .setStyle(ButtonStyle.Danger)
      .setDisabled(discarded),
    new ButtonBuilder()
      .setCustomId(`appeal:unban:${userId}:${threadId}`)
      .setLabel('🔓 Unban')
      .setStyle(ButtonStyle.Primary)
      .setDisabled(discarded),
    new ButtonBuilder()
      .setCustomId(`appeal:discard:${threadId}`)
      .setLabel('🗑️ Discard')
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(discarded),
  );
}

// ═════════════════════════════════════════════════════════════════════════════
//  1. Process incoming appeal from Google Forms webhook
// ═════════════════════════════════════════════════════════════════════════════

async function processAppeal(client, formData) {
  const appealCh = await client.channels.fetch(config.APPEAL_CHANNEL_ID).catch(() => null);
  if (!appealCh) {
    console.error('[Appeal] APPEAL_CHANNEL_ID not found.');
    return;
  }

  const discordId = formData.discordUserId || formData.discord_id || 'unknown';
  const threadName = randomThreadName();

  // Create thread in the appeal channel
  const thread = await appealCh.threads.create({
    name: threadName,
    autoArchiveDuration: ThreadAutoArchiveDuration.OneWeek,
    reason: `Appeal submission — case ${threadName}`,
  });

  // Seed the vote record
  createAppeal(thread.id, discordId);
  const appeal = getAppeal(thread.id);

  const embed    = buildAppealEmbed(formData, appeal);
  const buttons  = buildAppealButtons(discordId, thread.id);

  await thread.send({ embeds: [embed], components: [buttons] });
}

// ═════════════════════════════════════════════════════════════════════════════
//  2. Route appeal button interactions
// ═════════════════════════════════════════════════════════════════════════════

function hasStaffRole(member) {
  return member.roles.cache.has(config.STAFF_ROLE_ID);
}

async function postModLog(client, description) {
  const ch = await client.channels.fetch(config.MOD_LOG_CHANNEL_ID).catch(() => null);
  if (!ch) return;
  ch.send({
    embeds: [new EmbedBuilder()
      .setColor(0x90CAF9)
      .setTitle('📋 Moderation Action')
      .setDescription(description)
      .setTimestamp()
    ],
  }).catch(() => {});
}

// ─── update the embed in the thread message with fresh vote counts ─────────────

async function refreshVoteEmbed(interaction, threadId) {
  const appeal = getAppeal(threadId);
  if (!appeal) return;

  const original = interaction.message;
  const oldEmbed = original.embeds[0];
  if (!oldEmbed) return;

  // Rebuild embed, updating the votes field
  const newEmbed = EmbedBuilder.from(oldEmbed);
  const fields = newEmbed.data.fields || [];
  const voteIdx = fields.findIndex(f => f.name === '📊 Current Votes');
  const a = appeal.agree.length;
  const d = appeal.disagree.length;
  const voteText = buildVoteBar(a, d);

  if (voteIdx >= 0) {
    fields[voteIdx] = { name: '📊 Current Votes', value: voteText };
  } else {
    fields.push({ name: '📊 Current Votes', value: voteText });
  }
  newEmbed.setFields(fields);

  const buttons = buildAppealButtons(appeal.targetUserId, threadId, appeal.discarded);
  await original.edit({ embeds: [newEmbed], components: [buttons] }).catch(() => {});
}

// ─── handlers ─────────────────────────────────────────────────────────────────

async function handleVote(interaction, side, threadId) {
  const appeal = getAppeal(threadId);
  if (!appeal) return interaction.reply({ content: 'Appeal not found.', ephemeral: true });
  if (appeal.discarded) return interaction.reply({ content: 'This appeal has been discarded.', ephemeral: true });

  castVote(threadId, interaction.user.id, side);
  await interaction.deferUpdate();
  await refreshVoteEmbed(interaction, threadId);
}

async function handleAppealUnban(interaction, userId, threadId) {
  if (!hasStaffRole(interaction.member)) {
    return interaction.reply({ content: '❌ You need the staff role to use this.', ephemeral: true });
  }
  const appeal = getAppeal(threadId);
  if (!appeal) return interaction.reply({ content: 'Appeal not found.', ephemeral: true });
  if (appeal.discarded) return interaction.reply({ content: 'This appeal has been discarded.', ephemeral: true });

  await interaction.deferReply({ ephemeral: true });

  try {
    await interaction.guild.members.unban(userId, `Appeal approved by ${interaction.user.tag}`);
  } catch (e) {
    if (!e.message.includes('Unknown Ban')) {
      return interaction.editReply(`❌ Unban failed: ${e.message}`);
    }
  }

  addToWhitelist(userId);
  discardAppeal(threadId); // lock the appeal after unban

  const buttons = buildAppealButtons(userId, threadId, true); // disable all
  await interaction.message.edit({ components: [buttons] }).catch(() => {});

  await interaction.editReply(`✅ <@${userId}> has been unbanned and whitelisted.`);

  // Notify thread
  await interaction.channel.send(
    `✅ **Appeal Approved** — <@${userId}> has been unbanned by <@${interaction.user.id}>.`
  ).catch(() => {});

  await postModLog(
    interaction.client,
    `**Action:** Appeal Unban + Whitelist\n` +
    `**Target:** <@${userId}> (\`${userId}\`)\n` +
    `**Staff:** ${interaction.user.tag} (\`${interaction.user.id}\`)\n` +
    `**Thread:** ${interaction.channel.name}`
  );
}

async function handleAppealDiscard(interaction, threadId) {
  if (!hasStaffRole(interaction.member)) {
    return interaction.reply({ content: '❌ You need the staff role to use this.', ephemeral: true });
  }

  discardAppeal(threadId);
  await interaction.deferUpdate();
  await refreshVoteEmbed(interaction, threadId); // refresh with buttons now disabled

  await interaction.channel.send(
    `🗑️ Appeal discarded by <@${interaction.user.id}>. Voting and unban are now locked.`
  ).catch(() => {});

  await postModLog(
    interaction.client,
    `**Action:** Appeal Discarded\n` +
    `**Staff:** ${interaction.user.tag} (\`${interaction.user.id}\`)\n` +
    `**Thread:** ${interaction.channel.name}`
  );
}

// ─── router ───────────────────────────────────────────────────────────────────

async function routeAppealButton(interaction) {
  const parts = interaction.customId.split(':');
  // parts[0] = 'appeal'
  const sub = parts[1];

  if (sub === 'agree' || sub === 'disagree') {
    const threadId = parts[2];
    return handleVote(interaction, sub, threadId);
  }
  if (sub === 'unban') {
    const userId   = parts[2];
    const threadId = parts[3];
    return handleAppealUnban(interaction, userId, threadId);
  }
  if (sub === 'discard') {
    const threadId = parts[2];
    return handleAppealDiscard(interaction, threadId);
  }
}

module.exports = { processAppeal, routeAppealButton };
