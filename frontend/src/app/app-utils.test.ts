import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildDefaultExportFileName,
  buildDocxExportRowsValue,
  buildExportSpeakerLabelByRowIdValue,
  buildInitialSpeakerAliasMapValue,
  buildInitialSpeakerSelectionMapValue,
  buildLocationDetectionScopeValue,
  buildSrtExportRowsValue,
  buildXlsxExportRowsValue,
  formatAudioDurationValue,
  formatElapsedMinuteSecondValue,
  formatMinuteSecondValue,
  getLocationAreaPrefectureCodesValue,
  inferLocationAreaFromPrefecturesValue,
  normalizeComputeTypeValue,
  normalizeErrorMessageValue,
  normalizeLlmMaxBatchValue,
  normalizeLlmNCtxValue,
  normalizeLlmParallelValue,
  normalizeLocationAreaValue,
  normalizeLocationDetectionScopeValue,
  normalizeLocationPrefectureCodesValue,
  normalizeLocationPrefecturesByAreaValue,
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

test('normalizeErrorMessageValue converts supported failures into display text', () => {
  assert.equal(normalizeErrorMessageValue(new Error('失敗しました')), '失敗しました');
  assert.equal(normalizeErrorMessageValue('文字列エラー'), '文字列エラー');
  assert.equal(normalizeErrorMessageValue({ code: 12, message: '失敗' }), '{"code":12,"message":"失敗"}');
  assert.equal(normalizeErrorMessageValue(null), 'null');
  assert.equal(normalizeErrorMessageValue(42), '42');
});

test('normalizeErrorMessageValue safely handles values JSON cannot represent', () => {
  const circular: { self?: unknown } = {};
  circular.self = circular;
  const fallback = '予期しないエラーが発生しました。';
  assert.equal(normalizeErrorMessageValue(circular), fallback);
  assert.equal(normalizeErrorMessageValue(1n), fallback);
  assert.equal(normalizeErrorMessageValue(undefined), fallback);
  assert.equal(normalizeErrorMessageValue(Symbol('error')), fallback);
  assert.equal(normalizeErrorMessageValue({ toJSON: () => { throw new Error('serialize failure'); } }), fallback);
});

test('document export speaker labels preserve numbering and placeholder rules', () => {
  const rows = [
    { id: 10, speakerLabel: ' Th ' },
    { id: 20, speakerLabel: 'Cl' },
    { id: 30, speakerLabel: 'Th' },
    { id: 40, speakerLabel: '-' },
    { id: 50, speakerLabel: '   ' }
  ];
  assert.deepEqual(buildExportSpeakerLabelByRowIdValue(rows, true), {
    10: 'Th-001',
    20: 'Cl-001',
    30: 'Th-002',
    40: '-',
    50: '-'
  });
  assert.deepEqual(buildExportSpeakerLabelByRowIdValue(rows, false), {
    10: 'Th',
    20: 'Cl',
    30: 'Th',
    40: '-',
    50: '-'
  });
});

test('DOCX and XLSX export rows preserve time, speaker, text, and source order', () => {
  const rows = [
    { id: 7, startSeconds: 0.9, endSeconds: 61.9, speakerLabel: 'Th', text: '一行目' },
    { id: 3, startSeconds: 61.9, endSeconds: 3661.9, speakerLabel: 'Th', text: '二行目' },
    { id: 9, startSeconds: -1, endSeconds: 0, speakerLabel: '-', text: '' }
  ];

  assert.deepEqual(buildDocxExportRowsValue(rows, true), [
    { time: '01:01', speaker: 'Th-001', text: '一行目' },
    { time: '61:01', speaker: 'Th-002', text: '二行目' },
    { time: '00:00', speaker: '-', text: '' }
  ]);
  assert.deepEqual(buildXlsxExportRowsValue(rows, false), [
    { start: '00:00', end: '01:01', speaker: 'Th', text: '一行目' },
    { start: '01:01', end: '61:01', speaker: 'Th', text: '二行目' },
    { start: '00:00', end: '00:00', speaker: '-', text: '' }
  ]);
});

test('SRT export rows keep numeric times and do not add utterance numbers', () => {
  assert.deepEqual(buildSrtExportRowsValue([
    { id: 1, startSeconds: 1.25, endSeconds: 2.75, speakerLabel: ' Th ', text: '本文' },
    { id: 2, startSeconds: 2.75, endSeconds: 3, speakerLabel: '-', text: '次' }
  ]), [
    { startSeconds: 1.25, endSeconds: 2.75, speaker: 'Th', text: '本文' },
    { startSeconds: 2.75, endSeconds: 3, speaker: '-', text: '次' }
  ]);
});

