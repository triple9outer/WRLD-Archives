# WRLD Archives

WRLD Archives is an installable music catalog for Juice WRLD. Catalog edits and user-selected audio stay in the browser. Audio linked through **Link audio & covers from drive** stays on the selected drive; the browser stores file handles locally and reads each file only for playback. Per-song **Add audio** copies that one file into browser storage. User-provided lyric files and personal cover overrides are stored locally too. These local files are not shared; licensed Musixmatch lyrics are fetched only when requested and are not saved. The optional Cloudflare audio archive serves publicly only recordings you own or have explicit distribution rights to; do not publish copyrighted recordings without authorization.

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

The GitHub Pages build remains a static site. The app fetches public song metadata from Juice WRLD API; that catalog sync requires a working network connection and the API to be reachable from the browser.

## Cloud audio archive

The **Cloud audio** sidebar page can list and stream audio for every visitor and provides an admin-only upload flow for authorized recordings. It streams through the Pages Function and a private R2 bucket; the bucket itself should not be made public. Uploads require the admin secret and an explicit rights confirmation, but the app cannot independently verify licenses. Do not upload leaked or other copyrighted recordings unless you have the rights to distribute those specific files. GitHub Pages cannot run this endpoint; this feature requires a Cloudflare Pages deployment.

To configure it in Cloudflare:

1. Open the WRLD Archives project under **Workers & Pages** (connect the GitHub repository if needed). For this static app, use no framework, leave the build command blank, set the build output directory to `.`, and leave the root directory blank.
2. Enable R2 for the account in the Cloudflare dashboard, then create a private bucket such as `wrld-archives-audio`.
3. In **Settings → Bindings**, add an R2 bucket binding named `AUDIO_BUCKET` and select that bucket.
4. In **Settings → Variables and Secrets**, add an encrypted secret named `WRLD_CLOUD_ADMIN_TOKEN` with a long random value (at least 24 characters). Enter that same value in the Cloud audio publish form; it stays in the open page only and is not saved in browser storage. The form shows per-file reasons when a linked file cannot be read or uploaded. Never commit the token to GitHub or put it in frontend code.
5. Redeploy the Pages project. Open its **Cloud audio** page to check that the endpoint responds, then upload only individual files cleared for public distribution.

