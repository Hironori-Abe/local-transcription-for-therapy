export type DefaultExportFileKind = 'docx' | 'xlsx' | 'srt' | 'json' | 'runtime-csv';
export type NormalizedComputeType = 'auto' | 'float16' | 'float32' | 'int8_float16' | 'int8';
export type ConcreteComputeType = Exclude<NormalizedComputeType, 'auto'>;
export type NormalizedThemeMode = 'system' | 'light' | 'dark';
export type NormalizedTranscriptionDevice = 'cuda' | 'cpu';
export type DevEmulationMode = 'none' | 'no_cuda' | 'missing_community1';
export type AudioPreprocessPreset = 'none' | 'low_noise' | 'strong_noise' | 'volume_boost' | 'general_improvement' | 'manual';
export type NoiseReductionMode = 'standard' | 'weak';
export type PlaybackShortcutCode = 'Space' | 'KeyA' | 'KeyD' | 'KeyE';
export type EditorVoiceInputMemoryTierValue = 'unknown' | 'low' | 'caution' | 'normal';
export type LocationDetectionMode = 'commonOnly' | 'selectedRegions';
export type LocationAreaCode =
  | 'hokkaidoTohoku'
  | 'kanto'
  | 'chubu'
  | 'kinki'
  | 'chugoku'
  | 'shikoku'
  | 'kyushuOkinawa';

export interface LocationDetectionScope {
  mode: LocationDetectionMode;
  area?: LocationAreaCode;
  prefectures: string[];
  prefecturesByArea?: Partial<Record<LocationAreaCode, string[]>>;
}

export interface RuntimeEstimateSample {
  audioSeconds: number;
  elapsedSeconds: number;
  diarization: boolean;
  device: string;
  computeType: string;
  createdAt: number;
  fileSizeBytes?: number | null;
}

export interface RuntimeEstimateCalculation {
  ready: boolean;
  minMinutes: number | null;
  avgMinutes: number | null;
  avgSeconds: number | null;
}

export interface TranscriptionFallbackResultInput {
  fallbackUsed?: boolean;
  diarization?: {
    note?: string | null;
  } | null;
}

export interface DocumentExportSourceRow {
  id: number;
  startSeconds: number;
  endSeconds: number;
  speakerLabel: string;
  text: string;
}

export interface InitialSpeakerSourceRow {
  id: number;
  speaker?: string | null;
}

export interface SaveDocxRow {
  time: string;
  speaker: string;
  text: string;
}

export interface SaveXlsxRow {
  start: string;
  end: string;
  speaker: string;
  text: string;
}

export interface SaveSrtRow {
  startSeconds: number;
  endSeconds: number;
  speaker: string;
  text: string;
}

export interface AudioPreprocessSettingsValue {
  highpassFilter: boolean;
  noiseReduction: boolean;
  normalizeAudio: boolean;
  noiseReductionMode: NoiseReductionMode;
}

export interface TimeInputValuesValue {
  startMm: string;
  startSs: string;
  endMm: string;
  endSs: string;
}

export interface ResolvedTimeRangeValue {
  startSeconds: number;
  endSeconds: number;
}

export type TimeInputFieldValue = 'startMm' | 'startSs' | 'endMm' | 'endSs';

export interface DownloadProgressValue {
  downloadedBytes?: number;
  totalBytes?: number;
}

export interface GpuDeviceLabelValueInput {
  index: number;
  name: string;
  totalVramMb: number;
  isLikelyIgpu?: boolean;
  gcnArchName?: string;
}

export interface EstimatedTimeMessageValueInput {
  estimating: boolean;
  audioSeconds: number | null;
  estimateReady: boolean;
  sampleCount: number;
  minimumSamples: number;
  minMinutes: number | null;
  avgMinutes: number | null;
}

export interface EditableTextSourceValue {
  id: number;
  text?: string | null;
}

export interface ProcessingStatusTextValueInput {
  visible: boolean;
  transcriptionRunning: boolean;
  displayProgress: number;
  diarizationPhaseActive: boolean;
  diarizationStage: string;
  parallelDiarizationStatus: string;
  llmProofreadRunning: boolean;
  llmProofreadStatus: string;
  ruleProofreadRunning: boolean;
  cpuOnlyBuild: boolean;
  ruleProofreadProgressText: string;
  ruleProofreadStatus: string;
}

export interface SegmentRetranscribeAvailabilityValueInput {
  packChecked: boolean;
  voiceInputAvailable: boolean;
  retranscribeSupported: boolean;
  cpuVoiceInputBuild: boolean;
  playbackDisabled: boolean;
  selectedAudioPath: string;
}

export interface LlmInstallableBackendEntryValue {
  label: string;
  state: 'installable';
  category: 'gpu' | 'cpu';
  installKey: string;
}

export interface LlmDeviceMemoryValueInput {
  index: number;
  totalVramMb: number;
}

export interface FullSetupStatusValueInput {
  pythonEnv: boolean;
  whisperTurbo: boolean;
  diarization: boolean;
  gemmaGguf: boolean;
  gemmaMtpGguf: boolean;
  llmBackend: boolean;
}

export interface NeedsFullSetupValueInput {
  editorOnlyBuild: boolean;
  tauriRuntime: boolean;
  setupChecked: boolean;
  status: FullSetupStatusValueInput | null;
  transcriptionTabVisible: boolean;
  aiProofreadBuild: boolean;
  buildVariant: string;
}

export interface TranscriptionTabDisabledValueInput {
  transcriptionTabVisible: boolean;
  editorOnlyBuild: boolean;
  setupChecked: boolean;
  devEmulationMode: DevEmulationMode;
  cpuOnlyBuild: boolean;
  needsFullSetup: boolean;
  pythonEnvReady: boolean;
  transcriptionRuntimeAvailable: boolean;
}

export interface VoiceInputContextLineValue {
  rowNumber?: number;
  speaker?: string | null;
  text: string;
}

export interface VoiceInputContextValue {
  previous?: VoiceInputContextLineValue | null;
  current?: VoiceInputContextLineValue | null;
  next?: VoiceInputContextLineValue | null;
}

export type ConfirmDialogColorValue = 'primary' | 'accent' | 'warn' | null;

export function resolveAudioPreprocessPresetValue(
  settings: AudioPreprocessSettingsValue
): AudioPreprocessPreset {
  const { highpassFilter, noiseReduction, normalizeAudio, noiseReductionMode } = settings;
  if (!highpassFilter && !noiseReduction && !normalizeAudio) {
    return 'none';
  }
  if (highpassFilter && !noiseReduction && !normalizeAudio) {
    return 'low_noise';
  }
  if (highpassFilter && noiseReduction && !normalizeAudio && noiseReductionMode === 'weak') {
    return 'strong_noise';
  }
  if (highpassFilter && !noiseReduction && normalizeAudio) {
    return 'volume_boost';
  }
  if (highpassFilter && noiseReduction && normalizeAudio && noiseReductionMode === 'weak') {
    return 'general_improvement';
  }
  return 'manual';
}

export function getAudioPreprocessPresetHintValue(preset: AudioPreprocessPreset): string {
  switch (preset) {
    case 'none':
      return '録音が良質な場合';
    case 'low_noise':
      return 'ハイパスフィルター。振動・空調ノイズを除去。';
    case 'strong_noise':
      return 'ハイパス＋ノイズ除去。背景ノイズを抑制。';
    case 'volume_boost':
      return 'ハイパス＋正規化。音量の統一と底上げ。';
    case 'general_improvement':
      return 'ハイパス＋ノイズ除去＋正規化（全処理）';
    case 'manual':
      return '';
  }
}

export function getAudioPreprocessSettingsForPresetValue(
  preset: AudioPreprocessPreset
): AudioPreprocessSettingsValue | null {
  switch (preset) {
    case 'none':
      return { highpassFilter: false, noiseReduction: false, normalizeAudio: false, noiseReductionMode: 'weak' };
    case 'low_noise':
      return { highpassFilter: true, noiseReduction: false, normalizeAudio: false, noiseReductionMode: 'weak' };
    case 'strong_noise':
      return { highpassFilter: true, noiseReduction: true, normalizeAudio: false, noiseReductionMode: 'weak' };
    case 'volume_boost':
      return { highpassFilter: true, noiseReduction: false, normalizeAudio: true, noiseReductionMode: 'weak' };
    case 'general_improvement':
      return { highpassFilter: true, noiseReduction: true, normalizeAudio: true, noiseReductionMode: 'weak' };
    case 'manual':
      return null;
  }
}

