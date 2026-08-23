import assert from 'node:assert/strict';
import test from 'node:test';

import {
  appendRuntimeEstimateSampleValue,
  buildDocxExportRowsValue,
  buildExportSpeakerLabelByRowIdValue,
  buildFinalInitialPromptValue,
  buildInitialSpeakerAliasMapValue,
  buildInitialSpeakerSelectionMapValue,
  buildLocationDetectionScopeValue,
  buildConsecutiveSpeakerRunMapValue,
  buildSegmentRowNumberMapValue,
  buildSrtExportRowsValue,
  buildXlsxExportRowsValue,
  buildUniqueSpeakersValue,
  canSaveOverallProofreadSystemPromptValue,
  calculateRuntimeEstimateValue,
  computeEnvBackendLabelValue,
  confirmDialogButtonClassValue,
  countSubstringOccurrencesValue,
  displaySpeakerValue,
  editorVoiceInputDownloadButtonColorValue,
  editorVoiceInputMemoryTierValue,
  editorVoiceInputMemoryWarningValue,
  editorVoiceInputUnavailableTooltipValue,
  formatAudioDurationValue,
  formatElapsedMinuteSecondValue,
  formatEstimatedMinutesValue,
  formatMinuteSecondValue,
  formatOverallProofreadProgressValue,
  filterOverallProofreadVisibleItemsValue,
  getAudioPreprocessPresetHintValue,
  getAudioPreprocessSettingsForPresetValue,
  getAudioDurationMessageValue,
  getEditableTextFromMapValue,
  getEstimatedTimeMessageValue,
  getImportCompletedMessageValue,
  getLlmModelFileNameValue,
  getProgressStageOrderValue,
  getLocationAreaPrefectureCodesValue,
  getSpeakerColorClassValue,
  gpuDeviceLabelValue,
  gpuSetupHintValue,
  gpuAsrTierValue,
  hasFallbackInTranscriptionResultValue,
  isGemma4DefaultLlmModelFileNameValue,
  isGemma4DefaultLlmModelPathValue,
  isDiarizationModelMissingValue,
  isJapaneseLanguageValue,
  isPlaybackDisabledValue,
  isVramOomErrorValue,
  levenshteinDistanceValue,
  llmBackendModeHintValue,
  llmBackendModeOptionsValue,
  llmBackendSelectionValue,
  llmNCtxHintValue,
  llmParallelHintValue,
  matchPlaybackShortcutCodeValue,
  inferLocationAreaFromPrefecturesValue,
  normalizeComputeTypeValue,
  normalizeDevEmulationModeValue,
  normalizeErrorMessageValue,
  normalizeLlmMaxBatchValue,
  normalizeLlmNCtxValue,
  normalizeLlmParallelValue,
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
  parallelModeHintValue,
  parseRuntimeEstimateSamplesValue,
  pickRuntimeEstimateSamplesValue,
  resolveRuntimeLogAudioSecondsValue,
  resolveEstimateComputeTypeValue,
  resolveTimeInputRangeValue,
  resolveAudioPreprocessPresetValue,
  resolveAutoLlmParallelValue,
  resolveLlmDeviceVramMibValue,
  resolveLlmInstallableGpuEntryValue,
  resolveLlmTargetBackendKeyValue,
  resolveRuntimeBuildFlagsValue,
  resolveStepForStageValue,
  secondsToEstimatedMinutesValue,
  selectedFileNameValue,
  selectedLocationPrefectureTotalCountValue,
  secretInputTypeValue,
  secretVisibilityIconValue,
  secretVisibilityLabelValue,
  segmentRetranscribeTooltipValue,
  segmentRetranscribeUnavailableReasonValue,
  selectedGpuAsrWarningValue,
  shouldShowVoiceInputShortCandidateHintValue,
  showProofreadSystemPromptEditorValue,
  speakerOptionLabelValue,
  stepTimeInputValuesValue,
  setupNeedsHfTokenValue,
  locationDetectionScopeHintValue,
  themeModeLabelValue,
  themeToggleIconValue,
  transcriptionTabDisabledValue,
  transcriptionTabLabelValue,
  transcriptionRuntimeReasonValue,
  validateHfTokenFormatValue,
  voiceInputButtonTooltipValue,
  processingStatusTextValue
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
    'まだ時間の推定には十分なデータが集まっていません。（2/3件）'
  );
  assert.equal(getEstimatedTimeMessageValue(readyInput), '最低 4 分、概算 6 分');
});

