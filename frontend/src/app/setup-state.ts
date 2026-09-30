export interface DownloadProgress {
  downloadedBytes?: number;
  totalBytes?: number;
}

export interface SetupProgressEvent extends DownloadProgress {
  component: string;
  status: 'downloading' | 'done' | 'error' | 'skipped';
  message: string;
}

export type SetupProgressMap = Readonly<Record<string, SetupProgressEvent>>;

/** 初期セットアップの状態（Rust の check_all_setup_status。ほかの項目が届いても使わない）。 */
export interface AllSetupStatus {
  /** 音声認識モデル（Whisper large-v3-turbo）と無音検出モデル */
  whisperTurbo: boolean;
  /** 話者分離モデル（Nemotron-3-Diarization） */
  diarization: boolean;
  diarizationExpectedPath: string;
}

/** Editor 版の音声入力パック（Whisper モデル）の状態。 */
export interface EditorVoiceInputPackStatus {
  installed: boolean;
}

export interface NeedsFullSetupInput {
  editorOnlyBuild: boolean;
  tauriRuntime: boolean;
  setupChecked: boolean;
  status: AllSetupStatus | null;
  transcriptionTabVisible: boolean;
}

export interface SetupStatusProjection {
  diarizationExists: boolean;
  diarizationHasConfig: boolean;
  diarizationExpectedPath: string;
  diarizationSetupVisible: boolean;
}

export function aggregateDownloadProgressPercent(values: ReadonlyArray<DownloadProgress>): number | null {
  const measured = values.filter((value) => Number.isFinite(value.totalBytes) && Number(value.totalBytes) > 0);
  if (measured.length === 0) return null;
  const downloaded = measured.reduce((sum, value) => sum + Math.max(0, Number(value.downloadedBytes ?? 0)), 0);
  const total = measured.reduce((sum, value) => sum + Math.max(0, Number(value.totalBytes ?? 0)), 0);
  return total > 0 ? Math.max(0, Math.min(100, (downloaded / total) * 100)) : null;
}

export function updateSetupProgress(
  current: SetupProgressMap,
  progress: SetupProgressEvent
): Record<string, SetupProgressEvent> {
  return { ...current, [progress.component]: progress };
}

export function setupErrorProgress(component: string, message: string): SetupProgressEvent {
  return { component, status: 'error', message };
}

export function needsFullSetup(input: NeedsFullSetupInput): boolean {
  if (input.editorOnlyBuild || !input.tauriRuntime || !input.setupChecked) return false;
  if (!input.status) return true;
  return input.transcriptionTabVisible && (!input.status.whisperTurbo || !input.status.diarization);
}

export function projectSetupStatus(status: AllSetupStatus): SetupStatusProjection {
  return {
    diarizationExists: status.diarization,
    diarizationHasConfig: status.diarization,
    diarizationExpectedPath: status.diarizationExpectedPath,
    diarizationSetupVisible: !status.diarization
  };
}

export function unavailableSetupProjection(): SetupStatusProjection {
  return {
    diarizationExists: false,
    diarizationHasConfig: false,
    diarizationExpectedPath: '',
    diarizationSetupVisible: true
  };
}

export function browserSetupStatus(): AllSetupStatus {
  return {
    whisperTurbo: true,
    diarization: true,
    diarizationExpectedPath: ''
  };
}

export function browserVoiceInputPackStatus(): EditorVoiceInputPackStatus {
  return { installed: false };
}