export function normalizeSpeakerKeyValue(value: string | null | undefined): string {
  return (value ?? '').trim();
}

export function displaySpeakerValue(
  source: string | null | undefined,
  speakerAliasMap: Readonly<Record<string, string>>
): string {
  if (!source) {
    return '-';
  }
  const alias = speakerAliasMap[source];
  return alias && alias.length > 0 ? alias : source;
}

export function speakerOptionLabelValue(
  key: string,
  speakerAliasMap: Readonly<Record<string, string>>
): string {
  const alias = displaySpeakerValue(key, speakerAliasMap);
  return alias === key ? key : `${alias} (${key})`;
}

export function getSpeakerColorClassValue(speakerKey: string): string {
  const match = speakerKey.match(/^SPEAKER_(\d+)$/);
  if (!match) {
    return '';
  }
  return `speaker-color-${Math.min(parseInt(match[1], 10), 4) + 1}`;
}

/** Prefer layout-independent KeyboardEvent.code and fall back to KeyboardEvent.key. */
export function matchPlaybackShortcutCodeValue(
  codeRaw: string | null | undefined,
  keyRaw: string | null | undefined
): PlaybackShortcutCode | null {
  const knownCodes: ReadonlyArray<PlaybackShortcutCode> = ['Space', 'KeyA', 'KeyD', 'KeyE'];
  const code = codeRaw as PlaybackShortcutCode;
  if (knownCodes.includes(code)) {
    return code;
  }
  switch ((keyRaw ?? '').toLowerCase()) {
    case ' ':
    case 'spacebar':
      return 'Space';
    case 'a':
      return 'KeyA';
    case 'd':
      return 'KeyD';
    case 'e':
      return 'KeyE';
    default:
      return null;
  }
}

export function validateHfTokenFormatValue(rawToken: string): string | null {
  const token = (rawToken ?? '').trim();
  if (!token) {
    return null;
  }
  if (/\s/.test(token)) {
    return (
      'トークンに空白や改行が含まれています。\n' +
      '● トークンの前後や途中に余分な空白・改行が入っていないか確認してください。\n' +
      '● コピー＆ペーストで貼り付け直すと混入を防げます。'
    );
  }
  if (!token.startsWith('hf_')) {
    return (
      'Hugging Face のアクセストークンは「hf_」で始まります。入力された値はその形式になっていません。\n' +
      '● トークンをすべて選択してコピーし、貼り付け直してください（先頭が欠けていることがあります）。\n' +
      '● ユーザー名や別の値を貼り付けていないか確認してください。'
    );
  }
  if (token.length < 20) {
    return (
      'トークンが短すぎます。途中で切れている可能性があります。\n' +
      '● トークン全体をコピーできているか確認し、貼り付け直してください。'
    );
  }
  if (!/^hf_[A-Za-z0-9]+$/.test(token)) {
    return (
      'トークンに使用できない文字が含まれています（記号や全角文字が混入している可能性があります）。\n' +
      '● 日本語入力（IME）がオンのまま入力していないか確認してください。\n' +
      '● 「トークン作成ページを開く」から発行した値をコピー＆ペーストで貼り付けてください。'
    );
  }
  return null;
}

