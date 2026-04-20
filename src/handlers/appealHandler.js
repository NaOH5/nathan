/**
 * appealHandler.js
 */

const {
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ThreadAutoArchiveDuration,
} = require('discord.js');

const config = require('../../config');
const {
  isWhitelisted, addToWhitelist,
  getAppeal, createAppeal, castVote, discardAppeal,
} = require('../utils/data');

// ── Thread name generator ─────────────────────────────────────────────────────

const WORDS = [
  'ALPHA','BRAVO','CHARLIE','DELTA','ECHO','FOXTROT','GOLF','HOTEL',
  'INDIA','JULIET','KILO','LIMA','MIKE','NOVEMBER','OSCAR','PAPA',
  'QUEBEC','ROMEO','SIERRA','TANGO','UNIFORM','VICTOR','WHISKEY',
  'XRAY','YANKEE','ZULU','AMBER','BLAZE','CEDAR','DRAKE','EMBER',
  'FLINT','GROVE','HAWK','IRIS','JADE','KESTREL','LANCE','MAPLE',
  'NOVA','OAK','PINE','QUARTZ','RAVEN','STORM','TITAN','VIPER','WOLF',
];

function randomThreadName() {
  const word = WORDS[Math.floor(Math.random() * WORDS.length)];
  const num  = String(Math.floor(100 + Math.random() * 900));
  return `${word}-${num}`;
}

// ── Vote bar ──────────────────────────────────────────────────────────────────

function buildVoteBar(agree, disagree) {
  const total = agree + disagree;
  if (total === 0) return '✅ Agree: **0**  |  ❌ Disagree: **0**  —  No votes yet';
  const pct = Math.round((agree / total) * 100);
  return `✅ Agree: **${agree}**  |  ❌ Disagree: **${disagree}**  |  **${pct}% / ${100 - pct}%**`;
}

// ── Build embed ───────────────────────────────────────────────────────────────

function buildAppealEmbed(formData, appeal) {
  const embed = new EmbedBuilder()
    .setColor(0x7E57C2)
    .setTitle('📋 Appeal Submission')
    .setDescription('A flagged user has submitted an appeal. Review the information below and vote. Please keep the appeal rules in mind.')
    .setTimestamp();

  const responses = formData.responses || [];
  for (const { question, answer } of responses) {
    if (!question) continue;
    embed.addFields({
      name:  String(question).slice(0, 256),
      value: String(answer || 'No answer provided').slice(0, 1024),
    });
  }

  const discordId = formData.discordUserId || formData.discord_id || null;
  if (discordId) {
    embed.addFields({ name: '🆔 Discord User ID', value: `\`${discordId}\``, inline: true });
  }

  const a = appeal?.agree?.length    ?? 0;
  const d = appeal?.disagree?.length ?? 0;
  embed.addFields({ name: '📊 Current Votes', value: buildVoteBar(a, d) });

  return embed;
}

// ── Build buttons ─────────────────────────────────────────────────────────────

function buildAppealButtons(userId, messageId, discarded = false) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`appeal:agree:${messageId}`)
      .setLabel('✅ Agree')
      .setStyle(ButtonStyle.Success)
      .setDisabled(discarded),
    new ButtonBuilder()
      .setCustomId(`appeal:disagree:${messageId}`)
      .setLabel('❌ Disagree')
      .setStyle(ButtonStyle.Danger)
      .setDisabled(discarded),
    new ButtonBuilder()
      .setCustomId(`appeal:unban:${userId}:${messageId}`)
      .setLabel('🔓 Unban')
      .setStyle(ButtonStyle.Primary)
      .setDisabled(discarded),
    new ButtonBuilder()
      .setCustomId(`appeal:discard:${messageId}`)
      .setLabel('🗑️ Discard')
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(discarded),
  );
}

// ═════════════════════════════════════════════════════════════════════════════
//  Process incoming appeal from Google Forms webhook
// ═════════════════════════════════════════════════════════════════════════════

async function processAppeal(client, formData) {
  const appealCh = await client.channels.fetch(config.APPEAL_CHANNEL_ID).catch(() => null);
  if (!appealCh) {
    console.error('[Appeal] APPEAL_CHANNEL_ID not found or bot cannot see it.');
    return;
  }

  const discordId  = formData.discordUserId || formData.discord_id || 'unknown';
  const threadName = randomThreadName();

  // 1. Post the embed as a normal channel message first
  const embed   = buildAppealEmbed(formData, { agree: [], disagree: [], discarded: false });
  const message = await appealCh.send({ content: `<@&1470036796791324733>`, embeds: [embed] });

  // 2. Seed appeal record keyed by message ID
  createAppeal(message.id, discordId);

  // 3. Edit the message to add buttons (now we have the message ID for customIds)
  const buttons = buildAppealButtons(discordId, message.id);
  await message.edit({ embeds: [embed], components: [buttons] });

  // 4. Create a thread ON that message
  await message.startThread({
    name: threadName,
    autoArchiveDuration: ThreadAutoArchiveDuration.OneWeek,
    reason: `Appeal case ${threadName}`,
  });
}

