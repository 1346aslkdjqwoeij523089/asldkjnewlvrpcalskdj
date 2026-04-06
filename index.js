require('dotenv').config();
const { Client, GatewayIntentBits, EmbedBuilder, ActionRowBuilder, StringSelectMenuBuilder } = require('discord.js');
const axios = require('axios');
const express = require('express');

const client = new Client({ 
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMessageReactions
  ] 
});

let sessionState = { active: false, data: {} };
let channels = {};
let guild = null;

const AVATAR_URL = 'https://cdn.discordapp.com/attachments/1489444813836390580/1489444844324524103/3521_1.png?ex=69d0711b&is=69cf1f9b&hm=035eb7524563afc5484df8b4167fe4fbe70c177c266ea8da08e2d1e0038c222b&';
const BOT_USERNAME = 'LVRPC Sessions';
const ADMIN_ROLE = process.env.ADMIN_ROLE;
const PLAYER_ROLE = process.env.PLAYER_ROLE;
const STAFF_ROLE = process.env.STAFF_ROLE;
const VOTE_THRESHOLD = parseInt(process.env.VOTE_THRESHOLD) || 5;

client.once('ready', async () => {
  console.log(`Logged in as ${client.user.tag}`);
  
  // Fetch channels
  channels.session = await client.channels.fetch(process.env.SESSION_CHANNEL);
  channels.general = await client.channels.fetch(process.env.GENERAL_CHANNEL);
  channels.log = await client.channels.fetch(process.env.LOG_CHANNEL);
  guild = channels.session.guild;
  
  // Load session state from log channel
  try {
    const logMsgs = await channels.log.messages.fetch({ limit: 10 });
    const activeLog = Array.from(logMsgs.values()).reverse().find(msg => {
      try {
        const jsonStr = msg.content.replace(/```/g, '').trim();
        const data = JSON.parse(jsonStr);
        return data.state === 'active';
      } catch {
        return false;
      }
    });
    if (activeLog) {
      sessionState = { active: true, data: JSON.parse(activeLog.content.replace(/```/g, '').trim()) };
      console.log('Loaded active session state');
    }
  } catch (e) {
    console.log('Failed to load session state:', e.message);
  }
  
  // Express for Render keepalive
  const app = express();
  app.get('/', (req, res) => res.send('OK'));
  app.listen(process.env.PORT || 3000, () => {
    console.log('Keepalive server running');
  });
});

async function getStats() {
  try {
    const key = process.env.ERLC_API_KEY;
    if (!key) return { inGame: 0, inQueue: 0 };
    
    // TODO: Update to real ERLC API endpoint using the key
    // const res = await axios.get(`https://api.erlc.example.com/stats?key=${key}`, { timeout: 5000 });
    // return { inGame: res.data.players || 0, inQueue: res.data.queue || 0 };
    
    // Mock for testing (random values)
    return {
      inGame: Math.floor(Math.random() * 25) + 5,
      inQueue: Math.floor(Math.random() * 5)
    };
  } catch (e) {
    console.error('getStats error:', e.message);
    return { inGame: 0, inQueue: 0 };
  }
}

async function getStaffCount() {
  try {
    await guild.members.fetch({ force: true });
    return guild.members.cache.filter(m => m.roles.cache.has(STAFF_ROLE)).size;
  } catch (e) {
    console.error('getStaffCount error:', e.message);
    return 0;
  }
}

function getTimestamp() {
  return `<t:${Math.floor(Date.now() / 1000)}:F>`;
}

function buildInactiveEmbed(userStr, shutdownData = {}) {
  const shutdownUserStr = shutdownData.shutdownBy ? client.users.cache.get(shutdownData.shutdownBy)?.toString() || 'Unknown' : 'Unknown';
  const shutdownTs = shutdownData.shutdownAt ? `<t:${shutdownData.shutdownAt}:F>` : getTimestamp();
  
  const desc = `# __𝐒𝐞𝐬𝐬𝐢𝐨𝐧 𝐌𝐚𝐧𝐚𝐠𝐞𝐦𝐞𝐧𝐭 𝐏𝐚𝐧𝐞𝐥・𝐋𝐕𝐑𝐏𝐂__
> Welcome to the Session Management Panel <:LVRPC:1489435879645646858>, ${userStr}!
> - As you are Junior Administrator+, you have the ability to configure sessions accordingly. Please refer below for more information:
## __Session Status: Inactive 🔴__
> \`Shutdown By:\` ${shutdownUserStr}
> \`Shutdown At:\` ${shutdownTs}
> \`Shutdown Reason:\` Maintenance
## __Session Configuration 🛠️__
> \`1.\` Initiate a Session Vote
> \`2.\` Start a New Session`;
  
  return new EmbedBuilder()
    .setDescription(desc)
    .setColor(0xff0000);
}

