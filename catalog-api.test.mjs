import test from 'node:test';
import assert from 'node:assert/strict';
import { onRequest, metadataOnly } from './functions/api/catalog.js';

const sample = [
  {
    id: 21, public_id: 8, name: 'Released Song', category: 'released',
    album: 'Example Album', credited_artists: 'Juice WRLD', producers: 'Producer',
    path: 'private/original-audio.mp3', audio_url: 'https://example.test/audio.mp3',
    image_url: '/covers/example.jpg', length: '2:30'
  },
  { id: 22, name: 'Unreleased Song (v2)', category: 'unreleased', version_title: 'v2', era: { name: 'OUT' }, url: 'https://example.test/leak.mp3' },
  { id: 23, name: 'Snippet', category: 'unsurfaced', track_titles: ['Snippet'] },
  { id: 24, name: 'Ignored', category: 'unknown' }
];

function request(url = 'https://wrld.test/api/catalog', method = 'GET') {
  return new Request(url, { method });
}

test('catalog API returns full public metadata without file paths or audio URLs', async t => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify(sample), { headers: { 'content-type': 'application/json' } });
  t.after(() => { globalThis.fetch = originalFetch; });

  const response = await onRequest({ request: request() });
  const data = await response.json();
  assert.equal(response.status, 200);
  assert.equal(data.total, 3);
  assert.equal(data.items.length, 3);
  assert.equal(data.items[1].name, 'Unreleased Song (v2)');
  assert.equal(data.items[1].era, 'OUT');
  assert.equal(Object.hasOwn(data.items[0], 'path'), false);
  assert.equal(Object.hasOwn(data.items[0], 'audio_url'), false);
  assert.equal(Object.hasOwn(data.items[0], 'image_url'), false);
  assert.equal(response.headers.get('access-control-allow-origin'), '*');
});

test('catalog API supports category, text search, and pagination', async t => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify(sample));
  t.after(() => { globalThis.fetch = originalFetch; });

  const response = await onRequest({ request: request('https://wrld.test/api/catalog?category=unreleased&q=OUT&limit=1&offset=0') });
  const data = await response.json();
  assert.equal(data.total, 1);
  assert.equal(data.count, 1);
  assert.equal(data.items[0].category, 'unreleased');
});

test('catalog API rejects invalid categories and handles upstream failures', async t => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify(sample));
  const invalid = await onRequest({ request: request('https://wrld.test/api/catalog?category=audio') });
  assert.equal(invalid.status, 400);

  globalThis.fetch = async () => new Response('unavailable', { status: 503 });
  const failed = await onRequest({ request: request() });
  assert.equal(failed.status, 502);
  t.after(() => { globalThis.fetch = originalFetch; });
});

test('metadata projection keeps only catalog fields', () => {
  const item = metadataOnly(sample[0]);
  assert.equal(item.id, '21');
  assert.equal(item.album, 'Example Album');
  assert.equal('path' in item, false);
  assert.equal('url' in item, false);
});
