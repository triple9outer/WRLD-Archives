import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { basename, extname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { mergeApiAlbums, mergeApiCatalog } from '../catalog.mjs';

const inputRoot = process.argv[2] ? resolve(process.argv[2]) : '';
if (!inputRoot) throw new Error('Usage: node scripts/build-covers.mjs /path/to/audio-folder');

const root = resolve(new URL('..', import.meta.url).pathname);
const coversRoot = join(root, 'assets', 'covers');
const audioExt = /\.(mp3|m4a|mp4|flac|wav|aac|ogg|opus|aiff?|alac)$/i;
const source = readFileSync(join(root, 'index.html'), 'utf8');
const parserStart = source.indexOf('function syncsafeSize');
const parserEnd = source.indexOf('async function optimizeCover', parserStart);
if (parserStart < 0 || parserEnd < 0) throw new Error('Embedded artwork parser not found in index.html');
const extractEmbeddedCover = new Function(`${source.slice(parserStart, parserEnd)}\nreturn extractEmbeddedCover;`)();

function walk(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    const path = join(dir, entry.name);
    return entry.isDirectory() ? walk(path) : audioExt.test(entry.name) ? [path] : [];
  });
}

function decodeName(value) {
  try { return decodeURIComponent(String(value || '')); } catch { return String(value || ''); }
}

function normName(value) {
  return decodeName(value)
    .replace(/\.(mp3|m4a|mp4|flac|wav|aac|ogg|opus|aiff?|alac|avif|gif|jpe?g|png|webp)$/i, '')
    .replace(/\bjuice\s*wrld\b/ig, ' ')
    .replace(/\bfeat(?:uring)?\b.*$/i, ' ')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function localFileKey(name) {
  return decodeName(name).normalize('NFKC').toLowerCase().replace(/\s+/g, ' ').trim();
}

function localFileTitle(name) {
  return decodeName(name)
    .replace(audioExt, '')
    .replace(/^\s*\d{1,3}\s*[.)_-]+\s*/, '')
    .replace(/^\s*juice\s*wrld\s*[-–—_:]+\s*/i, '')
    .replace(/\s*[-–—]\s*juice\s*wrld\s*$/i, '')
    .replace(/_/g, ' ')
    .replace(/\s+/g, ' ')
    .trim() || 'Untitled drive file';
}

function matchAudioFile(filename, tracks) {
  const fileName = normName(filename);
  const hits = [];
  for (const track of tracks) {
    const aliases = [track.title, ...(Array.isArray(track.altTitles) ? track.altTitles : String(track.altTitles || '').split(','))].map(normName).filter(Boolean);
    let score = 0;
    for (const alias of aliases) {
      if (fileName === alias) score = Math.max(score, 8);
      if (track.version) {
        const version = normName(track.version);
        if (fileName === `${alias} ${version}` || fileName.startsWith(`${alias} ${version} `)) score = Math.max(score, 12);
      }
      if (fileName.startsWith(`${alias} `)) score = Math.max(score, 4);
    }
    if (score) hits.push({ track, score });
  }
  hits.sort((a, b) => b.score - a.score);
  return !hits.length || (hits.length > 1 && hits[0].score === hits[1].score) ? null : hits[0].track;
}

function setFirst(target, key, value) {
  if (key && !target[key]) target[key] = value;
}

const songResponse = await fetch('https://juicewrldapi.com/juicewrld/songs/?all=true&versions=true');
if (!songResponse.ok) throw new Error(`Song catalog request failed: ${songResponse.status}`);
const songs = await songResponse.json();
let tracks = mergeApiCatalog([], songs, () => '').tracks;
try {
  const albumResponse = await fetch('https://juicewrldapi.com/juicewrld/albums/?page_size=100');
  if (albumResponse.ok) {
    const pages = [];
    let url = albumResponse.url;
    for (let page = 0; url && page < 10; page++) {
      const response = page === 0 ? albumResponse : await fetch(url);
      if (!response.ok) break;
      const data = await response.json();
      if (Array.isArray(data)) { pages.push(...data); break; }
      if (!Array.isArray(data.results)) break;
      pages.push(...data.results);
      url = data.next || '';
    }
    tracks = mergeApiAlbums(tracks, pages, () => '').tracks;
  }
} catch { /* Song art still builds if the album endpoint is temporarily unavailable. */ }

mkdirSync(coversRoot, { recursive: true });
const tempRoot = join(tmpdir(), `wrld-cover-build-${process.pid}`);
mkdirSync(tempRoot, { recursive: true });
const index = { sourceIds: {}, trackKeys: {}, names: {}, localFiles: {}, albums: {} };
const files = walk(inputRoot).sort((a, b) => a.localeCompare(b));
const seenImages = new Map();
let extracted = 0;
let filesWithoutArt = 0;
let invalidArtwork = 0;
let totalBytes = 0;

function addTrackMappings(track, asset) {
  const title = normName(track.title);
  const version = normName(track.version);
  const aliases = [track.title, ...(Array.isArray(track.altTitles) ? track.altTitles : String(track.altTitles || '').split(','))].map(normName).filter(Boolean);
  setFirst(index.trackKeys, `${title}|${version}`, asset);
  if (track.sourceId) setFirst(index.sourceIds, String(track.sourceId), asset);
  for (const name of new Set([title, `${title} ${version}`.trim(), ...aliases, ...aliases.map(alias => `${title} ${alias}`), ...aliases.map(alias => `${title} ${version} ${alias}`.trim())])) setFirst(index.names, name, asset);
  for (const album of [track.album, ...(track.albumMemberships || [])]) setFirst(index.albums, normName(album), asset);
}

for (const filePath of files) {
  const filename = basename(filePath);
  const data = readFileSync(filePath);
  const cover = await extractEmbeddedCover(new File([data], filename));
  if (!cover) { filesWithoutArt++; continue; }
  const raw = Buffer.from(await cover.arrayBuffer());
  const hash = createHash('sha256').update(raw).digest('hex');
  let asset = seenImages.get(hash);
  if (!asset) {
    const ext = cover.type === 'image/png' ? '.png' : cover.type === 'image/webp' ? '.webp' : cover.type === 'image/gif' ? '.gif' : '.jpg';
    const tempFile = join(tempRoot, `${hash}${ext}`);
    const outputFile = join(coversRoot, `${hash.slice(0, 20)}.jpg`);
    writeFileSync(tempFile, raw);
    const result = spawnSync('sips', ['-Z', '640', '-s', 'format', 'jpeg', '-s', 'formatOptions', '82', tempFile, '--out', outputFile], { encoding: 'utf8' });
    if (result.status !== 0) { invalidArtwork++; continue; }
    asset = `assets/covers/${basename(outputFile)}`;
    seenImages.set(hash, asset);
    totalBytes += readFileSync(outputFile).length;
  }
  extracted++;

  const track = matchAudioFile(filename, tracks);
  if (track) addTrackMappings(track, asset);
  else {
    const title = localFileTitle(filename);
    setFirst(index.trackKeys, `${normName(title)}|`, asset);
    setFirst(index.names, normName(title), asset);
    setFirst(index.localFiles, localFileKey(filename), asset);
  }
}

const manifest = `// Built from embedded artwork in the supplied local audio folder.\nexport default ${JSON.stringify(index)};\n`;
writeFileSync(join(root, 'cover-index.mjs'), manifest);
rmSync(tempRoot, { recursive: true, force: true });
console.log(JSON.stringify({ audioFiles: files.length, filesWithArtwork: extracted, filesWithoutArtwork: filesWithoutArt, invalidArtwork, uniqueCovers: seenImages.size, optimizedBytes: totalBytes }));
