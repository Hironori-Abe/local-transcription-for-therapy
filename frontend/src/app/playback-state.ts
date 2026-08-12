export interface PlaybackSegment {
  id: number;
  start: number;
  end: number;
}

export interface PlaybackRange {
  start: number;
  end: number;
}

export interface PlaybackQueue {
  segmentIds: number[];
  index: number;
}

export interface PlaybackSeekResolution<T extends PlaybackSegment> {
  targetSeconds: number;
  segment: T;
  queue: PlaybackQueue;
}

export interface PlaybackAdvanceResolution<T extends PlaybackSegment> {
  segment: T;
  queueIndex: number;
  range: PlaybackRange;
}

export function normalizePlaybackRange(segment: PlaybackSegment): PlaybackRange {
  const start = Number.isFinite(segment.start) ? Math.max(0, segment.start) : 0;
  const rawEnd = Number.isFinite(segment.end) ? segment.end : start;
  return { start, end: Math.max(start + 0.1, rawEnd) };
}

export function buildPlaybackQueue(
  rows: ReadonlyArray<PlaybackSegment>,
  startSegmentId: number,
  loopEnabled: boolean
): PlaybackQueue {
  if (loopEnabled) return { segmentIds: [], index: -1 };
  const ids = rows.map((row) => row.id);
  const index = ids.indexOf(startSegmentId);
  return { segmentIds: index >= 0 ? ids.slice(index) : [startSegmentId], index: 0 };
}

export function clampPlaybackTarget(
  currentSeconds: number,
  deltaSeconds: number,
  durationSeconds: number
): number {
  const current = Number.isFinite(currentSeconds) ? currentSeconds : 0;
  const delta = Number.isFinite(deltaSeconds) ? deltaSeconds : 0;
  const target = Math.max(0, current + delta);
  return Number.isFinite(durationSeconds) && durationSeconds > 0
    ? Math.min(target, durationSeconds)
    : target;
}

export function clampTargetToRange(targetSeconds: number, range: PlaybackRange): number {
  return Math.min(Math.max(targetSeconds, range.start), range.end);
}

/** 対象秒を含む行を選ぶ。隙間では直前行、先頭以前では先頭、末尾以降では末尾を返す。 */
export function resolveSegmentAtTime<T extends PlaybackSegment>(
  rows: ReadonlyArray<T>,
  targetSeconds: number
): T | null {
  if (rows.length === 0) return null;
  let resolved: T | null = null;
  for (const row of rows) {
    if (row.start > targetSeconds) break;
    resolved = row;
    if (targetSeconds < row.end) break;
  }
  return resolved ?? rows[0];
}

export function resolveSequenceSeek<T extends PlaybackSegment>(
  rows: ReadonlyArray<T>,
  currentSeconds: number,
  deltaSeconds: number,
  durationSeconds: number
): PlaybackSeekResolution<T> | null {
  const targetSeconds = clampPlaybackTarget(currentSeconds, deltaSeconds, durationSeconds);
  const segment = resolveSegmentAtTime(rows, targetSeconds);
  if (!segment) return null;
  return {
    targetSeconds,
    segment,
    queue: buildPlaybackQueue(rows, segment.id, false)
  };
}

export function resolveNextPlaybackSegment<T extends PlaybackSegment>(
  rows: ReadonlyArray<T>,
  queue: PlaybackQueue
): PlaybackAdvanceResolution<T> | null {
  if (queue.segmentIds.length === 0 || queue.index < 0) return null;
  const nextIndex = queue.index + 1;
  if (nextIndex >= queue.segmentIds.length) return null;
  const segment = rows.find((row) => row.id === queue.segmentIds[nextIndex]);
  if (!segment) return null;
  return { segment, queueIndex: nextIndex, range: normalizePlaybackRange(segment) };
}

export function resolveShortcutTarget<T extends PlaybackSegment>(
  rows: ReadonlyArray<T>,
  playingSegmentId: number | null,
  focusedSegmentId: number | null
): T | null {
  if (rows.length === 0) return null;
  if (playingSegmentId !== null) {
    const playing = rows.find((row) => row.id === playingSegmentId);
    if (playing) return playing;
  }
  if (focusedSegmentId !== null) {
    const focused = rows.find((row) => row.id === focusedSegmentId);
    if (focused) return focused;
  }
  return rows[0];
}
