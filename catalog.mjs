const SUPPORTED_CATEGORIES = new Set(['released', 'unreleased', 'unsurfaced']);
const PROJECT_ALBUMS = new Map([
  ['too many|v1', 'The Outsiders'],
  ['off the rip|v1', 'The Outsiders'],
]);

export function normalizeCatalogKey(value) {
  return String(value ?? '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

export function catalogTrackKey(track) {
  return `${normalizeCatalogKey(track.title)}|${normalizeCatalogKey(track.version)}`;
}

export function normalizeApiSong(song) {
  if (!song || !SUPPORTED_CATEGORIES.has(song.category)) return null;
  const rawTitle = String(song.name || song.track_titles?.[0] || '').trim();
  if (!rawTitle) return null;

  const versionMatch = rawTitle.match(/\s*[[(](v\d+(?:\.\d+)?)[\])]\s*$/i);
  const title = rawTitle.replace(/\s*[[(]v\d+(?:\.\d+)?[\])]\s*$/i, '').trim();
  const version = String(song.version_title || versionMatch?.[1] || '');
  const versionKey = normalizeCatalogKey(version);
  const album = PROJECT_ALBUMS.get(`${normalizeCatalogKey(title)}|${versionKey}`) || String(song.album || '').trim();
  const era = typeof song.era === 'object' ? song.era?.name : song.era;
  const status = song.category === 'released' ? 'released' : 'unreleased';

  return {
    title,
    version,
    status,
    leakStatus: song.category === 'unsurfaced' ? 'unleaked' : 'leaked',
    source: 'juicewrldapi',
    sourceId: song.id == null ? '' : String(song.id),
    sourceCategory: String(song.category),
    album,
    era: String(era || ''),
    altTitles: Array.isArray(song.track_titles) ? song.track_titles : [],
    features: String(song.credited_artists || ''),
    producers: String(song.producers || ''),
    engineers: String(song.engineers || ''),
    recorded: String(song.record_dates || ''),
    duration: String(song.length || ''),
    releaseDate: String(song.release_date || ''),
    bpm: song.bpm == null ? '' : String(song.bpm),
    key: String(song.key || ''),
  };
}

export function mergeApiCatalog(existingTracks, apiSongs, createId = () => crypto.randomUUID()) {
  const tracks = existingTracks.map(track => ({ ...track }));
  const existing = new Map(tracks.map((track, index) => [catalogTrackKey(track), index]));
  let added = 0;
  let updated = 0;

  for (const apiSong of apiSongs) {
    const normalized = normalizeApiSong(apiSong);
    if (!normalized) continue;
    const key = catalogTrackKey(normalized);

    if (existing.has(key)) {
      const track = tracks[existing.get(key)];
      if (track.status !== normalized.status) {
        track.status = normalized.status;
        updated++;
      }
      if (track.source !== normalized.source || track.sourceId !== normalized.sourceId) {
        track.source = normalized.source;
        track.sourceId = normalized.sourceId;
        updated++;
      }
      if (track.sourceCategory !== normalized.sourceCategory) {
        track.sourceCategory = normalized.sourceCategory;
        updated++;
      }
      const leakStatus = track.remaster ? 'unleaked' : normalized.leakStatus;
      if (normalized.status === 'unreleased' && track.leakStatus !== leakStatus) {
        track.leakStatus = leakStatus;
        updated++;
      }
      for (const [field, value] of Object.entries(normalized)) {
        if (['title', 'version', 'status', 'leakStatus', 'source', 'sourceId', 'sourceCategory'].includes(field)) continue;
        const empty = !track[field] || (Array.isArray(track[field]) && track[field].length === 0);
        const authoritativeAlbum = field === 'album' && normalized.status === 'unreleased' && value;
        if (value && (authoritativeAlbum ? track[field] !== value : empty)) {
          track[field] = value;
          updated++;
        }
      }
      continue;
    }

    const track = {
      id: createId(),
      ...normalized,
      single: false,
      year: normalized.releaseDate ? normalized.releaseDate.slice(0, 4) : '',
      url: '',
      hasAudio: false,
      notes: '',
    };
    tracks.push(track);
    existing.set(key, tracks.length - 1);
    added++;
  }

  return { tracks, added, updated };
}

export function filterCatalogTracks(tracks, options = {}) {
  const {
    query = '', status = 'all', leakStatus = 'all', favoriteOnly = false,
    album = '', singlesOnly = false, remastersOnly = false, sortMode = 'az',
  } = options;
  const normalizedQuery = normalizeCatalogKey(query);
  const matches = tracks.filter(track => {
    const group = track.album || (track.status === 'unreleased' ? 'Unreleased' : 'Other released');
    if (status !== 'all' && track.status !== status) return false;
    if (leakStatus !== 'all' && !(track.status === 'unreleased' && (track.leakStatus || 'leaked') === leakStatus)) return false;
    if (album && group !== album) return false;
    if (favoriteOnly && !track.favorite) return false;
    if (singlesOnly && !track.single) return false;
    if (remastersOnly && !track.remaster) return false;
    if (!normalizedQuery) return true;
    const haystack = normalizeCatalogKey([
      track.title, track.album, track.version, track.altTitles, track.producers,
      track.engineers, track.features, track.era,
    ].join(' '));
    return haystack.includes(normalizedQuery);
  });

  const compareTitle = (a, b) => a.title.localeCompare(b.title, undefined, { sensitivity: 'base', numeric: true });
  matches.sort((a, b) => {
    if (sortMode === 'za') return compareTitle(b, a);
    if (sortMode === 'year') return String(a.year || '9999').localeCompare(String(b.year || '9999'));
    if (sortMode === 'favorites') return Number(!!b.favorite) - Number(!!a.favorite) || compareTitle(a, b);
    return compareTitle(a, b);
  });
  return matches;
}
