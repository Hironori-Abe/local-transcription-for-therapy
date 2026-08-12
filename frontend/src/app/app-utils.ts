export type DefaultExportFileKind = 'docx' | 'xlsx' | 'srt' | 'json' | 'runtime-csv';
export type NormalizedComputeType = 'auto' | 'float16' | 'float32' | 'int8_float16' | 'int8';
export type NormalizedThemeMode = 'system' | 'light' | 'dark';
export type NormalizedTranscriptionDevice = 'cuda' | 'cpu';

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
