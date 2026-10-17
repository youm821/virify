require('dotenv').config();
const crypto = require('crypto');
const Database = require('better-sqlite3');
const {
  Client, GatewayIntentBits, SlashCommandBuilder, ActionRowBuilder,
  ButtonBuilder, ButtonStyle, EmbedBuilder, MessageFlags, PermissionFlagsBits,
} = require('discord.js');

const { DISCORD_TOKEN, GUILD_ID, VERIFIED_ROLE_ID, ERLC_SERVER_KEY } = process.env;
const CODE_TTL_MS = 10 * 60 * 1000; // codes expire after 10 minutes
const EPHEMERAL = MessageFlags.Ephemeral;

// ---------- Database ----------
const db = new Database('verify.db');
db.exec(`
  CREATE TABLE IF NOT EXISTS links (
    discord_id TEXT PRIMARY KEY,
    roblox_id TEXT UNIQUE NOT NULL,
    roblox_username TEXT NOT NULL,
    verified_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS pending (
    discord_id TEXT PRIMARY KEY,
    roblox_id TEXT NOT NULL,
    roblox_username TEXT NOT NULL,
    code TEXT NOT NULL,
    expires_at INTEGER NOT NULL
  );
`);

// ---------- Roblox helpers ----------
async function getRobloxUserByName(username) {
  const res = await fetch('https://users.roblox.com/v1/usernames/users', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ usernames: [username], excludeBannedUsers: true }),
  });
  if (!res.ok) throw new Error(`Roblox lookup failed (${res.status})`);
  const { data } = await res.json();
  return data[0] ? { id: String(data[0].id), name: data[0].name } : null;
}

async function getRobloxDescription(id) {
  const res = await fetch(`https://users.roblox.com/v1/users/${id}`);
  if (!res.ok) throw new Error(`Roblox profile fetch failed (${res.status})`);
  const user = await res.json();
  return { description: user.description || '', name: user.name };
}

// ---------- ERLC helper ----------
// ER:LC API v2 (https://apidocs.erlc.gg): one endpoint, sections switched on with query flags.
async function getErlcPlayers() {
  if (!ERLC_SERVER_KEY) return null;
  const res = await fetch('https://api.erlc.gg/v2/server?Players=true', {
    headers: { 'server-key': ERLC_SERVER_KEY },
  });
  if (!res.ok) throw new Error(`ERLC API error (${res.status})`);
  const data = await res.json();
  return data.Players || []; // entries look like { Player: "Name:Id", Permission, Team }
}

// ---------- Commands ----------
const commands = [
  new SlashCommandBuilder()
    .setName('verify')
    .setDescription('Link your Roblox account to Discord')
    .addStringOption(o => o.setName('username').setDescription('Your Roblox username').setRequired(true)),
  new SlashCommandBuilder()
    .setName('unverify')
    .setDescription('Remove the link between your Roblox and Discord accounts'),
  new SlashCommandBuilder()
    .setName('whois')
    .setDescription('Look up a member\'s linked Roblox account (staff)')
    .addUserOption(o => o.setName('user').setDescription('Member to look up').setRequired(true))
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageRoles),
  new SlashCommandBuilder()
    .setName('status')
    .setDescription('Show who is currently in the ERLC server'),
].map(c => c.toJSON());

const client = new Client({ intents: [GatewayIntentBits.Guilds] });

client.once('clientReady', async () => {
  const guild = await client.guilds.fetch(GUILD_ID);
  await guild.commands.set(commands);
  console.log(`Logged in as ${client.user.tag}. Commands registered.`);
});

// ---------- Handlers ----------
async function handleVerify(interaction) {
  const username = interaction.options.getString('username').trim();

  if (db.prepare('SELECT 1 FROM links WHERE discord_id = ?').get(interaction.user.id)) {
    return interaction.reply({ content: 'You\'re already verified. Use `/unverify` first to relink.', flags: EPHEMERAL });
  }

  await interaction.deferReply({ flags: EPHEMERAL });

  const robloxUser = await getRobloxUserByName(username);
  if (!robloxUser) return interaction.editReply('I couldn\'t find that Roblox user. Check the spelling and try again.');

  const taken = db.prepare('SELECT discord_id FROM links WHERE roblox_id = ?').get(robloxUser.id);
  if (taken) return interaction.editReply('That Roblox account is already linked to another Discord user.');

  const code = 'ERLC-' + crypto.randomBytes(3).toString('hex').toUpperCase();
  db.prepare(`
    INSERT OR REPLACE INTO pending (discord_id, roblox_id, roblox_username, code, expires_at)
    VALUES (?, ?, ?, ?, ?)
  `).run(interaction.user.id, robloxUser.id, robloxUser.name, code, Date.now() + CODE_TTL_MS);

  const embed = new EmbedBuilder()
    .setTitle('Verify your Roblox account')
    .setDescription(
      `1. Go to your Roblox profile and edit your **About** description.\n` +
      `2. Add this code anywhere in it: \`${code}\`\n` +
      `3. Save, then click **I've added the code** below.\n\n` +
      `Account: **${robloxUser.name}**\nThe code expires in 10 minutes. You can remove it from your profile afterward.`
    );

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('verify_confirm').setLabel('I\'ve added the code').setStyle(ButtonStyle.Success),
  );

  return interaction.editReply({ embeds: [embed], components: [row] });
}

