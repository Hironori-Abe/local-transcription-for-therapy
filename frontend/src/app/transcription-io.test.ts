import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildDefaultExportFileName,
  buildTranscriptionSavePlan,
  ensureExportPathExtension
} from './transcription-io.ts';

const now = new Date(2026, 7, 12, 14, 5, 9, 7);

test('default export filenames preserve all existing timestamp formats', () => {
  assert.equal(buildDefaultExportFileName('docx', now), 'lott_20260812_140509.docx');
  assert.equal(buildDefaultExportFileName('xlsx', now), 'lott_20260812_140509_007.xlsx');
  assert.equal(buildDefaultExportFileName('srt', now), 'lott_20260812_140509.srt');
  assert.equal(buildDefaultExportFileName('json', now), 'lott_20260812_140509.json');
  assert.equal(buildDefaultExportFileName('runtime-csv', now), 'lott_runtime_log_20260812_140509.csv');
});

test('password-protected JSON and SRT plans switch to ZIP', () => {
  assert.deepEqual(buildTranscriptionSavePlan('json', true, now), {
    title: '文字起こし結果を保存',
    defaultPath: 'lott_20260812_140509.zip',
    extension: '.zip',
    filters: [{ name: 'ZIP', extensions: ['zip'] }]
  });
  assert.deepEqual(buildTranscriptionSavePlan('srt', true, now), {
    title: '文字起こし結果（SRT字幕）を保存',
    defaultPath: 'lott_20260812_140509.zip',
    extension: '.zip',
    filters: [{ name: 'パスワード付きZIP', extensions: ['zip'] }]
  });
});

test('unprotected and document save plans preserve format-specific dialogs', () => {
  assert.equal(buildTranscriptionSavePlan('json', false, now).extension, '.json');
  assert.equal(buildTranscriptionSavePlan('srt', false, now).extension, '.srt');
  assert.deepEqual(buildTranscriptionSavePlan('docx', true, now).filters, [{ name: 'Word', extensions: ['docx'] }]);
  assert.deepEqual(buildTranscriptionSavePlan('xlsx', false, now).filters, [{ name: 'Excel', extensions: ['xlsx'] }]);
  assert.deepEqual(buildTranscriptionSavePlan('runtime-csv', false, now).filters, [{ name: 'CSV', extensions: ['csv'] }]);
});

test('export path extension is appended case-insensitively for every format', () => {
  assert.equal(ensureExportPathExtension('/tmp/result', '.docx'), '/tmp/result.docx');
  assert.equal(ensureExportPathExtension('/tmp/result.DOCX', '.docx'), '/tmp/result.DOCX');
  assert.equal(ensureExportPathExtension('/tmp/archive.zip', '.zip'), '/tmp/archive.zip');
});
