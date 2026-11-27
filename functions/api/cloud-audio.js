const MAX_UPLOAD_BYTES = 95 * 1024 * 1024;
const MAX_COVER_BYTES = 8 * 1024 * 1024;
const AUDIO_KEY_PREFIX = 'audio/';
const COVER_KEY_PREFIX = 'covers/';
const AUDIO_EXTENSIONS = /\.(mp3|m4a|mp4|flac|wav|aac|ogg|opus|aiff?|alac)$/i;
const COVER_EXTENSIONS = /\.(jpg|jpeg|png|webp|gif|avif)$/i;
const MIME_BY_EXTENSION = {
  mp3: 'audio/mpeg', m4a: 'audio/mp4', mp4: 'audio/mp4', flac: 'audio/flac',
  wav: 'audio/wav', aac: 'audio/aac', ogg: 'audio/ogg', opus: 'audio/ogg',
  aif: 'audio/aiff', aiff: 'audio/aiff', alac: 'audio/mp4'
};
const IMAGE_MIME_BY_EXTENSION = {
  jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp',
  gif: 'image/gif', avif: 'image/avif'
};
const IMAGE_MIME_TYPES = new Set(Object.values(IMAGE_MIME_BY_EXTENSION));

function json(body, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      'x-content-type-options': 'nosniff',
      ...extraHeaders
    }
  });
}

function clean(value, limit = 180) {
  return String(value || '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, limit);
}

function safeId(value) {
  return String(value || '').trim().replace(/[^a-zA-Z0-9._-]/g, '').slice(0, 120);
}

function secureEqual(left, right) {
  if (typeof left !== 'string' || typeof right !== 'string' || left.length !== right.length) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index++) difference |= left.charCodeAt(index) ^ right.charCodeAt(index);
  return difference === 0;
}

function sameOrigin(request, url) {
  const origin = request.headers.get('Origin');
  return !origin || origin === url.origin;
}

function adminAuthorized(request, env) {
  const secret = env?.WRLD_CLOUD_ADMIN_TOKEN;
  const authorization = request.headers.get('Authorization') || '';
  return typeof secret === 'string' && secret.length >= 24 && secureEqual(authorization, `Bearer ${secret}`);
}

function parseRange(value, size) {
  if (!value) return null;
  const match = String(value).match(/^bytes=(\d*)-(\d*)$/);
  if (!match || (!match[1] && !match[2]) || size <= 0) return false;
  let start;
  let end;
  if (!match[1]) {
    const suffix = Number(match[2]);
    if (!Number.isSafeInteger(suffix) || suffix <= 0) return false;
    start = Math.max(0, size - suffix);
    end = size - 1;
  } else {
    start = Number(match[1]);
    end = match[2] ? Number(match[2]) : size - 1;
    if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || start >= size || end < start) return false;
    end = Math.min(size - 1, end);
  }
  return { offset: start, length: end - start + 1, end };
}

function publicItem(object) {
  const metadata = object.customMetadata || {};
  if (metadata.visibility !== 'public' || metadata.rightsCleared !== 'true') return null;
  return {
    catalogId: metadata.catalogId || object.key.slice(AUDIO_KEY_PREFIX.length),
    sourceId: metadata.sourceId || '',
    title: metadata.title || 'Untitled track',
    version: metadata.version || '',
    album: metadata.album || '',
    artist: metadata.artist || 'Juice WRLD',
    contentType: object.httpMetadata?.contentType || 'application/octet-stream',
    size: object.size,
    etag: object.httpEtag || ''
  };
}

async function listPublicAudio(bucket) {
  const items = [];
  let cursor;
  for (let page = 0; page < 10; page++) {
    const result = await bucket.list({
      prefix: AUDIO_KEY_PREFIX,
      limit: 1000,
      include: ['customMetadata', 'httpMetadata'],
      ...(cursor ? { cursor } : {})
    });
    for (const object of result.objects || []) {
      const item = publicItem(object);
      if (item) items.push(item);
    }
    if (!result.truncated || !result.cursor) break;
    cursor = result.cursor;
  }
  return items;
}

