import assert from 'node:assert/strict';
import test from 'node:test';

import { replaceAllInRows, replaceFirstInRows } from './find-replace.ts';

const rows = [
  { id: 10, text: '対象なし' },
  { id: 20, text: '東京から東京へ' },
  { id: 30, text: '東京' }
];

test('replace first changes only the first match in display order', () => {
  assert.deepEqual(replaceFirstInRows(rows, '東京', '大阪'), {
    replacements: 1,
    updates: [{ id: 20, text: '大阪から東京へ' }]
  });
});

test('replace all returns replacement count and changed rows only', () => {
  assert.deepEqual(replaceAllInRows(rows, '東京', '大阪'), {
    replacements: 3,
    updates: [
      { id: 20, text: '大阪から大阪へ' },
      { id: 30, text: '大阪' }
    ]
  });
});

test('replace helpers safely handle empty and missing search text', () => {
  assert.deepEqual(replaceFirstInRows(rows, '', 'x'), { replacements: 0, updates: [] });
  assert.deepEqual(replaceAllInRows(rows, '', 'x'), { replacements: 0, updates: [] });
  assert.deepEqual(replaceFirstInRows(rows, '京都', '大阪'), { replacements: 0, updates: [] });
  assert.deepEqual(replaceAllInRows(rows, '京都', '大阪'), { replacements: 0, updates: [] });
});

test('replace all follows non-overlapping string replacement semantics', () => {
  assert.deepEqual(replaceAllInRows([{ id: 1, text: 'aaaa' }], 'aa', 'b'), {
    replacements: 2,
    updates: [{ id: 1, text: 'bb' }]
  });
});
