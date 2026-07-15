import { CommonModule } from '@angular/common';
import { ApplicationRef, Component, AfterViewInit, HostListener, NgZone, OnDestroy, OnInit, QueryList, ViewChildren, computed, isDevMode, signal } from '@angular/core';
import { TextFieldModule } from '@angular/cdk/text-field';
import { ScrollingModule, CdkVirtualScrollViewport } from '@angular/cdk/scrolling';
import { ScrollingModule as ScrollingModuleExperimental } from '@angular/cdk-experimental/scrolling';
import { MatButtonModule } from '@angular/material/button';
import { MatButtonToggleModule } from '@angular/material/button-toggle';
import { MatCardModule } from '@angular/material/card';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatSelectModule } from '@angular/material/select';
import { MatDialog, MatDialogModule } from '@angular/material/dialog';
import { MatSnackBar, MatSnackBarModule, MatSnackBarRef } from '@angular/material/snack-bar';
import { PasswordDialogComponent } from './password-dialog.component';
import { PlaybackControlSnackbarComponent } from './playback-control-snackbar.component';
import { ProgressSnackbarComponent } from './progress-snackbar.component';
import { MatTabsModule } from '@angular/material/tabs';
import { MatToolbarModule } from '@angular/material/toolbar';
import { MatTooltipModule } from '@angular/material/tooltip';
import { save, open } from '@tauri-apps/plugin-dialog';
import { getVersion } from '@tauri-apps/api/app';
import { convertFileSrc, invoke } from '@tauri-apps/api/core';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import { environment } from '../environments/environment';

function levenshtein(a: string, b: string): number {
  const m = a.length, n = b.length;
  const dp: number[] = Array.from({ length: n + 1 }, (_, i) => i);
  for (let i = 1; i <= m; i++) {
    let prev = dp[0];
    dp[0] = i;
    for (let j = 1; j <= n; j++) {
      const tmp = dp[j];
      dp[j] = a[i - 1] === b[j - 1] ? prev : 1 + Math.min(prev, dp[j], dp[j - 1]);
      prev = tmp;
    }
  }
  return dp[n];
}

interface TranscriptionSegmentWord {
  word: string;
  start: number;
  end: number;
  probability?: number;
}

interface TranscriptionSegment {
  id: number;
  start: number;
  end: number;
  text: string;
  speaker?: string | null;
  words?: TranscriptionSegmentWord[];
}

interface TranscriptionSettings {
  model: string;
  device: string;
  computeType: string;
  language: string;
  vadFilter: boolean;
  wordTimestamps: boolean;
  normalizeAudio?: boolean;
  highpassFilter?: boolean;
  noiseReduction?: boolean;
  noiseReductionMode?: string;
}

interface TranscriptionResult {
  text: string;
  segments: TranscriptionSegment[];
  settings: TranscriptionSettings;
  diarizationRequested: boolean;
  diarization?: {
    requested: boolean;
    applied: boolean;
    status: 'disabled' | 'not_implemented' | 'applied' | string;
    device?: string | null;
    provider: string | null;
    summary?: {
      speakerCount: number;
      speakers: Array<{ speaker: string; duration: number }>;
    } | null;
    note?: string | null;
  };
  fallbackUsed?: boolean;
  fallbackReason?: string;
}

interface SaveDocxRow {
  time: string;
  speaker: string;
  text: string;
}

interface SaveXlsxRow {
  start: string;
  end: string;
  speaker: string;
  text: string;
}

interface ExportSpeakerDatasetRow {
  speakerValue: string;
  displayName: string;
}

interface ExportTranscriptionDatasetRow {
  startTime: number;
  endTime: number;
  speakerValue: string;
  content: string;
  proofread?: ExportProofreadMetadata | null;
  llmProofread?: boolean;
}

interface ExportTranscriptionPayload {
  audioFileName: string;
  speakerDataset: ExportSpeakerDatasetRow[];
  transcriptionDataset: ExportTranscriptionDatasetRow[];
  proofreadCompleted: boolean;
}

interface ExportProofreadMetadata {
  diff: {
    from: string;
    to: string;
  };
  confidence: number;
  reason: string;
  lintIssues?: Array<{
    ruleId: string;
    message: string;
    line: number;
    column: number;
    severity: number;
  }>;
  sensitiveEntity?: {
    hasSensitiveEntity: boolean;
    kinds: string[];
    names: string[];
    personNames?: string[];
    organizationNames?: string[];
    locationNames?: string[];
    personDetectionSource?: string;
  };
}


interface ReadFileSizeResponse {
  sizeBytes: number;
}

interface DiarizationModelStatusResponse {
  exists: boolean;
  hasConfig: boolean;
  expectedPath: string;
}

interface TranscriptionRuntimeStatusResponse {
  available: boolean;
  reason: string;
}

interface DevEmulationStatusResponse {
  mode?: string;
  noCuda: boolean;
  missingCommunity1: boolean;
}

interface ReadTextFileResponse {
  content: string;
}

type ComputeTypeOption = 'auto' | 'float16' | 'float32' | 'int8_float16' | 'int8';
type ConcreteComputeType = Exclude<ComputeTypeOption, 'auto'>;
type TranscriptionDeviceOption = 'cuda' | 'cpu';
type LocationDetectionMode = 'commonOnly' | 'selectedRegions';
type LocationAreaCode =
  | 'hokkaidoTohoku'
  | 'kanto'
  | 'chubu'
  | 'kinki'
  | 'chugoku'
  | 'shikoku'
  | 'kyushuOkinawa';

interface LocationDetectionScope {
  mode: LocationDetectionMode;
  area?: LocationAreaCode;
  prefectures: string[];
  prefecturesByArea?: Partial<Record<LocationAreaCode, string[]>>;
}

interface RuntimeEstimateSample {
  audioSeconds: number;
  elapsedSeconds: number;
  diarization: boolean;
  device: string;
  computeType: string;
  createdAt: number;
  fileSizeBytes?: number | null;
}

interface ProofreadSegmentInput {
  id: number;
  text: string;
  speaker?: string | null;
  speakerLabel?: string | null;
  start?: number;
  end?: number;
  words?: TranscriptionSegmentWord[];
}

interface LlmBackendEntry {
  label: string;
  state: 'installed' | 'installable' | 'update_required';
  category: 'gpu' | 'npu' | 'cpu';
  installKey: string; // "llamacpp:rocm" など lemonade CLI に渡すキー
}

type LlmBackendMode = 'local_gguf' | 'lmstudio' | 'ollama';
// 「AI校正バックエンド」セレクタの UI 上の選択肢。内蔵モデルは E4B / 12B の
// 2階層を別項目として見せるが、内部的にはどちらも backendMode='local_gguf' で、
// 階層は proofreadModelTier（'e4b' / '12b'）で表す。'local_gguf_12b' は CUDA 版のみ。
type LlmBackendSelection = LlmBackendMode | 'local_gguf_12b';
type LlmGpuMode = 'gpu' | 'cpu';
type LlmPromptType = 'gemma4' | 'original';

interface LocalOpenAiModelsResponse {
  serverName: string;
  models: string[];
}

interface ProofreadItem {
  id: number;
  originalText: string;
  revisedText: string;
  confidence: number;
  reason: string;
  lintIssues?: Array<{
    ruleId?: string;
    message?: string;
    line?: number;
    column?: number;
    severity?: number;
  }>;
  sensitiveEntity?: {
    hasSensitiveEntity?: boolean;
    kinds?: string[];
    names?: string[];
    personNames?: string[];
    organizationNames?: string[];
    locationNames?: string[];
    personDetectionSource?: string;
  };
}

interface ProofreadResultPayload {
  items: ProofreadItem[];
  summary?: {
    punctuationRuntime?: {
      calls?: number;
      modelUnavailable?: number;
      modelLoadErrors?: number;
      inferenceErrors?: number;
      changed?: number;
    };
  };
}

interface OverallProofreadItem {
  id: number;
  originalText: string;
  revisedText: string;
  note: string;
  speakerLabel: string;
  changed: boolean;
}

interface OverallProofreadResultData {
  items: OverallProofreadItem[];
  changedCount: number;
  unchangedCount: number;
}

type ProofreadRunSource = 'transcription' | 'reader';
type CancelRunKind = 'transcription' | 'proofread' | 'diarization' | 'llmProofread';
type ConfirmDialogActionKind = 'removeSegment' | 'cancelRun' | 'mergeUtterances' | 'importJsonOverwrite' | 'startTranscriptionConfirm' | 'llmRerunAll' | 'resetProofreadSystemPrompt' | 'resetOverallProofreadSystemPrompt' | 'gemmaNotFoundBeforeTranscription' | 'overallProofreadBeforeMerge' | 'lowerLlmParallelOnOom' | 'installVoiceInputPackLowMemory' | 'enableVoiceInputLowMemory';
type ConfirmDialogColor = 'primary' | 'accent' | 'warn' | null;
type EditorVoiceInputMemoryTier = 'unknown' | 'low' | 'caution' | 'normal';
type AudioPreprocessPreset = 'none' | 'low_noise' | 'strong_noise' | 'volume_boost' | 'general_improvement' | 'manual';
type NoiseReductionMode = 'standard' | 'weak';
type NormalizedSensitiveEntityMetadata = {
  hasSensitiveEntity: boolean;
  kinds: string[];
  names: string[];
  personNames: string[];
  organizationNames: string[];
  locationNames: string[];
  personDetectionSource: string;
};
type ProofreadHighlightLevel = 'none' | 'yellow' | 'red';
type SensitiveEntityHighlightInput = {
  hasSensitiveEntity?: boolean;
  kinds?: string[];
  names?: string[];
  personNames?: string[];
  organizationNames?: string[];
  locationNames?: string[];
  personDetectionSource?: string;
} | null | undefined;

interface ConfirmDialogState {
  actionKind: ConfirmDialogActionKind;
  title: string;
  message: string;
  messageHtml?: string;
  confirmLabel: string;
  cancelLabel: string;
  confirmColor: ConfirmDialogColor;
  cancelColor: ConfirmDialogColor;
  segmentId?: number;
  cancelRunKind?: CancelRunKind;
}

interface AppSettingsV1 {
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
    continueAfterTranscription?: boolean;
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
    /** モデルごとの校正プロンプトフォーマット。キー: `${backendMode}:${model}` */
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
    /** AMD GPUバックエンドが不要と明示されたとき true。AMD GPU選択を無効化する。 */
    lemonadeBackendNotNeeded?: boolean;
    /** AI校正に使用するGPUデバイスインデックス（-1=自動）。 */
    llmHipDeviceIndex?: number;
    /** 校正プロンプトの種別。 */
    llmPromptType?: LlmPromptType;
    /** AI校正の並列スロット数。0/未設定=自動（VRAMで決定）、1/2/4/8/12/16/20/24=手動上書き。 */
    llmParallel?: number;
    /** 内蔵校正AIモデルの階層。'e4b'=標準（既定）/ '12b'=高精度（CUDA版のみ・後からDL）。 */
    proofreadModelTier?: 'e4b' | '12b';
  };
}

interface LlmModelEntry {
  name: string;
  path: string;
}

interface GpuDeviceInfo {
  index: number;
  name: string;
  totalVramMb: number;
  freeVramMb: number;
  isLikelyIgpu?: boolean;
  gcnArchName?: string;
}

interface ComputeEnvResult {
  backendType: 'cuda' | 'rocm' | 'none';
  devices: GpuDeviceInfo[];
  recommendedIndex: number;
  cpu: { cores: number; totalRamMb?: number; freeRamMb?: number };
  largeV3Installed?: boolean;
}

interface AllSetupStatus {
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

interface EditorVoiceInputPackStatus {
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

interface EditorVoiceInputResponse {
  candidates: string[];
}

interface EditorVoiceInputContextLine {
  rowNumber?: number;
  speaker?: string | null;
  text: string;
}

interface EditorVoiceInputContext {
  previous?: EditorVoiceInputContextLine | null;
  current?: EditorVoiceInputContextLine | null;
  next?: EditorVoiceInputContextLine | null;
}

interface DeleteModelsResponse {
  deleted: string[];
  notFound: string[];
  errors: string[];
}

interface SetupProgressEvent {
  component: string;
  status: 'downloading' | 'done' | 'error' | 'skipped';
  message: string;
  downloadedBytes?: number;
  totalBytes?: number;
}

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [
    CommonModule,
    MatToolbarModule,
    MatCardModule,
    MatButtonModule,
    MatButtonToggleModule,
    MatCheckboxModule,
    MatFormFieldModule,
    MatIconModule,
    MatInputModule,
    MatProgressBarModule,
    MatProgressSpinnerModule,
    MatSelectModule,
    MatSnackBarModule,
    MatTabsModule,
    MatTooltipModule,
    MatDialogModule,
    TextFieldModule,
    ScrollingModule,
    ScrollingModuleExperimental,
  ],
  templateUrl: './app.component.html',
  styleUrl: './app.component.scss'
})
export class AppComponent implements OnDestroy, OnInit, AfterViewInit {
  @ViewChildren(CdkVirtualScrollViewport)
  private segmentViewports!: QueryList<CdkVirtualScrollViewport>;

  private get activeSegmentViewport(): CdkVirtualScrollViewport | undefined {
    return this.segmentViewports?.find(v => !!v.elementRef.nativeElement.offsetParent);
  }

  readonly editorOnlyBuild = environment.editorOnly === true;
  readonly isDevModeBuild = isDevMode();
  readonly appDisplayName = this.editorOnlyBuild
    ? 'Local Transcription for Therapy (LoTT) (Editor)'
    : 'Local Transcription for Therapy (LoTT)';
  readonly appVersion = signal<string>('');
  readonly isTauriRuntime = signal<boolean>(this.detectTauriRuntime());
  readonly runtimeCheckDone = signal<boolean>(false);
  readonly devEmulationLabel = signal<string>('');
  readonly transcriptionTabVisible = signal<boolean>(false);
  readonly transcriptionRuntimeAvailable = signal<boolean>(false);
  readonly transcriptionRuntimeReason = signal<string>('');
  readonly gpuRechecking = signal<boolean>(false);
  readonly activeTabIndex = signal<number>(0);
  readonly isResultPanelTabActive = computed(() => {
    const readerTabIndex = this.canShowTranscriptionTab() ? 1 : 0;
    return this.activeTabIndex() <= readerTabIndex;
  });
  readonly isSegmentTableInView = signal<boolean>(false);
  readonly diarizationInstallToken = signal<string>('');
  readonly diarizationCheckMessage = signal<string>('');
  readonly diarizationCheckIsError = signal<boolean>(false);
  readonly selectedAudioPath = signal<string>('');
  readonly audioFileLoading = signal<boolean>(false);
  readonly importJsonReady = signal<boolean>(false);
  readonly importJsonLoading = signal<boolean>(false);
  readonly importAudioReady = signal<boolean>(false);
  readonly transcriptionRunLockedByImport = signal<boolean>(false);
  readonly importStatusMessage = signal<string>('');
  readonly importExpectedAudioFileName = signal<string>('');
  readonly resultSource = signal<'transcription' | 'json' | null>(null);
  readonly diarization = signal<boolean>(true);
  readonly speakerCount = signal<number>(2);
  readonly normalizeAudio = signal<boolean>(false);
  readonly highpassFilter = signal<boolean>(false);
  readonly noiseReduction = signal<boolean>(false);
  readonly noiseReductionMode = signal<NoiseReductionMode>('weak');
  readonly diarizationDevice = signal<TranscriptionDeviceOption>('cuda');
  readonly computeType = signal<ComputeTypeOption>('auto');
  readonly whisperModel = signal<string>('turbo');
  readonly transcriptionLanguage = signal<string>('ja');
  readonly transcriptionDevice = signal<TranscriptionDeviceOption>('cuda');
  // 編集UIの「+、」「+。」ボタンが挿入する句読点。日本語のときは全角（、。）、
  // それ以外の言語では半角（, .）。判定は結果が実際に文字起こしされた言語を優先し、
  // 無ければ現在の言語設定にフォールバックする。
  readonly editPunctuationIsJapanese = computed<boolean>(() => {
    const lang = (this.result()?.settings?.language ?? this.transcriptionLanguage() ?? 'ja').toLowerCase();
    return lang === 'ja';
  });
  readonly editCommaChar = computed<'、' | ','>(() => (this.editPunctuationIsJapanese() ? '、' : ','));
  readonly editPeriodChar = computed<'。' | '.'>(() => (this.editPunctuationIsJapanese() ? '。' : '.'));
  readonly initialPrompt = signal<string>('');
  readonly baseInitialPrompt = signal<string>('');
  readonly running = signal<boolean>(false);
  readonly runningStatus = signal<string>('');
  readonly runningProgress = signal<number>(0);
  // ユーザーに見せる平滑化済み進捗。runningProgress（バックエンドからの離散値）を
  // アンカーにしつつ、イベント間を経過時間ベースで滑らかに進める（表示専用・処理性能には無影響）。
  readonly displayProgress = signal<number>(0);
  readonly runningStepCurrent = signal<number>(0);
  readonly runningStepTotal = signal<number>(0);
  readonly runningComputeType = signal<string>('');
  readonly parallelDiarizationStatus = signal<string>('');
  readonly runningSeconds = signal<number>(0);
  readonly proofreadRunning = signal<boolean>(false);
  readonly proofreadStatus = signal<string>('');
  readonly punctStatus = signal<string>('');
  readonly llmProofreadRunning = signal<boolean>(false);
  readonly llmProofreadCanceling = signal<boolean>(false);
  readonly llmProofreadStatus = signal<string>('');
  readonly llmProofreadRunningSeconds = signal<number>(0);
  readonly llmBackendMode = signal<LlmBackendMode>('local_gguf');
  readonly llmGpuMode = signal<LlmGpuMode>('gpu');
  readonly cudaAvailable = signal<boolean | null>(null);
  readonly rocmAvailable = signal<boolean | null>(null);
  /** ROCm あり・CUDA なし = AMD GPU 環境と判定する。 */
  readonly isRocmGpu = computed(() => this.rocmAvailable() === true && this.cudaAvailable() === false);
  /** アプリ identifier から判定したビルド種別。'cuda' = CUDA 版、'rocm' = ROCm/AMD 版。 */
  readonly buildVariant = signal<'cuda' | 'rocm'>('cuda');
  /**
   * ローカルAIアプリ（LM Studio / Ollama）との OpenAI 互換 API 連携が有効か。
   * 公式配布は無効（フェイルクローズ）。local-llm-apps feature 付きでソースから
   * ビルドした構成だけが、Rust の check_gpu_availability 経由で true を返す。
   */
  readonly localLlmAppsEnabled = signal<boolean>(false);
  /** GPU セットアップバナーで CUDA インストール案内を表示するか。 */
  readonly showCudaInstallLinks = computed(() =>
    this.isNoCudaEmulation() || this.buildVariant() === 'cuda'
  );
  /** GPU セットアップバナーで ROCm インストール案内を表示するか。 */
  readonly showRocmInstallLinks = computed(() =>
    this.isNoCudaEmulation() || this.buildVariant() === 'rocm'
  );
  /** no_cuda 開発エミュレーション中かどうか。 */
  readonly isNoCudaEmulation = computed(() =>
    this.normalizeDevEmulationMode(this.appSettings.devEmulation?.mode) === 'no_cuda'
  );
  readonly computeEnvInfo = signal<ComputeEnvResult | null>(null);
  readonly availableGpuDevices = signal<GpuDeviceInfo[]>([]);
  readonly recommendedGpuDeviceIndex = signal<number>(-1);
  readonly selectedHipDeviceIndex = signal<number>(-1);
  readonly selectedLlmHipDeviceIndex = signal<number>(-1);
  /** AI校正の並列スロット数。0=自動（VRAMで決定）、1/2/4/8/12/16/20/24=手動上書き。CUDA経路のみ有効。 */
  readonly selectedLlmParallel = signal<number>(0);
  readonly lemonadeUrl = signal<string>('http://localhost:13306');
  readonly lemonadeModel = signal<string>('gemma-4-E4B-it-qat');
  readonly llmServerStatus = signal<'unknown' | 'running' | 'stopped' | 'starting' | 'not_installed' | 'installing' | 'error'>('unknown');
  readonly llmInstallMessage = signal<string>('');
  readonly llmHwInfo = signal<LlmBackendEntry[] | null>(null);
  readonly llmLoadedDevice = signal<'unknown' | 'gpu' | 'cpu' | 'stopped' | 'error'>('unknown');
  readonly llmBackendInstalling = signal(false);
  readonly llmBackendInstallMessage = signal('');
  /** AMD GPUバックエンドが不要と明示されたとき true。AMD GPU オプションを無効化しプロンプトを非表示にする。 */
  readonly lemonadeBackendNotNeeded = signal(false);
  /** ファイルシステム上にLemonadeバックエンドバイナリが存在するか（bin/ディレクトリ非空チェック）。 */
  readonly llmGpuBackendInstalled = signal(false);
  readonly llmModelPath = signal<string>('');
  readonly lmstudioModelInput = signal<string>('');
  readonly ollamaModelInput = signal<string>('');
  readonly localOpenAiServerName = signal<string>('local');
  readonly localOpenAiStatusMessage = signal<string>('');
  readonly localOpenAiAvailableModels = signal<string[]>([]);
  readonly localOpenAiModelsLoading = signal<boolean>(false);
  readonly activeOpenAiBaseUrl = computed(() =>
    this.llmBackendMode() === 'ollama' ? 'http://localhost:11434' : 'http://localhost:1234'
  );
  readonly activeOpenAiModelInput = computed(() =>
    this.llmBackendMode() === 'ollama' ? this.ollamaModelInput() : this.lmstudioModelInput()
  );
  readonly llmEngineUiVisible = computed(() =>
    // Editor 版は AI 校正機能を一切持たないため、Lemonade UI / 状態確認を常に抑止する。
    // これにより refreshLlmUiState()・ngOnDestroy の stopLlm・
    // llmInstallableGpuEntry など全参照箇所で Lemonade 挙動が発火しない。
    !this.editorOnlyBuild && this.llmBackendMode() === 'local_gguf'
  );
  // Lemonade が必要な場面でバックエンドバイナリが未インストールのとき非 null を返す。
  // GPU 検出結果に基づいて適切なバックエンドを自動選択する。
  // 「不要」（lemonadeBackendNotNeeded=true）が押されたときは null を返してプロンプトを抑制。
  readonly llmInstallableGpuEntry = computed<LlmBackendEntry | null>(() => {
    if (!this.llmEngineUiVisible()) return null;
    if (this.lemonadeBackendNotNeeded()) return null;
    if (this.llmGpuBackendInstalled()) return null;
    if (this.llmGpuMode() === 'cpu') {
      return { installKey: 'llamacpp:cpu', label: 'LlamaCPP - CPU', state: 'installable', category: 'cpu' };
    }
    if (this.cudaAvailable()) {
      return { installKey: 'llamacpp:vulkan', label: 'LlamaCPP - Vulkan (NVIDIA GPU)', state: 'installable', category: 'gpu' };
    }
    if (this.rocmAvailable()) {
      return { installKey: 'llamacpp:rocm', label: 'LlamaCPP - ROCm (AMD GPU)', state: 'installable', category: 'gpu' };
    }
    // GPU モードで GPU が検出されない場合は CPU フォールバックを提示しない（CPU 専用実行禁止）
    return null;
  });
  // インストール済みかどうかに関わらず、GPU モードから期待されるバックエンドキーを返す
  readonly llmTargetBackendKey = computed(() => {
    if (this.llmGpuMode() === 'cpu') return 'llamacpp:cpu';
    if (this.cudaAvailable()) return 'llamacpp:vulkan';
    if (this.rocmAvailable()) return 'llamacpp:rocm';
    return '';
  });

  readonly llmBackendModeHint = computed(() => {
    if (this.llmBackendMode() === 'lmstudio') {
      return '「localhost:1234」に接続します';
    }
    if (this.llmBackendMode() === 'ollama') {
      return '「localhost:11434」に接続します';
    }
    // 内蔵モデル（local_gguf）。12B（高精度）を選んでいる場合は階層を案内する。
    if (this.proofreadModelTier() === '12b') {
      if (this.gemma12bInstalled() === false) {
        return '高精度モデル（Gemma4 12B）は約7GBの追加ダウンロードが必要です';
      }
      return '高精度モデル（Gemma4 12B）選択中。次回のAI校正から反映されます';
    }
    return '内蔵されたモデル（Gemma4 E4B）を使用します';
  });
  readonly llmLoadedDeviceText = computed(() => {
    switch (this.llmLoadedDevice()) {
      case 'gpu':
        return 'GPU';
      case 'cpu':
        return 'CPU';
      case 'stopped':
        return '停止中';
      case 'error':
        return '取得失敗';
      default:
        return '不明';
    }
  });
  readonly availableLlmModels = signal<LlmModelEntry[]>([]);
  /** コンテキスト長(n_ctx)。0=自動（VRAMで判定 / CUDAサーバーの--ctx-size）。手動値で上書き可。 */
  readonly llmNCtx = signal<number>(0);
  readonly llmMaxBatch = signal<number>(40);
  /** 選択中のLLM用GPUデバイスのVRAM(MiB)。不明なら null。自動判定の現在値ヒントに使う。 */
  readonly llmDeviceVramMib = computed<number | null>(() => {
    const info = this.computeEnvInfo();
    if (!info || info.devices.length === 0) return null;
    let idx = this.selectedLlmHipDeviceIndex();
    if (idx < 0) idx = info.recommendedIndex ?? -1;
    const dev = info.devices.find(d => d.index === idx) ?? info.devices[0];
    return dev ? dev.totalVramMb : null;
  });
  /** 並列処理数フィールドのヒント。自動(0)選択時のみ、VRAMから解決した実値（Rust choose_llm_parallelism 相当）を表示。手動値は空（非表示）。 */
  readonly llmParallelHint = computed<string>(() => {
    if (this.selectedLlmParallel() >= 1) return '';
    const vram = this.llmDeviceVramMib();
    // np 自動はCUDA経路のみ適用。AMD(rocm)やVRAM不明時は解決値を出さない。
    if (this.computeEnvInfo()?.backendType === 'rocm' || vram == null) return '';
    const np = this.resolveAutoLlmParallel(vram);
    return `現在: ${np}（VRAM 約${Math.round(vram / 1024)}GB）`;
  });
  /** コンテキスト長フィールドのヒント。自動(0)選択時のみ、VRAM/バックエンドから解決した実値を表示。手動値は空（非表示）。 */
  readonly llmNCtxHint = computed<string>(() => {
    if (this.llmNCtx() >= 4096) return '';
    // ローカルAIアプリ(lmstudio/ollama)経路はアプリ側でn_ctxを解決しないため表示しない。
    if (this.llmBackendMode() !== 'local_gguf') return '';
    // AMD/Lemonade経路は config.json の ctx_size=16384 固定。
    if (this.computeEnvInfo()?.backendType === 'rocm') return '現在: 16,384';
    const vram = this.llmDeviceVramMib();
    if (vram == null) return '';
    const np = this.resolveAutoLlmParallel(vram);
    const ctx = Math.min(Math.max(np * 8192, 16384), 32768);
    return `現在: ${ctx.toLocaleString('en-US')}（VRAM 約${Math.round(vram / 1024)}GB）`;
  });
  readonly llmPromptType = signal<LlmPromptType>('gemma4');
  readonly proofreadSystemPrompt = signal<string>('');
  readonly fixedProofreadSystemPrompt = signal<string>('');
  readonly defaultProofreadSystemPrompt = signal<string>('');
  readonly proofreadSystemPromptReadonly = computed(() =>
    this.llmBackendMode() === 'local_gguf' && this.isGemma4DefaultLlmModelPath(this.llmModelPath())
  );
  readonly canSaveProofreadSystemPrompt = computed(() => {
    if (this.proofreadSystemPromptReadonly()) {
      return false;
    }
    if (this.llmBackendMode() !== 'local_gguf') {
      return !!this.activeOpenAiModelInput().trim();
    }
    return !!this.llmModelPath();
  });
  private readonly promptSaveVersion = signal(0);
  readonly proofreadPromptIsCustomized = computed(() => {
    this.promptSaveVersion();
    if (this.proofreadSystemPromptReadonly()) return false;
    if (this.llmBackendMode() !== 'local_gguf') {
      const model = this.activeOpenAiModelInput().trim();
      if (!model) return false;
      const key = `${this.llmBackendMode()}:${model}`;
      return typeof this.appSettings.llm?.systemPromptsByBackend?.[key] === 'string';
    }
    const key = this.getLlmModelFileName(this.llmModelPath());
    if (!key || this.isGemma4DefaultLlmModelFileName(key)) return false;
    return typeof this.appSettings.llm?.systemPromptsByModelFileName?.[key] === 'string';
  });
  readonly showProofreadSystemPromptEditor = computed(() => {
    if (this.proofreadSystemPromptReadonly()) return false;
    if (this.llmBackendMode() !== 'local_gguf') return true;
    return !!this.llmModelPath();
  });
  readonly overallProofreadSystemPrompt = signal<string>('');
  readonly fixedOverallProofreadSystemPrompt = signal<string>('');
  readonly defaultOverallProofreadSystemPrompt = signal<string>('');
  private readonly overallPromptSaveVersion = signal(0);
  readonly canSaveOverallProofreadSystemPrompt = computed(() => {
    if (this.proofreadSystemPromptReadonly()) return false;
    if (this.llmBackendMode() !== 'local_gguf') {
      return !!this.activeOpenAiModelInput().trim();
    }
    return !!this.llmModelPath() && !this.isGemma4DefaultLlmModelPath(this.llmModelPath());
  });
  readonly overallProofreadPromptIsCustomized = computed(() => {
    this.overallPromptSaveVersion();
    if (this.proofreadSystemPromptReadonly()) return false;
    if (this.llmBackendMode() !== 'local_gguf') {
      const model = this.activeOpenAiModelInput().trim();
      if (!model) return false;
      const key = `${this.llmBackendMode()}:${model}`;
      return typeof this.appSettings.llm?.overallSystemPromptsByBackend?.[key] === 'string';
    }
    const key = this.getLlmModelFileName(this.llmModelPath());
    if (!key || this.isGemma4DefaultLlmModelFileName(key)) return false;
    return typeof this.appSettings.llm?.overallSystemPromptsByModelFileName?.[key] === 'string';
  });
  readonly isAiProofreadDisabled = computed(() => {
    if (this.llmBackendMode() === 'local_gguf') {
      if (this.llmServerStatus() === 'not_installed') return true;
      if (this.llmGpuMode() === 'gpu' && this.llmLoadedDevice() === 'cpu') return true;
      return false;
    }
    return !this.activeOpenAiModelInput().trim();
  });
  readonly aiProofreadDisabledReason = computed(() => {
    if (!this.isAiProofreadDisabled()) return '';
    if (this.llmBackendMode() === 'local_gguf') {
      if (this.llmGpuMode() === 'gpu' && this.llmLoadedDevice() === 'cpu') {
        return 'CPU 専用バックエンドが検出されました。設定タブから GPU バックエンドを再インストールしてください。';
      }
      return 'AI校正エンジンが未インストールです。設定タブからインストールしてください。';
    }
    return 'モデルが選択されていません。設定タブでモデルを選択してください。';
  });
  readonly llmSegmentStatus = signal<Record<number, 'processing' | 'done'>>({});
  readonly proofreadProgressText = signal<string>('');
  readonly diarizationPhaseActive = signal<boolean>(false);
  readonly diarizationStage = signal<string>('');
  readonly progressSnackbarVisible = signal<boolean>(false);
  readonly processingStatusText = computed(() => {
    if (!this.progressSnackbarVisible()) return '';
    const parts: string[] = [];
    if (this.running()) {
      const pct = Math.round(this.displayProgress());
      if (this.diarizationPhaseActive()) {
        parts.push('文字起こし：完了');
        parts.push(`話者分離：${this.diarizationStage() || '起動中'}`);
      } else {
        parts.push(`文字起こし：${pct}%`);
        const diarStatus = this.parallelDiarizationStatus();
        if (diarStatus) parts.push(`話者分離：${diarStatus}`);
      }
    }
    if (this.llmProofreadRunning()) {
      const llmStatus = this.llmProofreadStatus();
      const match = llmStatus.match(/^校正中:\s*(\d+)\s*\/\s*(\d+)\s*行/);
      if (match) {
        parts.push(`AI校正：${match[1]}/${match[2]}行`);
      } else if (llmStatus) {
        parts.push(`AI校正：${llmStatus}`);
      } else {
        parts.push('AI校正：起動中...');
      }
    }
    return parts.length ? parts.join('　') : '処理中...';
  });
  readonly mergeStatus = signal<string>('');
  readonly mergeRunning = signal<boolean>(false);
  readonly proofreadStatusSource = signal<ProofreadRunSource | null>(null);
  readonly proofreadRunningSeconds = signal<number>(0);
  readonly diarizationRunning = signal<boolean>(false);
  readonly diarizationCanceling = signal<boolean>(false);
  readonly diarizationStatus = signal<string>('');
  readonly diarizationRunningSeconds = signal<number>(0);
  readonly transcriptionCanceling = signal<boolean>(false);
  readonly errorWasCancelledByUser = signal<boolean>(false);
  readonly proofreadCanceling = signal<boolean>(false);
  readonly pendingConfirmDialog = signal<ConfirmDialogState | null>(null);
  readonly proofreadHintBySegmentId = signal<Record<number, string>>({});
  readonly proofreadMetadataBySegmentId = signal<Record<number, ExportProofreadMetadata>>({});
  readonly proofreadUpdatedCount = signal<number>(0);
  readonly proofreadCompleted = signal<boolean>(false);
  readonly proofreadChunkSize = signal<number>(12);
  readonly proofreadChunkMaxChars = signal<number>(1200);
  readonly continueProofreadAfterTranscription = signal<boolean>(false);
  readonly selectedLocationArea = signal<LocationAreaCode>('kanto');
  readonly selectedLocationPrefectures = signal<string[]>([]);
  readonly selectedLocationPrefecturesByArea = signal<Partial<Record<LocationAreaCode, string[]>>>({});
  readonly filteredLocationPrefectureOptions = computed(() => {
    const areaCodes = new Set(this.getLocationAreaPrefectureCodes(this.selectedLocationArea()));
    return this.locationPrefectureOptions.filter((option) => areaCodes.has(option.value));
  });
  readonly selectedLocationPrefectureTotalCount = computed(() => {
    const selectedCodes = new Set<string>();
    for (const prefectures of Object.values(this.selectedLocationPrefecturesByArea())) {
      for (const code of prefectures ?? []) {
        selectedCodes.add(code);
      }
    }
    for (const code of this.selectedLocationPrefectures()) {
      selectedCodes.add(code);
    }
    return selectedCodes.size;
  });
  readonly locationDetectionScopeHint = computed(() => {
    const count = this.selectedLocationPrefectureTotalCount();
    return count > 0
      ? `全国共通に加えて選択地域 全体 ${count} 件を詳しく確認します。`
      : '全国共通のみ確認します。';
  });
  readonly proofreadEditingLocked = signal<boolean>(false);
  readonly addUtteranceNumber = signal<boolean>(true);

  readonly overallProofreadRunning = signal<boolean>(false);
  readonly overallProofreadCanceling = signal<boolean>(false);
  readonly overallProofreadStatus = signal<string>('');
  readonly overallProofreadResult = signal<OverallProofreadResultData | null>(null);
  readonly overallProofreadDismissedIds = signal<Set<number>>(new Set());
  readonly overallProofreadDialogOpen = signal<boolean>(false);
  readonly overallProofreadError = signal<string>('');
  readonly overallProofreadVisibleItems = computed(() => {
    const result = this.overallProofreadResult();
    if (!result) return [];
    const dismissed = this.overallProofreadDismissedIds();
    return result.items.filter((i) => i.changed && !dismissed.has(i.id));
  });
  readonly overallProofreadHasPendingItems = computed(
    () => this.overallProofreadVisibleItems().length > 0
  );
  readonly overallProofreadBtnAboveViewport = signal(false);
  private _overallProofreadScrollRaf: number | null = null;
  private readonly _checkOverallProofreadBtnPos = (): void => {
    const els = Array.from(document.querySelectorAll<HTMLElement>('.merge-overall-center'));
    let scrolledPast = false;
    for (const el of els) {
      const rect = el.getBoundingClientRect();
      if (rect.bottom <= 0) {
        scrolledPast = true;
        break;
      }
    }
    this.overallProofreadBtnAboveViewport.set(scrolledPast);
    this._overallProofreadScrollRaf = null;
  };
  private readonly _overallProofreadScrollListener = (): void => {
    if (this._overallProofreadScrollRaf !== null) return;
    this._overallProofreadScrollRaf = requestAnimationFrame(this._checkOverallProofreadBtnPos);
  };
  readonly lastRunElapsedSeconds = signal<number>(0);
  readonly estimatedAudioSeconds = signal<number | null>(null);
  readonly selectedAudioFileSizeBytes = signal<number | null>(null);
  readonly estimatedMinMinutes = signal<number | null>(null);
  readonly estimatedAvgMinutes = signal<number | null>(null);
  // 平滑化進捗の駆動に使う、丸め前の概算所要時間（秒）。推定が成立しないときは null。
  readonly estimatedAvgSeconds = signal<number | null>(null);
  readonly estimatingTime = signal<boolean>(false);
  readonly estimateSampleCount = signal<number>(0);
  readonly estimateReady = signal<boolean>(false);
  readonly result = signal<TranscriptionResult | null>(null);
  readonly editingTimeSegmentId = signal<number | null>(null);
  readonly editingTimeValues = signal<{ startMm: string; startSs: string; endMm: string; endSs: string }>({
    startMm: '', startSs: '', endMm: '', endSs: ''
  });
  readonly lastRunNotice = signal<string>('');
  readonly error = signal<string>('');
  readonly errorCopiedMessage = signal<string>('');
  readonly hadRetryInCurrentRun = signal<boolean>(false);
  readonly speakerAliasMap = signal<Record<string, string>>({});
  readonly selectedSpeakerBySegmentId = signal<Record<number, string>>({});
  readonly editedSegmentTextMap = signal<Record<number, string>>({});
  readonly playingSegmentId = signal<number | null>(null);
  readonly playbackRateOptions = [0.4, 0.6, 0.8, 1.0, 1.2, 1.4, 1.6 /*, 1.8, 2.0 */];
  readonly playbackRate = signal<number>(1.0);
  readonly hiddenSegmentIds = signal<Record<number, boolean>>({});
  readonly diarizationModelChecked = signal<boolean>(false);
  readonly diarizationModelExists = signal<boolean>(true);
  readonly diarizationModelHasConfig = signal<boolean>(true);
  readonly diarizationModelExpectedPath = signal<string>('');
  readonly diarizationModelChecking = signal<boolean>(false);
  readonly diarizationSetupVisible = signal<boolean>(false);
  readonly voiceInputRecordingSegmentId = signal<number | null>(null);
  readonly voiceInputProcessingSegmentId = signal<number | null>(null);
  readonly voiceInputFeedbackSegmentId = signal<number | null>(null);
  readonly voiceInputCandidates = signal<{ segmentId: number; candidates: string[]; mode: 'insert' | 'replace' } | null>(null);
  readonly voiceInputStatus = signal<string>('');
  readonly voiceInputError = signal<string>('');
  readonly segmentRetranscribeSupported = signal<boolean>(false);
  readonly editorInstalledMemoryBytes = signal<number | null>(null);
  readonly editorInstalledMemoryChecked = signal<boolean>(false);
  readonly editorLowMemoryVoiceInputOptIn = signal<boolean>(false);
  private readonly editorLowMemoryVoiceInputOptInStorageKey = 'offline_transcriber_editor_low_memory_voice_input_opt_in_v1';
  private readonly editorVoiceInputMinimumMemoryBytes = 16 * 1024 ** 3;
  private readonly editorVoiceInputRecommendedMemoryBytes = 24 * 1024 ** 3;
  readonly editorVoiceInputMemoryTier = computed<EditorVoiceInputMemoryTier>(() => {
    if (!this.editorOnlyBuild || !this.editorInstalledMemoryChecked()) return 'unknown';
    const bytes = this.editorInstalledMemoryBytes();
    if (bytes === null) return 'unknown';
    if (bytes < this.editorVoiceInputMinimumMemoryBytes) return 'low';
    if (bytes < this.editorVoiceInputRecommendedMemoryBytes) return 'caution';
    return 'normal';
  });
  readonly editorVoiceInputMemoryAllowed = computed(
    () => !this.editorOnlyBuild
      || this.editorVoiceInputMemoryTier() !== 'low'
      || this.editorLowMemoryVoiceInputOptIn()
  );
  readonly editorVoiceInputButtonsVisible = computed(
    () => this.isTauriRuntime() && this.editorVoiceInputMemoryAllowed()
  );
  readonly editorVoiceInputMemoryWarning = computed<string | null>(() => {
    const tier = this.editorVoiceInputMemoryTier();
    if (tier === 'low') {
      return 'このPCはメモリが少ないため、音声入力の利用は推奨しません。使用時に処理が遅くなったり、メモリ不足で失敗したりする可能性があります。';
    }
    if (tier === 'caution') {
      return '音声入力を使用する際、他のアプリがメモリを多く使用していると、処理が失敗する可能性があります。';
    }
    return null;
  });
  readonly editorVoiceInputDownloadButtonColor = computed<'primary' | 'warn'>(
    () => this.editorOnlyBuild && (this.editorVoiceInputMemoryTier() === 'low' || this.editorVoiceInputMemoryTier() === 'caution')
      ? 'warn'
      : 'primary'
  );
  readonly segmentRetranscribeButtonVisible = computed(
    // 全ビルドで表示（Editor版は音声入力パックの ffmpeg 後付けDLで対応）。
    () => this.isTauriRuntime() && this.editorVoiceInputMemoryAllowed()
  );

  // 統合セットアップ
  readonly allSetupStatus = signal<AllSetupStatus | null>(null);
  readonly allSetupChecked = signal<boolean>(false);
  readonly setupRunning = signal<boolean>(false);
  readonly setupProgressMap = signal<Record<string, SetupProgressEvent>>({});
  readonly editorVoiceInputPackStatus = signal<EditorVoiceInputPackStatus | null>(null);
  readonly editorVoiceInputPackChecked = signal<boolean>(false);
  readonly editorVoiceInputPackInstalling = signal<boolean>(false);
  readonly editorVoiceInputPackDeleting = signal<boolean>(false);
  readonly editorVoiceInputPackDeleteResult = signal<DeleteModelsResponse | null>(null);
  readonly editorVoiceInputPackProgressMap = signal<Record<string, SetupProgressEvent>>({});
  readonly editorVoiceInputAvailable = computed(
    // Full 版（CUDA/AMD）でも導入済みなら利用可能。editor 版限定ではない。
    () => this.editorVoiceInputPackStatus()?.installed === true && this.editorVoiceInputMemoryAllowed()
  );
  readonly editorVoiceInputUnavailableTooltip = computed(() => {
    if (!this.editorVoiceInputPackChecked()) {
      return '音声入力パックの状態を確認中です...';
    }
    return '音声入力を使うには、設定タブの「音声入力パック」からモデルをダウンロードしてください。';
  });
  readonly editorVoiceInputDevControlsVisible = computed(
    () => this.isDevModeBuild && this.isTauriRuntime()
  );
  readonly editorVoiceInputInstallPercent = computed(() => {
    const values = Object.values(this.editorVoiceInputPackProgressMap());
    const totals = values.filter((p) => Number.isFinite(p.totalBytes) && Number(p.totalBytes) > 0);
    if (totals.length === 0) return null;
    const downloaded = totals.reduce((sum, p) => sum + Math.max(0, Number(p.downloadedBytes ?? 0)), 0);
    const total = totals.reduce((sum, p) => sum + Math.max(0, Number(p.totalBytes ?? 0)), 0);
    return total > 0 ? Math.max(0, Math.min(100, (downloaded / total) * 100)) : null;
  });
  readonly needsFullSetup = computed(() => {
    if (this.editorOnlyBuild || !this.isTauriRuntime()) return false;
    if (!this.allSetupChecked()) return false;
    const s = this.allSetupStatus();
    if (!s) return true;
    const needsPythonEnv = !s.pythonEnv;
    const needsWhisper = this.transcriptionTabVisible() && !s.whisperTurbo;
    const needsDia = this.transcriptionTabVisible() && !s.diarization;
    const needsGemma = this.llmBackendMode() === 'local_gguf' && !s.gemmaGguf;
    const needsGemmaMtp = this.llmBackendMode() === 'local_gguf' && this.buildVariant() === 'cuda' && !s.gemmaMtpGguf;
    const needsLlmBackend = this.llmBackendMode() === 'local_gguf' && !s.llmBackend;
    return needsPythonEnv || needsWhisper || needsDia || needsGemma || needsGemmaMtp || needsLlmBackend;
  });
  readonly transcriptionTabDisabled = computed(() => {
    if (!this.transcriptionTabVisible() || this.editorOnlyBuild) return false;
    if (!this.allSetupChecked()) return false;
    const devMode = this.normalizeDevEmulationMode(this.appSettings.devEmulation?.mode);
    if (devMode === 'no_cuda') return true;
    if (this.needsFullSetup()) return false;
    if (!this.allSetupStatus()?.pythonEnv) return false;
    return !this.transcriptionRuntimeAvailable();
  });

  readonly setupNeedsHfToken = computed(() => {
    const s = this.allSetupStatus();
    return s !== null && this.transcriptionTabVisible() && !s.diarization && !this.diarizationInstallToken().trim();
  });

  readonly segmentRowFilter = signal<'all' | 'caution' | 'caution_context'>('all');
  readonly parallelMode = signal<'standard' | 'fast'>('standard');
  readonly clusteringAdjust = signal<'standard' | 'over_split' | 'under_split'>('standard');
  readonly parallelModeHint = computed(() =>
    this.parallelMode() === 'fast'
      ? 'GPUスペックに余裕がある場合のみ'
      : '標準・安定'
  );
  readonly resultWarningStats = computed(() => {
    const metadataMap = this.proofreadMetadataBySegmentId();
    const segments = this.segmentRows;
    const unknownSpeakerCount = segments.filter(
      (segment) => (this.getAssignedSpeakerKey(segment) ?? '').trim().length === 0
    ).length;
    const yellowCount = Object.values(metadataMap).filter((m) => this.isYellowSensitiveEntityMetadata(m)).length;
    const redCount = Object.values(metadataMap).filter((m) => this.isRedSensitiveEntityMetadata(m)).length;
    return { unknownSpeakerCount, yellowCount, redCount };
  });
  readonly audioPreprocessPreset = computed<AudioPreprocessPreset>(() => {
    const highpass = this.highpassFilter();
    const noiseReduction = this.noiseReduction();
    const normalize = this.normalizeAudio();
    const noiseReductionMode = this.noiseReductionMode();

    if (!highpass && !noiseReduction && !normalize) {
      return 'none';
    }
    if (highpass && !noiseReduction && !normalize) {
      return 'low_noise';
    }
    if (highpass && noiseReduction && !normalize && noiseReductionMode === 'weak') {
      return 'strong_noise';
    }
    if (highpass && !noiseReduction && normalize) {
      return 'volume_boost';
    }
    if (highpass && noiseReduction && normalize && noiseReductionMode === 'weak') {
      return 'general_improvement';
    }
    return 'manual';
  });
  readonly audioPreprocessPresetHint = computed<string>(() => {
    switch (this.audioPreprocessPreset()) {
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
      default:
        return '';
    }
  });
  readonly cautionPinnedSegmentIds = signal<Record<number, boolean>>({});
  readonly cautionExtracting = signal<boolean>(false);
  readonly cautionExtractingProgress = signal<{ current: number; total: number } | null>(null);
  private _cautionFilterGen = 0;
  private readonly _allRenderLimit = signal<number>(Number.MAX_SAFE_INTEGER);
  readonly findReplaceOpen = signal<boolean>(false);
  readonly findReplaceQuery = signal<string>('');
  readonly findReplaceWith = signal<string>('');
  readonly findReplaceStatus = signal<string>('');
  readonly largeV3Installed = signal<boolean | null>(null);
  readonly largeV3Downloading = signal<boolean>(false);
  readonly largeV3DownloadMessage = signal<string>('');
  readonly largeV3DownloadProgress = computed<SetupProgressEvent | undefined>(() => this.setupProgressMap()['whisper_large_v3']);
  readonly largeV3DownloadPercent = computed(() => {
    const p = this.largeV3DownloadProgress();
    if (!p?.downloadedBytes || !p?.totalBytes) return 0;
    return Math.min(100, (p.downloadedBytes / p.totalBytes) * 100);
  });
  readonly largeV3DownloadBytesLabel = computed(() => {
    const p = this.largeV3DownloadProgress();
    if (!p?.downloadedBytes) return '';
    const dlMb = Math.round(p.downloadedBytes / 1_048_576);
    if (p.totalBytes) {
      return `${dlMb} / ${Math.round(p.totalBytes / 1_048_576)} MB`;
    }
    return `${dlMb} MB`;
  });
  // 内蔵校正AIモデルの階層選択（CUDA版のみ）。'e4b'=標準（既定）、'12b'=高精度（後からDL）。
  readonly proofreadModelTier = signal<'e4b' | '12b'>('e4b');
  readonly gemma12bInstalled = signal<boolean | null>(null);
  readonly gemma12bDownloading = signal<boolean>(false);
  readonly gemma12bDownloadMessage = signal<string>('');
  readonly gemma12bDownloadProgress = computed<SetupProgressEvent | undefined>(() => this.setupProgressMap()['gemma_12b']);
  readonly gemma12bDownloadPercent = computed(() => {
    const p = this.gemma12bDownloadProgress();
    if (!p?.downloadedBytes || !p?.totalBytes) return 0;
    return Math.min(100, (p.downloadedBytes / p.totalBytes) * 100);
  });
  readonly gemma12bDownloadBytesLabel = computed(() => {
    const p = this.gemma12bDownloadProgress();
    if (!p?.downloadedBytes) return '';
    const dlMb = Math.round(p.downloadedBytes / 1_048_576);
    if (p.totalBytes) {
      return `${dlMb} / ${Math.round(p.totalBytes / 1_048_576)} MB`;
    }
    return `${dlMb} MB`;
  });
  /**
   * 12B（高精度）関連 UI（説明アイコン・ダウンロード進捗）の表示条件:
   * CUDA版・Editor版以外・内蔵バックエンド時のみ。階層選択自体は
   * 「AI校正バックエンド」セレクタ（llmBackendSelection）へ統合済み。
   */
  readonly proofreadModelTierVisible = computed<boolean>(() =>
    !this.editorOnlyBuild && this.llmBackendMode() === 'local_gguf'
  );
  readonly whisperModelOptions = computed<ReadonlyArray<{ value: string; label: string }>>(() => [
    { value: 'turbo', label: 'turbo（高速・既定）' },
    { value: 'large-v3', label: 'large-v3（高精度）' },
    // { value: 'medium', label: 'medium' },
    // { value: 'small', label: 'small' },
    // { value: 'base', label: 'base（最軽量）' },
  ]);
  readonly computeTypeOptions: ReadonlyArray<{ value: ComputeTypeOption; label: string }> = [
    { value: 'auto', label: 'auto（自動推定）' },
    { value: 'int8', label: 'int8（軽量だが精度低下）' },
    { value: 'int8_float16', label: 'int8_float16（長尺の場合など）' },
    { value: 'float16', label: 'float16（推奨）' },
    { value: 'float32', label: 'float32（高精度だが重い）' }
  ];
  readonly transcriptionDeviceOptions: ReadonlyArray<{ value: TranscriptionDeviceOption; label: string }> = [
    { value: 'cuda', label: 'GPU（CUDA / ROCm）' },
    { value: 'cpu', label: 'CPU' }
  ];
  // 文字起こし言語の選択肢。
  // faster-whisper と Gemma 4 E4B の音声 ASR の両方で対応が明示されている言語に限定する。
  // Gemma 4 Technical Report の FLEURS ASR 評価では pt-br だが、Whisper の言語コードは pt。
  // 既定 ja を先頭にし、利用頻度の高い言語を上位へ並べる。
  readonly transcriptionLanguageOptions: ReadonlyArray<{ value: string; label: string }> = [
    { value: 'ja', label: '日本語' },
    { value: 'en', label: '英語' },
    { value: 'zh', label: '中国語' },
    { value: 'ko', label: '韓国語' },
    { value: 'ar', label: 'アラビア語' },
    { value: 'de', label: 'ドイツ語' },
    { value: 'es', label: 'スペイン語' },
    { value: 'fr', label: 'フランス語' },
    { value: 'hi', label: 'ヒンディー語' },
    { value: 'it', label: 'イタリア語' },
    { value: 'pt', label: 'ポルトガル語' },
    { value: 'ru', label: 'ロシア語' }
  ];
  // ローカルAIアプリ連携が無効のときは LM Studio / Ollama を選択肢から除外する。
  // （内蔵モデルは常に選択可能。連携の有効化はインストール時オプトインのみ）
  readonly llmBackendModeOptions = computed<ReadonlyArray<{ value: LlmBackendSelection; label: string }>>(() => {
    const options: Array<{ value: LlmBackendSelection; label: string }> = [
      { value: 'local_gguf', label: '内蔵モデル（Gemma4 E4B・高速・既定）' },
    ];
    // 高精度（12B）は CUDA（同梱 llama-server 直起動）/ AMD（Vulkan llama-server 直起動）の
    // 両方で提供する。Editor 版はこのセクション自体が非表示。
    if (!this.editorOnlyBuild) {
      options.push({ value: 'local_gguf_12b', label: '内蔵モデル（Gemma4 12B・高精度・要DL）' });
    }
    if (this.localLlmAppsEnabled()) {
      options.push({ value: 'lmstudio', label: 'LM Studio' });
      options.push({ value: 'ollama', label: 'Ollama' });
    }
    return options;
  });
  /**
   * 「AI校正バックエンド」セレクタの現在値（UI 表示用）。
   * 内蔵モデルかつ CUDA 版で 12B 階層なら 'local_gguf_12b' を返し、それ以外は backendMode そのもの。
   */
  readonly llmBackendSelection = computed<LlmBackendSelection>(() =>
    this.llmBackendMode() === 'local_gguf' && this.proofreadModelTier() === '12b'
      ? 'local_gguf_12b'
      : this.llmBackendMode()
  );
  readonly locationAreaOptions: ReadonlyArray<{ value: LocationAreaCode; label: string }> = [
    { value: 'hokkaidoTohoku', label: '北海道・東北' },
    { value: 'kanto', label: '関東' },
    { value: 'chubu', label: '中部' },
    { value: 'kinki', label: '近畿' },
    { value: 'chugoku', label: '中国' },
    { value: 'shikoku', label: '四国' },
    { value: 'kyushuOkinawa', label: '九州・沖縄' }
  ];
  readonly locationPrefectureOptions: ReadonlyArray<{ value: string; label: string }> = [
    { value: '01', label: '北海道' },
    { value: '02', label: '青森県' },
    { value: '03', label: '岩手県' },
    { value: '04', label: '宮城県' },
    { value: '05', label: '秋田県' },
    { value: '06', label: '山形県' },
    { value: '07', label: '福島県' },
    { value: '08', label: '茨城県' },
    { value: '09', label: '栃木県' },
    { value: '10', label: '群馬県' },
    { value: '11', label: '埼玉県' },
    { value: '12', label: '千葉県' },
    { value: '13', label: '東京都' },
    { value: '14', label: '神奈川県' },
    { value: '15', label: '新潟県' },
    { value: '16', label: '富山県' },
    { value: '17', label: '石川県' },
    { value: '18', label: '福井県' },
    { value: '19', label: '山梨県' },
    { value: '20', label: '長野県' },
    { value: '21', label: '岐阜県' },
    { value: '22', label: '静岡県' },
    { value: '23', label: '愛知県' },
    { value: '24', label: '三重県' },
    { value: '25', label: '滋賀県' },
    { value: '26', label: '京都府' },
    { value: '27', label: '大阪府' },
    { value: '28', label: '兵庫県' },
    { value: '29', label: '奈良県' },
    { value: '30', label: '和歌山県' },
    { value: '31', label: '鳥取県' },
    { value: '32', label: '島根県' },
    { value: '33', label: '岡山県' },
    { value: '34', label: '広島県' },
    { value: '35', label: '山口県' },
    { value: '36', label: '徳島県' },
    { value: '37', label: '香川県' },
    { value: '38', label: '愛媛県' },
    { value: '39', label: '高知県' },
    { value: '40', label: '福岡県' },
    { value: '41', label: '佐賀県' },
    { value: '42', label: '長崎県' },
    { value: '43', label: '熊本県' },
    { value: '44', label: '大分県' },
    { value: '45', label: '宮崎県' },
    { value: '46', label: '鹿児島県' },
    { value: '47', label: '沖縄県' }
  ];
  readonly audioPreprocessPresetOptions: ReadonlyArray<{ value: Exclude<AudioPreprocessPreset, 'manual'>; label: string }> = [
    { value: 'none', label: '何もしない' },
    { value: 'low_noise', label: '低域ノイズの処理' },
    { value: 'strong_noise', label: '強いノイズの処理' },
    { value: 'volume_boost', label: '音量拡大' },
    { value: 'general_improvement', label: '全般的な改善' }
  ];
  readonly speakerCountOptions: ReadonlyArray<number> = [1, 2, 3, 4, 5];
  private runningTickerId: ReturnType<typeof setInterval> | null = null;
  // 表示用の進捗を滑らかに進めるためのティッカー（500ms）と、現在実行中の概算所要時間（秒）。
  private smoothProgressTickerId: ReturnType<typeof setInterval> | null = null;
  private activeRunEstimatedSeconds: number | null = null;
  private proofreadTickerId: ReturnType<typeof setInterval> | null = null;
  private diarizationTickerId: ReturnType<typeof setInterval> | null = null;
  private llmProofreadTickerId: ReturnType<typeof setInterval> | null = null;
  private llmProgressOffset = 0;
  private llmTotalProcessedCount = 0;
  private _gemmaCheckBypassed = false;
  private progressSnackBarRef: MatSnackBarRef<ProgressSnackbarComponent> | null = null;
  private progressUnlisten: UnlistenFn | null = null;
  private parallelDiarUnlisten: UnlistenFn | null = null;
  private voiceInputPackProgressUnlisten: UnlistenFn | null = null;
  private voiceInputAudioContext: AudioContext | null = null;
  private voiceInputMediaStream: MediaStream | null = null;
  private voiceInputSourceNode: MediaStreamAudioSourceNode | null = null;
  private voiceInputProcessorNode: ScriptProcessorNode | null = null;
  private voiceInputChunks: Float32Array[] = [];
  private voiceInputSampleRate = 0;
  private voiceInputAutoStopTimer: ReturnType<typeof setTimeout> | null = null;
  private voiceInputSelection: { segmentId: number; start: number; end: number } | null = null;
  private readonly voiceInputMaxRecordingSeconds = 15;
  private previewAudio: HTMLAudioElement | null = null;
  private lastLoadedAudioSrc: string | null = null;
  private sequenceSnackBarRef: MatSnackBarRef<PlaybackControlSnackbarComponent> | null = null;
  private previewLoopEnabled = false;
  private previewSequenceSegmentIds: number[] = [];
  private previewSequenceIndex = -1;

  private previewStartSeconds: number | null = null;
  private previewEndSeconds: number | null = null;
  private seekPlayGeneration = 0;
  private pendingImportedPayload: ExportTranscriptionPayload | null = null;
  // undefined = 未取得, null = 存在しない, string = パス
  private devDemoDataDir: string | null | undefined = undefined;
  readonly devDeletingModels = signal(false);
  readonly devDeleteModelsResult = signal<{ deleted: string[]; notFound: string[]; errors: string[] } | null>(null);
  readonly devDeleteTarget = signal<'all' | 'whisper_turbo' | 'whisper_large_v3' | 'diarization' | 'llm'>('all');
  private readonly estimateMinRequired = 5;
  private readonly estimateStorageKey = 'offline_transcriber_runtime_estimate_samples_v1';
  private readonly appSettingsStorageKey = 'offline_transcriber_app_settings_v1';
  private readonly fixedProofreadChunkSize = 12;
  private readonly fixedProofreadChunkMaxChars = 1200;
  private readonly fallbackDefaultProofreadSystemPrompt =
    'あなたは日本語の音声文字起こしテキストを校正するアシスタントです。各セグメントは独立して処理し、他セグメントとの統合・削除は行わないでください。\n' +
    '校正ルール：句読点（、。！？）は積極的に追加・修正する。会話フィラー（あー・えーとなど）はそのまま残す。明らかな誤字脱字と余計な半角スペースは修正・削除する。それ以外の言葉・表現は変更しない。';
  private readonly fallbackOriginalTypeSystemPrompt = [
    'あなたは日本語の音声文字起こしテキストを校正するアシスタントです。',
    '各セグメントは独立して処理し、他セグメントとの統合・削除・順序変更は行わないでください。',
    '',
    '校正ルール:',
    '- 句読点（、。！？）は自然な位置に追加・修正してください。',
    '- 会話フィラー（あー、えーと、まあ、うーん等）は原則として残してください。',
    '- 明らかな誤字脱字、音声認識由来の不自然な表記、余計な半角スペースは修正してください。',
    '- 話者の意図、語調、専門用語、固有名詞、数値は推測で変更しないでください。',
    '- 校正対象外の説明、要約、翻訳、言い換えは行わないでください。',
  ].join('\n');
  private estimateSamples: RuntimeEstimateSample[] = [];
  private appSettings: AppSettingsV1 = {};
  private lastObservedComputeType: string | null = null;
  private lastObservedTranscriptionDevice: string | null = null;

  get resultAsPrettyJson(): string {
    return JSON.stringify(this.result(), null, 2);
  }

  get segmentRows(): ReadonlyArray<TranscriptionSegment> {
    return this._segmentRowsComputed();
  }

  readonly segmentRowNumberMap = computed<Record<number, number>>(() => {
    const segments = this.result()?.segments ?? [];
    const hidden = this.hiddenSegmentIds();
    const map: Record<number, number> = {};
    let rowNum = 0;
    for (const segment of segments) {
      if (!hidden[segment.id]) {
        map[segment.id] = ++rowNum;
      }
    }
    return map;
  });

  // 同一話者が連続するランの先頭セグメントIDに合計セグメント数を格納する。
  // 非表示セグメントも含めた生データで判定し、5未満のランは記録しない。
  readonly consecutiveSpeakerRunMap = computed<Record<number, number>>(() => {
    const segments = this.result()?.segments ?? [];
    const map: Record<number, number> = {};
    if (segments.length === 0) return map;
    let runStart = 0;
    let runSpeaker = this.getAssignedSpeakerKey(segments[0]);
    for (let i = 1; i <= segments.length; i++) {
      const spk = i < segments.length ? this.getAssignedSpeakerKey(segments[i]) : null;
      if (spk !== runSpeaker) {
        const len = i - runStart;
        if (len >= 5) map[segments[runStart].id] = len;
        runStart = i;
        runSpeaker = spk ?? '';
      }
    }
    return map;
  });

  // segmentRows / displayedSegmentRows / uniqueSpeakers を computed signal に昇格させる。
  // plain getter のままだと変更検知のたびに新しい配列参照が返され、
  // *ngFor がフル差分を実行してしまう（O(N) DOM 再構築）。
  // getter はこの signal を呼ぶだけにして既存の呼び出し元を変更しない。
  private readonly _segmentRowsComputed = computed<ReadonlyArray<TranscriptionSegment>>(() => {
    const segments = this.result()?.segments ?? [];
    const hidden = this.hiddenSegmentIds();
    return segments.filter((segment) => !hidden[segment.id]);
  });

  private readonly _displayedSegmentRowsComputed = computed<ReadonlyArray<TranscriptionSegment>>(() => {
    const rows = this._segmentRowsComputed();
    if (this.segmentRowFilter() === 'all') {
      const limit = this._allRenderLimit();
      return limit < rows.length ? rows.slice(0, limit) : rows;
    }
    const pinned = this.cautionPinnedSegmentIds();
    return rows.filter((segment) => pinned[segment.id] === true);
  });

  // uniqueSpeakers を computed に昇格させることで O(N²) を解消する。
  // plain getter のままだと *ngFor 内の mat-option から N 回呼ばれ、各呼び出しが O(N) になる。
  private readonly _uniqueSpeakersComputed = computed<ReadonlyArray<string>>(() => {
    const names = new Set<string>();
    for (const seg of this._segmentRowsComputed()) {
      if (seg.speaker) names.add(seg.speaker);
    }
    for (const selected of Object.values(this.selectedSpeakerBySegmentId())) {
      if (selected && selected.trim().length > 0) names.add(selected.trim());
    }
    return Array.from(names).sort();
  });

  get displayedSegmentRows(): ReadonlyArray<TranscriptionSegment> {
    return this._displayedSegmentRowsComputed();
  }

  get selectedAudioFileName(): string {
    const full = this.selectedAudioPath();
    if (!full) {
      return '';
    }
    const normalized = full.replace(/\\/g, '/');
    const idx = normalized.lastIndexOf('/');
    return idx >= 0 ? normalized.slice(idx + 1) : normalized;
  }

  get gpuSetupHint(): string {
    const result = this.result();
    if (result?.fallbackUsed) {
      return [
        'GPU 実行が不安定だったため、GPU内フォールバックが発生しました。',
        'Windows の「設定 > システム > ディスプレイ > グラフィック」で',
        'offline-transcriber.exe / python.exe / py.exe を',
        '「高パフォーマンス (RTX)」に設定すると安定する場合があります。'
      ].join('\n');
    }
    const err = this.error();
    if (err.includes('GPU 文字起こしに失敗しました')) {
      return [
        'GPU 実行に失敗しています。',
        'Windows のグラフィック設定および NVIDIA コントロールパネルで',
        'offline-transcriber.exe / python.exe / py.exe を',
        'RTX 側へ固定してください。'
      ].join('\n');
    }
    return '';
  }

  private buildFinalInitialPrompt(): string {
    const base = this.baseInitialPrompt().trim();
    const extra = this.initialPrompt().trim();
    if (!extra) {
      return base;
    }
    return `${base}\n追加指示: ${extra}`;
  }

  private async getDevDemoDataDir(): Promise<string | null> {
    if (this.devDemoDataDir !== undefined) return this.devDemoDataDir;
    try {
      this.devDemoDataDir = await invoke<string | null>('get_dev_demo_data_dir');
    } catch {
      this.devDemoDataDir = null;
    }
    return this.devDemoDataDir;
  }

  private normalizeErrorMessage(error: unknown): string {
    if (error instanceof Error) {
      return error.message;
    }
    if (typeof error === 'string') {
      return error;
    }
    try {
      return JSON.stringify(error);
    } catch {
      return '予期しないエラーが発生しました。';
    }
  }

  private buildProofreadHint(
    originalText: string,
    revisedText: string,
    confidenceRaw: number,
    reasonRaw: string,
    sensitiveEntityRaw?: unknown
  ): string {
    const sensitive = this.normalizeSensitiveEntityMetadata(sensitiveEntityRaw);
    const sensitiveHint = this.buildSensitiveEntityProofreadHint(sensitive);
    if (sensitiveHint) {
      return sensitiveHint;
    }
    const reason = (reasonRaw ?? '').trim();
    if (this.isPunctuationOnlyProofreadReason(reason)) {
      return `句読点の調整：（元文） ${this.compactProofreadHintText(originalText)}`;
    }
    if (reason && !this.isPunctuationOnlyProofreadReason(reason) && reason !== 'llm_correction') {
      return `AI: ${this.compactProofreadHintText(reason)}`;
    }
    if (!revisedText || revisedText === originalText) {
      return 'AI：（変更無し）';
    }
    return `AI（元文）: 「${this.compactProofreadHintText(originalText)}」`;
  }

  /**
   * AI校正の note を、LLM の自由記述（"changed" フィールド）ではなく
   * 実際の差分（prev→revised）から生成する。これにより note と本文のズレ
   * （例: note は「、。を追加」だが本文に「、」が無い）を防ぐ。
   * - 句読点／空白のみの変更: 実際に増えた記号だけを「。を追加」「、。を追加」のように列挙。
   *   追加以外（記号の置換・削除）が混ざる場合は「句読点・記号の調整」（buildProofreadHint が
   *   句読点扱いで（元文）比較表示にする）。
   * - 単語レベルの変更: 空文字を返し、buildProofreadHint 側の（元文）比較表示に委ねる。
   */
  private describeProofreadDiffReason(prev: string, revised: string): string {
    if (prev === revised) {
      return '';
    }
    const punctMarks = ['、', '。', '！', '？', '!', '?', '…', '・'];
    const punctSet = new Set(punctMarks);
    const isStripChar = (c: string): boolean =>
      punctSet.has(c) || c === ' ' || c === '\t' || c === '\r' || c === '\n' || c === '　';
    const strip = (s: string): string => Array.from(s).filter((c) => !isStripChar(c)).join('');
    if (strip(prev) !== strip(revised)) {
      // 句読点以外（語）も変わっている → （元文）比較表示に委ねる
      return '';
    }
    const countMarks = (s: string): Map<string, number> => {
      const m = new Map<string, number>();
      for (const c of s) {
        if (punctSet.has(c)) {
          m.set(c, (m.get(c) ?? 0) + 1);
        }
      }
      return m;
    };
    const before = countMarks(prev);
    const after = countMarks(revised);
    const added: string[] = [];
    let removedAny = false;
    for (const mark of punctMarks) {
      const delta = (after.get(mark) ?? 0) - (before.get(mark) ?? 0);
      if (delta > 0) {
        added.push(mark);
      } else if (delta < 0) {
        removedAny = true;
      }
    }
    if (added.length > 0 && !removedAny) {
      return `${added.join('')}を追加`;
    }
    return '句読点・記号の調整';
  }

  private buildSensitiveEntityProofreadHint(sensitive: NormalizedSensitiveEntityMetadata): string | null {
    if (!sensitive.hasSensitiveEntity) {
      return null;
    }
    const compactNames = (values: string[]): string =>
      this.compactProofreadHintText(values.length > 0 ? values.join('、') : '名称不明');
    const redNames = [...sensitive.personNames, ...sensitive.locationNames];
    if (sensitive.personNames.length > 0) {
      return `人名・地名混入の可能性: ${compactNames(redNames)}`;
    }
    if (sensitive.locationNames.length > 0) {
      return `地名混入の可能性: ${compactNames(sensitive.locationNames)}`;
    }
    if (sensitive.organizationNames.length > 0) {
      return `組織名など混入の可能性: ${compactNames(sensitive.organizationNames)}`;
    }
    if (sensitive.kinds.includes('person') && sensitive.personDetectionSource === 'honorific') {
      return '人名混入の可能性: さん／君などの検出';
    }
    return `固有名詞混入の可能性: ${compactNames(sensitive.names)}`;
  }

  private normalizeProofreadMetadata(
    originalTextRaw: string,
    revisedTextRaw: string,
    confidenceRaw: number,
    reasonRaw: string,
    sensitiveEntityRaw?: unknown,
    lintIssuesRaw?: unknown
  ): ExportProofreadMetadata {
    const originalText = typeof originalTextRaw === 'string' ? originalTextRaw : '';
    const revisedText = typeof revisedTextRaw === 'string' ? revisedTextRaw : originalText;
    const confidence = Number.isFinite(confidenceRaw) ? Math.max(0, Math.min(1, confidenceRaw)) : 0;
    const reason = typeof reasonRaw === 'string' ? reasonRaw.trim() : '';
    return {
      diff: {
        from: originalText,
        to: revisedText
      },
      confidence,
      reason,
      lintIssues: this.normalizeLintIssues(lintIssuesRaw),
      sensitiveEntity: this.normalizeSensitiveEntityMetadata(sensitiveEntityRaw)
    };
  }

  private normalizeLintIssues(raw: unknown): Array<{ ruleId: string; message: string; line: number; column: number; severity: number }> {
    if (!Array.isArray(raw)) {
      return [];
    }
    const out: Array<{ ruleId: string; message: string; line: number; column: number; severity: number }> = [];
    for (const item of raw) {
      if (!item || typeof item !== 'object') {
        continue;
      }
      const obj = item as Record<string, unknown>;
      const lineRaw = Number(obj['line']);
      const columnRaw = Number(obj['column']);
      const severityRaw = Number(obj['severity']);
      out.push({
        ruleId: String(obj['ruleId'] ?? '').trim(),
        message: String(obj['message'] ?? '').trim(),
        line: Number.isFinite(lineRaw) ? lineRaw : 0,
        column: Number.isFinite(columnRaw) ? columnRaw : 0,
        severity: Number.isFinite(severityRaw) ? severityRaw : 1
      });
    }
    return out.filter((v) => v.message.length > 0 || v.ruleId.length > 0).slice(0, 8);
  }

  private normalizeSensitiveEntityMetadata(raw: unknown): NormalizedSensitiveEntityMetadata {
    const allowedPersonDetectionSources = new Set(['honorific', 'dictionary', 'other', 'mixed']);
    const allowedKinds = new Set(['person', 'organization', 'corporation', 'location']);
    const empty: NormalizedSensitiveEntityMetadata = {
      hasSensitiveEntity: false,
      kinds: [],
      names: [],
      personNames: [],
      organizationNames: [],
      locationNames: [],
      personDetectionSource: ''
    };
    const normalizeNameList = (value: unknown): string[] => {
      if (!Array.isArray(value)) {
        return [];
      }
      return Array.from(new Set(
        value
          .map((v) => String(v).replace(/\s+/g, ' ').trim())
          .filter((v) => v.length > 0)
      )).slice(0, 8);
    };
    if (!raw || typeof raw !== 'object') {
      return empty;
    }
    const obj = raw as Record<string, unknown>;
    const has = obj['hasSensitiveEntity'] === true;
    const rawKinds = Array.isArray(obj['kinds']) ? obj['kinds'] : [];
    const kinds = rawKinds
      .map((v) => String(v).trim().toLowerCase())
      .filter((v) => allowedKinds.has(v));
    let names = normalizeNameList(obj['names']);
    let personNames = normalizeNameList(obj['personNames']);
    let organizationNames = normalizeNameList(obj['organizationNames']);
    let locationNames = normalizeNameList(obj['locationNames']);
    const sourceRaw = String(obj['personDetectionSource'] ?? '').trim().toLowerCase();
    const personDetectionSource = allowedPersonDetectionSources.has(sourceRaw) ? sourceRaw : '';
    if (names.length === 0) {
      names = Array.from(new Set([...personNames, ...organizationNames, ...locationNames])).slice(0, 8);
    }
    if (personNames.length === 0 && kinds.includes('person')) {
      const hasOnlyPerson = !kinds.some((kind) => kind === 'organization' || kind === 'corporation' || kind === 'location');
      if (hasOnlyPerson && (personDetectionSource === 'dictionary' || personDetectionSource === 'mixed')) {
        personNames = names;
      }
    }
    if (organizationNames.length === 0 && (kinds.includes('organization') || kinds.includes('corporation'))) {
      const hasOnlyOrganization = !kinds.some((kind) => kind === 'person' || kind === 'location');
      if (hasOnlyOrganization) {
        organizationNames = names;
      }
    }
    if (locationNames.length === 0 && kinds.includes('location')) {
      const hasOnlyLocation = !kinds.some((kind) => kind === 'person' || kind === 'organization' || kind === 'corporation');
      if (hasOnlyLocation) {
        locationNames = names;
      }
    }
    const hasAnyName = names.length > 0 || personNames.length > 0 || organizationNames.length > 0 || locationNames.length > 0;
    return {
      hasSensitiveEntity: has && (kinds.length > 0 || hasAnyName),
      kinds,
      names,
      personNames,
      organizationNames,
      locationNames,
      personDetectionSource
    };
  }

  private getSensitiveEntityHighlightLevel(sensitive?: SensitiveEntityHighlightInput): ProofreadHighlightLevel {
    if (sensitive?.hasSensitiveEntity !== true) {
      return 'none';
    }
    const personNames = sensitive.personNames ?? [];
    const locationNames = sensitive.locationNames ?? [];
    if (personNames.length > 0 || locationNames.length > 0) {
      return 'red';
    }
    const kinds = sensitive.kinds ?? [];
    const names = sensitive.names ?? [];
    const organizationNames = sensitive.organizationNames ?? [];
    return kinds.length > 0 || names.length > 0 || organizationNames.length > 0 ? 'yellow' : 'none';
  }

  private isRedSensitiveEntityValue(sensitive?: SensitiveEntityHighlightInput): boolean {
    return this.getSensitiveEntityHighlightLevel(sensitive) === 'red';
  }

  private isYellowSensitiveEntityValue(sensitive?: SensitiveEntityHighlightInput): boolean {
    return this.getSensitiveEntityHighlightLevel(sensitive) === 'yellow';
  }

  private isRedSensitiveEntityMetadata(metadata?: ExportProofreadMetadata | null): boolean {
    return this.isRedSensitiveEntityValue(metadata?.sensitiveEntity ?? null);
  }

  private isYellowSensitiveEntityMetadata(metadata?: ExportProofreadMetadata | null): boolean {
    return this.isYellowSensitiveEntityValue(metadata?.sensitiveEntity ?? null);
  }

  getProofreadHighlightLevel(segmentId: number): ProofreadHighlightLevel {
    const metadata = this.proofreadMetadataBySegmentId()[segmentId];
    return this.getSensitiveEntityHighlightLevel(metadata?.sensitiveEntity ?? null);
  }

  private normalizeProofreadChunkSize(value: number): number {
    if (!Number.isFinite(value)) {
      return 12;
    }
    return Math.max(1, Math.min(64, Math.round(value)));
  }

  private normalizeProofreadChunkMaxChars(value: number): number {
    if (!Number.isFinite(value)) {
      return 1200;
    }
    return Math.max(200, Math.min(6000, Math.round(value)));
  }

  getProofreadRecommendedChunkSizeHint(): string {
    return '推奨: 12';
  }

  getProofreadRecommendedChunkMaxCharsHint(): string {
    return '推奨: 1200';
  }

  private isPunctuationOnlyProofreadReason(reasonRaw: string): boolean {
    const reason = (reasonRaw ?? '').trim();
    return reason === '文末句点の補完'
      || reason === '句読点・記号の調整'
      || reason === 'sentence_final_period_added'
      || reason === 'punctuation_adjustment'
      || /^「[、。！？…・]」を追加$/.test(reason);
  }

  async onSegmentRowFilterChange(value: string): Promise<void> {
    // (click) で呼ぶことで valueChange の programmatic 発火問題を回避済み。
    // 同じ値への再クリックはガードで弾く。
    if (this.segmentRowFilter() === value) return;
    const gen = ++this._cautionFilterGen;
    this.cautionExtracting.set(true);
    this.cautionExtractingProgress.set(null);
    await this.nextTick();
    // nextTick の間に新しい操作が始まっていたらキャンセル
    if (gen !== this._cautionFilterGen) return;
    try {
      if (value === 'caution' || value === 'caution_context') {
        await this.refreshCautionPinnedSegmentIds(value === 'caution_context', gen);
        if (gen !== this._cautionFilterGen) return;
        this.segmentRowFilter.set(value as 'caution' | 'caution_context');
      } else {
        const BATCH = 50;
        const total = this.segmentRows.length;
        this._allRenderLimit.set(BATCH);
        this.cautionPinnedSegmentIds.set({});
        this.segmentRowFilter.set('all');
        let limit = Math.min(BATCH, total);
        this.cautionExtractingProgress.set({ current: limit, total });
        while (limit < total) {
          await this.nextTick();
          if (gen !== this._cautionFilterGen) {
            this._allRenderLimit.set(Number.MAX_SAFE_INTEGER);
            return;
          }
          limit = Math.min(limit + BATCH, total);
          this._allRenderLimit.set(limit);
          this.cautionExtractingProgress.set({ current: limit, total });
        }
        // 最終バッチを描画してからスピナーを消す
        await this.nextTick();
        if (gen !== this._cautionFilterGen) {
          this._allRenderLimit.set(Number.MAX_SAFE_INTEGER);
          return;
        }
      }
    } finally {
      if (gen === this._cautionFilterGen) {
        this.cautionExtracting.set(false);
        this.cautionExtractingProgress.set(null);
      }
    }
  }

  private nextTick(): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, 0));
  }

  private async refreshCautionPinnedSegmentIds(withContext: boolean, gen: number): Promise<void> {
    const rows = this.segmentRows;
    const total = rows.length;
    const nextPinned: Record<number, boolean> = {};
    const CHUNK = 80;
    for (let i = 0; i < rows.length; i++) {
      if (gen !== this._cautionFilterGen) return;
      if (this.isCautionSegment(rows[i])) {
        nextPinned[rows[i].id] = true;
        if (withContext) {
          if (i > 0) nextPinned[rows[i - 1].id] = true;
          if (i < rows.length - 1) nextPinned[rows[i + 1].id] = true;
        }
      }
      if ((i + 1) % CHUNK === 0 && i + 1 < rows.length) {
        this.cautionExtractingProgress.set({ current: i + 1, total });
        await this.nextTick();
      }
    }
    if (gen === this._cautionFilterGen) {
      this.cautionExtractingProgress.set({ current: total, total });
      this.cautionPinnedSegmentIds.set(nextPinned);
    }
  }

  private isCautionSegment(segment: TranscriptionSegment): boolean {
    const hasUnassignedSpeaker = this.getAssignedSpeakerKey(segment).trim().length === 0;
    return this.getProofreadHighlightLevel(segment.id) !== 'none' || hasUnassignedSpeaker;
  }

  private compactProofreadHintText(valueRaw: string): string {
    return this.compactProofreadHintTextWithMax(valueRaw, 120);
  }

  private compactProofreadHintTextWithMax(valueRaw: string, maxLen: number): string {
    const value = (valueRaw ?? '').replace(/\s+/g, ' ').trim();
    if (value.length <= maxLen) {
      return value;
    }
    return `${value.slice(0, maxLen)}...`;
  }

  formatEstimatedMinutes(minutes: number | null): string {
    if (minutes === null || Number.isNaN(minutes)) {
      return '-';
    }
    return `${minutes}`;
  }

  formatAudioDuration(seconds: number | null): string {
    if (seconds === null || Number.isNaN(seconds) || seconds <= 0) {
      return '-';
    }
    const total = Math.floor(seconds);
    const min = Math.floor(total / 60);
    const sec = total % 60;
    return `${min}分${sec}秒`;
  }

  getAudioDurationMessage(): string {
    if (this.estimatingTime()) {
      return '（計算中...）';
    }
    return this.formatAudioDuration(this.estimatedAudioSeconds());
  }

  getEstimatedTimeMessage(): string {
    if (this.estimatingTime()) {
      return '（計算中...）';
    }
    const audioSeconds = this.estimatedAudioSeconds();
    if (!audioSeconds || audioSeconds <= 0) {
      return '音声ファイルを選択すると表示されます。';
    }
    if (!this.estimateReady()) {
      return `まだ時間の推定には十分なデータが集まっていません。（${this.estimateSampleCount()}/${this.estimateMinRequired}件）`;
    }
    return `最低 ${this.formatEstimatedMinutes(this.estimatedMinMinutes())} 分、概算 ${this.formatEstimatedMinutes(
      this.estimatedAvgMinutes()
    )} 分`;
  }

  getEstimatedTimeLabel(): string {
    return `文字起こし推定所要時間（${this.resolveEstimateComputeType()}）`;
  }

  private async updateEstimatedTimeFromPath(path: string): Promise<void> {
    this.estimatingTime.set(true);
    try {
      const src = await this.resolvePlayableAudioSrc(path);
      const duration = await this.loadAudioDurationFromSrc(src);
      this.estimatedAudioSeconds.set(duration);
      this.recalculateEstimatedTime(duration);
    } catch {
      this.estimatedAudioSeconds.set(null);
      this.estimatedMinMinutes.set(null);
      this.estimatedAvgMinutes.set(null);
      this.estimatedAvgSeconds.set(null);
    } finally {
      this.estimatingTime.set(false);
    }
  }

  private async updateEstimatedTimeFromFile(file: File): Promise<void> {
    this.estimatingTime.set(true);
    const objectUrl = URL.createObjectURL(file);
    try {
      const duration = await this.loadAudioDurationFromSrc(objectUrl);
      this.estimatedAudioSeconds.set(duration);
      this.recalculateEstimatedTime(duration);
    } catch {
      this.estimatedAudioSeconds.set(null);
      this.estimatedMinMinutes.set(null);
      this.estimatedAvgMinutes.set(null);
      this.estimatedAvgSeconds.set(null);
    } finally {
      URL.revokeObjectURL(objectUrl);
      this.estimatingTime.set(false);
    }
  }

  private recalculateEstimatedTime(durationSeconds: number): void {
    const samples = this.pickEstimateSamplesForCurrentProfile();
    this.estimateSampleCount.set(samples.length);
    if (samples.length < this.estimateMinRequired) {
      this.estimateReady.set(false);
      this.estimatedMinMinutes.set(null);
      this.estimatedAvgMinutes.set(null);
      this.estimatedAvgSeconds.set(null);
      return;
    }

    const rtfs = samples
      .map((s) => s.elapsedSeconds / s.audioSeconds)
      .filter((v) => Number.isFinite(v) && v > 0)
      .sort((a, b) => a - b);
    if (rtfs.length < this.estimateMinRequired) {
      this.estimateReady.set(false);
      this.estimatedMinMinutes.set(null);
      this.estimatedAvgMinutes.set(null);
      this.estimatedAvgSeconds.set(null);
      return;
    }

    const minRtf = rtfs[Math.floor((rtfs.length - 1) * 0.3)];
    const avgRtf = rtfs[Math.floor((rtfs.length - 1) * 0.6)];
    this.estimateReady.set(true);
    this.estimatedMinMinutes.set(this.secondsToEstimatedMinutes(durationSeconds * minRtf));
    this.estimatedAvgMinutes.set(this.secondsToEstimatedMinutes(durationSeconds * avgRtf));
    const avgSeconds = durationSeconds * avgRtf;
    this.estimatedAvgSeconds.set(Number.isFinite(avgSeconds) && avgSeconds > 0 ? avgSeconds : null);
  }

  private secondsToEstimatedMinutes(seconds: number): number {
    if (!Number.isFinite(seconds) || seconds <= 0) {
      return 0;
    }
    return Math.max(1, Math.ceil(seconds / 60));
  }

  private loadAudioDurationFromSrc(src: string): Promise<number> {
    return new Promise((resolve, reject) => {
      const audio = new Audio();
      audio.preload = 'metadata';
      audio.onloadedmetadata = () => {
        const duration = audio.duration;
        if (Number.isFinite(duration) && duration > 0) {
          resolve(duration);
        } else {
          reject(new Error('duration unavailable'));
        }
      };
      audio.onerror = () => reject(new Error('audio load failed'));
      audio.src = src;
    });
  }

  private loadEstimateSamples(): void {
    if (typeof window === 'undefined') {
      return;
    }
    try {
      const raw = window.localStorage.getItem(this.estimateStorageKey);
      if (!raw) {
        this.estimateSamples = [];
        return;
      }
      const parsed = JSON.parse(raw) as unknown[];
      if (!Array.isArray(parsed)) {
        this.estimateSamples = [];
        return;
      }
      this.estimateSamples = parsed
        .map((v) => v as Partial<RuntimeEstimateSample>)
        .filter((s) =>
          Number.isFinite(s.audioSeconds) &&
          Number.isFinite(s.elapsedSeconds) &&
          typeof s.diarization === 'boolean' &&
          typeof s.computeType === 'string' &&
          Number.isFinite(s.createdAt)
        )
        .map((s) => ({
          audioSeconds: Number(s.audioSeconds),
          elapsedSeconds: Number(s.elapsedSeconds),
          diarization: Boolean(s.diarization),
          device: typeof s.device === 'string' ? this.normalizeTranscriptionDeviceForEstimate(s.device) : 'cuda',
          computeType: String(s.computeType),
          createdAt: Number(s.createdAt),
          fileSizeBytes: Number.isFinite(s.fileSizeBytes) ? Number(s.fileSizeBytes) : null
        }));
    } catch {
      this.estimateSamples = [];
    }
  }

  private persistEstimateSamples(): void {
    if (typeof window === 'undefined') {
      return;
    }
    try {
      window.localStorage.setItem(this.estimateStorageKey, JSON.stringify(this.estimateSamples));
    } catch {
      // ignore
    }
  }

  private loadAppSettings(): void {
    if (typeof window === 'undefined') {
      this.appSettings = {};
      return;
    }
    try {
      const raw = window.localStorage.getItem(this.appSettingsStorageKey);
      if (!raw) {
        this.appSettings = {};
        return;
      }
      const parsed = JSON.parse(raw) as AppSettingsV1;
      this.appSettings = parsed && typeof parsed === 'object' ? parsed : {};
    } catch {
      this.appSettings = {};
    }
  }

  private persistAppSettings(): void {
    if (typeof window === 'undefined') {
      return;
    }
    try {
      window.localStorage.setItem(this.appSettingsStorageKey, JSON.stringify(this.appSettings));
    } catch {
      // ignore
    }
  }

  private applyAppSettings(): void {
    const transcription = this.appSettings.transcription;
    if (transcription && typeof transcription.device === 'string') {
      this.transcriptionDevice.set(this.normalizeTranscriptionDevice(transcription.device));
    }
    if (transcription && typeof transcription.computeType === 'string') {
      this.computeType.set(this.normalizeComputeType(transcription.computeType));
    }
    if (transcription && typeof transcription.language === 'string') {
      this.transcriptionLanguage.set(this.normalizeTranscriptionLanguage(transcription.language));
    }
    if (transcription && Number.isInteger(transcription.hipDeviceIndex)) {
      this.selectedHipDeviceIndex.set(transcription.hipDeviceIndex!);
    }

    const playback = this.appSettings.playback;
    if (playback && Number.isFinite(playback.rate) && this.playbackRateOptions.includes(Number(playback.rate))) {
      this.playbackRate.set(Number(playback.rate));
    }

    const proofread = this.appSettings.proofread;
    if (proofread) {
      if (Number.isFinite(proofread.chunkSize)) {
        this.proofreadChunkSize.set(this.normalizeProofreadChunkSize(Number(proofread.chunkSize)));
      }
      if (Number.isFinite(proofread.chunkMaxChars)) {
        this.proofreadChunkMaxChars.set(this.normalizeProofreadChunkMaxChars(Number(proofread.chunkMaxChars)));
      }
      if (typeof proofread.continueAfterTranscription === 'boolean') {
        this.continueProofreadAfterTranscription.set(proofread.continueAfterTranscription);
      }
      const locationScope = this.normalizeLocationDetectionScope(proofread.locationDetectionScope);
      this.selectedLocationArea.set(locationScope.area ?? 'kanto');
      this.selectedLocationPrefecturesByArea.set(locationScope.prefecturesByArea ?? {});
      this.selectedLocationPrefectures.set(locationScope.prefectures);
    }

    const diarization = this.appSettings.diarization;
    if (diarization) {
      if (typeof diarization.device === 'string') {
        this.diarizationDevice.set(this.normalizeTranscriptionDevice(diarization.device));
      }
      if (Number.isFinite(diarization.speakerCount)) {
        const normalized = Math.max(1, Math.min(5, Math.floor(Number(diarization.speakerCount))));
        this.speakerCount.set(normalized);
      }
    }

    const exportSettings = this.appSettings.export;
    if (exportSettings && typeof exportSettings.addUtteranceNumber === 'boolean') {
      this.addUtteranceNumber.set(exportSettings.addUtteranceNumber);
    }

    const llm = this.appSettings.llm;
    if (llm && typeof llm.modelPath === 'string' && llm.modelPath) {
      this.llmModelPath.set(llm.modelPath);
    }
    this.applyBackendModeFromSettings();
    // llmGpuMode: 旧値（cuda_only/cuda_parallel/amd_gpu）はすべて 'gpu' に移行
    if (llm?.llmGpuMode === 'cpu') {
      this.llmGpuMode.set('cpu');
    } else {
      this.llmGpuMode.set('gpu');
    }
    if (llm && typeof llm.lemonadeUrl === 'string' && llm.lemonadeUrl) {
      // 13305 はシステムスナップ用ポート。アプリ固有の 13306 へ移行する。
      const migratedUrl = llm.lemonadeUrl === 'http://localhost:13305'
        ? 'http://localhost:13306'
        : llm.lemonadeUrl;
      this.lemonadeUrl.set(migratedUrl);
    }
    // 旧既定（非QAT版）と 12B 実験時代の保存値は破棄し、既定の E4B QAT へ移行する。
    const staleLemonadeModels = [
      'Gemma-4-E4B-it-GGUF',
      'gemma-4-12B-qat-text',
      'gemma-4-12B-it-qat-GGUF-UD-Q4_K_XL',
    ];
    if (
      llm && typeof llm.lemonadeModel === 'string' && llm.lemonadeModel
      && !staleLemonadeModels.includes(llm.lemonadeModel)
    ) {
      this.lemonadeModel.set(llm.lemonadeModel);
    }
    if (llm && typeof llm.lmstudioModel === 'string' && llm.lmstudioModel) {
      this.lmstudioModelInput.set(llm.lmstudioModel);
    }
    if (llm && typeof llm.ollamaModel === 'string' && llm.ollamaModel) {
      this.ollamaModelInput.set(llm.ollamaModel);
    }
    if (typeof llm?.lemonadeBackendNotNeeded === 'boolean') {
      this.lemonadeBackendNotNeeded.set(llm.lemonadeBackendNotNeeded);
    }
    if (llm && Number.isInteger(llm.llmHipDeviceIndex) && (llm.llmHipDeviceIndex as number) >= -1) {
      this.selectedLlmHipDeviceIndex.set(llm.llmHipDeviceIndex as number);
    }
    if (llm?.llmPromptType === 'gemma4' || llm?.llmPromptType === 'original') {
      this.llmPromptType.set(llm.llmPromptType);
    }
    if (llm && Number.isInteger(llm.llmParallel) && (llm.llmParallel as number) >= 0) {
      this.selectedLlmParallel.set(this.normalizeLlmParallel(llm.llmParallel as number));
    }
    // 校正AIモデル階層は localStorage を初期 UI 値にする（最終的な真実はバックエンドのマーカー。
    // initProofreadModelTier() が起動時に同期する）。AMD/Editor 版は 12B 非対応のため 'e4b' に丸める。
    if ((llm?.proofreadModelTier === '12b') && !this.editorOnlyBuild) {
      this.proofreadModelTier.set('12b');
    } else {
      this.proofreadModelTier.set('e4b');
    }
    if (this.llmBackendMode() === 'local_gguf') {
      this.llmPromptType.set('gemma4');
    }

    this.applyLlmInferenceParamsForSelectedModel();
    this.updateDevEmulationLabelFromSettings();
  }

  private persistTranscriptionSettings(): void {
    this.appSettings = {
      ...this.appSettings,
      transcription: {
        device: this.normalizeTranscriptionDevice(this.transcriptionDevice()),
        computeType: this.normalizeComputeType(this.computeType()),
        language: this.normalizeTranscriptionLanguage(this.transcriptionLanguage()),
        hipDeviceIndex: this.selectedHipDeviceIndex()
      }
    };
    this.persistAppSettings();
  }

  private normalizeComputeType(valueRaw: string): ComputeTypeOption {
    const value = (valueRaw ?? '').trim().toLowerCase();
    switch (value) {
      case 'auto':
      case 'float16':
      case 'float32':
      case 'int8_float16':
      case 'int8':
        return value;
      default:
        return 'auto';
    }
  }

  /** 文字起こし言語コードを正規化する。選択肢に無い値は既定の ja に戻す。 */
  private normalizeTranscriptionLanguage(valueRaw: string): string {
    const value = (valueRaw ?? '').trim().toLowerCase();
    return this.transcriptionLanguageOptions.some((o) => o.value === value) ? value : 'ja';
  }

  onTranscriptionLanguageChange(value: string): void {
    this.transcriptionLanguage.set(this.normalizeTranscriptionLanguage(value));
    this.persistTranscriptionSettings();
  }

  private normalizeTranscriptionDevice(valueRaw: string): TranscriptionDeviceOption {
    const value = (valueRaw ?? '').trim().toLowerCase();
    if (value === 'cpu') {
      return 'cpu';
    }
    return 'cuda';
  }

  private normalizeTranscriptionDeviceForEstimate(valueRaw: string): 'cuda' | 'cpu' {
    const value = (valueRaw ?? '').trim().toLowerCase();
    if (value === 'cpu') {
      return 'cpu';
    }
    return 'cuda';
  }

  private normalizeLocationArea(valueRaw: unknown): LocationAreaCode {
    const value = String(valueRaw ?? '').trim();
    if (value === 'hokkaido' || value === 'tohoku') {
      return 'hokkaidoTohoku';
    }
    return this.locationAreaOptions.some((option) => option.value === value)
      ? value as LocationAreaCode
      : 'kanto';
  }

  private getLocationAreaPrefectureCodes(areaRaw: unknown): string[] {
    switch (this.normalizeLocationArea(areaRaw)) {
      case 'hokkaidoTohoku':
        return ['01', '02', '03', '04', '05', '06', '07'];
      case 'chubu':
        return ['15', '16', '17', '18', '19', '20', '21', '22', '23'];
      case 'kinki':
        return ['24', '25', '26', '27', '28', '29', '30'];
      case 'chugoku':
        return ['31', '32', '33', '34', '35'];
      case 'shikoku':
        return ['36', '37', '38', '39'];
      case 'kyushuOkinawa':
        return ['40', '41', '42', '43', '44', '45', '46', '47'];
      case 'kanto':
      default:
        return ['08', '09', '10', '11', '12', '13', '14'];
    }
  }

  private getLocationAreaLabel(areaRaw: unknown): string {
    const area = this.normalizeLocationArea(areaRaw);
    return this.locationAreaOptions.find((option) => option.value === area)?.label ?? '関東';
  }

  private inferLocationAreaFromPrefectures(prefectures: string[]): LocationAreaCode {
    const first = prefectures[0];
    if (!first) {
      return 'kanto';
    }
    return this.locationAreaOptions.find((area) =>
      this.getLocationAreaPrefectureCodes(area.value).includes(first)
    )?.value ?? 'kanto';
  }

  private normalizeLocationDetectionMode(valueRaw: unknown): LocationDetectionMode {
    return valueRaw === 'selectedRegions' ? 'selectedRegions' : 'commonOnly';
  }

  private normalizeLocationPrefectureCodes(value: unknown): string[] {
    if (!Array.isArray(value)) {
      return [];
    }
    const validCodes = new Set(this.locationPrefectureOptions.map((option) => option.value));
    const seen = new Set<string>();
    const out: string[] = [];
    for (const item of value) {
      const code = String(item ?? '').trim();
      if (validCodes.has(code) && !seen.has(code)) {
        out.push(code);
        seen.add(code);
      }
    }
    return out;
  }

  private normalizeLocationPrefecturesByArea(raw: unknown): Partial<Record<LocationAreaCode, string[]>> {
    if (!raw || typeof raw !== 'object') {
      return {};
    }
    const obj = raw as Record<string, unknown>;
    const out: Partial<Record<LocationAreaCode, string[]>> = {};
    for (const areaOption of this.locationAreaOptions) {
      const area = areaOption.value;
      const areaCodes = new Set(this.getLocationAreaPrefectureCodes(area));
      const values = area === 'hokkaidoTohoku'
        ? [obj[area], obj['hokkaido'], obj['tohoku']]
        : [obj[area]];
      const prefectures = this.normalizeLocationPrefectureCodes(
        values.flatMap((value) => this.normalizeLocationPrefectureCodes(value))
      ).filter((code) => areaCodes.has(code));
      if (prefectures.length > 0) {
        out[area] = prefectures;
      }
    }
    return out;
  }

  private normalizeLocationDetectionScope(raw: unknown): LocationDetectionScope {
    if (!raw || typeof raw !== 'object') {
      const area = 'kanto';
      return { mode: 'commonOnly', area, prefectures: [], prefecturesByArea: {} };
    }
    const obj = raw as Partial<LocationDetectionScope>;
    const rawPrefectures = this.normalizeLocationPrefectureCodes(obj.prefectures);
    const prefecturesByArea = this.normalizeLocationPrefecturesByArea(obj.prefecturesByArea);
    const area = this.normalizeLocationArea(obj.area ?? this.inferLocationAreaFromPrefectures(rawPrefectures));
    const areaCodes = new Set(this.getLocationAreaPrefectureCodes(area));
    const scopedPrefectures = rawPrefectures.filter((code) => areaCodes.has(code));
    const mergedPrefecturesByArea = { ...prefecturesByArea };
    if (scopedPrefectures.length > 0) {
      mergedPrefecturesByArea[area] = scopedPrefectures;
    }
    const activePrefectures = scopedPrefectures.length > 0
      ? scopedPrefectures
      : (mergedPrefecturesByArea[area] ?? []);
    return {
      mode: activePrefectures.length > 0
        ? 'selectedRegions'
        : 'commonOnly',
      area,
      prefectures: activePrefectures,
      prefecturesByArea: mergedPrefecturesByArea
    };
  }

  private buildLocationDetectionScopeRequest(): LocationDetectionScope {
    const area = this.selectedLocationArea();
    const areaCodes = new Set(this.getLocationAreaPrefectureCodes(area));
    const prefectures = this.normalizeLocationPrefectureCodes(this.selectedLocationPrefectures())
      .filter((code) => areaCodes.has(code));
    const prefecturesByArea = { ...this.selectedLocationPrefecturesByArea() };
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

  private persistProofreadSettings(): void {
    this.appSettings = {
      ...this.appSettings,
      proofread: {
        chunkSize: this.normalizeProofreadChunkSize(this.proofreadChunkSize()),
        chunkMaxChars: this.normalizeProofreadChunkMaxChars(this.proofreadChunkMaxChars()),
        continueAfterTranscription: this.continueProofreadAfterTranscription(),
        locationDetectionScope: this.buildLocationDetectionScopeRequest()
      }
    };
    this.persistAppSettings();
  }

  private persistDiarizationSettings(): void {
    this.appSettings = {
      ...this.appSettings,
      diarization: {
        device: this.normalizeTranscriptionDevice(this.diarizationDevice()),
        speakerCount: this.speakerCount()
      }
    };
    this.persistAppSettings();
  }

  private recordEstimateSample(sample: RuntimeEstimateSample): void {
    if (!Number.isFinite(sample.audioSeconds) || sample.audioSeconds <= 0) {
      return;
    }
    if (!Number.isFinite(sample.elapsedSeconds) || sample.elapsedSeconds <= 0) {
      return;
    }
    this.estimateSamples.push(sample);
    if (this.estimateSamples.length > 120) {
      this.estimateSamples = this.estimateSamples.slice(this.estimateSamples.length - 120);
    }
    this.persistEstimateSamples();
  }

  private pickEstimateSamplesForCurrentProfile(): RuntimeEstimateSample[] {
    const diarization = this.diarization();
    const device = this.normalizeTranscriptionDeviceForEstimate(this.transcriptionDevice());
    const compute = this.resolveEstimateComputeType();
    const sameDiarization = this.estimateSamples.filter((s) => s.diarization === diarization);
    const sameDevice = sameDiarization.filter((s) => s.device === device);
    return sameDevice.filter((s) => s.computeType === compute);
  }

  private resolveEstimateComputeType(): ConcreteComputeType {
    if (this.transcriptionDevice() === 'cpu') {
      return 'int8';
    }
    const selected = this.computeType();
    if (selected !== 'auto') {
      return selected;
    }
    return 'float16';
  }

  private detectTauriRuntime(): boolean {
    return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
  }

  private async debounceDevWindowFocus(): Promise<void> {
    if (!this.isTauriRuntime()) {
      return;
    }

    try {
      await invoke<boolean>('debounce_dev_window_focus');
    } catch {
      // 開発時のウィンドウ制御だけなので、失敗しても通常動作を優先する。
    }
  }

  constructor(
    private readonly snackBar: MatSnackBar,
    private readonly dialog: MatDialog,
    private readonly ngZone: NgZone,
    private readonly appRef: ApplicationRef,
  ) {}

  ngOnInit(): void {
    void this.debounceDevWindowFocus();
    this.loadEditorLowMemoryVoiceInputOptIn();
    this.loadAppSettings();
    this.applyAppSettings();
    this.loadEstimateSamples();
    void this.initializeStartupState();
    window.addEventListener('scroll', this._overallProofreadScrollListener, { passive: true });
  }

  ngAfterViewInit(): void {
    this.segmentViewports.changes.subscribe(() =>
      requestAnimationFrame(this._refreshSegmentTableInView)
    );
    window.addEventListener('scroll', this._refreshSegmentTableInView, { passive: true });
  }

  private readonly _refreshSegmentTableInView = (): void => {
    const viewport = this.activeSegmentViewport;
    const el = viewport?.elementRef.nativeElement as HTMLElement | undefined;
    const rect = el?.getBoundingClientRect();
    this.isSegmentTableInView.set(!!rect && rect.bottom > 0 && rect.top < window.innerHeight);
  };

  ngOnDestroy(): void {
    this.stopRunningTicker();
    this.stopSmoothProgress();
    this.stopProofreadTicker();
    this.stopDiarizationTicker();
    this.stopSegmentPlayback();
    this.revokePreviewObjectUrl();
    if (this.progressUnlisten) {
      this.progressUnlisten();
      this.progressUnlisten = null;
    }
    if (this.parallelDiarUnlisten) {
      this.parallelDiarUnlisten();
      this.parallelDiarUnlisten = null;
    }
    if (this.voiceInputPackProgressUnlisten) {
      this.voiceInputPackProgressUnlisten();
      this.voiceInputPackProgressUnlisten = null;
    }
    this.cleanupVoiceInputRecording(false);
    if (this.llmEngineUiVisible()) {
      this.stopLlm();
    }
    window.removeEventListener('scroll', this._overallProofreadScrollListener);
    if (this._overallProofreadScrollRaf !== null) {
      cancelAnimationFrame(this._overallProofreadScrollRaf);
    }
    window.removeEventListener('scroll', this._refreshSegmentTableInView);
  }

  @HostListener('window:keydown', ['$event'])
  onWindowFindShortcut(event: KeyboardEvent): void {
    if (!event.ctrlKey || !event.shiftKey || event.altKey || event.metaKey) {
      return;
    }
    const key = (event.key ?? '').toLowerCase();
    if (key !== 'f') {
      return;
    }
    event.preventDefault();
    this.openFindReplaceDialog();
  }

  private isEditableEventTarget(target: EventTarget | null): boolean {
    if (!(target instanceof HTMLElement)) {
      return false;
    }
    const tag = target.tagName.toLowerCase();
    if (tag === 'input' || tag === 'textarea' || tag === 'select') {
      return true;
    }
    return target.isContentEditable;
  }

  openFindReplaceDialog(): void {
    if (!this.result() || this.segmentRows.length === 0) {
      this.snackBar.open('先に文字起こしを行ってください', undefined, { duration: 2200 });
      return;
    }
    this.findReplaceStatus.set('');
    this.findReplaceOpen.set(true);
    setTimeout(() => {
      const input = document.getElementById('find-replace-find-input') as HTMLInputElement | null;
      input?.focus();
      input?.select();
    }, 0);
  }

  closeFindReplaceDialog(): void {
    this.findReplaceOpen.set(false);
    this.findReplaceStatus.set('');
  }

  replaceOneInContents(): void {
    const findText = this.findReplaceQuery();
    if (!findText) {
      this.findReplaceStatus.set('検索文字列を入力してください。');
      return;
    }
    const replaceText = this.findReplaceWith();
    const current = { ...this.editedSegmentTextMap() };

    for (const segment of this.segmentRows) {
      const before = this.getEditableText(segment);
      const idx = before.indexOf(findText);
      if (idx < 0) {
        continue;
      }
      const after = `${before.slice(0, idx)}${replaceText}${before.slice(idx + findText.length)}`;
      current[segment.id] = after;
      this.editedSegmentTextMap.set(current);
      this.clearProofreadMetadataIfTextDiverged(segment.id, after);
      this.findReplaceStatus.set('1 件置換しました。');
      return;
    }

    this.findReplaceStatus.set('一致が見つかりませんでした。');
  }

  replaceAllInContents(): void {
    const findText = this.findReplaceQuery();
    if (!findText) {
      this.findReplaceStatus.set('検索文字列を入力してください。');
      return;
    }
    const replaceText = this.findReplaceWith();
    const current = { ...this.editedSegmentTextMap() };
    let total = 0;

    for (const segment of this.segmentRows) {
      const before = this.getEditableText(segment);
      const count = this.countSubstringOccurrences(before, findText);
      if (count <= 0) {
        continue;
      }
      const after = before.split(findText).join(replaceText);
      current[segment.id] = after;
      this.clearProofreadMetadataIfTextDiverged(segment.id, after);
      total += count;
    }

    if (total > 0) {
      this.editedSegmentTextMap.set(current);
      this.findReplaceStatus.set(`${total} 件置換しました。`);
      return;
    }
    this.findReplaceStatus.set('一致が見つかりませんでした。');
  }

  private countSubstringOccurrences(text: string, needle: string): number {
    if (!needle) {
      return 0;
    }
    let count = 0;
    let start = 0;
    while (true) {
      const idx = text.indexOf(needle, start);
      if (idx < 0) {
        break;
      }
      count += 1;
      start = idx + needle.length;
    }
    return count;
  }

  async onBrowserFileSelected(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) {
      return;
    }
    this.audioFileLoading.set(true);
    try {
      this.selectedAudioPath.set(file.name);
      this.selectedAudioFileSizeBytes.set(file.size);
      this.transcriptionRunLockedByImport.set(false);
      await this.updateEstimatedTimeFromFile(file);
    } finally {
      this.audioFileLoading.set(false);
    }
  }

  async onBrowserImportJsonSelected(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) {
      return;
    }
    this.error.set('');
    this.errorCopiedMessage.set('');
    this.importJsonLoading.set(true);
    await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
    try {
      const content = await file.text();
      this.loadImportJsonContent(content);
    } catch (error) {
      this.error.set(`JSON 読み取りに失敗しました: ${this.normalizeErrorMessage(error)}`);
    } finally {
      this.importJsonLoading.set(false);
      input.value = '';
    }
  }

  async onBrowserReaderAudioSelected(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) {
      return;
    }
    this.selectedAudioPath.set(file.name);
    this.selectedAudioFileSizeBytes.set(file.size);
    await this.updateEstimatedTimeFromFile(file);
    this.importAudioReady.set(true);
    this.importStatusMessage.set(this.getImportCompletedMessage());
    input.value = '';
  }

  async selectImportJsonFile(): Promise<void> {
    if (this.importJsonLoading()) {
      return;
    }
    if (this.result()) {
      this.openConfirmDialog({
        actionKind: 'importJsonOverwrite',
        title: '上書き確認',
        message: '現在のデータが上書きされますが、よろしいですか？',
        confirmLabel: '読み取りを続行',
        cancelLabel: 'キャンセル',
        confirmColor: 'warn',
        cancelColor: null
      });
      return;
    }
    await this.proceedSelectImportJsonFile();
  }

  private async proceedSelectImportJsonFile(): Promise<void> {
    this.error.set('');
    this.errorCopiedMessage.set('');

    if (!this.isTauriRuntime()) {
      const input = document.getElementById('browser-import-json-input') as HTMLInputElement | null;
      input?.click();
      return;
    }

    const devDir = await this.getDevDemoDataDir();
    const selected = await open({
      multiple: false,
      filters: [{ name: 'JSON', extensions: ['json'] }],
      ...(devDir ? { defaultPath: devDir } : {})
    });

    if (typeof selected !== 'string') {
      return;
    }

    this.importJsonLoading.set(true);
    await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
    try {
      const response = await invoke<ReadTextFileResponse>('read_text_file', {
        request: { path: selected }
      });
      this.loadImportJsonContent(response.content);
    } catch (error) {
      this.error.set(`JSON 読み取りに失敗しました: ${this.normalizeErrorMessage(error)}`);
    } finally {
      this.importJsonLoading.set(false);
    }
  }

  async selectAudioFileForReader(): Promise<void> {
    this.error.set('');
    this.errorCopiedMessage.set('');

    if (!this.importJsonReady() || !this.pendingImportedPayload) {
      this.error.set('先に JSON を読み込んでください。');
      return;
    }

    if (!this.isTauriRuntime()) {
      const input = document.getElementById('browser-reader-audio-input') as HTMLInputElement | null;
      input?.click();
      return;
    }

    const devDir = await this.getDevDemoDataDir();
    const selected = await open({
      multiple: false,
      filters: [
        {
          name: 'Audio',
          extensions: ['wav', 'mp3', 'm4a', 'flac', 'ogg', 'aac', 'mp4', 'webm']
        }
      ],
      ...(devDir ? { defaultPath: devDir } : {})
    });

    if (typeof selected === 'string') {
      this.audioFileLoading.set(true);
      try {
        this.selectedAudioPath.set(selected);
        await this.updateSelectedAudioFileSizeFromPath(selected);
        await this.updateEstimatedTimeFromPath(selected);
        this.importAudioReady.set(true);
        this.importStatusMessage.set(this.getImportCompletedMessage());
      } finally {
        this.audioFileLoading.set(false);
      }
    }
  }

  async selectAudioFile(): Promise<void> {
    this.error.set('');
    this.errorCopiedMessage.set('');
    if (this.isTranscriptionTabDisabled()) {
      this.error.set('この環境では CUDA が確認できないため、文字起こし機能は利用できません。');
      return;
    }

    if (!this.isTauriRuntime()) {
      const input = document.getElementById('browser-file-input') as HTMLInputElement | null;
      input?.click();
      return;
    }

    const devDir = await this.getDevDemoDataDir();
    const selected = await open({
      multiple: false,
      filters: [
        {
          name: 'Audio',
          extensions: ['wav', 'mp3', 'm4a', 'flac', 'ogg', 'aac', 'mp4', 'webm']
        }
      ],
      ...(devDir ? { defaultPath: devDir } : {})
    });

    if (typeof selected === 'string') {
      this.audioFileLoading.set(true);
      try {
        this.selectedAudioPath.set(selected);
        await this.updateSelectedAudioFileSizeFromPath(selected);
        this.transcriptionRunLockedByImport.set(false);
        await this.updateEstimatedTimeFromPath(selected);
      } finally {
        this.audioFileLoading.set(false);
      }
      // this.openConfirmDialog({
      //   actionKind: 'startTranscriptionConfirm',
      //   title: '文字起こしの開始',
      //   message: '音声ファイルの読み込みが完了しました。文字起こしを開始しますか？',
      //   confirmLabel: '開始する',
      //   cancelLabel: '後で',
      //   confirmColor: 'primary',
      //   cancelColor: null,
      // });
    }
  }

  onComputeTypeChange(value: ComputeTypeOption): void {
    this.computeType.set(value);
    this.persistTranscriptionSettings();
    const seconds = this.estimatedAudioSeconds();
    if (seconds && seconds > 0) {
      this.recalculateEstimatedTime(seconds);
    }
  }

  onHighpassFilterChange(checked: boolean): void {
    this.highpassFilter.set(Boolean(checked));
  }

  onNoiseReductionChange(checked: boolean): void {
    this.noiseReduction.set(Boolean(checked));
    if (checked) {
      this.noiseReductionMode.set('weak');
    }
  }

  onNormalizeAudioChange(checked: boolean): void {
    this.normalizeAudio.set(Boolean(checked));
  }

  onAudioPreprocessPresetChange(value: AudioPreprocessPreset): void {
    switch (value) {
      case 'none':
        this.highpassFilter.set(false);
        this.noiseReduction.set(false);
        this.normalizeAudio.set(false);
        this.noiseReductionMode.set('weak');
        break;
      case 'low_noise':
        this.highpassFilter.set(true);
        this.noiseReduction.set(false);
        this.normalizeAudio.set(false);
        this.noiseReductionMode.set('weak');
        break;
      case 'strong_noise':
        this.highpassFilter.set(true);
        this.noiseReduction.set(true);
        this.normalizeAudio.set(false);
        this.noiseReductionMode.set('weak');
        break;
      case 'volume_boost':
        this.highpassFilter.set(true);
        this.noiseReduction.set(false);
        this.normalizeAudio.set(true);
        this.noiseReductionMode.set('weak');
        break;
      case 'general_improvement':
        this.highpassFilter.set(true);
        this.noiseReduction.set(true);
        this.normalizeAudio.set(true);
        this.noiseReductionMode.set('weak');
        break;
      case 'manual':
        break;
    }
  }

  onTranscriptionDeviceChange(valueRaw: string): void {
    const normalized = this.normalizeTranscriptionDevice(valueRaw);
    this.transcriptionDevice.set(normalized);
    this.diarizationDevice.set(normalized);
    this.persistTranscriptionSettings();
    this.persistDiarizationSettings();
  }

  onSpeakerCountChange(value: number): void {
    const normalized = Number.isFinite(value) ? Math.max(1, Math.min(5, Math.floor(value))) : 2;
    this.speakerCount.set(normalized);
    this.persistDiarizationSettings();
  }

  onDiarizationDeviceChange(valueRaw: string): void {
    this.diarizationDevice.set(this.normalizeTranscriptionDevice(valueRaw));
    this.persistDiarizationSettings();
  }

  async runTranscription(): Promise<void> {
    if (this.isTranscriptionTabDisabled() || (this.transcriptionDevice() === 'cuda' && !this.transcriptionTabVisible())) {
      this.error.set('この環境では CUDA が確認できないため、文字起こし機能は利用できません。');
      return;
    }
    if (this.llmProofreadRunning() || this.llmProofreadCanceling()) {
      this.error.set('AI校正の処理中です。先に中止または完了を待ってください。');
      return;
    }

    if (!this.isTauriRuntime()) {
      this.error.set('ブラウザ起動では文字起こしを実行できません。Tauri ウィンドウから実行してください。');
      return;
    }

    if (!this.selectedAudioPath()) {
      this.error.set('音声ファイルを選択してください。');
      return;
    }

    if (this.llmBackendMode() === 'local_gguf' && !this.llmModelPath() && !this._gemmaCheckBypassed) {
      this.openConfirmDialog({
        actionKind: 'gemmaNotFoundBeforeTranscription',
        title: 'Gemma 4モデルが見つかりません',
        message: 'AI校正用のGemma 4モデルが見つかりませんでした。\n（確認場所: python_sidecar/models/llm/gemma-4-e4b-it/）\n\nモデルなしで文字起こしを開始しますか？\nモデルのダウンロードはセットアップタブから行えます。',
        confirmLabel: 'このまま開始',
        cancelLabel: 'キャンセル',
        confirmColor: null,
        cancelColor: null,
      });
      return;
    }
    this._gemmaCheckBypassed = false;

    this.error.set('');
    this.errorWasCancelledByUser.set(false);
    this.errorCopiedMessage.set('');
    this.lastRunNotice.set('');
    this.hadRetryInCurrentRun.set(false);
    this.running.set(true);
    this.openProgressSnackbar();
    this.runningStatus.set('実行準備中...');
    this.transcriptionCanceling.set(false);
    this.runningProgress.set(0);
    this.displayProgress.set(0);
    this.runningStepCurrent.set(0);
    this.runningStepTotal.set(this.getProgressStageOrder().length);
    this.runningComputeType.set('');
    this.proofreadRunning.set(false);
    this.proofreadEditingLocked.set(false);
    this.proofreadStatus.set('');
    this.punctStatus.set('');
    this.mergeStatus.set('');
    this.proofreadStatusSource.set(null);
    this.proofreadHintBySegmentId.set({});
    this.proofreadMetadataBySegmentId.set({});
    this.proofreadUpdatedCount.set(0);
    this.proofreadCompleted.set(false);
    this.llmProofreadRunning.set(false);
    this.llmProofreadCanceling.set(false);
    this.llmProofreadStatus.set('');
    this.llmProofreadRunningSeconds.set(0);
    this.llmSegmentStatus.set({});
    this.llmProgressOffset = 0;
    this.llmTotalProcessedCount = 0;
    this.diarizationPhaseActive.set(false);
    this.diarizationStage.set('');
    this.segmentRowFilter.set('all');
    this._allRenderLimit.set(Number.MAX_SAFE_INTEGER);
    this.lastObservedComputeType = null;
    this.lastObservedTranscriptionDevice = null;
    this.runningSeconds.set(0);
    this.lastRunElapsedSeconds.set(0);
    this.speakerAliasMap.set({});
    this.selectedSpeakerBySegmentId.set({});
    this.editedSegmentTextMap.set({});
    this.hiddenSegmentIds.set({});
    this.stopSegmentPlayback();
    this.result.set(null);
    this.resultSource.set(null);
    await this.ensureProgressListener();
    this.startRunningTicker();
    this.startSmoothProgress();
    const shouldAutoProofread = this.continueProofreadAfterTranscription();
    let autoEntityCheckAfterTranscription = false;

    try {
      this.runningStatus.set('Python sidecar を起動しています...');
      const response = await invoke<{ success: boolean; result?: TranscriptionResult; errorMessage?: string }>(
        'run_transcription',
        {
          request: {
            audioPath: this.selectedAudioPath(),
            diarization: true,
            speakerCount: this.speakerCount(),
            device: this.transcriptionDevice(),
            computeType: this.computeType(),
            model: this.whisperModel(),
            language: this.transcriptionLanguage(),
            initialPrompt: this.buildFinalInitialPrompt(),
            normalizeAudio: this.normalizeAudio(),
            highpassFilter: this.highpassFilter(),
            noiseReduction: this.noiseReduction(),
            noiseReductionMode: this.noiseReduction() ? this.noiseReductionMode() : 'weak',
            parallelDiarization: this.parallelMode() === 'fast',
            clusteringThreshold: this.clusteringAdjust() === 'over_split' ? 0.82
              : this.clusteringAdjust() === 'under_split' ? 0.55
              : null,
            hipDeviceIndex: this.selectedHipDeviceIndex() >= 0 ? this.selectedHipDeviceIndex() : null,
          }
        }
      );

      if (!response.success || !response.result) {
        throw new Error(response.errorMessage ?? '文字起こしに失敗しました。');
      }

      if (this.hasFallbackInResult(response.result) || this.hadRetryInCurrentRun()) {
        this.lastRunNotice.set('再試行またはフォールバックが発生しました。結果は取得できていますが、初回実行は失敗しています。');
      }

      this.result.set(response.result);
      this.resultSource.set('transcription');
      {
        const prevEdited = this.editedSegmentTextMap();
        const prevMeta = this.proofreadMetadataBySegmentId();
        const nextHints = { ...this.proofreadHintBySegmentId() };
        const nextMeta = { ...prevMeta };
        const nextEdited: Record<number, string> = {};
        const finalSegmentIds = new Set(response.result.segments.map((s) => s.id));
        for (const sid of Object.keys(nextHints).map(Number)) {
          if (!finalSegmentIds.has(sid)) { delete nextHints[sid]; delete nextMeta[sid]; }
        }
        for (const s of response.result.segments) {
          const revisedText = prevEdited[s.id];
          if (typeof revisedText === 'string') {
            const originalUsedByLlm = prevMeta[s.id]?.diff?.from;
            const match = originalUsedByLlm === (s.text ?? '');
            if (match) {
              nextEdited[s.id] = revisedText;
            } else {
              nextEdited[s.id] = s.text ?? '';
              delete nextHints[s.id];
              delete nextMeta[s.id];
            }
          } else {
            nextEdited[s.id] = s.text ?? '';
          }
        }
        this.editedSegmentTextMap.set(nextEdited);
        this.proofreadHintBySegmentId.set(nextHints);
        this.proofreadMetadataBySegmentId.set(nextMeta);
      }
      this.speakerAliasMap.set(this.buildInitialSpeakerAliasMap(response.result));
      this.selectedSpeakerBySegmentId.set(this.buildInitialSpeakerSelectionMap(response.result));
      this.focusFirstSpeakerAliasInput();
      this.lastObservedComputeType =
        String((response.result.settings as { computeType?: unknown })?.computeType ?? this.computeType());
      this.lastObservedTranscriptionDevice =
        String((response.result.settings as { device?: unknown })?.device ?? this.transcriptionDevice());
      autoEntityCheckAfterTranscription = true;
    } catch (error) {
      this.error.set(this.normalizeErrorMessage(error));
    } finally {
      const elapsed = this.runningSeconds();
      this.lastRunElapsedSeconds.set(elapsed);
      if (this.result() && elapsed > 0) {
        const audioSeconds = this.estimatedAudioSeconds();
        if (audioSeconds && audioSeconds > 0) {
          this.recordEstimateSample({
            audioSeconds,
            elapsedSeconds: elapsed,
            diarization: true,
            device: this.normalizeTranscriptionDeviceForEstimate(
              this.lastObservedTranscriptionDevice ?? this.transcriptionDevice()
            ),
            computeType: this.lastObservedComputeType ?? this.computeType(),
            createdAt: Date.now(),
            fileSizeBytes: this.selectedAudioFileSizeBytes()
          });
          this.recalculateEstimatedTime(audioSeconds);
        }
      }
      this.stopRunningTicker();
      this.stopSmoothProgress();
      this.running.set(false);
      this.runningStatus.set('');
      this.runningProgress.set(0);
      this.displayProgress.set(0);
      this.runningStepCurrent.set(0);
      this.runningStepTotal.set(0);
      this.runningComputeType.set('');
      this.parallelDiarizationStatus.set('');
      if (shouldAutoProofread || (!this.diarization() || this.parallelMode() === 'fast')) {
        await this.startAutoLlmProofread();
      }
      this.dismissProgressSnackbar();
    }

    if (autoEntityCheckAfterTranscription) {
      await this.runProofread('transcription', false, 'entity');
    }
  }

  async runDiarization(): Promise<void> {
    if (this.running() || this.proofreadRunning() || this.diarizationRunning()) {
      return;
    }
    if (this.llmProofreadRunning() || this.llmProofreadCanceling()) {
      this.error.set('AI校正の処理中です。先に中止または完了を待ってください。');
      return;
    }
    if (!this.isTauriRuntime()) {
      this.error.set('ブラウザ起動では話者分離を実行できません。Tauri ウィンドウから実行してください。');
      return;
    }
    if (!this.selectedAudioPath()) {
      this.error.set('音声ファイルを選択してください。');
      return;
    }
    if (this.requiresDiarizationSetup()) {
      this.error.set(
        `話者分離モデルが見つかりません。先にセットアップを完了してください: ${this.diarizationModelExpectedPath()}`
      );
      return;
    }
    const current = this.result();
    if (!current || this.segmentRows.length === 0) {
      this.error.set('話者分離対象の文字起こし結果がありません。先に文字起こしを実行してください。');
      return;
    }

    this.error.set('');
    this.errorCopiedMessage.set('');
    this.diarizationRunning.set(true);
    this.diarizationCanceling.set(false);
    this.diarizationRunningSeconds.set(0);
    this.updateDiarizationRunningStatus();
    this.startDiarizationTicker();
    await this.ensureProgressListener();

    let autoEntityCheckSource: ProofreadRunSource | null = null;

    try {
      const response = await invoke<{ success: boolean; result?: TranscriptionResult; errorMessage?: string }>(
        'run_diarization',
        {
          request: {
            audioPath: this.selectedAudioPath(),
            speakerCount: this.speakerCount(),
            device: this.diarizationDevice(),
            result: current,
            clusteringThreshold: this.clusteringAdjust() === 'over_split' ? 0.82
              : this.clusteringAdjust() === 'under_split' ? 0.55
              : null,
          }
        }
      );
      if (!response.success || !response.result) {
        throw new Error(response.errorMessage ?? '話者分離に失敗しました。');
      }

      this.result.set(response.result);
      this.resultSource.set(this.resultSource() ?? 'transcription');
      const prevEdited = this.editedSegmentTextMap();
      this.editedSegmentTextMap.set(
        Object.fromEntries(
          response.result.segments.map((s) => [s.id, typeof prevEdited[s.id] === 'string' ? prevEdited[s.id] : (s.text ?? '')])
        )
      );
      this.selectedSpeakerBySegmentId.set(this.buildInitialSpeakerSelectionMap(response.result));
      const existingAlias = this.speakerAliasMap();
      const inferredAlias = this.buildInitialSpeakerAliasMap(response.result);
      this.speakerAliasMap.set({ ...inferredAlias, ...existingAlias });
      const actualDeviceRaw = String(response.result.diarization?.device ?? '').trim().toLowerCase();
      if (actualDeviceRaw === 'cuda' || actualDeviceRaw === 'cpu') {
        this.diarizationDevice.set(this.normalizeTranscriptionDevice(actualDeviceRaw));
        this.persistDiarizationSettings();
      }
      const shownDevice = actualDeviceRaw === 'cpu' ? 'CPU' : (actualDeviceRaw === 'cuda' ? 'GPU' : this.diarizationDevice().toUpperCase());
      this.diarizationStatus.set(`話者分離が完了しました。（所要: ${this.diarizationRunningSeconds()} 秒 / 実行: ${shownDevice}）`);
      autoEntityCheckSource = 'transcription';
    } catch (error) {
      this.error.set(this.normalizeErrorMessage(error));
      this.diarizationStatus.set('');
    } finally {
      this.stopDiarizationTicker();
      this.diarizationRunning.set(false);
      this.diarizationCanceling.set(false);
    }

    if (autoEntityCheckSource) {
      // 「続けてAI校正」が有効なら先にLLM校正を実行し、完了後にentity checkを走らせる
      if (this.result() && this.llmModelPath()) {
        await this.startAutoLlmProofread();
      }
      await this.runProofread(autoEntityCheckSource, false, 'entity');
    }
  }

  async runProofread(source: ProofreadRunSource = 'transcription', lockEditingDuringRun = false, mode: 'all' | 'entity' | 'punct' = 'all'): Promise<void> {
    if (this.running() || this.proofreadRunning() || this.diarizationRunning()) {
      return;
    }
    if (!this.isTauriRuntime()) {
      this.error.set('ブラウザ起動では校正を実行できません。Tauri ウィンドウから実行してください。');
      return;
    }
    const current = this.result();
    if (!current || this.segmentRows.length === 0) {
      this.error.set('校正対象の文字起こし結果がありません。先に文字起こしを実行してください。');
      return;
    }

    this.error.set('');
    this.errorCopiedMessage.set('');
    const fixedChunkSize = this.fixedProofreadChunkSize;
    const fixedChunkMaxChars = this.fixedProofreadChunkMaxChars;
    this.proofreadRunning.set(true);
    this.punctStatus.set('');
    this.proofreadProgressText.set('');
    this.proofreadRunningSeconds.set(0);
    this.startProofreadTicker();
    this.proofreadEditingLocked.set(lockEditingDuringRun);
    this.proofreadStatusSource.set(source);
    this.updateProofreadRunningStatus();
    this.proofreadCanceling.set(false);
    if (mode !== 'punct') {
      this.proofreadUpdatedCount.set(0);
      if (mode !== 'entity') {
        this.proofreadHintBySegmentId.set({});
        this.proofreadMetadataBySegmentId.set({});
      }
    }

    try {
      const segments: ProofreadSegmentInput[] = this.segmentRows.map((segment) => ({
        id: segment.id,
        text: this.getEditableText(segment),
        speaker: this.getAssignedSpeakerKey(segment) || null,
        speakerLabel: this.getAssignedSpeakerKey(segment) || null,
        start: segment.start,
        end: segment.end,
        words: segment.words ?? []
      }));

      const response = await invoke<{ success: boolean; result?: ProofreadResultPayload; errorMessage?: string }>(
        'proofread_transcription',
        {
          request: {
            segments,
            chunkSize: fixedChunkSize,
            chunkMaxChars: fixedChunkMaxChars,
            mode,
            locationDetectionScope: this.buildLocationDetectionScopeRequest()
          }
        }
      );
      if (!response.success || !response.result) {
        throw new Error(response.errorMessage ?? '校正に失敗しました。');
      }

      const hintMap: Record<number, string> = (mode === 'punct' || mode === 'entity') ? { ...this.proofreadHintBySegmentId() } : {};
      const metadataMap: Record<number, ExportProofreadMetadata> = (mode === 'punct' || mode === 'entity') ? { ...this.proofreadMetadataBySegmentId() } : {};
      const currentTexts = { ...this.editedSegmentTextMap() };
      let suggestedCount = 0;
      let appliedCount = 0;
      for (const item of response.result.items ?? []) {
        const sid = Number(item.id);
        if (!Number.isFinite(sid)) {
          continue;
        }
        const prev = this.editedSegmentTextMap()[sid]
          ?? this.result()?.segments.find((s) => s.id === sid)?.text
          ?? '';
        const revised = typeof item.revisedText === 'string' ? item.revisedText : prev;
        const metadata = this.normalizeProofreadMetadata(
          prev,
          revised,
          item.confidence,
          item.reason,
          item.sensitiveEntity,
          item.lintIssues
        );
        const hasSensitiveEntity = metadata.sensitiveEntity?.hasSensitiveEntity === true;
        const hasTextChange = revised !== prev;
        const hasLintIssues = (metadata.lintIssues?.length ?? 0) > 0;
        const shouldKeepSuggestion = hasTextChange || hasSensitiveEntity || hasLintIssues;
        if (!shouldKeepSuggestion) {
          continue;
        }

        suggestedCount += 1;
        // Apply punctuation adjustment even when sensitive-entity warning exists.
        if (this.isPunctuationOnlyProofreadReason(metadata.reason) && hasTextChange) {
          currentTexts[sid] = revised;
          appliedCount += 1;
        }
        // For punct mode: preserve any existing warning from entity check; skip hint/metadata update.
        if (mode === 'punct' && metadataMap[sid] !== undefined) {
          continue;
        }
        hintMap[sid] = this.buildProofreadHint(
          metadata.diff.from,
          metadata.diff.to,
          metadata.confidence,
          metadata.reason,
          metadata.sensitiveEntity
        );
        metadataMap[sid] = metadata;
      }

      this.editedSegmentTextMap.set(currentTexts);
      this.proofreadHintBySegmentId.set(hintMap);
      this.proofreadMetadataBySegmentId.set(metadataMap);
      this.proofreadUpdatedCount.set(suggestedCount);
      if (mode === 'punct') {
        this.punctStatus.set(`${appliedCount} 行に句読点を追加しました。`);
      }
      this.proofreadCompleted.set(true);
      const elapsedSec = this.proofreadRunningSeconds() + 1;
      this.proofreadStatus.set(`完了（所要: ${elapsedSec} 秒）`);
    } catch (error) {
      this.error.set(this.normalizeErrorMessage(error));
      this.proofreadStatus.set('');
    } finally {
      this.stopProofreadTicker();
      this.proofreadRunning.set(false);
      this.proofreadEditingLocked.set(false);
      this.proofreadCanceling.set(false);
    }
  }

  async cancelTranscriptionRun(): Promise<void> {
    if (!this.running() || this.transcriptionCanceling()) {
      return;
    }
    if (!this.isTauriRuntime()) {
      return;
    }
    this.errorWasCancelledByUser.set(true);
    this.transcriptionCanceling.set(true);
    try {
      const message = await invoke<string>('cancel_transcription');
      this.runningStatus.set(message || '中止要求を送信しました。');
    } catch (error) {
      this.error.set(this.normalizeErrorMessage(error));
    } finally {
      this.transcriptionCanceling.set(false);
    }
  }

  async cancelProofreadRun(): Promise<void> {
    if (!this.proofreadRunning() || this.proofreadCanceling()) {
      return;
    }
    if (!this.isTauriRuntime()) {
      return;
    }
    this.proofreadCanceling.set(true);
    try {
      const message = await invoke<string>('cancel_proofread');
      this.proofreadStatus.set(message || '中止要求を送信しました。');
    } catch (error) {
      this.error.set(this.normalizeErrorMessage(error));
    } finally {
      this.proofreadCanceling.set(false);
    }
  }

  async runLlmProofread(
    autoMode = false,
    segments?: ProofreadSegmentInput[],
    backendOverride?: 'llama_cpp' | 'llama_cpp_rocm' | 'lemonade' | 'openai_compatible',
  ): Promise<void> {
    if (this.llmProofreadRunning() || this.llmProofreadCanceling()) {
      return;
    }
    if (this.overallProofreadRunning()) {
      if (!autoMode) {
        this.error.set('全体校正の処理中です。先に完了を待ってください。');
      }
      return;
    }
    if (this.running() || this.proofreadRunning() || this.diarizationRunning()) {
      if (!autoMode) {
        this.error.set('他の処理が実行中のため、AI校正を開始できません。');
      }
      return;
    }
    if (!this.isTauriRuntime() || (!segments && !this.result())) {
      return;
    }

    // 既に完了済みのセグメントを除外して送信。校正対象が無ければエンジンを起動せず早期returnする
    // （対象ゼロで同梱エンジン（llama-server / lemond）を無駄に起動・常駐させないため、起動より前に判定する）。
    const currentDoneStatus = this.llmSegmentStatus();
    this.llmProgressOffset = Object.values(currentDoneStatus).filter(v => v === 'done').length;
    const resolvedSegments = segments
      ? segments.filter((s) => currentDoneStatus[s.id] !== 'done')
      : this.segmentRows
          .filter((seg) => currentDoneStatus[seg.id] !== 'done')
          .map((segment) => ({
            id: segment.id,
            text: this.getEditableText(segment),
            speaker: this.getAssignedSpeakerKey(segment) || null,
            speakerLabel: this.getAssignedSpeakerKey(segment) || null,
            start: segment.start,
            end: segment.end,
          }));

    if (resolvedSegments.length === 0) {
      if (autoMode) {
        this.llmProofreadStatus.set('全セグメント処理済みです。');
        return;
      }
      this.openConfirmDialog({
        actionKind: 'llmRerunAll',
        title: 'AI校正を再実行しますか？',
        message: 'すべてのセグメントが処理済みです。現在の内容にもう一度校正しても結果が変わるとは限りません。それでも実行しますか？',
        confirmLabel: '実行',
        cancelLabel: 'キャンセル',
        confirmColor: 'primary',
        cancelColor: null,
      });
      return;
    }

    const backend = backendOverride ?? 'llama_cpp';
    let modelPath = this.llmModelPath();
    if (backend === 'llama_cpp' || backend === 'llama_cpp_rocm') {
      if (!modelPath) {
        if (autoMode) {
          this.llmProofreadStatus.set('モデルパスが未設定のためAI校正をスキップしました。');
          return;
        }
        this.llmProofreadStatus.set('Gemma 4モデルが見つかりません。セットアップタブからダウンロードしてください。');
        return;
      }
    } else if (backend === 'lemonade') {
      // lemonade バックエンド: サーバー起動確認
      await this.checkLlmStatus();
      if (this.llmServerStatus() !== 'running') {
        const currentStatus = this.llmServerStatus();
        if (currentStatus === 'not_installed' || currentStatus === 'unknown') {
          await this.checkLlmStatus();
        }
        if (this.llmServerStatus() === 'not_installed') {
          this.llmProofreadStatus.set('AI校正エンジンが未インストールです。設定タブからインストールしてください。');
          return;
        }
        this.llmProofreadStatus.set('AI校正エンジンを起動中...');
        await this.startLlm();
        if (this.llmServerStatus() !== 'running') {
          // 起動時にKVキャッシュ確保でVRAM不足になった場合は、並列処理数を下げて再試行を促す
          if (await this.maybePromptLowerParallelOnOom(this.llmLastError, () => this.runLlmProofread(autoMode, segments, backendOverride))) {
            this.llmProofreadStatus.set('VRAM不足の可能性があります。並列処理数を下げて再実行できます。');
          } else {
            this.llmProofreadStatus.set('AI校正エンジンの起動に失敗しました。');
          }
          return;
        }
      }
      if (this.llmGpuMode() === 'gpu') {
        await this.refreshLlmLoadedDevice();
        if (this.llmLoadedDevice() === 'cpu') {
          const msg = 'CPU 専用バックエンドが検出されました。AI校正を中止しました。設定タブから GPU バックエンドを再インストールしてください。';
          this.llmProofreadStatus.set(msg);
          return;
        }
      }
    } else {
      // openai_compatible バックエンド (lmstudio / ollama)
      const model = this.activeOpenAiModelInput().trim();
      if (!model) {
        const msg = 'モデル名が選択されていません。設定タブで「モデル一覧を取得」してモデルを選択してください。';
        this.llmProofreadStatus.set(msg);
        if (!autoMode) {
          this.error.set(msg);
        }
        return;
      }
    }

    this.error.set('');
    if (!autoMode) {
      this.llmTotalProcessedCount = 0;
    }
    await this.ensureProgressListener();
    this.llmProofreadRunning.set(true);
    this.llmProofreadCanceling.set(false);
    this.llmProofreadRunningSeconds.set(0);
    this.startLlmProofreadTicker();
    this.llmProofreadStatus.set('AI校正を準備中...');

    // 'processing'状態のみリセット、'done'は保持
    this.llmSegmentStatus.update((s) => {
      const next: Record<number, 'processing' | 'done'> = {};
      for (const [k, v] of Object.entries(s)) {
        if (v === 'done') next[+k] = 'done';
      }
      return next;
    });

    try {
      const response = await invoke<{ success: boolean; result?: ProofreadResultPayload; errorMessage?: string }>(
        'proofread_transcription_llm',
        {
          request: {
            segments: resolvedSegments,
            modelPath,
            nGpuLayers: backend === 'lemonade' ? 0 : -1,
            backend,
            lemonadeUrl: this.lemonadeUrl(),
            lemonadeModel: this.lemonadeModel(),
            openaiBaseUrl: this.activeOpenAiBaseUrl(),
            openaiModel: this.activeOpenAiModelInput(),
            systemPrompt: this.getSelectedProofreadSystemPromptForRun(),
            nCtx: this.llmNCtx() > 0 ? this.llmNCtx() : 16384,
            maxBatch: this.llmMaxBatch(),
            promptType: this.llmPromptType(),
          }
        }
      );

      const wasCancelled = !response.success && (response.errorMessage ?? '').includes('中止');

      if (!response.success || !response.result) {
        if (wasCancelled) {
          const elapsed = this.formatElapsedMinuteSecond(this.llmProofreadRunningSeconds() + 1);
          this.llmProofreadStatus.set(`AI校正を中止しました。（${elapsed}経過）再度実行すると未処理の行から再開します。`);
          return;
        }
        throw new Error(response.errorMessage ?? 'AI校正に失敗しました。');
      }

      // イベント経由で未処理のセグメント（短い行など）のみ適用
      const alreadyDone = this.llmSegmentStatus();
      for (const item of response.result.items ?? []) {
        const sid = Number(item.id);
        if (!Number.isFinite(sid) || alreadyDone[sid] === 'done') continue;
        this.applyLlmBatchResult([item]);
      }

      const totalChanged = this.proofreadUpdatedCount();
      const totalProcessed = this.llmTotalProcessedCount;
      const elapsed = this.formatElapsedMinuteSecond(this.llmProofreadRunningSeconds() + 1);
      const countText = totalProcessed > totalChanged
        ? `${totalProcessed} 行を確認し、${totalChanged} 行を修正しました。`
        : `${totalProcessed} 行を校正しました。`;
      this.llmProofreadStatus.set(`完了: ${countText}（所要: ${elapsed}）`);
      this.proofreadCompleted.set(true);
    } catch (error) {
      const msg = this.normalizeErrorMessage(error);
      // 推論中のVRAM不足は赤字エラーにせず、並列処理数を下げて再試行する確認ダイアログを出す
      if (await this.maybePromptLowerParallelOnOom(msg, () => this.runLlmProofread(autoMode, segments, backendOverride))) {
        this.llmProofreadStatus.set('VRAM不足の可能性があります。並列処理数を下げて再実行できます。');
      } else {
        this.error.set(msg);
        // runProofread が this.error をクリアしてもエラーを確認できるよう status にも残す
        this.llmProofreadStatus.set(`AI校正エラー: ${msg}`);
      }
    } finally {
      this.stopLlmProofreadTicker();
      this.llmProofreadRunning.set(false);
      this.llmProofreadCanceling.set(false);
    }
  }

  async cancelLlmProofread(): Promise<void> {
    if (!this.llmProofreadRunning() || this.llmProofreadCanceling()) return;
    this.llmProofreadCanceling.set(true);
    try {
      await invoke('cancel_llm_proofread');
    } catch { }
  }

  /** LLM校正を実行する（手動ボタン用）。完了後にentity checkを実行する。 */
  async runLlmProofreadWithParallel(): Promise<void> {
    await this.runLlmProofreadParallelCore(false);
    if (this.result()) {
      await this.runProofread('transcription', false, 'entity');
    }
  }

  /** 文字起こし完了後にLLM校正を自動実行する。 */
  private async startAutoLlmProofread(): Promise<void> {
    await this.runLlmProofreadParallelCore(true);
  }

  private async runLlmProofreadParallelCore(autoMode: boolean): Promise<void> {
    if (!this.result()) return;
    if (this.llmBackendMode() !== 'local_gguf') {
      await this.runLlmProofread(autoMode, undefined, 'openai_compatible');
      return;
    }
    await this.runLlmProofread(autoMode, undefined, 'lemonade');
  }

  private openProgressSnackbar(): void {
    this.dismissProgressSnackbar();
    this.progressSnackbarVisible.set(true);
    this.progressSnackBarRef = this.snackBar.openFromComponent(ProgressSnackbarComponent, {
      data: { statusText: this.processingStatusText },
      duration: 0,
      horizontalPosition: 'center',
      verticalPosition: 'bottom',
    });
  }

  private dismissProgressSnackbar(): void {
    this.progressSnackbarVisible.set(false);
    if (this.progressSnackBarRef) {
      this.progressSnackBarRef.dismiss();
      this.progressSnackBarRef = null;
    }
  }

  private applyLlmBatchResult(items: any[]): void {
    const hintMap = { ...this.proofreadHintBySegmentId() };
    const metadataMap = { ...this.proofreadMetadataBySegmentId() };
    const currentTexts = { ...this.editedSegmentTextMap() };
    const statusMap = { ...this.llmSegmentStatus() };
    const changedTexts: Record<number, string> = {};
    let appliedCount = this.proofreadUpdatedCount();
    let processedCount = 0;
    // segments.find() をループ内で呼ぶと O(N²) になるため、先に Map を構築する
    const segmentTextById = new Map<number, string>(
      (this.result()?.segments ?? []).map((s) => [s.id, s.text ?? ''])
    );

    for (const item of items) {
      const sid = Number(item.id);
      if (!Number.isFinite(sid)) continue;
      processedCount++;
      statusMap[sid] = 'done';
      const prev = currentTexts[sid] ?? segmentTextById.get(sid) ?? (typeof item.originalText === 'string' ? item.originalText : '');
      const revised = typeof item.revisedText === 'string' ? item.revisedText : prev;
      const existingMeta = metadataMap[sid];
      // ハリュシネーション検出: LLMの仕事は句読点追加のみ。
      // 元テキストとの編集距離が元文字数の30%超かつ5文字超ならID混同による誤出力として却下する。
      const origText = typeof item.originalText === 'string' ? item.originalText : prev;
      // ID混在検出: LLMが想定した元文と実際のセルテキストが大きく乖離している場合は別セグメントの結果と判定する。
      const origPrevThreshold = Math.max(5, Math.floor(Math.max(origText.length, prev.length) * 0.25));
      if (origText.length > 0 && prev.length > 0 && levenshtein(origText, prev) > origPrevThreshold) {
        // console.warn(`[proofread] ID混在の疑い: sid=${sid} origText="${origText}" prev="${prev}"`);
        hintMap[sid] = 'AI校正：（変更無し）';
        continue;
      }
      const maxAllowedDist = Math.max(5, Math.floor(origText.length * 0.3));
      if (origText.length > 0 && levenshtein(origText, revised) > maxAllowedDist) {
        hintMap[sid] = 'AI校正：（変更無し）';
        continue;
      }
      if (revised === prev || revised === '') {
        if (existingMeta?.sensitiveEntity?.hasSensitiveEntity === true || (existingMeta?.lintIssues?.length ?? 0) > 0) {
          hintMap[sid] = this.buildProofreadHint(
            existingMeta.diff.from,
            existingMeta.diff.to,
            existingMeta.confidence,
            existingMeta.reason,
            existingMeta.sensitiveEntity
          );
        } else {
          hintMap[sid] = 'AI校正：（変更無し）';
        }
        continue;
      }
      // note は LLM の自由記述（item.reason）ではなく実差分から生成し、本文とのズレを防ぐ（#2 対応）。
      const diffReason = this.describeProofreadDiffReason(prev, revised);
      // 句読点以外の文字が変化した変更（diffReason === ''）の扱いはプロンプト種別で分岐する。
      // - gemma4（既定・句読点専用）: 語が変わる変更はハリュシネーション（短文の丸ごと置換、
      //   例:「あるじゃん」→「マジで？」）とみなして却下し原文を保持する。編集距離ガードは
      //   短文で floor=5 を通過してしまうため、ここで確実に止めて文字起こしの忠実性を守る。
      // - original（誤字脱字修正を許可）: 小さな語修正は通すが、短文の丸ごと置換は
      //   厳しめのしきい値 max(2, ⌈元文長×0.34⌉) で却下する（短文ハリュシネーション対策）。
      if (diffReason === '') {
        const allowWordEdit =
          this.llmPromptType() === 'original' &&
          prev.length > 0 &&
          levenshtein(prev, revised) <= Math.max(2, Math.ceil(prev.length * 0.34));
        if (!allowWordEdit) {
          if (existingMeta?.sensitiveEntity?.hasSensitiveEntity === true || (existingMeta?.lintIssues?.length ?? 0) > 0) {
            hintMap[sid] = this.buildProofreadHint(
              existingMeta.diff.from,
              existingMeta.diff.to,
              existingMeta.confidence,
              existingMeta.reason,
              existingMeta.sensitiveEntity
            );
          } else {
            hintMap[sid] = 'AI校正：（変更無し）';
          }
          continue;
        }
        // original の小さな誤字脱字修正として許可 → 下の通常適用へ（note は（元文）比較表示）。
      }
      const metadata = this.normalizeProofreadMetadata(prev, revised, item.confidence, diffReason, existingMeta?.sensitiveEntity, existingMeta?.lintIssues);
      hintMap[sid] = this.buildProofreadHint(metadata.diff.from, metadata.diff.to, metadata.confidence, metadata.reason, metadata.sensitiveEntity);
      metadataMap[sid] = metadata;
      currentTexts[sid] = revised;
      changedTexts[sid] = revised;
      appliedCount += 1;
    }

    this.editedSegmentTextMap.set(currentTexts);
    this.applyEditedTextsToResultSegments(changedTexts);
    this.proofreadHintBySegmentId.set(hintMap);
    this.proofreadMetadataBySegmentId.set(metadataMap);
    this.proofreadUpdatedCount.set(appliedCount);
    this.llmTotalProcessedCount += processedCount;
    this.llmSegmentStatus.set(statusMap);
  }

  async cancelDiarizationRun(): Promise<void> {
    if (!this.diarizationRunning() || this.diarizationCanceling()) {
      return;
    }
    if (!this.isTauriRuntime()) {
      return;
    }
    this.diarizationCanceling.set(true);
    try {
      const message = await invoke<string>('cancel_diarization');
      this.diarizationStatus.set(message || '中止要求を送信しました。');
    } catch (error) {
      this.error.set(this.normalizeErrorMessage(error));
    } finally {
      this.diarizationCanceling.set(false);
    }
  }

  requestCancelRun(kind: CancelRunKind): void {
    if (kind === 'transcription') {
      if (!this.running() || this.transcriptionCanceling()) {
        return;
      }
    } else if (kind === 'proofread') {
      if (!this.proofreadRunning() || this.proofreadCanceling()) {
        return;
      }
    } else if (kind === 'llmProofread') {
      if (!this.llmProofreadRunning() || this.llmProofreadCanceling()) {
        return;
      }
    } else if (!this.diarizationRunning() || this.diarizationCanceling()) {
      return;
    }
    const message = kind === 'transcription'
      ? '文字起こし処理を中止しますか？'
      : kind === 'proofread' ? '校正処理を中止しますか？'
      : kind === 'llmProofread' ? 'LLM校正処理を中止しますか？\n中断後は未処理の行から再開できます。'
      : '話者分離処理を中止しますか？';
    this.openConfirmDialog({
      actionKind: 'cancelRun',
      title: '中止の確認',
      message,
      confirmLabel: '中止する',
      cancelLabel: 'キャンセル',
      confirmColor: 'warn',
      cancelColor: null,
      cancelRunKind: kind
    });
  }

  closeConfirmDialog(): void {
    this.pendingVramOomRetry = null;
    this.pendingConfirmDialog.set(null);
  }

  async confirmDialogAction(): Promise<void> {
    const dialog = this.pendingConfirmDialog();
    this.pendingConfirmDialog.set(null);
    if (!dialog) {
      return;
    }

    if (dialog.actionKind === 'installVoiceInputPackLowMemory') {
      this.persistEditorLowMemoryVoiceInputOptIn();
      await this.performInstallEditorVoiceInputPack();
      return;
    }

    if (dialog.actionKind === 'enableVoiceInputLowMemory') {
      this.persistEditorLowMemoryVoiceInputOptIn();
      return;
    }

    if (dialog.actionKind === 'cancelRun') {
      if (dialog.cancelRunKind === 'transcription') {
        await this.cancelTranscriptionRun();
        return;
      }
      if (dialog.cancelRunKind === 'proofread') {
        await this.cancelProofreadRun();
        return;
      }
      if (dialog.cancelRunKind === 'diarization') {
        await this.cancelDiarizationRun();
        return;
      }
      if (dialog.cancelRunKind === 'llmProofread') {
        await this.cancelLlmProofread();
      }
      return;
    }

    if (dialog.actionKind === 'removeSegment') {
      const segmentId = dialog.segmentId;
      if (segmentId === undefined) {
        return;
      }
      const next = { ...this.hiddenSegmentIds() };
      next[segmentId] = true;
      this.hiddenSegmentIds.set(next);
      if (this.playingSegmentId() === segmentId) {
        this.stopSegmentPlayback();
      }
      return;
    }

    if (dialog.actionKind === 'mergeUtterances') {
      this.mergeRunning.set(true);
      await new Promise<void>(resolve => setTimeout(resolve, 0));
      this.mergeConsecutiveSpeakerUtterances();
      await new Promise<void>(resolve => setTimeout(resolve, 150));
      this.mergeRunning.set(false);
      if (this.result()) {
        await this.runProofread('transcription', false, 'entity');
      }
      return;
    }

    if (dialog.actionKind === 'importJsonOverwrite') {
      await this.proceedSelectImportJsonFile();
      return;
    }

    if (dialog.actionKind === 'startTranscriptionConfirm') {
      await this.runTranscription();
      return;
    }

    if (dialog.actionKind === 'gemmaNotFoundBeforeTranscription') {
      this._gemmaCheckBypassed = true;
      await this.runTranscription();
      return;
    }

    if (dialog.actionKind === 'llmRerunAll') {
      this.llmSegmentStatus.set({});
      await this.runLlmProofreadWithParallel();
      return;
    }

    if (dialog.actionKind === 'resetProofreadSystemPrompt') {
      this.resetProofreadSystemPromptForSelectedModel();
    }

    if (dialog.actionKind === 'resetOverallProofreadSystemPrompt') {
      this.resetOverallProofreadSystemPromptForSelectedModel();
    }

    if (dialog.actionKind === 'overallProofreadBeforeMerge') {
      await this.runOverallProofread();
    }

    if (dialog.actionKind === 'lowerLlmParallelOnOom') {
      const retry = this.pendingVramOomRetry;
      this.pendingVramOomRetry = null;
      // 段階的に下げる（24→20、20→16、16→12、12→8、8→4、4→2、2→1）。再びOOMならもう一段下のダイアログが出る
      this.selectedLlmParallel.set(this.pendingVramOomTargetNp);
      this.persistLlmSettings();
      // 現行サーバーを停止し、次回起動時に新しい並列処理数を確実に反映させる
      await this.stopLlm();
      if (retry) {
        await retry();
      }
      return;
    }
  }

  private promptPassword(): Promise<string | null> {
    return new Promise(resolve => {
      const ref = this.dialog.open(PasswordDialogComponent, { width: '380px' });
      ref.afterClosed().subscribe((result: string | null | undefined) => {
        resolve(result ?? null);
      });
    });
  }

  openOrRunOverallProofread(withConfirm: boolean): void {
    if (this.overallProofreadHasPendingItems()) {
      this.overallProofreadDialogOpen.set(true);
      return;
    }
    if (withConfirm) {
      this.openConfirmDialog({
        actionKind: 'overallProofreadBeforeMerge',
        title: 'AI全体校正',
        message: '全体校正の前に、発言の統合まで完了していることが推奨されます。また、この作業は時間がかかります。実行しますか？',
        confirmLabel: '実行',
        cancelLabel: 'キャンセル',
        confirmColor: 'primary',
        cancelColor: null,
      });
    } else {
      void this.runOverallProofread();
    }
  }

  async runOverallProofread(): Promise<void> {
    if (this.overallProofreadRunning()) return;
    if (this.running() || this.proofreadRunning() || this.diarizationRunning() || this.llmProofreadRunning()) {
      this.overallProofreadError.set('他の処理が実行中のため、全体校正を開始できません。');
      this.overallProofreadDialogOpen.set(true);
      return;
    }
    if (!this.isTauriRuntime() || !this.result()) return;

    const backend: 'lemonade' | 'openai_compatible' =
      this.llmBackendMode() === 'local_gguf' ? 'lemonade' : 'openai_compatible';
    const modelPath = '';

    // 校正対象が無ければエンジンを起動せず早期returnする（無駄起動・常駐の防止）。
    const segments = this.segmentRows.map((seg) => ({
      id: seg.id,
      text: this.getEditableText(seg),
      speaker: this.displaySpeaker(this.getAssignedSpeakerKey(seg)) || null,
      start: seg.start,
      end: seg.end,
    }));

    if (segments.length === 0) {
      this.overallProofreadError.set('校正対象のセグメントがありません。');
      this.overallProofreadDialogOpen.set(true);
      return;
    }

    if (backend === 'lemonade') {
      await this.checkLlmStatus();
      if (this.llmServerStatus() !== 'running') {
        this.overallProofreadStatus.set('AI校正エンジンを起動中...');
        await this.startLlm();
        if (this.llmServerStatus() !== 'running') {
          if (await this.maybePromptLowerParallelOnOom(this.llmLastError, () => this.runOverallProofread())) {
            this.overallProofreadStatus.set('VRAM不足の可能性があります。並列処理数を下げて再実行できます。');
          } else {
            this.overallProofreadError.set('AI校正エンジンの起動に失敗しました。');
            this.overallProofreadDialogOpen.set(true);
          }
          return;
        }
      }
    } else {
      const model = this.activeOpenAiModelInput().trim();
      if (!model) {
        this.overallProofreadError.set('モデル名が選択されていません。設定タブで「モデル一覧を取得」してモデルを選択してください。');
        this.overallProofreadDialogOpen.set(true);
        return;
      }
    }

    this.overallProofreadRunning.set(true);
    this.overallProofreadError.set('');
    this.overallProofreadResult.set(null);
    this.overallProofreadDismissedIds.set(new Set());
    this.overallProofreadStatus.set('しばらくお待ち下さい...');

    // VRAM不足で並列処理数を下げる確認ダイアログを出した場合は、結果ダイアログを開かない
    let oomHandled = false;
    try {
      const response = await invoke<{ success: boolean; result?: OverallProofreadResultData; errorMessage?: string }>(
        'run_overall_proofread',
        {
          request: {
            segments,
            modelPath,
            nGpuLayers: backend === 'lemonade' ? 0 : -1,
            backend,
            lemonadeUrl: this.lemonadeUrl(),
            lemonadeModel: this.lemonadeModel(),
            openaiBaseUrl: this.activeOpenAiBaseUrl(),
            openaiModel: this.activeOpenAiModelInput(),
            nCtx: this.llmNCtx() > 0 ? this.llmNCtx() : 16384,
            promptType: this.llmPromptType(),
            systemPrompt: this.proofreadSystemPromptReadonly() ? null : this.overallProofreadSystemPrompt() || null,
          }
        }
      );

      if (!response.success || !response.result) {
        const msg = response.errorMessage ?? '全体校正に失敗しました。';
        if (await this.maybePromptLowerParallelOnOom(msg, () => this.runOverallProofread())) {
          oomHandled = true;
          this.overallProofreadStatus.set('VRAM不足の可能性があります。並列処理数を下げて再実行できます。');
        } else {
          this.overallProofreadError.set(msg);
        }
      } else {
        this.overallProofreadResult.set(response.result);
        this.overallProofreadStatus.set('全体校正が完了しました。');
      }
    } catch (error) {
      const msg = this.normalizeErrorMessage(error);
      if (await this.maybePromptLowerParallelOnOom(msg, () => this.runOverallProofread())) {
        oomHandled = true;
        this.overallProofreadStatus.set('VRAM不足の可能性があります。並列処理数を下げて再実行できます。');
      } else {
        this.overallProofreadError.set(msg);
      }
    } finally {
      const wasCanceled = this.overallProofreadCanceling();
      this.overallProofreadRunning.set(false);
      this.overallProofreadCanceling.set(false);
      if (!wasCanceled && !oomHandled) {
        this.overallProofreadDialogOpen.set(true);
      }
    }
  }

  cancelOverallProofread(): void {
    if (!this.overallProofreadRunning() || this.overallProofreadCanceling()) return;
    this.overallProofreadCanceling.set(true);
    void invoke('cancel_llm_proofread').catch(() => {});
  }

  acceptOverallProofreadItem(item: OverallProofreadItem): void {
    const currentTexts = { ...this.editedSegmentTextMap() };
    currentTexts[item.id] = item.revisedText;
    this.editedSegmentTextMap.set(currentTexts);
    this.applyEditedTextsToResultSegments({ [item.id]: item.revisedText });
    this.overallProofreadDismissedIds.update((s) => new Set([...s, item.id]));
  }

  dismissOverallProofreadItem(item: OverallProofreadItem): void {
    this.overallProofreadDismissedIds.update((s) => new Set([...s, item.id]));
  }

  dismissAllOverallProofreadItems(): void {
    const ids = this.overallProofreadVisibleItems().map((i) => i.id);
    this.overallProofreadDismissedIds.update((s) => new Set([...s, ...ids]));
  }

  closeOverallProofreadDialog(): void {
    this.overallProofreadDialogOpen.set(false);
  }

  async saveJson(): Promise<void> {
    if (!this.isTauriRuntime()) {
      this.error.set('ブラウザ起動では保存できません。Tauri ウィンドウから実行してください。');
      return;
    }

    if (!this.result()) {
      return;
    }

    const password = await this.promptPassword();
    if (password === null) {
      return;
    }

    this.error.set('');
    const hasPassword = password.length > 0;

    const targetPath = await save({
      title: '文字起こし結果を保存',
      defaultPath: hasPassword
        ? this.buildJsonDefaultFileName().replace(/\.json$/, '.zip')
        : this.buildJsonDefaultFileName(),
      filters: hasPassword
        ? [{ name: 'ZIP', extensions: ['zip'] }]
        : [{ name: 'JSON', extensions: ['json'] }]
    });

    if (!targetPath) {
      return;
    }

    try {
      const ext = hasPassword ? '.zip' : '.json';
      const finalPath = targetPath.toLowerCase().endsWith(ext) ? targetPath : `${targetPath}${ext}`;
      await invoke('save_transcription_json', {
        request: {
          path: finalPath,
          content: JSON.stringify(this.buildExportTranscriptionPayload(), null, 2),
          password: hasPassword ? password : null
        }
      });
    } catch (error) {
      this.error.set(this.normalizeErrorMessage(error));
    }
  }

  async saveWord(): Promise<void> {
    if (!this.isTauriRuntime()) {
      this.error.set('ブラウザ起動では保存できません。Tauri ウィンドウから実行してください。');
      return;
    }

    if (!this.result()) {
      return;
    }

    const password = await this.promptPassword();
    if (password === null) {
      return;
    }

    this.error.set('');

    const targetPath = await save({
      title: '文字起こし結果（Word）を保存',
      defaultPath: this.buildWordDefaultFileName(),
      filters: [{ name: 'Word', extensions: ['docx'] }]
    });

    if (!targetPath) {
      return;
    }

    try {
      const exportSpeakerLabels = this.buildExportSpeakerLabelBySegmentId(this.segmentRows, this.addUtteranceNumber());
      const rows: SaveDocxRow[] = this.segmentRows.map((segment) => ({
        time: this.formatMinuteSecond(segment.end),
        speaker: exportSpeakerLabels[segment.id] ?? '-',
        text: this.getEditableText(segment)
      }));

      await invoke('save_transcription_docx', {
        request: {
          path: targetPath,
          rows,
          password: password.length > 0 ? password : null
        }
      });
    } catch (error) {
      this.error.set(this.normalizeErrorMessage(error));
    }
  }

  async saveXlsx(): Promise<void> {
    if (!this.isTauriRuntime()) {
      this.error.set('ブラウザ起動では保存できません。Tauri ウィンドウから実行してください。');
      return;
    }

    if (!this.result()) {
      return;
    }

    const password = await this.promptPassword();
    if (password === null) {
      return;
    }

    this.error.set('');

    const targetPath = await save({
      title: '文字起こし結果（Excel）を保存',
      defaultPath: this.buildXlsxDefaultFileName(),
      filters: [{ name: 'Excel', extensions: ['xlsx'] }]
    });

    if (!targetPath) {
      return;
    }

    try {
      const finalPath = targetPath.toLowerCase().endsWith('.xlsx') ? targetPath : `${targetPath}.xlsx`;
      const exportSpeakerLabels = this.buildExportSpeakerLabelBySegmentId(this.segmentRows, this.addUtteranceNumber());
      const rows: SaveXlsxRow[] = this.segmentRows.map((segment) => ({
        start: this.formatMinuteSecond(segment.start),
        end: this.formatMinuteSecond(segment.end),
        speaker: exportSpeakerLabels[segment.id] ?? '-',
        text: this.getEditableText(segment)
      }));

      await invoke('save_transcription_xlsx', {
        request: {
          path: finalPath,
          rows,
          password: password.length > 0 ? password : null
        }
      });
    } catch (error) {
      this.error.set(
        `Excel 保存に失敗しました。保存先ファイルが開かれている場合は閉じて再実行してください。詳細: ${this.normalizeErrorMessage(error)}`
      );
    }
  }

  async exportRuntimeEstimateLog(): Promise<void> {
    if (!this.isTauriRuntime()) {
      this.error.set('ブラウザ起動では保存できません。Tauri ウィンドウから実行してください。');
      return;
    }

    this.error.set('');
    const targetPath = await save({
      title: '文字起こし所要時間ログを保存',
      defaultPath: this.buildEstimateLogDefaultFileName(),
      filters: [{ name: 'CSV', extensions: ['csv'] }]
    });

    if (!targetPath) {
      return;
    }

    const finalPath = targetPath.toLowerCase().endsWith('.csv') ? targetPath : `${targetPath}.csv`;
    const rows = this.estimateSamples
      .slice()
      .sort((a, b) => a.createdAt - b.createdAt)
      .map((sample) => [
        this.formatToJapanDateTime(sample.createdAt),
        this.formatSecondsAsJapaneseMinuteSecond(sample.audioSeconds),
        this.formatSecondsAsJapaneseMinuteSecond(sample.elapsedSeconds),
        this.formatBytesAsMb(sample.fileSizeBytes),
        sample.diarization ? 'あり' : 'なし',
        sample.device.toUpperCase(),
        sample.computeType
      ]);

    const header = ['日時', 'ファイル音声長', '文字起こし所要時間', 'ファイルサイズ', '話者分離', '実行デバイス', '計算方式'];
    const csvLines = [header, ...rows].map((cols) => cols.map((v) => this.escapeCsvValue(v)).join(','));
    const content = csvLines.join('\n');

    try {
      await invoke('save_text_shift_jis', {
        request: {
          path: finalPath,
          content
        }
      });
    } catch (error) {
      this.error.set(this.normalizeErrorMessage(error));
    }
  }

  private buildWordDefaultFileName(): string {
    const now = new Date();
    const yyyy = now.getFullYear();
    const mm = String(now.getMonth() + 1).padStart(2, '0');
    const dd = String(now.getDate()).padStart(2, '0');
    const hh = String(now.getHours()).padStart(2, '0');
    const mi = String(now.getMinutes()).padStart(2, '0');
    const ss = String(now.getSeconds()).padStart(2, '0');
    return `lott_${yyyy}${mm}${dd}_${hh}${mi}${ss}.docx`;
  }

  private buildXlsxDefaultFileName(): string {
    const now = new Date();
    const yyyy = now.getFullYear();
    const mm = String(now.getMonth() + 1).padStart(2, '0');
    const dd = String(now.getDate()).padStart(2, '0');
    const hh = String(now.getHours()).padStart(2, '0');
    const mi = String(now.getMinutes()).padStart(2, '0');
    const ss = String(now.getSeconds()).padStart(2, '0');
    const msec = String(now.getMilliseconds()).padStart(3, '0');
    return `lott_${yyyy}${mm}${dd}_${hh}${mi}${ss}_${msec}.xlsx`;
  }

  private buildJsonDefaultFileName(): string {
    const now = new Date();
    const yyyy = now.getFullYear();
    const mm = String(now.getMonth() + 1).padStart(2, '0');
    const dd = String(now.getDate()).padStart(2, '0');
    const hh = String(now.getHours()).padStart(2, '0');
    const mi = String(now.getMinutes()).padStart(2, '0');
    const ss = String(now.getSeconds()).padStart(2, '0');
    return `lott_${yyyy}${mm}${dd}_${hh}${mi}${ss}.json`;
  }

  private buildEstimateLogDefaultFileName(): string {
    const now = new Date();
    const yyyy = now.getFullYear();
    const mm = String(now.getMonth() + 1).padStart(2, '0');
    const dd = String(now.getDate()).padStart(2, '0');
    const hh = String(now.getHours()).padStart(2, '0');
    const mi = String(now.getMinutes()).padStart(2, '0');
    const ss = String(now.getSeconds()).padStart(2, '0');
    return `lott_runtime_log_${yyyy}${mm}${dd}_${hh}${mi}${ss}.csv`;
  }

  private focusFirstSpeakerAliasInput(): void {
    if (typeof document === 'undefined') {
      return;
    }
    setTimeout(() => {
      const input = document.querySelector<HTMLInputElement>('.speaker-alias-input');
      input?.focus();
    }, 0);
  }

  private buildInitialSpeakerAliasMap(result: TranscriptionResult): Record<string, string> {
    const aliases: Record<string, string> = {};
    const speakers = new Set<string>();
    for (const segment of result.segments) {
      if (segment.speaker) {
        speakers.add(segment.speaker);
      }
    }
    for (const speaker of speakers) {
      if (speaker === 'SPEAKER_00') aliases[speaker] = 'Th';
      else if (speaker === 'SPEAKER_01') aliases[speaker] = 'Cl';
      else if (speaker === 'SPEAKER_02') aliases[speaker] = 'IP';
      else if (speaker === 'SPEAKER_03') aliases[speaker] = 'IP2';
      else if (speaker === 'SPEAKER_04') aliases[speaker] = 'IP3';
      else aliases[speaker] = 'Cl';
    }
    return aliases;
  }

  private buildInitialSpeakerSelectionMap(result: TranscriptionResult): Record<number, string> {
    const selected: Record<number, string> = {};
    for (const segment of result.segments) {
      const estimated = (segment.speaker ?? '').trim();
      if (estimated.length > 0) {
        selected[segment.id] = estimated;
      }
    }
    return selected;
  }

  onAddUtteranceNumberChange(checked: boolean): void {
    this.addUtteranceNumber.set(checked);
    this.appSettings = { ...this.appSettings, export: { ...this.appSettings.export, addUtteranceNumber: checked } };
    this.persistAppSettings();
  }

  private buildExportSpeakerLabelBySegmentId(
    segments: ReadonlyArray<TranscriptionSegment>,
    withNumber: boolean
  ): Record<number, string> {
    const byId: Record<number, string> = {};
    const counts: Record<string, number> = {};
    for (const segment of segments) {
      const base = this.displaySpeaker(this.getAssignedSpeakerKey(segment)).trim();
      if (base.length === 0 || base === '-') {
        byId[segment.id] = '-';
        continue;
      }
      counts[base] = (counts[base] ?? 0) + 1;
      byId[segment.id] = withNumber ? `${base}-${String(counts[base]).padStart(3, '0')}` : base;
    }
    return byId;
  }

  private buildExportTranscriptionPayload(): ExportTranscriptionPayload {
    const segments = this.segmentRows;
    const proofreadMetadataBySegmentId = this.proofreadMetadataBySegmentId();
    const speakerKeys = new Set<string>();
    for (const segment of segments) {
      const speakerValue = this.getAssignedSpeakerKey(segment).trim();
      if (speakerValue.length > 0) {
        speakerKeys.add(speakerValue);
      }
    }

    const speakerDataset: ExportSpeakerDatasetRow[] = Array.from(speakerKeys)
      .sort()
      .map((speakerValue) => ({
        speakerValue,
        displayName: this.displaySpeaker(speakerValue)
      }));

    const llmSegmentStatus = this.llmSegmentStatus();
    const transcriptionDataset: ExportTranscriptionDatasetRow[] = segments.map((segment) => {
      const proofread = proofreadMetadataBySegmentId[segment.id];
      const llmDone = llmSegmentStatus[segment.id] === 'done';
      return {
        startTime: segment.start,
        endTime: segment.end,
        speakerValue: this.getAssignedSpeakerKey(segment),
        content: this.getEditableText(segment),
        proofread: proofread ? {
          diff: {
            from: proofread.diff.from,
            to: proofread.diff.to
          },
          confidence: proofread.confidence,
          reason: proofread.reason,
          lintIssues: proofread.lintIssues,
          sensitiveEntity: proofread.sensitiveEntity
        } : undefined,
        ...(llmDone ? { llmProofread: true } : {})
      };
    });

    return {
      audioFileName: this.selectedAudioFileName,
      speakerDataset,
      transcriptionDataset,
      proofreadCompleted: this.proofreadCompleted()
    };
  }

  private loadImportJsonContent(content: string): void {
    this.importExpectedAudioFileName.set('');
    const parsed = this.parseImportedJson(content);
    if (!parsed.ok) {
      this.error.set(parsed.error);
      return;
    }

    this.pendingImportedPayload = parsed.value;
    this.importJsonReady.set(true);
    this.importAudioReady.set(false);
    this.transcriptionRunLockedByImport.set(true);
    const expectedFileName = parsed.value.audioFileName.trim();
    this.importExpectedAudioFileName.set(expectedFileName);
    this.importStatusMessage.set(
      expectedFileName
        ? `続けて音声ファイル（${expectedFileName}）を読み込んでください。`
        : '続けて音声ファイルを読み込んでください。'
    );
    this.proofreadStatus.set('');
    this.punctStatus.set('');
    this.proofreadStatusSource.set(null);
    this.mergeStatus.set('');
    this.selectedAudioPath.set('');
    this.selectedAudioFileSizeBytes.set(null);
    this.applyImportedPayload(parsed.value);
  }

  private applyImportedPayload(payload: ExportTranscriptionPayload): void {
    // Reset all run-state that persists across sessions but is not part of the saved payload.
    // Without this, signals from the previous run bleed into the new session.
    this._allRenderLimit.set(Number.MAX_SAFE_INTEGER);
    this.proofreadRunning.set(false);
    this.proofreadEditingLocked.set(false);
    this.proofreadUpdatedCount.set(0);
    this.proofreadProgressText.set('');
    this.llmProofreadRunning.set(false);
    this.llmProofreadCanceling.set(false);
    this.llmProofreadStatus.set('');
    this.llmProofreadRunningSeconds.set(0);
    this.llmProgressOffset = 0;
    this.llmTotalProcessedCount = 0;
    this.stopLlmProofreadTicker();
    this.stopProofreadTicker();
    this.overallProofreadResult.set(null);
    this.overallProofreadDismissedIds.set(new Set());
    this.overallProofreadDialogOpen.set(false);

    const proofreadHintBySegmentId: Record<number, string> = {};
    const proofreadMetadataBySegmentId: Record<number, ExportProofreadMetadata> = {};
    const segments: TranscriptionSegment[] = payload.transcriptionDataset.map((row, idx) => ({
      id: idx,
      start: row.startTime,
      end: row.endTime,
      speaker: row.speakerValue.trim().length > 0 ? row.speakerValue : null,
      text: row.content
    }));
    for (let i = 0; i < payload.transcriptionDataset.length; i += 1) {
      const row = payload.transcriptionDataset[i];
      if (!row.proofread) {
        continue;
      }
      const metadata = this.normalizeProofreadMetadata(
        row.proofread.diff.from,
        row.proofread.diff.to,
        row.proofread.confidence,
        row.proofread.reason,
        row.proofread.sensitiveEntity,
        row.proofread.lintIssues
      );
      proofreadMetadataBySegmentId[i] = metadata;
      proofreadHintBySegmentId[i] = this.buildProofreadHint(
        metadata.diff.from,
        metadata.diff.to,
        metadata.confidence,
        metadata.reason,
        metadata.sensitiveEntity
      );
    }
    const normalizedText = segments.map((s) => s.text).join(' ').trim();
    const importedResult: TranscriptionResult = {
      text: normalizedText,
      segments,
      settings: {
        model: 'imported-json',
        device: 'n/a',
        computeType: 'n/a',
        language: 'ja',
        vadFilter: false,
        wordTimestamps: false
      },
      diarizationRequested: false
    };

    const aliasMap: Record<string, string> = {};
    for (const row of payload.speakerDataset) {
      const key = row.speakerValue.trim();
      if (!key) {
        continue;
      }
      const display = row.displayName.trim();
      aliasMap[key] = display.length > 0 ? display : key;
    }
    for (const segment of segments) {
      const key = (segment.speaker ?? '').trim();
      if (key && !aliasMap[key]) {
        aliasMap[key] = key;
      }
    }

    this.result.set(importedResult);
    this.resultSource.set('json');
    this.lastRunElapsedSeconds.set(0);
    this.lastRunNotice.set('JSON から結果を読み込みました。');
    this.editedSegmentTextMap.set(Object.fromEntries(segments.map((s) => [s.id, s.text])));
    this.selectedSpeakerBySegmentId.set(
      Object.fromEntries(segments.map((s) => [s.id, this.normalizeSpeakerKey(s.speaker)]))
    );
    this.speakerAliasMap.set(aliasMap);
    this.proofreadMetadataBySegmentId.set(proofreadMetadataBySegmentId);
    this.proofreadHintBySegmentId.set(proofreadHintBySegmentId);
    this.proofreadCompleted.set(payload.proofreadCompleted === true);
    const restoredLlmStatus: Record<number, 'done'> = {};
    for (let i = 0; i < payload.transcriptionDataset.length; i += 1) {
      if (payload.transcriptionDataset[i].llmProofread === true) {
        restoredLlmStatus[i] = 'done';
      }
    }
    this.llmSegmentStatus.set(restoredLlmStatus);
    this.hiddenSegmentIds.set({});
    this.pendingConfirmDialog.set(null);
    this.stopSegmentPlayback();
  }

  isJsonResult(): boolean {
    return this.resultSource() === 'json';
  }

  isPlaybackDisabled(): boolean {
    return this.isJsonResult() && !this.importAudioReady();
  }

  private parseImportedJson(content: string):
    | { ok: true; value: ExportTranscriptionPayload }
    | { ok: false; error: string } {
    let raw: unknown;
    try {
      raw = JSON.parse(content);
    } catch {
      return { ok: false, error: 'JSON の形式が不正です。' };
    }

    if (!raw || typeof raw !== 'object') {
      return { ok: false, error: 'JSON のルートはオブジェクトである必要があります。' };
    }

    const obj = raw as Record<string, unknown>;
    if (typeof obj['audioFileName'] !== 'string') {
      return { ok: false, error: 'audioFileName は文字列である必要があります。' };
    }
    if (!Array.isArray(obj['speakerDataset'])) {
      return { ok: false, error: 'speakerDataset は配列である必要があります。' };
    }
    if (!Array.isArray(obj['transcriptionDataset'])) {
      return { ok: false, error: 'transcriptionDataset は配列である必要があります。' };
    }
    if (obj['proofreadCompleted'] !== undefined && typeof obj['proofreadCompleted'] !== 'boolean') {
      return { ok: false, error: 'proofreadCompleted は真偽値である必要があります。' };
    }

    const speakerDataset: ExportSpeakerDatasetRow[] = [];
    for (let i = 0; i < obj['speakerDataset'].length; i += 1) {
      const row = obj['speakerDataset'][i];
      if (!row || typeof row !== 'object') {
        return { ok: false, error: `speakerDataset[${i}] の形式が不正です。` };
      }
      const rowObj = row as Record<string, unknown>;
      if (typeof rowObj['speakerValue'] !== 'string' || typeof rowObj['displayName'] !== 'string') {
        return { ok: false, error: `speakerDataset[${i}] は speakerValue/displayName の文字列が必要です。` };
      }
      speakerDataset.push({
        speakerValue: rowObj['speakerValue'],
        displayName: rowObj['displayName']
      });
    }

    const transcriptionDataset: ExportTranscriptionDatasetRow[] = [];
    for (let i = 0; i < obj['transcriptionDataset'].length; i += 1) {
      const row = obj['transcriptionDataset'][i];
      if (!row || typeof row !== 'object') {
        return { ok: false, error: `transcriptionDataset[${i}] の形式が不正です。` };
      }
      const rowObj = row as Record<string, unknown>;
      if (
        typeof rowObj['startTime'] !== 'number' ||
        typeof rowObj['endTime'] !== 'number' ||
        typeof rowObj['speakerValue'] !== 'string' ||
        typeof rowObj['content'] !== 'string'
      ) {
        return {
          ok: false,
          error: `transcriptionDataset[${i}] は startTime/endTime(数値), speakerValue/content(文字列) が必要です。`
        };
      }
      if (!Number.isFinite(rowObj['startTime']) || !Number.isFinite(rowObj['endTime'])) {
        return { ok: false, error: `transcriptionDataset[${i}] の時刻が不正です。` };
      }
      if (rowObj['startTime'] < 0 || rowObj['endTime'] < 0 || rowObj['endTime'] < rowObj['startTime']) {
        return { ok: false, error: `transcriptionDataset[${i}] の開始/終了時刻の関係が不正です。` };
      }
      let proofread: ExportProofreadMetadata | null | undefined = undefined;
      const proofreadRaw = rowObj['proofread'];
      if (proofreadRaw !== undefined && proofreadRaw !== null) {
        if (!proofreadRaw || typeof proofreadRaw !== 'object') {
          return { ok: false, error: `transcriptionDataset[${i}].proofread の形式が不正です。` };
        }
        const proofreadObj = proofreadRaw as Record<string, unknown>;
        const diffRaw = proofreadObj['diff'];
        if (!diffRaw || typeof diffRaw !== 'object') {
          return { ok: false, error: `transcriptionDataset[${i}].proofread.diff の形式が不正です。` };
        }
        const diffObj = diffRaw as Record<string, unknown>;
        if (
          typeof diffObj['from'] !== 'string' ||
          typeof diffObj['to'] !== 'string' ||
          typeof proofreadObj['confidence'] !== 'number' ||
          !Number.isFinite(proofreadObj['confidence']) ||
          typeof proofreadObj['reason'] !== 'string'
        ) {
          return {
            ok: false,
            error: `transcriptionDataset[${i}].proofread は diff.from/to(文字列), confidence(数値), reason(文字列) が必要です。`
          };
        }
        proofread = this.normalizeProofreadMetadata(
          diffObj['from'],
          diffObj['to'],
          proofreadObj['confidence'],
          proofreadObj['reason'],
          proofreadObj['sensitiveEntity'],
          proofreadObj['lintIssues']
        );
      }
      const llmProofread = rowObj['llmProofread'] === true ? true : undefined;
      transcriptionDataset.push({
        startTime: rowObj['startTime'],
        endTime: rowObj['endTime'],
        speakerValue: rowObj['speakerValue'],
        content: rowObj['content'],
        proofread,
        llmProofread
      });
    }

    return {
      ok: true,
      value: {
        audioFileName: obj['audioFileName'],
        speakerDataset,
        transcriptionDataset,
        proofreadCompleted: obj['proofreadCompleted'] === true
      }
    };
  }

  async copyErrorToClipboard(): Promise<void> {
    const text = this.error();
    if (!text) {
      return;
    }
    try {
      await navigator.clipboard.writeText(text);
      this.errorCopiedMessage.set('エラー文をコピーしました。');
    } catch {
      this.errorCopiedMessage.set('コピーに失敗しました。手動で選択してコピーしてください。');
    }
  }

  requiresDiarizationSetup(): boolean {
    return (
      this.isTauriRuntime() &&
      !this.isTranscriptionTabDisabled() &&
      this.diarizationSetupVisible() &&
      this.isDiarizationModelMissing()
    );
  }

  canShowTranscriptionTab(): boolean {
    return !this.editorOnlyBuild && this.transcriptionTabVisible();
  }

  getTranscriptionTabLabel(): string {
    if (!this.isTranscriptionTabDisabled() && this.isDiarizationModelMissing()) {
      return '文字起こし（要設定）';
    }
    if (this.isTranscriptionTabDisabled()) {
      return '文字起こし（要GPU設定）';
    }
    return '文字起こし';
  }

  isTranscriptionTabDisabled(): boolean {
    return this.transcriptionTabDisabled();
  }

  isDiarizationModelMissing(): boolean {
    return this.diarizationModelChecked() && (!this.diarizationModelExists() || !this.diarizationModelHasConfig());
  }

  private getReaderTabIndex(): number {
    return this.canShowTranscriptionTab() ? 1 : 0;
  }

  private getSettingsTabIndex(): number {
    return this.canShowTranscriptionTab() ? 2 : 1;
  }

  private async loadAppVersion(): Promise<void> {
    if (!this.isTauriRuntime()) {
      return;
    }
    try {
      const version = await getVersion();
      this.ngZone.run(() => this.appVersion.set(version));
    } catch {
      // 取得できない場合はバージョン行を出さない
    }
  }

  private async initializeStartupState(): Promise<void> {
    this.runtimeCheckDone.set(false);
    void this.loadAppVersion();
    await this.probeAndPersistDevEmulationState();
    void this.checkGpuAvailability();
    void this.loadComputeEnv();
    await this.checkTranscriptionRuntimeSupport();
    void this.ensureSetupProgressListener();
    await this.checkAllSetupStatus();
    await this.checkEditorInstalledMemory();
    await this.checkEditorVoiceInputPackStatus();
    void this.checkSegmentRetranscribeSupport();
    // ここ以降は直前までの await で実行コンテキストが Angular ゾーン外に出ている。
    // 画面表示を左右する signal（タブ表示を gate する runtimeCheckDone と
    // activeTabIndex）の更新を ngZone.run で包み、確定済みの値で変更検知を
    // 確実に走らせる。これをしないと spinner → タブ表示の切替が描画されず、
    // ウィンドウ再フォーカス等で CD が走るまで古い（未確定の）画面が残る。
    this.ngZone.run(() => this.activeTabIndex.set(0));
    await this.loadProofreadSystemPrompt();
    await this.loadOverallProofreadSystemPrompt();
    this.ngZone.run(() => this.runtimeCheckDone.set(true));
    // ここまでで GPU/セットアップ判定の signal は確定している。eventCoalescing 構成では
    // 変更検知がフレーム単位にまとめられ、ウィンドウが前面化されるまで描画が遅延しうる
    // （GPU 未検出バナーが古いまま残り、最前面化で初めて消える）。確定値を即座に反映させる
    // ため、同期的な変更検知を一度だけ強制する。
    this.appRef.tick();
    void this.initDefaultLlmModelPath();
    void this.initProofreadModelTier();
    void this.refreshLlmUiState();
  }

  /**
   * GPU 未検出バナー上の「GPU を再確認」ボタン用。
   * CUDA を後から入れた場合の再判定を兼ねるが、最大の効果は「クリック＝変更検知が走る」こと。
   * eventCoalescing 構成で描画が遅延し、CUDA 導入済みでもバナーが古いまま残るケースを、
   * アプリ再起動なしにその場で解消できる。
   */
  async recheckGpuRuntime(): Promise<void> {
    if (!this.isTauriRuntime() || this.gpuRechecking()) return;
    this.gpuRechecking.set(true);
    try {
      await this.checkGpuAvailability();
      await this.checkTranscriptionRuntimeSupport();
    } finally {
      this.gpuRechecking.set(false);
      // 確定値を即座に描画へ反映させる（フレーム単位の遅延を回避）
      this.appRef.tick();
    }
  }

  private async checkGpuAvailability(): Promise<void> {
    if (!this.isTauriRuntime()) return;
    try {
      const result = await invoke<{ cudaAvailable: boolean; rocmAvailable: boolean; buildVariant?: string; localLlmAppsEnabled?: boolean }>('check_gpu_availability');
      // invoke の Promise は NgZone 外で resolve されうるため、signal 更新を zone 内で行い再描画を保証する
      this.ngZone.run(() => {
        this.cudaAvailable.set(result.cudaAvailable);
        this.rocmAvailable.set(result.rocmAvailable);
        if (result.buildVariant === 'rocm') this.buildVariant.set('rocm');
        // 明示的に true のときだけ有効化（欠落・false はフェイルクローズで無効のまま）
        this.localLlmAppsEnabled.set(result.localLlmAppsEnabled === true);
        // フラグ確定後に保存済み backendMode を再適用（有効なら lmstudio/ollama を復元）
        this.applyBackendModeFromSettings();
      });
    } catch {
      // GPU確認失敗時は既存の設定値を維持する
    }
  }

  async loadComputeEnv(): Promise<void> {
    if (!this.isTauriRuntime()) return;
    try {
      const result = await invoke<ComputeEnvResult>('detect_compute_env');
      // invoke の Promise は NgZone 外で resolve されうるため、signal 更新を zone 内で行い再描画を保証する
      this.ngZone.run(() => {
        this.computeEnvInfo.set(result);
        this.availableGpuDevices.set(result.devices ?? []);
        this.recommendedGpuDeviceIndex.set(result.recommendedIndex ?? -1);
        if (result.largeV3Installed !== undefined) {
          this.largeV3Installed.set(result.largeV3Installed);
        }
        // 保存値がない（-1 初期値のまま）かつ推奨が存在する場合、推奨を自動選択して永続化
        if (this.selectedHipDeviceIndex() < 0 && (result.recommendedIndex ?? -1) >= 0) {
          this.selectedHipDeviceIndex.set(result.recommendedIndex);
          this.persistTranscriptionSettings();
        }
        if (this.selectedLlmHipDeviceIndex() < 0 && (result.recommendedIndex ?? -1) >= 0) {
          this.selectedLlmHipDeviceIndex.set(result.recommendedIndex);
          this.persistLlmSettings();
        }
      });
    } catch {
      // 取得失敗時は既存の状態を維持
    }
  }

  onWhisperModelChange(value: string): void {
    this.whisperModel.set(value);
    if (value === 'large-v3' && this.largeV3Installed() === false && !this.largeV3Downloading()) {
      void this.downloadLargeV3();
    }
  }

  private async downloadLargeV3(): Promise<void> {
    this.largeV3Downloading.set(true);
    this.largeV3DownloadMessage.set('large-v3 をダウンロード中... （数分かかる場合があります）');
    try {
      await invoke<boolean>('download_whisper_model', { modelName: 'large-v3' });
      this.largeV3Installed.set(true);
      this.snackBar.open('large-v3 のダウンロードが完了しました', undefined, { duration: 3000 });
    } catch (e) {
      this.largeV3DownloadMessage.set(`ダウンロード失敗: ${e}`);
      this.snackBar.open(`large-v3 ダウンロード失敗: ${e}`, undefined, { duration: 5000 });
    } finally {
      this.largeV3Downloading.set(false);
    }
  }

  /** 起動時に、バックエンドのマーカー（真実）と 12B 導入状態をフロントへ同期する。CUDA版のみ。 */
  private async initProofreadModelTier(): Promise<void> {
    if (!this.isTauriRuntime() || this.editorOnlyBuild) return;
    try {
      const tier = await invoke<string>('get_proofread_model_tier');
      this.ngZone.run(() => {
        this.proofreadModelTier.set(tier === '12b' ? '12b' : 'e4b');
      });
    } catch {
      // 取得失敗時は localStorage 由来の現在値を維持
    }
    try {
      const installed = await invoke<boolean>('check_gemma_12b_installed');
      this.ngZone.run(() => this.gemma12bInstalled.set(installed));
    } catch {
      // 判定失敗時は null のまま（未確定）
    }
  }

  async onProofreadModelTierChange(value: 'e4b' | '12b'): Promise<void> {
    const tier: 'e4b' | '12b' = value === '12b' ? '12b' : 'e4b';
    this.proofreadModelTier.set(tier);
    this.persistLlmSettings();
    // バックエンドのマーカー（サーバ起動時に参照される真実）へ反映する。
    try {
      await invoke('set_proofread_model_tier', { tier });
    } catch (e) {
      this.snackBar.open(`モデル設定の保存に失敗しました: ${e}`, undefined, { duration: 5000 });
      return;
    }
    // 12B 選択時で未導入なら、large-v3 と同じく後からダウンロードする。
    if (tier === '12b' && this.gemma12bInstalled() === false && !this.gemma12bDownloading()) {
      await this.downloadGemma12b();
    }
    // 起動済みの校正エンジンは旧モデルを保持しているため停止し、次回校正時に新モデルで再起動させる。
    if (this.llmServerStatus() === 'running' || this.llmServerStatus() === 'starting') {
      await this.stopLlm();
      this.llmServerStatus.set('stopped');
      this.llmLoadedDevice.set('stopped');
    }
  }

  private async downloadGemma12b(): Promise<void> {
    await this.ensureSetupProgressListener();
    this.gemma12bDownloading.set(true);
    this.gemma12bDownloadMessage.set('Gemma 4 12B（QAT+MTP）をダウンロード中... （約7GB・数分〜十数分かかります）');
    try {
      await invoke<boolean>('download_gemma_12b');
      this.gemma12bInstalled.set(true);
      this.gemma12bDownloadMessage.set('');
      this.snackBar.open('Gemma 4 12B のダウンロードが完了しました', undefined, { duration: 3000 });
    } catch (e) {
      this.gemma12bDownloadMessage.set(`ダウンロード失敗: ${e}`);
      this.snackBar.open(`Gemma 4 12B ダウンロード失敗: ${e}`, undefined, { duration: 5000 });
    } finally {
      this.gemma12bDownloading.set(false);
    }
  }

  computeEnvBackendLabel(): string {
    const backend = this.computeEnvInfo()?.backendType;
    if (backend === 'cuda') return 'CUDA (NVIDIA)';
    if (backend === 'rocm') return 'ROCm (AMD)';
    return 'GPU 未使用';
  }

  onHipDeviceChange(index: number): void {
    this.selectedHipDeviceIndex.set(index);
    this.persistTranscriptionSettings();
  }

  onLlmHipDeviceChange(index: number): void {
    this.selectedLlmHipDeviceIndex.set(index);
    this.persistLlmSettings();
  }

  onLlmParallelChange(value: number): void {
    this.selectedLlmParallel.set(this.normalizeLlmParallel(value));
    this.persistLlmSettings();
  }

  /** Rust choose_llm_parallelism の np 自動判定を再現。VRAM(MiB)階層: 11000+→4 / 7000+→2 / 他→1。 */
  private resolveAutoLlmParallel(vramMib: number): number {
    if (vramMib >= 11000) return 4;
    if (vramMib >= 7000) return 2;
    return 1;
  }

  private static readonly _KNOWN_OK_GFX = new Set([
    'gfx1030', 'gfx1100', 'gfx1101', 'gfx1102',
    'gfx1150', 'gfx1151', 'gfx1200', 'gfx1201',
  ]);

  private gpuAsrTier(device: GpuDeviceInfo): 'ok' | 'caution' {
    if (this.computeEnvInfo()?.backendType !== 'rocm') return 'ok';
    const arch = (device.gcnArchName ?? '').toLowerCase();
    return AppComponent._KNOWN_OK_GFX.has(arch) ? 'ok' : 'caution';
  }

  readonly selectedGpuAsrWarning = computed<string>(() => {
    const info = this.computeEnvInfo();
    if (!info || info.backendType !== 'rocm') return '';
    let idx = this.selectedHipDeviceIndex();
    if (idx < 0) idx = this.recommendedGpuDeviceIndex();
    const device = info.devices.find(d => d.index === idx);
    if (!device || this.gpuAsrTier(device) === 'ok') return '';
    const arch = (device.gcnArchName ?? '').toLowerCase();
    if (arch === 'gfx1103') {
      return 'ctranslate2-rocm の対応外GPUです。互換設定を自動適用しますが、動作しない場合があります。';
    }
    return '動作未確認のGPUです。文字起こしが動作しない場合があります。';
  });

  gpuDeviceLabel(device: GpuDeviceInfo): string {
    const gb = (device.totalVramMb / 1024).toFixed(0);
    const rec = device.index === this.recommendedGpuDeviceIndex() ? ' ★推奨' : '';
    const igpu = device.isLikelyIgpu ? ' ※統合GPU' : '';
    const warn = this.gpuAsrTier(device) === 'caution' ? ' ⚠ 動作未確認' : '';
    return `${device.name}（${gb}GB${igpu}${warn}${rec}）`;
  }

  /**
   * Lemonade のバックエンド導入状況とサーバー状態を確認してUI表示を更新する。
   * pre-warm（起動直後のエンジン自動起動・モデル即ロード）は廃止し、遅延起動に統一した。
   * エンジンは実際の校正実行時（runLlmProofread / runOverallProofread の startLlm）に初めて起動する。
   * これにより校正していない間は VRAM を保持しない（「自身が起動したモデルは終了後解放」の方針を、
   * そもそも校正前から保持しない形で徹底する）。
   */
  private async refreshLlmUiState(): Promise<void> {
    if (!this.isTauriRuntime()) return;
    if (!this.llmEngineUiVisible()) return;
    void this.checkLlmGpuBackendInstalled();
    await this.checkLlmStatus();
  }

  async checkLlmGpuBackendInstalled(): Promise<void> {
    if (!this.isTauriRuntime()) return;
    try {
      const installed = await invoke<boolean>('check_llm_gpu_backend_installed');
      this.llmGpuBackendInstalled.set(installed);
    } catch {
      this.llmGpuBackendInstalled.set(false);
    }
  }

  private async initDefaultLlmModelPath(): Promise<void> {
    if (!this.isTauriRuntime()) return;
    if (this.llmModelPath()) {
      void this.loadLlmModels();
      return;
    }
    try {
      const path = await invoke<string | null>('get_default_llm_model_path');
      if (path) {
        this.llmModelPath.set(path);
        this.persistLlmSettings();
        this.applyProofreadSystemPromptForSelectedModel();
        this.applyOverallProofreadSystemPromptForSelectedModel();
      }
    } catch {
      // デフォルトパスが取得できない場合はファイル選択ダイアログにフォールバック
    }
    void this.loadLlmModels();
  }

  async loadLlmModels(): Promise<void> {
    if (!this.isTauriRuntime()) return;
    try {
      const models = await invoke<LlmModelEntry[]>('list_llm_models');
      this.availableLlmModels.set(models);
      const current = this.llmModelPath();
      if (!current && models.length > 0) {
        const defaultModel = models.find(m => m.name.toLowerCase().includes('gemma')) ?? models[0];
        this.llmModelPath.set(defaultModel.path);
        this.persistLlmSettings();
      } else if (current && !models.some(m => m.path === current) && models.length > 0) {
        const defaultModel = models.find(m => m.name.toLowerCase().includes('gemma')) ?? models[0];
        this.llmModelPath.set(defaultModel.path);
        this.persistLlmSettings();
      }
      this.applyProofreadSystemPromptForSelectedModel();
      this.applyOverallProofreadSystemPromptForSelectedModel();
    } catch {
      // スキャン失敗は無視
    }
  }

  async openLlmModelsFolder(): Promise<void> {
    if (!this.isTauriRuntime()) return;
    try {
      await invoke('open_llm_models_folder');
    } catch {
      // ignore
    }
  }

  onLlmModelChange(path: string): void {
    this.llmModelPath.set(path);
    this.persistLlmSettings();
    this.applyProofreadSystemPromptForSelectedModel();
    this.applyOverallProofreadSystemPromptForSelectedModel();
  }

  /**
   * 保存済み backendMode を現在のポリシーに沿って適用する。
   * ローカルAIアプリ連携が無効のとき、lmstudio / ollama は内蔵モデルにフォールバックする。
   * localLlmAppsEnabled は起動時の check_gpu_availability で非同期に確定するため、
   * 設定適用時（applyAppSettings）とフラグ確定後（checkGpuAvailability）の両方から呼ぶ。
   */
  private applyBackendModeFromSettings(): void {
    const saved = this.appSettings.llm?.backendMode;
    if (!saved || !(['local_gguf', 'lmstudio', 'ollama'] as string[]).includes(saved)) {
      return;
    }
    const savedMode = saved as LlmBackendMode;
    const usesLocalLlmApp = savedMode === 'lmstudio' || savedMode === 'ollama';
    this.llmBackendMode.set(usesLocalLlmApp && !this.localLlmAppsEnabled() ? 'local_gguf' : savedMode);
  }

  /**
   * 「AI校正バックエンド」セレクタの変更ハンドラ。内蔵モデルの E4B / 12B 階層と
   * ローカルAIアプリ（lmstudio / ollama）の切替を 1 つのセレクタで扱う。
   * 内蔵モデルは backendMode='local_gguf' に統一し、階層は proofreadModelTier で表す。
   */
  async onLlmBackendSelectionChange(value: LlmBackendSelection): Promise<void> {
    if (value === 'local_gguf_12b') {
      this.onLlmBackendModeChange('local_gguf');
      // 12B 選択。未導入なら onProofreadModelTierChange 内でダウンロードを開始する。
      await this.onProofreadModelTierChange('12b');
      return;
    }
    if (value === 'local_gguf') {
      this.onLlmBackendModeChange('local_gguf');
      // 内蔵モデルを E4B（標準）へ戻す。
      if (this.proofreadModelTier() === '12b') {
        await this.onProofreadModelTierChange('e4b');
      }
      return;
    }
    // ローカルAIアプリ（lmstudio / ollama）。階層は内蔵モデル専用なので変更しない。
    this.onLlmBackendModeChange(value);
  }

  onLlmBackendModeChange(value: LlmBackendMode): void {
    this.llmBackendMode.set(value);
    // llmGpuMode はリセットしない。llmEngineUiVisible() が llmBackendMode === 'local_gguf'
    // を参照するため、local_gguf 以外では Lemonade UI は非表示になり誤起動も発生しない。
    // リセットすると local_gguf に戻したとき amd_gpu 設定が失われ llama_cpp パスへ落ちる。
    this.localOpenAiAvailableModels.set([]);
    this.localOpenAiStatusMessage.set('');
    this.localOpenAiServerName.set('local');
    this.applyStoredLlmPromptTypeForSelectedModel();
    this.applyProofreadSystemPromptForSelectedModel();
    this.applyOverallProofreadSystemPromptForSelectedModel();
    this.applyLlmInferenceParamsForSelectedModel();
    this.persistLlmSettings();
    if (value === 'local_gguf') {
      this.llmPromptType.set('gemma4');
      void this.refreshLlmUiState();
    }
  }

  onLocalOpenAiModelInput(value: string): void {
    if (this.llmBackendMode() === 'ollama') {
      this.ollamaModelInput.set(value);
    } else {
      this.lmstudioModelInput.set(value);
    }
    this.persistLlmSettings();
    this.applyStoredLlmPromptTypeForSelectedModel();
    this.applyProofreadSystemPromptForSelectedModel();
    this.applyOverallProofreadSystemPromptForSelectedModel();
    this.applyLlmInferenceParamsForSelectedModel();
  }

  async loadLocalOpenAiModels(): Promise<void> {
    if (!this.isTauriRuntime()) return;
    const baseUrl = this.activeOpenAiBaseUrl();
    this.localOpenAiModelsLoading.set(true);
    this.localOpenAiStatusMessage.set('モデル一覧を取得中...');
    try {
      const response = await invoke<LocalOpenAiModelsResponse>('list_local_openai_models', { request: { baseUrl } });
      const models = response.models ?? [];
      this.localOpenAiServerName.set(response.serverName?.trim() || 'local');
      this.localOpenAiAvailableModels.set(models);
      if (models.length === 0) {
        this.localOpenAiStatusMessage.set(`推論エンジン: ${this.localOpenAiServerName()}。モデル一覧が空でした。モデル名を手入力してください。`);
        return;
      }
      const current = this.activeOpenAiModelInput().trim();
      if (!current || !models.includes(current)) {
        this.onLocalOpenAiModelInput(models[0]);
      }
      this.localOpenAiStatusMessage.set(`推論エンジン: ${this.localOpenAiServerName()}。${models.length} 件のモデルを取得しました。`);
    } catch (error) {
      this.localOpenAiAvailableModels.set([]);
      this.localOpenAiStatusMessage.set(this.normalizeErrorMessage(error));
    } finally {
      this.localOpenAiModelsLoading.set(false);
    }
  }

  private async loadProofreadSystemPrompt(): Promise<void> {
    if (!this.isTauriRuntime()) return;
    try {
      const [fixedResponse, defaultResponse] = await Promise.all([
        invoke<ReadTextFileResponse>('get_proofread_system_prompt'),
        invoke<ReadTextFileResponse>('get_default_proofread_system_prompt'),
      ]);
      this.fixedProofreadSystemPrompt.set(fixedResponse.content);
      this.defaultProofreadSystemPrompt.set(defaultResponse.content || this.fallbackDefaultProofreadSystemPrompt);
    } catch {
      this.fixedProofreadSystemPrompt.set('');
      this.defaultProofreadSystemPrompt.set(this.fallbackDefaultProofreadSystemPrompt);
    }
    this.applyProofreadSystemPromptForSelectedModel();
  }

  private async loadOverallProofreadSystemPrompt(): Promise<void> {
    if (!this.isTauriRuntime()) return;
    try {
      const [fixedResponse, defaultResponse] = await Promise.all([
        invoke<ReadTextFileResponse>('get_overall_proofread_system_prompt'),
        invoke<ReadTextFileResponse>('get_default_overall_proofread_system_prompt'),
      ]);
      this.fixedOverallProofreadSystemPrompt.set(fixedResponse.content);
      this.defaultOverallProofreadSystemPrompt.set(defaultResponse.content);
    } catch {
      this.fixedOverallProofreadSystemPrompt.set('');
      this.defaultOverallProofreadSystemPrompt.set('');
    }
    this.applyOverallProofreadSystemPromptForSelectedModel();
  }

  private getDefaultForCurrentOverallPromptType(): string {
    if (this.llmPromptType() === 'original') {
      return this.defaultOverallProofreadSystemPrompt();
    }
    return this.fixedOverallProofreadSystemPrompt();
  }

  private applyOverallProofreadSystemPromptForSelectedModel(): void {
    if (this.proofreadSystemPromptReadonly()) {
      this.overallProofreadSystemPrompt.set(this.fixedOverallProofreadSystemPrompt());
      return;
    }
    this.overallProofreadSystemPrompt.set(this.getStoredOverallProofreadSystemPrompt());
  }

  private getStoredOverallProofreadSystemPrompt(): string {
    const fallback = this.getDefaultForCurrentOverallPromptType();
    if (this.llmBackendMode() !== 'local_gguf') {
      const model = this.activeOpenAiModelInput().trim();
      if (!model) return fallback;
      const key = `${this.llmBackendMode()}:${model}`;
      const value = this.appSettings.llm?.overallSystemPromptsByBackend?.[key];
      return typeof value === 'string' ? value : fallback;
    }
    const key = this.getLlmModelFileName(this.llmModelPath());
    if (!key) return fallback;
    const value = this.appSettings.llm?.overallSystemPromptsByModelFileName?.[key];
    return typeof value === 'string' ? value : fallback;
  }

  private persistOverallProofreadSystemPromptForSelectedModel(value: string): void {
    const llm = this.appSettings.llm ?? {};
    const nextLlm = { ...llm };
    if (this.llmBackendMode() !== 'local_gguf') {
      const model = this.activeOpenAiModelInput().trim();
      if (!model) return;
      const key = `${this.llmBackendMode()}:${model}`;
      const overallSystemPromptsByBackend = { ...(llm.overallSystemPromptsByBackend ?? {}) };
      overallSystemPromptsByBackend[key] = value;
      nextLlm.overallSystemPromptsByBackend = overallSystemPromptsByBackend;
    } else {
      const key = this.getLlmModelFileName(this.llmModelPath());
      if (!key || this.isGemma4DefaultLlmModelFileName(key)) return;
      const overallSystemPromptsByModelFileName = { ...(llm.overallSystemPromptsByModelFileName ?? {}) };
      overallSystemPromptsByModelFileName[key] = value;
      nextLlm.overallSystemPromptsByModelFileName = overallSystemPromptsByModelFileName;
    }
    this.appSettings = { ...this.appSettings, llm: nextLlm };
    this.persistAppSettings();
    this.overallPromptSaveVersion.update(v => v + 1);
  }

  onOverallProofreadSystemPromptInput(event: Event): void {
    if (this.proofreadSystemPromptReadonly()) {
      this.overallProofreadSystemPrompt.set(this.fixedOverallProofreadSystemPrompt());
      return;
    }
    const value = event.target instanceof HTMLTextAreaElement ? event.target.value : '';
    this.overallProofreadSystemPrompt.set(value);
  }

  saveOverallProofreadSystemPrompt(): void {
    if (!this.canSaveOverallProofreadSystemPrompt()) return;
    this.persistOverallProofreadSystemPromptForSelectedModel(this.overallProofreadSystemPrompt());
    const type = this.llmPromptType() === 'gemma4' ? 'Gemma4フォーマット' : 'オリジナルフォーマット';
    this.snackBar.open(`全体校正プロンプトを保存しました（${type}）`, undefined, { duration: 2500 });
  }

  confirmResetOverallProofreadSystemPrompt(): void {
    if (this.proofreadSystemPromptReadonly()) return;
    this.openConfirmDialog({
      actionKind: 'resetOverallProofreadSystemPrompt',
      title: '全体校正プロンプトを初期値に戻す',
      message: '現在の全体校正プロンプトを破棄して初期値に戻します。よろしいですか？',
      confirmLabel: '初期値に戻す',
      cancelLabel: 'キャンセル',
      confirmColor: 'warn',
      cancelColor: null,
    });
  }

  resetOverallProofreadSystemPromptForSelectedModel(): void {
    if (this.proofreadSystemPromptReadonly()) return;
    const fallback = this.getDefaultForCurrentOverallPromptType();
    const llm = this.appSettings.llm ?? {};
    const nextLlm = { ...llm };
    if (this.llmBackendMode() !== 'local_gguf') {
      const model = this.activeOpenAiModelInput().trim();
      if (model) {
        const key = `${this.llmBackendMode()}:${model}`;
        const overallSystemPromptsByBackend = { ...(llm.overallSystemPromptsByBackend ?? {}) };
        delete overallSystemPromptsByBackend[key];
        nextLlm.overallSystemPromptsByBackend = overallSystemPromptsByBackend;
        this.appSettings = { ...this.appSettings, llm: nextLlm };
        this.persistAppSettings();
        this.overallPromptSaveVersion.update(v => v + 1);
      }
    } else {
      const key = this.getLlmModelFileName(this.llmModelPath());
      if (!key || this.isGemma4DefaultLlmModelFileName(key)) return;
      const overallSystemPromptsByModelFileName = { ...(llm.overallSystemPromptsByModelFileName ?? {}) };
      delete overallSystemPromptsByModelFileName[key];
      nextLlm.overallSystemPromptsByModelFileName = overallSystemPromptsByModelFileName;
      this.appSettings = { ...this.appSettings, llm: nextLlm };
      this.persistAppSettings();
      this.overallPromptSaveVersion.update(v => v + 1);
    }
    this.overallProofreadSystemPrompt.set(fallback);
  }

  private persistLlmSettings(): void {
    const llm = this.appSettings.llm ?? {};
    this.appSettings = {
      ...this.appSettings,
      llm: {
        ...llm,
        modelPath: this.llmModelPath(),
        backendMode: this.llmBackendMode(),
        llmGpuMode: this.llmGpuMode(),
        lemonadeUrl: this.lemonadeUrl(),
        lemonadeModel: this.lemonadeModel(),
        lmstudioModel: this.lmstudioModelInput(),
        ollamaModel: this.ollamaModelInput(),
        lemonadeBackendNotNeeded: this.lemonadeBackendNotNeeded(),
        llmHipDeviceIndex: this.selectedLlmHipDeviceIndex(),
        llmPromptType: this.llmPromptType(),
        llmParallel: this.selectedLlmParallel(),
        proofreadModelTier: this.proofreadModelTier(),
      },
    };
    this.persistAppSettings();
  }

  onLlmGpuModeChange(value: LlmGpuMode): void {
    this.llmGpuMode.set(value);
    this.persistLlmSettings();
    void this.refreshLlmUiState();
  }

  onLlmPromptTypeChange(value: LlmPromptType): void {
    this.llmPromptType.set(value);
    this.persistLlmSettings();
    this.persistLlmPromptTypeForModel();
    this.applyProofreadSystemPromptForSelectedModel();
    this.applyOverallProofreadSystemPromptForSelectedModel();
  }

  async checkLlmStatus(): Promise<void> {
    if (!this.isTauriRuntime()) return;
    try {
      const status = await invoke<string>('get_llm_server_status');
      this.llmServerStatus.set(status as 'running' | 'stopped' | 'starting' | 'not_installed');
      if (status === 'running') {
        void this.refreshLlmLoadedDevice();
      } else if (status === 'stopped' || status === 'not_installed') {
        this.llmLoadedDevice.set('stopped');
      }
    } catch {
      this.llmServerStatus.set('error');
      this.llmLoadedDevice.set('error');
    }
  }

  /** start_llm_server の直近のエラーメッセージ。VRAM不足判定（OOMマーカー含む）に使う。 */
  private llmLastError = '';
  /** VRAM不足ダイアログで「下げて再実行」が承認されたときに呼ぶ再試行コールバック。 */
  private pendingVramOomRetry: (() => Promise<void>) | null = null;
  /** VRAM不足ダイアログ承認時に設定する並列処理数（段階的: 24→20→16→12→8→4→2→1）。 */
  private pendingVramOomTargetNp = 1;

  /** エラーメッセージが VRAM 不足（OOM）を示すか判定する。Rust付与の [VRAM_OOM] マーカー優先。 */
  private isVramOomError(msg: string | null | undefined): boolean {
    if (!msg) return false;
    const lower = msg.toLowerCase();
    if (lower.includes('[vram_oom]')) return true;
    return ['out of memory', 'failed to allocate', 'cudamalloc', 'cudaerrormemoryallocation', 'ggml_backend_cuda_buffer']
      .some((m) => lower.includes(m));
  }

  /**
   * エラーが VRAM 不足を示し、かつ並列処理数をまだ下げられる場合に、
   * 「並列処理数を下げて再実行」の確認ダイアログを出す。出したら true を返す
   * （呼び出し側は赤字エラー表示を抑制してよい）。
   * 下げ方は段階的（24→20、20→16、16→12、12→8、8→4、4→2、2→1）。自動(0)設定時は直近に試行された実効値を Rust から取得する。
   * CUDA(local_gguf) 経路のみ並列処理数が効くため、それ以外は false。
   */
  private async maybePromptLowerParallelOnOom(errorMsg: string, retry: () => Promise<void>): Promise<boolean> {
    if (!this.isTauriRuntime()) return false;
    if (this.llmBackendMode() !== 'local_gguf') return false;
    if (!this.isVramOomError(errorMsg)) return false;
    const manual = this.selectedLlmParallel();
    let cur = manual;
    if (cur <= 0) {
      // 自動(0): 直近の CUDA 起動で試行した -np を取得（OOM失敗時も試行値が残る）
      try {
        cur = await invoke<number>('get_llm_attempted_parallel');
      } catch {
        cur = 0;
      }
    }
    if (cur <= 1) return false; // これ以上下げられない（無限ループ防止も兼ねる）
    const target = cur > 20 ? 20 : cur > 16 ? 16 : cur > 12 ? 12 : cur > 8 ? 8 : cur > 4 ? 4 : cur > 2 ? 2 : 1;
    this.pendingVramOomRetry = retry;
    this.pendingVramOomTargetNp = target;
    const curLabel = manual > 0 ? `${manual}` : `自動(${cur})`;
    this.openConfirmDialog({
      actionKind: 'lowerLlmParallelOnOom',
      title: 'VRAMが不足した可能性があります',
      message: `AI校正でGPUメモリ(VRAM)が不足した可能性があります。\n並列処理数（現在: ${curLabel}）を${target}に下げて、もう一度実行しますか？`,
      confirmLabel: `${target}に下げて再実行`,
      cancelLabel: 'キャンセル',
      confirmColor: 'primary',
      cancelColor: null,
    });
    return true;
  }

  async startLlm(silent = false): Promise<void> {
    if (!this.isTauriRuntime()) return;
    this.llmLastError = '';
    this.llmServerStatus.set('starting');
    try {
      const llmDevIdx = this.selectedLlmHipDeviceIndex();
      const llmPar = this.selectedLlmParallel();
      const llmCtxVal = this.llmNCtx();
      await invoke('start_llm_server', {
        hipDeviceIndex: llmDevIdx >= 0 ? llmDevIdx : null,
        llmParallel: llmPar > 0 ? llmPar : null,
        llmCtx: llmCtxVal > 0 ? llmCtxVal : null
      });
      this.llmServerStatus.set('running');
      await this.syncLlmUrl();
      void this.fetchLlmSystemInfo();
      void this.refreshLlmLoadedDevice();
    } catch (e) {
      this.llmLastError = this.normalizeErrorMessage(e);
      // silent=true の自動起動は、GPUランタイムやモデルが未整備のフレッシュインストール直後に
      // 高確率で「想定内」の失敗をする。その失敗を文字起こしタブの赤字エラーに昇格させず、
      // 停止状態に戻すだけにする（手動起動・校正実行など明示操作の経路は従来どおり赤字表示）。
      if (silent) {
        this.llmServerStatus.set('stopped');
        this.llmLoadedDevice.set('stopped');
        console.warn('AI校正エンジンの自動起動を見送りました:', this.normalizeErrorMessage(e));
      } else {
        this.llmServerStatus.set('error');
        this.llmLoadedDevice.set('error');
        this.error.set(this.normalizeErrorMessage(e));
      }
    }
  }

  /** lemond が実際に listen しているポートを取得し、loopback URL であれば lemonadeUrl を同期する。 */
  private async syncLlmUrl(): Promise<void> {
    if (!this.isTauriRuntime()) return;
    try {
      const port = await invoke<number>('get_llm_server_port');
      if (port > 0) {
        const current = this.lemonadeUrl();
        // ユーザーが loopback 以外のカスタム URL を設定している場合は上書きしない
        if (/^https?:\/\/(localhost|127\.\d+\.\d+\.\d+|\[::1\]):/i.test(current)) {
          const newUrl = `http://localhost:${port}`;
          if (current !== newUrl) {
            this.lemonadeUrl.set(newUrl);
            this.persistLlmSettings();
          }
        }
      }
    } catch { }
  }

  async stopLlm(): Promise<void> {
    if (!this.isTauriRuntime()) return;
    try {
      await invoke('stop_llm_server');
      this.llmServerStatus.set('stopped');
      this.llmHwInfo.set(null);
      this.llmLoadedDevice.set('stopped');
    } catch { }
  }

  private async refreshLlmLoadedDevice(): Promise<void> {
    if (!this.isTauriRuntime()) return;
    if (this.llmServerStatus() !== 'running') {
      this.llmLoadedDevice.set('stopped');
      return;
    }
    try {
      const device = await invoke<string>('get_llm_loaded_device');
      const normalized = (device ?? '').trim().toLowerCase();
      if (normalized === 'gpu' || normalized === 'cpu' || normalized === 'stopped') {
        this.llmLoadedDevice.set(normalized);
      } else {
        this.llmLoadedDevice.set('unknown');
      }
    } catch {
      this.llmLoadedDevice.set('error');
    }
  }

  async installLlmEngine(): Promise<void> {
    if (!this.isTauriRuntime()) return;
    this.llmServerStatus.set('installing');
    this.llmInstallMessage.set('AI校正エンジンを起動中...');
    const unlisten = await listen<{ stage: string; message: string }>(
      'llm-install-progress',
      (event) => this.llmInstallMessage.set(event.payload.message),
    );
    try {
      await invoke('install_llm_engine');
      this.llmServerStatus.set('running');
      this.llmInstallMessage.set('');
      void this.fetchLlmSystemInfo();
    } catch (e) {
      this.llmServerStatus.set('error');
      this.error.set(this.normalizeErrorMessage(e));
    } finally {
      unlisten();
    }
  }

  async installLlmBackend(): Promise<void> {
    const entry = this.llmInstallableGpuEntry();
    if (!entry || !this.isTauriRuntime()) return;
    this.llmBackendInstalling.set(true);
    this.llmBackendInstallMessage.set(`${entry.installKey} をダウンロード中... しばらくお待ちください`);
    const unlisten = await listen<{ message: string }>(
      'llm-backend-install-progress',
      (ev) => this.llmBackendInstallMessage.set(ev.payload.message),
    );
    try {
      await invoke('install_llm_backend', { backend: entry.installKey });
      this.llmBackendInstallMessage.set(`${entry.installKey} のインストールが完了しました`);
      await this.checkLlmGpuBackendInstalled();
      await this.fetchLlmSystemInfo();
    } catch (e) {
      this.llmBackendInstallMessage.set(this.normalizeErrorMessage(e));
    } finally {
      this.llmBackendInstalling.set(false);
      unlisten();
    }
  }

  /** [開発環境のみ] 「不要」設定を解除してAMD GPUモードを再度有効化する。 */
  resetLlmBackendNotNeeded(): void {
    this.lemonadeBackendNotNeeded.set(false);
    this.persistLlmSettings();
  }

  /** 「不要」ボタン押下時: GPU バックエンドプロンプトを永続的に非表示にする。 */
  dismissLlmBackendPrompt(): void {
    this.lemonadeBackendNotNeeded.set(true);
    this.persistLlmSettings();
  }

  async fetchLlmSystemInfo(): Promise<void> {
    const LLM_RECIPES: Record<string, string> = {
      llamacpp: 'LlamaCPP',
      flm: 'FLM',
      'ryzenai-llm': 'RyzenAI',
    };
    const BACKEND_DISPLAY: Record<string, string> = {
      vulkan: 'Vulkan', rocm: 'ROCm', cpu: 'CPU', metal: 'Metal',
    };
    const NPU_RECIPES = new Set(['flm', 'ryzenai-llm']);
    const GPU_BACKENDS = new Set(['vulkan', 'rocm', 'metal']);
    const STATE_ORDER: Record<string, number> = { installed: 0, update_required: 1, installable: 2 };
    const CATEGORY_ORDER: Record<string, number> = { gpu: 0, npu: 1, cpu: 2 };

    try {
      const res = await fetch(`${this.lemonadeUrl()}/v1/system-info`);
      if (!res.ok) { this.llmHwInfo.set(null); return; }
      const data = await res.json();
      const recipes = data?.recipes ?? {};

      // Collect actual device names from the devices section
      const devicesSection = data?.devices ?? {};
      const amdGpuNames: string[] = (devicesSection.amd_gpu ?? [])
        .map((g: any) => g?.name ?? '').filter(Boolean);
      const nvidiaGpuNames: string[] = (devicesSection.nvidia_gpu ?? [])
        .map((g: any) => g?.name ?? '').filter(Boolean);
      const cpuName: string = devicesSection.cpu?.name ?? '';

      const resolveDeviceSuffix = (backendDevices: string[]): string => {
        if (backendDevices.includes('amd_gpu') && amdGpuNames.length > 0) return amdGpuNames[0];
        if (backendDevices.includes('nvidia_gpu') && nvidiaGpuNames.length > 0) return nvidiaGpuNames[0];
        if (backendDevices.includes('amd_npu')) return 'NPU';
        if (backendDevices.includes('cpu') && cpuName) return cpuName;
        return '';
      };

      const entries: LlmBackendEntry[] = [];

      for (const [recipeKey, engineName] of Object.entries(LLM_RECIPES)) {
        const recipeData = recipes[recipeKey] as any;
        if (!recipeData?.backends) continue;
        for (const [backendKey, backendData] of Object.entries(recipeData.backends as Record<string, any>)) {
          const state = backendData?.state as string;
          if (!state || state === 'unsupported') continue;

          let label: string;
          let category: 'gpu' | 'npu' | 'cpu';
          const backendDevices: string[] = backendData?.devices ?? [];

          if (backendKey === 'default') {
            const isNpu = NPU_RECIPES.has(recipeKey);
            const deviceSuffix = resolveDeviceSuffix(backendDevices);
            label = isNpu
              ? `${engineName} - NPU${deviceSuffix ? ` (${deviceSuffix})` : ''}`
              : `${engineName}${deviceSuffix ? ` (${deviceSuffix})` : ''}`;
            category = isNpu ? 'npu' : 'cpu';
          } else {
            const isGpu = GPU_BACKENDS.has(backendKey);
            const deviceSuffix = resolveDeviceSuffix(backendDevices);
            label = `${engineName} - ${BACKEND_DISPLAY[backendKey] ?? backendKey}${deviceSuffix ? ` (${deviceSuffix})` : ''}`;
            category = isGpu ? 'gpu' : 'cpu';
          }
          const installKey = backendKey === 'default' ? recipeKey : `${recipeKey}:${backendKey}`;
          entries.push({ label, state: state as LlmBackendEntry['state'], category, installKey });
        }
      }

      entries.sort((a, b) => {
        const sd = (STATE_ORDER[a.state] ?? 9) - (STATE_ORDER[b.state] ?? 9);
        return sd !== 0 ? sd : (CATEGORY_ORDER[a.category] ?? 9) - (CATEGORY_ORDER[b.category] ?? 9);
      });
      // console.log('[Lemonade] systemInfo entries:', entries.length, entries.map(e => `${e.installKey}=${e.state}`));
      this.llmHwInfo.set(entries.length > 0 ? entries : null);
    } catch (e) {
      // console.warn('[Lemonade] fetchLlmSystemInfo error:', e);
      this.llmHwInfo.set(null);
    }
  }

  onProofreadSystemPromptInput(event: Event): void {
    if (this.proofreadSystemPromptReadonly()) {
      this.proofreadSystemPrompt.set(this.fixedProofreadSystemPrompt());
      return;
    }
    const value = event.target instanceof HTMLTextAreaElement ? event.target.value : '';
    this.proofreadSystemPrompt.set(value);
  }

  saveProofreadSystemPromptForSelectedModel(): void {
    if (!this.canSaveProofreadSystemPrompt()) {
      return;
    }
    this.persistProofreadSystemPromptForSelectedModel(this.proofreadSystemPrompt());
    const type = this.llmPromptType() === 'gemma4' ? 'Gemma4フォーマット' : 'オリジナルフォーマット';
    this.snackBar.open(`プロンプトを保存しました（${type}）`, undefined, { duration: 2500 });
  }

  confirmResetProofreadSystemPrompt(): void {
    if (this.proofreadSystemPromptReadonly()) return;
    this.openConfirmDialog({
      actionKind: 'resetProofreadSystemPrompt',
      title: 'プロンプトを初期値に戻す',
      message: '現在のプロンプトを破棄して初期値に戻します。よろしいですか？',
      confirmLabel: '初期値に戻す',
      cancelLabel: 'キャンセル',
      confirmColor: 'warn',
      cancelColor: null,
    });
  }

  resetProofreadSystemPromptForSelectedModel(): void {
    if (this.proofreadSystemPromptReadonly()) {
      return;
    }
    const fallback = this.getDefaultForCurrentPromptType();
    const llm = this.appSettings.llm ?? {};
    const nextLlm = { ...llm, modelPath: this.llmModelPath() };
    if (this.llmBackendMode() !== 'local_gguf') {
      const model = this.activeOpenAiModelInput().trim();
      if (model) {
        const key = `${this.llmBackendMode()}:${model}`;
        const systemPromptsByBackend = { ...(llm.systemPromptsByBackend ?? {}) };
        delete systemPromptsByBackend[key];
        nextLlm.systemPromptsByBackend = systemPromptsByBackend;
        this.appSettings = { ...this.appSettings, llm: nextLlm };
        this.persistAppSettings();
        this.promptSaveVersion.update(v => v + 1);
      }
    } else {
      const key = this.getLlmModelFileName(this.llmModelPath());
      if (!key || this.isGemma4DefaultLlmModelFileName(key)) {
        return;
      }
      const systemPromptsByModelFileName = { ...(llm.systemPromptsByModelFileName ?? {}) };
      delete systemPromptsByModelFileName[key];
      nextLlm.systemPromptsByModelFileName = systemPromptsByModelFileName;
      this.appSettings = { ...this.appSettings, llm: nextLlm };
      this.persistAppSettings();
      this.promptSaveVersion.update(v => v + 1);
    }
    this.proofreadSystemPrompt.set(fallback);
  }

  private getDefaultForCurrentPromptType(): string {
    if (this.llmPromptType() === 'original') {
      return this.defaultProofreadSystemPrompt() || this.fallbackOriginalTypeSystemPrompt;
    }
    return this.fixedProofreadSystemPrompt() || this.fallbackDefaultProofreadSystemPrompt;
  }

  private applyProofreadSystemPromptForSelectedModel(): void {
    if (this.proofreadSystemPromptReadonly()) {
      this.proofreadSystemPrompt.set(this.fixedProofreadSystemPrompt());
      return;
    }
    this.proofreadSystemPrompt.set(this.getStoredProofreadSystemPrompt());
  }

  private applyStoredLlmPromptTypeForSelectedModel(): void {
    if (this.llmBackendMode() === 'local_gguf') return;
    const model = this.activeOpenAiModelInput().trim();
    if (!model) return;
    const key = `${this.llmBackendMode()}:${model}`;
    const stored = this.appSettings.llm?.promptTypeByBackend?.[key];
    if (stored === 'gemma4' || stored === 'original') {
      this.llmPromptType.set(stored);
    }
  }

  private persistLlmPromptTypeForModel(): void {
    if (this.llmBackendMode() === 'local_gguf') return;
    const model = this.activeOpenAiModelInput().trim();
    if (!model) return;
    const key = `${this.llmBackendMode()}:${model}`;
    const llm = this.appSettings.llm ?? {};
    const promptTypeByBackend = { ...(llm.promptTypeByBackend ?? {}) };
    promptTypeByBackend[key] = this.llmPromptType();
    this.appSettings = { ...this.appSettings, llm: { ...llm, promptTypeByBackend } };
    this.persistAppSettings();
  }

  private persistProofreadSystemPromptForSelectedModel(value: string): void {
    const llm = this.appSettings.llm ?? {};
    const nextLlm = { ...llm, modelPath: this.llmModelPath() };
    if (this.llmBackendMode() !== 'local_gguf') {
      const model = this.activeOpenAiModelInput().trim();
      if (!model) return;
      const key = `${this.llmBackendMode()}:${model}`;
      const systemPromptsByBackend = { ...(llm.systemPromptsByBackend ?? {}) };
      systemPromptsByBackend[key] = value;
      nextLlm.systemPromptsByBackend = systemPromptsByBackend;
    } else {
      const key = this.getLlmModelFileName(this.llmModelPath());
      if (!key || this.isGemma4DefaultLlmModelFileName(key)) {
        return;
      }
      const systemPromptsByModelFileName = { ...(llm.systemPromptsByModelFileName ?? {}) };
      systemPromptsByModelFileName[key] = value;
      nextLlm.systemPromptsByModelFileName = systemPromptsByModelFileName;
    }
    this.appSettings = {
      ...this.appSettings,
      llm: nextLlm,
    };
    this.persistAppSettings();
    this.promptSaveVersion.update(v => v + 1);
  }

  private getStoredProofreadSystemPrompt(): string {
    const fallback = this.getDefaultForCurrentPromptType();
    if (this.llmBackendMode() !== 'local_gguf') {
      const model = this.activeOpenAiModelInput().trim();
      if (!model) return fallback;
      const key = `${this.llmBackendMode()}:${model}`;
      const value = this.appSettings.llm?.systemPromptsByBackend?.[key];
      return typeof value === 'string' ? value : fallback;
    }
    const key = this.getLlmModelFileName(this.llmModelPath());
    if (!key) {
      return fallback;
    }
    const value = this.appSettings.llm?.systemPromptsByModelFileName?.[key];
    return typeof value === 'string' ? value : fallback;
  }

  private getSelectedProofreadSystemPromptForRun(): string | null {
    if (this.llmPromptType() === 'original') {
      // オリジナルフォーマット: textareaの内容を常にシステムプロンプトとして送信する
      const value = this.proofreadSystemPrompt().trim();
      return value ? value : null;
    }
    if (this.proofreadSystemPromptReadonly()) {
      return null;
    }
    const value = this.proofreadSystemPrompt().trim();
    return value ? value : null;
  }

  private buildLlmInferenceParamsKey(): string {
    const mode = this.llmBackendMode();
    if (mode === 'local_gguf') return 'local_gguf';
    const model = this.activeOpenAiModelInput().trim();
    return model ? `${mode}:${model}` : mode;
  }

  private normalizeLlmNCtx(value: number): number {
    if (!Number.isFinite(value) || value <= 0) return 0; // 0=自動
    return Math.max(4096, Math.min(131072, Math.round(value / 512) * 512));
  }

  private normalizeLlmMaxBatch(value: number): number {
    if (!Number.isFinite(value)) return 40;
    return Math.max(1, Math.min(100, Math.round(value)));
  }

  private normalizeLlmParallel(value: number): number {
    if (!Number.isFinite(value) || value <= 0) return 0;
    return Math.max(1, Math.min(24, Math.round(value)));
  }

  private getStoredLlmInferenceParams(): { nCtx: number; maxBatch: number } {
    const key = this.buildLlmInferenceParamsKey();
    const stored = this.appSettings.llm?.inferenceParamsByKey?.[key];
    return {
      nCtx: Number.isFinite(stored?.nCtx) ? this.normalizeLlmNCtx(Number(stored!.nCtx)) : 0,
      maxBatch: Number.isFinite(stored?.maxBatch) ? this.normalizeLlmMaxBatch(Number(stored!.maxBatch)) : 40,
    };
  }

  private applyLlmInferenceParamsForSelectedModel(): void {
    const { nCtx, maxBatch } = this.getStoredLlmInferenceParams();
    this.llmNCtx.set(nCtx);
    this.llmMaxBatch.set(maxBatch);
  }

  private persistLlmInferenceParams(): void {
    const key = this.buildLlmInferenceParamsKey();
    const llm = this.appSettings.llm ?? {};
    const inferenceParamsByKey = { ...(llm.inferenceParamsByKey ?? {}) };
    inferenceParamsByKey[key] = {
      nCtx: this.normalizeLlmNCtx(this.llmNCtx()),
      maxBatch: this.normalizeLlmMaxBatch(this.llmMaxBatch()),
    };
    this.appSettings = { ...this.appSettings, llm: { ...llm, inferenceParamsByKey } };
    this.persistAppSettings();
  }

  onLlmNCtxChange(raw: number | string): void {
    const n = typeof raw === 'number' ? raw : parseFloat(raw as string);
    this.llmNCtx.set(this.normalizeLlmNCtx(Number.isFinite(n) ? n : 0));
    this.persistLlmInferenceParams();
  }

  onLlmMaxBatchChange(raw: string): void {
    const n = parseFloat(raw);
    this.llmMaxBatch.set(this.normalizeLlmMaxBatch(Number.isFinite(n) ? n : 40));
    this.persistLlmInferenceParams();
  }

  resetLlmInferenceParams(): void {
    this.llmNCtx.set(0); // コンテキスト長を「自動（VRAMで判定）」に戻す
    this.llmMaxBatch.set(40);
    this.selectedLlmParallel.set(0); // 並列処理数を「自動（VRAMで判定）」に戻す
    const key = this.buildLlmInferenceParamsKey();
    const llm = this.appSettings.llm ?? {};
    const inferenceParamsByKey = { ...(llm.inferenceParamsByKey ?? {}) };
    delete inferenceParamsByKey[key];
    this.appSettings = { ...this.appSettings, llm: { ...llm, inferenceParamsByKey, llmParallel: 0 } };
    this.persistAppSettings();
  }

  private isGemma4DefaultLlmModelPath(modelPath: string): boolean {
    return this.isGemma4DefaultLlmModelFileName(this.getLlmModelFileName(modelPath));
  }

  private isGemma4DefaultLlmModelFileName(fileName: string): boolean {
    const normalized = fileName.trim().toLowerCase();
    return (
      normalized === 'gemma-4-e4b-it-qat-ud-q4_k_xl.gguf' ||
      normalized === 'gemma-4-e4b-it-qat-ud-q4_k_xl' ||
      // 旧 PTQ 量子化（移行前の設定値との互換のため残す）
      normalized === 'gemma-4-e4b-it-q4_k_m.gguf' ||
      normalized === 'gemma-4-e4b-it-q4_k_m'
    );
  }

  private getLlmModelFileName(modelPath: string): string {
    const normalized = (modelPath ?? '').replace(/\\/g, '/').trim();
    if (!normalized) {
      return '';
    }
    const parts = normalized.split('/');
    return parts[parts.length - 1] ?? '';
  }

  private async probeAndPersistDevEmulationState(): Promise<void> {
    if (!this.isTauriRuntime()) {
      return;
    }
    try {
      const status = await invoke<DevEmulationStatusResponse>('get_dev_emulation_status');
      this.appSettings = {
        ...this.appSettings,
        devEmulation: {
          mode: this.normalizeDevEmulationMode(status.mode),
          noCuda: status.noCuda === true,
          missingCommunity1: status.missingCommunity1 === true,
          capturedAt: Date.now()
        }
      };
      this.persistAppSettings();
      this.updateDevEmulationLabelFromSettings();
    } catch {
      // ignore
    }
  }

  private updateDevEmulationLabelFromSettings(): void {
    const emu = this.appSettings.devEmulation;
    if (!emu) {
      this.devEmulationLabel.set('');
      return;
    }
    const mode = this.normalizeDevEmulationMode(emu.mode);
    if (mode === 'no_cuda') {
      this.devEmulationLabel.set('開発用エミュレーション: CUDAなしをエミュレート中');
      return;
    }
    if (mode === 'missing_community1') {
      this.devEmulationLabel.set('開発用エミュレーション: community-1未配置をエミュレート中');
      return;
    }
    const flags: string[] = [];
    if (emu.noCuda === true) {
      flags.push('CUDAなしをエミュレート中');
    }
    if (emu.missingCommunity1 === true) {
      flags.push('community-1未配置をエミュレート中');
    }
    if (flags.length === 0) {
      this.devEmulationLabel.set('');
      return;
    }
    this.devEmulationLabel.set(`開発用エミュレーション: ${flags.join(' / ')}`);
  }

  private normalizeDevEmulationMode(value: unknown): 'none' | 'no_cuda' | 'missing_community1' {
    const normalized = String(value ?? '').trim().toLowerCase();
    if (normalized === 'no_cuda') {
      return 'no_cuda';
    }
    if (normalized === 'missing_community1') {
      return 'missing_community1';
    }
    return 'none';
  }

  async checkDiarizationModelStatus(showFeedback = false): Promise<void> {
    if (!this.isTauriRuntime()) {
      this.diarizationModelChecked.set(true);
      this.diarizationModelExists.set(true);
      this.diarizationModelHasConfig.set(true);
      this.diarizationModelExpectedPath.set('');
      this.diarizationSetupVisible.set(false);
      if (showFeedback) {
        this.diarizationCheckMessage.set('');
        this.diarizationCheckIsError.set(false);
      }
      return;
    }
    this.diarizationModelChecking.set(true);
    try {
      const status = await invoke<DiarizationModelStatusResponse>('check_diarization_model_status');
      this.diarizationModelExists.set(!!status.exists);
      this.diarizationModelHasConfig.set(!!status.hasConfig);
      this.diarizationModelExpectedPath.set(status.expectedPath ?? '');
      this.diarizationSetupVisible.set(!(status.exists && status.hasConfig));
      if (showFeedback) {
        if (status.exists && status.hasConfig) {
          this.diarizationCheckMessage.set('話者分離モデルを確認しました。利用可能です。');
          this.diarizationCheckIsError.set(false);
        } else {
          this.diarizationCheckMessage.set(
            `話者分離モデルが見つかりません。配置先を確認してください: ${status.expectedPath ?? ''}`
          );
          this.diarizationCheckIsError.set(true);
        }
      }
    } catch (error) {
      this.error.set(this.normalizeErrorMessage(error));
      this.diarizationModelExists.set(false);
      this.diarizationModelHasConfig.set(false);
      this.diarizationSetupVisible.set(true);
      if (showFeedback) {
        this.diarizationCheckMessage.set('モデル確認に失敗しました。ログを確認してください。');
        this.diarizationCheckIsError.set(true);
      }
    } finally {
      this.diarizationModelChecked.set(true);
      this.diarizationModelChecking.set(false);
    }
  }

  async devDeleteModels(): Promise<void> {
    this.devDeletingModels.set(true);
    this.devDeleteModelsResult.set(null);
    try {
      const target = this.devDeleteTarget();
      const result = await invoke<{ deleted: string[]; notFound: string[]; errors: string[] }>('dev_delete_downloaded_models', { target });
      this.devDeleteModelsResult.set(result);
      await this.checkAllSetupStatus();
    } catch (e) {
      this.devDeleteModelsResult.set({ deleted: [], notFound: [], errors: [String(e)] });
    } finally {
      this.devDeletingModels.set(false);
    }
  }

  async checkSegmentRetranscribeSupport(): Promise<void> {
    if (!this.isTauriRuntime()) {
      this.segmentRetranscribeSupported.set(false);
      return;
    }
    try {
      const available = await invoke<boolean>('check_segment_retranscribe_available');
      this.ngZone.run(() => this.segmentRetranscribeSupported.set(available === true));
    } catch {
      this.ngZone.run(() => this.segmentRetranscribeSupported.set(false));
    }
  }

  async checkEditorVoiceInputPackStatus(): Promise<void> {
    if (!this.isTauriRuntime()) {
      this.editorVoiceInputPackStatus.set({
        installed: false,
        cpuBackendRequired: this.editorOnlyBuild,
        cpuBackend: false,
        cpuBackendExpectedPath: '',
        gemmaGguf: false,
        gemmaGgufExpectedPath: '',
        mmprojGguf: false,
        mmprojGgufExpectedPath: '',
        ffmpegRequired: this.editorOnlyBuild,
        ffmpeg: false,
        ffmpegExpectedPath: '',
      });
      this.editorVoiceInputPackChecked.set(true);
      return;
    }
    try {
      const status = await invoke<EditorVoiceInputPackStatus>('check_editor_voice_input_pack_status');
      this.ngZone.run(() => {
        this.editorVoiceInputPackStatus.set(status);
        this.editorVoiceInputPackChecked.set(true);
      });
    } catch {
      this.ngZone.run(() => {
        this.editorVoiceInputPackStatus.set(null);
        this.editorVoiceInputPackChecked.set(true);
      });
    }
  }

  async checkEditorInstalledMemory(): Promise<void> {
    if (!this.editorOnlyBuild || !this.isTauriRuntime()) {
      this.editorInstalledMemoryBytes.set(null);
      this.editorInstalledMemoryChecked.set(true);
      return;
    }
    try {
      const bytes = await invoke<number | null>('get_installed_memory_bytes');
      this.ngZone.run(() => {
        this.editorInstalledMemoryBytes.set(typeof bytes === 'number' && Number.isFinite(bytes) ? bytes : null);
        this.editorInstalledMemoryChecked.set(true);
      });
    } catch {
      this.ngZone.run(() => {
        this.editorInstalledMemoryBytes.set(null);
        this.editorInstalledMemoryChecked.set(true);
      });
    }
  }

  private async ensureEditorVoiceInputPackProgressListener(): Promise<void> {
    if (!this.isTauriRuntime() || this.voiceInputPackProgressUnlisten) return;
    this.voiceInputPackProgressUnlisten = await listen<SetupProgressEvent>('voice-input-pack-progress', (event) => {
      const p = event.payload;
      this.editorVoiceInputPackProgressMap.update((m) => ({ ...m, [p.component]: p }));
    });
  }

  async installEditorVoiceInputPack(): Promise<void> {
    if (this.editorVoiceInputPackInstalling()) return;
    if (this.editorOnlyBuild
      && this.editorVoiceInputMemoryTier() === 'low'
      && !this.editorLowMemoryVoiceInputOptIn()) {
      this.openConfirmDialog({
        actionKind: 'installVoiceInputPackLowMemory',
        title: 'メモリ容量の確認',
        message: 'このPCはメモリが少ないため、音声入力の利用は推奨しません。使用時に処理が遅くなったり、メモリ不足で失敗したりする可能性があります。それでもダウンロードしますか？',
        confirmLabel: '理解してダウンロード',
        cancelLabel: 'キャンセル',
        confirmColor: 'warn',
        cancelColor: null,
      });
      return;
    }
    await this.performInstallEditorVoiceInputPack();
  }

  enableEditorVoiceInputForLowMemory(): void {
    if (!this.editorOnlyBuild || this.editorVoiceInputMemoryTier() !== 'low' || this.editorLowMemoryVoiceInputOptIn()) {
      return;
    }
    this.openConfirmDialog({
      actionKind: 'enableVoiceInputLowMemory',
      title: 'メモリ容量の確認',
      message: 'このPCはメモリが少ないため、音声入力の利用は推奨しません。使用時に処理が遅くなったり、メモリ不足で失敗したりする可能性があります。それでも音声入力を有効にしますか？',
      confirmLabel: '理解して有効にする',
      cancelLabel: 'キャンセル',
      confirmColor: 'warn',
      cancelColor: null,
    });
  }

  private async performInstallEditorVoiceInputPack(): Promise<void> {
    this.editorVoiceInputPackInstalling.set(true);
    this.editorVoiceInputPackDeleteResult.set(null);
    this.editorVoiceInputPackProgressMap.set({});
    this.voiceInputError.set('');
    try {
      await this.ensureEditorVoiceInputPackProgressListener();
      const installed = await invoke<boolean>('install_editor_voice_input_pack');
      if (!installed) {
        this.editorVoiceInputPackProgressMap.update((m) => ({
          ...m,
          _error: { component: '_error', status: 'error', message: '音声入力パックの導入が完了しませんでした。' },
        }));
      }
    } catch (error) {
      this.editorVoiceInputPackProgressMap.update((m) => ({
        ...m,
        _error: { component: '_error', status: 'error', message: this.normalizeErrorMessage(error) },
      }));
    } finally {
      this.editorVoiceInputPackInstalling.set(false);
      await this.checkEditorVoiceInputPackStatus();
      void this.checkSegmentRetranscribeSupport();
    }
  }

  private loadEditorLowMemoryVoiceInputOptIn(): void {
    if (!this.editorOnlyBuild) return;
    try {
      this.editorLowMemoryVoiceInputOptIn.set(
        window.localStorage.getItem(this.editorLowMemoryVoiceInputOptInStorageKey) === '1'
      );
    } catch {
      this.editorLowMemoryVoiceInputOptIn.set(false);
    }
  }

  private persistEditorLowMemoryVoiceInputOptIn(): void {
    this.editorLowMemoryVoiceInputOptIn.set(true);
    try {
      window.localStorage.setItem(this.editorLowMemoryVoiceInputOptInStorageKey, '1');
    } catch {
      // 保存できない場合も、現在の起動中は明示的な同意を有効として扱う。
    }
  }

  async devDeleteEditorVoiceInputPack(): Promise<void> {
    if (!this.editorVoiceInputDevControlsVisible() || this.editorVoiceInputPackDeleting()) return;
    const ok = window.confirm(
      this.editorOnlyBuild
        ? 'llama.cpp CPU バックエンドと mmproj、ダウンロード済み ffmpeg を削除します。Gemma 4 E4B 本体GGUFは削除しません。'
        : 'mmprojを削除します。Gemma 4 E4B 本体GGUFは削除しません。'
    );
    if (!ok) return;
    this.editorVoiceInputPackDeleting.set(true);
    this.editorVoiceInputPackDeleteResult.set(null);
    this.editorVoiceInputPackProgressMap.set({});
    this.voiceInputError.set('');
    try {
      const result = await invoke<DeleteModelsResponse>('dev_delete_editor_voice_input_pack');
      this.editorVoiceInputPackDeleteResult.set(result);
    } catch (error) {
      this.editorVoiceInputPackDeleteResult.set({
        deleted: [],
        notFound: [],
        errors: [this.normalizeErrorMessage(error)],
      });
    } finally {
      this.editorVoiceInputPackDeleting.set(false);
      await this.checkEditorVoiceInputPackStatus();
      void this.checkSegmentRetranscribeSupport();
    }
  }

  editorVoiceInputPackComponentProgress(component: string): SetupProgressEvent | null {
    return this.editorVoiceInputPackProgressMap()[component] ?? null;
  }

  editorVoiceInputPackComponentPercent(component: string): number | null {
    const progress = this.editorVoiceInputPackComponentProgress(component);
    if (!progress || !Number.isFinite(progress.totalBytes) || Number(progress.totalBytes) <= 0) {
      return null;
    }
    const downloaded = Math.max(0, Number(progress.downloadedBytes ?? 0));
    const total = Math.max(1, Number(progress.totalBytes));
    return Math.max(0, Math.min(100, (downloaded / total) * 100));
  }

  async checkAllSetupStatus(): Promise<void> {
    if (!this.isTauriRuntime()) {
      this.allSetupStatus.set({
        whisperTurbo: true,
        diarization: true,
        diarizationExpectedPath: '',
        gemmaGguf: true,
        gemmaGgufExpectedPath: '',
        gemmaMtpGguf: true,
        gemmaMtpGgufExpectedPath: '',
        llmBackend: true,
        pythonEnv: true,
        pythonEnvExpectedPath: '',
      });
      this.llmGpuBackendInstalled.set(true);
      this.allSetupChecked.set(true);
      this.diarizationModelChecked.set(true);
      this.diarizationModelExists.set(true);
      this.diarizationModelHasConfig.set(true);
      this.diarizationSetupVisible.set(false);
      return;
    }
    try {
      const status = await invoke<AllSetupStatus>('check_all_setup_status');
      this.ngZone.run(() => {
        this.allSetupStatus.set(status);
        this.llmGpuBackendInstalled.set(status.llmBackend);
        this.diarizationModelExists.set(status.diarization);
        this.diarizationModelHasConfig.set(status.diarization);
        this.diarizationModelExpectedPath.set(status.diarizationExpectedPath);
        this.diarizationSetupVisible.set(!status.diarization);
      });
    } catch (error) {
      this.ngZone.run(() => {
        this.allSetupStatus.set(null);
        this.diarizationModelExists.set(false);
        this.diarizationModelHasConfig.set(false);
        this.diarizationSetupVisible.set(true);
      });
    } finally {
      this.ngZone.run(() => {
        this.allSetupChecked.set(true);
        this.diarizationModelChecked.set(true);
      });
    }
  }

  async onRecheckAllSetupStatus(): Promise<void> {
    await this.checkAllSetupStatus();
    await this.checkTranscriptionRuntimeSupport();
    this.activeTabIndex.set(0);
  }

  /**
   * Hugging Face アクセストークンの形式を送信前にチェックする。
   * 明らかな打ち間違い・貼り付けミス（途中切れ・空白混入・接頭辞違い）を
   * ダウンロード実行前に弾き、ユーザーが原因を切り分けやすくする。
   * 問題なければ null、問題があればユーザー向けの説明文字列を返す。
   */
  validateHfTokenFormat(rawToken: string): string | null {
    const token = (rawToken ?? '').trim();
    if (!token) return null; // 未入力は別経路（スキップ）で扱う

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

  async runFullSetup(): Promise<void> {
    if (this.setupRunning()) return;

    // 話者分離トークンの形式チェック（送信前に明らかな打ち間違いを弾く）
    let tokenForValidation = this.diarizationInstallToken().trim();
    if (tokenForValidation) {
      const tokenError = this.validateHfTokenFormat(tokenForValidation);
      if (tokenError) {
        this.setupProgressMap.set({
          diarization: { component: 'diarization', status: 'error', message: tokenError },
        });
        return;
      }
    }

    this.setupRunning.set(true);
    this.setupProgressMap.set({});
    try {
      const setupTask = invoke<boolean>('run_full_setup', {
        hfToken: tokenForValidation || null,
      });
      // invokeへ渡した直後に入力欄から除去し、長時間のモデル取得中に保持しない。
      this.diarizationInstallToken.set('');
      tokenForValidation = '';
      await setupTask;

      // GPU バックエンドのインストール（local_gguf モードかつ未インストールの場合）
      if (this.llmBackendMode() === 'local_gguf' && !this.allSetupStatus()?.llmBackend) {
        // GPU 種別に応じてバックエンドを選択。AMD は ROCm を主経路、Vulkan を ROCm 不可時
        // （Windows AMD・system ROCm 無し Linux AMD 等）のフォールバックとして両方取得する。
        // 先頭が主バックエンド（必須）、以降はフォールバック（任意・失敗しても続行）。
        const gpuBackends = this.cudaAvailable() ? ['llamacpp:vulkan']
          : this.rocmAvailable() ? ['llamacpp:rocm', 'llamacpp:vulkan']
          : ['llamacpp:cpu'];
        const backendLabel = (b: string) => b === 'llamacpp:vulkan' ? 'Vulkan'
          : b === 'llamacpp:rocm' ? 'AMD GPU (ROCm)'
          : 'CPU';

        this.setupProgressMap.update(m => ({
          ...m,
          llm_backend: { component: 'llm_backend', status: 'downloading', message: 'AI校正エンジンを準備中...' },
        }));
        try {
          await this.startLlm();
        } catch (e) {
          this.setupProgressMap.update(m => ({
            ...m,
            llm_backend: { component: 'llm_backend', status: 'error', message: 'AI校正エンジンの準備に失敗しました: ' + this.normalizeErrorMessage(e) },
          }));
          return;
        }

        const unlisten = await listen<{ message: string }>(
          'llm-backend-install-progress',
          (ev) => this.setupProgressMap.update(m => ({
            ...m,
            llm_backend: { component: 'llm_backend', status: 'downloading', message: ev.payload.message },
          })),
        );
        try {
          // 主バックエンド（必須）。
          this.setupProgressMap.update(m => ({
            ...m,
            llm_backend: { component: 'llm_backend', status: 'downloading', message: `${backendLabel(gpuBackends[0])} バックエンドをダウンロード中...` },
          }));
          await invoke('install_llm_backend', { backend: gpuBackends[0] });
          // フォールバック（任意。失敗しても主経路で動くので続行する）。
          for (const fb of gpuBackends.slice(1)) {
            try {
              this.setupProgressMap.update(m => ({
                ...m,
                llm_backend: { component: 'llm_backend', status: 'downloading', message: `${backendLabel(fb)} バックエンド（フォールバック）をダウンロード中...` },
              }));
              await invoke('install_llm_backend', { backend: fb });
            } catch (e) {
              console.warn(`フォールバックバックエンド ${fb} の取得に失敗しました（主経路は利用可能）:`, this.normalizeErrorMessage(e));
            }
          }
          this.setupProgressMap.update(m => ({
            ...m,
            llm_backend: { component: 'llm_backend', status: 'done', message: 'インストール完了' },
          }));
        } catch (e) {
          this.setupProgressMap.update(m => ({
            ...m,
            llm_backend: { component: 'llm_backend', status: 'error', message: this.normalizeErrorMessage(e) },
          }));
        } finally {
          unlisten();
        }
      }
    } catch (error) {
      const msg = this.normalizeErrorMessage(error);
      this.setupProgressMap.update(m => ({
        ...m,
        _error: { component: '_error', status: 'error', message: msg },
      }));
    } finally {
      // アクセストークンはダウンロード処理にだけ使い、成功・失敗にかかわらず
      // Angular の状態と入力欄に保持し続けない。
      this.ngZone.run(() => {
        this.diarizationInstallToken.set('');
        this.setupRunning.set(false);
      });
      await this.checkAllSetupStatus();
      await this.checkTranscriptionRuntimeSupport();
      this.ngZone.run(() => {
        this.activeTabIndex.set(0);
      });
      if (this.allSetupStatus()?.gemmaGguf) {
        await this.initDefaultLlmModelPath();
      }
    }
  }

  private setupProgressUnlisten: (() => void) | null = null;

  private async ensureSetupProgressListener(): Promise<void> {
    if (!this.isTauriRuntime() || this.setupProgressUnlisten) return;
    this.setupProgressUnlisten = await listen<SetupProgressEvent>('setup_progress', (event) => {
      const p = event.payload;
      this.setupProgressMap.update(m => ({ ...m, [p.component]: p }));
    });
  }

  async checkTranscriptionRuntimeSupport(): Promise<void> {
    if (this.editorOnlyBuild) {
      this.transcriptionTabVisible.set(false);
      this.transcriptionRuntimeAvailable.set(false);
      this.activeTabIndex.set(this.getReaderTabIndex());
      this.transcriptionRuntimeReason.set('編集専用版のため、文字起こし機能は利用できません。');
      return;
    }

    if (!this.isTauriRuntime()) {
      this.transcriptionTabVisible.set(false);
      this.transcriptionRuntimeAvailable.set(false);
      this.activeTabIndex.set(0);
      this.transcriptionRuntimeReason.set('GPU が確認できないため、文字起こし機能は利用できません。');
      return;
    }

    try {
      const status = await invoke<TranscriptionRuntimeStatusResponse>('check_transcription_runtime_support');
      this.ngZone.run(() => {
        this.transcriptionTabVisible.set(true);
        this.transcriptionRuntimeAvailable.set(status.available === true);
        this.activeTabIndex.set(0);
        this.transcriptionRuntimeReason.set(status.available ? '' : (status.reason ?? 'GPU が確認できないため、文字起こし機能は利用できません。'));
      });
    } catch (error) {
      this.ngZone.run(() => {
        this.transcriptionTabVisible.set(true);
        this.transcriptionRuntimeAvailable.set(false);
        this.activeTabIndex.set(0);
        this.transcriptionRuntimeReason.set('GPU 確認に失敗したため、文字起こし機能は利用できません。');
      });
    }
  }

  onTabIndexChange(index: number): void {
    this.activeTabIndex.set(index);
    if (index === this.getSettingsTabIndex()) {
      void this.loadLlmModels();
      void this.checkEditorVoiceInputPackStatus();
    }
    requestAnimationFrame(this._refreshSegmentTableInView);
  }

  private getImportCompletedMessage(): string {
    return this.canShowTranscriptionTab()
      ? '読み取りが完了しました。文字起こしタブでも編集できます。'
      : '読み取りが完了しました。';
  }

  async openExternalUrl(url: string): Promise<void> {
    try {
      if (this.isTauriRuntime()) {
        await invoke('open_external_url', { url });
      } else {
        window.open(url, '_blank', 'noopener,noreferrer');
      }
    } catch (error) {
      this.error.set(this.normalizeErrorMessage(error));
    }
  }

  async openDiarizationConsentPage(): Promise<void> {
    try {
      if (this.isTauriRuntime()) {
        await invoke('open_external_url', {
          url: 'https://huggingface.co/pyannote/speaker-diarization-community-1'
        });
      } else {
        window.open('https://huggingface.co/pyannote/speaker-diarization-community-1', '_blank', 'noopener,noreferrer');
      }
    } catch (error) {
      this.error.set(this.normalizeErrorMessage(error));
    }
  }

  async openHuggingFaceTokenPage(): Promise<void> {
    try {
      if (this.isTauriRuntime()) {
        await invoke('open_external_url', {
          url: 'https://huggingface.co/settings/tokens'
        });
      } else {
        window.open('https://huggingface.co/settings/tokens', '_blank', 'noopener,noreferrer');
      }
    } catch (error) {
      this.error.set(this.normalizeErrorMessage(error));
    }
  }

  private startRunningTicker(): void {
    this.stopRunningTicker();
    this.runningTickerId = setInterval(() => {
      this.runningSeconds.set(this.runningSeconds() + 1);
    }, 1000);
  }

  private stopRunningTicker(): void {
    if (this.runningTickerId !== null) {
      clearInterval(this.runningTickerId);
      this.runningTickerId = null;
    }
  }

  // 表示用の進捗を 1000ms ごとに滑らかに前進させる（表示専用。Python/Rust 側の処理には一切触れない）。
  // - バックエンドからの離散イベント（runningProgress）を「後退しない」アンカーとして尊重する
  // - 概算所要時間が分かるときは 経過時間/概算 で滑らかに進める（イベントが疎でも止まって見えない）
  // - 概算が無いときは上限に向けて減速トリックルし、常に少しずつ動かす
  private startSmoothProgress(): void {
    this.stopSmoothProgress();
    this.displayProgress.set(0);
    this.activeRunEstimatedSeconds = this.estimatedAvgSeconds();
    this.smoothProgressTickerId = setInterval(() => this.updateSmoothProgress(), 1000);
  }

  private stopSmoothProgress(): void {
    if (this.smoothProgressTickerId !== null) {
      clearInterval(this.smoothProgressTickerId);
      this.smoothProgressTickerId = null;
    }
  }

  private updateSmoothProgress(): void {
    if (!this.running()) {
      return;
    }
    const real = this.runningProgress();
    const shown = this.displayProgress();
    // バックエンド値より後退させない。
    let target = Math.max(shown, real);
    const est = this.activeRunEstimatedSeconds;
    if (est && est > 0) {
      // 経過時間ベースの推定進捗。実完了イベントで前進する余地を残して 95% で頭打ちにする。
      const timePct = Math.min(95, (this.runningSeconds() / est) * 100);
      if (timePct > target) {
        target = timePct;
      }
    } else if (target < 90) {
      // 概算が無い初回時などのフォールバック：上限へ向けて減速しながら必ず少し動かす。
      target = target + (90 - target) * 0.025;
    }
    // 実際に完了するまで 100% は出さない。
    if (real < 100) {
      target = Math.min(target, 99);
    }
    this.displayProgress.set(target);
  }

  private startProofreadTicker(): void {
    this.stopProofreadTicker();
    this.proofreadTickerId = setInterval(() => {
      this.proofreadRunningSeconds.set(this.proofreadRunningSeconds() + 1);
      this.updateProofreadRunningStatus();
    }, 1000);
  }

  private stopProofreadTicker(): void {
    if (this.proofreadTickerId !== null) {
      clearInterval(this.proofreadTickerId);
      this.proofreadTickerId = null;
    }
  }

  private startDiarizationTicker(): void {
    this.stopDiarizationTicker();
    this.diarizationTickerId = setInterval(() => {
      this.diarizationRunningSeconds.set(this.diarizationRunningSeconds() + 1);
      this.updateDiarizationRunningStatus();
    }, 1000);
  }

  private stopDiarizationTicker(): void {
    if (this.diarizationTickerId !== null) {
      clearInterval(this.diarizationTickerId);
      this.diarizationTickerId = null;
    }
  }

  private startLlmProofreadTicker(): void {
    this.stopLlmProofreadTicker();
    this.llmProofreadTickerId = setInterval(() => {
      this.llmProofreadRunningSeconds.set(this.llmProofreadRunningSeconds() + 1);
    }, 1000);
  }

  private stopLlmProofreadTicker(): void {
    if (this.llmProofreadTickerId !== null) {
      clearInterval(this.llmProofreadTickerId);
      this.llmProofreadTickerId = null;
    }
  }

  private updateProofreadRunningStatus(): void {
    if (!this.proofreadRunning() || this.proofreadCanceling()) {
      return;
    }
    const elapsed = this.proofreadRunningSeconds();
    this.proofreadStatus.set(`校正を実行中... ${elapsed}秒`);
  }

  private updateDiarizationRunningStatus(): void {
    if (!this.diarizationRunning() || this.diarizationCanceling()) {
      return;
    }
    const elapsed = this.diarizationRunningSeconds();
    this.diarizationStatus.set(`話者分離を実行中... ${elapsed}秒`);
  }

  private async ensureProgressListener(): Promise<void> {
    if (!this.isTauriRuntime()) {
      return;
    }
    if (this.progressUnlisten) {
      return;
    }
    this.progressUnlisten = await listen<{ stage?: string; message?: string; progress?: number; current?: number; total?: number }>(
      'transcription-progress',
      (event) => {
        if (!this.running() && !this.diarizationRunning() && !this.proofreadRunning() && !this.llmProofreadRunning()) {
          return;
        }
        const payload = event.payload ?? {};
        const stage = typeof payload.stage === 'string' ? payload.stage : '';

        if (this.llmProofreadRunning()) {
          if (stage === 'llm_loading' || stage === 'llm_sidecar_start') {
            const current = typeof (payload as any).current === 'number' ? (payload as any).current : 0;
            const total = typeof (payload as any).total === 'number' ? (payload as any).total : 0;
            if (current > 0 && total > 0) {
              const displayCurrent = current + this.llmProgressOffset;
              const displayTotal = total + this.llmProgressOffset;
              this.llmProofreadStatus.set(`校正中: ${displayCurrent} / ${displayTotal} 行`);
            } else if (total === 0 && typeof payload.message === 'string' && payload.message.length > 0) {
              // total なしのメッセージイベント（接続中・モデル読み込み等）のみ表示する。
              // total > 0 かつ current=0 のケース（バッチ開始直前）は既存の準備中表示を維持する。
              this.llmProofreadStatus.set(payload.message);
            }
            return;
          } else if (stage === 'batch_start') {
            const ids: number[] = Array.isArray((payload as any).segmentIds) ? (payload as any).segmentIds : [];
            const statusMap = { ...this.llmSegmentStatus() };
            for (const id of ids) statusMap[Number(id)] = 'processing';
            this.llmSegmentStatus.set(statusMap);
            return;
          } else if (stage === 'batch_result') {
            const items: any[] = Array.isArray((payload as any).items) ? (payload as any).items : [];
            const current = typeof (payload as any).current === 'number' ? (payload as any).current : 0;
            const total = typeof (payload as any).total === 'number' ? (payload as any).total : 0;
            this.applyLlmBatchResult(items);
            if (current > 0 && total > 0) {
              const displayCurrent = current + this.llmProgressOffset;
              const displayTotal = total + this.llmProgressOffset;
              this.llmProofreadStatus.set(`校正中: ${displayCurrent} / ${displayTotal} 行`);
            }
            return;
          } else if (stage === 'llm_batch_debug') {
            // console.log('[Lemonade][BATCH DEBUG]', payload);
            return;
          } else if (stage === 'llm_batch_raw_preview') {
            // console.warn('[Lemonade][BATCH RAW PREVIEW]', payload);
            return;
          } else if (stage === 'llm_batch_debug') {
            // const backend = typeof (payload as any).backend === 'string' ? (payload as any).backend : 'unknown';
            // console.log(`[LLM Batch][${backend}]`, payload);
            return;
          } else if (stage === 'llm_batch_raw_preview') {
            // const backend = typeof (payload as any).backend === 'string' ? (payload as any).backend : 'unknown';
            // console.warn(`[LLM Batch RAW][${backend}]`, payload);
            return;
          } else if (stage === 'llm_sidecar_debug') {
            // console.log('[LLM Sidecar][DEBUG]', payload);
            return;
          }
          // LLM固有ステージ以外（whisper進捗など）はそのまま通過
        }


        if (this.proofreadRunning() && !this.running() && !this.diarizationRunning()) {
          if (stage === 'proofread_segment_progress') {
            const current = typeof payload.current === 'number' ? payload.current : 0;
            const total = typeof payload.total === 'number' ? payload.total : 0;
            if (current > 0 && total > 0) {
              this.proofreadProgressText.set(`${current} / ${total} 行`);
            }
          }
          return;
        }
        const isDiarizationOnly = this.diarizationRunning() && !this.running();

        if (isDiarizationOnly) {
          if (typeof payload.message === 'string' && payload.message.length > 0) {
            this.diarizationStatus.set(payload.message);
          }
          return;
        }

        // 継次処理での話者分離フェーズ検出（進捗スナックバー用）
        if (stage === 'diarization_loading') {
          this.diarizationPhaseActive.set(true);
          this.diarizationStage.set('読み込み中');
        } else if (stage === 'diarization_running') {
          this.diarizationPhaseActive.set(true);
          this.diarizationStage.set('実行中');
        } else if (stage === 'diarization_done') {
          this.diarizationPhaseActive.set(true);
          this.diarizationStage.set('完了');
        }

        const step = this.resolveStepForStage(stage);
        if (step > 0) {
          this.runningStepCurrent.set(Math.max(this.runningStepCurrent(), step));
        }
        const isRetryStage =
          stage.includes('retry') || stage.includes('fallback') || stage.includes('diarization_fallback');
        if (isRetryStage) {
          this.hadRetryInCurrentRun.set(true);
        }

        if (typeof payload.progress === 'number') {
          const current = this.runningProgress();
          const next = Math.floor(payload.progress);
          let shown = Math.max(current, next);
          if (this.hadRetryInCurrentRun() && shown >= 100) {
            shown = 99;
          }
          this.runningProgress.set(shown);
        }

        if (typeof payload.message === 'string' && payload.message.length > 0) {
          if (stage === 'compute_plan' || stage === 'compute_switch' || stage.startsWith('sidecar_')) {
            const matched = payload.message.match(/（(auto|float16|float32|int8_float16|int8)/i);
            if (matched?.[1]) {
              this.runningComputeType.set(matched[1].toLowerCase());
            } else if (stage === 'compute_plan') {
              const matched2 = payload.message.match(/計算方式:\s*(auto|float16|float32|int8_float16|int8)/i);
              if (matched2?.[1]) {
                this.runningComputeType.set(matched2[1].toLowerCase());
              }
            }
          }
          const retrySuffix = isRetryStage ? '（再試行中）' : '';
          const doneLike = stage.endsWith('_done') || payload.message.includes('完了');
          const message = doneLike && this.hadRetryInCurrentRun()
            ? '再試行が発生しました。最終結果を確認しています...'
            : payload.message;
          this.runningStatus.set(`${message}${retrySuffix}`);
        }
      }
    );

    this.parallelDiarUnlisten = await listen<{ stage?: string; message?: string }>(
      'parallel-diarization-progress',
      (event) => {
        if (!this.running()) return;
        const payload = event.payload ?? {};
        if (typeof payload.message === 'string' && payload.message.length > 0) {
          this.parallelDiarizationStatus.set(payload.message);
        }
        if (payload.stage === 'diarization_done') {
          this.parallelDiarizationStatus.set('話者分離完了');
        }
      }
    );
  }

  private getProgressStageOrder(): ReadonlyArray<string> {
    if (this.diarization()) {
      // 並列処理のため文字起こしサブ工程は表示しない。話者分離の流れのみ表示。
      return ['sidecar_running', 'diarization_loading', 'diarization_running', 'diarization_done', 'done'];
    }
    return ['sidecar_running', 'model_loading', 'transcribing', 'postprocess', 'done'];
  }

  private resolveStepForStage(stage: string): number {
    if (!stage) {
      return 0;
    }
    const order = this.getProgressStageOrder();
    const commonAliases: Record<string, string> = {
      preparing: 'sidecar_running',
      compute_plan: 'sidecar_running',
      compute_switch: 'sidecar_running',
      sidecar_start: 'sidecar_running',
      sidecar_retry_start: 'sidecar_running',
      sidecar_retry_running: 'sidecar_running',
    };
    const diarizationAliases: Record<string, string> = {
      diarization_start: 'sidecar_running',
      diarization_waiting: 'diarization_loading',
      model_loading: 'sidecar_running',
      transcribing: 'sidecar_running',
      postprocess: 'sidecar_running',
      diarization_fallback: 'diarization_running',
    };
    const aliases = this.diarization()
      ? { ...commonAliases, ...diarizationAliases }
      : commonAliases;
    const canonical = aliases[stage] ?? stage;
    const idx = order.indexOf(canonical);
    return idx >= 0 ? idx + 1 : 0;
  }

  private hasFallbackInResult(result: TranscriptionResult): boolean {
    if (result.fallbackUsed) {
      return true;
    }
    return !!result.diarization?.note && result.diarization.note.includes('フォールバック');
  }

  get uniqueSpeakers(): ReadonlyArray<string> {
    return this._uniqueSpeakersComputed();
  }

  get speakerOptions(): ReadonlyArray<string> {
    return this.uniqueSpeakers;
  }

  speakerOptionLabel(key: string): string {
    const alias = this.displaySpeaker(key);
    return alias === key ? key : `${alias} (${key})`;
  }

  trackBySegmentId(_index: number, segment: TranscriptionSegment): number {
    return segment.id;
  }

  getSpeakerColorClass(speakerKey: string): string {
    const m = speakerKey.match(/^SPEAKER_(\d+)$/);
    if (!m) return '';
    return `speaker-color-${Math.min(parseInt(m[1], 10), 4) + 1}`;
  }

  setSpeakerAlias(source: string, value: string): void {
    const next = { ...this.speakerAliasMap() };
    if (value.trim().length === 0) {
      delete next[source];
    } else {
      next[source] = value.trim();
    }
    this.speakerAliasMap.set(next);
  }

  displaySpeaker(source: string | null | undefined): string {
    if (!source) {
      return '-';
    }
    const alias = this.speakerAliasMap()[source];
    return alias && alias.length > 0 ? alias : source;
  }

  getAssignedSpeakerKey(segment: TranscriptionSegment): string {
    const assigned = this.normalizeSpeakerKey(this.selectedSpeakerBySegmentId()[segment.id]);
    if (typeof assigned === 'string') {
      return assigned;
    }
    return this.normalizeSpeakerKey(segment.speaker);
  }

  setAssignedSpeaker(segmentId: number, speakerKey: string): void {
    const next = { ...this.selectedSpeakerBySegmentId() };
    next[segmentId] = this.normalizeSpeakerKey(speakerKey);
    this.selectedSpeakerBySegmentId.set(next);
  }

  private normalizeSpeakerKey(value: string | null | undefined): string {
    return (value ?? '').trim();
  }

  formatMinuteSecond(seconds: number): string {
    const totalSec = Math.max(0, Math.floor(seconds));
    const min = Math.floor(totalSec / 60);
    const sec = totalSec % 60;
    const mm = String(min).padStart(2, '0');
    const ss = String(sec).padStart(2, '0');
    return `${mm}:${ss}`;
  }

  formatElapsedMinuteSecond(seconds: number): string {
    const totalSec = Math.max(0, Math.floor(seconds));
    const min = Math.floor(totalSec / 60);
    const sec = totalSec % 60;
    return `${min}分${sec}秒`;
  }

  isSegmentPlaying(segmentId: number): boolean {
    return this.playingSegmentId() === segmentId;
  }

  isSegmentLooping(segmentId: number): boolean {
    return this.isSegmentPlaying(segmentId) && this.previewLoopEnabled;
  }

  isSegmentSinglePlaying(segmentId: number): boolean {
    return this.isSegmentPlaying(segmentId) && !this.previewLoopEnabled;
  }

  async playSegment(
    segment: TranscriptionSegment,
    textInputEl?: HTMLInputElement | HTMLTextAreaElement
  ): Promise<void> {
    await this.startSegmentPlayback(segment, true, textInputEl);
  }

  async playSegmentOnce(
    segment: TranscriptionSegment,
    textInputEl?: HTMLInputElement | HTMLTextAreaElement
  ): Promise<void> {
    await this.startSegmentPlayback(segment, false, textInputEl);
  }

  private async startSegmentPlayback(
    segment: TranscriptionSegment,
    loopEnabled: boolean,
    textInputEl?: HTMLInputElement | HTMLTextAreaElement
  ): Promise<void> {
    const path = this.selectedAudioPath();
    if (!path) {
      this.error.set('音声ファイルを選択してください。');
      return;
    }

    const audio = this.getOrCreatePreviewAudio();
    const src = await this.resolvePlayableAudioSrc(path);
    const start = Math.max(0, segment.start);
    const end = Math.max(start + 0.1, segment.end);
    const currentPlayingId = this.playingSegmentId();

    if (currentPlayingId !== null && currentPlayingId !== segment.id) {
      this.stopSegmentPlayback();
    }

    if (this.isSegmentPlaying(segment.id) && this.previewLoopEnabled === loopEnabled) {
      this.stopSegmentPlayback();
      return;
    }

    textInputEl?.focus();

    this.previewLoopEnabled = loopEnabled;
    if (loopEnabled) {
      this.previewSequenceSegmentIds = [];
      this.previewSequenceIndex = -1;
    } else {
      const ids = this.segmentRows.map((v) => v.id);
      const idx = ids.indexOf(segment.id);
      this.previewSequenceSegmentIds = idx >= 0 ? ids.slice(idx) : [segment.id];
      this.previewSequenceIndex = 0;
    }
    this.previewStartSeconds = start;
    this.previewEndSeconds = end;
    this.setActivePlayingSegment(segment.id);
    this.openPlaybackSnackbar(loopEnabled);
    this.error.set('');

    const waitSeek = (target: number): Promise<void> =>
      new Promise<void>((resolve) => {
        const onSeeked = () => {
          audio.removeEventListener('seeked', onSeeked);
          clearTimeout(timer);
          resolve();
        };
        const timer = setTimeout(() => {
          audio.removeEventListener('seeked', onSeeked);
          resolve();
        }, 500);
        audio.addEventListener('seeked', onSeeked);
        audio.currentTime = target;
      });

    const gen = ++this.seekPlayGeneration;
    const seekAndPlay = async (): Promise<void> => {
      try {
        // Wait for seek to complete before play().
        // On Linux WebKitGTK, currentTime assignment is asynchronous and play()
        // called immediately would start at the wrong position.
        await waitSeek(start);
        // GStreamer sometimes fires 'seeked' before the pipeline actually moves.
        // Retry up to 3 times until position is within 0.5 s of the target.
        for (let i = 0; i < 3 && start > 0.5 && Math.abs(audio.currentTime - start) > 0.5; i++) {
          await waitSeek(start);
        }
      } catch {
        // ignore seek issue
      }
      // Abort if stop() was called or a newer play() request was issued while seeking.
      if (gen !== this.seekPlayGeneration) return;
      try {
        audio.playbackRate = this.playbackRate();
        await audio.play();
      } catch (e) {
        if (e instanceof DOMException && e.name === 'AbortError') {
          // Expected when pause() races play() — not a user-visible error.
          return;
        }
        this.setActivePlayingSegment(null, false);
        this.previewLoopEnabled = false;
        this.previewSequenceSegmentIds = [];
        this.previewSequenceIndex = -1;

        this.previewStartSeconds = null;
        this.previewEndSeconds = null;
        this.error.set(this.normalizeErrorMessage(e));
      }
    };

    if (this.lastLoadedAudioSrc !== src) {
      audio.pause();
      audio.src = src;
      this.lastLoadedAudioSrc = src;
      audio.load();
      if (audio.readyState >= 1) {
        await seekAndPlay();
      } else {
        audio.onloadedmetadata = () => {
          audio.onloadedmetadata = null;
          void seekAndPlay();
        };
      }
    } else if (audio.readyState < 1) {
      // Long idle can cause the browser to release audio buffers (readyState → 0).
      // Re-load before seeking; otherwise currentTime assignment is silently ignored
      // and playback starts from position 0.
      audio.load();
      audio.onloadedmetadata = () => {
        audio.onloadedmetadata = null;
        void seekAndPlay();
      };
    } else {
      await seekAndPlay();
    }
  }

  onPlaybackRateChange(rate: number): void {
    this.playbackRate.set(rate);
    if (this.previewAudio) {
      this.previewAudio.playbackRate = rate;
    }
    this.appSettings = { ...this.appSettings, playback: { rate } };
    this.persistAppSettings();
  }

  stopSegmentPlayback(): void {
    ++this.seekPlayGeneration;
    this.sequenceSnackBarRef?.dismiss();
    this.sequenceSnackBarRef = null;
    if (!this.previewAudio) {
      this.setActivePlayingSegment(null, false);
      this.previewLoopEnabled = false;
      this.previewSequenceSegmentIds = [];
      this.previewSequenceIndex = -1;

      this.previewStartSeconds = null;
      this.previewEndSeconds = null;
      return;
    }
    this.previewAudio.pause();
    this.setActivePlayingSegment(null, false);
    this.previewLoopEnabled = false;
    this.previewSequenceSegmentIds = [];
    this.previewSequenceIndex = -1;

    this.previewStartSeconds = null;
    this.previewEndSeconds = null;
  }

  private openPlaybackSnackbar(isLoop: boolean): void {
    this.sequenceSnackBarRef?.dismiss();
    this.sequenceSnackBarRef = this.snackBar.openFromComponent(PlaybackControlSnackbarComponent, {
      data: {
        playbackRateOptions: this.playbackRateOptions,
        playbackRate: this.playbackRate,
        onRateChange: (rate: number) => this.onPlaybackRateChange(rate),
        onStop: () => this.stopSegmentPlayback(),
        isLoop,
      },
      duration: 0,
      horizontalPosition: 'center',
      verticalPosition: 'bottom',
    });
  }

  private getOrCreatePreviewAudio(): HTMLAudioElement {
    if (this.previewAudio) {
      return this.previewAudio;
    }
    const audio = new Audio();
    audio.preload = 'auto';
    audio.ontimeupdate = () => {
      if (
        this.playingSegmentId() !== null
        && this.previewStartSeconds !== null
        && this.previewEndSeconds !== null
        && audio.currentTime >= this.previewEndSeconds
      ) {
        if (this.previewLoopEnabled) {
          try {
            audio.currentTime = this.previewStartSeconds;
          } catch {
            // ignore seek issue
          }
          return;
        }
        // pause なしで直接次セグメントへ seek — 同一ファイルなので瞬時に切り替わる
        const advanced = this.advanceSequencePlayback(audio);
        if (!advanced) {
          audio.pause();
          this.stopSegmentPlayback();
        }
      }
    };
    audio.onended = () => {
      if (this.playingSegmentId() !== null && this.previewLoopEnabled && this.previewStartSeconds !== null) {
        try {
          audio.currentTime = this.previewStartSeconds;
          void audio.play();
          return;
        } catch {
          // ignore restart issue
        }
      }
      // ファイル末尾に達した場合も即時切り替え
      const advanced = this.advanceSequencePlayback(audio);
      if (!advanced) {
        this.stopSegmentPlayback();
      }
    };
    audio.onerror = () => {
      this.setActivePlayingSegment(null, false);
      this.previewLoopEnabled = false;
      this.previewSequenceSegmentIds = [];
      this.previewSequenceIndex = -1;
  
      this.previewStartSeconds = null;
      this.previewEndSeconds = null;
      this.error.set('音声の再生に失敗しました。ファイル形式やパスを確認してください。');
    };
    this.previewAudio = audio;
    return audio;
  }

  private advanceSequencePlayback(audio: HTMLAudioElement): boolean {
    if (this.previewLoopEnabled) {
      return false;
    }
    if (this.previewSequenceSegmentIds.length === 0 || this.previewSequenceIndex < 0) {
      return false;
    }
    const nextIndex = this.previewSequenceIndex + 1;
    if (nextIndex >= this.previewSequenceSegmentIds.length) {
      return false;
    }
    const nextId = this.previewSequenceSegmentIds[nextIndex];
    const nextSegment = this.segmentRows.find((v) => v.id === nextId);
    if (!nextSegment) {
      this.previewSequenceIndex = nextIndex;
      return false;
    }

    this.previewSequenceIndex = nextIndex;
    const newStart = Math.max(0, nextSegment.start);
    const newEnd = Math.max(newStart + 0.1, nextSegment.end);
    this.setActivePlayingSegment(nextSegment.id);

    // Pause immediately so audio does not bleed past the segment boundary while seeking.
    // Clear previewEndSeconds first to prevent ontimeupdate from re-entering this method
    // before the seek completes.
    audio.pause();
    this.previewStartSeconds = newStart;
    this.previewEndSeconds = null;

    const gen = this.seekPlayGeneration;
    const waitSeek = new Promise<void>((resolve) => {
      const onSeeked = () => {
        audio.removeEventListener('seeked', onSeeked);
        clearTimeout(timer);
        resolve();
      };
      const timer = setTimeout(() => {
        audio.removeEventListener('seeked', onSeeked);
        resolve();
      }, 500);
      audio.addEventListener('seeked', onSeeked);
      audio.currentTime = newStart;
    });
    void waitSeek.then(() => {
      if (gen !== this.seekPlayGeneration) return;
      this.previewEndSeconds = newEnd;
      void audio.play();
    });
    return true;
  }


  private setActivePlayingSegment(segmentId: number | null, autoScroll = true): void {
    this.playingSegmentId.set(segmentId);
    if (segmentId === null || !autoScroll) {
      return;
    }
    const index = this.displayedSegmentRows.findIndex(s => s.id === segmentId);
    if (index >= 0) {
      const viewport = this.activeSegmentViewport;
      if (viewport) {
        this.scrollSegmentRowIntoCenter(viewport, segmentId, index, ++this.followScrollGeneration, 10);
      }
    }
  }

  /** 再生追従スクロールの世代。新しい追従要求が来たら進行中の補正ループを打ち切る。 */
  private followScrollGeneration = 0;

  /**
   * autosize 仮想スクロールは行高を実測平均で推定するため、index×固定行高の
   * オフセット計算では長いリストほど表示位置がズレる（50分音声・1200行超で約90行のズレを確認）。
   * 描画済みの行は実DOMの位置から正確に中央へ寄せ、未描画の行は推定総高さの比率で
   * 粗くジャンプしてから描画完了を待って実DOMで補正する。
   */
  private scrollSegmentRowIntoCenter(
    viewport: CdkVirtualScrollViewport,
    segmentId: number,
    index: number,
    generation: number,
    attemptsLeft: number,
  ): void {
    if (generation !== this.followScrollGeneration) {
      return;
    }
    const viewportEl = viewport.elementRef.nativeElement;
    const rowEl = viewportEl.querySelector<HTMLElement>(`#segment-row-${segmentId}`);
    if (rowEl) {
      const viewportRect = viewportEl.getBoundingClientRect();
      const rowRect = rowEl.getBoundingClientRect();
      const delta = (rowRect.top + rowRect.height / 2) - (viewportRect.top + viewportRect.height / 2);
      if (Math.abs(delta) > 1) {
        viewport.scrollToOffset(Math.max(0, viewport.measureScrollOffset() + delta), 'smooth');
      }
      return;
    }
    if (attemptsLeft <= 0) {
      return;
    }
    const total = this.displayedSegmentRows.length;
    if (total > 0) {
      const estimatedOffset =
        (viewportEl.scrollHeight * (index + 0.5)) / total - viewportEl.clientHeight / 2;
      viewport.scrollToOffset(Math.max(0, estimatedOffset), 'auto');
    }
    requestAnimationFrame(() =>
      this.scrollSegmentRowIntoCenter(viewport, segmentId, index, generation, attemptsLeft - 1),
    );
  }

  private audioStreamInfo: { port: number; token: string } | null = null;

  private async resolvePlayableAudioSrc(path: string): Promise<string> {
    if (!this.isTauriRuntime()) {
      return path;
    }
    // Serve audio via a local HTTP server that supports Range requests.
    // GStreamer (WebKitGTK media backend) requires http:// for seeking;
    // blob:// URLs don't support Range requests and cause wrong-position playback.
    if (this.audioStreamInfo === null) {
      this.audioStreamInfo = await invoke<{ port: number; token: string }>('get_audio_stream_info');
    }
    await invoke('set_audio_allowed_path', { path });
    return `http://127.0.0.1:${this.audioStreamInfo.port}/${encodeURIComponent(path)}?token=${this.audioStreamInfo.token}`;
  }

  private revokePreviewObjectUrl(): void {
    // No-op: blob URL approach replaced by HTTP streaming server.
  }

  private async updateSelectedAudioFileSizeFromPath(path: string): Promise<void> {
    if (!this.isTauriRuntime()) {
      this.selectedAudioFileSizeBytes.set(null);
      return;
    }
    try {
      const response = await invoke<ReadFileSizeResponse>('read_file_size', {
        request: { path }
      });
      const size = Number(response.sizeBytes);
      this.selectedAudioFileSizeBytes.set(Number.isFinite(size) && size >= 0 ? size : null);
    } catch {
      this.selectedAudioFileSizeBytes.set(null);
    }
  }

  private escapeCsvValue(value: string): string {
    const trimmed = value.trim();
    const isNumeric = /^-?\d+(\.\d+)?$/.test(trimmed);
    const escaped = value.replace(/"/g, '""');
    if (isNumeric) {
      return escaped;
    }
    return `"${escaped}"`;
  }

  private formatToJapanDateTime(epochMs: number): string {
    return new Intl.DateTimeFormat('ja-JP', {
      timeZone: 'Asia/Tokyo',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false
    }).format(new Date(epochMs));
  }

  private formatSecondsAsJapaneseMinuteSecond(totalSeconds: number): string {
    const sec = Math.max(0, Math.round(totalSeconds));
    const min = Math.floor(sec / 60);
    const rem = sec % 60;
    return `${min}分${rem}秒`;
  }

  private formatBytesAsMb(bytes: number | null | undefined): string {
    if (bytes === null || bytes === undefined || !Number.isFinite(bytes) || bytes < 0) {
      return '';
    }
    return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
  }

  getEditableText(segment: TranscriptionSegment): string {
    const map = this.editedSegmentTextMap();
    return this.getEditableTextFromMap(segment, map);
  }

  getEditableTextFromMap(segment: TranscriptionSegment, map: Partial<Record<number, string>>): string {
    const found = map[segment.id];
    return typeof found === 'string' ? found : (segment.text ?? '');
  }

  private applyEditedTextsToResultSegments(textsBySegmentId: Record<number, string>): void {
    const ids = new Set(Object.keys(textsBySegmentId).map((id) => Number(id)).filter(Number.isFinite));
    if (ids.size === 0) {
      return;
    }
    const current = this.result();
    if (!current) {
      return;
    }
    let changed = false;
    const segments = current.segments.map((segment) => {
      if (!ids.has(segment.id)) {
        return segment;
      }
      const text = textsBySegmentId[segment.id];
      if (typeof text !== 'string' || segment.text === text) {
        return segment;
      }
      changed = true;
      return { ...segment, text };
    });
    if (changed) {
      this.result.set({ ...current, segments });
    }
  }

  private getEditableTextById(segmentId: number): string {
    const map = this.editedSegmentTextMap();
    const found = map[segmentId];
    if (typeof found === 'string') {
      return found;
    }
    const segment = this.result()?.segments.find((s) => s.id === segmentId);
    return segment?.text ?? '';
  }

  setEditableText(segmentId: number, value: string): void {
    const next = { ...this.editedSegmentTextMap() };
    next[segmentId] = value;
    this.editedSegmentTextMap.set(next);
    this.clearProofreadMetadataIfTextDiverged(segmentId, value);
  }

  mergeConsecutiveSpeakerUtterances(): void {
    if (this.running() || this.proofreadRunning() || this.diarizationRunning()) {
      return;
    }

    const currentResult = this.result();
    if (!currentResult) {
      this.mergeStatus.set('統合対象がありません。');
      return;
    }

    const sourceRows = this.segmentRows;
    if (sourceRows.length <= 1) {
      this.mergeStatus.set('統合対象がありません。');
      return;
    }

    const mergedSegments: TranscriptionSegment[] = [];
    const nextEditedTextMap: Record<number, string> = {};
    const nextSpeakerMap: Record<number, string> = {};
    const currentProofreadMetadata = this.proofreadMetadataBySegmentId();
    const nextProofreadMetadataBySegmentId: Record<number, ExportProofreadMetadata> = {};
    const nextProofreadHintBySegmentId: Record<number, string> = {};

    let i = 0;
    while (i < sourceRows.length) {
      const first = sourceRows[i];
      const speakerKey = this.getAssignedSpeakerKey(first).trim();
      let j = i;
      if (speakerKey.length > 0) {
        while (j + 1 < sourceRows.length) {
          const nextSpeaker = this.getAssignedSpeakerKey(sourceRows[j + 1]).trim();
          if (nextSpeaker !== speakerKey) {
            break;
          }
          j += 1;
        }
      }

      const group = sourceRows.slice(i, j + 1);
      const mergedId = mergedSegments.length;
      const mergedText = group
        .map((seg) => this.getEditableText(seg))
        .reduce((acc, text) => this.mergeSegmentText(acc, text), '');
      const mergedWords = group.flatMap((seg) => seg.words ?? []);
      const mergedSpeaker = speakerKey || (group[0].speaker ?? '');

      mergedSegments.push({
        id: mergedId,
        start: group[0].start,
        end: group[group.length - 1].end,
        text: mergedText,
        speaker: mergedSpeaker,
        words: mergedWords.length > 0 ? mergedWords : undefined
      });
      nextEditedTextMap[mergedId] = mergedText;
      nextSpeakerMap[mergedId] = mergedSpeaker;

      const groupMetadata = group
        .map((seg) => currentProofreadMetadata[seg.id])
        .filter((metadata): metadata is ExportProofreadMetadata => !!metadata);
      const redCandidates = groupMetadata.filter((metadata) => this.isRedSensitiveEntityMetadata(metadata));
      const yellowCandidates = groupMetadata.filter((metadata) => this.isYellowSensitiveEntityMetadata(metadata));
      const selectedTier = redCandidates.length > 0 ? redCandidates : yellowCandidates;
      const selected = selectedTier[0];
      if (selected) {
        const mergedKinds = Array.from(new Set(
          selectedTier.flatMap((metadata) => metadata.sensitiveEntity?.kinds ?? [])
            .map((kind) => String(kind).trim().toLowerCase())
            .filter((kind) => kind.length > 0)
        ));
        const mergedNames = Array.from(new Set(
          selectedTier.flatMap((metadata) => metadata.sensitiveEntity?.names ?? [])
            .map((name) => String(name).trim())
            .filter((name) => name.length > 0)
        )).slice(0, 8);
        const mergedPersonNames = Array.from(new Set(
          selectedTier.flatMap((metadata) => metadata.sensitiveEntity?.personNames ?? [])
            .map((name) => String(name).trim())
            .filter((name) => name.length > 0)
        )).slice(0, 8);
        const mergedOrganizationNames = Array.from(new Set(
          selectedTier.flatMap((metadata) => metadata.sensitiveEntity?.organizationNames ?? [])
            .map((name) => String(name).trim())
            .filter((name) => name.length > 0)
        )).slice(0, 8);
        const mergedLocationNames = Array.from(new Set(
          selectedTier.flatMap((metadata) => metadata.sensitiveEntity?.locationNames ?? [])
            .map((name) => String(name).trim())
            .filter((name) => name.length > 0)
        )).slice(0, 8);
        const mergedSource = selected.sensitiveEntity?.personDetectionSource || '';
        const mergedMetadata: ExportProofreadMetadata = {
          diff: {
            from: mergedText,
            to: mergedText
          },
          confidence: Number.isFinite(selected.confidence) ? selected.confidence : 0.85,
          reason: selected.reason || '',
          lintIssues: [],
          sensitiveEntity: {
            hasSensitiveEntity: true,
            kinds: mergedKinds,
            names: mergedNames,
            personNames: mergedPersonNames,
            organizationNames: mergedOrganizationNames,
            locationNames: mergedLocationNames,
            personDetectionSource: mergedSource
          }
        };
        nextProofreadMetadataBySegmentId[mergedId] = mergedMetadata;
        nextProofreadHintBySegmentId[mergedId] = this.buildProofreadHint(
          mergedMetadata.diff.from,
          mergedMetadata.diff.to,
          mergedMetadata.confidence,
          mergedMetadata.reason,
          mergedMetadata.sensitiveEntity
        );
      }
      i = j + 1;
    }

    const mergedCount = sourceRows.length - mergedSegments.length;
    if (mergedCount <= 0) {
      this.mergeStatus.set('統合対象がありません。');
      return;
    }

    this.stopSegmentPlayback();
    this.result.set({
      ...currentResult,
      segments: mergedSegments,
      text: mergedSegments.map((seg) => nextEditedTextMap[seg.id] ?? seg.text).join(' ').trim()
    });
    this.editedSegmentTextMap.set(nextEditedTextMap);
    this.selectedSpeakerBySegmentId.set(nextSpeakerMap);
    this.hiddenSegmentIds.set({});
    this.proofreadHintBySegmentId.set(nextProofreadHintBySegmentId);
    this.proofreadMetadataBySegmentId.set(nextProofreadMetadataBySegmentId);
    this.proofreadUpdatedCount.set(Object.keys(nextProofreadMetadataBySegmentId).length);
    if (this.segmentRowFilter() === 'caution' || this.segmentRowFilter() === 'caution_context') {
      this.refreshCautionPinnedSegmentIds(this.segmentRowFilter() === 'caution_context', this._cautionFilterGen);
    }
    this.mergeStatus.set(`${mergedCount} 行を統合しました。`);
  }

  async requestMergeConsecutiveSpeakerUtterances(): Promise<void> {
    if (this.running() || this.proofreadRunning() || this.diarizationRunning() || !this.result()) {
      return;
    }
    if (this.proofreadCompleted()) {
      this.mergeRunning.set(true);
      await new Promise<void>(resolve => setTimeout(resolve, 0));
      this.mergeConsecutiveSpeakerUtterances();
      await new Promise<void>(resolve => setTimeout(resolve, 150));
      this.mergeRunning.set(false);
      return;
    }
    this.openConfirmDialog({
      actionKind: 'mergeUtterances',
      title: '発言の統合',
      message: '校正済みですか？ 同一話者の発言を一行にまとめます。この作業は取り消すことは出来ません。実行してよろしいですか？',
      messageHtml: '<strong>校正済みですか？</strong><br>同一話者の発言を一行にまとめます。この作業は取り消すことは出来ません。実行してよろしいですか？',
      confirmLabel: '実行する',
      cancelLabel: 'キャンセル',
      confirmColor: 'warn',
      cancelColor: null
    });
  }

  private mergeSegmentText(leftRaw: string, rightRaw: string): string {
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

  insertSegmentRelative(sourceSegmentId: number, position: 'above' | 'below'): void {
    const currentResult = this.result();
    if (!currentResult) {
      return;
    }

    const segments = [...currentResult.segments];
    const sourceIndex = segments.findIndex((segment) => segment.id === sourceSegmentId);
    if (sourceIndex < 0) {
      return;
    }

    const sourceSegment = segments[sourceIndex];
    const sourceText = this.getEditableText(sourceSegment);
    const insertIndex = position === 'above' ? sourceIndex : sourceIndex + 1;
    const newSegmentId = this.generateNextSegmentId(segments);

    const newSegment: TranscriptionSegment = {
      id: newSegmentId,
      start: sourceSegment.start,
      end: sourceSegment.end,
      text: sourceText,
      speaker: null
    };

    segments.splice(insertIndex, 0, newSegment);

    const currentTextMap = this.editedSegmentTextMap();
    const nextTextMap = {
      ...currentTextMap,
      [newSegmentId]: sourceText
    };

    const hiddenMap = { ...this.hiddenSegmentIds() };
    delete hiddenMap[newSegmentId];

    const selectedSpeakerMap = {
      ...this.selectedSpeakerBySegmentId(),
      [newSegmentId]: ''
    };

    const proofreadHints = { ...this.proofreadHintBySegmentId() };
    delete proofreadHints[newSegmentId];

    const proofreadMetadata = { ...this.proofreadMetadataBySegmentId() };
    delete proofreadMetadata[newSegmentId];

    this.result.set({
      ...currentResult,
      segments,
      text: segments
        .filter((segment) => !hiddenMap[segment.id])
        .map((segment) => (typeof nextTextMap[segment.id] === 'string' ? nextTextMap[segment.id] : segment.text))
        .join(' ')
        .trim()
    });
    this.editedSegmentTextMap.set(nextTextMap);
    this.hiddenSegmentIds.set(hiddenMap);
    this.selectedSpeakerBySegmentId.set(selectedSpeakerMap);
    this.proofreadHintBySegmentId.set(proofreadHints);
    this.proofreadMetadataBySegmentId.set(proofreadMetadata);
  }

  splitSegmentByPeriod(sourceSegmentId: number): void {
    const currentResult = this.result();
    if (!currentResult) return;

    const segments = [...currentResult.segments];
    const sourceIndex = segments.findIndex((s) => s.id === sourceSegmentId);
    if (sourceIndex < 0) return;

    const sourceSegment = segments[sourceIndex];
    const sourceText = this.getEditableText(sourceSegment);

    // 文末記号で分割し、区切り文字を各パートの末尾に再付与する。
    // 日本語: 「。」「？」「！」（ほぼ文末専用なので素朴に分割）。
    // それ以外: 「.」「?」「!」だが、直後が空白／文末のときだけ分割する。
    //   これで小数（3.14）や略語（U.S.A.）の途中では割れない（コンマは文中の区切りなので対象外）。
    const isJa = this.editPunctuationIsJapanese();
    const splitRe = isJa ? /(。|？|！)/ : /([.?!]+)(?=\s|$)/;
    const tokens = sourceText.split(splitRe);
    const parts: string[] = [];
    for (let i = 0; i < tokens.length; i += 2) {
      let combined = tokens[i] + (tokens[i + 1] ?? '');
      if (!isJa) combined = combined.trim();
      if (combined.length > 0) parts.push(combined);
    }

    if (parts.length <= 1) return;

    const sourceSpeaker = this.getAssignedSpeakerKey(sourceSegment);
    const newParts = parts.slice(1);
    let maxId = segments.reduce((max, s) => Math.max(max, s.id), 0);
    const newSegments: TranscriptionSegment[] = newParts.map((text) => ({
      id: ++maxId,
      start: sourceSegment.start,
      end: sourceSegment.end,
      text,
      speaker: sourceSegment.speaker
    }));

    segments.splice(sourceIndex + 1, 0, ...newSegments);

    const currentTextMap = { ...this.editedSegmentTextMap() };
    currentTextMap[sourceSegmentId] = parts[0];
    for (const seg of newSegments) {
      currentTextMap[seg.id] = seg.text;
    }

    const hiddenMap = { ...this.hiddenSegmentIds() };
    for (const seg of newSegments) {
      delete hiddenMap[seg.id];
    }

    const speakerMap = { ...this.selectedSpeakerBySegmentId() };
    for (const seg of newSegments) {
      speakerMap[seg.id] = sourceSpeaker;
    }

    const proofreadHints = { ...this.proofreadHintBySegmentId() };
    const proofreadMetadata = { ...this.proofreadMetadataBySegmentId() };
    for (const seg of newSegments) {
      delete proofreadHints[seg.id];
      delete proofreadMetadata[seg.id];
    }

    this.result.set({
      ...currentResult,
      segments,
      text: segments
        .filter((s) => !hiddenMap[s.id])
        .map((s) => (typeof currentTextMap[s.id] === 'string' ? currentTextMap[s.id] : s.text))
        .join(' ')
        .trim()
    });
    this.editedSegmentTextMap.set(currentTextMap);
    this.hiddenSegmentIds.set(hiddenMap);
    this.selectedSpeakerBySegmentId.set(speakerMap);
    this.proofreadHintBySegmentId.set(proofreadHints);
    this.proofreadMetadataBySegmentId.set(proofreadMetadata);
  }

  private generateNextSegmentId(segments: ReadonlyArray<TranscriptionSegment>): number {
    if (segments.length === 0) {
      return 0;
    }
    const maxId = segments.reduce((maxValue, segment) => Math.max(maxValue, segment.id), segments[0].id);
    return maxId + 1;
  }

  onProofreadChunkSizeChange(valueRaw: string): void {
    const numeric = Number(valueRaw);
    if (!Number.isFinite(numeric)) {
      this.proofreadChunkSize.set(12);
      this.persistProofreadSettings();
      return;
    }
    this.proofreadChunkSize.set(this.normalizeProofreadChunkSize(numeric));
    this.persistProofreadSettings();
  }

  onProofreadChunkMaxCharsChange(valueRaw: string): void {
    const numeric = Number(valueRaw);
    if (!Number.isFinite(numeric)) {
      this.proofreadChunkMaxChars.set(1200);
      this.persistProofreadSettings();
      return;
    }
    this.proofreadChunkMaxChars.set(this.normalizeProofreadChunkMaxChars(numeric));
    this.persistProofreadSettings();
  }

  onContinueProofreadAfterTranscriptionChange(value: boolean): void {
    this.continueProofreadAfterTranscription.set(Boolean(value));
    this.persistProofreadSettings();
  }

  onLocationAreaChange(value: LocationAreaCode): void {
    const area = this.normalizeLocationArea(value);
    this.selectedLocationArea.set(area);
    this.selectedLocationPrefectures.set(this.selectedLocationPrefecturesByArea()[area] ?? []);
    this.persistProofreadSettings();
  }

  onSelectedLocationPrefecturesChange(value: string[] | string): void {
    const area = this.selectedLocationArea();
    const areaCodes = new Set(this.getLocationAreaPrefectureCodes(area));
    const prefectures = this
      .normalizeLocationPrefectureCodes(Array.isArray(value) ? value : [value])
      .filter((code) => areaCodes.has(code));
    this.selectedLocationPrefectures.set(prefectures);
    this.selectedLocationPrefecturesByArea.update((current) => {
      const next = { ...current };
      if (prefectures.length > 0) {
        next[area] = prefectures;
      } else {
        delete next[area];
      }
      return next;
    });
    this.persistProofreadSettings();
  }

  isVoiceInputRecording(segmentId: number): boolean {
    return this.voiceInputRecordingSegmentId() === segmentId;
  }

  isVoiceInputProcessing(segmentId: number): boolean {
    return this.voiceInputProcessingSegmentId() === segmentId;
  }

  shouldShowVoiceInputShortCandidateHint(candidates: ReadonlyArray<string> | null | undefined): boolean {
    const items = (candidates ?? []).map((candidate) => String(candidate).trim()).filter((candidate) => candidate.length > 0);
    if (items.length === 0) {
      return false;
    }
    return items.every((candidate) => Array.from(candidate).length <= 4);
  }

  voiceInputButtonTooltip(segmentId: number): string {
    if (!this.editorVoiceInputAvailable()) {
      return this.editorVoiceInputUnavailableTooltip();
    }
    return this.isVoiceInputRecording(segmentId) ? '録音を停止' : '音声入力';
  }

  segmentRetranscribeUnavailableReason(): string | null {
    if (!this.editorVoiceInputPackChecked()) {
      return '音声入力パックの状態を確認中です...';
    }
    if (!this.editorVoiceInputAvailable()) {
      return '区間の聞き直しを使うには、設定タブの「音声入力パック」からモデルをダウンロードしてください。';
    }
    if (!this.segmentRetranscribeSupported()) {
      return this.editorOnlyBuild
        ? '区間の聞き直しに必要な ffmpeg が未導入です。設定タブの「音声入力パック」からダウンロードしてください。'
        : 'この構成では区間の聞き直しを利用できません。';
    }
    if (this.isPlaybackDisabled() || !this.selectedAudioPath()) {
      return '音声ファイルを読み込むと、この区間をAIによる再文字起こしができるようになります。';
    }
    return null;
  }

  segmentRetranscribeTooltip(segmentId: number): string {
    const reason = this.segmentRetranscribeUnavailableReason();
    if (reason) {
      return reason;
    }
    if (this.isVoiceInputProcessing(segmentId)) {
      return '候補を生成中...';
    }
    return 'この区間を別のAIで再文字起こしする';
  }

  private async isVoiceInputModelLoaded(): Promise<boolean> {
    if (!this.isTauriRuntime()) return false;
    try {
      return await invoke<boolean>('get_voice_input_server_status');
    } catch {
      return false;
    }
  }

  async retranscribeSegment(segment: TranscriptionSegment): Promise<void> {
    if (this.segmentRetranscribeUnavailableReason() !== null) {
      return;
    }
    if (this.voiceInputProcessingSegmentId() !== null || this.voiceInputRecordingSegmentId() !== null) {
      return;
    }
    const path = this.selectedAudioPath();
    if (!path) {
      return;
    }
    const start = Math.max(0, segment.start);
    const end = Math.max(start, segment.end);
    if (end - start < 0.2) {
      this.voiceInputFeedbackSegmentId.set(segment.id);
      this.voiceInputStatus.set('');
      this.voiceInputError.set('この行には有効な時間範囲がありません。開始・終了時刻を確認してください。');
      return;
    }
    if (end - start > 30) {
      this.snackBar.open('区間が30秒を超えているため、開始30秒のみ読み取ります。', undefined, { duration: 4000 });
    }
    this.voiceInputCandidates.set(null);
    this.voiceInputError.set('');
    this.voiceInputFeedbackSegmentId.set(segment.id);
    this.voiceInputProcessingSegmentId.set(segment.id);
    const modelLoaded = await this.isVoiceInputModelLoaded();
    this.voiceInputStatus.set(modelLoaded
      ? '区間を聞き直して候補を生成中...'
      : 'モデルを読み込んでいます。1回目は時間がかかります...');
    try {
      await invoke('set_audio_allowed_path', { path });
      const context = this.buildVoiceInputContext(segment.id);
      const response = await invoke<EditorVoiceInputResponse>('generate_segment_retranscribe_candidates', {
        request: {
          audioPath: path,
          startSeconds: start,
          endSeconds: end,
          maxCandidates: 3,
          ...(context ? { context } : {}),
        },
      });
      const candidates = (response.candidates ?? [])
        .map((candidate) => String(candidate).trim())
        .filter((candidate) => candidate.length > 0)
        .slice(0, 3);
      if (candidates.length === 0) {
        this.voiceInputError.set('候補を生成できませんでした。');
        this.voiceInputCandidates.set(null);
        this.voiceInputStatus.set('');
      } else {
        this.voiceInputCandidates.set({ segmentId: segment.id, candidates, mode: 'replace' });
        this.voiceInputStatus.set('');
      }
    } catch (error) {
      this.voiceInputCandidates.set(null);
      this.voiceInputStatus.set('');
      this.voiceInputError.set(this.normalizeErrorMessage(error));
    } finally {
      this.voiceInputProcessingSegmentId.set(null);
    }
  }

  async toggleVoiceInputForSegment(
    segmentId: number,
    textInputEl: HTMLInputElement | HTMLTextAreaElement
  ): Promise<void> {
    if (!this.editorVoiceInputAvailable() || this.isVoiceInputProcessing(segmentId)) {
      return;
    }
    if (this.isVoiceInputRecording(segmentId)) {
      await this.finishVoiceInputRecording(segmentId);
      return;
    }
    if (this.voiceInputRecordingSegmentId() !== null) {
      this.cleanupVoiceInputRecording(false);
    }
    await this.startVoiceInputRecording(segmentId, textInputEl);
  }

  onVoiceInputPointerDown(
    event: PointerEvent,
    segmentId: number,
    textInputEl: HTMLInputElement | HTMLTextAreaElement
  ): void {
    event.preventDefault();
    event.stopPropagation();
    void this.toggleVoiceInputForSegment(segmentId, textInputEl);
  }

  private async startVoiceInputRecording(
    segmentId: number,
    textInputEl: HTMLInputElement | HTMLTextAreaElement
  ): Promise<void> {
    this.voiceInputError.set('');
    this.voiceInputStatus.set('');
    this.voiceInputFeedbackSegmentId.set(segmentId);
    this.voiceInputCandidates.set(null);
    const nav = navigator as Navigator;
    if (!nav.mediaDevices?.getUserMedia) {
      this.voiceInputError.set('この環境ではマイク録音を開始できません。');
      return;
    }
    const selectionStart = Number.isFinite(textInputEl.selectionStart) ? Number(textInputEl.selectionStart) : textInputEl.value.length;
    const selectionEnd = Number.isFinite(textInputEl.selectionEnd) ? Number(textInputEl.selectionEnd) : selectionStart;
    this.voiceInputSelection = { segmentId, start: selectionStart, end: selectionEnd };

    try {
      const stream = await nav.mediaDevices.getUserMedia({
        audio: {
          channelCount: 1,
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });
      const AudioContextCtor = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!AudioContextCtor) {
        stream.getTracks().forEach((track) => track.stop());
        this.voiceInputError.set('この環境では音声処理を開始できません。');
        return;
      }
      const audioContext = new AudioContextCtor();
      const source = audioContext.createMediaStreamSource(stream);
      const processor = audioContext.createScriptProcessor(4096, 1, 1);
      this.voiceInputChunks = [];
      this.voiceInputSampleRate = audioContext.sampleRate;
      processor.onaudioprocess = (event: AudioProcessingEvent) => {
        if (this.voiceInputRecordingSegmentId() !== segmentId) {
          return;
        }
        const input = event.inputBuffer.getChannelData(0);
        this.voiceInputChunks.push(new Float32Array(input));
        const output = event.outputBuffer.getChannelData(0);
        output.fill(0);
      };
      source.connect(processor);
      processor.connect(audioContext.destination);
      this.voiceInputAudioContext = audioContext;
      this.voiceInputMediaStream = stream;
      this.voiceInputSourceNode = source;
      this.voiceInputProcessorNode = processor;
      this.voiceInputRecordingSegmentId.set(segmentId);
      this.voiceInputStatus.set(`録音中... ${this.voiceInputMaxRecordingSeconds}秒で自動停止します`);
      this.voiceInputAutoStopTimer = setTimeout(() => {
        if (this.voiceInputRecordingSegmentId() === segmentId) {
          void this.finishVoiceInputRecording(segmentId);
        }
      }, this.voiceInputMaxRecordingSeconds * 1000);
    } catch (error) {
      this.cleanupVoiceInputRecording(false);
      this.voiceInputError.set(this.normalizeVoiceInputErrorMessage(error));
    }
  }

  private async finishVoiceInputRecording(segmentId: number): Promise<void> {
    if (this.voiceInputRecordingSegmentId() !== segmentId) {
      return;
    }
    const chunks = this.voiceInputChunks.map((chunk) => new Float32Array(chunk));
    const sourceRate = this.voiceInputSampleRate || 48000;
    this.cleanupVoiceInputRecording(false);
    const merged = this.mergeVoiceInputChunks(chunks);
    if (merged.length < sourceRate * 0.15) {
      this.voiceInputStatus.set('');
      this.voiceInputError.set('録音が短すぎます。');
      return;
    }
    const maxSourceSamples = Math.floor(sourceRate * this.voiceInputMaxRecordingSeconds);
    const clipped = merged.length > maxSourceSamples ? merged.slice(0, maxSourceSamples) : merged;
    const resampled = this.resamplePcmTo16k(clipped, sourceRate);
    const wav = this.encodePcm16Wav(resampled, 16000);
    const wavBase64 = this.arrayBufferToBase64(wav);
    this.voiceInputProcessingSegmentId.set(segmentId);
    this.voiceInputFeedbackSegmentId.set(segmentId);
    const modelLoaded = await this.isVoiceInputModelLoaded();
    this.voiceInputStatus.set(modelLoaded
      ? '候補を生成中...'
      : 'モデルを読み込んでいます。1回目は時間がかかります...');
    this.voiceInputError.set('');
    try {
      const context = this.buildVoiceInputContext(segmentId);
      const response = await invoke<EditorVoiceInputResponse>('generate_editor_voice_input_candidates', {
        request: { wavBase64, maxCandidates: 3, ...(context ? { context } : {}) },
      });
      const candidates = (response.candidates ?? [])
        .map((candidate) => String(candidate).trim())
        .filter((candidate) => candidate.length > 0)
        .slice(0, 3);
      if (candidates.length === 0) {
        this.voiceInputError.set('候補を生成できませんでした。');
        this.voiceInputCandidates.set(null);
      } else {
        this.voiceInputCandidates.set({ segmentId, candidates, mode: 'insert' });
        this.voiceInputStatus.set('');
        this.voiceInputFeedbackSegmentId.set(segmentId);
      }
    } catch (error) {
      this.voiceInputCandidates.set(null);
      this.voiceInputStatus.set('');
      this.voiceInputError.set(this.normalizeVoiceInputErrorMessage(error));
    } finally {
      this.voiceInputProcessingSegmentId.set(null);
    }
  }

  private buildVoiceInputContext(segmentId: number): EditorVoiceInputContext | null {
    const rows = this.segmentRows;
    const index = rows.findIndex((segment) => segment.id === segmentId);
    const currentSegment = index >= 0
      ? rows[index]
      : this.result()?.segments.find((segment) => segment.id === segmentId) ?? null;
    if (!currentSegment) {
      return null;
    }

    const editedMap = this.editedSegmentTextMap();
    const rowNumberMap = this.segmentRowNumberMap();
    const toContextLine = (
      segment: TranscriptionSegment | null | undefined,
      fallbackIndex: number | null
    ): EditorVoiceInputContextLine | null => {
      if (!segment) {
        return null;
      }
      const speaker = this.displaySpeaker(this.getAssignedSpeakerKey(segment)).trim();
      const rowNumber = rowNumberMap[segment.id] ?? (fallbackIndex !== null ? fallbackIndex + 1 : undefined);
      return {
        ...(typeof rowNumber === 'number' && Number.isFinite(rowNumber) ? { rowNumber } : {}),
        speaker: speaker.length > 0 && speaker !== '-' ? speaker : null,
        text: this.getEditableTextFromMap(segment, editedMap),
      };
    };

    return {
      previous: index > 0 ? toContextLine(rows[index - 1], index - 1) : null,
      current: toContextLine(currentSegment, index >= 0 ? index : null),
      next: index >= 0 && index < rows.length - 1 ? toContextLine(rows[index + 1], index + 1) : null,
    };
  }

  private cleanupVoiceInputRecording(clearStatus: boolean): void {
    if (this.voiceInputAutoStopTimer !== null) {
      clearTimeout(this.voiceInputAutoStopTimer);
      this.voiceInputAutoStopTimer = null;
    }
    if (this.voiceInputProcessorNode) {
      this.voiceInputProcessorNode.onaudioprocess = null;
      try {
        this.voiceInputProcessorNode.disconnect();
      } catch {
        // ignore
      }
      this.voiceInputProcessorNode = null;
    }
    if (this.voiceInputSourceNode) {
      try {
        this.voiceInputSourceNode.disconnect();
      } catch {
        // ignore
      }
      this.voiceInputSourceNode = null;
    }
    if (this.voiceInputMediaStream) {
      this.voiceInputMediaStream.getTracks().forEach((track) => track.stop());
      this.voiceInputMediaStream = null;
    }
    if (this.voiceInputAudioContext) {
      void this.voiceInputAudioContext.close().catch(() => {});
      this.voiceInputAudioContext = null;
    }
    this.voiceInputRecordingSegmentId.set(null);
    this.voiceInputChunks = [];
    this.voiceInputSampleRate = 0;
    if (clearStatus) {
      this.voiceInputStatus.set('');
      this.voiceInputError.set('');
      this.voiceInputFeedbackSegmentId.set(null);
    }
  }

  private mergeVoiceInputChunks(chunks: ReadonlyArray<Float32Array>): Float32Array {
    const totalLength = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
    const merged = new Float32Array(totalLength);
    let offset = 0;
    for (const chunk of chunks) {
      merged.set(chunk, offset);
      offset += chunk.length;
    }
    return merged;
  }

  private resamplePcmTo16k(input: Float32Array, inputSampleRate: number): Float32Array {
    const outputSampleRate = 16000;
    if (inputSampleRate === outputSampleRate) {
      return input;
    }
    const ratio = inputSampleRate / outputSampleRate;
    const outputLength = Math.max(1, Math.floor(input.length / ratio));
    const output = new Float32Array(outputLength);
    for (let i = 0; i < outputLength; i++) {
      const sourceIndex = i * ratio;
      const left = Math.floor(sourceIndex);
      const right = Math.min(input.length - 1, left + 1);
      const frac = sourceIndex - left;
      output[i] = input[left] * (1 - frac) + input[right] * frac;
    }
    return output;
  }

  private encodePcm16Wav(samples: Float32Array, sampleRate: number): ArrayBuffer {
    const bytesPerSample = 2;
    const dataSize = samples.length * bytesPerSample;
    const buffer = new ArrayBuffer(44 + dataSize);
    const view = new DataView(buffer);
    this.writeAscii(view, 0, 'RIFF');
    view.setUint32(4, 36 + dataSize, true);
    this.writeAscii(view, 8, 'WAVE');
    this.writeAscii(view, 12, 'fmt ');
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true);
    view.setUint16(22, 1, true);
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, sampleRate * bytesPerSample, true);
    view.setUint16(32, bytesPerSample, true);
    view.setUint16(34, 16, true);
    this.writeAscii(view, 36, 'data');
    view.setUint32(40, dataSize, true);
    let offset = 44;
    for (const sample of samples) {
      const clamped = Math.max(-1, Math.min(1, sample));
      view.setInt16(offset, clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff, true);
      offset += 2;
    }
    return buffer;
  }

  private writeAscii(view: DataView, offset: number, value: string): void {
    for (let i = 0; i < value.length; i++) {
      view.setUint8(offset + i, value.charCodeAt(i));
    }
  }

  private arrayBufferToBase64(buffer: ArrayBuffer): string {
    const bytes = new Uint8Array(buffer);
    const chunkSize = 0x8000;
    let binary = '';
    for (let i = 0; i < bytes.length; i += chunkSize) {
      const chunk = bytes.subarray(i, i + chunkSize);
      binary += String.fromCharCode(...chunk);
    }
    return btoa(binary);
  }

  private normalizeVoiceInputErrorMessage(error: unknown): string {
    const message = this.normalizeErrorMessage(error);
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

  insertVoiceInputCandidate(
    segmentId: number,
    candidate: string,
    textInputEl: HTMLInputElement | HTMLTextAreaElement
  ): void {
    if (this.voiceInputCandidates()?.mode === 'replace') {
      this.setEditableText(segmentId, candidate);
    } else {
      this.insertTextAtSegmentCursor(segmentId, candidate, textInputEl);
    }
    this.voiceInputCandidates.set(null);
    this.voiceInputStatus.set('');
    this.voiceInputError.set('');
    this.voiceInputFeedbackSegmentId.set(null);
  }

  dismissVoiceInputCandidates(segmentId: number): void {
    if (this.voiceInputCandidates()?.segmentId === segmentId) {
      this.voiceInputCandidates.set(null);
      this.voiceInputFeedbackSegmentId.set(null);
    }
  }

  private insertTextAtSegmentCursor(
    segmentId: number,
    text: string,
    textInputEl?: HTMLInputElement | HTMLTextAreaElement
  ): void {
    const current = this.editedSegmentTextMap();
    const base = typeof current[segmentId] === 'string'
      ? current[segmentId]
      : (this.result()?.segments.find((s) => s.id === segmentId)?.text ?? '');
    const storedSelection = this.voiceInputSelection?.segmentId === segmentId ? this.voiceInputSelection : null;
    const isFocused = !!textInputEl && document.activeElement === textInputEl;
    const selectionStart = isFocused && typeof textInputEl?.selectionStart === 'number'
      ? textInputEl.selectionStart
      : storedSelection?.start ?? base.length;
    const selectionEnd = isFocused && typeof textInputEl?.selectionEnd === 'number'
      ? textInputEl.selectionEnd
      : storedSelection?.end ?? selectionStart;
    const safeStart = Math.max(0, Math.min(base.length, selectionStart));
    const safeEnd = Math.max(safeStart, Math.min(base.length, selectionEnd));
    const updatedText = `${base.slice(0, safeStart)}${text}${base.slice(safeEnd)}`;
    const next = { ...current, [segmentId]: updatedText };
    this.editedSegmentTextMap.set(next);
    this.clearProofreadMetadataIfTextDiverged(segmentId, updatedText);
    const nextPos = Math.max(0, Math.min(updatedText.length, safeStart + text.length));
    setTimeout(() => {
      if (!textInputEl) return;
      textInputEl.focus({ preventScroll: true });
      textInputEl.setSelectionRange(nextPos, nextPos);
    }, 0);
  }

  private clearProofreadMetadataIfTextDiverged(segmentId: number, currentText: string): void {
    const metadataMap = this.proofreadMetadataBySegmentId();
    const metadata = metadataMap[segmentId];
    if (!metadata) {
      return;
    }
    if (currentText === metadata.diff.to) {
      return;
    }
    const nextMetadata = { ...metadataMap };
    delete nextMetadata[segmentId];
    this.proofreadMetadataBySegmentId.set(nextMetadata);

    const hintMap = this.proofreadHintBySegmentId();
    if (hintMap[segmentId] !== undefined) {
      const nextHints = { ...hintMap };
      delete nextHints[segmentId];
      this.proofreadHintBySegmentId.set(nextHints);
    }
  }

  private clearProofreadSuggestion(segmentId: number): void {
    const metadataMap = this.proofreadMetadataBySegmentId();
    if (metadataMap[segmentId] !== undefined) {
      const nextMetadata = { ...metadataMap };
      delete nextMetadata[segmentId];
      this.proofreadMetadataBySegmentId.set(nextMetadata);
    }

    const hintMap = this.proofreadHintBySegmentId();
    if (hintMap[segmentId] !== undefined) {
      const nextHints = { ...hintMap };
      delete nextHints[segmentId];
      this.proofreadHintBySegmentId.set(nextHints);
    }
  }

  startEditingTime(segment: TranscriptionSegment): void {
    const startSec = Math.max(0, Math.floor(segment.start));
    const endSec = Math.max(0, Math.floor(segment.end));
    this.editingTimeValues.set({
      startMm: String(Math.floor(startSec / 60)),
      startSs: String(startSec % 60).padStart(2, '0'),
      endMm: String(Math.floor(endSec / 60)),
      endSs: String(endSec % 60).padStart(2, '0'),
    });
    this.editingTimeSegmentId.set(segment.id);
    setTimeout(() => {
      const el = document.querySelector<HTMLInputElement>(`[data-time-edit-id="${segment.id}"] .time-input`);
      el?.focus();
      el?.select();
    }, 0);
  }

  commitTimeEdit(segmentId: number): void {
    if (this.editingTimeSegmentId() !== segmentId) return;
    this.editingTimeSegmentId.set(null);
    const v = this.editingTimeValues();
    const startMm = parseInt(v.startMm, 10);
    const startSs = parseInt(v.startSs, 10);
    const endMm = parseInt(v.endMm, 10);
    const endSs = parseInt(v.endSs, 10);
    if (
      !Number.isFinite(startMm) || !Number.isFinite(startSs) ||
      !Number.isFinite(endMm) || !Number.isFinite(endSs) ||
      startMm < 0 || endMm < 0 ||
      startSs < 0 || startSs > 59 || endSs < 0 || endSs > 59
    ) {
      return;
    }
    let newStart = startMm * 60 + startSs;
    let newEnd = endMm * 60 + endSs;
    if (newStart > newEnd) {
      [newStart, newEnd] = [newEnd, newStart];
    }
    const current = this.result();
    if (current) {
      const segments = current.segments.map((s) =>
        s.id === segmentId ? { ...s, start: newStart, end: newEnd } : s
      );
      this.result.set({ ...current, segments });
    }
  }

  cancelTimeEdit(): void {
    this.editingTimeSegmentId.set(null);
  }

  onTimeBlockFocusOut(event: FocusEvent, segmentId: number, container: HTMLElement): void {
    const related = event.relatedTarget as HTMLElement | null;
    if (!related || !container.contains(related)) {
      this.commitTimeEdit(segmentId);
    }
  }

  onTimeInputKeydown(event: KeyboardEvent, segmentId: number, field: 'startMm' | 'startSs' | 'endMm' | 'endSs'): void {
    if (event.key === 'Enter') {
      this.commitTimeEdit(segmentId);
      event.preventDefault();
    } else if (event.key === 'Escape') {
      this.cancelTimeEdit();
      event.preventDefault();
    } else if (event.key === 'ArrowUp') {
      this.stepTimeField(field, 1);
      event.preventDefault();
    } else if (event.key === 'ArrowDown') {
      this.stepTimeField(field, -1);
      event.preventDefault();
    }
  }

  private stepTimeField(field: 'startMm' | 'startSs' | 'endMm' | 'endSs', delta: 1 | -1): void {
    const v = this.editingTimeValues();
    const current = parseInt(v[field], 10);
    if (!Number.isFinite(current)) return;
    const isSec = field.endsWith('Ss');
    const candidate = isSec ? Math.max(0, Math.min(59, current + delta)) : Math.max(0, current + delta);

    // 開始・終了が逆転しないようにクロス制約を適用する
    const startTotal = parseInt(v.startMm, 10) * 60 + parseInt(v.startSs, 10);
    const endTotal = parseInt(v.endMm, 10) * 60 + parseInt(v.endSs, 10);
    const isStart = field.startsWith('start');
    if (isStart) {
      const newStart = (field === 'startMm' ? candidate : parseInt(v.startMm, 10)) * 60
        + (field === 'startSs' ? candidate : parseInt(v.startSs, 10));
      if (newStart > endTotal) return;
    } else {
      const newEnd = (field === 'endMm' ? candidate : parseInt(v.endMm, 10)) * 60
        + (field === 'endSs' ? candidate : parseInt(v.endSs, 10));
      if (newEnd < startTotal) return;
    }

    this.editingTimeValues.update((cur) => ({ ...cur, [field]: isSec ? String(candidate).padStart(2, '0') : String(candidate) }));
  }

  onTimeInputChange(value: string, field: 'startMm' | 'startSs' | 'endMm' | 'endSs'): void {
    const numeric = value.replace(/[^0-9]/g, '');
    this.editingTimeValues.update((v) => ({ ...v, [field]: numeric }));
  }

  requestRemoveSegment(segmentId: number): void {
    this.openConfirmDialog({
      actionKind: 'removeSegment',
      title: '削除の確認',
      message: 'この行を削除しますか？',
      confirmLabel: '削除する',
      cancelLabel: 'キャンセル',
      confirmColor: 'warn',
      cancelColor: null,
      segmentId
    });
  }

  private openConfirmDialog(dialog: ConfirmDialogState): void {
    this.pendingConfirmDialog.set(dialog);
  }

  confirmDialogButtonClass(color: ConfirmDialogColor, role: 'confirm' | 'cancel'): string {
    const roleClass = role === 'confirm' ? 'confirm-dialog-btn-confirm' : 'confirm-dialog-btn-cancel';
    const colorClass = color ? ` confirm-dialog-btn-${color}` : '';
    return `confirm-dialog-btn ${roleClass}${colorClass}`;
  }

  scrollToTop(): void {
    this.activeSegmentViewport?.scrollToOffset(0, 'smooth');
  }

  scrollToMiddle(): void {
    const el = this.activeSegmentViewport?.elementRef.nativeElement as HTMLElement | undefined;
    if (!el) return;
    this.activeSegmentViewport?.scrollToOffset((el.scrollHeight - el.clientHeight) / 2, 'smooth');
  }

  scrollToBottom(): void {
    const el = this.activeSegmentViewport?.elementRef.nativeElement as HTMLElement | undefined;
    if (!el) return;
    this.activeSegmentViewport?.scrollToOffset(el.scrollHeight - el.clientHeight, 'smooth');
  }

}