// ═════════════════════════════════════════════════════════════════════════════
//  Appeal button interactions
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

async function refreshVoteEmbed(interaction, messageId) {
  const appeal = getAppeal(messageId);
  if (!appeal) return;

  const oldEmbed = interaction.message.embeds[0];
  if (!oldEmbed) return;

  const newEmbed = EmbedBuilder.from(oldEmbed);
  const fields   = [...(newEmbed.data.fields || [])];
  const a = appeal.agree.length;
  const d = appeal.disagree.length;
  const voteText = buildVoteBar(a, d);
  const voteIdx  = fields.findIndex(f => f.name === '📊 Current Votes');

  if (voteIdx >= 0) {
    fields[voteIdx] = { name: '📊 Current Votes', value: voteText };
  } else {
    fields.push({ name: '📊 Current Votes', value: voteText });
  }
  newEmbed.setFields(fields);

  const buttons = buildAppealButtons(appeal.targetUserId, messageId, appeal.discarded);
  await interaction.message.edit({ embeds: [newEmbed], components: [buttons] }).catch(() => {});
}

// ── Vote ──────────────────────────────────────────────────────────────────────

async function handleVote(interaction, side, messageId) {
  const appeal = getAppeal(messageId);
  if (!appeal)           return interaction.reply({ content: 'Appeal not found.',           ephemeral: true });
  if (appeal.discarded)  return interaction.reply({ content: 'This appeal has been discarded.', ephemeral: true });

  castVote(messageId, interaction.user.id, side);
  await interaction.deferUpdate();
  await refreshVoteEmbed(interaction, messageId);
}

// ── Unban ─────────────────────────────────────────────────────────────────────

async function handleAppealUnban(interaction, userId, messageId) {
  if (!hasStaffRole(interaction.member))
    return interaction.reply({ content: '❌ You need the staff role to use this.', ephemeral: true });

  const appeal = getAppeal(messageId);
  if (!appeal)          return interaction.reply({ content: 'Appeal not found.',               ephemeral: true });
  if (appeal.discarded) return interaction.reply({ content: 'This appeal has been discarded.', ephemeral: true });

  await interaction.deferReply({ ephemeral: true });

  try {
    await interaction.guild.members.unban(userId, `Appeal approved by ${interaction.user.tag}`);
  } catch (e) {
    if (!e.message.includes('Unknown Ban'))
      return interaction.editReply(`❌ Unban failed: ${e.message}`);
  }

  addToWhitelist(userId);
  discardAppeal(messageId);

  const buttons = buildAppealButtons(userId, messageId, true);
  await interaction.message.edit({ components: [buttons] }).catch(() => {});
  await interaction.editReply(`✅ <@${userId}> has been unbanned and whitelisted.`);

  // Notify in the thread
  const thread = interaction.message.thread;
  if (thread) {
    await thread.send(`✅ **Appeal Approved** — <@${userId}> unbanned by <@${interaction.user.id}>.`).catch(() => {});
  }

  await postModLog(interaction.client,
    `**Action:** Appeal Unban + Whitelist\n` +
    `**Target:** <@${userId}> (\`${userId}\`)\n` +
    `**Staff:** ${interaction.user.tag} (\`${interaction.user.id}\`)\n` +
    `**Case:** ${interaction.message.thread?.name || messageId}`
  );
}

// ── Discard ───────────────────────────────────────────────────────────────────

async function handleAppealDiscard(interaction, messageId) {
  if (!hasStaffRole(interaction.member))
    return interaction.reply({ content: '❌ You need the staff role to use this.', ephemeral: true });

  discardAppeal(messageId);
  await interaction.deferUpdate();
  await refreshVoteEmbed(interaction, messageId);

  const thread = interaction.message.thread;
  if (thread) {
    await thread.send(`🗑️ Appeal discarded by <@${interaction.user.id}>. Voting and unban are now locked.`).catch(() => {});
  }

  await postModLog(interaction.client,
    `**Action:** Appeal Discarded\n` +
    `**Staff:** ${interaction.user.tag} (\`${interaction.user.id}\`)\n` +
    `**Case:** ${interaction.message.thread?.name || messageId}`
  );
}

// ── Router ────────────────────────────────────────────────────────────────────

async function routeAppealButton(interaction) {
  const parts = interaction.customId.split(':');
  const sub   = parts[1];

  if (sub === 'agree' || sub === 'disagree') return handleVote(interaction, sub, parts[2]);
  if (sub === 'unban')   return handleAppealUnban(interaction, parts[2], parts[3]);
  if (sub === 'discard') return handleAppealDiscard(interaction, parts[2]);
}

module.exports = { processAppeal, routeAppealButton };
