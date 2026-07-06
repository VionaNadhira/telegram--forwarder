/**
 * Forwarding coordinator.
 * Implements filters, duplicate detection, and Telegram album grouping (multi-attachment debouncing).
 */

const { downloadMedia, cleanTempFile } = require('./download');
const { sendToDiscord } = require('./discord');
const { isAlreadyForwarded, markAsForwarded } = require('./state');
const { config } = require('./config');
const logger = require('./logger');

// Debounce map for Telegram albums (grouped messages)
// Key: groupedId (string), Value: { timer, messages: Array, chatName: string }
const groupedCache = new Map();
const ALBUM_DEBOUNCE_MS = 1500; // Wait 1.5 seconds to gather all parts of the album

/**
 * Validates whether a Telegram message should be ignored based on business filters.
 */
function shouldIgnoreMessage(message) {
  // 1. Ignore Service/Action Messages (Joins, leaves, pins, chat name edits, photo changes)
  if (message.action) {
    const className = message.action.className;
    logger.info(`Message filtered out: Service/Action message (${className}). Message ID: ${message.id}`);
    return true;
  }

  // 2. Ignore empty messages (no caption/text AND no media attachments)
  const hasText = !!(message.message && message.message.trim());
  const hasMedia = !!message.media;
  if (!hasText && !hasMedia) {
    logger.info(`Message filtered out: Empty message (no text and no media). Message ID: ${message.id}`);
    return true;
  }

  return false;
}

/**
 * Attempts to resolve the sender's username, full name, or fallback.
 */
async function getSenderName(client, message) {
  try {
    const sender = await message.getSender();
    if (sender) {
      if (sender.username) {
        return `@${sender.username}`;
      }
      const fullName = [sender.firstName, sender.lastName].filter(Boolean).join(' ');
      if (fullName) {
        return fullName;
      }
      if (sender.title) {
        return sender.title; // Channels or bots sending as channels
      }
    }
  } catch (err) {
    logger.warning(`Could not fetch sender details: ${err.message}. Using fallback.`);
  }

  // Fallback to channel post author properties
  if (message.postAuthor) {
    return message.postAuthor;
  }

  return 'Telegram User';
}

/**
 * Formats and forwards a single message to Discord.
 */
async function processSingleMessage(client, message, chatName, isEdit = false) {
  try {
    if (!isEdit) {
      markAsForwarded(message.id);
    }

    const senderName = await getSenderName(client, message);

    const mediaPaths = [];
    if (config.downloadMedia && message.media) {
      const filePath = await downloadMedia(client, message);
      if (filePath) {
        mediaPaths.push(filePath);
      }
    }

    let text = message.message || '';
    if (isEdit) {
      text = `*(Edited)* ${text}`;
    }

    await sendToDiscord({
      text,
      senderName,
      groupName: chatName,
      timestamp: new Date(message.date * 1000),
      mediaPaths
    });

    // Cleanup files if necessary
    if (mediaPaths.length > 0) {
      for (const path of mediaPaths) {
        cleanTempFile(path);
      }
    }
  } catch (err) {
    logger.error(`Error processing single message ID ${message.id}:`, err);
  }
}

/**
 * Consolidates and forwards multiple items belonging to the same Telegram album.
 */
async function processGroup(client, groupedId) {
  const group = groupedCache.get(groupedId);
  if (!group) return;

  // Clear from cache immediately to prevent racing
  groupedCache.delete(groupedId);

  const { messages, chatName } = group;

  try {
    logger.info(`Processing grouped album (Group ID: ${groupedId}, Items: ${messages.length})...`);

    // Sort by message ID to preserve chronological order
    messages.sort((a, b) => a.id - b.id);

    // Save states
    for (const msg of messages) {
      markAsForwarded(msg.id);
    }

    const senderName = await getSenderName(client, messages[0]);

    // Concatenate all captions (usually only one contains the text description)
    const captions = messages
      .map((m) => m.message)
      .filter(Boolean)
      .join('\n');

    // Download all media from the group
    const mediaPaths = [];
    if (config.downloadMedia) {
      for (const msg of messages) {
        if (msg.media) {
          const filePath = await downloadMedia(client, msg);
          if (filePath) {
            mediaPaths.push(filePath);
          }
        }
      }
    }

    await sendToDiscord({
      text: captions,
      senderName,
      groupName: chatName,
      timestamp: new Date(messages[0].date * 1000),
      mediaPaths
    });

    // Cleanup files
    if (mediaPaths.length > 0) {
      for (const path of mediaPaths) {
        cleanTempFile(path);
      }
    }
  } catch (err) {
    logger.error(`Error processing message group ${groupedId}:`, err);
  }
}

/**
 * Handle new incoming message event.
 */
async function handleNewMessage(client, message, chatName) {
  if (isAlreadyForwarded(message.id)) {
    logger.info(`Message ID ${message.id} already forwarded. Skipping.`);
    return;
  }

  if (shouldIgnoreMessage(message)) {
    return;
  }

  // Handle grouped media (album)
  if (message.groupedId) {
    const groupedIdStr = message.groupedId.toString();

    if (groupedCache.has(groupedIdStr)) {
      const group = groupedCache.get(groupedIdStr);
      clearTimeout(group.timer);
      group.messages.push(message);

      group.timer = setTimeout(() => {
        processGroup(client, groupedIdStr).catch((err) =>
          logger.error(`Group processor failed for ${groupedIdStr}:`, err)
        );
      }, ALBUM_DEBOUNCE_MS);

      logger.info(`Added item to group queue (ID: ${message.id}, Group: ${groupedIdStr})`);
    } else {
      const group = {
        messages: [message],
        chatName,
        timer: setTimeout(() => {
          processGroup(client, groupedIdStr).catch((err) =>
            logger.error(`Group processor failed for ${groupedIdStr}:`, err)
          );
        }, ALBUM_DEBOUNCE_MS)
      };

      groupedCache.set(groupedIdStr, group);
      logger.info(`Initiated new group queue (ID: ${message.id}, Group: ${groupedIdStr})`);
    }
  } else {
    // Forward standard individual message
    await processSingleMessage(client, message, chatName, false);
  }
}

/**
 * Handle incoming edit event.
 */
async function handleEditedMessage(client, message, chatName) {
  if (shouldIgnoreMessage(message)) {
    return;
  }

  logger.info(`Forwarding edited message (ID: ${message.id})...`);
  await processSingleMessage(client, message, chatName, true);
}

module.exports = {
  handleNewMessage,
  handleEditedMessage
};