test('GPU labels and setup hints preserve backend, recommendation, and warning text', () => {
  assert.equal(computeEnvBackendLabelValue('cuda'), 'CUDA (NVIDIA)');
  assert.equal(computeEnvBackendLabelValue('rocm'), 'ROCm (AMD)');
  assert.equal(computeEnvBackendLabelValue('none'), 'GPU 未使用');
  assert.equal(gpuDeviceLabelValue({
    index: 2,
    name: 'Radeon',
    totalVramMb: 8192,
    isLikelyIgpu: true,
    gcnArchName: 'gfx1103'
  }, 2, 'rocm'), 'Radeon（8GB ※統合GPU ⚠ 動作未確認 ★推奨）');
  assert.equal(gpuDeviceLabelValue({
    index: 0,
    name: 'GeForce',
    totalVramMb: 12288
  }, 1, 'cuda'), 'GeForce（12GB）');
  assert.match(gpuSetupHintValue(true, ''), /GPU内フォールバック/);
  assert.match(gpuSetupHintValue(false, 'GPU 文字起こしに失敗しました: test'), /GPU 実行に失敗/);
  assert.equal(gpuSetupHintValue(false, '別のエラー'), '');
});

test('LLM backend selection preserves CPU, NVIDIA, AMD, and unavailable priorities', () => {
  assert.equal(resolveLlmInstallableGpuEntryValue(false, false, false, 'gpu', true, false), null);
  assert.equal(resolveLlmInstallableGpuEntryValue(true, true, false, 'gpu', true, false), null);
  assert.equal(resolveLlmInstallableGpuEntryValue(true, false, true, 'gpu', true, false), null);
  assert.deepEqual(resolveLlmInstallableGpuEntryValue(true, false, false, 'cpu', true, true), {
    installKey: 'llamacpp:cpu', label: 'LlamaCPP - CPU', state: 'installable', category: 'cpu'
  });
  assert.deepEqual(resolveLlmInstallableGpuEntryValue(true, false, false, 'gpu', true, true), {
    installKey: 'llamacpp:vulkan', label: 'LlamaCPP - Vulkan (NVIDIA GPU)', state: 'installable', category: 'gpu'
  });
  assert.deepEqual(resolveLlmInstallableGpuEntryValue(true, false, false, 'gpu', false, true), {
    installKey: 'llamacpp:rocm', label: 'LlamaCPP - ROCm (AMD GPU)', state: 'installable', category: 'gpu'
  });
  assert.equal(resolveLlmInstallableGpuEntryValue(true, false, false, 'gpu', false, false), null);
  assert.equal(resolveLlmTargetBackendKeyValue('cpu', true, true), 'llamacpp:cpu');
  assert.equal(resolveLlmTargetBackendKeyValue('gpu', true, true), 'llamacpp:vulkan');
  assert.equal(resolveLlmTargetBackendKeyValue('gpu', false, true), 'llamacpp:rocm');
  assert.equal(resolveLlmTargetBackendKeyValue('gpu', false, false), '');
});

test('Full GPU runtime reasons never promise an unavailable CPU fallback', () => {
  assert.equal(
    transcriptionRuntimeReasonValue(false, 'GPU が確認できませんでした。CPU モードで動作します。', false),
    'GPU が確認できませんでした。Full GPU版ではCPUへ切り替えず、文字起こし・話者分離は利用できません。GPUドライバーとランタイムを確認してください。'
  );
  assert.equal(
    transcriptionRuntimeReasonValue(false, 'CPU モードで動作します。', true),
    'CPU モードで動作します。'
  );
  assert.equal(
    transcriptionRuntimeReasonValue(false, '', false),
    'GPU が確認できないため、文字起こし・話者分離は利用できません。'
  );
  assert.equal(transcriptionRuntimeReasonValue(true, 'CUDA が利用可能です。', false), '');
});

