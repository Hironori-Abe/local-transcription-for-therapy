import type {
  LocationDetectionScope,
  NormalizedComputeType,
  NormalizedTranscriptionDevice
} from './app-utils';

export type ThemeMode = 'system' | 'light' | 'dark';
/** 文字起こし・話者分離のエンジン。standard = faster-whisper / pyannote、ggml = whisper.cpp / Nemotron（試験的）。 */
export type SpeechEngineOption = 'standard' | 'ggml';

/** check_ggml_speech_status の応答。ファイルの有無だけを見る（エンジンは起動しない）。 */
export interface GgmlSpeechStatus {
  transcriptionReady: boolean;
  diarizationReady: boolean;
  missingForTranscription: string[];
  missingForDiarization: string[];
  /** 実行ファイルのビルド種別（'vulkan' / 'cuda' / 'cpu'。不明なら null）。 */
  whisperBackend?: string | null;
  nemoBackend?: string | null;
}

/** list_vulkan_gpus の応答。index は Vulkan の並び（GGML_VK_VISIBLE_DEVICES の番号）。 */
export interface VulkanGpuDevice {
  index: number;
  name: string;
  kind: 'discrete' | 'integrated' | 'virtual' | 'cpu' | 'other';
  vramMb: number;
  uuid: string;
}

export interface VulkanGpuList {
  devices: VulkanGpuDevice[];
  /** 自動選択で使われる GPU の UUID（GPU が無ければ null） */
  autoUuid: string | null;
}
export type LlmBackendMode = 'local_gguf' | 'lmstudio' | 'ollama';
export type LlmPromptType = 'gemma4' | 'original';
export type LlmStringSettingsField =
  | 'systemPromptsByModelFileName'
  | 'systemPromptsByBackend'
  | 'overallSystemPromptsByModelFileName'
  | 'overallSystemPromptsByBackend';

export interface AppSettingsV1 {
  transcription?: {
    device?: string;
    computeType?: string;
    language?: string;
    hipDeviceIndex?: number;
    engine?: string;
    /** ggml（whisper.cpp）でフィラー・相づちを残すか。未設定は true。 */
    keepFillers?: boolean;
    /** ggml エンジン（Vulkan 版）に使わせる GPU の UUID。空・未設定は自動選択。 */
    ggmlGpuUuid?: string;
  };
  diarization?: {
    device?: string;
    speakerCount?: number;
    engine?: string;
  };
  proofread?: {
    chunkSize?: number;
    chunkMaxChars?: number;
    locationDetectionScope?: Partial<LocationDetectionScope>;
  };
  devEmulation?: {
    mode?: string;
    noCuda?: boolean;
    missingCommunity1?: boolean;
    capturedAt?: number;
  };
  playback?: {
    rate?: number;
  };
  export?: {
    addUtteranceNumber?: boolean;
  };
  ui?: {
    themeMode?: ThemeMode;
  };
  llm?: {
    modelPath?: string;
    backendMode?: LlmBackendMode;
    systemPromptsByModelFileName?: Record<string, string>;
    /** @deprecated 旧フィールド。systemPromptsByBackend に移行。 */
    systemPromptsByLocalOpenAiProfileId?: Record<string, string>;
    systemPromptsByBackend?: Record<string, string>;
    overallSystemPromptsByModelFileName?: Record<string, string>;
    overallSystemPromptsByBackend?: Record<string, string>;
    promptTypeByBackend?: Record<string, LlmPromptType>;
    inferenceParamsByKey?: Record<string, { nCtx?: number; maxBatch?: number }>;
    lmstudioModel?: string;
    ollamaModel?: string;
    llmHipDeviceIndex?: number;
    llmPromptType?: LlmPromptType;
    llmParallel?: number;
    proofreadModelTier?: 'e4b' | '12b';
  };
}

export interface GeneralAppSettingsValue {
  transcriptionDevice?: NormalizedTranscriptionDevice;
  computeType?: NormalizedComputeType;
  transcriptionLanguage?: string;
  hipDeviceIndex?: number;
  playbackRate?: number;
  proofread?: {
    chunkSize?: number;
    chunkMaxChars?: number;
    locationDetectionScope: LocationDetectionScope;
  };
  diarizationDevice?: NormalizedTranscriptionDevice;
  speakerCount?: number;
  addUtteranceNumber?: boolean;
  transcriptionEngine?: SpeechEngineOption;
  diarizationEngine?: SpeechEngineOption;
  keepFillers?: boolean;
  ggmlGpuUuid?: string;
}

export interface GeneralAppSettingsOptions {
  cpuOnlyBuild: boolean;
  transcriptionLanguageOptions: ReadonlyArray<{ value: string }>;
  playbackRateOptions: ReadonlyArray<number>;
}

export interface ResolvedLlmAppSettingsValue {
  modelPath?: string;
  backendMode?: LlmBackendMode;
  lmstudioModel?: string;
  ollamaModel?: string;
  llmHipDeviceIndex?: number;
  llmPromptType?: LlmPromptType;
  llmParallel?: number;
  proofreadModelTier: 'e4b' | '12b';
}

export interface ResolveLlmAppSettingsOptions {
  localLlmAppsEnabled: boolean;
  aiProofreadBuild: boolean;
}

export interface CurrentLlmSelectionSettingsValue {
  modelPath: string;
  backendMode: LlmBackendMode;
  lmstudioModel: string;
  ollamaModel: string;
  llmHipDeviceIndex: number;
  llmPromptType: LlmPromptType;
  llmParallel: number;
  proofreadModelTier: 'e4b' | '12b';
}
