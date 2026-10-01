import type {
  AppSettingsV1,
  GeneralAppSettingsOptions,
  GeneralAppSettingsValue,
  VulkanGpuDevice,
  VulkanGpuList
} from './app-settings';

export type NormalizedComputeType = 'auto' | 'float16' | 'float32' | 'int8_float16' | 'int8';
export type ConcreteComputeType = Exclude<NormalizedComputeType, 'auto'>;
/** 'vulkan' = フル機能版（NVIDIA / AMD / Intel の Vulkan、GPU が無ければ CPU）、'editor' = Editor 版。 */
export type BuildVariant = 'vulkan' | 'editor';

export function isBuildVariantValue(value: unknown): value is BuildVariant {
  return value === 'vulkan' || value === 'editor';
}

export type NormalizedThemeMode = 'system' | 'light' | 'dark';
export type NormalizedTranscriptionDevice = 'cuda' | 'cpu';
export type PlaybackShortcutCode = 'Space' | 'KeyA' | 'KeyD' | 'KeyE';
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
    gpuFallback?: boolean | null;
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
  ruleProofreadRunning: boolean;
  ruleProofreadProgressText: string;
  ruleProofreadStatus: string;
  /** CPU で処理しているとき true（文字起こし・話者分離の表示に「CPUで処理中」を添える）。 */
  cpuMode?: boolean;
}

export interface TranscriptionTabDisabledValueInput {
  transcriptionTabVisible: boolean;
  editorOnlyBuild: boolean;
  setupChecked: boolean;
  needsFullSetup: boolean;
  transcriptionRuntimeAvailable: boolean;
}

export type ConfirmDialogColorValue = 'primary' | 'accent' | 'warn' | null;

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

export function selectedFileNameValue(fullPath: string): string {
  if (!fullPath) {
    return '';
  }
  const normalized = fullPath.replace(/\\/g, '/');
  const index = normalized.lastIndexOf('/');
  return index >= 0 ? normalized.slice(index + 1) : normalized;
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
    return `まだ推定には十分なデータが集まっていません。（${input.sampleCount}/${input.minimumSamples}件）`;
  }
  return `最低 ${formatEstimatedMinutesValue(input.minMinutes)} 分、概算 ${formatEstimatedMinutesValue(input.avgMinutes)} 分`;
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

export function editorVoiceInputUnavailableTooltipValue(packChecked: boolean, vulkanBuild = false): string {
  if (vulkanBuild) {
    return packChecked
      ? '音声入力には文字起こし用のモデル（whisper.cpp）が必要です。設定画面のセットアップを完了してください'
      : '文字起こし用モデル（whisper.cpp）の状態を確認中です...';
  }
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
  diarizationModelMissing: boolean
): string {
  return tabDisabled || diarizationModelMissing ? '文字起こし（要設定）' : '文字起こし';
}

/**
 * Keep the runtime explanation consistent with the packaged edition.
 *
 * Older Rust builds reported "CPU mode" when a Full CUDA build could not
 * load CUDA.  Full GPU editions do not implement that fallback, so showing
 * the old message made the setup screen promise a mode that could never run.
 * Keep useful backend details when available, but replace that misleading
 * legacy sentence with an explicit no-fallback explanation.
 */
export function transcriptionRuntimeReasonValue(
  available: boolean,
  reason: string | null | undefined
): string {
  if (available) return '';

  const fallback = 'GPU が確認できないため、文字起こし・話者分離は利用できません。';
  const normalized = (reason ?? '').trim();
  if (!normalized) return fallback;

  if (/CPU\s*モードで動作します/.test(normalized)) {
    return 'GPU が確認できませんでした。Full GPU版ではCPUへ切り替えず、文字起こし・話者分離は利用できません。GPUドライバーとランタイムを確認してください。';
  }
  return normalized;
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
    if (input.cpuMode) {
      parts.push('（CPUで処理中）');
    }
  }
  if (input.ruleProofreadRunning) {
    const progress = input.ruleProofreadProgressText || input.ruleProofreadStatus;
    parts.push(progress ? `句読点付与：${progress}` : '句読点付与：処理中...');
  }
  return parts.length ? parts.join('　') : '処理中...';
}

export function isJapaneseLanguageValue(language: string | null | undefined): boolean {
  return (language ?? 'ja').toLowerCase() === 'ja';
}

