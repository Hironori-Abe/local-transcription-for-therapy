import type {
  LocationDetectionScope,
  NormalizedComputeType,
  NormalizedTranscriptionDevice
} from './app-utils';

export type ThemeMode = 'system' | 'light' | 'dark';
export type LlmBackendMode = 'local_gguf' | 'lmstudio' | 'ollama';
export type LlmGpuMode = 'gpu' | 'cpu';
export type LlmPromptType = 'gemma4' | 'original';

export interface AppSettingsV1 {
  transcription?: {
    device?: string;
    computeType?: string;
    language?: string;
    hipDeviceIndex?: number;
  };
  diarization?: {
    device?: string;
    speakerCount?: number;
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
    lemonadeRatioPct?: number;
    /** @deprecated 旧フィールド。lemonadeParallelEnabled に移行。 */
    cpuLlmRatioPct?: number;
    systemPromptsByModelFileName?: Record<string, string>;
    /** @deprecated 旧フィールド。systemPromptsByBackend に移行。 */
    systemPromptsByLocalOpenAiProfileId?: Record<string, string>;
    systemPromptsByBackend?: Record<string, string>;
    overallSystemPromptsByModelFileName?: Record<string, string>;
    overallSystemPromptsByBackend?: Record<string, string>;
    promptTypeByBackend?: Record<string, LlmPromptType>;
    inferenceParamsByKey?: Record<string, { nCtx?: number; maxBatch?: number }>;
    lemonadeParallelEnabled?: boolean;
    llmGpuMode?: LlmGpuMode;
    /** @deprecated 旧フィールド。lemonadeParallelEnabled に移行。 */
    backend?: string;
    lemonadeUrl?: string;
    lemonadeModel?: string;
    lmstudioModel?: string;
    ollamaModel?: string;
    lemonadeBackendNotNeeded?: boolean;
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
}

export interface GeneralAppSettingsOptions {
  cpuOnlyBuild: boolean;
  transcriptionLanguageOptions: ReadonlyArray<{ value: string }>;
  playbackRateOptions: ReadonlyArray<number>;
}

export interface ResolvedLlmAppSettingsValue {
  modelPath?: string;
  backendMode?: LlmBackendMode;
  llmGpuMode: LlmGpuMode;
  lemonadeUrl?: string;
  lemonadeModel?: string;
  lmstudioModel?: string;
  ollamaModel?: string;
  lemonadeBackendNotNeeded?: boolean;
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
  llmGpuMode: LlmGpuMode;
  lemonadeUrl: string;
  lemonadeModel: string;
  lmstudioModel: string;
  ollamaModel: string;
  lemonadeBackendNotNeeded: boolean;
  llmHipDeviceIndex: number;
  llmPromptType: LlmPromptType;
  llmParallel: number;
  proofreadModelTier: 'e4b' | '12b';
}