async function handleConfirm(interaction) {
  await interaction.deferReply({ flags: EPHEMERAL });

  const pending = db.prepare('SELECT * FROM pending WHERE discord_id = ?').get(interaction.user.id);
  if (!pending) return interaction.editReply('No pending verification. Run `/verify` first.');
  if (Date.now() > pending.expires_at) {
    db.prepare('DELETE FROM pending WHERE discord_id = ?').run(interaction.user.id);
    return interaction.editReply('Your code expired. Run `/verify` again.');
  }

  const { description, name } = await getRobloxDescription(pending.roblox_id);
  if (!description.includes(pending.code)) {
    return interaction.editReply(`I couldn't find \`${pending.code}\` in your profile description. Save it and try the button again (Roblox can take a few seconds to update).`);
  }

  db.prepare(`
    INSERT OR REPLACE INTO links (discord_id, roblox_id, roblox_username, verified_at)
    VALUES (?, ?, ?, ?)
  `).run(interaction.user.id, pending.roblox_id, name, Date.now());
  db.prepare('DELETE FROM pending WHERE discord_id = ?').run(interaction.user.id);

  const member = await interaction.guild.members.fetch(interaction.user.id);
  const notes = [];
  try { await member.roles.add(VERIFIED_ROLE_ID); }
  catch { notes.push('I couldn\'t assign the role. Make sure my role is above the verified role.'); }
  try { await member.setNickname(name); }
  catch { notes.push('I couldn\'t change your nickname (usually a permissions/hierarchy issue).'); }

  return interaction.editReply(`Verified as **${name}**!` + (notes.length ? `\n\n${notes.join('\n')}` : ''));
}

async function handleUnverify(interaction) {
  const result = db.prepare('DELETE FROM links WHERE discord_id = ?').run(interaction.user.id);
  if (!result.changes) return interaction.reply({ content: 'You aren\'t verified.', flags: EPHEMERAL });

  const member = await interaction.guild.members.fetch(interaction.user.id);
  await member.roles.remove(VERIFIED_ROLE_ID).catch(() => {});
  return interaction.reply({ content: 'Your account link was removed.', flags: EPHEMERAL });
}

async function handleWhois(interaction) {
  const user = interaction.options.getUser('user');
  const link = db.prepare('SELECT * FROM links WHERE discord_id = ?').get(user.id);
  if (!link) return interaction.reply({ content: `${user} isn't verified.`, flags: EPHEMERAL });
  return interaction.reply({
    content: `${user} is **${link.roblox_username}** (ID \`${link.roblox_id}\`)\nhttps://www.roblox.com/users/${link.roblox_id}/profile`,
    flags: EPHEMERAL,
  });
}

async function handleStatus(interaction) {
  await interaction.deferReply();
  const players = await getErlcPlayers();
  if (players === null) return interaction.editReply('ERLC_SERVER_KEY isn\'t set.');

  const byTeam = {};
  for (const p of players) {
    const team = p.Team || 'Unknown';
    (byTeam[team] ||= []).push(String(p.Player).split(':')[0]);
  }
  const embed = new EmbedBuilder().setTitle('ERLC Server Status').setDescription(`**${players.length}** players online`);
  for (const [team, names] of Object.entries(byTeam)) {
    embed.addFields({ name: `${team} (${names.length})`, value: names.join(', ').slice(0, 1000) });
  }
  return interaction.editReply({ embeds: [embed] });
}

client.on('interactionCreate', async interaction => {
  try {
    if (interaction.isChatInputCommand()) {
      if (interaction.commandName === 'verify') return await handleVerify(interaction);
      if (interaction.commandName === 'unverify') return await handleUnverify(interaction);
      if (interaction.commandName === 'whois') return await handleWhois(interaction);
      if (interaction.commandName === 'status') return await handleStatus(interaction);
    } else if (interaction.isButton() && interaction.customId === 'verify_confirm') {
      return await handleConfirm(interaction);
    }
  } catch (err) {
    console.error(err);
    const msg = 'Something went wrong. Please try again in a moment.';
    if (interaction.deferred || interaction.replied) interaction.editReply(msg).catch(() => {});
    else interaction.reply({ content: msg, flags: EPHEMERAL }).catch(() => {});
  }
});

client.login(DISCORD_TOKEN);