test('LLM mode, VRAM, parallelism, and context hints preserve current UI rules', () => {
  assert.equal(llmBackendModeHintValue('lmstudio', 'e4b', null), '「localhost:1234」に接続します');
  assert.equal(llmBackendModeHintValue('ollama', 'e4b', null), '「localhost:11434」に接続します');
  assert.match(llmBackendModeHintValue('local_gguf', '12b', false), /約7GB/);
  assert.match(llmBackendModeHintValue('local_gguf', '12b', true), /12B.*選択中/);
  assert.match(llmBackendModeHintValue('local_gguf', 'e4b', null), /E4B/);
  const devices = [{ index: 2, totalVramMb: 8192 }, { index: 4, totalVramMb: 16384 }];
  assert.equal(resolveLlmDeviceVramMibValue([], -1, 2), null);
  assert.equal(resolveLlmDeviceVramMibValue(devices, 4, 2), 16384);
  assert.equal(resolveLlmDeviceVramMibValue(devices, -1, 2), 8192);
  assert.equal(resolveLlmDeviceVramMibValue(devices, 99, 4), 8192);
  assert.equal(llmParallelHintValue(1, 'cuda', 8192), '');
  assert.equal(llmParallelHintValue(0, 'rocm', 8192), '');
  assert.equal(llmParallelHintValue(0, 'cuda', null), '');
  assert.equal(llmParallelHintValue(0, 'cuda', 8192), '現在: 2（VRAM 約8GB）');
  assert.equal(llmNCtxHintValue(4096, 'local_gguf', 'cuda', 8192), '');
  assert.equal(llmNCtxHintValue(0, 'ollama', 'cuda', 8192), '');
  assert.equal(llmNCtxHintValue(0, 'local_gguf', 'rocm', 8192), '現在: 16,384');
  assert.equal(llmNCtxHintValue(0, 'local_gguf', 'cuda', 8192), '現在: 16,384（VRAM 約8GB）');
  assert.equal(llmNCtxHintValue(0, 'local_gguf', 'cuda', 16384), '現在: 32,768（VRAM 約16GB）');
});

test('LLM prompt editor and backend option helpers preserve available selections', () => {
  assert.equal(showProofreadSystemPromptEditorValue(true, 'ollama', 'model'), false);
  assert.equal(showProofreadSystemPromptEditorValue(false, 'ollama', ''), true);
  assert.equal(showProofreadSystemPromptEditorValue(false, 'local_gguf', ''), false);
  assert.equal(showProofreadSystemPromptEditorValue(false, 'local_gguf', '/custom.gguf'), true);
  assert.equal(canSaveOverallProofreadSystemPromptValue(true, 'ollama', 'model', ''), false);
  assert.equal(canSaveOverallProofreadSystemPromptValue(false, 'ollama', '  ', ''), false);
  assert.equal(canSaveOverallProofreadSystemPromptValue(false, 'ollama', ' model ', ''), true);
  assert.equal(canSaveOverallProofreadSystemPromptValue(
    false, 'local_gguf', '', '/models/gemma-4-E4B-it-Q4_K_M.gguf'
  ), false);
  assert.equal(canSaveOverallProofreadSystemPromptValue(
    false, 'local_gguf', '', '/models/custom.gguf'
  ), true);
  assert.deepEqual(llmBackendModeOptionsValue(false, false).map((option) => option.value), ['local_gguf']);
  assert.deepEqual(llmBackendModeOptionsValue(true, false).map((option) => option.value), [
    'local_gguf', 'local_gguf_12b'
  ]);
  assert.deepEqual(llmBackendModeOptionsValue(true, true).map((option) => option.value), [
    'local_gguf', 'local_gguf_12b', 'lmstudio', 'ollama'
  ]);
  assert.equal(llmBackendSelectionValue('local_gguf', '12b'), 'local_gguf_12b');
  assert.equal(llmBackendSelectionValue('local_gguf', 'e4b'), 'local_gguf');
  assert.equal(llmBackendSelectionValue('ollama', '12b'), 'ollama');
});

