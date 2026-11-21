# WRLD Archives

WRLD Archives is a static, installable music catalog for Juice WRLD. The current version keeps catalog edits and user-selected audio in the browser. Audio linked through **Match files from folder** stays on the selected drive; the browser stores file handles locally and reads each file only for playback. Per-song **Add audio** still copies that one file into browser storage. Audio is not shared between users. Public audio delivery can be enabled only for recordings the project owns or has explicit distribution rights to; do not publish copyrighted recordings without authorization.

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
- Drive-linked files remain on the selected drive; IndexedDB stores file handles, not audio bytes. Per-song file attachments are stored in IndexedDB. Neither method shares audio across devices or visitors.
- Use **Export JSON** to back up the catalog metadata. This export does not include local audio files.
- The app links to streaming-service searches for released songs; those links do not guarantee availability of a specific recording.
- Do not add or publish copyrighted recordings unless you have permission to do so.

## Checks

Requires Node.js 20 or newer. Run the same checks used by GitHub Actions:

```sh
node scripts/validate.mjs
node --test catalog.test.mjs
```

The catalog records Juice WRLD API source IDs and categories, preserves local IDs/audio references, imports album tracklists and membership from the API, and applies unreleased project placement only for documented *The Outsiders* versions.

## Build roadmap

1. Catalog foundation: source-aware normalization, regression tests, safe local data migrations, and responsive full-catalog search.
2. Player foundation: persistent queue, playlists, playback history, and accessible controls.
3. Visualizers that analyze authorized audio selected by the user.
4. Backend architecture for accounts, authorized cloud files, permissions, backups, and moderation.
5. Server-side WRLD AI endpoints with usage limits and cost controls.
6. Optional Tauri desktop companion and Discord Rich Presence.

The backend features above are not part of the current static app. Evaluate hosting costs and data permissions before adding services.
