import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildDefaultExportFileName,
  formatAudioDurationValue,
  formatElapsedMinuteSecondValue,
  formatMinuteSecondValue,
  normalizeComputeTypeValue,
  normalizeLlmMaxBatchValue,
  normalizeLlmNCtxValue,
  normalizeLlmParallelValue,
  normalizeProofreadChunkMaxCharsValue,
  normalizeProofreadChunkSizeValue,
  normalizeThemeModeValue,
  normalizeTranscriptionDeviceValue,
  normalizeTranscriptionLanguageValue
} from './app-utils.ts';

test('buildDefaultExportFileName preserves every existing filename format', () => {
  const now = new Date(2026, 7, 12, 14, 5, 9, 7);
  assert.equal(buildDefaultExportFileName('docx', now), 'lott_20260812_140509.docx');
  assert.equal(buildDefaultExportFileName('xlsx', now), 'lott_20260812_140509_007.xlsx');
  assert.equal(buildDefaultExportFileName('srt', now), 'lott_20260812_140509.srt');
  assert.equal(buildDefaultExportFileName('json', now), 'lott_20260812_140509.json');
  assert.equal(buildDefaultExportFileName('runtime-csv', now), 'lott_runtime_log_20260812_140509.csv');
});

test('duration formatters preserve rounding and negative-value behavior', () => {
  assert.equal(formatAudioDurationValue(null), '-');
  assert.equal(formatAudioDurationValue(Number.NaN), '-');
  assert.equal(formatAudioDurationValue(0), '-');
  assert.equal(formatAudioDurationValue(61.9), '1分1秒');
  assert.equal(formatMinuteSecondValue(-1), '00:00');
  assert.equal(formatMinuteSecondValue(3661.9), '61:01');
  assert.equal(formatElapsedMinuteSecondValue(-1), '0分0秒');
  assert.equal(formatElapsedMinuteSecondValue(3661.9), '61分1秒');
});

test('proofread and LLM numeric settings use documented defaults and limits', () => {
  assert.equal(normalizeProofreadChunkSizeValue(Number.NaN), 12);
  assert.equal(normalizeProofreadChunkSizeValue(0), 1);
  assert.equal(normalizeProofreadChunkSizeValue(64.6), 64);
  assert.equal(normalizeProofreadChunkMaxCharsValue(Number.POSITIVE_INFINITY), 1200);
  assert.equal(normalizeProofreadChunkMaxCharsValue(199), 200);
  assert.equal(normalizeProofreadChunkMaxCharsValue(6001), 6000);

  assert.equal(normalizeLlmNCtxValue(Number.NaN), 0);
  assert.equal(normalizeLlmNCtxValue(0), 0);
  assert.equal(normalizeLlmNCtxValue(4097), 4096);
  assert.equal(normalizeLlmNCtxValue(200000), 131072);
  assert.equal(normalizeLlmMaxBatchValue(Number.NaN), 40);
  assert.equal(normalizeLlmMaxBatchValue(0), 1);
  assert.equal(normalizeLlmMaxBatchValue(101), 100);
  assert.equal(normalizeLlmParallelValue(Number.NaN), 0);
  assert.equal(normalizeLlmParallelValue(0), 0);
  assert.equal(normalizeLlmParallelValue(25), 24);
});

test('saved selection settings normalize invalid and CPU-only values safely', () => {
  const languageOptions = [{ value: 'ja' }, { value: 'en' }, { value: 'ko' }];
  assert.equal(normalizeThemeModeValue('dark'), 'dark');
  assert.equal(normalizeThemeModeValue('unknown'), 'system');
  assert.equal(normalizeComputeTypeValue(' FLOAT16 ', false), 'float16');
  assert.equal(normalizeComputeTypeValue('unknown', false), 'auto');
  assert.equal(normalizeComputeTypeValue('float16', true), 'float32');
  assert.equal(normalizeComputeTypeValue('int8', true), 'int8');
  assert.equal(normalizeTranscriptionLanguageValue(' EN ', languageOptions), 'en');
  assert.equal(normalizeTranscriptionLanguageValue('fr', languageOptions), 'ja');
  assert.equal(normalizeTranscriptionDeviceValue('cpu', false), 'cpu');
  assert.equal(normalizeTranscriptionDeviceValue('unknown', false), 'cuda');
  assert.equal(normalizeTranscriptionDeviceValue('cuda', true), 'cpu');
});