export function coalescingInputKindValue(inputKind: string): string {
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

export function changedRangeEndValue(before: string, after: string): number {
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

export function resolveTimeInputRangeValue(values: TimeInputValuesValue): ResolvedTimeRangeValue | null {
  const startMm = parseInt(values.startMm, 10);
  const startSs = parseInt(values.startSs, 10);
  const endMm = parseInt(values.endMm, 10);
  const endSs = parseInt(values.endSs, 10);
  if (
    !Number.isFinite(startMm) || !Number.isFinite(startSs) ||
    !Number.isFinite(endMm) || !Number.isFinite(endSs) ||
    startMm < 0 || endMm < 0 ||
    startSs < 0 || startSs > 59 || endSs < 0 || endSs > 59
  ) {
    return null;
  }
  const startSeconds = startMm * 60 + startSs;
  const endSeconds = endMm * 60 + endSs;
  return startSeconds <= endSeconds
    ? { startSeconds, endSeconds }
    : { startSeconds: endSeconds, endSeconds: startSeconds };
}

export function normalizeTimeInputValue(value: string): string {
  return value.replace(/[^0-9]/g, '');
}

export function normalizeVoiceInputErrorMessageValue(error: unknown): string {
  const message = normalizeErrorMessageValue(error);
  const lower = message.toLowerCase();
  if (
    lower.includes('notallowederror') ||
    lower.includes('not allowed') ||
    lower.includes('permission') ||
    lower.includes('denied')
  ) {
    return 'マイク入力が許可されませんでした。OSまたはWebViewのマイク権限を許可してから再試行してください。';
  }
  if (lower.includes('notfounderror') || lower.includes('device not found')) {
    return '利用可能なマイクが見つかりません。';
  }
  return message;
}

export function selectedFileNameValue(fullPath: string): string {
  if (!fullPath) {
    return '';
  }
  const normalized = fullPath.replace(/\\/g, '/');
  const index = normalized.lastIndexOf('/');
  return index >= 0 ? normalized.slice(index + 1) : normalized;
}

export function gpuSetupHintValue(fallbackUsed: boolean, errorMessage: string): string {
  if (fallbackUsed) {
    return [
      'GPU 実行が不安定だったため、GPU内フォールバックが発生しました。',
      'Windows の「設定 > システム > ディスプレイ > グラフィック」で',
      'offline-transcriber.exe / python.exe / py.exe を',
      '「高パフォーマンス (RTX)」に設定すると安定する場合があります。'
    ].join('\n');
  }
  if (errorMessage.includes('GPU 文字起こしに失敗しました')) {
    return [
      'GPU 実行に失敗しています。',
      'Windows のグラフィック設定および NVIDIA コントロールパネルで',
      'offline-transcriber.exe / python.exe / py.exe を',
      'RTX 側へ固定してください。'
    ].join('\n');
  }
  return '';
}

export function formatEstimatedMinutesValue(minutes: number | null): string {
  if (minutes === null || Number.isNaN(minutes)) {
    return '-';
  }
  return `${minutes}`;
}

export function getAudioDurationMessageValue(establishingEstimate: boolean, seconds: number | null): string {
  return establishingEstimate ? '（計算中...）' : formatAudioDurationValue(seconds);
}

export function getEstimatedTimeMessageValue(input: EstimatedTimeMessageValueInput): string {
  if (input.estimating) {
    return '（計算中...）';
  }
  if (!input.audioSeconds || input.audioSeconds <= 0) {
    return '音声ファイルを選択すると表示されます。';
  }
  if (!input.estimateReady) {
    return `まだ時間の推定には十分なデータが集まっていません。（${input.sampleCount}/${input.minimumSamples}件）`;
  }
  return `最低 ${formatEstimatedMinutesValue(input.minMinutes)} 分、概算 ${formatEstimatedMinutesValue(input.avgMinutes)} 分`;
}

export function computeEnvBackendLabelValue(backend: string | null | undefined): string {
  if (backend === 'cuda') {
    return 'CUDA (NVIDIA)';
  }
  if (backend === 'rocm') {
    return 'ROCm (AMD)';
  }
  return 'GPU 未使用';
}

export function gpuDeviceLabelValue(
  device: GpuDeviceLabelValueInput,
  recommendedIndex: number,
  backendType: string | null | undefined
): string {
  const gb = (device.totalVramMb / 1024).toFixed(0);
  const recommended = device.index === recommendedIndex ? ' ★推奨' : '';
  const integrated = device.isLikelyIgpu ? ' ※統合GPU' : '';
  const warning = gpuAsrTierValue(backendType, device.gcnArchName) === 'caution'
    ? ' ⚠ 動作未確認'
    : '';
  return `${device.name}（${gb}GB${integrated}${warning}${recommended}）`;
}

export function getImportCompletedMessageValue(canShowTranscriptionTab: boolean): string {
  return canShowTranscriptionTab
    ? '読み取りが完了しました。文字起こしタブでも編集できます。'
    : '読み取りが完了しました。';
}

export function getEditableTextFromMapValue(
  segment: EditableTextSourceValue,
  map: Partial<Record<number, string>>
): string {
  const found = map[segment.id];
  return typeof found === 'string' ? found : (segment.text ?? '');
}

export function confirmDialogButtonClassValue(
  color: ConfirmDialogColorValue,
  role: 'confirm' | 'cancel'
): string {
  const roleClass = role === 'confirm' ? 'confirm-dialog-btn-confirm' : 'confirm-dialog-btn-cancel';
  const colorClass = color ? ` confirm-dialog-btn-${color}` : '';
  return `confirm-dialog-btn ${roleClass}${colorClass}`;
}

export function themeToggleIconValue(themeMode: NormalizedThemeMode): string {
  switch (themeMode) {
    case 'light':
      return 'light_mode';
    case 'dark':
      return 'dark_mode';
    case 'system':
      return 'brightness_auto';
  }
}

export function downloadProgressPercentValue(progress: DownloadProgressValue | null | undefined): number {
  if (!progress?.downloadedBytes || !progress?.totalBytes) {
    return 0;
  }
  return Math.min(100, (progress.downloadedBytes / progress.totalBytes) * 100);
}

export function downloadProgressBytesLabelValue(progress: DownloadProgressValue | null | undefined): string {
  if (!progress?.downloadedBytes) {
    return '';
  }
  const downloadedMb = Math.round(progress.downloadedBytes / 1_048_576);
  if (progress.totalBytes) {
    return `${downloadedMb} / ${Math.round(progress.totalBytes / 1_048_576)} MB`;
  }
  return `${downloadedMb} MB`;
}

export function aggregateDownloadProgressPercentValue(
  progressValues: ReadonlyArray<DownloadProgressValue>
): number | null {
  const totals = progressValues.filter(
    (progress) => Number.isFinite(progress.totalBytes) && Number(progress.totalBytes) > 0
  );
  if (totals.length === 0) {
    return null;
  }
  const downloaded = totals.reduce(
    (sum, progress) => sum + Math.max(0, Number(progress.downloadedBytes ?? 0)),
    0
  );
  const total = totals.reduce(
    (sum, progress) => sum + Math.max(0, Number(progress.totalBytes ?? 0)),
    0
  );
  return total > 0 ? Math.max(0, Math.min(100, (downloaded / total) * 100)) : null;
}

export function selectedLocationPrefectureTotalCountValue(
  prefecturesByArea: Readonly<Partial<Record<LocationAreaCode, string[]>>>,
  selectedPrefectures: ReadonlyArray<string>
): number {
  const selectedCodes = new Set<string>();
  for (const prefectures of Object.values(prefecturesByArea)) {
    for (const code of prefectures ?? []) {
      selectedCodes.add(code);
    }
  }
  for (const code of selectedPrefectures) {
    selectedCodes.add(code);
  }
  return selectedCodes.size;
}

export function locationDetectionScopeHintValue(count: number): string {
  return count > 0
    ? `全国共通に加えて選択地域 全体 ${count} 件を詳しく確認します。`
    : '全国共通のみ確認します。';
}

export function buildSegmentRowNumberMapValue(
  segments: ReadonlyArray<{ id: number }>,
  hiddenSegmentIds: Readonly<Record<number, boolean>>
): Record<number, number> {
  const map: Record<number, number> = {};
  let rowNumber = 0;
  for (const segment of segments) {
    if (!hiddenSegmentIds[segment.id]) {
      map[segment.id] = ++rowNumber;
    }
  }
  return map;
}

export function buildUniqueSpeakersValue(
  segments: ReadonlyArray<{ speaker?: string | null }>,
  selectedSpeakerBySegmentId: Readonly<Record<number, string>>
): string[] {
  const names = new Set<string>();
  for (const segment of segments) {
    if (segment.speaker) {
      names.add(segment.speaker);
    }
  }
  for (const selected of Object.values(selectedSpeakerBySegmentId)) {
    if (selected && selected.trim().length > 0) {
      names.add(selected.trim());
    }
  }
  return Array.from(names).sort();
}

export function levenshteinDistanceValue(left: string, right: string): number {
  const leftLength = left.length;
  const rightLength = right.length;
  const distances: number[] = Array.from({ length: rightLength + 1 }, (_, index) => index);
  for (let leftIndex = 1; leftIndex <= leftLength; leftIndex++) {
    let previous = distances[0];
    distances[0] = leftIndex;
    for (let rightIndex = 1; rightIndex <= rightLength; rightIndex++) {
      const saved = distances[rightIndex];
      distances[rightIndex] = left[leftIndex - 1] === right[rightIndex - 1]
        ? previous
        : 1 + Math.min(previous, distances[rightIndex], distances[rightIndex - 1]);
      previous = saved;
    }
  }
  return distances[rightLength];
}

export function stepTimeInputValuesValue(
  values: TimeInputValuesValue,
  field: TimeInputFieldValue,
  delta: 1 | -1
): TimeInputValuesValue | null {
  const current = parseInt(values[field], 10);
  if (!Number.isFinite(current)) {
    return null;
  }
  const isSeconds = field.endsWith('Ss');
  const candidate = isSeconds
    ? Math.max(0, Math.min(59, current + delta))
    : Math.max(0, current + delta);

  const startTotal = parseInt(values.startMm, 10) * 60 + parseInt(values.startSs, 10);
  const endTotal = parseInt(values.endMm, 10) * 60 + parseInt(values.endSs, 10);
  if (field.startsWith('start')) {
    const newStart = (field === 'startMm' ? candidate : parseInt(values.startMm, 10)) * 60
      + (field === 'startSs' ? candidate : parseInt(values.startSs, 10));
    if (newStart > endTotal) {
      return null;
    }
  } else {
    const newEnd = (field === 'endMm' ? candidate : parseInt(values.endMm, 10)) * 60
      + (field === 'endSs' ? candidate : parseInt(values.endSs, 10));
    if (newEnd < startTotal) {
      return null;
    }
  }

  return {
    ...values,
    [field]: isSeconds ? String(candidate).padStart(2, '0') : String(candidate)
  };
}

export function mergeFloat32ChunksValue(chunks: ReadonlyArray<Float32Array>): Float32Array {
  const totalLength = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const merged = new Float32Array(totalLength);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.length;
  }
  return merged;
}

export function resamplePcmTo16kValue(input: Float32Array, inputSampleRate: number): Float32Array {
  const outputSampleRate = 16000;
  if (inputSampleRate === outputSampleRate) {
    return input;
  }
  const ratio = inputSampleRate / outputSampleRate;
  const outputLength = Math.max(1, Math.floor(input.length / ratio));
  const output = new Float32Array(outputLength);
  for (let index = 0; index < outputLength; index++) {
    const sourceIndex = index * ratio;
    const left = Math.floor(sourceIndex);
    const right = Math.min(input.length - 1, left + 1);
    const fraction = sourceIndex - left;
    output[index] = input[left] * (1 - fraction) + input[right] * fraction;
  }
  return output;
}

function writeAsciiValue(view: DataView, offset: number, value: string): void {
  for (let index = 0; index < value.length; index++) {
    view.setUint8(offset + index, value.charCodeAt(index));
  }
}

export function encodePcm16WavValue(samples: Float32Array, sampleRate: number): ArrayBuffer {
  const bytesPerSample = 2;
  const dataSize = samples.length * bytesPerSample;
  const buffer = new ArrayBuffer(44 + dataSize);
  const view = new DataView(buffer);
  writeAsciiValue(view, 0, 'RIFF');
  view.setUint32(4, 36 + dataSize, true);
  writeAsciiValue(view, 8, 'WAVE');
  writeAsciiValue(view, 12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * bytesPerSample, true);
  view.setUint16(32, bytesPerSample, true);
  view.setUint16(34, 16, true);
  writeAsciiValue(view, 36, 'data');
  view.setUint32(40, dataSize, true);
  let offset = 44;
  for (const sample of samples) {
    const clamped = Math.max(-1, Math.min(1, sample));
    view.setInt16(offset, clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff, true);
    offset += 2;
  }
  return buffer;
}

export function arrayBufferToBase64Value(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  const chunkSize = 0x8000;
  let binary = '';
  for (let index = 0; index < bytes.length; index += chunkSize) {
    const chunk = bytes.subarray(index, index + chunkSize);
    binary += String.fromCharCode(...chunk);
  }
  return btoa(binary);
}

export function editorVoiceInputMemoryTierValue(
  cpuVoiceInputBuild: boolean,
  memoryChecked: boolean,
  installedMemoryBytes: number | null,
  minimumMemoryBytes: number,
  recommendedMemoryBytes: number
): EditorVoiceInputMemoryTierValue {
  if (!cpuVoiceInputBuild || !memoryChecked || installedMemoryBytes === null) {
    return 'unknown';
  }
  if (installedMemoryBytes < minimumMemoryBytes) {
    return 'low';
  }
  if (installedMemoryBytes < recommendedMemoryBytes) {
    return 'caution';
  }
  return 'normal';
}

export function editorVoiceInputMemoryWarningValue(
  tier: EditorVoiceInputMemoryTierValue
): string | null {
  if (tier === 'low') {
    return 'このPCはメモリが少ないため、音声入力の利用は推奨しません。使用時に処理が遅くなったり、メモリ不足で失敗したりする可能性があります。';
  }
  if (tier === 'caution') {
    return '音声入力を使用する際、他のアプリがメモリを多く使用していると、処理が失敗する可能性があります。';
  }
  return null;
}

export function editorVoiceInputDownloadButtonColorValue(
  cpuVoiceInputBuild: boolean,
  tier: EditorVoiceInputMemoryTierValue
): 'primary' | 'warn' {
  return cpuVoiceInputBuild && (tier === 'low' || tier === 'caution') ? 'warn' : 'primary';
}

export function editorVoiceInputUnavailableTooltipValue(packChecked: boolean): string {
  return packChecked
    ? '音声入力を使うには、設定タブの「音声入力パック」からモデルをダウンロードしてください。'
    : '音声入力パックの状態を確認中です...';
}

export function voiceInputButtonTooltipValue(
  available: boolean,
  unavailableTooltip: string,
  recording: boolean
): string {
  if (!available) {
    return unavailableTooltip;
  }
  return recording ? '録音を停止' : '音声入力';
}

export function segmentRetranscribeUnavailableReasonValue(
  input: SegmentRetranscribeAvailabilityValueInput
): string | null {
  if (!input.packChecked) {
    return '音声入力パックの状態を確認中です...';
  }
  if (!input.voiceInputAvailable) {
    return '区間の聞き直しを使うには、設定タブの「音声入力パック」からモデルをダウンロードしてください。';
  }
  if (!input.retranscribeSupported) {
    return input.cpuVoiceInputBuild
      ? '区間の聞き直しに必要な ffmpeg が未導入です。設定タブの「音声入力パック」からダウンロードしてください。'
      : 'この構成では区間の聞き直しを利用できません。';
  }
  if (input.playbackDisabled || !input.selectedAudioPath) {
    return '音声ファイルを読み込むと、この区間をAIによる再文字起こしができるようになります。';
  }
  return null;
}

export function segmentRetranscribeTooltipValue(
  unavailableReason: string | null,
  processing: boolean
): string {
  if (unavailableReason) {
    return unavailableReason;
  }
  return processing ? '候補を生成中...' : 'この区間を別のAIで再文字起こしする';
}

export function isPlaybackDisabledValue(jsonResult: boolean, importAudioReady: boolean): boolean {
  return jsonResult && !importAudioReady;
}

export function isDiarizationModelMissingValue(
  modelChecked: boolean,
  modelExists: boolean,
  modelHasConfig: boolean
): boolean {
  return modelChecked && (!modelExists || !modelHasConfig);
}

export function transcriptionTabLabelValue(
  tabDisabled: boolean,
  diarizationModelMissing: boolean,
  cpuOnlyBuild: boolean
): string {
  if (!tabDisabled && diarizationModelMissing) {
    return '文字起こし（要設定）';
  }
  if (tabDisabled) {
    return cpuOnlyBuild ? '文字起こし（要設定）' : '文字起こし（要GPU設定）';
  }
  return '文字起こし';
}

export function processingStatusTextValue(input: ProcessingStatusTextValueInput): string {
  if (!input.visible) {
    return '';
  }
  const parts: string[] = [];
  if (input.transcriptionRunning) {
    const percent = Math.round(input.displayProgress);
    if (input.diarizationPhaseActive) {
      parts.push('文字起こし：完了');
      parts.push(`話者分離：${input.diarizationStage || '起動中'}`);
    } else {
      parts.push(`文字起こし：${percent}%`);
      if (input.parallelDiarizationStatus) {
        parts.push(`話者分離：${input.parallelDiarizationStatus}`);
      }
    }
  }
  if (input.llmProofreadRunning) {
    const match = input.llmProofreadStatus.match(/^校正中:\s*(\d+)\s*\/\s*(\d+)\s*行/);
    if (match) {
      parts.push(`AI校正：${match[1]}/${match[2]}行`);
    } else if (input.llmProofreadStatus) {
      parts.push(`AI校正：${input.llmProofreadStatus}`);
    } else {
      parts.push('AI校正：起動中...');
    }
  }
  if (input.ruleProofreadRunning && input.cpuOnlyBuild) {
    const progress = input.ruleProofreadProgressText || input.ruleProofreadStatus;
    parts.push(progress ? `単純句読点付与：${progress}` : '単純句読点付与：処理中...');
  }
  return parts.length ? parts.join('　') : '処理中...';
}

export function filterOverallProofreadVisibleItemsValue<T extends { id: number; changed: boolean }>(
  items: ReadonlyArray<T> | null | undefined,
  dismissedIds: ReadonlySet<number>
): T[] {
  return (items ?? []).filter((item) => item.changed && !dismissedIds.has(item.id));
}

export function isJapaneseLanguageValue(language: string | null | undefined): boolean {
  return (language ?? 'ja').toLowerCase() === 'ja';
}

export function resolveLlmInstallableGpuEntryValue(
  engineUiVisible: boolean,
  backendNotNeeded: boolean,
  backendInstalled: boolean,
  gpuMode: 'gpu' | 'cpu',
  cudaAvailable: boolean,
  rocmAvailable: boolean
): LlmInstallableBackendEntryValue | null {
  if (!engineUiVisible || backendNotNeeded || backendInstalled) {
    return null;
  }
  if (gpuMode === 'cpu') {
    return { installKey: 'llamacpp:cpu', label: 'LlamaCPP - CPU', state: 'installable', category: 'cpu' };
  }
  if (cudaAvailable) {
    return { installKey: 'llamacpp:vulkan', label: 'LlamaCPP - Vulkan (NVIDIA GPU)', state: 'installable', category: 'gpu' };
  }
  if (rocmAvailable) {
    return { installKey: 'llamacpp:rocm', label: 'LlamaCPP - ROCm (AMD GPU)', state: 'installable', category: 'gpu' };
  }
  return null;
}

export function resolveLlmTargetBackendKeyValue(
  gpuMode: 'gpu' | 'cpu',
  cudaAvailable: boolean,
  rocmAvailable: boolean
): string {
  if (gpuMode === 'cpu') {
    return 'llamacpp:cpu';
  }
  if (cudaAvailable) {
    return 'llamacpp:vulkan';
  }
  if (rocmAvailable) {
    return 'llamacpp:rocm';
  }
  return '';
}

export function llmBackendModeHintValue(
  backendMode: string,
  proofreadModelTier: 'e4b' | '12b',
  gemma12bInstalled: boolean | null
): string {
  if (backendMode === 'lmstudio') {
    return '「localhost:1234」に接続します';
  }
  if (backendMode === 'ollama') {
    return '「localhost:11434」に接続します';
  }
  if (proofreadModelTier === '12b') {
    if (gemma12bInstalled === false) {
      return '高精度モデル（Gemma4 12B）は約7GBの追加ダウンロードが必要です';
    }
    return '高精度モデル（Gemma4 12B）選択中。次回のAI校正から反映されます';
  }
  return '内蔵されたモデル（Gemma4 E4B）を使用します';
}

export function resolveLlmDeviceVramMibValue(
  devices: ReadonlyArray<LlmDeviceMemoryValueInput>,
  selectedDeviceIndex: number,
  recommendedDeviceIndex: number | null | undefined
): number | null {
  if (devices.length === 0) {
    return null;
  }
  const index = selectedDeviceIndex < 0 ? (recommendedDeviceIndex ?? -1) : selectedDeviceIndex;
  const device = devices.find((candidate) => candidate.index === index) ?? devices[0];
  return device ? device.totalVramMb : null;
}

export function llmParallelHintValue(
  selectedParallel: number,
  backendType: string | null | undefined,
  vramMib: number | null
): string {
  if (selectedParallel >= 1 || backendType === 'rocm' || vramMib === null) {
    return '';
  }
  const parallel = resolveAutoLlmParallelValue(vramMib);
  return `現在: ${parallel}（VRAM 約${Math.round(vramMib / 1024)}GB）`;
}

export function llmNCtxHintValue(
  selectedNCtx: number,
  backendMode: string,
  backendType: string | null | undefined,
  vramMib: number | null
): string {
  if (selectedNCtx >= 4096 || backendMode !== 'local_gguf') {
    return '';
  }
  if (backendType === 'rocm') {
    return '現在: 16,384';
  }
  if (vramMib === null) {
    return '';
  }
  const parallel = resolveAutoLlmParallelValue(vramMib);
  const contextSize = Math.min(Math.max(parallel * 8192, 16384), 32768);
  return `現在: ${contextSize.toLocaleString('en-US')}（VRAM 約${Math.round(vramMib / 1024)}GB）`;
}

export function selectedGpuAsrWarningValue(
  backendType: string | null | undefined,
  deviceFound: boolean,
  gcnArchName: string | null | undefined
): string {
  if (backendType !== 'rocm' || !deviceFound || gpuAsrTierValue(backendType, gcnArchName) === 'ok') {
    return '';
  }
  return (gcnArchName ?? '').toLowerCase() === 'gfx1103'
    ? 'ctranslate2-rocm の対応外GPUです。互換設定を自動適用しますが、動作しない場合があります。'
    : '動作未確認のGPUです。文字起こしが動作しない場合があります。';
}

export function needsFullSetupValue(input: NeedsFullSetupValueInput): boolean {
  if (input.editorOnlyBuild || !input.tauriRuntime || !input.setupChecked) {
    return false;
  }
  if (!input.status) {
    return true;
  }
  const needsPythonEnv = !input.status.pythonEnv;
  const needsWhisper = input.transcriptionTabVisible && !input.status.whisperTurbo;
  const needsDiarization = input.transcriptionTabVisible && !input.status.diarization;
  const needsGemma = input.aiProofreadBuild && !input.status.gemmaGguf;
  const needsGemmaMtp = input.aiProofreadBuild && input.buildVariant === 'cuda' && !input.status.gemmaMtpGguf;
  const needsLlmBackend = input.aiProofreadBuild && !input.status.llmBackend;
  return needsPythonEnv || needsWhisper || needsDiarization || needsGemma || needsGemmaMtp || needsLlmBackend;
}

export function transcriptionTabDisabledValue(input: TranscriptionTabDisabledValueInput): boolean {
  if (!input.transcriptionTabVisible || input.editorOnlyBuild || !input.setupChecked) {
    return false;
  }
  if (input.devEmulationMode === 'no_cuda' && !input.cpuOnlyBuild) {
    return true;
  }
  if (input.needsFullSetup || !input.pythonEnvReady) {
    return false;
  }
  return !input.transcriptionRuntimeAvailable;
}

export function setupNeedsHfTokenValue(
  statusAvailable: boolean,
  transcriptionTabVisible: boolean,
  diarizationReady: boolean,
  token: string
): boolean {
  return statusAvailable && transcriptionTabVisible && !diarizationReady && !token.trim();
}

export function parallelModeHintValue(mode: 'standard' | 'fast'): string {
  return mode === 'fast' ? 'GPUスペックに余裕がある場合のみ' : '標準・安定';
}

export function buildConsecutiveSpeakerRunMapValue<T extends { id: number }>(
  segments: ReadonlyArray<T>,
  getSpeakerKey: (segment: T) => string,
  minimumRunLength = 5
): Record<number, number> {
  const map: Record<number, number> = {};
  if (segments.length === 0) {
    return map;
  }
  let runStart = 0;
  let runSpeaker = getSpeakerKey(segments[0]);
  for (let index = 1; index <= segments.length; index++) {
    const speaker = index < segments.length ? getSpeakerKey(segments[index]) : null;
    if (speaker !== runSpeaker) {
      const length = index - runStart;
      if (length >= minimumRunLength) {
        map[segments[runStart].id] = length;
      }
      runStart = index;
      runSpeaker = speaker ?? '';
    }
  }
  return map;
}

export function buildVoiceInputContextValue<T extends { id: number }>(
  visibleRows: ReadonlyArray<T>,
  allSegments: ReadonlyArray<T>,
  segmentId: number,
  rowNumberMap: Readonly<Record<number, number>>,
  getSpeakerLabel: (segment: T) => string,
  getText: (segment: T) => string
): VoiceInputContextValue | null {
  const index = visibleRows.findIndex((segment) => segment.id === segmentId);
  const currentSegment = index >= 0
    ? visibleRows[index]
    : allSegments.find((segment) => segment.id === segmentId) ?? null;
  if (!currentSegment) {
    return null;
  }

  const toContextLine = (
    segment: T | null | undefined,
    fallbackIndex: number | null
  ): VoiceInputContextLineValue | null => {
    if (!segment) {
      return null;
    }
    const speaker = getSpeakerLabel(segment).trim();
    const rowNumber = rowNumberMap[segment.id] ?? (fallbackIndex !== null ? fallbackIndex + 1 : undefined);
    return {
      ...(typeof rowNumber === 'number' && Number.isFinite(rowNumber) ? { rowNumber } : {}),
      speaker: speaker.length > 0 && speaker !== '-' ? speaker : null,
      text: getText(segment)
    };
  };

  return {
    previous: index > 0 ? toContextLine(visibleRows[index - 1], index - 1) : null,
    current: toContextLine(currentSegment, index >= 0 ? index : null),
    next: index >= 0 && index < visibleRows.length - 1
      ? toContextLine(visibleRows[index + 1], index + 1)
      : null
  };
}

export function showProofreadSystemPromptEditorValue(
  promptReadonly: boolean,
  backendMode: string,
  modelPath: string
): boolean {
  if (promptReadonly) {
    return false;
  }
  if (backendMode !== 'local_gguf') {
    return true;
  }
  return !!modelPath;
}

export function canSaveOverallProofreadSystemPromptValue(
  promptReadonly: boolean,
  backendMode: string,
  activeOpenAiModel: string,
  modelPath: string
): boolean {
  if (promptReadonly) {
    return false;
  }
  if (backendMode !== 'local_gguf') {
    return !!activeOpenAiModel.trim();
  }
  return !!modelPath && !isGemma4DefaultLlmModelPathValue(modelPath);
}

export function llmBackendSelectionValue(
  backendMode: 'local_gguf' | 'lmstudio' | 'ollama',
  proofreadModelTier: 'e4b' | '12b'
): 'local_gguf' | 'local_gguf_12b' | 'lmstudio' | 'ollama' {
  return backendMode === 'local_gguf' && proofreadModelTier === '12b'
    ? 'local_gguf_12b'
    : backendMode;
}

export function llmBackendModeOptionsValue(
  aiProofreadBuild: boolean,
  localLlmAppsEnabled: boolean
): ReadonlyArray<{ value: 'local_gguf' | 'local_gguf_12b' | 'lmstudio' | 'ollama'; label: string }> {
  const options: Array<{ value: 'local_gguf' | 'local_gguf_12b' | 'lmstudio' | 'ollama'; label: string }> = [
    { value: 'local_gguf', label: '内蔵モデル（Gemma4 E4B・高速・既定）' }
  ];
  if (aiProofreadBuild) {
    options.push({ value: 'local_gguf_12b', label: '内蔵モデル（Gemma4 12B・高精度・要DL）' });
  }
  if (localLlmAppsEnabled) {
    options.push({ value: 'lmstudio', label: 'LM Studio' });
    options.push({ value: 'ollama', label: 'Ollama' });
  }
  return options;
}

function timestampParts(now: Date): {
  date: string;
  time: string;
  milliseconds: string;
} {
  const yyyy = now.getFullYear();
  const mm = String(now.getMonth() + 1).padStart(2, '0');
  const dd = String(now.getDate()).padStart(2, '0');
  const hh = String(now.getHours()).padStart(2, '0');
  const mi = String(now.getMinutes()).padStart(2, '0');
  const ss = String(now.getSeconds()).padStart(2, '0');
  const milliseconds = String(now.getMilliseconds()).padStart(3, '0');
  return { date: `${yyyy}${mm}${dd}`, time: `${hh}${mi}${ss}`, milliseconds };
}

export function buildDefaultExportFileName(kind: DefaultExportFileKind, now = new Date()): string {
  const { date, time, milliseconds } = timestampParts(now);
  switch (kind) {
    case 'docx':
      return `lott_${date}_${time}.docx`;
    case 'xlsx':
      return `lott_${date}_${time}_${milliseconds}.xlsx`;
    case 'srt':
      return `lott_${date}_${time}.srt`;
    case 'json':
      return `lott_${date}_${time}.json`;
    case 'runtime-csv':
      return `lott_runtime_log_${date}_${time}.csv`;
  }
}

export function formatAudioDurationValue(seconds: number | null): string {
  if (seconds === null || Number.isNaN(seconds) || seconds <= 0) {
    return '-';
  }
  const total = Math.floor(seconds);
  const min = Math.floor(total / 60);
  const sec = total % 60;
  return `${min}分${sec}秒`;
}

export function formatMinuteSecondValue(seconds: number): string {
  const totalSec = Math.max(0, Math.floor(seconds));
  const min = Math.floor(totalSec / 60);
  const sec = totalSec % 60;
  const mm = String(min).padStart(2, '0');
  const ss = String(sec).padStart(2, '0');
  return `${mm}:${ss}`;
}

export function formatElapsedMinuteSecondValue(seconds: number): string {
  const totalSec = Math.max(0, Math.floor(seconds));
  const min = Math.floor(totalSec / 60);
  const sec = totalSec % 60;
  return `${min}分${sec}秒`;
}

export function normalizeErrorMessageValue(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  if (typeof error === 'string') {
    return error;
  }
  try {
    const serialized = JSON.stringify(error);
    return typeof serialized === 'string'
      ? serialized
      : '予期しないエラーが発生しました。';
  } catch {
    return '予期しないエラーが発生しました。';
  }
}

export function buildFinalInitialPromptValue(baseRaw: string, extraRaw: string): string {
  const base = baseRaw.trim();
  const extra = extraRaw.trim();
  if (!extra) {
    return base;
  }
  return `${base}\n追加指示: ${extra}`;
}

export function secondsToEstimatedMinutesValue(seconds: number): number {
  if (!Number.isFinite(seconds) || seconds <= 0) {
    return 0;
  }
  return Math.max(1, Math.ceil(seconds / 60));
}

export function resolveEstimateComputeTypeValue(
  transcriptionDevice: string,
  selectedComputeType: NormalizedComputeType
): ConcreteComputeType {
  if (transcriptionDevice === 'cpu') {
    return 'int8';
  }
  return selectedComputeType === 'auto' ? 'float16' : selectedComputeType;
}

export function pickRuntimeEstimateSamplesValue(
  samples: ReadonlyArray<RuntimeEstimateSample>,
  diarization: boolean,
  device: string,
  computeType: ConcreteComputeType
): RuntimeEstimateSample[] {
  return samples.filter((sample) =>
    sample.diarization === diarization
    && sample.device === device
    && sample.computeType === computeType
  );
}

export function parseRuntimeEstimateSamplesValue(
  serialized: string | null,
  cpuOnly: boolean
): RuntimeEstimateSample[] {
  if (!serialized) {
    return [];
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(serialized);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) {
    return [];
  }

  const samples: RuntimeEstimateSample[] = [];
  for (const value of parsed) {
    if (!value || typeof value !== 'object') {
      continue;
    }
    const sample = value as Record<string, unknown>;
    if (
      !Number.isFinite(sample['audioSeconds'])
      || !Number.isFinite(sample['elapsedSeconds'])
      || typeof sample['diarization'] !== 'boolean'
      || typeof sample['computeType'] !== 'string'
      || !Number.isFinite(sample['createdAt'])
    ) {
      continue;
    }
    samples.push({
      audioSeconds: Number(sample['audioSeconds']),
      elapsedSeconds: Number(sample['elapsedSeconds']),
      diarization: sample['diarization'],
      device: typeof sample['device'] === 'string'
        ? normalizeTranscriptionDeviceValue(sample['device'], cpuOnly)
        : 'cuda',
      computeType: sample['computeType'],
      createdAt: Number(sample['createdAt']),
      fileSizeBytes: Number.isFinite(sample['fileSizeBytes'])
        ? Number(sample['fileSizeBytes'])
        : null
    });
  }
  return samples;
}

export function appendRuntimeEstimateSampleValue(
  samples: ReadonlyArray<RuntimeEstimateSample>,
  sample: RuntimeEstimateSample,
  maxSamples = 120
): RuntimeEstimateSample[] | null {
  if (!Number.isFinite(sample.audioSeconds) || sample.audioSeconds <= 0) {
    return null;
  }
  if (!Number.isFinite(sample.elapsedSeconds) || sample.elapsedSeconds <= 0) {
    return null;
  }
  const next = [...samples, sample];
  return next.length > maxSamples ? next.slice(next.length - maxSamples) : next;
}

export function resolveRuntimeLogAudioSecondsValue(
  metadataDuration: number | null,
  segments: ReadonlyArray<{ end: unknown }>
): number | null {
  if (metadataDuration !== null && Number.isFinite(metadataDuration) && metadataDuration > 0) {
    return metadataDuration;
  }
  const segmentDuration = Math.max(
    0,
    ...segments
      .map((segment) => Number(segment.end))
      .filter((end) => Number.isFinite(end) && end > 0)
  );
  return segmentDuration > 0 ? segmentDuration : null;
}

export function calculateRuntimeEstimateValue(
  durationSeconds: number,
  samples: ReadonlyArray<RuntimeEstimateSample>,
  minRequired = 5
): RuntimeEstimateCalculation {
  const unavailable: RuntimeEstimateCalculation = {
    ready: false,
    minMinutes: null,
    avgMinutes: null,
    avgSeconds: null
  };
  if (samples.length < minRequired) {
    return unavailable;
  }

  const rtfs = samples
    .map((sample) => sample.elapsedSeconds / sample.audioSeconds)
    .filter((value) => Number.isFinite(value) && value > 0)
    .sort((a, b) => a - b);
  if (rtfs.length < minRequired) {
    return unavailable;
  }

  const minRtf = rtfs[Math.floor((rtfs.length - 1) * 0.3)];
  const avgRtf = rtfs[Math.floor((rtfs.length - 1) * 0.6)];
  const avgSeconds = durationSeconds * avgRtf;
  return {
    ready: true,
    minMinutes: secondsToEstimatedMinutesValue(durationSeconds * minRtf),
    avgMinutes: secondsToEstimatedMinutesValue(avgSeconds),
    avgSeconds: Number.isFinite(avgSeconds) && avgSeconds > 0 ? avgSeconds : null
  };
}

export function countSubstringOccurrencesValue(text: string, needle: string): number {
  if (!needle) {
    return 0;
  }
  let count = 0;
  let start = 0;
  while (true) {
    const index = text.indexOf(needle, start);
    if (index < 0) {
      return count;
    }
    count += 1;
    start = index + needle.length;
  }
}

export function mergeSegmentTextValue(leftRaw: string, rightRaw: string): string {
  const left = (leftRaw ?? '').trim();
  const right = (rightRaw ?? '').trim();
  if (!left) {
    return right;
  }
  if (!right) {
    return left;
  }
  const leftLast = left[left.length - 1];
  const rightFirst = right[0];
  const needsSpace = /[A-Za-z0-9]/.test(leftLast) && /[A-Za-z0-9]/.test(rightFirst);
  return needsSpace ? `${left} ${right}` : `${left}${right}`;
}

export function generateNextSegmentIdValue(
  segments: ReadonlyArray<{ id: number }>
): number {
  if (segments.length === 0) {
    return 0;
  }
  const maxId = segments.reduce(
    (maxValue, segment) => Math.max(maxValue, segment.id),
    segments[0].id
  );
  return maxId + 1;
}

export function themeModeLabelValue(mode: NormalizedThemeMode): string {
  switch (mode) {
    case 'light':
      return 'ライト';
    case 'dark':
      return 'ダーク';
    default:
      return 'システムに合わせる';
  }
}

export function shouldShowVoiceInputShortCandidateHintValue(
  candidates: ReadonlyArray<string> | null | undefined
): boolean {
  const items = (candidates ?? [])
    .map((candidate) => String(candidate).trim())
    .filter((candidate) => candidate.length > 0);
  return items.length > 0 && items.every((candidate) => Array.from(candidate).length <= 4);
}

export function formatOverallProofreadProgressValue(current: number, total: number): string {
  const safeTotal = Math.max(0, Math.floor(total));
  const safeCurrent = Math.min(Math.max(0, Math.floor(current)), safeTotal);
  return `校正中: ${safeCurrent} / ${safeTotal} 行`;
}

export function getProgressStageOrderValue(diarization: boolean): ReadonlyArray<string> {
  if (diarization) {
    return ['sidecar_running', 'diarization_loading', 'diarization_running', 'diarization_done', 'done'];
  }
  return ['sidecar_running', 'model_loading', 'transcribing', 'postprocess', 'done'];
}

export function resolveStepForStageValue(stage: string, diarization: boolean): number {
  if (!stage) {
    return 0;
  }
  const order = getProgressStageOrderValue(diarization);
  const commonAliases: Record<string, string> = {
    preparing: 'sidecar_running',
    compute_plan: 'sidecar_running',
    compute_switch: 'sidecar_running',
    sidecar_start: 'sidecar_running',
    sidecar_retry_start: 'sidecar_running',
    sidecar_retry_running: 'sidecar_running'
  };
  const diarizationAliases: Record<string, string> = {
    diarization_start: 'sidecar_running',
    diarization_waiting: 'diarization_loading',
    model_loading: 'sidecar_running',
    transcribing: 'sidecar_running',
    postprocess: 'sidecar_running',
    diarization_fallback: 'diarization_running'
  };
  const aliases = diarization
    ? { ...commonAliases, ...diarizationAliases }
    : commonAliases;
  const canonical = aliases[stage] ?? stage;
  const index = order.indexOf(canonical);
  return index >= 0 ? index + 1 : 0;
}

export function hasFallbackInTranscriptionResultValue(
  result: TranscriptionFallbackResultInput
): boolean {
  if (result.fallbackUsed) {
    return true;
  }
  return !!result.diarization?.note && result.diarization.note.includes('フォールバック');
}

export function resolveAutoLlmParallelValue(vramMib: number): number {
  if (vramMib >= 11000) {
    return 4;
  }
  if (vramMib >= 7000) {
    return 2;
  }
  return 1;
}

const knownOkGfxArchitectures = new Set([
  'gfx1030', 'gfx1100', 'gfx1101', 'gfx1102',
  'gfx1150', 'gfx1151', 'gfx1200', 'gfx1201'
]);

export function gpuAsrTierValue(
  backendType: string | null | undefined,
  gcnArchName: string | null | undefined
): 'ok' | 'caution' {
  if (backendType !== 'rocm') {
    return 'ok';
  }
  const architecture = (gcnArchName ?? '').toLowerCase();
  return knownOkGfxArchitectures.has(architecture) ? 'ok' : 'caution';
}

export function isVramOomErrorValue(message: string | null | undefined): boolean {
  if (!message) {
    return false;
  }
  const lower = message.toLowerCase();
  if (lower.includes('[vram_oom]')) {
    return true;
  }
  return [
    'out of memory',
    'failed to allocate',
    'cudamalloc',
    'cudaerrormemoryallocation',
    'ggml_backend_cuda_buffer'
  ].some((marker) => lower.includes(marker));
}

export function getLlmModelFileNameValue(modelPath: string): string {
  const normalized = (modelPath ?? '').replace(/\\/g, '/').trim();
  if (!normalized) {
    return '';
  }
  const parts = normalized.split('/');
  return parts[parts.length - 1] ?? '';
}

export function isGemma4DefaultLlmModelFileNameValue(fileName: string): boolean {
  const normalized = fileName.trim().toLowerCase();
  return normalized === 'gemma-4-e4b-it-qat-ud-q4_k_xl.gguf'
    || normalized === 'gemma-4-e4b-it-qat-ud-q4_k_xl'
    || normalized === 'gemma-4-e4b-it-q4_k_m.gguf'
    || normalized === 'gemma-4-e4b-it-q4_k_m';
}

export function isGemma4DefaultLlmModelPathValue(modelPath: string): boolean {
  return isGemma4DefaultLlmModelFileNameValue(getLlmModelFileNameValue(modelPath));
}

export function normalizeDevEmulationModeValue(value: unknown): DevEmulationMode {
  const normalized = String(value ?? '').trim().toLowerCase();
  if (normalized === 'no_cuda') {
    return 'no_cuda';
  }
  if (normalized === 'missing_community1') {
    return 'missing_community1';
  }
  return 'none';
}

export function buildExportSpeakerLabelByRowIdValue(
  rows: ReadonlyArray<Pick<DocumentExportSourceRow, 'id' | 'speakerLabel'>>,
  withNumber: boolean
): Record<number, string> {
  const byId: Record<number, string> = {};
  const counts: Record<string, number> = {};
  for (const row of rows) {
    const base = row.speakerLabel.trim();
    if (base.length === 0 || base === '-') {
      byId[row.id] = '-';
      continue;
    }
    counts[base] = (counts[base] ?? 0) + 1;
    byId[row.id] = withNumber ? `${base}-${String(counts[base]).padStart(3, '0')}` : base;
  }
  return byId;
}

export function buildDocxExportRowsValue(
  rows: ReadonlyArray<DocumentExportSourceRow>,
  withUtteranceNumber: boolean
): SaveDocxRow[] {
  const speakerLabels = buildExportSpeakerLabelByRowIdValue(rows, withUtteranceNumber);
  return rows.map((row) => ({
    time: formatMinuteSecondValue(row.endSeconds),
    speaker: speakerLabels[row.id] ?? '-',
    text: row.text
  }));
}

export function buildXlsxExportRowsValue(
  rows: ReadonlyArray<DocumentExportSourceRow>,
  withUtteranceNumber: boolean
): SaveXlsxRow[] {
  const speakerLabels = buildExportSpeakerLabelByRowIdValue(rows, withUtteranceNumber);
  return rows.map((row) => ({
    start: formatMinuteSecondValue(row.startSeconds),
    end: formatMinuteSecondValue(row.endSeconds),
    speaker: speakerLabels[row.id] ?? '-',
    text: row.text
  }));
}

export function buildSrtExportRowsValue(
  rows: ReadonlyArray<DocumentExportSourceRow>
): SaveSrtRow[] {
  return rows.map((row) => ({
    startSeconds: row.startSeconds,
    endSeconds: row.endSeconds,
    speaker: row.speakerLabel.trim(),
    text: row.text
  }));
}

export function buildInitialSpeakerAliasMapValue(
  rows: ReadonlyArray<InitialSpeakerSourceRow>
): Record<string, string> {
  const aliases: Record<string, string> = {};
  const speakers = new Set<string>();
  for (const row of rows) {
    if (row.speaker) {
      speakers.add(row.speaker);
    }
  }
  for (const speaker of speakers) {
    switch (speaker) {
      case 'SPEAKER_00':
        aliases[speaker] = 'Th';
        break;
      case 'SPEAKER_01':
        aliases[speaker] = 'Cl';
        break;
      case 'SPEAKER_02':
        aliases[speaker] = 'IP';
        break;
      case 'SPEAKER_03':
        aliases[speaker] = 'IP2';
        break;
      case 'SPEAKER_04':
        aliases[speaker] = 'IP3';
        break;
      default:
        aliases[speaker] = 'Cl';
        break;
    }
  }
  return aliases;
}

export function buildInitialSpeakerSelectionMapValue(
  rows: ReadonlyArray<InitialSpeakerSourceRow>
): Record<number, string> {
  const selected: Record<number, string> = {};
  for (const row of rows) {
    const estimated = (row.speaker ?? '').trim();
    if (estimated.length > 0) {
      selected[row.id] = estimated;
    }
  }
  return selected;
}

const locationAreaPrefectureCodes: Readonly<Record<LocationAreaCode, ReadonlyArray<string>>> = {
  hokkaidoTohoku: ['01', '02', '03', '04', '05', '06', '07'],
  kanto: ['08', '09', '10', '11', '12', '13', '14'],
  chubu: ['15', '16', '17', '18', '19', '20', '21', '22', '23'],
  kinki: ['24', '25', '26', '27', '28', '29', '30'],
  chugoku: ['31', '32', '33', '34', '35'],
  shikoku: ['36', '37', '38', '39'],
  kyushuOkinawa: ['40', '41', '42', '43', '44', '45', '46', '47']
};

const locationAreaCodes = Object.keys(locationAreaPrefectureCodes) as LocationAreaCode[];
const validLocationPrefectureCodes = new Set(
  locationAreaCodes.flatMap((area) => locationAreaPrefectureCodes[area])
);

export function normalizeLocationAreaValue(valueRaw: unknown): LocationAreaCode {
  const value = String(valueRaw ?? '').trim();
  if (value === 'hokkaido' || value === 'tohoku') {
    return 'hokkaidoTohoku';
  }
  return locationAreaCodes.includes(value as LocationAreaCode)
    ? value as LocationAreaCode
    : 'kanto';
}

export function getLocationAreaPrefectureCodesValue(areaRaw: unknown): string[] {
  return [...locationAreaPrefectureCodes[normalizeLocationAreaValue(areaRaw)]];
}

export function inferLocationAreaFromPrefecturesValue(
  prefectures: ReadonlyArray<string>
): LocationAreaCode {
  const first = prefectures[0];
  if (!first) {
    return 'kanto';
  }
  return locationAreaCodes.find((area) => locationAreaPrefectureCodes[area].includes(first)) ?? 'kanto';
}

export function normalizeLocationPrefectureCodesValue(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of value) {
    const code = String(item ?? '').trim();
    if (validLocationPrefectureCodes.has(code) && !seen.has(code)) {
      out.push(code);
      seen.add(code);
    }
  }
  return out;
}

