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
    .setDescription('A banned user has submitted an appeal. Review the information below and vote.')
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

  const discordId  = formData.discordUserId || formData.disco
