const audioExtension = /\.(?:mp3|m4a|mp4|flac|wav|aac|ogg|opus|aiff?|alac)$/i;

function fileKey(name, size) {
  const normalized = String(name || '')
    .normalize('NFKC')
    .toLowerCase()
    .trim()
    .replace(audioExtension, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
  return normalized && size > 0 ? `${normalized}|${size}` : '';
}

export function analyzeLibraryCheckup(tracks, fileChecks = {}) {
  const report = {
    checkedAudio: 0,
    fileIssues: [],
    formatWarnings: [],
    possibleDuplicates: [],
    missingCovers: [],
    missingLyrics: [],
    unmatchedDriveFiles: []
  };
  const duplicateGroups = new Map();

  for (const track of tracks) {
    if (track.status === 'local') report.unmatchedDriveFiles.push(track);
    if (!track.hasAudio && track.status !== 'local') continue;
    report.checkedAudio += 1;
    const check = fileChecks[track.id] || {};

    if (!track.hasAudio) {
      report.fileIssues.push({ track, reason: 'No audio file is linked to this drive entry.' });
    } else if (check.missing) {
      report.fileIssues.push({ track, reason: check.reason || 'The saved audio file could not be opened.' });
    } else if (check.size === 0) {
      report.fileIssues.push({ track, reason: 'The audio file is empty.' });
    } else {
      if (check.canPlay === false) {
        report.formatWarnings.push({ track, reason: `This browser may not support ${check.type || 'this audio format'}.` });
      }
      const key = fileKey(check.name, Number(check.size));
      if (key) {
        if (!duplicateGroups.has(key)) duplicateGroups.set(key, []);
        duplicateGroups.get(key).push({ track, name: check.name, size: Number(check.size) });
      }
    }

    if (!track.hasCover) report.missingCovers.push(track);
    if (!track.hasLyrics) report.missingLyrics.push(track);
  }

  report.possibleDuplicates = [...duplicateGroups.values()].filter(group => group.length > 1);
  return report;
}

export function summarizeListeningStats(tracks, stats = {}) {
  const rows = tracks.map(track => {
    const value = stats[track.id] || {};
    return {
      track,
      plays: Math.max(0, Number(value.plays) || 0),
      seconds: Math.max(0, Number(value.seconds) || 0),
      lastPlayed: Math.max(0, Number(value.lastPlayed) || 0)
    };
  }).filter(row => row.plays > 0 || row.seconds > 0);

  const albums = new Map();
  for (const row of rows) {
    const name = row.track.album || 'Singles & standalone tracks';
    const album = albums.get(name) || { name, plays: 0, seconds: 0 };
    album.plays += row.plays;
    album.seconds += row.seconds;
    albums.set(name, album);
  }

  return {
    totalPlays: rows.reduce((sum, row) => sum + row.plays, 0),
    totalSeconds: Math.round(rows.reduce((sum, row) => sum + row.seconds, 0)),
    uniqueTracks: rows.length,
    uniqueAlbums: albums.size,
    topTracks: [...rows].sort((a, b) => b.plays - a.plays || b.seconds - a.seconds || a.track.title.localeCompare(b.track.title)).slice(0, 10),
    topAlbums: [...albums.values()].sort((a, b) => b.plays - a.plays || b.seconds - a.seconds || a.name.localeCompare(b.name)).slice(0, 10)
  };
}
