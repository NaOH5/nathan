/**
 * buttonHandlers.js
 * Handles every button interaction and modal submit for the join-check system.
 *
 * Button customId patterns:
 *   unban:<userId>       → Unban a high-priority flag (staff only)
 *   ban:<userId>         → Ban a low-priority flag (staff only)
 *   whitelist:<userId>   → Whitelist a user (staff only)
 *   contact:<userId>     → Open modal to DM the user (staff only)
 *
 * Modal customId patterns:
 *   contact_modal:<userId> → Message submitted, DM the user
 */

const {
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  ActionRowBuilder,
  EmbedBuilder,
} = require('discord.js');

const config = require('../../config');
const { isWhitelisted, addToWhitelist } = require('../utils/data');

// ─── permission guard ─────────────────────────────────────────────────────────

function hasStaffRole(member) {
  return member.roles.cache.has(config.STAFF_ROLE_ID);
}

async function denyPermission(interaction) {
  return interaction.reply({
    content: '❌ You do not have the required staff role to use this button.',
    ephemeral: true,
  });
}

// ─── log helper ───────────────────────────────────────────────────────────────

async function postModLog(client, description) {
  const ch = await client.channels.fetch(config.MOD_LOG_CHANNEL_ID).catch(() => null);
  if (!ch) return;
  ch.send({
    embeds: [
      new EmbedBuilder()
        .setColor(0x90CAF9)
        .setTitle('📋 Moderation Action')
        .setDescription(description)
        .setTimestamp(),
    ],
  }).catch(() => {});
}

// ─── disable all buttons on a message (called after final actions) ────────────

function disableAllButtons(message) {
  const rows = message.components.map(row => {
    const updated = row.toJSON();
    updated.components = updated.components.map(btn => ({ ...btn, disabled: true }));
    return updated;
  });
  return message.edit({ components: rows });
}

// ═════════════════════════════════════════════════════════════════════════════
//  BUTTON HANDLERS
// ═════════════════════════════════════════════════════════════════════════════

// ─── unban:<userId> ───────────────────────────────────────────────────────────

async function handleUnban(interaction, userId) {
  if (!hasStaffRole(interaction.member)) return denyPermission(interaction);
  await interaction.deferReply({ ephemeral: true });

  try {
    await interaction.guild.members.unban(userId, `Unbanned by ${interaction.user.tag}`);
  } catch (e) {
    if (!e.message.includes('Unknown Ban')) {
      return interaction.editReply(`❌ Unban failed: ${e.message}`);
    }
    // User was not banned — still whitelist them
  }

  addToWhitelist(userId);

  await disableAllButtons(interaction.message).catch(() => {});

  await interaction.editReply(`✅ <@${userId}> has been unbanned and added to the whitelist.`);

  await postModLog(
    interaction.client,
    `**Action:** Unban + Whitelist\n` +
    `**Target:** <@${userId}> (\`${userId}\`)\n` +
    `**Staff:** ${interaction.user.tag} (\`${interaction.user.id}\`)`
  );
}

// ─── ban:<userId> ─────────────────────────────────────────────────────────────

async function handleBan(interaction, userId) {
  if (!hasStaffRole(interaction.member)) return denyPermission(interaction);
  await interaction.deferReply({ ephemeral: true });

  try {
    // Try to DM before ban
    const target = await interaction.client.users.fetch(userId).catch(() => null);
    if (target) {
      await target.send(
        `🚫 You have been detected in multiple inappropriate servers. ` +
        `You have been banned. You may appeal your ban here: **${config.APPEAL_LINK}**`
      ).catch(() => {});
    }

    await interaction.guild.members.ban(userId, {
      reason: `Manually banned by ${interaction.user.tag}`,
    });
  } catch (e) {
    return interaction.editReply(`❌ Ban failed: ${e.message}`);
  }

  await disableAllButtons(interaction.message).catch(() => {});
  await interaction.editReply(`✅ <@${userId}> has been banned.`);

  await postModLog(
    interaction.client,
    `**Action:** Manual Ban\n` +
    `**Target:** <@${userId}> (\`${userId}\`)\n` +
    `**Staff:** ${interaction.user.tag} (\`${interaction.user.id}\`)`
  );
}

// ─── whitelist:<userId> ───────────────────────────────────────────────────────

async function handleWhitelist(interaction, userId) {
  if (!hasStaffRole(interaction.member)) return denyPermission(interaction);
  await interaction.deferReply({ ephemeral: true });

  addToWhitelist(userId);

  await disableAllButtons(interaction.message).catch(() => {});
  await interaction.editReply(`✅ <@${userId}> has been added to the whitelist. Future join checks will be skipped.`);

  await postModLog(
    interaction.client,
    `**Action:** Whitelist\n` +
    `**Target:** <@${userId}> (\`${userId}\`)\n` +
    `**Staff:** ${interaction.user.tag} (\`${interaction.user.id}\`)`
  );
}

// ─── contact:<userId> — open modal ────────────────────────────────────────────

async function handleContact(interaction, userId) {
  if (!hasStaffRole(interaction.member)) return denyPermission(interaction);

  const modal = new ModalBuilder()
    .setCustomId(`contact_modal:${userId}`)
    .setTitle('Contact User');

  const messageInput = new TextInputBuilder()
    .setCustomId('message')
    .setLabel('Message to send (will be DM\'d to the user)')
    .setStyle(TextInputStyle.Paragraph)
    .setPlaceholder('Type your message here…')
    .setMaxLength(1800)
    .setRequired(true);

  modal.addComponents(new ActionRowBuilder().addComponents(messageInput));
  await interaction.showModal(modal);
}

// ─── contact_modal:<userId> — modal submit ────────────────────────────────────

async function handleContactModal(interaction, userId) {
  await interaction.deferReply({ ephemeral: true });

  const message = interaction.fields.getTextInputValue('message');

  let target;
  try {
    target = await interaction.client.users.fetch(userId);
  } catch {
    return interaction.editReply('❌ Could not find that user. They may have left Discord.');
  }

  try {
    await target.send(
      `📨 **Message from ${interaction.guild.name} staff:**\n\n${message}`
    );
  } catch {
    return interaction.editReply('❌ Could not send DM. The user likely has DMs disabled.');
  }

  await interaction.editReply(`✅ Message sent to ${target.tag}.`);

  await postModLog(
    interaction.client,
    `**Action:** Contact DM\n` +
    `**Target:** ${target.tag} (\`${userId}\`)\n` +
    `**Staff:** ${interaction.user.tag} (\`${interaction.user.id}\`)\n` +
    `**Message:**\n> ${message.replace(/\n/g, '\n> ')}`
  );
}

// ═════════════════════════════════════════════════════════════════════════════
//  ROUTER — called from interactionCreate event
// ═════════════════════════════════════════════════════════════════════════════

async function route(interaction) {
  const id = interaction.customId;

  // ── Buttons ───────────────────────────────────────────────────────────────
  if (interaction.isButton()) {
    if (id.startsWith('unban:')) {
      return handleUnban(interaction, id.split(':')[1]);
    }
    if (id.startsWith('ban:')) {
      return handleBan(interaction, id.split(':')[1]);
    }
    if (id.startsWith('whitelist:')) {
      return handleWhitelist(interaction, id.split(':')[1]);
    }
    if (id.startsWith('contact:')) {
      return handleContact(interaction, id.split(':')[1]);
    }
  }

  // ── Modal submits ─────────────────────────────────────────────────────────
  if (interaction.isModalSubmit()) {
    if (id.startsWith('contact_modal:')) {
      return handleContactModal(interaction, id.split(':')[1]);
    }
  }
}

module.exports = { route };
