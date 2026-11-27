const SONGS_URL = 'https://juicewrldapi.com/juicewrld/songs/?all=true&versions=true';
const CATEGORIES = new Set(['released', 'unreleased', 'unsurfaced']);

function cleanText(value, limit = 240) {
  return String(value ?? '')
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, limit);
}

function json(body, status = 200, extraHeaders = {}) {
  return new Response(status === 204 ? null : JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'public, max-age=300, s-maxage=900, stale-while-revalidate=3600',
      'access-control-allow-origin': '*',
      'access-control-allow-methods': 'GET, HEAD, OPTIONS',
      'access-control-allow-headers': 'Content-Type',
      'x-content-type-options': 'nosniff',
      ...extraHeaders
    }
  });
}

function metadataOnly(song) {
  if (!song || !CATEGORIES.has(song.category)) return null;
  const name = cleanText(song.name, 180);
  if (!name) return null;
  const era = typeof song.era === 'object' ? song.era?.name : song.era;
  return {
    id: song.id == null ? '' : String(song.id),
    public_id: song.public_id == null ? null : String(song.public_id),
    name,
    category: song.category,
    version_title: cleanText(song.version_title, 100),
    track_titles: Array.isArray(song.track_titles) ? song.track_titles.map(title => cleanText(title, 180)).filter(Boolean) : [],
    album: typeof song.album === 'string' ? cleanText(song.album, 180) : '',
    era: cleanText(era, 100),
    credited_artists: cleanText(song.credited_artists, 240),
    producers: cleanText(song.producers, 240),
    engineers: cleanText(song.engineers, 240),
    record_dates: cleanText(song.record_dates, 180),
    length: cleanText(song.length, 24),
    release_date: cleanText(song.release_date, 24),
    bpm: song.bpm == null ? '' : cleanText(song.bpm, 12),
    key: cleanText(song.key, 24)
  };
}

function normalizeSearch(value) {
  return cleanText(value, 120).normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
}

export async function onRequest({ request }) {
  if (request.method === 'OPTIONS') return json(null, 204);
  if (!['GET', 'HEAD'].includes(request.method)) return json({ error: 'Method not allowed.' }, 405, { allow: 'GET, HEAD, OPTIONS' });

  try {
    const upstream = await fetch(SONGS_URL, {
      headers: { accept: 'application/json' },
      cf: { cacheTtl: 900, cacheEverything: true }
    });
    if (!upstream.ok) return json({ error: 'The source catalog is temporarily unavailable.' }, 502);
    const source = await upstream.json();
    if (!Array.isArray(source)) return json({ error: 'The source catalog returned an unexpected response.' }, 502);

    const url = new URL(request.url);
    const category = url.searchParams.get('category') || '';
    if (category && !CATEGORIES.has(category)) return json({ error: 'Use category=released, unreleased, or unsurfaced.' }, 400);
    const query = normalizeSearch(url.searchParams.get('q') || '');
    let items = source.map(metadataOnly).filter(Boolean);
    if (category) items = items.filter(item => item.category === category);
    if (query) items = items.filter(item => normalizeSearch([
      item.name, item.version_title, item.track_titles.join(' '), item.album,
      item.credited_artists, item.producers, item.era
    ].join(' ')).includes(query));

    const total = items.length;
    const offsetParam = url.searchParams.get('offset');
    const limitParam = url.searchParams.get('limit');
    const offset = offsetParam == null ? 0 : Math.max(0, Math.min(100000, Number.parseInt(offsetParam, 10) || 0));
    const limit = limitParam == null ? total : Math.max(1, Math.min(5000, Number.parseInt(limitParam, 10) || 1));
    items = items.slice(offset, offset + limit);
    return json({ source: 'juicewrldapi', total, offset, count: items.length, items }, 200, { 'x-total-count': String(total) });
  } catch {
    return json({ error: 'The source catalog could not be reached.' }, 502);
  }
}

export { metadataOnly };