test('initial speaker maps preserve default labels, deduplication, and selection trimming', () => {
  const rows = [
    { id: 0, speaker: 'SPEAKER_00' },
    { id: 1, speaker: 'SPEAKER_01' },
    { id: 2, speaker: 'SPEAKER_02' },
    { id: 3, speaker: 'SPEAKER_03' },
    { id: 4, speaker: 'SPEAKER_04' },
    { id: 5, speaker: 'SPEAKER_05' },
    { id: 6, speaker: 'SPEAKER_00' },
    { id: 7, speaker: ' SPEAKER_00 ' },
    { id: 8, speaker: '   ' },
    { id: 9, speaker: null },
    { id: 10 }
  ];

  assert.deepEqual(buildInitialSpeakerAliasMapValue(rows), {
    SPEAKER_00: 'Th',
    SPEAKER_01: 'Cl',
    SPEAKER_02: 'IP',
    SPEAKER_03: 'IP2',
    SPEAKER_04: 'IP3',
    SPEAKER_05: 'Cl',
    ' SPEAKER_00 ': 'Cl',
    '   ': 'Cl'
  });
  assert.deepEqual(buildInitialSpeakerSelectionMapValue(rows), {
    0: 'SPEAKER_00',
    1: 'SPEAKER_01',
    2: 'SPEAKER_02',
    3: 'SPEAKER_03',
    4: 'SPEAKER_04',
    5: 'SPEAKER_05',
    6: 'SPEAKER_00',
    7: 'SPEAKER_00'
  });
});

test('location area and prefecture codes preserve legacy migration and validation', () => {
  assert.equal(normalizeLocationAreaValue(' tohoku '), 'hokkaidoTohoku');
  assert.equal(normalizeLocationAreaValue('hokkaido'), 'hokkaidoTohoku');
  assert.equal(normalizeLocationAreaValue('kinki'), 'kinki');
  assert.equal(normalizeLocationAreaValue('invalid'), 'kanto');
  assert.deepEqual(getLocationAreaPrefectureCodesValue('shikoku'), ['36', '37', '38', '39']);
  assert.deepEqual(getLocationAreaPrefectureCodesValue('invalid'), ['08', '09', '10', '11', '12', '13', '14']);
  assert.equal(inferLocationAreaFromPrefecturesValue(['47', '13']), 'kyushuOkinawa');
  assert.equal(inferLocationAreaFromPrefecturesValue([]), 'kanto');
  assert.deepEqual(
    normalizeLocationPrefectureCodesValue(['13', ' 14 ', '13', 1, '01', null, '48']),
    ['13', '14', '01']
  );
  assert.deepEqual(normalizeLocationPrefectureCodesValue('13'), []);
});

test('location selections by area merge legacy keys and remove cross-area codes', () => {
  assert.deepEqual(normalizeLocationPrefecturesByAreaValue({
    hokkaidoTohoku: ['01', '13'],
    hokkaido: ['01', '02'],
    tohoku: ['07', 'invalid'],
    kanto: ['13', '15', '13'],
    shikoku: ['36', '47']
  }), {
    hokkaidoTohoku: ['01', '02', '07'],
    kanto: ['13'],
    shikoku: ['36']
  });
  assert.deepEqual(normalizeLocationPrefecturesByAreaValue(null), {});
});

test('saved location detection scopes infer the active area and restore its selection', () => {
  assert.deepEqual(normalizeLocationDetectionScopeValue(null), {
    mode: 'commonOnly',
    area: 'kanto',
    prefectures: [],
    prefecturesByArea: {}
  });
  assert.deepEqual(normalizeLocationDetectionScopeValue({
    prefectures: ['27', '13', '27']
  }), {
    mode: 'selectedRegions',
    area: 'kinki',
    prefectures: ['27'],
    prefecturesByArea: { kinki: ['27'] }
  });
  assert.deepEqual(normalizeLocationDetectionScopeValue({
    area: 'kanto',
    prefectures: ['27'],
    prefecturesByArea: { kanto: ['13'], kinki: ['27'] }
  }), {
    mode: 'selectedRegions',
    area: 'kanto',
    prefectures: ['13'],
    prefecturesByArea: { kanto: ['13'], kinki: ['27'] }
  });
  assert.deepEqual(normalizeLocationDetectionScopeValue({
    area: 'hokkaido',
    prefecturesByArea: { tohoku: ['04'] }
  }), {
    mode: 'selectedRegions',
    area: 'hokkaidoTohoku',
    prefectures: ['04'],
    prefecturesByArea: { hokkaidoTohoku: ['04'] }
  });
});

test('location detection request keeps other areas and updates only the active area', () => {
  assert.deepEqual(buildLocationDetectionScopeValue(
    'chubu',
    ['15', '13', '15'],
    { kanto: ['13'], chubu: ['16'] }
  ), {
    mode: 'selectedRegions',
    area: 'chubu',
    prefectures: ['15'],
    prefecturesByArea: { kanto: ['13'], chubu: ['15'] }
  });
  assert.deepEqual(buildLocationDetectionScopeValue(
    'chubu',
    ['13'],
    { kanto: ['13'], chubu: ['16'] }
  ), {
    mode: 'commonOnly',
    area: 'chubu',
    prefectures: [],
    prefecturesByArea: { kanto: ['13'] }
  });
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