export function normalizeLocationPrefecturesByAreaValue(
  raw: unknown
): Partial<Record<LocationAreaCode, string[]>> {
  if (!raw || typeof raw !== 'object') {
    return {};
  }
  const obj = raw as Record<string, unknown>;
  const out: Partial<Record<LocationAreaCode, string[]>> = {};
  for (const area of locationAreaCodes) {
    const areaCodes = new Set(locationAreaPrefectureCodes[area]);
    const values = area === 'hokkaidoTohoku'
      ? [obj[area], obj['hokkaido'], obj['tohoku']]
      : [obj[area]];
    const prefectures = normalizeLocationPrefectureCodesValue(
      values.flatMap((value) => normalizeLocationPrefectureCodesValue(value))
    ).filter((code) => areaCodes.has(code));
    if (prefectures.length > 0) {
      out[area] = prefectures;
    }
  }
  return out;
}

export function normalizeLocationDetectionScopeValue(raw: unknown): LocationDetectionScope {
  if (!raw || typeof raw !== 'object') {
    const area = 'kanto';
    return { mode: 'commonOnly', area, prefectures: [], prefecturesByArea: {} };
  }
  const obj = raw as Partial<LocationDetectionScope>;
  const rawPrefectures = normalizeLocationPrefectureCodesValue(obj.prefectures);
  const prefecturesByArea = normalizeLocationPrefecturesByAreaValue(obj.prefecturesByArea);
  const area = normalizeLocationAreaValue(
    obj.area ?? inferLocationAreaFromPrefecturesValue(rawPrefectures)
  );
  const areaCodes = new Set(getLocationAreaPrefectureCodesValue(area));
  const scopedPrefectures = rawPrefectures.filter((code) => areaCodes.has(code));
  const mergedPrefecturesByArea = { ...prefecturesByArea };
  if (scopedPrefectures.length > 0) {
    mergedPrefecturesByArea[area] = scopedPrefectures;
  }
  const activePrefectures = scopedPrefectures.length > 0
    ? scopedPrefectures
    : (mergedPrefecturesByArea[area] ?? []);
  return {
    mode: activePrefectures.length > 0 ? 'selectedRegions' : 'commonOnly',
    area,
    prefectures: activePrefectures,
    prefecturesByArea: mergedPrefecturesByArea
  };
}