async function handleGet(request, env, url, headOnly = false) {
  if (!env?.AUDIO_BUCKET) return json({ error: 'R2 storage is not connected to this Cloudflare Pages project yet.' }, 503);
  if (url.searchParams.has('cover')) {
    const coverId = safeId(url.searchParams.get('cover'));
    if (!coverId) return json({ error: 'A cover id is required.' }, 400);
    return handleGetCover(env, coverId, headOnly);
  }
  const catalogId = safeId(url.searchParams.get('id'));
  if (url.searchParams.get('list') === '1') {
    const items = await listPublicAudio(env.AUDIO_BUCKET);
    return json({ items }, 200, { 'cache-control': 'public, max-age=30' });
  }
  if (!catalogId) return json({ error: 'A catalog track id or list=1 is required.' }, 400);
  const key = `${AUDIO_KEY_PREFIX}${catalogId}`;
  const head = await env.AUDIO_BUCKET.head(key);
  if (!head || head.customMetadata?.visibility !== 'public' || head.customMetadata?.rightsCleared !== 'true') {
    return json({ error: 'This audio is not publicly available.' }, 404);
  }

  const rangeHeader = request.headers.get('Range');
  const range = parseRange(rangeHeader, head.size);
  if (range === false) return new Response(null, {
    status: 416,
    headers: { 'content-range': `bytes */${head.size}`, 'accept-ranges': 'bytes', 'cache-control': 'no-store' }
  });
  const object = await env.AUDIO_BUCKET.get(key, range ? { range: { offset: range.offset, length: range.length } } : undefined);
  if (!object) return json({ error: 'This audio is not publicly available.' }, 404);
  const headers = new Headers();
  object.writeHttpMetadata(headers);
  headers.set('content-type', object.httpMetadata?.contentType || head.httpMetadata?.contentType || 'application/octet-stream');
  headers.set('content-length', String(range ? range.length : object.size));
  headers.set('accept-ranges', 'bytes');
  headers.set('cache-control', 'public, max-age=900');
  headers.set('x-content-type-options', 'nosniff');
  if (object.httpEtag) headers.set('etag', object.httpEtag);
  if (range) headers.set('content-range', `bytes ${range.offset}-${range.end}/${head.size}`);
  return new Response(headOnly ? null : object.body, { status: range ? 206 : 200, headers });
}

async function handleGetCover(env, coverId, headOnly = false) {
  const key = `${COVER_KEY_PREFIX}${coverId}`;
  const head = await env.AUDIO_BUCKET.head(key);
  if (!head || head.customMetadata?.visibility !== 'public' || head.customMetadata?.coverRightsConfirmed !== 'true') {
    return json({ error: 'This cover is not publicly available.' }, 404);
  }
  const object = headOnly ? null : await env.AUDIO_BUCKET.get(key);
  if (!headOnly && !object) return json({ error: 'This cover is not publicly available.' }, 404);
  const headers = new Headers();
  if (object) object.writeHttpMetadata(headers);
  const contentType = object?.httpMetadata?.contentType || head.httpMetadata?.contentType || 'application/octet-stream';
  if (!IMAGE_MIME_TYPES.has(contentType)) return json({ error: 'This cover has an unsupported image type.' }, 415);
  headers.set('content-type', contentType);
  headers.set('content-length', String(head.size));
  headers.set('cache-control', 'public, max-age=86400, immutable');
  headers.set('x-content-type-options', 'nosniff');
  if (object?.httpEtag || head.httpEtag) headers.set('etag', object?.httpEtag || head.httpEtag);
  return new Response(headOnly ? null : object.body, { status: 200, headers });
}

