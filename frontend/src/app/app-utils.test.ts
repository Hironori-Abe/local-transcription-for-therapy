import assert from 'node:assert/strict';
import test from 'node:test';

import {
  appendRuntimeEstimateSampleValue,
  GGML_ESTIMATE_PROFILE,
  buildDocxExportRowsValue,
  buildExportSpeakerLabelByRowIdValue,
  buildInitialSpeakerAliasMapValue,
  buildInitialSpeakerSelectionMapValue,
  buildLocationDetectionScopeValue,
  buildConsecutiveSpeakerRunMapValue,
  buildSegmentRowNumberMapValue,
  buildSrtExportRowsValue,
  buildXlsxExportRowsValue,
  buildUniqueSpeakersValue,
  calculateRuntimeEstimateValue,
  confirmDialogButtonClassValue,
  displaySpeakerValue,
  editorVoiceInputUnavailableTooltipValue,
  formatAudioDurationValue,
  formatElapsedMinuteSecondValue,
  formatEstimatedMinutesValue,
  formatMinuteSecondValue,
  getAudioDurationMessageValue,
  getEditableTextFromMapValue,
  getEstimatedTimeMessageValue,
  getImportCompletedMessageValue,
  getProgressStageOrderValue,
  getLocationAreaPrefectureCodesValue,
  getSpeakerColorClassValue,
  hasFallbackInTranscriptionResultValue,
  isDiarizationModelMissingValue,
  isJapaneseLanguageValue,
  isPlaybackDisabledValue,
  matchPlaybackShortcutCodeValue,
  inferLocationAreaFromPrefecturesValue,
  normalizeErrorMessageValue,
  normalizeLocationAreaValue,
  normalizeLocationDetectionScopeValue,
  normalizeSpeakerKeyValue,
  normalizeTimeInputValue,
  normalizeLocationPrefectureCodesValue,
  normalizeLocationPrefecturesByAreaValue,
  normalizeProofreadChunkMaxCharsValue,
  normalizeProofreadChunkSizeValue,
  normalizeThemeModeValue,
  normalizeTranscriptionDeviceValue,
  normalizeTranscriptionLanguageValue,
  parseRuntimeEstimateSamplesValue,
  pickRuntimeEstimateSamplesValue,
  resolveRuntimeLogAudioSecondsValue,
  resolveTimeInputRangeValue,
  isBuildVariantValue,
  resolveStepForStageValue,
  secondsToEstimatedMinutesValue,
  selectedFileNameValue,
  selectedLocationPrefectureTotalCountValue,
  shouldShowVoiceInputShortCandidateHintValue,
  speakerOptionLabelValue,
  stepTimeInputValuesValue,
  locationDetectionScopeHintValue,
  themeModeLabelValue,
  themeToggleIconValue,
  transcriptionTabDisabledValue,
  transcriptionTabLabelValue,
  transcriptionRuntimeReasonValue,
  voiceInputButtonTooltipValue,
  processingStatusTextValue,
  speechDeviceLineValue,
  activeVulkanGpuNameValue,
  diarizationGpuFallbackNoticeValue,
  effectiveVulkanGpuUuidValue,
  vulkanGpuAutoLabelValue,
  vulkanGpuLabelValue,
  normalizeAudioPreprocessPresetValue,
  audioPreprocessPresetFromLegacyFlags,
  stripRemovedSettingsValue,
  resolveGeneralAppSettingsValue,
} from './app-utils.ts';

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

test('filename and estimate display helpers preserve cross-platform labels', () => {
  assert.equal(selectedFileNameValue('C:\\audio\\session.m4a'), 'session.m4a');
  assert.equal(selectedFileNameValue('/audio/session.wav'), 'session.wav');
  assert.equal(selectedFileNameValue('session.mp3'), 'session.mp3');
  assert.equal(selectedFileNameValue(''), '');
  assert.equal(formatEstimatedMinutesValue(null), '-');
  assert.equal(formatEstimatedMinutesValue(Number.NaN), '-');
  assert.equal(formatEstimatedMinutesValue(12.5), '12.5');
  assert.equal(getAudioDurationMessageValue(true, 62), '（計算中...）');
  assert.equal(getAudioDurationMessageValue(false, 62), '1分2秒');
});