test('language and selected GPU warnings preserve Japanese and ROCm special cases', () => {
  assert.equal(isJapaneseLanguageValue('JA'), true);
  assert.equal(isJapaneseLanguageValue(undefined), true);
  assert.equal(isJapaneseLanguageValue('en'), false);
  assert.equal(selectedGpuAsrWarningValue('cuda', true, 'gfx1103'), '');
  assert.equal(selectedGpuAsrWarningValue('rocm', false, 'gfx1103'), '');
  assert.match(selectedGpuAsrWarningValue('rocm', true, 'gfx1103'), /対応外GPU/);
  assert.equal(selectedGpuAsrWarningValue('rocm', true, 'gfx1102'), '');
  assert.match(selectedGpuAsrWarningValue('rocm', true, 'unknown'), /動作未確認/);
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

test('buildFinalInitialPromptValue preserves prompt trimming and concatenation', () => {
  assert.equal(
    buildFinalInitialPromptValue('  基本指示  ', '  固有名詞を維持する  '),
    '基本指示\n追加指示: 固有名詞を維持する'
  );
  assert.equal(buildFinalInitialPromptValue('  基本指示  ', ' \n '), '基本指示');
  assert.equal(buildFinalInitialPromptValue('', '追加のみ'), '\n追加指示: 追加のみ');
  assert.equal(buildFinalInitialPromptValue(' \n ', ''), '');
});

test('audio preprocessing settings resolve to the same preset and hint text', () => {
  const presets = [
    {
      preset: 'none' as const,
      settings: { highpassFilter: false, noiseReduction: false, normalizeAudio: false, noiseReductionMode: 'weak' as const },
      hint: '録音が良質な場合'
    },
    {
      preset: 'low_noise' as const,
      settings: { highpassFilter: true, noiseReduction: false, normalizeAudio: false, noiseReductionMode: 'weak' as const },
      hint: 'ハイパスフィルター。振動・空調ノイズを除去。'
    },
    {
      preset: 'strong_noise' as const,
      settings: { highpassFilter: true, noiseReduction: true, normalizeAudio: false, noiseReductionMode: 'weak' as const },
      hint: 'ハイパス＋ノイズ除去。背景ノイズを抑制。'
    },
    {
      preset: 'volume_boost' as const,
      settings: { highpassFilter: true, noiseReduction: false, normalizeAudio: true, noiseReductionMode: 'weak' as const },
      hint: 'ハイパス＋正規化。音量の統一と底上げ。'
    },
    {
      preset: 'general_improvement' as const,
      settings: { highpassFilter: true, noiseReduction: true, normalizeAudio: true, noiseReductionMode: 'weak' as const },
      hint: 'ハイパス＋ノイズ除去＋正規化（全処理）'
    }
  ];

  for (const { preset, settings, hint } of presets) {
    assert.deepEqual(getAudioPreprocessSettingsForPresetValue(preset), settings);
    assert.equal(resolveAudioPreprocessPresetValue(settings), preset);
    assert.equal(getAudioPreprocessPresetHintValue(preset), hint);
  }
});

test('manual audio preprocessing preserves the current controls', () => {
  assert.equal(getAudioPreprocessSettingsForPresetValue('manual'), null);
  assert.equal(getAudioPreprocessPresetHintValue('manual'), '');
  assert.equal(resolveAudioPreprocessPresetValue({
    highpassFilter: false,
    noiseReduction: true,
    normalizeAudio: false,
    noiseReductionMode: 'weak'
  }), 'manual');
  assert.equal(resolveAudioPreprocessPresetValue({
    highpassFilter: true,
    noiseReduction: true,
    normalizeAudio: true,
    noiseReductionMode: 'standard'
  }), 'manual');
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

test('Hugging Face token validation preserves accepted values and error categories', () => {
  assert.equal(validateHfTokenFormatValue(''), null);
  assert.equal(validateHfTokenFormatValue('   '), null);
  assert.equal(validateHfTokenFormatValue('  hf_abcdefghijklmnopq  '), null);
  assert.match(validateHfTokenFormatValue('hf_abcdef ghijklmnop') ?? '', /空白や改行/);
  assert.match(validateHfTokenFormatValue('token_abcdefghijklmnop') ?? '', /「hf_」で始まります/);
  assert.match(validateHfTokenFormatValue('hf_short') ?? '', /短すぎます/);
  assert.match(validateHfTokenFormatValue('hf_abcdefghijklmnop-') ?? '', /使用できない文字/);
  assert.match(validateHfTokenFormatValue('hf_あいうえおかきくけこさしすせそたちつてとなにぬねの') ?? '', /使用できない文字/);
});

test('secret field visibility helpers keep type, icon, and accessible label synchronized', () => {
  assert.equal(secretInputTypeValue(false), 'password');
  assert.equal(secretVisibilityIconValue(false), 'visibility');
  assert.equal(secretVisibilityLabelValue(false), 'トークンを表示');
  assert.equal(secretInputTypeValue(true), 'text');
  assert.equal(secretVisibilityIconValue(true), 'visibility_off');
  assert.equal(secretVisibilityLabelValue(true), 'トークンを隠す');
});

test('Levenshtein distance preserves empty, insertion, deletion, and replacement cases', () => {
  assert.equal(levenshteinDistanceValue('', ''), 0);
  assert.equal(levenshteinDistanceValue('', 'abc'), 3);
  assert.equal(levenshteinDistanceValue('abc', ''), 3);
  assert.equal(levenshteinDistanceValue('kitten', 'sitting'), 3);
  assert.equal(levenshteinDistanceValue('文字起こし', '文字おこし'), 1);
  assert.equal(levenshteinDistanceValue('same', 'same'), 0);
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

test('Editor and CPU voice-input memory helpers preserve thresholds and warnings', () => {
  const gib = 1024 ** 3;
  assert.equal(editorVoiceInputMemoryTierValue(false, true, 8 * gib, 16 * gib, 24 * gib), 'unknown');
  assert.equal(editorVoiceInputMemoryTierValue(true, false, 8 * gib, 16 * gib, 24 * gib), 'unknown');
  assert.equal(editorVoiceInputMemoryTierValue(true, true, null, 16 * gib, 24 * gib), 'unknown');
  assert.equal(editorVoiceInputMemoryTierValue(true, true, 15 * gib, 16 * gib, 24 * gib), 'low');
  assert.equal(editorVoiceInputMemoryTierValue(true, true, 16 * gib, 16 * gib, 24 * gib), 'caution');
  assert.equal(editorVoiceInputMemoryTierValue(true, true, 24 * gib, 16 * gib, 24 * gib), 'normal');
  assert.match(editorVoiceInputMemoryWarningValue('low') ?? '', /利用は推奨しません/);
  assert.match(editorVoiceInputMemoryWarningValue('caution') ?? '', /他のアプリ/);
  assert.equal(editorVoiceInputMemoryWarningValue('normal'), null);
  assert.equal(editorVoiceInputDownloadButtonColorValue(true, 'low'), 'warn');
  assert.equal(editorVoiceInputDownloadButtonColorValue(true, 'caution'), 'warn');
  assert.equal(editorVoiceInputDownloadButtonColorValue(true, 'normal'), 'primary');
  assert.equal(editorVoiceInputDownloadButtonColorValue(false, 'low'), 'primary');
});

test('voice-input and segment-retranscription tooltips preserve condition priority', () => {
  assert.equal(editorVoiceInputUnavailableTooltipValue(false), '音声入力パックの状態を確認中です...');
  assert.match(editorVoiceInputUnavailableTooltipValue(true), /モデルをダウンロード/);
  assert.equal(voiceInputButtonTooltipValue(false, '利用不可', true), '利用不可');
  assert.equal(voiceInputButtonTooltipValue(true, '利用不可', true), '録音を停止');
  assert.equal(voiceInputButtonTooltipValue(true, '利用不可', false), '音声入力');

  const available = {
    packChecked: true,
    voiceInputAvailable: true,
    retranscribeSupported: true,
    cpuVoiceInputBuild: false,
    playbackDisabled: false,
    selectedAudioPath: '/audio.wav'
  };
  assert.match(segmentRetranscribeUnavailableReasonValue({ ...available, packChecked: false }) ?? '', /確認中/);
  assert.match(segmentRetranscribeUnavailableReasonValue({ ...available, voiceInputAvailable: false }) ?? '', /モデルをダウンロード/);
  assert.match(segmentRetranscribeUnavailableReasonValue({
    ...available, retranscribeSupported: false, cpuVoiceInputBuild: true
  }) ?? '', /ffmpeg が未導入/);
  assert.match(segmentRetranscribeUnavailableReasonValue({
    ...available, retranscribeSupported: false
  }) ?? '', /利用できません/);
  assert.match(segmentRetranscribeUnavailableReasonValue({
    ...available, selectedAudioPath: ''
  }) ?? '', /音声ファイルを読み込む/);
  assert.equal(segmentRetranscribeUnavailableReasonValue(available), null);
  assert.equal(segmentRetranscribeTooltipValue('利用不可', true), '利用不可');
  assert.equal(segmentRetranscribeTooltipValue(null, true), '候補を生成中...');
  assert.equal(segmentRetranscribeTooltipValue(null, false), 'この区間を別のAIで再文字起こしする');
});

test('result and transcription tab helpers preserve setup labels', () => {
  assert.equal(isPlaybackDisabledValue(true, false), true);
  assert.equal(isPlaybackDisabledValue(true, true), false);
  assert.equal(isPlaybackDisabledValue(false, false), false);
  assert.equal(isDiarizationModelMissingValue(false, false, false), false);
  assert.equal(isDiarizationModelMissingValue(true, false, true), true);
  assert.equal(isDiarizationModelMissingValue(true, true, false), true);
  assert.equal(isDiarizationModelMissingValue(true, true, true), false);
  assert.equal(transcriptionTabLabelValue(false, true, false), '文字起こし（要設定）');
  assert.equal(transcriptionTabLabelValue(true, false, true), '文字起こし（要設定）');
  assert.equal(transcriptionTabLabelValue(true, false, false), '文字起こし（要GPU設定）');
  assert.equal(transcriptionTabLabelValue(false, false, false), '文字起こし');
});

test('tab and setup-adjacent helpers preserve safe UI states', () => {
  const tabInput = {
    transcriptionTabVisible: true,
    editorOnlyBuild: false,
    setupChecked: true,
    devEmulationMode: 'none' as const,
    cpuOnlyBuild: false,
    needsFullSetup: false,
    pythonEnvReady: true,
    transcriptionRuntimeAvailable: true
  };
  assert.equal(transcriptionTabDisabledValue(tabInput), false);
  assert.equal(transcriptionTabDisabledValue({ ...tabInput, devEmulationMode: 'no_cuda' }), true);
  assert.equal(transcriptionTabDisabledValue({
    ...tabInput, devEmulationMode: 'no_cuda', cpuOnlyBuild: true
  }), false);
  assert.equal(transcriptionTabDisabledValue({
    ...tabInput, transcriptionRuntimeAvailable: false
  }), true);
  assert.equal(transcriptionTabDisabledValue({
    ...tabInput, transcriptionRuntimeAvailable: false, needsFullSetup: true
  }), false);
  assert.equal(transcriptionTabDisabledValue({
    ...tabInput, transcriptionRuntimeAvailable: false, pythonEnvReady: false
  }), false);
  assert.equal(setupNeedsHfTokenValue(true, true, false, '  '), true);
  assert.equal(setupNeedsHfTokenValue(true, true, false, 'hf_token'), false);
  assert.equal(setupNeedsHfTokenValue(true, true, true, ''), false);
  assert.equal(parallelModeHintValue('standard'), '標準・安定');
  assert.equal(parallelModeHintValue('fast'), 'GPUスペックに余裕がある場合のみ');
});

test('processing status text preserves combined transcription and proofreading labels', () => {
  const idle = {
    visible: true,
    transcriptionRunning: false,
    displayProgress: 0,
    diarizationPhaseActive: false,
    diarizationStage: '',
    parallelDiarizationStatus: '',
    llmProofreadRunning: false,
    llmProofreadStatus: '',
    ruleProofreadRunning: false,
    cpuOnlyBuild: false,
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
    llmProofreadRunning: true,
    llmProofreadStatus: '校正中: 3 / 10 行'
  }), 'AI校正：3/10行');
  assert.equal(processingStatusTextValue({
    ...idle,
    ruleProofreadRunning: true,
    cpuOnlyBuild: true,
    ruleProofreadStatus: '2/5'
  }), '単純句読点付与：2/5');
});

test('overall proofread visible items require changes and exclude dismissed IDs', () => {
  const items = [
    { id: 1, changed: true, text: 'a' },
    { id: 2, changed: false, text: 'b' },
    { id: 3, changed: true, text: 'c' }
  ];
  assert.deepEqual(filterOverallProofreadVisibleItemsValue(items, new Set([3])), [items[0]]);
  assert.deepEqual(filterOverallProofreadVisibleItemsValue(null, new Set()), []);
});

test('runtime estimate helpers preserve minute rounding and effective compute types', () => {
  assert.equal(secondsToEstimatedMinutesValue(Number.NaN), 0);
  assert.equal(secondsToEstimatedMinutesValue(Number.POSITIVE_INFINITY), 0);
  assert.equal(secondsToEstimatedMinutesValue(0), 0);
  assert.equal(secondsToEstimatedMinutesValue(-1), 0);
  assert.equal(secondsToEstimatedMinutesValue(0.1), 1);
  assert.equal(secondsToEstimatedMinutesValue(60), 1);
  assert.equal(secondsToEstimatedMinutesValue(60.1), 2);
  assert.equal(resolveEstimateComputeTypeValue('cpu', 'float32'), 'int8');
  assert.equal(resolveEstimateComputeTypeValue('cuda', 'auto'), 'float16');
  assert.equal(resolveEstimateComputeTypeValue('cuda', 'int8_float16'), 'int8_float16');
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

  assert.deepEqual(parseRuntimeEstimateSamplesValue(serialized, false), [
    { audioSeconds: 60, elapsedSeconds: 30, diarization: true, device: 'cpu', computeType: 'int8', createdAt: 1, fileSizeBytes: null },
    { audioSeconds: 90, elapsedSeconds: 45, diarization: false, device: 'cuda', computeType: 'float16', createdAt: 2, fileSizeBytes: 1234 },
    { audioSeconds: -1, elapsedSeconds: -2, diarization: true, device: 'cuda', computeType: 'float32', createdAt: 3, fileSizeBytes: null }
  ]);
  assert.equal(parseRuntimeEstimateSamplesValue(serialized, true)[1]?.device, 'cpu');
  assert.deepEqual(parseRuntimeEstimateSamplesValue(null, false), []);
  assert.deepEqual(parseRuntimeEstimateSamplesValue('{', false), []);
  assert.deepEqual(parseRuntimeEstimateSamplesValue('{}', false), []);
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

test('substring occurrence counting preserves non-overlapping replace-all semantics', () => {
  assert.equal(countSubstringOccurrencesValue('abc abc abc', 'abc'), 3);
  assert.equal(countSubstringOccurrencesValue('aaaa', 'aa'), 2);
  assert.equal(countSubstringOccurrencesValue('東京東京', '東京'), 2);
  assert.equal(countSubstringOccurrencesValue('abc', 'x'), 0);
  assert.equal(countSubstringOccurrencesValue('abc', ''), 0);
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

test('overall proofread progress clamps and rounds values for display', () => {
  assert.equal(formatOverallProofreadProgressValue(3.9, 10.8), '校正中: 3 / 10 行');
  assert.equal(formatOverallProofreadProgressValue(12, 10), '校正中: 10 / 10 行');
  assert.equal(formatOverallProofreadProgressValue(-1, 10), '校正中: 0 / 10 行');
  assert.equal(formatOverallProofreadProgressValue(2, -1), '校正中: 0 / 0 行');
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

test('automatic LLM parallelism preserves VRAM thresholds', () => {
  assert.equal(resolveAutoLlmParallelValue(Number.NaN), 1);
  assert.equal(resolveAutoLlmParallelValue(6999), 1);
  assert.equal(resolveAutoLlmParallelValue(7000), 2);
  assert.equal(resolveAutoLlmParallelValue(10999), 2);
  assert.equal(resolveAutoLlmParallelValue(11000), 4);
});

test('GPU ASR tier cautions only unknown ROCm architectures', () => {
  assert.equal(gpuAsrTierValue('cuda', 'gfx1103'), 'ok');
  assert.equal(gpuAsrTierValue('rocm', 'GFX1102'), 'ok');
  assert.equal(gpuAsrTierValue('rocm', 'gfx1150'), 'ok');
  assert.equal(gpuAsrTierValue('rocm', 'gfx1103'), 'caution');
  assert.equal(gpuAsrTierValue('rocm', null), 'caution');
});

test('VRAM OOM detection preserves backend marker variants', () => {
  const messages = [
    '[VRAM_OOM] launch failed',
    'CUDA out of memory',
    'failed to allocate buffer',
    'cudaMalloc returned an error',
    'CUDAErrorMemoryAllocation',
    'ggml_backend_cuda_buffer allocation failed'
  ];
  for (const message of messages) {
    assert.equal(isVramOomErrorValue(message), true);
  }
  assert.equal(isVramOomErrorValue('model file not found'), false);
  assert.equal(isVramOomErrorValue(''), false);
  assert.equal(isVramOomErrorValue(null), false);
});

test('Gemma default model helpers support Windows, Unix, QAT, and legacy names', () => {
  assert.equal(
    getLlmModelFileNameValue(' C:\\models\\gemma-4-E4B-it-qat-UD-Q4_K_XL.gguf '),
    'gemma-4-E4B-it-qat-UD-Q4_K_XL.gguf'
  );
  assert.equal(getLlmModelFileNameValue('/models/custom.gguf'), 'custom.gguf');
  assert.equal(getLlmModelFileNameValue('/models/'), '');
  assert.equal(getLlmModelFileNameValue(''), '');
  assert.equal(isGemma4DefaultLlmModelFileNameValue(' GEMMA-4-E4B-IT-QAT-UD-Q4_K_XL.GGUF '), true);
  assert.equal(isGemma4DefaultLlmModelFileNameValue('gemma-4-E4B-it-qat-UD-Q4_K_XL'), true);
  assert.equal(isGemma4DefaultLlmModelFileNameValue('gemma-4-E4B-it-Q4_K_M.gguf'), true);
  assert.equal(isGemma4DefaultLlmModelFileNameValue('custom.gguf'), false);
  assert.equal(isGemma4DefaultLlmModelPathValue('/models/gemma-4-E4B-it-Q4_K_M.gguf'), true);
  assert.equal(isGemma4DefaultLlmModelPathValue('/models/custom.gguf'), false);
});

test('development emulation mode accepts only supported persisted values', () => {
  assert.equal(normalizeDevEmulationModeValue(' NO_CUDA '), 'no_cuda');
  assert.equal(normalizeDevEmulationModeValue('Missing_Community1'), 'missing_community1');
  assert.equal(normalizeDevEmulationModeValue('unknown'), 'none');
  assert.equal(normalizeDevEmulationModeValue(null), 'none');
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

test('runtime build flags trust the Rust CPU variant even when the frontend default leaked into a package', () => {
  assert.deepEqual(resolveRuntimeBuildFlagsValue(false, false, 'cpu'), {
    cpuOnlyBuild: true,
    aiProofreadBuild: false,
    cpuVoiceInputBuild: true
  });
  assert.deepEqual(resolveRuntimeBuildFlagsValue(false, true, 'cuda'), {
    cpuOnlyBuild: false,
    aiProofreadBuild: true,
    cpuVoiceInputBuild: false
  });
  assert.deepEqual(resolveRuntimeBuildFlagsValue(false, false, 'cuda'), {
    cpuOnlyBuild: false,
    aiProofreadBuild: true,
    cpuVoiceInputBuild: false
  });
  assert.deepEqual(resolveRuntimeBuildFlagsValue(false, true, null), {
    cpuOnlyBuild: true,
    aiProofreadBuild: false,
    cpuVoiceInputBuild: true
  });
  assert.deepEqual(resolveRuntimeBuildFlagsValue(true, false, 'cpu'), {
    cpuOnlyBuild: true,
    aiProofreadBuild: false,
    cpuVoiceInputBuild: true
  });
});
