import type {
  AudioPreprocessPreset,
  LocationDetectionScope,
  NormalizedTranscriptionDevice
} from './app-utils';

export type ThemeMode = 'system' | 'light' | 'dark';

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

/**
 * 保存する設定。以前の版が保存した項目（LLM・計算方式・エンジン選択など）は
 * 読み込み時に stripRemovedSettingsValue で取り除く。
 */
export interface AppSettingsV1 {
  transcription?: {
    device?: string;
    language?: string;
    /** 音声エンジンに使わせる GPU の UUID。空・未設定は自動選択。 */
    ggmlGpuUuid?: string;
    /** 文字起こし用音声の調整プリセット（AudioPreprocessPreset）。未設定は none。 */
    audioPreprocess?: string;
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
  playback?: {
    rate?: number;
  };
  export?: {
    addUtteranceNumber?: boolean;
  };
  ui?: {
    themeMode?: ThemeMode;
  };
}

export interface GeneralAppSettingsValue {
  transcriptionDevice?: NormalizedTranscriptionDevice;
  transcriptionLanguage?: string;
  playbackRate?: number;
  proofread?: {
    chunkSize?: number;
    chunkMaxChars?: number;
    locationDetectionScope: LocationDetectionScope;
  };
  diarizationDevice?: NormalizedTranscriptionDevice;
  speakerCount?: number;
  addUtteranceNumber?: boolean;
  ggmlGpuUuid?: string;
  audioPreprocess?: AudioPreprocessPreset;
}

export interface GeneralAppSettingsOptions {
  transcriptionLanguageOptions: ReadonlyArray<{ value: string }>;
  playbackRateOptions: ReadonlyArray<number>;
}