test('estimated time messages preserve pending, insufficient, and ready states', () => {
  const readyInput = {
    estimating: false,
    audioSeconds: 600,
    estimateReady: true,
    sampleCount: 3,
    minimumSamples: 3,
    minMinutes: 4,
    avgMinutes: 6
  };
  assert.equal(getEstimatedTimeMessageValue({ ...readyInput, estimating: true }), '（計算中...）');
  assert.equal(
    getEstimatedTimeMessageValue({ ...readyInput, audioSeconds: null }),
    '音声ファイルを選択すると表示されます。'
  );
  assert.equal(
    getEstimatedTimeMessageValue({ ...readyInput, estimateReady: false, sampleCount: 2 }),
    'まだ推定には十分なデータが集まっていません。（2/3件）'
  );
  assert.equal(getEstimatedTimeMessageValue(readyInput), '最低 4 分、概算 6 分');
});

test('Full GPU runtime reasons never promise an unavailable CPU fallback', () => {
  assert.equal(
    transcriptionRuntimeReasonValue(false, 'GPU が確認できませんでした。CPU モードで動作します。'),
    'GPU が確認できませんでした。Full GPU版ではCPUへ切り替えず、文字起こし・話者分離は利用できません。GPUドライバーとランタイムを確認してください。'
  );
  assert.equal(
    transcriptionRuntimeReasonValue(false, ''),
    'GPU が確認できないため、文字起こし・話者分離は利用できません。'
  );
  assert.equal(transcriptionRuntimeReasonValue(true, 'CUDA が利用可能です。'), '');
});

test('language detection treats missing values as Japanese', () => {
  assert.equal(isJapaneseLanguageValue('JA'), true);
  assert.equal(isJapaneseLanguageValue(undefined), true);
  assert.equal(isJapaneseLanguageValue('en'), false);
});

test('location count and hint helpers deduplicate selections across areas', () => {
  assert.equal(selectedLocationPrefectureTotalCountValue(
    { kanto: ['13', '14'], kinki: ['27', '13'] },
    ['13', '01']
  ), 4);
  assert.equal(locationDetectionScopeHintValue(0), '全国共通のみ確認します。');
  assert.equal(locationDetectionScopeHintValue(4), '全国共通に加えて選択地域 全体 4 件を詳しく確認します。');
});

test('segment row and speaker helpers preserve hidden rows, edits, and sorting', () => {
  assert.deepEqual(buildSegmentRowNumberMapValue(
    [{ id: 10 }, { id: 20 }, { id: 30 }],
    { 20: true }
  ), { 10: 1, 30: 2 });
  assert.deepEqual(buildUniqueSpeakersValue(
    [{ speaker: 'SPEAKER_02' }, { speaker: 'SPEAKER_00' }, { speaker: null }],
    { 1: ' SPEAKER_01 ', 2: 'SPEAKER_00', 3: ' ' }
  ), ['SPEAKER_00', 'SPEAKER_01', 'SPEAKER_02']);
  assert.equal(getEditableTextFromMapValue({ id: 1, text: '元文' }, { 1: '' }), '');
  assert.equal(getEditableTextFromMapValue({ id: 2, text: '元文' }, {}), '元文');
  assert.equal(getEditableTextFromMapValue({ id: 3, text: null }, {}), '');
});

test('consecutive speaker runs include only qualifying runs at their first segment', () => {
  const segments = [
    { id: 10, speaker: 'A' }, { id: 11, speaker: 'A' }, { id: 12, speaker: 'A' },
    { id: 13, speaker: 'A' }, { id: 14, speaker: 'A' }, { id: 20, speaker: 'B' },
    { id: 21, speaker: 'B' }, { id: 22, speaker: 'B' }, { id: 23, speaker: 'B' }
  ];
  assert.deepEqual(buildConsecutiveSpeakerRunMapValue(segments, (segment) => segment.speaker), { 10: 5 });
  assert.deepEqual(buildConsecutiveSpeakerRunMapValue(segments, (segment) => segment.speaker, 4), {
    10: 5, 20: 4
  });
  assert.deepEqual(buildConsecutiveSpeakerRunMapValue([], () => ''), {});
});

