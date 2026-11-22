import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const apiPath = fileURLToPath(new URL('./functions/api/lyrics.js', import.meta.url));
const apiSource = readFileSync(apiPath, 'utf8');
const { onRequestGet } = await import(`data:text/javascript;base64,${Buffer.from(apiSource).toString('base64')}`);

function makeRequest(query = 'title=Robbery&artist=Juice+WRLD&duration=240', headers = {}) {
  return new Request(`https://wrld.example/api/lyrics?${query}`, {
    headers: { 'X-WRLD-Archives': '1', 'CF-Connecting-IP': crypto.randomUUID(), ...headers }
  });
}

test('reports missing secret without contacting Musixmatch', async () => {
  const response = await onRequestGet({ request: makeRequest(), env: {} });
  assert.equal(response.status, 503);
  assert.equal((await response.json()).error, 'Musixmatch lookup is not configured on this host yet.');
  assert.match(response.headers.get('cache-control'), /no-store/);
});

test('rejects cross-origin and non-player requests', async () => {
  const crossOrigin = await onRequestGet({ request: makeRequest(undefined, { Origin: 'https://elsewhere.example' }), env: { MUSIXMATCH_API_KEY: 'test-secret' } });
  assert.equal(crossOrigin.status, 403);
  const direct = new Request('https://wrld.example/api/lyrics?title=Robbery&artist=Juice+WRLD');
  const directResponse = await onRequestGet({ request: direct, env: { MUSIXMATCH_API_KEY: 'test-secret' } });
  assert.equal(directResponse.status, 403);
});

test('returns timed lyrics with attribution without exposing or caching the key', async t => {
  const originalFetch = globalThis.fetch;
  let upstreamUrl;
  globalThis.fetch = async input => {
    upstreamUrl = new URL(input);
    return new Response(JSON.stringify({
      message: {
        header: { status_code: 200 },
        body: {
          subtitle: {
            subtitle_body: '[00:01.20]Line one\n[00:02.40]Line two',
            lyrics_copyright: 'Copyright holder',
            pixel_tracking_url: 'http://tracking.musixmatch.com/t1.0/test-pixel',
            restricted: 0
          }
        }
      }
    }), { status: 200, headers: { 'content-type': 'application/json' } });
  };
  t.after(() => { globalThis.fetch = originalFetch; });

  const secret = 'private-test-key';
  const response = await onRequestGet({ request: makeRequest(), env: { MUSIXMATCH_API_KEY: secret } });
  const body = await response.json();
  assert.equal(response.status, 200);
  assert.equal(body.syncedLyrics, '[00:01.20]Line one\n[00:02.40]Line two');
  assert.equal(body.copyright, 'Copyright holder');
  assert.equal(body.trackingPixelUrl, 'https://tracking.musixmatch.com/t1.0/test-pixel');
  assert.equal(upstreamUrl.pathname, '/ws/1.1/matcher.subtitle.get');
  assert.equal(upstreamUrl.searchParams.get('apikey'), secret);
  assert.equal(upstreamUrl.searchParams.get('subtitle_format'), 'lrc');
  assert.equal(upstreamUrl.searchParams.get('f_subtitle_length'), '240');
  assert.doesNotMatch(JSON.stringify(body), new RegExp(secret));
  assert.match(response.headers.get('cache-control'), /no-store/);
});

test('does not return restricted or untimed lyric payloads', async t => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify({
    message: { header: { status_code: 200 }, body: { subtitle: { subtitle_body: '', restricted: 1 } } }
  }), { status: 200 });
  t.after(() => { globalThis.fetch = originalFetch; });
  const response = await onRequestGet({ request: makeRequest(), env: { MUSIXMATCH_API_KEY: 'private-test-key' } });
  assert.equal(response.status, 404);
});
