export interface VoiceInputContextLine {
  rowNumber?: number;
  speaker?: string | null;
  text: string;
}

export interface VoiceInputContext {
  previous?: VoiceInputContextLine | null;
  current?: VoiceInputContextLine | null;
  next?: VoiceInputContextLine | null;
}

export type PreparedVoiceInput =
  | { ok: true; wavBase64: string }
  | { ok: false; message: string };

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === 'string') return error;
  try {
    const serialized = JSON.stringify(error);
    return typeof serialized === 'string' ? serialized : '予期しないエラーが発生しました。';
  } catch {
    return '予期しないエラーが発生しました。';
  }
}

export function normalizeVoiceInputErrorMessage(error: unknown): string {
  const message = errorMessage(error);
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

export function normalizeVoiceInputCandidates(
  candidates: ReadonlyArray<unknown> | null | undefined,
  maximum = 3
): string[] {
  return (candidates ?? [])
    .map((candidate) => String(candidate).trim())
    .filter((candidate) => candidate.length > 0)
    .slice(0, Math.max(0, maximum));
}

export function mergeFloat32Chunks(chunks: ReadonlyArray<Float32Array>): Float32Array {
  const totalLength = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const merged = new Float32Array(totalLength);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.length;
  }
  return merged;
}

export function resamplePcmTo16k(input: Float32Array, inputSampleRate: number): Float32Array {
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

function writeAscii(view: DataView, offset: number, value: string): void {
  for (let index = 0; index < value.length; index++) {
    view.setUint8(offset + index, value.charCodeAt(index));
  }
}

export function encodePcm16Wav(samples: Float32Array, sampleRate: number): ArrayBuffer {
  const bytesPerSample = 2;
  const dataSize = samples.length * bytesPerSample;
  const buffer = new ArrayBuffer(44 + dataSize);
  const view = new DataView(buffer);
  writeAscii(view, 0, 'RIFF');
  view.setUint32(4, 36 + dataSize, true);
  writeAscii(view, 8, 'WAVE');
  writeAscii(view, 12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * bytesPerSample, true);
  view.setUint16(32, bytesPerSample, true);
  view.setUint16(34, 16, true);
  writeAscii(view, 36, 'data');
  view.setUint32(40, dataSize, true);
  let offset = 44;
  for (const sample of samples) {
    const clamped = Math.max(-1, Math.min(1, sample));
    view.setInt16(offset, clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff, true);
    offset += 2;
  }
  return buffer;
}

export function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  const chunkSize = 0x8000;
  let binary = '';
  for (let index = 0; index < bytes.length; index += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(index, index + chunkSize));
  }
  return btoa(binary);
}

export function prepareVoiceInput(
  chunks: ReadonlyArray<Float32Array>,
  sourceSampleRate: number,
  maximumSeconds: number,
  minimumSeconds = 0.15
): PreparedVoiceInput {
  const merged = mergeFloat32Chunks(chunks);
  if (merged.length < sourceSampleRate * minimumSeconds) {
    return { ok: false, message: '録音が短すぎます。' };
  }
  const maximumSamples = Math.floor(sourceSampleRate * maximumSeconds);
  const clipped = merged.length > maximumSamples ? merged.slice(0, maximumSamples) : merged;
  return {
    ok: true,
    wavBase64: arrayBufferToBase64(encodePcm16Wav(resamplePcmTo16k(clipped, sourceSampleRate), 16000))
  };
}

export function buildVoiceInputContext<T extends { id: number }>(
  visibleRows: ReadonlyArray<T>,
  allSegments: ReadonlyArray<T>,
  segmentId: number,
  rowNumberMap: Readonly<Record<number, number>>,
  getSpeakerLabel: (segment: T) => string,
  getText: (segment: T) => string
): VoiceInputContext | null {
  const index = visibleRows.findIndex((segment) => segment.id === segmentId);
  const currentSegment = index >= 0
    ? visibleRows[index]
    : allSegments.find((segment) => segment.id === segmentId) ?? null;
  if (!currentSegment) return null;

  const toContextLine = (
    segment: T | null | undefined,
    fallbackIndex: number | null
  ): VoiceInputContextLine | null => {
    if (!segment) return null;
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