export function buildLocationDetectionScopeValue(
  area: LocationAreaCode,
  selectedPrefectures: unknown,
  selectedPrefecturesByArea: Readonly<Partial<Record<LocationAreaCode, string[]>>>
): LocationDetectionScope {
  const areaCodes = new Set(getLocationAreaPrefectureCodesValue(area));
  const prefectures = normalizeLocationPrefectureCodesValue(selectedPrefectures)
    .filter((code) => areaCodes.has(code));
  const prefecturesByArea = { ...selectedPrefecturesByArea };
  if (prefectures.length > 0) {
    prefecturesByArea[area] = prefectures;
  } else {
    delete prefecturesByArea[area];
  }
  return {
    mode: prefectures.length > 0 ? 'selectedRegions' : 'commonOnly',
    area,
    prefectures,
    prefecturesByArea
  };
}

export function normalizeProofreadChunkSizeValue(value: number): number {
  if (!Number.isFinite(value)) {
    return 12;
  }
  return Math.max(1, Math.min(64, Math.round(value)));
}

export function normalizeProofreadChunkMaxCharsValue(value: number): number {
  if (!Number.isFinite(value)) {
    return 1200;
  }
  return Math.max(200, Math.min(6000, Math.round(value)));
}

export function normalizeThemeModeValue(value: unknown): NormalizedThemeMode {
  return value === 'light' || value === 'dark' ? value : 'system';
}