export function transcriptionTabDisabledValue(input: TranscriptionTabDisabledValueInput): boolean {
  if (!input.transcriptionTabVisible || input.editorOnlyBuild || !input.setupChecked) {
    return false;
  }
  if (input.needsFullSetup) {
    return false;
  }
  return !input.transcriptionRuntimeAvailable;
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

export function secondsToEstimatedMinutesValue(seconds: number): number {
  if (!Number.isFinite(seconds) || seconds <= 0) {
    return 0;
  }
  return Math.max(1, Math.ceil(seconds / 60));
}

/**
 * ggml（whisper.cpp）で文字起こしした所要時間の記録に使う区分。faster-whisper の計算方式
 * （float16 など）とは速さが違うため、同じ区分に混ぜない。
 */
export const GGML_ESTIMATE_PROFILE = 'whisper.cpp';

export function pickRuntimeEstimateSamplesValue(
  samples: ReadonlyArray<RuntimeEstimateSample>,
  diarization: boolean,
  device: string,
  computeType: ConcreteComputeType | typeof GGML_ESTIMATE_PROFILE
): RuntimeEstimateSample[] {
  return samples.filter((sample) =>
    sample.diarization === diarization
    && sample.device === device
    && sample.computeType === computeType
  );
}

export function parseRuntimeEstimateSamplesValue(serialized: string | null): RuntimeEstimateSample[] {
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
        ? normalizeTranscriptionDeviceValue(sample['device'])
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

export function normalizeTranscriptionLanguageValue(
  valueRaw: string,
  supportedOptions: ReadonlyArray<{ value: string }>
): string {
  const value = (valueRaw ?? '').trim().toLowerCase();
  return supportedOptions.some((option) => option.value === value) ? value : 'ja';
}

export function normalizeTranscriptionDeviceValue(valueRaw: string): NormalizedTranscriptionDevice {
  return (valueRaw ?? '').trim().toLowerCase() === 'cpu' ? 'cpu' : 'cuda';
}

/** ggml エンジンの GPU 選択欄の表示名（例: 「NVIDIA GeForce RTX 4060 Laptop GPU（8GB）」）。 */
export function vulkanGpuLabelValue(device: VulkanGpuDevice): string {
  const gb = Math.round(device.vramMb / 1024);
  const note = device.kind === 'integrated' ? '・内蔵GPU' : device.kind === 'cpu' ? '・CPU' : '';
  return `${device.name}（${gb}GB${note}）`;
}

/** 「自動」の表示名。自動で選ばれる GPU を括弧内に示す。 */
export function vulkanGpuAutoLabelValue(list: VulkanGpuList | null): string {
  const auto = list?.devices.find(d => d.uuid === list.autoUuid);
  return auto ? `自動（${auto.name}）` : '自動';
}

/**
 * 文字起こし画面に出すGPU/CPUの説明行。CPU で処理するときはその理由も添える。
 * vulkanAvailable が null（未確認）の間は空文字（表示しない）。
 */
export function speechDeviceLineValue(input: {
  vulkanAvailable: boolean | null;
  gpuName: string;
  devForceCpu: boolean;
}): string {
  if (input.vulkanAvailable === null) return '';
  if (input.vulkanAvailable) {
    const name = input.gpuName.trim();
    return name ? `GPU（${name}）` : 'GPU';
  }
  return input.devForceCpu
    ? 'CPU（開発オプションでCPU強制）'
    : 'CPU（GPUが見つからないため）';
}

/** 実際に使われる（設定で選ばれた、または自動選択の）GPU の名前。無ければ ''。 */
export function activeVulkanGpuNameValue(
  savedUuid: string,
  list: VulkanGpuList | null,
  fallbackName: string
): string {
  const uuid = effectiveVulkanGpuUuidValue(savedUuid, list) || list?.autoUuid || '';
  const device = uuid ? list?.devices.find(d => d.uuid === uuid) : undefined;
  return device?.name ?? fallbackName;
}

/** 話者分離が GPU から CPU へ切り替わっていたときの、画面に出すお知らせ（無ければ null）。 */
export function diarizationGpuFallbackNoticeValue(
  result: { diarization?: { gpuFallback?: boolean | null } | null }
): string | null {
  return result.diarization?.gpuFallback === true
    ? 'GPUでの話者分離に失敗したため、話者分離だけCPUで処理しました。処理時間が長くなっています。GPUのドライバーを最新にすると改善することがあります。'
    : null;
}

/** 保存済みの GPU が今も存在すればその UUID、無ければ ''（自動）を選択欄に表示する。 */
export function effectiveVulkanGpuUuidValue(savedUuid: string, list: VulkanGpuList | null): string {
  return savedUuid && list?.devices.some(d => d.uuid === savedUuid) ? savedUuid : '';
}

/**
 * 保存済み設定から、今の版で使う項目だけを残す。以前の版が保存した項目
 * （LLM 校正・計算方式・エンジン選択・開発用エミュレーション・keepFillers など）は取り除き、
 * 次に保存したときに消えるようにする。
 */
export type AudioPreprocessPreset =
  | 'none'
  | 'low_noise'
  | 'strong_noise'
  | 'volume_boost'
  | 'general_improvement';

export const AUDIO_PREPROCESS_PRESET_OPTIONS: ReadonlyArray<{
  value: AudioPreprocessPreset;
  label: string;
}> = [
  { value: 'none', label: '何もしない' },
  { value: 'low_noise', label: '低域ノイズの処理' },
  { value: 'strong_noise', label: '強いノイズの処理' },
  { value: 'volume_boost', label: '音量拡大' },
  { value: 'general_improvement', label: '全般的な改善' }
];

/** 音声調整プリセットを検証する。不明な値は 'none'。 */
export function normalizeAudioPreprocessPresetValue(value: unknown): AudioPreprocessPreset {
  return AUDIO_PREPROCESS_PRESET_OPTIONS.some((o) => o.value === value)
    ? (value as AudioPreprocessPreset)
    : 'none';
}

/**
 * 旧版が保存した個別設定（ハイパス・ノイズ低減・正規化）からプリセットを求める。
 * 対応する組み合わせが無ければ 'none'。
 */
export function audioPreprocessPresetFromLegacyFlags(legacy: {
  highpassFilter?: unknown;
  noiseReduction?: unknown;
  normalizeAudio?: unknown;
}): AudioPreprocessPreset {
  const hp = legacy.highpassFilter === true;
  const nr = legacy.noiseReduction === true;
  const norm = legacy.normalizeAudio === true;
  if (hp && !nr && !norm) return 'low_noise';
  if (hp && nr && !norm) return 'strong_noise';
  if (hp && !nr && norm) return 'volume_boost';
  if (hp && nr && norm) return 'general_improvement';
  return 'none';
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
  }
}

export function stripRemovedSettingsValue(settings: unknown): AppSettingsV1 {
  if (!settings || typeof settings !== 'object') {
    return {};
  }
  const raw = settings as Record<string, any>;
  const out: AppSettingsV1 = {};
  const transcription = raw['transcription'];
  if (transcription && typeof transcription === 'object') {
    out.transcription = {};
    if (transcription.device !== undefined) out.transcription.device = transcription.device;
    if (transcription.language !== undefined) out.transcription.language = transcription.language;
    if (transcription.ggmlGpuUuid !== undefined) out.transcription.ggmlGpuUuid = transcription.ggmlGpuUuid;
    if (transcription.audioPreprocess !== undefined) {
      out.transcription.audioPreprocess = normalizeAudioPreprocessPresetValue(transcription.audioPreprocess);
    } else if (
      transcription.highpassFilter !== undefined ||
      transcription.noiseReduction !== undefined ||
      transcription.normalizeAudio !== undefined
    ) {
      // 旧版の個別設定をプリセットへ変換する（対応しない組み合わせは none）。
      out.transcription.audioPreprocess = audioPreprocessPresetFromLegacyFlags(transcription);
    }
  }
  const diarization = raw['diarization'];
  if (diarization && typeof diarization === 'object') {
    out.diarization = {};
    if (diarization.device !== undefined) out.diarization.device = diarization.device;
    if (diarization.speakerCount !== undefined) out.diarization.speakerCount = diarization.speakerCount;
  }
  for (const key of ['proofread', 'playback', 'export', 'ui'] as const) {
    if (raw[key] && typeof raw[key] === 'object') {
      (out as Record<string, unknown>)[key] = raw[key];
    }
  }
  return out;
}

/** 保存済み設定の値を検証・正規化する。 */
export function resolveGeneralAppSettingsValue(
  settings: AppSettingsV1,
  options: GeneralAppSettingsOptions
): GeneralAppSettingsValue {
  const resolved: GeneralAppSettingsValue = {};
  const transcription = settings.transcription;
  if (transcription && typeof transcription.device === 'string') {
    resolved.transcriptionDevice = normalizeTranscriptionDeviceValue(transcription.device);
  }
  if (transcription && typeof transcription.language === 'string') {
    resolved.transcriptionLanguage = normalizeTranscriptionLanguageValue(
      transcription.language,
      options.transcriptionLanguageOptions
    );
  }
  if (transcription && typeof transcription.ggmlGpuUuid === 'string') {
    resolved.ggmlGpuUuid = transcription.ggmlGpuUuid.trim();
  }
  if (transcription && transcription.audioPreprocess !== undefined) {
    resolved.audioPreprocess = normalizeAudioPreprocessPresetValue(transcription.audioPreprocess);
  }

  const playbackRate = Number(settings.playback?.rate);
  if (Number.isFinite(playbackRate) && options.playbackRateOptions.includes(playbackRate)) {
    resolved.playbackRate = playbackRate;
  }

  const proofread = settings.proofread;
  if (proofread) {
    resolved.proofread = {
      locationDetectionScope: normalizeLocationDetectionScopeValue(proofread.locationDetectionScope)
    };
    if (Number.isFinite(proofread.chunkSize)) {
      resolved.proofread.chunkSize = normalizeProofreadChunkSizeValue(Number(proofread.chunkSize));
    }
    if (Number.isFinite(proofread.chunkMaxChars)) {
      resolved.proofread.chunkMaxChars = normalizeProofreadChunkMaxCharsValue(
        Number(proofread.chunkMaxChars)
      );
    }
  }

  const diarization = settings.diarization;
  if (diarization && typeof diarization.device === 'string') {
    resolved.diarizationDevice = normalizeTranscriptionDeviceValue(diarization.device);
  }
  if (diarization && Number.isFinite(diarization.speakerCount)) {
    resolved.speakerCount = Math.max(1, Math.min(5, Math.floor(Number(diarization.speakerCount))));
  }

  if (typeof settings.export?.addUtteranceNumber === 'boolean') {
    resolved.addUtteranceNumber = settings.export.addUtteranceNumber;
  }
  return resolved;
}
