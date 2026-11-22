const MUSIXMATCH_URL = 'https://api.musixmatch.com/ws/1.1/matcher.subtitle.get';
const MAX_CALLS_PER_WINDOW = 24;
const RATE_WINDOW_MS = 60_000;
const requestWindows = new Map();

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store, no-cache, must-revalidate',
      pragma: 'no-cache',
      'x-content-type-options': 'nosniff'
    }
  });
}

function clean(value, limit = 120) {
  return String(value || '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, limit);
}

function validTrackingUrl(value) {
  if (!value) return '';
  try {
    const url = new URL(value);
    if (url.hostname !== 'tracking.musixmatch.com' || !['http:', 'https:'].includes(url.protocol)) return '';
    url.protocol = 'https:';
    return url.href;
  } catch {
    return '';
  }
}

function takeRateLimit(ip, now = Date.now()) {
  const current = requestWindows.get(ip);
  if (!current || now - current.start >= RATE_WINDOW_MS) {
    requestWindows.set(ip, { start: now, count: 1 });
  } else {
    if (current.count >= MAX_CALLS_PER_WINDOW) return false;
    current.count += 1;
  }
  if (requestWindows.size > 2_000) {
    for (const [key, value] of requestWindows) {
      if (now - value.start >= RATE_WINDOW_MS) requestWindows.delete(key);
    }
  }
  return true;
}

function extractSubtitle(body) {
  const candidates = [
    body?.subtitle,
    body?.subtitle_list?.[0]?.subtitle,
    body?.subtitle_list?.[0],
    body?.track?.subtitle
  ];
  return candidates.find(item => typeof item?.subtitle_body === 'string') || null;
}

export async function onRequestGet({ request, env }) {
  const url = new URL(request.url);
  const origin = request.headers.get('Origin');
  if (origin && origin !== url.origin) return jsonResponse({ error: 'Cross-origin lyric lookup is not allowed.' }, 403);
  if (request.headers.get('X-WRLD-Archives') !== '1') return jsonResponse({ error: 'Use the WRLD Archives player to request lyrics.' }, 403);

  const title = clean(url.searchParams.get('title'));
  const artist = clean(url.searchParams.get('artist'));
  const album = clean(url.searchParams.get('album'));
  const duration = Number(url.searchParams.get('duration'));
  if (!title || !artist) return jsonResponse({ error: 'A song title and artist are required.' }, 400);
  if (!env?.MUSIXMATCH_API_KEY) return jsonResponse({ error: 'Musixmatch lookup is not configured on this host yet.' }, 503);

  const clientIp = request.headers.get('CF-Connecting-IP') || 'unknown';
  if (!takeRateLimit(clientIp)) return jsonResponse({ error: 'Too many lyric lookups. Wait a minute and try again.' }, 429);

  const params = new URLSearchParams({
    q_track: title,
    q_artist: artist,
    subtitle_format: 'lrc',
    apikey: env.MUSIXMATCH_API_KEY
  });
  if (album) params.set('q_album', album);
  if (Number.isFinite(duration) && duration >= 15 && duration <= 1_800) {
    params.set('f_subtitle_length', String(Math.round(duration)));
    params.set('f_subtitle_length_max_deviation', '25');
  }

  let upstream;
  try {
    upstream = await fetch(`${MUSIXMATCH_URL}?${params}`, { headers: { accept: 'application/json' } });
  } catch {
    return jsonResponse({ error: 'Musixmatch could not be reached. Try again shortly.' }, 502);
  }
  if (!upstream.ok) return jsonResponse({ error: upstream.status === 429 ? 'Musixmatch is rate limiting requests. Try again shortly.' : 'Musixmatch lookup failed.' }, upstream.status === 429 ? 429 : 502);

  let payload;
  try {
    payload = await upstream.json();
  } catch {
    return jsonResponse({ error: 'Musixmatch returned an unreadable response.' }, 502);
  }

  const message = payload?.message;
  const providerStatus = Number(message?.header?.status_code);
  if (providerStatus && providerStatus !== 200) {
    if (providerStatus === 404) return jsonResponse({ error: 'No timed lyrics are available for this track.' }, 404);
    if (providerStatus === 401 || providerStatus === 402 || providerStatus === 403) return jsonResponse({ error: 'The Musixmatch API key or plan does not allow this lookup.' }, 503);
    return jsonResponse({ error: 'Musixmatch lookup failed.' }, 502);
  }

  const body = message?.body || {};
  const subtitle = extractSubtitle(body);
  const lyrics = subtitle?.subtitle_body?.trim() || '';
  const copyright = clean(subtitle?.lyrics_copyright || body?.lyrics_copyright, 300);
  const trackingPixelUrl = validTrackingUrl(subtitle?.pixel_tracking_url || body?.pixel_tracking_url);
  const trackingScriptUrl = validTrackingUrl(subtitle?.script_tracking_url || body?.script_tracking_url);
  const restricted = Number(subtitle?.restricted ?? body?.restricted ?? 0);

  if (!lyrics || restricted === 1) return jsonResponse({ error: 'No timed lyrics are available for this track.' }, 404);
  if (!copyright || (!trackingPixelUrl && !trackingScriptUrl)) {
    return jsonResponse({ error: 'Musixmatch omitted required attribution data, so these lyrics cannot be displayed.' }, 502);
  }

  return jsonResponse({
    syncedLyrics: lyrics,
    copyright,
    trackingPixelUrl,
    trackingScriptUrl,
    provider: 'Musixmatch'
  });
}

export async function onRequest({ request, env }) {
  if (request.method === 'GET') return onRequestGet({ request, env });
  return jsonResponse({ error: 'Method not allowed.' }, 405);
}
