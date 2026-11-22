import test from 'node:test';
import assert from 'node:assert/strict';
import { chooseOfficialVideo, onRequestGet } from './functions/api/music-video.js';

test('video selection accepts a matching official music video and skips lyric or fan uploads', () => {
  const video = chooseOfficialVideo([
    { id: { videoId: 'abcdefghijk' }, snippet: { title: 'Juice WRLD - Lucid Dreams (Official Music Video)', channelTitle: 'Juice WRLD' } },
    { id: { videoId: 'lmnopqrstuv' }, snippet: { title: 'Lucid Dreams Lyrics', channelTitle: 'Juice WRLD' } },
    { id: { videoId: '12345678901' }, snippet: { title: 'Lucid Dreams Official Video', channelTitle: 'Fan Uploads' } }
  ], 'Lucid Dreams');
  assert.equal(video.videoId, 'abcdefghijk');
  assert.equal(chooseOfficialVideo([{ id: { videoId: 'abcdefghijk' }, snippet: { title: 'Lucid Dreams', channelTitle: 'Fan Uploads' } }], 'Lucid Dreams'), null);
});

test('lookup requires same-origin player requests and released status', async () => {
  const request = new Request('https://wrld.test/api/music-video?title=Lucid%20Dreams&status=unreleased', { headers: { 'X-WRLD-Archives': '1' } });
  assert.equal((await onRequestGet({ request, env: { YOUTUBE_DATA_API_KEY: 'secret' } })).status, 400);
  const crossOrigin = new Request('https://wrld.test/api/music-video?title=Lucid%20Dreams&status=released', { headers: { Origin: 'https://other.test', 'X-WRLD-Archives': '1' } });
  assert.equal((await onRequestGet({ request: crossOrigin, env: { YOUTUBE_DATA_API_KEY: 'secret' } })).status, 403);
});

test('missing YouTube API secret fails safely without a browser-side key', async () => {
  const request = new Request('https://wrld.test/api/music-video?title=Lucid%20Dreams&status=released', { headers: { 'X-WRLD-Archives': '1' } });
  const response = await onRequestGet({ request, env: {} });
  assert.equal(response.status, 503);
  assert.match(await response.text(), /not configured/);
});

test('automatic lookup asks YouTube only for an embeddable released music video', async () => {
  const originalFetch = globalThis.fetch;
  let requested;
  globalThis.fetch = async url => {
    requested = new URL(url);
    return Response.json({ items: [{
      id: { videoId: 'abcdefghijk' },
      snippet: { title: 'Juice WRLD - Lucid Dreams (Official Music Video)', channelTitle: 'Juice WRLD' }
    }] });
  };
  try {
    const request = new Request('https://wrld.test/api/music-video?title=Lucid%20Dreams&status=released', { headers: { 'X-WRLD-Archives': '1' } });
    const response = await onRequestGet({ request, env: { YOUTUBE_DATA_API_KEY: 'server-secret' } });
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), {
      video: { videoId: 'abcdefghijk', title: 'Juice WRLD - Lucid Dreams (Official Music Video)', channel: 'Juice WRLD' },
      provider: 'YouTube'
    });
    assert.equal(requested.searchParams.get('type'), 'video');
    assert.equal(requested.searchParams.get('videoEmbeddable'), 'true');
    assert.equal(requested.searchParams.get('videoSyndicated'), 'true');
    assert.equal(requested.searchParams.get('key'), 'server-secret');
  } finally {
    globalThis.fetch = originalFetch;
  }
});
