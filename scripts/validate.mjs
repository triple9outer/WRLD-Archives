import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const html = readFileSync(join(root, 'index.html'), 'utf8');
const catalog = readFileSync(join(root, 'catalog.mjs'), 'utf8');
const worker = readFileSync(join(root, 'service-worker.js'), 'utf8');
const manifest = JSON.parse(readFileSync(join(root, 'manifest.webmanifest'), 'utf8'));

assert.match(html, /<script type="module">[\s\S]*?import \{ filterCatalogTracks, mergeApiAlbums, mergeApiCatalog \} from '\.\/catalog\.mjs';/);
assert.match(worker, /'\.\/catalog\.mjs'/, 'service worker must cache the catalog module');
assert.equal(manifest.name, 'WRLD Archives');
assert.equal(manifest.start_url, './');
assert.ok(manifest.icons?.length, 'manifest must declare an icon');
assert.ok(catalog.includes('export function mergeApiCatalog'));

const moduleScript = html.match(/<script type="module">([\s\S]*?)<\/script>/)?.[1];
assert.ok(moduleScript, 'main application module must exist');
const albumDeclaration = moduleScript.indexOf('let releasedAlbums=');
const savedAlbumRead = moduleScript.indexOf("localStorage.getItem('jw-released-albums-v1')");
assert.ok(albumDeclaration >= 0 && savedAlbumRead > albumDeclaration, 'saved album state must load after its default value is initialized');
assert.match(moduleScript, /function shuffleIds\(/, 'shuffle must randomize queue order without repeats during a pass');
assert.match(html, /id="shuffleDriveTrack"/, 'player must expose drive-wide shuffle');
assert.match(html, /id="nowPlayingDialog"/, 'expanded player dialog must exist');
assert.match(html, /data-lyrics="\$\{esc\(t\.id\)\}"/, 'song rows must support local lyric files');
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
