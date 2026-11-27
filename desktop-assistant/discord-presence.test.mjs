import test from 'node:test';
import assert from 'node:assert/strict';
import { encodeRpcFrame, sanitizePresenceTrack } from './discord-presence.mjs';

test('Rich Presence hides unreleased song titles when the privacy toggle is off', () => {
  const activity = sanitizePresenceTrack({
    title: 'Secret Demo',
    album: 'Outsiders',
    version: 'V2',
    status: 'unreleased',
    playing: true,
    position: 15,
    duration: 180,
  }, { showUnreleased: false, now: 1_000_000 });

  assert.equal(activity.details, 'Unreleased song');
  assert.equal(activity.state, 'Juice WRLD · Outsiders');
  assert.equal(activity.timestamps.start, 985);
  assert.equal(activity.timestamps.end, 1165);
});

test('Rich Presence includes the track title when sharing unreleased titles is enabled', () => {
  const activity = sanitizePresenceTrack({ title: 'Secret Demo', status: 'unreleased', playing: false }, { showUnreleased: true });
  assert.equal(activity.details, 'Secret Demo');
  assert.match(activity.state, /Paused/);
  assert.equal('timestamps' in activity, false);
});

test('RPC frames use Discord little-endian headers and UTF-8 JSON payloads', () => {
  const frame = encodeRpcFrame(1, { cmd: 'SET_ACTIVITY', args: { activity: null }, nonce: 'test' });
  assert.equal(frame.readUInt32LE(0), 1);
  assert.equal(frame.readUInt32LE(4), frame.length - 8);
  assert.deepEqual(JSON.parse(frame.subarray(8).toString('utf8')), { cmd: 'SET_ACTIVITY', args: { activity: null }, nonce: 'test' });
});
