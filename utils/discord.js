/**
 * Discord client integration.
 * Handles client lifecycle, message formatting (embeds vs plain text),
 * and robust message forwarding with retries.
 */

const { Client, GatewayIntentBits, EmbedBuilder, AttachmentBuilder } = require('discord.js');
const path = require('path');
const fs = require('fs');
const { config } = require('./config');
const logger = require('./logger');

let client = null;
let isReady = false;

/**
 * Initializes and connects the Discord client.
 * Retries indefinitely if initial connection fails.
 */
function connectDiscord() {
  return new Promise((resolve) => {
    if (client) {
      return resolve(client);
    }

    logger.info('Initializing Discord client...');

    client = new Client({
      intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages
      ]
    });

    client.once('ready', () => {
      isReady = true;
      logger.success(`Discord connected: Logged in as ${client.user.tag}`);
      resolve(client);
    });

    client.on('error', (err) => {
      logger.error('Discord general client error:', err);
    });

    client.on('shardDisconnect', (event) => {
      isReady = false;
      logger.warning(`Discord disconnected (Code: ${event.code}). Reason: ${event.reason || 'Unknown'}. Reconnecting in ${config.reconnectDelay}ms...`);
    });

    client.on('shardReconnecting', () => {
      logger.info('Discord client attempting to reconnect to the gateway...');
    });

    const login = () => {
      client.login(config.discord.token).catch((err) => {
        logger.error(`Discord login failed: ${err.message}. Retrying in ${config.reconnectDelay}ms...`, null);
        setTimeout(login, config.reconnectDelay);
      });
    };

    login();
  });
}

/**
 * Helper to determine if a filename represents an image.
 */
function isImageFile(fileName) {
  const ext = path.extname(fileName).toLowerCase();
  return ['.jpg', '.jpeg', '.png', '.gif', '.webp'].includes(ext);
}

/**
 * Sends a message to the configured Discord channel with retry logic.
 * @param {Object} data - Message metadata
 * @param {string} data.text - Message content/caption
 * @param {string} data.senderName - Telegram sender name
 * @param {string} data.groupName - Telegram group/channel name
 * @param {Date} data.timestamp - Message timestamp
 * @param {string[]} data.mediaPaths - Array of absolute file paths to attach
 * @param {number} [retryCount=0] - Current retry count
 */
async function sendToDiscord(data, retryCount = 0) {
  const maxRetries = 5;
  if (!isReady || !client) {
    throw new Error('Discord client is not ready. Message deferred.');
  }

  try {
    const channel = await client.channels.fetch(config.discord.channelId);
    if (!channel) {
      throw new Error(`Discord channel with ID ${config.discord.channelId} not found.`);
    }

    const payload = {};
    const files = [];

    // Prepare attachments
    if (data.mediaPaths && data.mediaPaths.length > 0) {
      for (const filePath of data.mediaPaths) {
        if (fs.existsSync(filePath)) {
          files.push(new AttachmentBuilder(filePath));
        } else {
          logger.warning(`File to attach was not found: ${filePath}`);
        }
      }
    }

    if (files.length > 0) {
      payload.files = files;
    }

    const timestamp = data.timestamp || new Date();

    if (config.discord.sendAsEmbed) {
      const embed = new EmbedBuilder()
        .setColor(config.discord.embedColor)
        .setAuthor({ name: data.senderName || 'Unknown User' })
        .setDescription(data.text || null)
        .setFooter({ text: `Forwarded from ${data.groupName || 'Telegram'}` })
        .setTimestamp(timestamp);

      // Link first image attachment to embed main image if applicable
      if (files.length > 0) {
        const firstFile = data.mediaPaths[0];
        const fileName = path.basename(firstFile);
        if (isImageFile(fileName)) {
          embed.setImage(`attachment://${fileName}`);
        }
      }

      payload.embeds = [embed];
    } else {
      // Plain text formatting
      let formattedText = `**[${data.groupName || 'Telegram'}]**\n`;
      formattedText += `**${data.senderName || 'User'}**: `;
      formattedText += data.text || '';
      payload.content = formattedText.substring(0, 2000); // Discord limit
    }

    logger.info(`Uploading message to Discord channel: ${config.discord.channelId}...`);
    await channel.send(payload);
    logger.success('Forward success: Message posted to Discord.');
  } catch (err) {
    // Check for rate limit error (usually status code 429)
    if (err.status === 429 || (err.message && err.message.toLowerCase().includes('rate limit'))) {
      const retryAfter = err.retryAfter || 2000;
      logger.warning(`Discord rate limit hit. Retrying in ${retryAfter}ms...`);
      await new Promise((resolve) => setTimeout(resolve, retryAfter));
      return sendToDiscord(data, retryCount);
    }

    if (retryCount < maxRetries) {
      const delay = Math.pow(2, retryCount) * 1000;
      logger.warning(`Discord send failure: ${err.message}. Retrying in ${delay}ms... (Attempt ${retryCount + 1}/${maxRetries})`);
      await new Promise((resolve) => setTimeout(resolve, delay));
      return sendToDiscord(data, retryCount + 1);
    }

    throw err;
  }
}

module.exports = {
  connectDiscord,
  sendToDiscord,
  isReady: () => isReady
};
