import assert from 'node:assert/strict';
import test from 'node:test';
import { analyzeLibraryCheckup, fingerprintAudioBlob, nextLibraryTrack, summarizeListeningStats } from './library-tools.mjs';

test('checkup reports missing links, local extras, cover and lyric gaps, and format warnings', () => {
  const tracks = [
    { id: 'lost', title: 'Lost File', hasAudio: true, status: 'released', hasCover: false, hasLyrics: false },
    { id: 'empty', title: 'Empty File', hasAudio: true, status: 'local', hasCover: true, hasLyrics: true },
    { id: 'local', title: 'Unmatched Drive Song', hasAudio: true, status: 'local', hasCover: true, hasLyrics: true },
    { id: 'unsupported', title: 'Unsupported', hasAudio: true, status: 'released', hasCover: true, hasLyrics: true }
  ];
  const report = analyzeLibraryCheckup(tracks, {
    lost: { missing: true, reason: 'Drive permission is unavailable.' },
    empty: { size: 0 },
    local: { name: 'drive-demo.mp3', size: 500 },
    unsupported: { name: 'unsupported.ape', size: 900, canPlay: false, type: 'audio/ape' }
  });
  assert.equal(report.checkedAudio, 4);
  assert.deepEqual(report.fileIssues.map(issue => issue.track.id), ['lost', 'empty']);
  assert.deepEqual(report.formatWarnings.map(issue => issue.track.id), ['unsupported']);
  assert.deepEqual(report.missingCovers.map(track => track.id), ['lost']);
  assert.deepEqual(report.missingLyrics.map(track => track.id), ['lost']);
  assert.deepEqual(report.unmatchedDriveFiles.map(track => track.id), ['empty', 'local']);
});

test('checkup groups possible duplicate files by normalized filename and size', () => {
  const tracks = [
    { id: 'a', title: 'Song OG', hasAudio: true, status: 'released', hasCover: true, hasLyrics: true },
    { id: 'b', title: 'Song Copy', hasAudio: true, status: 'local', hasCover: true, hasLyrics: true },
    { id: 'c', title: 'Other', hasAudio: true, status: 'released', hasCover: true, hasLyrics: true }
  ];
  const report = analyzeLibraryCheckup(tracks, {
    a: { name: ' Song_OG.MP3 ', size: 1024 },
    b: { name: 'song og.wav', size: 1024 },
    c: { name: 'Other.mp3', size: 1024 }
  });
  assert.equal(report.possibleDuplicates.length, 1);
  assert.deepEqual(report.possibleDuplicates[0].map(item => item.track.id), ['a', 'b']);
});

test('replay summary aggregates local plays and listening time by song and album', () => {
  const tracks = [
    { id: 'a', title: 'A', album: 'Project One' },
    { id: 'b', title: 'B', album: 'Project One' },
    { id: 'c', title: 'C', album: 'Project Two' },
    { id: 'unused', title: 'Unused', album: 'Project Two' }
  ];
  const summary = summarizeListeningStats(tracks, {
    a: { plays: 4, seconds: 240, lastPlayed: 500 },
    b: { plays: 2, seconds: 45, lastPlayed: 400 },
    c: { plays: 1, seconds: 900, lastPlayed: 300 },
    missing: { plays: 99, seconds: 9999 }
  });
  assert.equal(summary.totalPlays, 7);
  assert.equal(summary.totalSeconds, 1185);
  assert.equal(summary.uniqueTracks, 3);
  assert.equal(summary.uniqueAlbums, 2);
  assert.equal(summary.topTracks[0].track.id, 'a');
  assert.deepEqual(summary.topAlbums.map(album => [album.name, album.plays]), [['Project One', 6], ['Project Two', 1]]);
});


test('chunked audio fingerprints match identical bytes and distinguish changed content', async () => {
  const first = new Blob(['same audio bytes']);
  const second = new Blob(['same audio bytes']);
  const changed = new Blob(['same audio byte!']);
  const options = { chunkSize: 4 };

  assert.equal(await fingerprintAudioBlob(first, options), await fingerprintAudioBlob(second, options));
  assert.notEqual(await fingerprintAudioBlob(first, options), await fingerprintAudioBlob(changed, options));
  assert.notEqual(await fingerprintAudioBlob(new Blob([]), options), await fingerprintAudioBlob(new Blob(['x']), options));
});


test('automatic next track advances and stops instead of replaying the last song', () => {
  const tracks = [{ id: 'a' }, { id: 'b' }];
  assert.equal(nextLibraryTrack(tracks, ''), tracks[0]);
  assert.equal(nextLibraryTrack(tracks, 'a'), tracks[1]);
  assert.equal(nextLibraryTrack(tracks, 'b'), null);
  assert.equal(nextLibraryTrack([tracks[0]], 'a'), null);
  assert.equal(nextLibraryTrack(tracks, 'a', true, () => 0), tracks[1]);
  assert.equal(nextLibraryTrack([tracks[0]], 'a', true), null);
});
