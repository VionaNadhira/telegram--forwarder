# Telegram to Discord Forwarder

A production-ready, bulletproof, and lightweight Node.js service that automatically forwards messages from a single Telegram channel/group (public or private) to a designated Discord channel.

## Features

- **No Duplicates**: Uses a persistent JSON state file to ensure messages are never forwarded twice, even after bot restarts.
- **Album / Grouped Media Support**: Cleverly debounces and bundles Telegram albums (multiple photos/videos/attachments) into a single Discord message rather than spamming multiple embeds.
- **Supported Media**: Plain text, photos, videos, GIFs, stickers, audio, voice notes, files, and more.
- **Beautiful Layout**: Formats messages using Discord's Rich Embed layout (can be toggled in settings).
- **Interactive Login**: Performs interactive terminal login to generate the Telegram `STRING_SESSION` if none is provided.
- **Crash Proof**: Implements robust error handling and auto-reconnection logic for both Telegram and Discord to guarantee 24/7 uptime.

---

## Installation

1. **Clone or copy the project files** to your local system or server.
2. Ensure you have **Node.js v20+** installed.
3. Open your terminal in the `telegram-discord-forwarder` folder and install dependencies:
   ```bash
   npm install
   ```

---

## Environment Setup

Create a `.env` file in the root of the project by copying `.env.example`:
```bash
cp .env.example .env
```

Open `.env` and fill in the required fields:

| Variable | Description |
| :--- | :--- |
| `API_ID` | Your Telegram API ID. Obtain it from [my.telegram.org](https://my.telegram.org). |
| `API_HASH` | Your Telegram API Hash. Obtain it from [my.telegram.org](https://my.telegram.org). |
| `STRING_SESSION` | Leave blank initially. The program will generate one on first run. |
| `TELEGRAM_CHAT` | The Username (e.g. `@my_channel`), Chat ID (e.g. `-100123456`), or Group Title to forward from. |
| `DISCORD_TOKEN` | Your Discord Bot token. |
| `DISCORD_CHANNEL_ID` | The ID of the target Discord channel. |
| `EMBED_COLOR` | Color of the Discord embed (e.g., `#5865F2`). |
| `FORWARD_EDITS` | Set to `true` to forward message edits. Default is `false`. |
| `DOWNLOAD_MEDIA` | Set to `true` to download and forward media attachments. |
| `DELETE_TEMP_FILES`| Set to `true` to delete local media files after forwarding to Discord. |
| `MAX_FILE_SIZE_MB` | Skip files larger than this (e.g., `24` MB to stay within Discord limits). |
| `SEND_AS_EMBED` | Forward messages inside an elegant Discord embed instead of plain text. |
| `RECONNECT_DELAY` | Milliseconds to wait before retrying connections. Default is `5000`. |

---

## How to Generate `STRING_SESSION`

1. Fill out your `API_ID` and `API_HASH` in `.env` and leave `STRING_SESSION` empty.
2. Run the application:
   ```bash
   npm start
   ```
3. The console will prompt you to enter:
   - Your **Phone Number** (with country code, e.g. `+1234567890`)
   - The **OTP/Code** sent to your Telegram account
   - Your **2FA Password** (if enabled)
4. Once authenticated, the bot will log in and output a long session string labeled:
   `STRING_SESSION GENERATED SUCCESSFULLY`
5. **Copy this string and save it as `STRING_SESSION` inside your `.env` file.**
6. The bot will automatically continue running and monitoring without needing a restart. Future runs will use this session string and bypass any interactive login prompts.

---

## How to Run

### Locally / On a Server
Start the application using:
```bash
npm start
```
Alternatively, for production servers, use a process manager like **PM2** to run the script in the background:
```bash
npm install -g pm2
pm2 start index.js --name "tg-discord-forwarder"
pm2 save
pm2 startup
```

---

## How to Deploy to Railway

[Railway](https://railway.app/) is a great cloud platform for running persistent Node.js services.

1. **Prepare Your Repository**: Publish your project directory to a private GitHub repository. (Exclude `.env` and the `downloads/` or `data/` directories using `.gitignore`).
2. **Create a Railway Project**:
   - Go to [Railway](https://railway.app/) and log in.
   - Click **New Project** -> **Deploy from GitHub repo** and select your repository.
3. **Configure Environment Variables**:
   - In your Railway service settings, go to the **Variables** tab.
   - Add all environment variables from `.env` (including your newly generated `STRING_SESSION`).
4. **Deploy**:
   - Railway will detect the `package.json` and start the application using `npm start` automatically.
   - Since the `STRING_SESSION` variable is present in the environment variables, the bot will boot up and log in without needing interactive input.

---

## Troubleshooting

### 1. Interactive login fails or is stuck
- Ensure you enter your phone number with the country code prefix (e.g. `+1...` or `+44...`).
- Double-check that your `API_ID` and `API_HASH` are entered correctly in the `.env` file.

### 2. Media files aren't uploading to Discord
- Make sure `DOWNLOAD_MEDIA` is set to `true`.
- Check if the files exceed the `MAX_FILE_SIZE_MB` limit. Normal Discord accounts are limited to 25MB uploads.
- Ensure the bot has `Attach Files` permissions in the Discord channel.

### 3. Rate limits or connection drops
- GramJS has built-in auto-retry and backing off for connection drops.
- The forwarder catches Discord's 429 rate limit exceptions, waits for the requested delay, and retries the upload automatically.

### 4. Group Title match is not working
- If matching a chat by its Title, make sure it matches the spelling exactly.
- If the chat has a public username (e.g., `@MyChannel`), use the username instead, as it is much faster and more reliable than listing all dialogs.
