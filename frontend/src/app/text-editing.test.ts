import assert from 'node:assert/strict';
import test from 'node:test';

import {
  applyTextUpdates,
  changedRangeEnd,
  coalescingInputKind,
  insertTextAtSelection,
  SegmentTextHistoryStore
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
