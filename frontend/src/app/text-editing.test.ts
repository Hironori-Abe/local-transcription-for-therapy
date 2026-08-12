import assert from 'node:assert/strict';
import test from 'node:test';

import {
  applyTextUpdates,
  buildVisibleTranscriptText,
  changedRangeEnd,
  coalescingInputKind,
  insertTextAtSelection,
  insertSegmentRelative,
  nextSegmentId,
  SegmentTextHistoryStore,
  splitSegmentAtSentenceEndings,
  splitTextAtSentenceEndings
} from './text-editing.ts';

test('text edit helpers preserve undo grouping and changed-range carets', () => {
  assert.equal(coalescingInputKind('insertText'), 'typing');
  assert.equal(coalescingInputKind('insertCompositionText'), 'typing');
  assert.equal(coalescingInputKind('deleteContentBackward'), 'delete-backward');
  assert.equal(coalescingInputKind('deleteContentForward'), 'delete-forward');
  assert.equal(coalescingInputKind('insertFromPaste'), '');
  assert.equal(changedRangeEnd('abc', 'abXc'), 2);
  assert.equal(changedRangeEnd('abcd', 'acd'), 2);
  assert.equal(changedRangeEnd('abc', 'abc'), 3);
  assert.equal(changedRangeEnd('abc', 'XYZ'), 3);
  assert.equal(changedRangeEnd('', 'new'), 0);
});

test('text history coalesces consecutive typing and restores the original caret', () => {
  let now = 100;
  const history = new SegmentTextHistoryStore(200, 1000, () => now);
  history.record(1, { before: 'あ', after: 'あい', afterCaret: 2, inputKind: 'insertText' });
  now = 500;
  history.record(1, { before: 'あい', after: 'あいう', afterCaret: 3, inputKind: 'insertCompositionText' });

  assert.deepEqual(history.undo(1, 'あいう'), { value: 'あ', caret: 1 });
  assert.deepEqual(history.redo(1, 'あ'), { value: 'あいう', caret: 3 });
});

test('text history keeps edits separate outside the merge window', () => {
  let now = 0;
  const history = new SegmentTextHistoryStore(200, 1000, () => now);
  history.record(1, { before: '', after: 'a', afterCaret: 1, inputKind: 'insertText' });
  now = 1001;
  history.record(1, { before: 'a', after: 'ab', afterCaret: 2, inputKind: 'insertText' });

  assert.deepEqual(history.undo(1, 'ab'), { value: 'a', caret: 1 });
  assert.deepEqual(history.undo(1, 'a'), { value: '', caret: 0 });
});

test('text history clears redo on a new edit and invalidates stale external state', () => {
  const history = new SegmentTextHistoryStore();
  history.record(1, { before: 'a', after: 'b', afterCaret: 1, inputKind: 'insertReplacementText' });
  assert.deepEqual(history.undo(1, 'b'), { value: 'a', caret: 1 });
  history.record(1, { before: 'a', after: 'c', afterCaret: 1, inputKind: 'insertReplacementText' });
  assert.equal(history.redo(1, 'c'), null);
  assert.equal(history.undo(1, 'externally changed'), null);
  assert.equal(history.undo(1, 'c'), null);
});

test('text history enforces its per-segment entry limit independently', () => {
  let now = 0;
  const history = new SegmentTextHistoryStore(2, 0, () => now++);
  history.record(1, { before: '', after: 'a', afterCaret: 1, inputKind: '' });
  history.record(1, { before: 'a', after: 'ab', afterCaret: 2, inputKind: '' });
  history.record(1, { before: 'ab', after: 'abc', afterCaret: 3, inputKind: '' });
  history.record(2, { before: 'x', after: 'y', afterCaret: 1, inputKind: '' });

  assert.deepEqual(history.undo(1, 'abc'), { value: 'ab', caret: 2 });
  assert.deepEqual(history.undo(1, 'ab'), { value: 'a', caret: 1 });
  assert.equal(history.undo(1, 'a'), null);
  assert.deepEqual(history.undo(2, 'y'), { value: 'x', caret: 1 });
});

test('text history can clear one segment or all segments after structural edits', () => {
  const history = new SegmentTextHistoryStore();
  history.record(1, { before: 'a', after: 'b', afterCaret: 1, inputKind: '' });
  history.record(2, { before: 'c', after: 'd', afterCaret: 1, inputKind: '' });
  history.clear(1);
  assert.equal(history.undo(1, 'b'), null);
  assert.deepEqual(history.undo(2, 'd'), { value: 'c', caret: 1 });

  history.record(2, { before: 'c', after: 'e', afterCaret: 1, inputKind: '' });
  history.clearAll();
  assert.equal(history.undo(2, 'e'), null);
});

test('selection insertion replaces and clamps ranges without mutating the source', () => {
  const source = '相談内容';
  assert.deepEqual(insertTextAtSelection(source, 'したい', 2, 4), {
    text: '相談したい',
    caret: 5
  });
  assert.deepEqual(insertTextAtSelection('abc', 'X', -10, 99), { text: 'X', caret: 1 });
  assert.deepEqual(insertTextAtSelection('abc', 'X', 2, 1), { text: 'abXc', caret: 3 });
  assert.deepEqual(insertTextAtSelection('abc', 'X', Number.NaN, Number.NaN), { text: 'abcX', caret: 4 });
  assert.equal(source, '相談内容');
});

