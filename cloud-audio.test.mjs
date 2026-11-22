import test from 'node:test';
import assert from 'node:assert/strict';
import { onRequest } from './functions/api/cloud-audio.js';

class MemoryBucket {
  constructor() { this.objects = new Map(); }
  async put(key, body, options) {
    const bytes = new Uint8Array(await new Response(body).arrayBuffer());
    this.objects.set(key, { key, bytes, customMetadata: options.customMetadata, httpMetadata: options.httpMetadata, httpEtag: '"test-etag"' });
  }
  async head(key) {
    const object = this.objects.get(key);
    return object ? { ...object, size: object.bytes.length } : null;
  }
  async get(key, options = {}) {
    const object = this.objects.get(key);
    if (!object) return null;
    let bytes = object.bytes;
    let range;
    if (options.range) {
      const { offset, length } = options.range;
      bytes = bytes.slice(offset, offset + length);
      range = { offset, length: bytes.length };
    }
    return {
      ...object,
      size: object.bytes.length,
      range,
      body: new Blob([bytes]).stream(),
      writeHttpMetadata(headers) { headers.set('content-type', object.httpMetadata.contentType); }
    };
  }
  async list({ prefix = '', cursor, limit = 1000 } = {}) {
    const objects = [...this.objects.values()].filter(item => item.key.startsWith(prefix)).map(item => ({
      ...item, size: item.bytes.length
    }));
    return { objects: objects.slice(0, limit), truncated: false, cursor: undefined };
  }
}

function ctx(request, bucket = new MemoryBucket()) {
  return { request, env: { AUDIO_BUCKET: bucket, WRLD_CLOUD_ADMIN_TOKEN: 'test-token-that-is-long-enough-123' } };
}

test('public cloud upload requires the admin token and rights confirmation', async () => {
  const bucket = new MemoryBucket();
  const form = new FormData();
  form.set('file', new File(['audio'], 'song.mp3', { type: 'audio/mpeg' }));
  form.set('catalogId', 'song-1');
  form.set('title', 'Song');
  form.set('rightsConfirmed', 'yes');
  const unauthorized = await onRequest({ ...ctx(new Request('https://wrld.test/api/cloud-audio', { method: 'POST', headers: { 'X-WRLD-Archives': '1' }, body: form }), bucket) });
  assert.equal(unauthorized.status, 401);

  const noAttestation = new FormData();
  noAttestation.set('file', new File(['audio'], 'song.mp3', { type: 'audio/mpeg' }));
  noAttestation.set('catalogId', 'song-1');
  noAttestation.set('title', 'Song');
  const denied = await onRequest({ ...ctx(new Request('https://wrld.test/api/cloud-audio', { method: 'POST', headers: { Authorization: 'Bearer test-token-that-is-long-enough-123', 'X-WRLD-Archives': '1' }, body: noAttestation }), bucket) });
  assert.equal(denied.status, 400);
  assert.equal(bucket.objects.size, 0);
});

test('only rights-confirmed uploads appear in the public list and support byte ranges', async () => {
  const bucket = new MemoryBucket();
  const form = new FormData();
  form.set('file', new File(['abcdefghij'], 'song.mp3', { type: 'audio/mpeg' }));
  form.set('catalogId', 'song-1');
  form.set('sourceId', '123');
  form.set('title', 'Song');
  form.set('rightsConfirmed', 'yes');
  const uploaded = await onRequest(ctx(new Request('https://wrld.test/api/cloud-audio', {
    method: 'POST', headers: { Authorization: 'Bearer test-token-that-is-long-enough-123', 'X-WRLD-Archives': '1' }, body: form
  }), bucket));
  assert.equal(uploaded.status, 200);

  bucket.objects.set('audio/private-song', {
    key: 'audio/private-song', bytes: new Uint8Array([1]),
    customMetadata: { catalogId: 'private-song', title: 'Private', visibility: 'private', rightsCleared: 'false' },
    httpMetadata: { contentType: 'audio/mpeg' }
  });
  const listed = await onRequest(ctx(new Request('https://wrld.test/api/cloud-audio?list=1'), bucket));
  assert.deepEqual((await listed.json()).items.map(item => item.catalogId), ['song-1']);
  assert.equal(listed.headers.get('cache-control'), 'public, max-age=30');

  const ranged = await onRequest(ctx(new Request('https://wrld.test/api/cloud-audio?id=song-1', { headers: { Range: 'bytes=2-5' } }), bucket));
  assert.equal(ranged.status, 206);
  assert.equal(ranged.headers.get('content-range'), 'bytes 2-5/10');
  assert.equal(await ranged.text(), 'cdef');

  const invalid = await onRequest(ctx(new Request('https://wrld.test/api/cloud-audio?id=song-1', { headers: { Range: 'bytes=40-50' } }), bucket));
  assert.equal(invalid.status, 416);
  const privateAudio = await onRequest(ctx(new Request('https://wrld.test/api/cloud-audio?id=private-song'), bucket));
  assert.equal(privateAudio.status, 404);
});

test('cloud audio fails closed when R2 is not bound and rejects cross-origin requests', async () => {
  const request = new Request('https://wrld.test/api/cloud-audio?list=1');
  assert.equal((await onRequest({ request, env: {} })).status, 503);
  const crossOrigin = new Request('https://wrld.test/api/cloud-audio?list=1', { headers: { Origin: 'https://other.test' } });
  assert.equal((await onRequest(ctx(crossOrigin))).status, 403);
});