Cloudflare documents R2 setup and current pricing at [R2 Get started](https://developers.cloudflare.com/r2/get-started/) and [R2 pricing](https://developers.cloudflare.com/r2/pricing/). The free tier and rates can change; check the dashboard before storing large libraries. The app limits each file to 95 MB, uploads up to three selected files concurrently, and supports HTTP range requests for streaming. Upload time still depends on your connection and file sizes. The current Pages Function is `functions/api/cloud-audio.js`.

## Ambient music-video backgrounds

Ambient desktop can look up an embeddable official music video for a currently playing released song, then uses the video as a muted visual background while the app's selected audio remains the player audio. The cover art remains the fallback. Automatic lookup requires Cloudflare Pages and a server-side YouTube Data API key: add an encrypted secret named `YOUTUBE_DATA_API_KEY` to the Pages project, then redeploy. The browser never receives the key. The function requests embeddable video search results and only accepts matching results from its configured official-channel allowlist. See Google's [YouTube Data API search.list reference](https://developers.google.com/youtube/v3/docs/search/list). GitHub Pages continues to show the cover background.

## Automatic synced lyrics

The expanded player automatically checks Musixmatch for synced captions when playback starts (on by default; turn off **Automatically find synced captions** in the player to disable it). It skips local timed `.lrc` files, searches only once per song per page session, and still offers **Find synced lyrics** for a manual retry. The player opens automatically to show the lookup and captions; Ambient desktop displays the active line too. It displays the returned copyright and Musixmatch credit and sends the provider's tracking pixel or script as required. Provider lyrics remain in memory for the current song only; the app and service worker do not save or cache them. Only tracks covered by your Musixmatch account and plan can return captions.

This endpoint is a Cloudflare Pages Function at `functions/api/lyrics.js`. GitHub Pages cannot run it. To enable lookup:

1. Create a Musixmatch developer account and select a plan that permits lyrics display in this app. Create an API key from the Musixmatch developer portal; the provider requires a key for requests and says to keep it secret ([API setup](https://www.postman.com/musixmatch-dev/)).
2. In Cloudflare, open **Workers & Pages → Create application → Pages → Connect to Git**, select the WRLD Archives GitHub repository, and choose `main` as the production branch. Use no framework, leave **Build command** blank, set **Build output directory** to `.`, and leave **Root directory** blank so the app and `functions/api/lyrics.js` are at the repository root. Cloudflare can deploy directly from a connected GitHub repository ([setup guide](https://developers.cloudflare.com/pages/get-started/git-integration/)).
3. Open the new Pages project at **Workers & Pages → your project → Settings → Variables and Secrets → Add**. Name it `MUSIXMATCH_API_KEY`, paste the key as the value, select **Encrypt**, and save. Add it to both **Production** and **Preview** only if you want captions in preview deployments. Do not put this key in the repository or browser settings. Cloudflare stores these as encrypted secrets for Pages Functions ([Cloudflare secrets guide](https://developers.cloudflare.com/pages/functions/bindings/#secrets)).
4. After saving the secret, trigger a new deployment (for example, **Deployments → Retry deployment**) so the function runs with the secret. Keep this Pages site as the caption-enabled URL; GitHub Pages cannot run the server function.
5. Add a Cloudflare rate-limit rule for `/api/lyrics` before opening the site publicly. The function has a per-instance burst limit and sends `no-store` headers, but Cloudflare edge limits are needed for consistent quota protection across instances.
6. Open the Cloudflare Pages URL, start a song, and the app will look up captions automatically. **Find synced lyrics** remains available for a manual retry. The same timed lines will appear in Ambient desktop.

The API uses Musixmatch's `matcher.subtitle.get` endpoint, which returns synced subtitle data for a title, artist, and optional duration ([official endpoint](https://www.postman.com/musixmatch-dev/musixmatch-apis/request/pfer6zd/matcher-subtitle-get)). Unreleased tracks may not be in the authorized catalog, so they can still have no automatic captions. An API key and Cloudflare deployment are required; until then the app continues to work with user-selected local lyric files on GitHub Pages.

## Account sign-in

The sidebar’s **Account** panel supports Discord and Google OAuth, email sign-in links, and phone one-time codes through Supabase Auth. When signed in, favorites and playlist definitions sync to the user’s Supabase account. Song files, lyrics, listening history, the queue, and other local library data stay on that device. Row-level security limits each account to its own favorites and playlists.

To enable sign-in:

1. Create a Supabase project and set its **Site URL** to the production app address. Add the production address, the Cloudflare Pages address if used, and `http://localhost:4178` to the allowed redirect URLs. Supabase’s URL and redirect setup is documented in its [redirect URLs guide](https://supabase.com/docs/guides/auth/redirect-urls).
2. In Supabase Auth providers, enable email, Google, Discord, and phone as needed. Google and Discord each require an OAuth application; use the callback URL Supabase shows, then store each provider’s client ID and secret in the Supabase dashboard. Never put an OAuth client secret or Supabase secret/service-role key in this repository or in chat. See Supabase’s [Google](https://supabase.com/docs/guides/auth/social-sign-in/auth-google) and [Discord](https://supabase.com/docs/guides/auth/social-sign-in/auth-discord) guides.
3. For phone sign-in, configure an SMS provider in Supabase. SMS can incur provider fees; set rate limits and CAPTCHA before opening sign-up publicly. See the [phone sign-in guide](https://supabase.com/docs/guides/auth/phone-login).
4. `auth-config.js` contains the project URL and **publishable** key. The publishable key is intended for browser use; never place a Supabase secret key or OAuth client secret in the app.
5. In the Supabase SQL Editor, run [`supabase/cloud-library.sql`](supabase/cloud-library.sql) once to create the private favorites and playlists tables. It enables row-level security and grants table access only to authenticated users who own each row. The first signed-in account imports this browser’s existing favorites and playlists; later accounts keep separate cloud copies.

The app uses Supabase JS v2.119.2 from jsDelivr and PKCE browser sessions. If the SQL has not been run yet, favorites and playlists remain local and the Account panel explains how to finish setup.

## Discord update notices

`.github/workflows/discord-update-notice.yml` can post a short notice to a Discord channel after each push to `main`. It skips safely when the repository secret is missing. To enable it, create a new Discord channel webhook and add its URL in GitHub under **Settings → Secrets and variables → Actions → New repository secret**, named `DISCORD_WEBHOOK_URL`. Keep the URL out of source files and chat. If a webhook URL was shared publicly, delete it and make a replacement before adding the new one. The notice contains the commit summary and a link to its Actions run; mentions are disabled.

## Data and audio

- Song entries and catalog metadata are stored in this browser’s `localStorage`. Favorites are cached locally and sync through Supabase when signed in; playlist definitions sync the same way. Audio files, queue, and listening history remain device-local.
- Drive-linked audio remains on the selected drive; IndexedDB stores file handles, not audio bytes. When a public Cloud audio file matches a track by catalog source ID or normalized title and version, playback uses the Cloud copy in place of that track’s drive copy. The local file is left untouched and is used if no Cloud match is available. Per-song audio, cover overrides, and lyric attachments are stored in IndexedDB. These personal files and lyrics are not uploaded to GitHub or shared with other devices or visitors.
- To link a mounted external drive, use **Link audio & covers from drive** over HTTPS or localhost in a browser with folder access (such as Chrome or Edge), then select the folder. The app scans subfolders, matches known filenames to catalog entries, and adds non-matching audio as local Drive file entries so those files remain visible and playable. Embedded cover art is extracted automatically. Each device and visitor must select their own folder.
- The sidebar’s **Drive songs** view filters the catalog to entries linked from that browser’s selected drive.
- **Add your audio** accepts multiple files from a phone’s Files picker. **Choose a folder** scans folders in browsers with folder-selection support and falls back to multi-file selection where folder access is unavailable. These imports stay in this browser on this device.
- **Shuffle Drive** builds a randomized queue of every drive-linked song and plays each once per pass.
- **Shuffle library** builds a randomized queue from every song that currently has playable audio: files linked from the selected drive, audio added in this browser, authorized song URLs, and public Cloud audio. Songs without an audio source stay in the catalog but cannot play until audio is added.
- The **Grails** tab lets you keep a private, browser-local trophy list of favorite catalog entries.
- **Tier list** lets you rank songs S, A, B, C, D, or F, filters the catalog to ranked songs, and shares a text list through the device share sheet or a download. Rankings stay in this browser.
- **Filters & tools** now includes a recording-era selector populated from the catalog metadata, alongside availability, leak status, favorites, and listening-history sorting.
- With **Fresh shuffle** enabled in Ambient desktop, played and skipped songs leave the upcoming queue. Remaining playable songs reshuffle, then the cycle restarts after every available song has been heard.
- **Ambient desktop** opens a responsive, clock-led night view with the current song cover slowly drifting as the background, an audio-reactive orbit, up-next queue, glass playback bar, and fullscreen control. On phones and tablets the orb and controls scale down, and the queue collapses behind a toggle. For released songs, a configured Cloudflare Pages deployment can show a muted official music video behind the cover; otherwise the cover remains the background. Opening Ambient desktop attempts native fullscreen from the click; the control can retry or exit. Some browsers block fullscreen, so the player fills the app viewport and labels the state **Windowed**. The orb, queue, and player colors follow the cover’s sampled palette. The orb displays the current line from a timed local `.lrc` file as the song plays. It reuses the current player and local cover art.
- The Ambient desktop queue shows every queued song in a scrollable panel, brings the playing song into view when playback changes, and keeps the queue scroll independent from the visualizer. On narrow screens, use **Queue** to show or hide the upcoming songs.
- Song rows reflow for tablet and phone screens, giving long titles room to wrap and placing playback actions beneath the title when the layout narrows.
- The main player and Ambient desktop share a volume slider and remember its level in this browser. On mobile browsers that limit native volume control, local or same-origin audio can use Web Audio gain.
- **Surprise me** picks a random song from the current search, album, status, and favorite filters, highlights it in the archive, and offers playback when a local file or authorized link is available.
- **Filters & tools** expand in the page layout so they never cover album cards. Use the audio availability filter to find tracks with audio or entries that still need a file, and **Reset filters** to return to the full catalog.
- Sort by **Recently played** using this browser’s private history, or add any song to **Play next** without replacing the current track.
- **Library Checkup** scans files linked on this device for missing or unreadable audio, likely unsupported browser formats, possible same-name/same-size duplicates, missing covers or lyrics, and local drive entries. Duplicate matches are only suggestions; the scan never removes files.
- **WRLD Replay** keeps private play counts and listening time in this browser’s local storage and summarizes the most played songs and projects. These stats are not synced or shared.
- Browser Media Session controls expose current song metadata, artwork, play/pause, skip, and seeking to lock-screen, keyboard, headset, and operating-system media controls where the browser and device support them.
- The catalog, navigation, player, queue, forms, and dialogs use a shared liquid-glass treatment with translucent surfaces, soft highlights, and reduced-motion support.
- Use **Share** on a playlist to send it through the device share sheet or download a playlist JSON file. Importing a shared playlist matches tracks by source ID, title, and version; the share file contains track metadata only and no audio.
- The **Lyrics & captions** sidebar view scans local lyric coverage across the catalog and separates timed `.lrc`, plain-text, missing, and unreadable files. It can import lyrics per song or in bulk and start playable songs in the expanded caption player. Songs with lyric files automatically open the larger player when playback starts. Timed `.lrc` lines highlight and scroll with playback; plain `.txt` lines can be timed with **Sync lyrics to audio**. Automatic lookup checks the licensed Musixmatch catalog as each song plays when the Cloudflare endpoint is configured; turn it on or off in the expanded player. Provider coverage is not available for every song.
- Add `.lrc` or `.txt` lyric files per song, import multiple files with **Import lyrics**, or place matching `.lrc` or `.txt` files beside audio in a linked folder. Imports match filenames to song titles and versions; existing lyric attachments are left untouched. Timed `.lrc` lines follow playback. Use **Sync lyrics to audio** in the expanded player to mark each plain-text line as it starts and save it as timed lyrics. Lyric files stay in this browser. Song rows link to Genius search results, but the app does not scrape or bundle copyrighted lyrics.
- Song and album art extracted from the supplied audio files is optimized and bundled in `assets/covers/`; `cover-index.mjs` maps recognized catalog IDs, versions, filenames, and titles to that art. The app also includes official released-album/song artwork fallbacks so tracks without an exact match still display a cover. Use **Add cover** to set a personal override, or put separate image files named after a song or album in the linked folder. Personal overrides stay in this browser.
- Embedded artwork is extracted automatically from audio tags when you add an audio file or link a folder. To rebuild the public cover bundle on macOS, run `node scripts/build-covers.mjs /path/to/audio-folder`. MP3, M4A, MP4, FLAC, WAV, AAC, OGG, Opus, AIFF, and ALAC files are scanned. HTML download pages such as `song.mp3.html` are ignored because they are not audio files. The rebuild updates `cover-index.mjs` and `assets/covers/`.
- Use **Export JSON** to back up the catalog metadata. This export does not include local audio, cover, or lyric files.
- The app links to streaming-service searches for released songs; those links do not guarantee availability of a specific recording.
- Do not add or publish copyrighted recordings unless you have permission to do so.

## Checks

Requires Node.js 20 or newer. Run the same checks used by GitHub Actions:

```sh
node scripts/validate.mjs
node --test catalog.test.mjs lyrics-api.test.mjs library-tools.test.mjs cloud-audio.test.mjs music-video-api.test.mjs
```

## Local desktop assistant

The optional WRLD AI desktop companion is in [`desktop-assistant/`](desktop-assistant/). It runs locally with Ollama and a local model; it does not use ChatGPT or an OpenAI API. Its original 8-bit avatar, file access, public-web tools, and computer actions are documented in the assistant README. The optional Discord bot provides catalog search and local-model Q&A to everyone in one configured server; it cannot control the Mac.

The catalog records Juice WRLD API source IDs and categories, preserves local IDs/audio references, imports album tracklists and membership from the API, and applies unreleased project placement only for documented *The Outsiders* versions.

## Build roadmap

1. Catalog foundation: source-aware normalization, regression tests, safe local data migrations, and responsive full-catalog search.
2. Player foundation: persistent queue, playlists, playback history, and accessible controls.
3. Visualizers that analyze authorized audio selected by the user.
4. Cloud profiles, authorized cloud-file permissions, backups, and moderation. Sign-in alone does not sync or protect user data.
5. Server-side WRLD AI endpoints with usage limits and cost controls.
6. Optional Tauri desktop companion and Discord Rich Presence.

The backend features above are not part of the current static app. Evaluate hosting costs and data permissions before adding services.
