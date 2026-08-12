export interface SegmentTextEdit {
  before: string;
  after: string;
  afterCaret: number;
  inputKind: string;
}

interface SegmentTextHistoryEntry extends SegmentTextEdit {
  beforeCaret: number;
  timestamp: number;
}

interface SegmentTextHistory {
  undo: SegmentTextHistoryEntry[];
  redo: SegmentTextHistoryEntry[];
}

export interface SegmentTextHistoryTransition {
  value: string;
  caret: number;
}

export interface InsertTextResult {
  text: string;
  caret: number;
}

export interface TextRow {
  id: number;
  text: string;
}

export interface StructuralTranscriptSegment<Word = unknown> extends TextRow {
  start: number;
  end: number;
  speaker?: string | null;
  words?: Word[];
}

export interface SegmentStructureMaps<Metadata> {
  editedTextById: Readonly<Record<number, string>>;
  hiddenById: Readonly<Record<number, boolean>>;
  speakerById: Readonly<Record<number, string>>;
  proofreadHintById: Readonly<Record<number, string>>;
  proofreadMetadataById: Readonly<Record<number, Metadata>>;
}

export interface SegmentStructureResult<Word, Metadata> {
  segments: StructuralTranscriptSegment<Word>[];
  transcriptText: string;
  editedTextById: Record<number, string>;
  hiddenById: Record<number, boolean>;
  speakerById: Record<number, string>;
  proofreadHintById: Record<number, string>;
  proofreadMetadataById: Record<number, Metadata>;
  createdIds: number[];
}

export interface ApplyTextUpdatesResult<T> {
  rows: T[];
  changed: boolean;
}

export function splitTextAtSentenceEndings(text: string, japanese: boolean): string[] {
  const tokens = text.split(japanese ? /(。|？|！)/ : /([.?!]+)(?=\s|$)/);
  const parts: string[] = [];
  for (let index = 0; index < tokens.length; index += 2) {
    const combined = japanese
      ? tokens[index] + (tokens[index + 1] ?? '')
      : (tokens[index] + (tokens[index + 1] ?? '')).trim();
    if (combined.length > 0) {
      parts.push(combined);
    }
  }
  return parts;
}

export function buildVisibleTranscriptText(
  rows: ReadonlyArray<TextRow>,
  hiddenById: Readonly<Record<number, boolean>>,
  editedTextById: Readonly<Record<number, string>>
): string {
  return rows
    .filter((row) => !hiddenById[row.id])
    .map((row) => typeof editedTextById[row.id] === 'string' ? editedTextById[row.id] : row.text)
    .join(' ')
    .trim();
}

export function nextSegmentId(rows: ReadonlyArray<{ id: number }>): number {
  if (rows.length === 0) return 0;
  return rows.reduce((highest, row) => Math.max(highest, row.id), rows[0].id) + 1;
}

export function insertSegmentRelative<Word, Metadata>(
  rows: ReadonlyArray<StructuralTranscriptSegment<Word>>,
  sourceId: number,
  position: 'above' | 'below',
  sourceEditableText: string,
  maps: SegmentStructureMaps<Metadata>
): SegmentStructureResult<Word, Metadata> | null {
  const sourceIndex = rows.findIndex((row) => row.id === sourceId);
  if (sourceIndex < 0) return null;
  const source = rows[sourceIndex];
  const createdId = nextSegmentId(rows);
  const created: StructuralTranscriptSegment<Word> = {
    id: createdId,
    start: source.start,
    end: source.end,
    text: sourceEditableText,
    speaker: null
  };
  const segments = [...rows];
  segments.splice(position === 'above' ? sourceIndex : sourceIndex + 1, 0, created);
  return finalizeStructuralEdit(segments, [createdId], maps, {
    editedTextById: { [createdId]: sourceEditableText },
    speakerById: { [createdId]: '' }
  });
}

export function splitSegmentAtSentenceEndings<Word, Metadata>(
  rows: ReadonlyArray<StructuralTranscriptSegment<Word>>,
  sourceId: number,
  sourceEditableText: string,
  assignedSpeaker: string,
  japanese: boolean,
  maps: SegmentStructureMaps<Metadata>
): SegmentStructureResult<Word, Metadata> | null {
  const sourceIndex = rows.findIndex((row) => row.id === sourceId);
  if (sourceIndex < 0) return null;
  const parts = splitTextAtSentenceEndings(sourceEditableText, japanese);
  if (parts.length <= 1) return null;

  const source = rows[sourceIndex];
  let createdId = nextSegmentId(rows);
  const created = parts.slice(1).map((text) => ({
    id: createdId++,
    start: source.start,
    end: source.end,
    text,
    speaker: source.speaker
  } satisfies StructuralTranscriptSegment<Word>));
  const segments = [...rows];
  segments.splice(sourceIndex + 1, 0, ...created);
  const editedTextById: Record<number, string> = { [sourceId]: parts[0] };
  const speakerById: Record<number, string> = {};
  for (const segment of created) {
    editedTextById[segment.id] = segment.text;
    speakerById[segment.id] = assignedSpeaker;
  }
  const result = finalizeStructuralEdit(
    segments,
    created.map((segment) => segment.id),
    maps,
    { editedTextById, speakerById }
  );
  // 元行も本文が変わるため、分割前の校正根拠は無効になる。
  delete result.proofreadHintById[sourceId];
  delete result.proofreadMetadataById[sourceId];
  return result;
}