function buildActiveEmbed(sessionData, stats, staffCount, userStr) {
  const votesObtained = sessionData.votesObtained || 0;
  const startedUserStr = sessionData.startedBy ? client.users.cache.get(sessionData.startedBy)?.toString() || 'Unknown' : 'Unknown';
  const startedTs = sessionData.startedAt ? `<t:${sessionData.startedAt}:F>` : getTimestamp();
  
  const desc = `# __𝐒𝐞𝐬𝐬𝐢𝐨𝐧 𝐌𝐚𝐧𝐚𝐠𝐞𝐦𝐞𝐧𝐭 𝐏𝐚𝐧𝐞𝐥・𝐋𝐕𝐑𝐏𝐂__
> Welcome to the Session Management Panel <:LVRPC:1489435879645646858>, ${userStr}!
> - As you are Junior Administrator+, you have the ability to configure sessions accordingly. Please refer below for more information:
## __Session Status: Active 🟢__
> \`Started By:\` ${startedUserStr}
> \`Started At:\` ${startedTs}
> \`Votes Obtained:\` ${votesObtained}/${VOTE_THRESHOLD}
> \`Players In-Game:\` ${stats.inGame}/39
> \`Players In-Queue:\` ${stats.inQueue}
## __Session Configuration 🛠️__
> \`1.\` Shutdown the Session.
> \`2.\` Boost the Session.`;
  
  return new EmbedBuilder()
    .setDescription(desc)
    .setColor(0x00ff00);
}

async function sendPanel(interaction, isActive) {
  const userStr = interaction.user.toString();
  let embed, row, panelId;
  
  if (isActive) {
    const stats = await getStats();
    const staffCount = await getStaffCount();
    embed = buildActiveEmbed(sessionState.data, stats, staffCount, userStr);
    panelId = 'p_287057436420870157';
    row = new ActionRowBuilder()
      .addComponents(
        new StringSelectMenuBuilder()
          .setCustomId(panelId)
          .setPlaceholder('Select a Session Configuration Option')
          .addOptions([
            {
              label: '1. Shutdown the Session.',
              value: '9Juzul95Dy',
              emoji: '🔴'
            },
            {
              label: '2. Boost the Session',
              value: 'mYRWFchFXX',
              emoji: '⚠️'
            }
          ])
      );
  } else {
    embed = buildInactiveEmbed(userStr, sessionState.data);
    panelId = 'p_287052346217730060';
    row = new ActionRowBuilder()
      .addComponents(
        new StringSelectMenuBuilder()
          .setCustomId(panelId)
          .setPlaceholder('Select a Session Configuration Option')
          .addOptions([
            {
              label: '1. Initiate a Session Vote',
              value: 'oeCDiMb5NV'
            },
            {
              label: '2. Start a New Session',
              value: 'SWDgfRJeOh',
              emoji: { name: '🎮' }
            }
          ])
      );
  }
  
  await interaction.reply({ embeds: [embed], components: [row] });
}