test('text updates replace requested rows and preserve all unaffected references', () => {
  const first = { id: 1, text: '旧本文', start: 0 };
  const second = { id: 2, text: 'そのまま', start: 1 };
  const result = applyTextUpdates([first, second], { 1: '新本文', 2: 'そのまま', 99: '対象外' });

  assert.equal(result.changed, true);
  assert.deepEqual(result.rows[0], { id: 1, text: '新本文', start: 0 });
  assert.notEqual(result.rows[0], first);
  assert.equal(result.rows[1], second);
});

test('text updates report unchanged input without replacing row objects', () => {
  const row = { id: 1, text: '本文' };
  const result = applyTextUpdates([row], {});
  assert.equal(result.changed, false);
  assert.equal(result.rows[0], row);
});

test('sentence splitting preserves Japanese punctuation on each part', () => {
  assert.deepEqual(splitTextAtSentenceEndings('最初です。次です？最後！', true), [
    '最初です。', '次です？', '最後！'
  ]);
  assert.deepEqual(splitTextAtSentenceEndings('句点なし', true), ['句点なし']);
});

test('English sentence splitting avoids decimals and only splits before whitespace or end', () => {
  assert.deepEqual(splitTextAtSentenceEndings('Value is 3.14. Next! Done?', false), [
    'Value is 3.14.', 'Next!', 'Done?'
  ]);
  assert.deepEqual(splitTextAtSentenceEndings('U.S.A. test', false), ['U.S.A.', 'test']);
  assert.deepEqual(splitTextAtSentenceEndings('no ending', false), ['no ending']);
});

test('visible transcript text applies edits and excludes hidden rows', () => {
  const rows = [{ id: 1, text: '原文1' }, { id: 2, text: '原文2' }, { id: 3, text: '原文3' }];
  assert.equal(buildVisibleTranscriptText(rows, { 2: true }, { 1: '編集1', 2: '非表示編集' }), '編集1 原文3');
});

test('next segment ID uses the highest existing ID without changing source order', () => {
  const segments = [{ id: 8 }, { id: 2 }, { id: 11 }, { id: -1 }];
  assert.equal(nextSegmentId([]), 0);
  assert.equal(nextSegmentId(segments), 12);
  assert.deepEqual(segments, [{ id: 8 }, { id: 2 }, { id: 11 }, { id: -1 }]);
});

test('relative insertion creates a clean editable row and preserves existing state', () => {
  const rows = [
    { id: 4, start: 0, end: 2, text: '原文', speaker: 'Th', words: ['word'] },
    { id: 9, start: 2, end: 3, text: '次' }
  ];
  const result = insertSegmentRelative(rows, 4, 'below', '編集済み', {
    editedTextById: { 4: '編集済み' },
    hiddenById: { 10: true },
    speakerById: { 4: 'Th' },
    proofreadHintById: { 4: '既存', 10: '古いID' },
    proofreadMetadataById: { 4: { tag: 'keep' }, 10: { tag: 'stale' } }
  });

  assert.ok(result);
  assert.equal(result.createdIds[0], 10);
  assert.deepEqual(result.segments[1], {
    id: 10, start: 0, end: 2, text: '編集済み', speaker: null
  });
  assert.equal(result.editedTextById[10], '編集済み');
  assert.equal(result.speakerById[10], '');
  assert.equal(result.hiddenById[10], undefined);
  assert.equal(result.proofreadHintById[10], undefined);
  assert.equal(result.proofreadMetadataById[10], undefined);
  assert.equal(result.proofreadHintById[4], '既存');
  assert.equal(result.transcriptText, '編集済み 編集済み 次');
  assert.deepEqual(rows, [
    { id: 4, start: 0, end: 2, text: '原文', speaker: 'Th', words: ['word'] },
    { id: 9, start: 2, end: 3, text: '次' }
  ]);
});

test('sentence split creates sequential IDs and invalidates source proofreading state', () => {
  const result = splitSegmentAtSentenceEndings(
    [{ id: 7, start: 1, end: 5, text: '元本文', speaker: 'Cl' }],
    7,
    '一文目。二文目。三文目。',
    'Cl',
    true,
    {
      editedTextById: { 7: '一文目。二文目。三文目。' },
      hiddenById: {},
      speakerById: { 7: 'Cl' },
      proofreadHintById: { 7: '分割前' },
      proofreadMetadataById: { 7: { tag: 'stale' } }
    }
  );

  assert.ok(result);
  assert.deepEqual(result.createdIds, [8, 9]);
  assert.deepEqual(result.segments.map(({ id, text }) => ({ id, text })), [
    { id: 7, text: '元本文' },
    { id: 8, text: '二文目。' },
    { id: 9, text: '三文目。' }
  ]);
  assert.deepEqual(result.editedTextById, { 7: '一文目。', 8: '二文目。', 9: '三文目。' });
  assert.deepEqual(result.speakerById, { 7: 'Cl', 8: 'Cl', 9: 'Cl' });
  assert.equal(result.proofreadHintById[7], undefined);
  assert.equal(result.proofreadMetadataById[7], undefined);
  assert.equal(result.transcriptText, '一文目。 二文目。 三文目。');
});

test('structural edit helpers return null for missing source or unsplittable text', () => {
  const maps = {
    editedTextById: {}, hiddenById: {}, speakerById: {}, proofreadHintById: {}, proofreadMetadataById: {}
  };
  const rows = [{ id: 1, start: 0, end: 1, text: '本文' }];
  assert.equal(insertSegmentRelative(rows, 99, 'above', '本文', maps), null);
  assert.equal(splitSegmentAtSentenceEndings(rows, 1, '句点なし', '', true, maps), null);
});
