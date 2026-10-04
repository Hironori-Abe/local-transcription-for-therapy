import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildPlaybackQueue,
  clampPlaybackTarget,
  clampTargetToRange,
  normalizePlaybackRange,
  expandShortPlaybackRange,
  resolveNextPlaybackSegment,
  resolveSegmentAtTime,
  resolveSequenceSeek,
  resolveShortcutTarget
} from './playback-state.ts';

const rows = [
  { id: 10, start: 1, end: 3, text: 'one' },
  { id: 20, start: 4, end: 6, text: 'two' },
  { id: 30, start: 6, end: 9, text: 'three' }
];

test('playback range normalizes invalid and too-short boundaries', () => {
  assert.deepEqual(normalizePlaybackRange({ id: 1, start: -2, end: 0.05 }), { start: 0, end: 0.1 });
  assert.deepEqual(normalizePlaybackRange({ id: 1, start: 3, end: 2 }), { start: 3, end: 3.1 });
  assert.deepEqual(normalizePlaybackRange({ id: 1, start: Number.NaN, end: Number.NaN }), { start: 0, end: 0.1 });
});

test('short loop ranges are padded on both sides without going before zero', () => {
  assert.deepEqual(expandShortPlaybackRange({ start: 10, end: 10.5 }), { start: 9.5, end: 11 });
  assert.deepEqual(expandShortPlaybackRange({ start: 0.2, end: 0.4 }), { start: 0, end: 1.5 });
  assert.deepEqual(expandShortPlaybackRange({ start: 3, end: 6 }), { start: 3, end: 6 });
});

test('playback queue starts at the requested visible row and loop mode has no queue', () => {
  assert.deepEqual(buildPlaybackQueue(rows, 20, false), { segmentIds: [20, 30], index: 0 });
  assert.deepEqual(buildPlaybackQueue(rows, 99, false), { segmentIds: [99], index: 0 });
  assert.deepEqual(buildPlaybackQueue(rows, 20, true), { segmentIds: [], index: -1 });
});

test('seek target clamps to audio duration and optional loop range', () => {
  assert.equal(clampPlaybackTarget(2, -5, 10), 0);
  assert.equal(clampPlaybackTarget(8, 5, 10), 10);
  assert.equal(clampPlaybackTarget(8, 5, Number.NaN), 13);
  assert.equal(clampTargetToRange(2, { start: 4, end: 6 }), 4);
  assert.equal(clampTargetToRange(9, { start: 4, end: 6 }), 6);
});

test('segment-at-time preserves existing gap and boundary selection semantics', () => {
  assert.equal(resolveSegmentAtTime(rows, 0)?.id, 10);
  assert.equal(resolveSegmentAtTime(rows, 2)?.id, 10);
  assert.equal(resolveSegmentAtTime(rows, 3.5)?.id, 10);
  assert.equal(resolveSegmentAtTime(rows, 4)?.id, 20);
  assert.equal(resolveSegmentAtTime(rows, 99)?.id, 30);
  assert.equal(resolveSegmentAtTime([], 2), null);
});

test('sequence seek rebuilds the queue from the resolved segment', () => {
  assert.deepEqual(resolveSequenceSeek(rows, 2, 3, 20), {
    targetSeconds: 5,
    segment: rows[1],
    queue: { segmentIds: [20, 30], index: 0 }
  });
  assert.equal(resolveSequenceSeek([], 2, 3, 20), null);
});

test('next playback resolution returns the next existing queue segment and range', () => {
  assert.deepEqual(resolveNextPlaybackSegment(rows, { segmentIds: [10, 20, 30], index: 0 }), {
    segment: rows[1],
    queueIndex: 1,
    range: { start: 4, end: 6 }
  });
  assert.equal(resolveNextPlaybackSegment(rows, { segmentIds: [10, 99], index: 0 }), null);
  assert.equal(resolveNextPlaybackSegment(rows, { segmentIds: [10], index: 0 }), null);
});

test('shortcut target prioritizes visible playing, focused, then first row', () => {
  assert.equal(resolveShortcutTarget(rows, 20, 30)?.id, 20);
  assert.equal(resolveShortcutTarget(rows, 99, 30)?.id, 30);
  assert.equal(resolveShortcutTarget(rows, 99, 88)?.id, 10);
  assert.equal(resolveShortcutTarget([], 20, 30), null);
});

import { PlaybackSession, playbackActionFor, type PlaybackSnapshot } from './playback-state.ts';

test('pause and resume keep the row, mode and a single shared button action', () => {
  const changes: PlaybackSnapshot[] = [];
  const session = new PlaybackSession(state => changes.push(state));
  for (const loop of [false, true]) {
    const loading = session.start(20, loop);
    assert.equal(session.actionFor(20, loop), 'pause');
    session.playing(loading);
    session.pause();
    assert.deepEqual(session.snapshot, { status: 'paused', segmentId: 20, loop });
    assert.equal(playbackActionFor(session.snapshot, 20, loop), 'resume');
    assert.equal(session.canPlay(loading), false);
    const resumed = session.resume();
    session.playing(resumed);
    assert.deepEqual(session.snapshot, { status: 'playing', segmentId: 20, loop });
    assert.equal(session.actionFor(20, loop), 'pause');
    assert.equal(session.actionFor(30, loop), 'start');
    assert.equal(session.actionFor(20, !loop), 'start');
    session.stop();
    assert.equal(session.actionFor(20, loop), 'start');
  }
  assert.ok(changes.some(state => state.status === 'paused'));
});

test('pausing during loading and stopping invalidate pending seek/play completion', () => {
  const session = new PlaybackSession();
  const first = session.start(10, false);
  session.pause();
  session.playing(first);
  assert.equal(session.snapshot.status, 'paused');
  const resumed = session.resume();
  const replacement = session.start(20, true);
  session.playing(resumed);
  assert.equal(session.snapshot.status, 'loading');
  session.playing(replacement);
  session.selectSegment(30);
  assert.equal(session.snapshot.segmentId, 30);
  session.stop();
  session.playing(replacement);
  assert.deepEqual(session.snapshot, { status: 'idle', segmentId: null, loop: false });
});

test('paused unfinished metadata/seek cannot be treated as a ready resume position', () => {
  const session = new PlaybackSession();
  const loading = session.start(20, false);
  session.pause();
  session.seekCompleted(loading);
  assert.equal(session.positionReady, false);
  const replacement = session.start(20, false);
  session.seekCompleted(replacement);
  session.playing(replacement);
  session.pause();
  assert.equal(session.positionReady, true);
  session.resume();
  const seek = session.beginSeek();
  session.pause();
  session.seekCompleted(seek);
  assert.equal(session.positionReady, false);
  session.stop();
  assert.equal(session.positionReady, false);
});