async function handleUpload(request, env, url) {
  if (!sameOrigin(request, url)) return json({ error: 'Cross-origin uploads are not allowed.' }, 403);
  if (request.headers.get('X-WRLD-Archives') !== '1') return json({ error: 'Use WRLD Archives to upload audio.' }, 403);
  if (!adminAuthorized(request, env)) return json({ error: 'The Cloud audio admin token is missing or incorrect.' }, 401);
  if (!env?.AUDIO_BUCKET) return json({ error: 'R2 storage is not connected to this Cloudflare Pages project yet.' }, 503);

  const contentLength = Number(request.headers.get('Content-Length'));
  if (Number.isFinite(contentLength) && contentLength > MAX_UPLOAD_BYTES + 512_000) {
    return json({ error: 'Each upload must be smaller than 95 MB.' }, 413);
  }
  let form;
  try { form = await request.formData(); } catch { return json({ error: 'The upload form could not be read.' }, 400); }
  if (form.get('kind') === 'cover') return handleCoverUpload(form, env);
  const file = form.get('file');
  const fileName = clean(file?.name, 240);
  if (!(file instanceof File) || !file.size || !AUDIO_EXTENSIONS.test(fileName)) {
    return json({ error: 'Choose an audio file in a supported format.' }, 400);
  }
  if (file.size > MAX_UPLOAD_BYTES) return json({ error: 'Each upload must be smaller than 95 MB.' }, 413);
  if (form.get('rightsConfirmed') !== 'yes') {
    return json({ error: 'Confirm that you own the recording or have explicit distribution permission before publishing.' }, 400);
  }
  const catalogId = safeId(form.get('catalogId'));
  const title = clean(form.get('title'));
  if (!catalogId || !title) return json({ error: 'A stable catalog id and song title are required.' }, 400);
  const extension = fileName.split('.').pop().toLowerCase();
  const contentType = file.type?.startsWith('audio/') || file.type === 'video/mp4'
    ? file.type
    : MIME_BY_EXTENSION[extension] || 'application/octet-stream';
  const metadata = {
    catalogId,
    sourceId: safeId(form.get('sourceId')),
    title,
    version: clean(form.get('version'), 100),
    album: clean(form.get('album'), 180),
    artist: clean(form.get('artist'), 180) || 'Juice WRLD',
    fileName,
    visibility: 'public',
    rightsCleared: 'true'
  };
  const key = `${AUDIO_KEY_PREFIX}${catalogId}`;
  await env.AUDIO_BUCKET.put(key, file.stream(), {
    httpMetadata: { contentType, contentDisposition: 'inline', cacheControl: 'public, max-age=900' },
    customMetadata: metadata
  });
  return json({ ok: true, catalogId, title, size: file.size });
}

async function handleCoverUpload(form, env) {
  const file = form.get('file');
  const fileName = clean(file?.name, 240);
  if (!(file instanceof File) || !file.size || file.size > MAX_COVER_BYTES || !COVER_EXTENSIONS.test(fileName)) {
    return json({ error: 'Choose a supported cover image smaller than 8 MB.' }, file?.size > MAX_COVER_BYTES ? 413 : 400);
  }
  if (form.get('coverRightsConfirmed') !== 'yes') {
    return json({ error: 'Confirm that you have permission to make this cover image publicly available.' }, 400);
  }
  const catalogId = safeId(form.get('catalogId'));
  if (!catalogId) return json({ error: 'A stable cover id is required.' }, 400);
  const extension = fileName.split('.').pop().toLowerCase();
  const contentType = IMAGE_MIME_TYPES.has(file.type?.toLowerCase())
    ? file.type.toLowerCase()
    : IMAGE_MIME_BY_EXTENSION[extension];
  if (!contentType) return json({ error: 'Choose a JPEG, PNG, WebP, GIF, or AVIF cover.' }, 400);
  const key = `${COVER_KEY_PREFIX}${catalogId}`;
  await env.AUDIO_BUCKET.put(key, file.stream(), {
    httpMetadata: { contentType, contentDisposition: 'inline', cacheControl: 'public, max-age=86400, immutable' },
    customMetadata: {
      catalogId,
      title: clean(form.get('title'), 180),
      album: clean(form.get('album'), 180),
      visibility: 'public',
      coverRightsConfirmed: 'true'
    }
  });
  return json({ ok: true, catalogId, size: file.size });
}

export async function onRequest({ request, env }) {
  const url = new URL(request.url);
  const publicCoverRead = ['GET', 'HEAD'].includes(request.method) && url.searchParams.has('cover');
  if (!sameOrigin(request, url) && !publicCoverRead) return json({ error: 'Cross-origin requests are not allowed.' }, 403);
  try {
    if (request.method === 'GET') return await handleGet(request, env, url);
    if (request.method === 'HEAD') return await handleGet(request, env, url, true);
    if (request.method === 'POST') return await handleUpload(request, env, url);
    return json({ error: 'Method not allowed.' }, 405, { allow: 'GET, HEAD, POST' });
  } catch {
    return json({ error: 'Cloud audio storage could not complete this request.' }, 500);
  }
}

export { parseRange, publicItem, safeId };
