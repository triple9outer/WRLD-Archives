import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const html = readFileSync(join(root, 'index.html'), 'utf8');
const catalog = readFileSync(join(root, 'catalog.mjs'), 'utf8');
const worker = readFileSync(join(root, 'service-worker.js'), 'utf8');
const manifest = JSON.parse(readFileSync(join(root, 'manifest.webmanifest'), 'utf8'));
const { default: coverIndex } = await import('../cover-index.mjs');

assert.match(html, /<script type="module">[\s\S]*?import \{ filterCatalogTracks, mergeApiAlbums, mergeApiCatalog \} from '\.\/catalog\.mjs';/);
assert.match(worker, /'\.\/catalog\.mjs'/, 'service worker must cache the catalog module');
assert.match(worker, /'\.\/cover-index\.mjs'/, 'service worker must cache the bundled cover map');
assert.match(worker, /wrld-archives-shell-v15/, 'service worker cache must refresh for the ambient view');
assert.match(html, /import coverIndex from '\.\/cover-index\.mjs'/, 'app must import the bundled cover map');
assert.match(html, /staticCoverPathForTrack\(track\)\|\|staticCoverPathForAlbum/, 'covers must have a public bundled fallback');
assert.equal(manifest.name, 'WRLD Archives');
assert.equal(manifest.start_url, './');
assert.ok(manifest.icons?.length, 'manifest must declare an icon');
assert.ok(catalog.includes('export function mergeApiCatalog'));

const moduleScript = html.match(/<script type="module">([\s\S]*?)<\/script>/)?.[1];
assert.ok(moduleScript, 'main application module must exist');
const bundledCovers = readdirSync(join(root, 'assets', 'covers')).filter(name => name.endsWith('.jpg'));
assert.ok(bundledCovers.length > 0, 'the repository must include public cover images');
const indexedCoverPaths = [...new Set(Object.values(coverIndex).flatMap(mapping => Object.values(mapping)))];
assert.ok(indexedCoverPaths.length > 0, 'the cover map must include track or album mappings');
for (const path of indexedCoverPaths) {
  assert.match(path, /^assets\/covers\/[a-f0-9]+\.jpg$/, `unexpected bundled cover path: ${path}`);
  assert.ok(statSync(join(root, path)).size > 0, `bundled cover image is empty: ${path}`);
}
const albumDeclaration = moduleScript.indexOf('let releasedAlbums=');
const savedAlbumRead = moduleScript.indexOf("localStorage.getItem('jw-released-albums-v1')");
assert.ok(albumDeclaration >= 0 && savedAlbumRead > albumDeclaration, 'saved album state must load after its default value is initialized');
assert.match(moduleScript, /function shuffleIds\(/, 'shuffle must randomize queue order without repeats during a pass');
assert.match(html, /id="shuffleDriveTrack"/, 'player must expose drive-wide shuffle');
assert.match(html, /id="nowPlayingDialog"/, 'expanded player dialog must exist');
assert.match(html, /id="lyricSyncStart"/, 'expanded player must expose lyric sync');
assert.match(html, /id="lyricSyncMark"/, 'lyric sync must let listeners mark line starts');
assert.match(html, /id="autoShowLyrics"/, 'expanded player must expose the automatic lyric view toggle');
assert.match(moduleScript, /if\(autoShowLyrics&&t\.hasLyrics&&!desktopStage\.open\)/, 'playback must auto-open lyrics for tracks with a lyric file');
assert.match(html, /id="desktopStage"/, 'ambient desktop mode dialog must exist');
assert.match(html, /id="sideDesktopMode"/, 'sidebar must expose ambient desktop mode');
assert.match(moduleScript, /function openDesktopMode\(/, 'ambient desktop mode must be launchable');
assert.match(moduleScript, /function drawDesktopOrb\(/, 'ambient desktop mode must include an audio-reactive orb');
assert.match(moduleScript, /function renderDesktopQueue\(/, 'ambient desktop mode must display the play queue');
assert.match(moduleScript, /function formatLrcTimestamp\(/, 'manual lyric sync must save timed LRC lines');
assert.match(moduleScript, /function buildSyncedLrc\(/, 'manual lyric sync must serialize every marked line');
assert.match(moduleScript, /async function saveSyncedLyrics\(/, 'manual lyric sync must save to the local lyric store');
assert.match(html, /data-playlist-share/, 'playlist rows must expose share actions');
assert.match(html, /id="playlistImportButton"/, 'playlist panel must expose import');
assert.match(moduleScript, /function sharedPlaylistData\(/, 'shared playlists must serialize catalog references');
assert.match(moduleScript, /async function importSharedPlaylistFile\(/, 'shared playlist import handler must exist');
assert.match(moduleScript, /async function sharePlaylist\(/, 'playlist sharing must use a share sheet or downloadable file');
assert.match(html, /data-lyrics="\$\{esc\(t\.id\)\}"/, 'song rows must support local lyric files');
assert.match(html, /id="importLyrics"/, 'catalog tools must expose bulk lyric import');
assert.match(html, /id="lyricsFiles" accept="\.lrc,\.txt,text\/plain" multiple/, 'bulk lyric import must accept multiple text or LRC files');
assert.match(moduleScript, /function matchLyricsFile\(/, 'bulk lyric import must match filenames to song titles');
assert.match(moduleScript, /async function importLyricsFiles\(/, 'bulk lyric import handler must be present');
assert.match(moduleScript, /track\.hasLyrics\)\{existing\+\+;continue\}/, 'bulk lyric import must preserve existing lyrics');
assert.ok(html.includes('data-cover-upload="${esc(t.id)}"'), 'song rows must support local cover files');
assert.match(moduleScript, /\.\(mp3\|m4a\|mp4\|/, 'folder import must accept MP4 audio files');
assert.match(moduleScript, /function makeLocalDriveTrack\(/, 'unmatched audio files must remain visible as local drive entries');
assert.match(moduleScript, /function extractEmbeddedCover\(/, 'audio import must extract embedded cover art');
assert.match(html, /genius\.com\/search/, 'song rows must link to Genius search');
const temp = mkdtempSync(join(tmpdir(), 'wrld-archives-check-'));
try {
  const sourcePath = join(temp, 'inline-app.mjs');
  writeFileSync(sourcePath, moduleScript);
  for (const path of [sourcePath, join(root, 'catalog.mjs'), join(root, 'service-worker.js')]) {
    const result = spawnSync(process.execPath, ['--check', path], { encoding: 'utf8' });
    assert.equal(result.status, 0, `${path}: ${result.stderr || result.stdout}`);
  }
} finally {
  rmSync(temp, { recursive: true, force: true });
}

console.log('WRLD Archives static validation passed.');
