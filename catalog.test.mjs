import test from 'node:test';
import assert from 'node:assert/strict';
import { filterCatalogTracks, mergeApiAlbums, mergeApiCatalog, normalizeApiSong } from './catalog.mjs';

const apiSong = (overrides = {}) => ({
  id: 101, name: 'Rental (v1)', category: 'unreleased', album: '', era: { name: 'DRFL' },
  track_titles: ['Rental'], credited_artists: '', producers: 'Nick Mira',
  engineers: '', record_dates: '2018', length: '3:02', bpm: 90, key: 'A minor',
  ...overrides,
});

test('normalizes API song fields and keeps versions separate from titles', () => {
  assert.deepEqual(normalizeApiSong(apiSong()), {
    title: 'Rental', version: 'v1', status: 'unreleased', leakStatus: 'leaked',
    source: 'juicewrldapi', sourceId: '101', sourceCategory: 'unreleased', album: '', albumMemberships: [],
    era: 'DRFL', altTitles: ['Rental'], features: '', producers: 'Nick Mira',
    engineers: '', recorded: '2018', duration: '3:02', releaseDate: '', bpm: '90', key: 'A minor',
  });
});

test('assigns only documented Outsiders versions', () => {
  assert.equal(normalizeApiSong(apiSong({ name: 'Too Many (v1)' })).album, 'The Outsiders');
  assert.equal(normalizeApiSong(apiSong({ name: 'Too Many (v2)', category: 'unsurfaced' })).album, '');
  assert.equal(normalizeApiSong(apiSong({ name: 'Off The Rip (v1)' })).album, 'The Outsiders');
});

test('merges source metadata without losing local IDs or favorites, and keeps remasters unleaked', () => {
  const original = { id: 'local-id', title: 'Rental', version: 'V1', status: 'unreleased', album: '', favorite: true, remaster: true, leakStatus: 'leaked' };
  const result = mergeApiCatalog([original], [apiSong()], () => 'new-id');
  assert.equal(result.tracks.length, 1);
  assert.equal(result.tracks[0].id, 'local-id');
  assert.equal(result.tracks[0].favorite, true);
  assert.equal(result.tracks[0].leakStatus, 'unleaked');
  assert.equal(result.tracks[0].sourceId, '101');
  assert.equal(result.tracks[0].producers, 'Nick Mira');
});

test('updates an unreleased album assignment from the source and avoids duplicates', () => {
  const original = { id: 'existing', title: 'Too Many', version: 'v1', status: 'unreleased', album: 'Fan Project' };
  const result = mergeApiCatalog([original], [apiSong({ name: 'Too Many (v1)' }), apiSong({ name: 'Too Many (v1)' })]);
  assert.equal(result.tracks.length, 1);
  assert.equal(result.tracks[0].album, 'The Outsiders');
});

test('filters and sorts tracks consistently', () => {
  const tracks = [
    { title: 'Rental', status: 'unreleased', leakStatus: 'leaked', album: '', favorite: true },
    { title: 'Too Many', status: 'unreleased', leakStatus: 'unleaked', album: 'The Outsiders', single: true },
    { title: 'Robbery', status: 'released', album: 'Goodbye & Good Riddance' },
  ];
  assert.deepEqual(filterCatalogTracks(tracks, { status: 'unreleased', leakStatus: 'unleaked' }).map(t => t.title), ['Too Many']);
  assert.deepEqual(filterCatalogTracks(tracks, { query: 'GOODBYE', album: 'Goodbye & Good Riddance' }).map(t => t.title), ['Robbery']);
  assert.deepEqual(filterCatalogTracks(tracks, { singlesOnly: true }).map(t => t.title), ['Too Many']);
});

test('imports every album placement while retaining one catalog entry for shared songs', () => {
  const albums = [
    { title: 'Legends Never Die', release_date: '2020-07-10', songs: [{ song: { id: 7, name: 'Righteous', category: 'released' } }] },
    { title: 'Legends Never Die (5 Year Anniversary Edition)', release_date: '2025-07-11', songs: [{ song: { id: 7, name: 'Righteous', category: 'released' } }] },
  ];
  const result = mergeApiAlbums([], albums, () => 'new-id');
  assert.equal(result.tracks.length, 1);
  assert.deepEqual(result.tracks[0].albumMemberships, ['Legends Never Die', 'Legends Never Die (5 Year Anniversary Edition)']);
  assert.equal(result.tracks[0].album, 'Legends Never Die');
  assert.equal(filterCatalogTracks(result.tracks, { album: 'Legends Never Die (5 Year Anniversary Edition)' }).length, 1);
});