client.on('interactionCreate', async (interaction) => {
  if (interaction.isChatInputCommand() && interaction.commandName === 'sessions') {
    if (!interaction.member.roles.cache.has(ADMIN_ROLE)) {
      return interaction.reply({ content: 'You do not have permission to use this command.', ephemeral: true });
    }
    await sendPanel(interaction, sessionState.active);
    return;
  }
  
  if (interaction.isStringSelectMenu()) {
    if (!interaction.member.roles.cache.has(ADMIN_ROLE)) {
      return interaction.reply({ content: 'No permission.', ephemeral: true });
    }
    
    const value = interaction.values[0];
    
    if (interaction.customId === 'p_287052346217730060') { // Inactive
      if (value === 'oeCDiMb5NV') { // Initiate vote
        const voteEmbed = new EmbedBuilder()
          .setTitle('Session Vote')
          .setDescription(`> A session vote has been conducted by ${interaction.user}. To participate in the session, ensure that you vote with ✅ below to count your vote!\n> - Current Votes: \`0/${VOTE_THRESHOLD}\``)
          .setColor(0x0099ff);
        
        const voteMsg = await channels.session.send({
          content: `<@&${PLAYER_ROLE}>`,
          embeds: [voteEmbed]
        });
        
        await voteMsg.react('✅');
        sessionState.data.voteMessageId = voteMsg.id;
        
        await interaction.update({ content: '✅ Session vote initiated in session channel!', components: [], embeds: [] });
      } else if (value === 'SWDgfRJeOh') { // Start session
        if (!sessionState.data.voteMessageId) {
          return interaction.reply({ content: 'No active vote found. Initiate vote first.', ephemeral: true });
        }
        
        try {
          const voteMsg = await channels.session.messages.fetch(sessionState.data.voteMessageId);
          const reaction = voteMsg.reactions.cache.get('✅');
          const users = await reaction.users.fetch();
          const voters = users.filter(u => !u.bot && u.id !== client.user.id).array();
          
          if (voters.length < VOTE_THRESHOLD) {
            return interaction.reply({ content: `Not enough votes. Need ${VOTE_THRESHOLD}, got ${voters.length}.`, ephemeral: true });
          }
          
          // Voter mentions for general (limit to avoid char limit)
          const voterMentions = voters.slice(0, 20).map(u => u.toString()).join('\n> - ');
          
          const voterContent = `# __Session Management__
\`\`\`As you have voted in-game, you must join in the next 15 minutes or you will face punishment.\`\`\`
**Session Voters** -> Head to <#${process.env.SESSION_CHANNEL}> for Information!
> - ${voterMentions}`;
          
          await channels.general.send(voterContent);
          
          // Session start embed
          const stats = await getStats();
          const staffCount = await getStaffCount();
          
          const startEmbed = new EmbedBuilder()
            .setTitle('Session Start')
            .setDescription(`> A session has officially began after enough votes have been received! Voters have been notified in <#${process.env.GENERAL_CHANNEL}>. Join up!
> **In-Game:** \`${stats.inGame}/39\`
> **In-Queue:** ${stats.inQueue}
> **Staff On-Duty:** ${staffCount}`)
            .setColor(0x00ff00);
          
          await channels.session.send({
            content: `<@&${PLAYER_ROLE}>`,
            embeds: [startEmbed]
          });
          
          // Update session state
          sessionState.data.startedBy = interaction.user.id;
          sessionState.data.startedAt = Math.floor(Date.now() / 1000);
          sessionState.data.voters = voters.map(u => u.id);
          sessionState.data.votesObtained = voters.length;
          sessionState.active = true;
          
          // Log state
          const logData = { ...sessionState.data, state: 'active' };
          await channels.log.send(`\`\`\`json\n${JSON.stringify(logData, null, 2)}\n\`\`\``);
          
          // Update to active panel
          const newStats = await getStats();
          const newStaff = await getStaffCount();
          const newEmbed = buildActiveEmbed(sessionState.data, newStats, newStaff, interaction.user.toString());
          const activeRow = new ActionRowBuilder()
            .addComponents(
              new StringSelectMenuBuilder()
                .setCustomId('p_287057436420870157')
                .setPlaceholder('Select a Session Configuration Option')
                .addOptions([
                  { label: '1. Shutdown the Session.', value: '9Juzul95Dy', emoji: '🔴' },
                  { label: '2. Boost the Session', value: 'mYRWFchFXX', emoji: '⚠️' }
                ])
            );
          
          await interaction.update({ embeds: [newEmbed], components: [activeRow] });
        } catch (e) {
          console.error('Start session error:', e);
          await interaction.reply({ content: 'Error starting session.', ephemeral: true });
        }
      }
    } else if (interaction.customId === 'p_287057436420870157') { // Active
      if (value === '9Juzul95Dy') { // Shutdown
        const shutdownEmbed1 = new EmbedBuilder()
          .setFields({
            name: 'Session Shutdown',
            value: '> A session has been shutdown in Liberty Valley Roleplay Community. Thank you for joining, and we hope to see you soon!',
            inline: false
          })
          .setColor(0xff0000);
        
        await channels.session.send({ embeds: [shutdownEmbed1] });
        
        const shutdownEmbed2 = new EmbedBuilder()
          .setFields({
            name: 'Session Shutdown',
            value: '> A session has been shutdown in Liberty Valley Roleplay Community. Thank you for joining, and we hope to see you soon!',
            inline: false
          })
          .setColor(0xff0000);
        
        await channels.general.send({ embeds: [shutdownEmbed2] });
        
        // Update state
        sessionState.data.shutdownBy = interaction.user.id;
        sessionState.data.shutdownAt = Math.floor(Date.now() / 1000);
        sessionState.active = false;
        
        // Log
        const logData = { ...sessionState.data, state: 'inactive' };
        await channels.log.send(`\`\`\`json\n${JSON.stringify(logData, null, 2)}\n\`\`\``);
        
        // Update to inactive panel
        const newEmbed = buildInactiveEmbed(interaction.user.toString(), sessionState.data);
        const inactiveRow = new ActionRowBuilder()
          .addComponents(
            new StringSelectMenuBuilder()
              .setCustomId('p_287052346217730060')
              .setPlaceholder('Select a Session Configuration Option')
              .addOptions([
                { label: '1. Initiate a Session Vote', value: 'oeCDiMb5NV' },
                { label: '2. Start a New Session', value: 'SWDgfRJeOh', emoji: { name: '🎮' } }
              ])
          );
        
        await interaction.update({ embeds: [newEmbed], components: [inactiveRow] });
      } else if (value === 'mYRWFchFXX') { // Boost
        const boostEmbed = new EmbedBuilder()
          .setTitle('Session Boost')
          .setDescription('> The session is running low on players. Please join up to ensure that activity stays well! You can join with code: `LVRPCOGG`!')
          .setColor(0xffff00);
        
        await channels.session.send({
          content: '@here <@&' + PLAYER_ROLE + '>',
          embeds: [boostEmbed]
        });
        
        await interaction.reply({ content: 'Boost message sent!', ephemeral: true });
      }
    }
  }
});

client.on('messageCreate', async (message) => {
  if (message.content === '!sessions' && !message.author.bot) {
    if (!message.member.roles.cache.has(ADMIN_ROLE)) {
      return message.reply('You do not have permission to use this command.');
    }
    await sendPanel({ reply: (o) => message.reply(o), user: message.author, member: message.member }, sessionState.active);
  }
});

// Register slash command
client.login(process.env.BOT_TOKEN);
