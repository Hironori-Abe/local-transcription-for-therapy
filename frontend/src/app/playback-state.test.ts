import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildPlaybackQueue,
  clampPlaybackTarget,
  clampTargetToRange,
  normalizePlaybackRange,
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