test('small UI label helpers preserve existing classes, icons, and import messages', () => {
  assert.equal(getImportCompletedMessageValue(true), '読み取りが完了しました。文字起こしタブでも編集できます。');
  assert.equal(getImportCompletedMessageValue(false), '読み取りが完了しました。');
  assert.equal(confirmDialogButtonClassValue('warn', 'confirm'), 'confirm-dialog-btn confirm-dialog-btn-confirm confirm-dialog-btn-warn');
  assert.equal(confirmDialogButtonClassValue(null, 'cancel'), 'confirm-dialog-btn confirm-dialog-btn-cancel');
  assert.equal(themeToggleIconValue('system'), 'brightness_auto');
  assert.equal(themeToggleIconValue('light'), 'light_mode');
  assert.equal(themeToggleIconValue('dark'), 'dark_mode');
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

test('speaker display helpers preserve aliases, normalization, and option labels', () => {
  const aliases = { SPEAKER_00: 'Th', SPEAKER_01: '', SPEAKER_02: '  IP  ' };
  assert.equal(normalizeSpeakerKeyValue('  SPEAKER_00  '), 'SPEAKER_00');
  assert.equal(normalizeSpeakerKeyValue(null), '');
  assert.equal(normalizeSpeakerKeyValue(undefined), '');
  assert.equal(displaySpeakerValue(null, aliases), '-');
  assert.equal(displaySpeakerValue('', aliases), '-');
  assert.equal(displaySpeakerValue('SPEAKER_00', aliases), 'Th');
  assert.equal(displaySpeakerValue('SPEAKER_01', aliases), 'SPEAKER_01');
  assert.equal(displaySpeakerValue('SPEAKER_02', aliases), '  IP  ');
  assert.equal(displaySpeakerValue('SPEAKER_03', aliases), 'SPEAKER_03');
  assert.equal(speakerOptionLabelValue('SPEAKER_00', aliases), 'Th (SPEAKER_00)');
  assert.equal(speakerOptionLabelValue('SPEAKER_01', aliases), 'SPEAKER_01');
});

test('speaker color classes accept canonical keys and cap the palette at five colors', () => {
  assert.equal(getSpeakerColorClassValue('SPEAKER_0'), 'speaker-color-1');
  assert.equal(getSpeakerColorClassValue('SPEAKER_00'), 'speaker-color-1');
  assert.equal(getSpeakerColorClassValue('SPEAKER_03'), 'speaker-color-4');
  assert.equal(getSpeakerColorClassValue('SPEAKER_04'), 'speaker-color-5');
  assert.equal(getSpeakerColorClassValue('SPEAKER_20'), 'speaker-color-5');
  assert.equal(getSpeakerColorClassValue('speaker_00'), '');
  assert.equal(getSpeakerColorClassValue('SPEAKER_-1'), '');
  assert.equal(getSpeakerColorClassValue('Th'), '');
});

test('playback shortcut matching prefers physical codes and preserves key fallbacks', () => {
  assert.equal(matchPlaybackShortcutCodeValue('KeyA', 'x'), 'KeyA');
  assert.equal(matchPlaybackShortcutCodeValue('Space', 'Process'), 'Space');
  assert.equal(matchPlaybackShortcutCodeValue('', 'A'), 'KeyA');
  assert.equal(matchPlaybackShortcutCodeValue('Unknown', 'd'), 'KeyD');
  assert.equal(matchPlaybackShortcutCodeValue(undefined, 'E'), 'KeyE');
  assert.equal(matchPlaybackShortcutCodeValue(null, ' '), 'Space');
  assert.equal(matchPlaybackShortcutCodeValue('', 'spacebar'), 'Space');
  assert.equal(matchPlaybackShortcutCodeValue('', 'Process'), null);
});

test('time input helpers preserve digit filtering, validation, and reversed-range correction', () => {
  assert.equal(normalizeTimeInputValue(' 1分2a３ '), '12');
  assert.equal(normalizeTimeInputValue('-05'), '05');
  assert.deepEqual(resolveTimeInputRangeValue({
    startMm: '1', startSs: '02', endMm: '3', endSs: '04'
  }), { startSeconds: 62, endSeconds: 184 });
  assert.deepEqual(resolveTimeInputRangeValue({
    startMm: '2', startSs: '30', endMm: '1', endSs: '15'
  }), { startSeconds: 75, endSeconds: 150 });
  assert.deepEqual(resolveTimeInputRangeValue({
    startMm: ' 1x', startSs: '2', endMm: '1', endSs: '03'
  }), { startSeconds: 62, endSeconds: 63 });
  assert.equal(resolveTimeInputRangeValue({
    startMm: '', startSs: '00', endMm: '1', endSs: '00'
  }), null);
  assert.equal(resolveTimeInputRangeValue({
    startMm: '0', startSs: '60', endMm: '1', endSs: '00'
  }), null);
});

test('time field stepping preserves bounds and prevents start/end crossover', () => {
  const values = { startMm: '1', startSs: '58', endMm: '2', endSs: '00' };
  assert.deepEqual(stepTimeInputValuesValue(values, 'startSs', 1), {
    startMm: '1', startSs: '59', endMm: '2', endSs: '00'
  });
  assert.deepEqual(stepTimeInputValuesValue(values, 'startMm', -1), {
    startMm: '0', startSs: '58', endMm: '2', endSs: '00'
  });
  assert.equal(stepTimeInputValuesValue(values, 'startMm', 1), null);
  assert.equal(stepTimeInputValuesValue(
    { startMm: '1', startSs: '58', endMm: '1', endSs: '58' },
    'endSs',
    -1
  ), null);
  assert.deepEqual(stepTimeInputValuesValue(
    { startMm: '0', startSs: '00', endMm: '0', endSs: '59' },
    'endSs',
    1
  ), { startMm: '0', startSs: '00', endMm: '0', endSs: '59' });
  assert.equal(stepTimeInputValuesValue(
    { startMm: '', startSs: '00', endMm: '1', endSs: '00' },
    'startMm',
    1
  ), null);
});

test('voice-input tooltip preserves condition priority', () => {
  assert.equal(editorVoiceInputUnavailableTooltipValue(false), '音声入力パックの状態を確認中です...');
  assert.match(editorVoiceInputUnavailableTooltipValue(true), /モデルをダウンロード/);
  assert.equal(
    editorVoiceInputUnavailableTooltipValue(true, true),
    '音声入力には文字起こし用のモデル（whisper.cpp）が必要です。設定画面のセットアップを完了してください'
  );
  assert.match(editorVoiceInputUnavailableTooltipValue(false, true), /whisper\.cpp.*確認中/);
  assert.equal(voiceInputButtonTooltipValue(false, '利用不可', true), '利用不可');
  assert.equal(voiceInputButtonTooltipValue(true, '利用不可', true), '録音を停止');
  assert.equal(voiceInputButtonTooltipValue(true, '利用不可', false), '音声入力');
});

test('result and transcription tab helpers preserve setup labels', () => {
  assert.equal(isPlaybackDisabledValue(true, false), true);
  assert.equal(isPlaybackDisabledValue(true, true), false);
  assert.equal(isPlaybackDisabledValue(false, false), false);
  assert.equal(isDiarizationModelMissingValue(false, false, false), false);
  assert.equal(isDiarizationModelMissingValue(true, false, true), true);
  assert.equal(isDiarizationModelMissingValue(true, true, false), true);
  assert.equal(isDiarizationModelMissingValue(true, true, true), false);
  assert.equal(transcriptionTabLabelValue(false, true), '文字起こし（要設定）');
  assert.equal(transcriptionTabLabelValue(true, false), '文字起こし（要設定）');
  assert.equal(transcriptionTabLabelValue(false, false), '文字起こし');
});

test('tab and setup-adjacent helpers preserve safe UI states', () => {
  const tabInput = {
    transcriptionTabVisible: true,
    editorOnlyBuild: false,
    setupChecked: true,
    needsFullSetup: false,
    transcriptionRuntimeAvailable: true
  };
  assert.equal(transcriptionTabDisabledValue(tabInput), false);
  assert.equal(transcriptionTabDisabledValue({
    ...tabInput, transcriptionRuntimeAvailable: false
  }), true);
  assert.equal(transcriptionTabDisabledValue({
    ...tabInput, transcriptionRuntimeAvailable: false, needsFullSetup: true
  }), false);
});

test('processing status text preserves combined transcription and proofreading labels', () => {
  const idle = {
    visible: true,
    transcriptionRunning: false,
    displayProgress: 0,
    diarizationPhaseActive: false,
    diarizationStage: '',
    parallelDiarizationStatus: '',
    ruleProofreadRunning: false,
    ruleProofreadProgressText: '',
    ruleProofreadStatus: ''
  };
  assert.equal(processingStatusTextValue({ ...idle, visible: false }), '');
  assert.equal(processingStatusTextValue(idle), '処理中...');
  assert.equal(processingStatusTextValue({
    ...idle,
    transcriptionRunning: true,
    displayProgress: 49.6,
    parallelDiarizationStatus: '待機中'
  }), '文字起こし：50%　話者分離：待機中');
  assert.equal(processingStatusTextValue({
    ...idle,
    transcriptionRunning: true,
    diarizationPhaseActive: true,
    diarizationStage: ''
  }), '文字起こし：完了　話者分離：起動中');
  assert.equal(processingStatusTextValue({
    ...idle,
    ruleProofreadRunning: true,
    ruleProofreadStatus: '2/5'
  }), '句読点付与：2/5');
  assert.equal(processingStatusTextValue({
    ...idle,
    transcriptionRunning: true,
    displayProgress: 10,
    cpuMode: true
  }), '文字起こし：10%　（CPUで処理中）');
  assert.equal(processingStatusTextValue({
    ...idle,
    ruleProofreadRunning: true,
    ruleProofreadStatus: '2/5',
    cpuMode: true
  }), '句読点付与：2/5');
});

test('speech device line reports GPU, CPU and the dev override', () => {
  assert.equal(speechDeviceLineValue({ vulkanAvailable: null, gpuName: '', devForceCpu: false }), '');
  assert.equal(
    speechDeviceLineValue({ vulkanAvailable: true, gpuName: 'RTX 4060', devForceCpu: false }),
    'GPU（RTX 4060）'
  );
  assert.equal(speechDeviceLineValue({ vulkanAvailable: true, gpuName: ' ', devForceCpu: false }), 'GPU');
  assert.equal(
    speechDeviceLineValue({ vulkanAvailable: false, gpuName: '', devForceCpu: false }),
    'CPU（GPUが見つからないため）'
  );
  assert.equal(
    speechDeviceLineValue({ vulkanAvailable: false, gpuName: '', devForceCpu: true }),
    'CPU（開発オプションでCPU強制）'
  );
});

test('active GPU name follows the saved selection, then auto, then the fallback name', () => {
  const list = {
    devices: [
      { index: 0, name: 'iGPU', uuid: 'a' },
      { index: 1, name: 'dGPU', uuid: 'b' }
    ],
    autoUuid: 'b'
  } as unknown as Parameters<typeof activeVulkanGpuNameValue>[1];
  assert.equal(activeVulkanGpuNameValue('a', list, 'x'), 'iGPU');
  assert.equal(activeVulkanGpuNameValue('', list, 'x'), 'dGPU');
  assert.equal(activeVulkanGpuNameValue('gone', list, 'x'), 'dGPU');
  assert.equal(activeVulkanGpuNameValue('', null, 'x'), 'x');
});

test('diarization GPU fallback notice appears only when flagged', () => {
  assert.equal(diarizationGpuFallbackNoticeValue({ diarization: null }), null);
  assert.equal(diarizationGpuFallbackNoticeValue({ diarization: { gpuFallback: false } }), null);
  assert.match(diarizationGpuFallbackNoticeValue({ diarization: { gpuFallback: true } }) ?? '', /CPUで処理/);
});

test('runtime estimate helpers preserve minute rounding', () => {
  assert.equal(secondsToEstimatedMinutesValue(Number.NaN), 0);
  assert.equal(secondsToEstimatedMinutesValue(Number.POSITIVE_INFINITY), 0);
  assert.equal(secondsToEstimatedMinutesValue(0), 0);
  assert.equal(secondsToEstimatedMinutesValue(-1), 0);
  assert.equal(secondsToEstimatedMinutesValue(0.1), 1);
  assert.equal(secondsToEstimatedMinutesValue(60), 1);
  assert.equal(secondsToEstimatedMinutesValue(60.1), 2);
});

test('whisper.cpp estimate samples are kept apart from faster-whisper compute types', () => {
  const samples = [
    { audioSeconds: 600, elapsedSeconds: 90, diarization: true, device: 'cuda', computeType: 'float16', createdAt: 1 },
    { audioSeconds: 600, elapsedSeconds: 31, diarization: true, device: 'cuda', computeType: GGML_ESTIMATE_PROFILE, createdAt: 2 }
  ];

  assert.deepEqual(pickRuntimeEstimateSamplesValue(samples, true, 'cuda', GGML_ESTIMATE_PROFILE), [samples[1]]);
  assert.deepEqual(pickRuntimeEstimateSamplesValue(samples, true, 'cuda', 'float16'), [samples[0]]);
});

test('runtime estimate sample selection requires an exact profile match', () => {
  const samples = [
    { audioSeconds: 60, elapsedSeconds: 30, diarization: true, device: 'cuda', computeType: 'float16', createdAt: 1 },
    { audioSeconds: 90, elapsedSeconds: 45, diarization: true, device: 'cuda', computeType: 'float16', createdAt: 2 },
    { audioSeconds: 60, elapsedSeconds: 60, diarization: false, device: 'cuda', computeType: 'float16', createdAt: 3 },
    { audioSeconds: 60, elapsedSeconds: 120, diarization: true, device: 'cpu', computeType: 'int8', createdAt: 4 },
    { audioSeconds: 60, elapsedSeconds: 40, diarization: true, device: 'cuda', computeType: 'float32', createdAt: 5 }
  ];

  assert.deepEqual(
    pickRuntimeEstimateSamplesValue(samples, true, 'cuda', 'float16'),
    [samples[0], samples[1]]
  );
  assert.deepEqual(pickRuntimeEstimateSamplesValue(samples, false, 'cuda', 'float16'), [samples[2]]);
  assert.deepEqual(pickRuntimeEstimateSamplesValue(samples, true, 'cpu', 'int8'), [samples[3]]);
  assert.deepEqual(pickRuntimeEstimateSamplesValue(samples, false, 'cpu', 'int8'), []);
  assert.equal(samples.length, 5);
});

test('saved runtime estimate samples skip corrupt entries and normalize devices', () => {
  const serialized = JSON.stringify([
    null,
    'invalid',
    {},
    { audioSeconds: 60, elapsedSeconds: 30, diarization: true, device: 'cpu', computeType: 'int8', createdAt: 1 },
    { audioSeconds: 90, elapsedSeconds: 45, diarization: false, device: 'unknown', computeType: 'float16', createdAt: 2, fileSizeBytes: 1234 },
    { audioSeconds: -1, elapsedSeconds: -2, diarization: true, computeType: 'float32', createdAt: 3 },
    { audioSeconds: 1, elapsedSeconds: 1, diarization: 'yes', computeType: 'float16', createdAt: 4 }
  ]);

  assert.deepEqual(parseRuntimeEstimateSamplesValue(serialized), [
    { audioSeconds: 60, elapsedSeconds: 30, diarization: true, device: 'cpu', computeType: 'int8', createdAt: 1, fileSizeBytes: null },
    { audioSeconds: 90, elapsedSeconds: 45, diarization: false, device: 'cuda', computeType: 'float16', createdAt: 2, fileSizeBytes: 1234 },
    { audioSeconds: -1, elapsedSeconds: -2, diarization: true, device: 'cuda', computeType: 'float32', createdAt: 3, fileSizeBytes: null }
  ]);
  assert.deepEqual(parseRuntimeEstimateSamplesValue(null), []);
  assert.deepEqual(parseRuntimeEstimateSamplesValue('{'), []);
  assert.deepEqual(parseRuntimeEstimateSamplesValue('{}'), []);
});

test('runtime estimate sample append rejects invalid durations and keeps the newest 120', () => {
  const original = Array.from({ length: 120 }, (_, index) => ({
    audioSeconds: 60,
    elapsedSeconds: 30,
    diarization: true,
    device: 'cuda',
    computeType: 'float16',
    createdAt: index
  }));
  const added = {
    audioSeconds: 90,
    elapsedSeconds: 45,
    diarization: true,
    device: 'cuda',
    computeType: 'float16',
    createdAt: 120
  };

  const next = appendRuntimeEstimateSampleValue(original, added);
  assert.equal(next?.length, 120);
  assert.equal(next?.[0]?.createdAt, 1);
  assert.equal(next?.[119]?.createdAt, 120);
  assert.equal(original.length, 120);
  assert.equal(original[0]?.createdAt, 0);
  assert.equal(appendRuntimeEstimateSampleValue(original, { ...added, audioSeconds: 0 }), null);
  assert.equal(appendRuntimeEstimateSampleValue(original, { ...added, elapsedSeconds: Number.NaN }), null);
});

test('runtime log audio duration prefers metadata and falls back to the latest segment end', () => {
  const segments = [{ end: 12.5 }, { end: '20' }, { end: -1 }, { end: 'invalid' }];
  assert.equal(resolveRuntimeLogAudioSecondsValue(30, segments), 30);
  assert.equal(resolveRuntimeLogAudioSecondsValue(Number.NaN, segments), 20);
  assert.equal(resolveRuntimeLogAudioSecondsValue(null, segments), 20);
  assert.equal(resolveRuntimeLogAudioSecondsValue(0, [{ end: 0 }, { end: Number.NaN }]), null);
});

test('runtime estimate calculation preserves RTF percentile selection and readiness', () => {
  const samples = [0.5, 0.1, 0.4, 0.3, 0.2].map((rtf, index) => ({
    audioSeconds: 100,
    elapsedSeconds: 100 * rtf,
    diarization: true,
    device: 'cuda',
    computeType: 'float16',
    createdAt: index
  }));
  assert.deepEqual(calculateRuntimeEstimateValue(600, samples), {
    ready: true,
    minMinutes: 2,
    avgMinutes: 3,
    avgSeconds: 180
  });
  assert.deepEqual(calculateRuntimeEstimateValue(600, samples.slice(0, 4)), {
    ready: false,
    minMinutes: null,
    avgMinutes: null,
    avgSeconds: null
  });
  assert.deepEqual(calculateRuntimeEstimateValue(600, [
    ...samples.slice(0, 4),
    { ...samples[4], audioSeconds: 0 }
  ]), {
    ready: false,
    minMinutes: null,
    avgMinutes: null,
    avgSeconds: null
  });
});

test('theme labels preserve all three UI display names', () => {
  assert.equal(themeModeLabelValue('system'), 'システムに合わせる');
  assert.equal(themeModeLabelValue('light'), 'ライト');
  assert.equal(themeModeLabelValue('dark'), 'ダーク');
});

test('voice input short-candidate hint counts Unicode characters after trimming', () => {
  assert.equal(shouldShowVoiceInputShortCandidateHintValue(null), false);
  assert.equal(shouldShowVoiceInputShortCandidateHintValue([]), false);
  assert.equal(shouldShowVoiceInputShortCandidateHintValue(['  ', '\n']), false);
  assert.equal(shouldShowVoiceInputShortCandidateHintValue([' はい ', 'いいえ']), true);
  assert.equal(shouldShowVoiceInputShortCandidateHintValue(['😀😀😀😀']), true);
  assert.equal(shouldShowVoiceInputShortCandidateHintValue(['短い', '五文字です']), false);
});

test('progress stage ordering and aliases preserve transcription and diarization flows', () => {
  assert.deepEqual(getProgressStageOrderValue(false), [
    'sidecar_running', 'model_loading', 'transcribing', 'postprocess', 'done'
  ]);
  assert.deepEqual(getProgressStageOrderValue(true), [
    'sidecar_running', 'diarization_loading', 'diarization_running', 'diarization_done', 'done'
  ]);
  assert.equal(resolveStepForStageValue('', false), 0);
  assert.equal(resolveStepForStageValue('preparing', false), 1);
  assert.equal(resolveStepForStageValue('model_loading', false), 2);
  assert.equal(resolveStepForStageValue('diarization_running', false), 0);
  assert.equal(resolveStepForStageValue('model_loading', true), 1);
  assert.equal(resolveStepForStageValue('diarization_waiting', true), 2);
  assert.equal(resolveStepForStageValue('diarization_fallback', true), 3);
  assert.equal(resolveStepForStageValue('done', true), 5);
  assert.equal(resolveStepForStageValue('unknown', true), 0);
});

test('transcription fallback detection accepts explicit and diarization fallback results', () => {
  assert.equal(hasFallbackInTranscriptionResultValue({ fallbackUsed: true }), true);
  assert.equal(hasFallbackInTranscriptionResultValue({
    fallbackUsed: false,
    diarization: { note: 'GPU失敗のためCPUへフォールバックしました。' }
  }), true);
  assert.equal(hasFallbackInTranscriptionResultValue({
    diarization: { note: '話者分離が完了しました。' }
  }), false);
  assert.equal(hasFallbackInTranscriptionResultValue({ diarization: null }), false);
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

test('proofread numeric settings use documented defaults and limits', () => {
  assert.equal(normalizeProofreadChunkSizeValue(Number.NaN), 12);
  assert.equal(normalizeProofreadChunkSizeValue(0), 1);
  assert.equal(normalizeProofreadChunkSizeValue(64.6), 64);
  assert.equal(normalizeProofreadChunkMaxCharsValue(Number.POSITIVE_INFINITY), 1200);
  assert.equal(normalizeProofreadChunkMaxCharsValue(199), 200);
  assert.equal(normalizeProofreadChunkMaxCharsValue(6001), 6000);
});

test('saved selection settings normalize invalid values safely', () => {
  const languageOptions = [{ value: 'ja' }, { value: 'en' }, { value: 'ko' }];
  assert.equal(normalizeThemeModeValue('dark'), 'dark');
  assert.equal(normalizeThemeModeValue('unknown'), 'system');
  assert.equal(normalizeTranscriptionLanguageValue(' EN ', languageOptions), 'en');
  assert.equal(normalizeTranscriptionLanguageValue('fr', languageOptions), 'ja');
  assert.equal(normalizeTranscriptionDeviceValue('cpu'), 'cpu');
  assert.equal(normalizeTranscriptionDeviceValue('unknown'), 'cuda');
});

test('vulkan GPU labels show VRAM, mark integrated GPUs, and name the auto choice', () => {
  const list = {
    devices: [
      { index: 0, name: 'AMD Radeon 780M Graphics', kind: 'integrated' as const, vramMb: 16278, uuid: 'a' },
      { index: 1, name: 'NVIDIA GeForce RTX 4060 Laptop GPU', kind: 'discrete' as const, vramMb: 7957, uuid: 'b' }
    ],
    autoUuid: 'b'
  };
  assert.equal(vulkanGpuLabelValue(list.devices[0]), 'AMD Radeon 780M Graphics（16GB・内蔵GPU）');
  assert.equal(vulkanGpuLabelValue(list.devices[1]), 'NVIDIA GeForce RTX 4060 Laptop GPU（8GB）');
  assert.equal(vulkanGpuAutoLabelValue(list), '自動（NVIDIA GeForce RTX 4060 Laptop GPU）');
  assert.equal(vulkanGpuAutoLabelValue(null), '自動');
  assert.equal(effectiveVulkanGpuUuidValue('a', list), 'a');
  assert.equal(effectiveVulkanGpuUuidValue('gone', list), '');
  assert.equal(effectiveVulkanGpuUuidValue('', list), '');
});

test('audio preprocess preset settings validate, round-trip and migrate legacy flags', () => {
  assert.equal(normalizeAudioPreprocessPresetValue('volume_boost'), 'volume_boost');
  assert.equal(normalizeAudioPreprocessPresetValue('manual'), 'none');
  assert.equal(normalizeAudioPreprocessPresetValue(undefined), 'none');

  const kept = stripRemovedSettingsValue({ transcription: { audioPreprocess: 'strong_noise' } });
  assert.equal(kept.transcription?.audioPreprocess, 'strong_noise');
  const invalid = stripRemovedSettingsValue({ transcription: { audioPreprocess: 'bogus' } });
  assert.equal(invalid.transcription?.audioPreprocess, 'none');
  const absent = stripRemovedSettingsValue({ transcription: { language: 'ja' } });
  assert.equal(absent.transcription?.audioPreprocess, undefined);

  const legacy = stripRemovedSettingsValue({
    transcription: { highpassFilter: true, noiseReduction: true, normalizeAudio: true }
  });
  assert.equal(legacy.transcription?.audioPreprocess, 'general_improvement');
  assert.equal(audioPreprocessPresetFromLegacyFlags({ highpassFilter: true }), 'low_noise');
  assert.equal(audioPreprocessPresetFromLegacyFlags({ noiseReduction: true }), 'none');

  const resolved = resolveGeneralAppSettingsValue(kept, {
    transcriptionLanguageOptions: [{ value: 'ja' }],
    playbackRateOptions: [1]
  });
  assert.equal(resolved.audioPreprocess, 'strong_noise');
});
