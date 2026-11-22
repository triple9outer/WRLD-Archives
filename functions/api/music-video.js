const YOUTUBE_SEARCH_URL = 'https://www.googleapis.com/youtube/v3/search';
const MAX_CALLS_PER_WINDOW = 30;
const RATE_WINDOW_MS = 60_000;
const requestWindows = new Map();
const NON_VIDEO_TITLE = /\b(?:lyrics?|unreleased|leak(?:ed)?|snippet|nightcore|sped\s*up|slowed|reaction|fan.?made|remix|cover)\b/i;
const OFFICIAL_CHANNEL = /juice\s*wrld|juicewrld|vevo|grade\s*a|interscope|lyrical\s*lemonade|halsey|marshmello|eminem|benny\s*blanco|future/i;

function json(body, status = 200, cacheControl = 'no-store') {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': cacheControl,
      'x-content-type-options': 'nosniff'
    }
  });
}

function clean(value, limit = 140) {
  return String(value || '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, limit);
}

function normalize(value) {
  return clean(value, 240).normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

function takeRateLimit(ip, now = Date.now()) {
  const current = requestWindows.get(ip);
  if (!current || now - current.start >= RATE_WINDOW_MS) requestWindows.set(ip, { start: now, count: 1 });
  else {
    if (current.count >= MAX_CALLS_PER_WINDOW) return false;
    current.count++;
  }
  if (requestWindows.size > 2_000) {
    for (const [key, value] of requestWindows) if (now - value.start >= RATE_WINDOW_MS) requestWindows.delete(key);
  }
  return true;
}

function chooseOfficialVideo(items, title) {
  const normalizedTitle = normalize(title);
  const words = normalizedTitle.split(' ').filter(word => word.length > 1);
  const candidates = (Array.isArray(items) ? items : []).filter(item => {
    const videoId = item?.id?.videoId;
    const videoTitle = clean(item?.snippet?.title, 240);
    const channel = clean(item?.snippet?.channelTitle, 160);
    const normalizedVideoTitle = normalize(videoTitle);
    const titleMatch = normalizedTitle && (normalizedVideoTitle.includes(normalizedTitle) || words.filter(word => normalizedVideoTitle.includes(word)).length >= Math.max(1, Math.ceil(words.length * 0.7)));
    return /^[a-zA-Z0-9_-]{11}$/.test(String(videoId || '')) && titleMatch && !NON_VIDEO_TITLE.test(videoTitle) && OFFICIAL_CHANNEL.test(channel);
  });
  candidates.sort((a, b) => {
    const score = item => {
      const name = clean(item?.snippet?.title, 240);
      return (normalize(name).includes(normalizedTitle) ? 4 : 0) + (/official|music video/i.test(name) ? 2 : 0);
    };
    return score(b) - score(a);
  });
  const match = candidates[0];
  if (!match) return null;
  return { videoId: match.id.videoId, title: clean(match.snippet.title, 240), channel: clean(match.snippet.channelTitle, 160) };
}

export async function onRequestGet({ request, env, caches: runtimeCaches }) {
  const url = new URL(request.url);
  const origin = request.headers.get('Origin');
  if (origin && origin !== url.origin) return json({ error: 'Cross-origin video lookup is not allowed.' }, 403);
  if (request.headers.get('X-WRLD-Archives') !== '1') return json({ error: 'Use the WRLD Archives player to look up a video.' }, 403);
  if (url.searchParams.get('status') !== 'released') return json({ error: 'Video backgrounds are only looked up for released catalog entries.' }, 400);

  const title = clean(url.searchParams.get('title'));
  if (!title) return json({ error: 'A song title is required.' }, 400);
  if (!env?.YOUTUBE_DATA_API_KEY) return json({ error: 'Automatic YouTube lookup is not configured on this host yet.' }, 503);

  const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
  if (!takeRateLimit(ip)) return json({ error: 'Too many video lookups. Try again in a minute.' }, 429);

  const cache = runtimeCaches?.default;
  const cacheUrl = new URL('/api/music-video', url.origin);
  cacheUrl.searchParams.set('title', normalize(title));
  cacheUrl.searchParams.set('status', 'released');
  const cacheKey = new Request(cacheUrl.toString(), { method: 'GET' });
  if (cache) {
    const cached = await cache.match(cacheKey);
    if (cached) return cached;
  }

  const params = new URLSearchParams({
    part: 'snippet',
    type: 'video',
    videoEmbeddable: 'true',
    videoSyndicated: 'true',
    safeSearch: 'strict',
    maxResults: '10',
    q: `Juice WRLD ${title} official music video`,
    key: env.YOUTUBE_DATA_API_KEY
  });
  let upstream;
  try {
    upstream = await fetch(`${YOUTUBE_SEARCH_URL}?${params}`, { headers: { accept: 'application/json' } });
  } catch {
    return json({ error: 'YouTube search could not be reached. Try again shortly.' }, 502);
  }
  if (!upstream.ok) return json({ error: upstream.status === 403 ? 'The YouTube API key or quota does not allow this lookup.' : 'YouTube search failed.' }, upstream.status === 403 ? 503 : 502);

  let payload;
  try { payload = await upstream.json(); } catch { return json({ error: 'YouTube returned an unreadable response.' }, 502); }
  const video = chooseOfficialVideo(payload?.items, title);
  const response = json({ video, provider: 'YouTube' }, 200, 'public, max-age=3600, s-maxage=86400');
  if (cache) await cache.put(cacheKey, response.clone());
  return response;
}

export async function onRequest({ request, env, caches }) {
  if (request.method === 'GET') return onRequestGet({ request, env, caches });
  return json({ error: 'Method not allowed.' }, 405, 'no-store');
}

export { chooseOfficialVideo, normalize };
