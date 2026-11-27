# WRLD AI Local Assistant

WRLD AI is a separate local desktop companion. Chat requests go to Ollama at `127.0.0.1` and are not sent to a cloud AI service. Conversations stay in the open browser tab and are not saved by the app.

The corner avatar inside the assistant window is an original 8-bit WRLD/999 themed character. Speech uses an English voice already installed on macOS, with a relaxed pace and gently lowered pitch. This is an original system voice, not Juice WRLD’s voice or an imitation of him.

## Start it

Requirements: macOS 14 or newer, Node.js 22 or newer, Ollama, and the `qwen3:1.7b` local model.

1. Install Ollama from [ollama.com/download/mac](https://ollama.com/download/mac).
2. In Terminal, download the local model once:

   ```sh
   ollama pull qwen3:1.7b
   ```

3. Start this app by double-clicking `Launch-WRLD-AI.command`, or run:

   ```sh
   cd desktop-assistant
   node server.mjs
   ```

4. Open <http://127.0.0.1:47821>.

The default workspace is `~/WRLD-AI-Workspace`. Use **Choose workspace** to select another folder. WRLD AI can list, search, and read supported text files only inside that folder. All built-in actions run without an approval prompt: it can create or edit text files, create folders, move or trash workspace files, search and read public web pages, open public websites, and launch Finder, Safari, Music, Notes, Calendar, Calculator, System Settings, or Discord. Before replacing text, it saves a timestamped backup beside the original. File creation and moves never overwrite an existing destination. It can also control play, pause, next, and previous in Apple Music when asked. Web searches send the query to DuckDuckGo Lite; page reads are read-only and cannot access local or private network addresses, submit forms, upload files, or send messages. It has no terminal or arbitrary command tool, cannot access files outside the chosen workspace, and cannot change protected system settings. macOS still controls its own privacy permissions.

## Discord bot

The optional Discord bot adds `/wrld-search` and `/wrld-ai` for everyone in one configured server. Search reads the public Juice WRLD metadata API. The AI command uses the local Ollama model and relevant catalog metadata; it does not have access to the Mac workspace or desktop controls. Replies are private to the person who invoked the command, and each user is rate-limited.

1. Create a Discord application and bot in the [Discord Developer Portal](https://discord.com/developers/applications).
2. Invite it to your server with the `bot` and `applications.commands` scopes. It needs no Administrator permission and does not request message-history or message-content intents.
3. Copy `.env.example` to `.env`. Set the bot token, application ID, and server ID. Keep `.env` private; it is ignored by Git.
4. From this directory, run `npm install` once, then `npm run discord`.

The bot must stay running for slash commands to respond. This source package does not contain your Discord credentials or automatically create the Discord application.

## Discord listening status (Rich Presence)

The music page can optionally show the current song on the listener's Discord profile. It is off by default and uses the local desktop companion plus the Discord desktop app; a Discord server bot cannot set a member's personal status. The companion only sends the track title, album, play/pause state, and playback position to Discord. It does not send audio or lyrics. Each listener controls whether unreleased titles are shown. A local refresh token is saved in `~/.wrld-archives/discord-auth.json` with owner-only file permissions; switch sharing off in the page to clear the displayed activity.

1. In the Discord Developer Portal, create or choose an application. Set it up as a public OAuth client so the local PKCE flow can exchange and refresh tokens.
2. Copy its Application ID to `WRLD_DISCORD_APPLICATION_ID` in `.env`. Do not paste a bot token here. The bot token is not used for this feature.
3. If the music page is hosted on GitHub Pages or Cloudflare Pages, set `WRLD_ARCHIVES_ORIGIN` to that exact origin (for example, `https://username.github.io`), then restart the companion. Leave it blank when the page is served from the companion's own local address.
4. Open Discord desktop and the music page on the same computer, then enable **Share my listening status**. Discord may show its authorization prompt.

Discord currently restricts the `rpc` scope used for Rich Presence to approved applications. Discord can reject the connection until it grants RPC access; public availability may require approval. Discord's activity privacy settings also control who can see a profile status. The page's setup dialog explains these limits and the local companion steps.

## Local model

The default model is `qwen3:1.7b`. Ollama lists this model at about 1.4 GB. The app sends chat only to the local Ollama endpoint. Do not enable a cloud model in Ollama if you want to keep inference local.

## Limits

This assistant is a starting point, not a system administrator. It cannot perform every possible computer task. Its tools are limited to the selected workspace and the listed app, browser, and Apple Music controls.
