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

export interface AllSetupStatus {
  whisperTurbo: boolean;
  diarization: boolean;
  diarizationExpectedPath: string;
  gemmaGguf: boolean;
  gemmaGgufExpectedPath: string;
  gemmaMtpGguf: boolean;
  gemmaMtpGgufExpectedPath: string;
  llmBackend: boolean;
  pythonEnv: boolean;
  pythonEnvExpectedPath: string;
}

export interface EditorVoiceInputPackStatus {
  installed: boolean;
  cpuBackendRequired: boolean;
  cpuBackend: boolean;
  cpuBackendExpectedPath: string;
  gemmaGguf: boolean;
  gemmaGgufExpectedPath: string;
  mmprojGguf: boolean;
  mmprojGgufExpectedPath: string;
  ffmpegRequired: boolean;
  ffmpeg: boolean;
  ffmpegExpectedPath: string;
}

export interface NeedsFullSetupInput {
  editorOnlyBuild: boolean;
  tauriRuntime: boolean;
  setupChecked: boolean;
  status: AllSetupStatus | null;
  transcriptionTabVisible: boolean;
  aiProofreadBuild: boolean;
  buildVariant: string;
}

export interface SetupStatusProjection {
  llmBackendInstalled: boolean;
  diarizationExists: boolean;
  diarizationHasConfig: boolean;
  diarizationExpectedPath: string;
  diarizationSetupVisible: boolean;
}

/**
 * The backend setup state for the current GPU detection state.
 *
 * `unavailable` is deliberately represented in the type.  A GPU edition must
 * never silently turn a failed CUDA/ROCm probe into a CPU backend download.
 * NVIDIA/CUDA builds ship their CUDA llama-server in the application package,
 * so CUDA is represented as `bundled` rather than as a downloadable install
 * key. AMD builds download ROCm and may additionally download Vulkan as a
 * fallback. `checking` is separate so the setup UI can explain why no
 * download action is available while the initial probe is still in progress.
 */
export type LlmBackendInstallPlan =
  | {
      status: 'ready';
      unavailable: false;
      primary: string;
      fallbacks: string[];
    }
  | {
      status: 'bundled';
      unavailable: false;
      primary: null;
      fallbacks: [];
      reason: string;
    }
  | {
      status: 'checking';
      unavailable: false;
      primary: null;
      fallbacks: [];
      reason: string;
    }
  | {
      status: 'unavailable';
      unavailable: true;
      primary: null;
      fallbacks: [];
      reason: string;
    };

export function downloadProgressPercent(progress: DownloadProgress | null | undefined): number {
  if (!progress?.downloadedBytes || !progress?.totalBytes) return 0;
  return Math.min(100, (progress.downloadedBytes / progress.totalBytes) * 100);
}

export function downloadProgressBytesLabel(progress: DownloadProgress | null | undefined): string {
  if (!progress?.downloadedBytes) return '';
  const downloadedMb = Math.round(progress.downloadedBytes / 1_048_576);
  return progress.totalBytes
    ? `${downloadedMb} / ${Math.round(progress.totalBytes / 1_048_576)} MB`
    : `${downloadedMb} MB`;
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
  return !input.status.pythonEnv
    || (input.transcriptionTabVisible && (!input.status.whisperTurbo || !input.status.diarization))
    || (input.aiProofreadBuild && !input.status.gemmaGguf)
    || (input.aiProofreadBuild && input.buildVariant === 'cuda' && !input.status.gemmaMtpGguf)
    || (input.aiProofreadBuild && !input.status.llmBackend);
}

export function projectSetupStatus(status: AllSetupStatus): SetupStatusProjection {
  return {
    llmBackendInstalled: status.llmBackend,
    diarizationExists: status.diarization,
    diarizationHasConfig: status.diarization,
    diarizationExpectedPath: status.diarizationExpectedPath,
    diarizationSetupVisible: !status.diarization
  };
}

export function unavailableSetupProjection(): SetupStatusProjection {
  return {
    llmBackendInstalled: false,
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
    diarizationExpectedPath: '',
    gemmaGguf: true,
    gemmaGgufExpectedPath: '',
    gemmaMtpGguf: true,
    gemmaMtpGgufExpectedPath: '',
    llmBackend: true,
    pythonEnv: true,
    pythonEnvExpectedPath: ''
  };
}

export function browserVoiceInputPackStatus(cpuBackendRequired: boolean): EditorVoiceInputPackStatus {
  return {
    installed: false,
    cpuBackendRequired,
    cpuBackend: false,
    cpuBackendExpectedPath: '',
    gemmaGguf: false,
    gemmaGgufExpectedPath: '',
    mmprojGguf: false,
    mmprojGgufExpectedPath: '',
    ffmpegRequired: cpuBackendRequired,
    ffmpeg: false,
    ffmpegExpectedPath: ''
  };
}

export function llmBackendInstallPlan(
  cudaAvailable: boolean | null | undefined,
  rocmAvailable: boolean | null | undefined,
  buildVariant?: 'cuda' | 'rocm' | 'cpu' | null
): LlmBackendInstallPlan {
  // The packaged edition is authoritative for the proofreading engine. A
  // hybrid PC can expose nvidia-smi while running the AMD edition; selecting
  // CUDA there prevents the required ROCm/Vulkan downloads. Hardware support
  // for transcription remains guarded by the separate Rust runtime probe.
  const effectiveCudaAvailable = buildVariant === 'cuda'
    ? true
    : buildVariant === 'rocm'
      ? false
      : cudaAvailable;
  const effectiveRocmAvailable = buildVariant === 'rocm'
    ? true
    : buildVariant === 'cuda'
      ? false
      : rocmAvailable;

  // CUDA is sufficient to select the NVIDIA backend even if the optional
  // ROCm probe has not completed yet.  Likewise ROCm is sufficient when its
  // own probe succeeded and CUDA is still unknown.
  if (effectiveCudaAvailable === true) {
    return {
      status: 'bundled',
      unavailable: false,
      primary: null,
      fallbacks: [],
      reason: 'CUDA版のllama-serverはアプリに同梱されています。見つからない場合はアプリを再インストールしてください。'
    };
  }
  if (effectiveRocmAvailable === true) {
    return {
      status: 'ready',
      unavailable: false,
      primary: 'llamacpp:rocm',
      fallbacks: ['llamacpp:vulkan']
    };
  }
  if (effectiveCudaAvailable == null || effectiveRocmAvailable == null) {
    return {
      status: 'checking',
      unavailable: false,
      primary: null,
      fallbacks: [],
      reason: 'CUDA / ROCm GPUランタイムを確認中です。判定が終わるまでダウンロードできません。'
    };
  }
  return {
    status: 'unavailable',
    unavailable: true,
    primary: null,
    fallbacks: [],
    reason: 'CUDA / ROCm GPUランタイムが検出されないため、AI校正実行エンジンをダウンロードできません。GPUドライバーを確認し、「GPUを再確認」してから再実行してください。'
  };
}

export function llmBackendLabel(backend: string | null | undefined): string {
  if (backend === 'llamacpp:cuda') return 'CUDA (NVIDIA)';
  if (backend === 'llamacpp:vulkan') return 'Vulkan';
  if (backend === 'llamacpp:rocm') return 'AMD GPU (ROCm)';
  if (backend === 'llamacpp:cpu') return 'CPU';
  return '未選択';
}