function finalizeStructuralEdit<Word, Metadata>(
  segments: StructuralTranscriptSegment<Word>[],
  createdIds: number[],
  maps: SegmentStructureMaps<Metadata>,
  additions: {
    editedTextById: Readonly<Record<number, string>>;
    speakerById: Readonly<Record<number, string>>;
  }
): SegmentStructureResult<Word, Metadata> {
  const editedTextById = { ...maps.editedTextById, ...additions.editedTextById };
  const hiddenById = { ...maps.hiddenById };
  const speakerById = { ...maps.speakerById, ...additions.speakerById };
  const proofreadHintById = { ...maps.proofreadHintById };
  const proofreadMetadataById = { ...maps.proofreadMetadataById };
  for (const id of createdIds) {
    delete hiddenById[id];
    delete proofreadHintById[id];
    delete proofreadMetadataById[id];
  }
  return {
    segments,
    transcriptText: buildVisibleTranscriptText(segments, hiddenById, editedTextById),
    editedTextById,
    hiddenById,
    speakerById,
    proofreadHintById,
    proofreadMetadataById,
    createdIds
  };
}

export function coalescingInputKind(inputKind: string): string {
  if (inputKind === 'insertText' || inputKind === 'insertCompositionText') {
    return 'typing';
  }
  if (inputKind === 'deleteContentBackward') {
    return 'delete-backward';
  }
  if (inputKind === 'deleteContentForward') {
    return 'delete-forward';
  }
  return '';
}

export function changedRangeEnd(before: string, after: string): number {
  const maxPrefix = Math.min(before.length, after.length);
  let prefix = 0;
  while (prefix < maxPrefix && before[prefix] === after[prefix]) {
    prefix += 1;
  }
  let suffix = 0;
  while (
    suffix < before.length - prefix &&
    suffix < after.length - prefix &&
    before[before.length - 1 - suffix] === after[after.length - 1 - suffix]
  ) {
    suffix += 1;
  }
  return before.length - suffix;
}

/**
 * セグメント単位のundo/redo履歴を所有する。
 * 連続入力は種類と時間窓が一致すると1操作へまとめ、外部変更を検出した履歴は破棄する。
 */
export class SegmentTextHistoryStore {
  private readonly histories = new Map<number, SegmentTextHistory>();
  private readonly limit: number;
  private readonly mergeWindowMs: number;
  private readonly now: () => number;

  constructor(limit = 200, mergeWindowMs = 1000, now: () => number = Date.now) {
    this.limit = Math.max(1, Math.floor(limit));
    this.mergeWindowMs = Math.max(0, mergeWindowMs);
    this.now = now;
  }

  clear(segmentId: number): void {
    this.histories.delete(segmentId);
  }

  clearAll(): void {
    this.histories.clear();
  }

  record(segmentId: number, edit: SegmentTextEdit): void {
    const history = this.histories.get(segmentId) ?? { undo: [], redo: [] };
    const timestamp = this.now();
    const normalizedKind = coalescingInputKind(edit.inputKind);
    const previous = history.undo.at(-1);
    const canMerge = !!previous
      && normalizedKind.length > 0
      && previous.inputKind === normalizedKind
      && previous.after === edit.before
      && timestamp - previous.timestamp <= this.mergeWindowMs;

    if (canMerge && previous) {
      previous.after = edit.after;
      previous.afterCaret = edit.afterCaret;
      previous.timestamp = timestamp;
    } else {
      if (previous && previous.after !== edit.before) {
        history.undo = [];
      }
      history.undo.push({
        ...edit,
        beforeCaret: changedRangeEnd(edit.before, edit.after),
        inputKind: normalizedKind,
        timestamp
      });
      if (history.undo.length > this.limit) {
        history.undo.splice(0, history.undo.length - this.limit);
      }
    }
    history.redo = [];
    this.histories.set(segmentId, history);
  }

  undo(segmentId: number, currentValue: string): SegmentTextHistoryTransition | null {
    const history = this.histories.get(segmentId);
    const entry = history?.undo.at(-1);
    if (!history || !entry) {
      return null;
    }
    if (currentValue !== entry.after) {
      this.histories.delete(segmentId);
      return null;
    }
    history.undo.pop();
    history.redo.push(entry);
    return { value: entry.before, caret: entry.beforeCaret };
  }

  redo(segmentId: number, currentValue: string): SegmentTextHistoryTransition | null {
    const history = this.histories.get(segmentId);
    const entry = history?.redo.at(-1);
    if (!history || !entry) {
      return null;
    }
    if (currentValue !== entry.before) {
      this.histories.delete(segmentId);
      return null;
    }
    history.redo.pop();
    history.undo.push(entry);
    return { value: entry.after, caret: entry.afterCaret };
  }
}

/** 選択範囲を安全に本文内へ収めて文字列を挿入し、挿入直後のcaret位置を返す。 */
export function insertTextAtSelection(
  base: string,
  insertedText: string,
  selectionStart: number,
  selectionEnd: number
): InsertTextResult {
  const start = clampSelectionIndex(selectionStart, base.length);
  const end = Math.max(start, clampSelectionIndex(selectionEnd, base.length));
  return {
    text: `${base.slice(0, start)}${insertedText}${base.slice(end)}`,
    caret: start + insertedText.length
  };
}

/** 指定された本文だけを不変更新し、変更されなかった行の参照を維持する。 */
export function applyTextUpdates<T extends TextRow>(
  rows: ReadonlyArray<T>,
  textsById: Readonly<Record<number, string>>
): ApplyTextUpdatesResult<T> {
  let changed = false;
  const updatedRows = rows.map((row) => {
    if (!Object.prototype.hasOwnProperty.call(textsById, row.id)) {
      return row;
    }
    const text = textsById[row.id];
    if (typeof text !== 'string' || text === row.text) {
      return row;
    }
    changed = true;
    return { ...row, text };
  });
  return { rows: updatedRows, changed };
}

function clampSelectionIndex(value: number, length: number): number {
  if (!Number.isFinite(value)) {
    return length;
  }
  return Math.max(0, Math.min(length, Math.trunc(value)));
}