export function normalizeComputeTypeValue(valueRaw: string, cpuOnly: boolean): NormalizedComputeType {
  const value = (valueRaw ?? '').trim().toLowerCase();
  if (cpuOnly && value !== 'auto' && value !== 'int8' && value !== 'float32') {
    return 'float32';
  }
  switch (value) {
    case 'auto':
    case 'float16':
    case 'float32':
    case 'int8_float16':
    case 'int8':
      return value;
    default:
      return cpuOnly ? 'float32' : 'auto';
  }
}

export function normalizeTranscriptionLanguageValue(
  valueRaw: string,
  supportedOptions: ReadonlyArray<{ value: string }>
): string {
  const value = (valueRaw ?? '').trim().toLowerCase();
  return supportedOptions.some((option) => option.value === value) ? value : 'ja';
}

export function normalizeTranscriptionDeviceValue(
  valueRaw: string,
  cpuOnly: boolean
): NormalizedTranscriptionDevice {
  if (cpuOnly) {
    return 'cpu';
  }
  return (valueRaw ?? '').trim().toLowerCase() === 'cpu' ? 'cpu' : 'cuda';
}

export function normalizeLlmNCtxValue(value: number): number {
  if (!Number.isFinite(value) || value <= 0) {
    return 0;
  }
  return Math.max(4096, Math.min(131072, Math.round(value / 512) * 512));
}

export function normalizeLlmMaxBatchValue(value: number): number {
  if (!Number.isFinite(value)) {
    return 40;
  }
  return Math.max(1, Math.min(100, Math.round(value)));
}

export function normalizeLlmParallelValue(value: number): number {
  if (!Number.isFinite(value) || value <= 0) {
    return 0;
  }
  return Math.max(1, Math.min(24, Math.round(value)));
}
