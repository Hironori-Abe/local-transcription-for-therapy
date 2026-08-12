export type DefaultExportFileKind = 'docx' | 'xlsx' | 'srt' | 'json' | 'runtime-csv';
export type NormalizedComputeType = 'auto' | 'float16' | 'float32' | 'int8_float16' | 'int8';
export type ConcreteComputeType = Exclude<NormalizedComputeType, 'auto'>;
export type NormalizedThemeMode = 'system' | 'light' | 'dark';
export type NormalizedTranscriptionDevice = 'cuda' | 'cpu';
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
