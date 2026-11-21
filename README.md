# WRLD Archives

WRLD Archives is a static, installable music catalog for Juice WRLD. Catalog edits and user-selected audio stay in the browser. Audio linked through **Link audio & covers from drive** stays on the selected drive; the browser stores file handles locally and reads each file only for playback. Per-song **Add audio** copies that one file into browser storage. User-provided lyric files and personal cover overrides are stored locally too. Audio and lyrics are not shared between users. Public audio delivery can be enabled only for recordings the project owns or has explicit distribution rights to; do not publish copyrighted recordings without authorization.

## Run locally

The app uses JavaScript modules and a service worker, so open it over HTTP rather than opening `index.html` directly:

```sh
python3 -m http.server 8000
```

Then visit <http://localhost:8000>.

## Deploy with GitHub Pages

1. Open the repository’s **Settings → Pages**.
2. Select **Deploy from a branch**, choose `main` and `/(root)`, then save.
3. Open the Pages URL shown in the settings.

The source remains deployable as a static site. The app fetches public song metadata from Juice WRLD API; that catalog sync requires a working network connection and the API to be reachable from the browser.

## Data and audio

- Song entries, favorites, and catalog metadata are stored in this browser’s `localStorage`.
- Drive-linked audio remains on the selected drive; IndexedDB stores file handles, not audio bytes. Per-song audio, cover overrides, and lyric attachments are stored in IndexedDB. These personal files and lyrics are not uploaded to GitHub or shared with other devices or visitors.
- To link a mounted external drive, use **Link audio & covers from drive** over HTTPS or localhost in a browser with folder access (such as Chrome or Edge), then select the folder. The app scans subfolders, matches known filenames to catalog entries, and adds non-matching audio as local Drive file entries so those files remain visible and playable. Embedded cover art is extracted automatically. Each device and visitor must select their own folder.
- The sidebar’s **Drive songs** view filters the catalog to entries linked from that browser’s selected drive.
- **Shuffle Drive** builds a randomized queue of every drive-linked song and plays each once per pass.
- Use **Share** on a playlist to send it through the device share sheet or download a playlist JSON file. Importing a shared playlist matches tracks by source ID, title, and version; the share file contains track metadata only and no audio.
- Click the mini-player title to open the larger cover-led player with playback controls, seek, favorites, and synced local lyrics.
- Add `.lrc` or `.txt` lyric files per song, import multiple files with **Import lyrics**, or place matching `.lrc` files beside audio in a linked folder. Imports match filenames to song titles and versions; existing lyric attachments are left untouched. Timed `.lrc` lines follow playback. Use **Sync lyrics to audio** in the expanded player to mark each plain-text line as it starts and save it as timed lyrics. Lyric files stay in this browser. Song rows link to Genius search results, but the app does not scrape or bundle copyrighted lyrics.
- Song and album art extracted from the supplied audio files is optimized and bundled in `assets/covers/`, so the matching covers appear for every visitor. The current bundle contains 130 unique images extracted from 248 audio files. Other files had no embedded image or artwork that could not be processed. Use **Add cover** to set a personal override, or put separate image files named after a song or album in the linked folder. Personal overrides stay in this browser.
- Embedded artwork is extracted automatically from audio tags when you add an audio file or link a folder. To rebuild the public cover bundle on macOS, run `node scripts/build-covers.mjs /path/to/audio-folder`. MP3, M4A, MP4, FLAC, WAV, AAC, OGG, Opus, AIFF, and ALAC files are scanned. HTML download pages such as `song.mp3.html` are ignored because they are not audio files. The rebuild updates `cover-index.mjs` and `assets/covers/`.
- Use **Export JSON** to back up the catalog metadata. This export does not include local audio, cover, or lyric files.
- The app links to streaming-service searches for released songs; those links do not guarantee availability of a specific recording.
- Do not add or publish copyrighted recordings unless you have permission to do so.

## Checks

Requires Node.js 20 or newer. Run the same checks used by GitHub Actions:

```sh
node scripts/validate.mjs
node --test catalog.test.mjs
```

## Local desktop assistant

The optional WRLD AI desktop companion is in [`desktop-assistant/`](desktop-assistant/). It runs locally with Ollama and a local model; it does not use ChatGPT or an OpenAI API. Its original 8-bit avatar, file access, public-web tools, and computer actions are documented in the assistant README. The optional Discord bot provides catalog search and local-model Q&A to everyone in one configured server; it cannot control the Mac.

The catalog records Juice WRLD API source IDs and categories, preserves local IDs/audio references, imports album tracklists and membership from the API, and applies unreleased project placement only for documented *The Outsiders* versions.

## Build roadmap

1. Catalog foundation: source-aware normalization, regression tests, safe local data migrations, and responsive full-catalog search.
2. Player foundation: persistent queue, playlists, playback history, and accessible controls.
3. Visualizers that analyze authorized audio selected by the user.
4. Backend architecture for accounts, authorized cloud files, permissions, backups, and moderation.
5. Server-side WRLD AI endpoints with usage limits and cost controls.
6. Optional Tauri desktop companion and Discord Rich Presence.

The backend features above are not part of the current static app. Evaluate hosting costs and data permissions before adding services.
