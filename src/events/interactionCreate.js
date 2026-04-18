const { route: routeButton }       = require('../handlers/buttonHandlers');
const { routeAppealButton }        = require('../handlers/appealHandler');

module.exports = {
  name: 'interactionCreate',
  async execute(interaction) {
    try {
      // Appeal buttons
      if (
        (interaction.isButton() || interaction.isModalSubmit()) &&
        interaction.customId.startsWith('appeal:')
      ) {
        return routeAppealButton(interaction);
      }

      // Join-check buttons + contact modal
      if (interaction.isButton() || interaction.isModalSubmit()) {
        return routeButton(interaction);
      }
    } catch (err) {
      console.error('[interactionCreate] Unhandled error:', err);
      const reply = { content: '❌ An internal error occurred. Please try again.', ephemeral: true };
      if (interaction.replied || interaction.deferred) {
        interaction.followUp(reply).catch(() => {});
      } else {
        interaction.reply(reply).catch(() => {});
      }
    }
  },
};
