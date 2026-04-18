const { checkUser } = require('../handlers/checkUser');

module.exports = {
  name: 'guildMemberAdd',
  async execute(member) {
    try {
      await checkUser(member);
    } catch (err) {
      console.error(`[guildMemberAdd] Error checking ${member.user.tag}:`, err);
    }
  },
};
