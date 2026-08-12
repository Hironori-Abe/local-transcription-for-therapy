import { CommonModule } from '@angular/common';
import { ApplicationRef, ChangeDetectionStrategy, Component, AfterViewInit, HostListener, NgZone, OnDestroy, OnInit, QueryList, ViewChildren, computed, isDevMode, signal } from '@angular/core';
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
import { MatMenuModule } from '@angular/material/menu';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatSelectModule } from '@angular/material/select';
import { MatDialog, MatDialogModule } from '@angular/material/dialog';
import { MatSnackBar, MatSnackBarModule, MatSnackBarRef } from '@angular/material/snack-bar';
import { PasswordDialogComponent } from './password-dialog.component';
import { PlaybackControlSnackbarComponent } from './playback-control-snackbar.component';
import { ProgressSnackbarComponent } from './progress-snackbar.component';
import { PreserveUndoValueDirective } from './preserve-undo-value.directive';
import { BestEffortBrowserStorage, loadAudioMetadataDuration } from './browser-adapters';
import {
  type AppSettingsV1,
  type LlmBackendMode,
  type LlmGpuMode,
  type LlmPromptType,
  type ThemeMode
} from './app-settings';
import {
  appendRuntimeEstimateSampleValue,
  aggregateDownloadProgressPercentValue,
  arrayBufferToBase64Value,
  buildDefaultExportFileName,
  buildDocxExportRowsValue,
  buildFinalInitialPromptValue,
  buildInitialSpeakerAliasMapValue,
  buildInitialSpeakerSelectionMapValue,
  buildLlmInferenceParamsKeyValue,
  buildLocationDetectionScopeValue,
  buildConsecutiveSpeakerRunMapValue,
  buildSegmentRowNumberMapValue,
  buildSrtExportRowsValue,
  buildXlsxExportRowsValue,
  buildUniqueSpeakersValue,
  buildVoiceInputContextValue,
  canSaveOverallProofreadSystemPromptValue,
  calculateRuntimeEstimateValue,
  changedRangeEndValue,
  coalescingInputKindValue,
  countSubstringOccurrencesValue,
  computeEnvBackendLabelValue,
  confirmDialogButtonClassValue,
  displaySpeakerValue,
  downloadProgressBytesLabelValue,
  downloadProgressPercentValue,
  editorVoiceInputDownloadButtonColorValue,
  editorVoiceInputMemoryTierValue,
  editorVoiceInputMemoryWarningValue,
  editorVoiceInputUnavailableTooltipValue,
  encodePcm16WavValue,
  formatAudioDurationValue,
  formatElapsedMinuteSecondValue,
  formatEstimatedMinutesValue,
  formatMinuteSecondValue,
  formatOverallProofreadProgressValue,
  filterOverallProofreadVisibleItemsValue,
  generateNextSegmentIdValue,
  getAudioPreprocessPresetHintValue,
  getAudioPreprocessSettingsForPresetValue,
  getAudioDurationMessageValue,
  getEditableTextFromMapValue,
  getEstimatedTimeMessageValue,
  getImportCompletedMessageValue,
  getLlmModelFileNameValue,
  getStoredLlmInferenceParamsValue,
  getProgressStageOrderValue,
  getLocationAreaPrefectureCodesValue,
  getSpeakerColorClassValue,
  gpuDeviceLabelValue,
  gpuSetupHintValue,
  hasFallbackInTranscriptionResultValue,
  isGemma4DefaultLlmModelFileNameValue,
  isGemma4DefaultLlmModelPathValue,
  isDiarizationModelMissingValue,
  isJapaneseLanguageValue,
  isPlaybackDisabledValue,
  isVramOomErrorValue,
  levenshteinDistanceValue,
  llmBackendModeHintValue,
  llmBackendModeOptionsValue,
  llmBackendSelectionValue,
  llmNCtxHintValue,
  llmParallelHintValue,
  matchPlaybackShortcutCodeValue,
  mergeFloat32ChunksValue,
  normalizeComputeTypeValue,
  normalizeDevEmulationModeValue,
  normalizeErrorMessageValue,
  normalizeLlmMaxBatchValue,
  normalizeLlmNCtxValue,
  normalizeLlmParallelValue,
  normalizeLocationAreaValue,
  normalizeSpeakerKeyValue,
  normalizeTimeInputValue,
  normalizeLocationPrefectureCodesValue,
  mergeSegmentTextValue,
  normalizeProofreadChunkMaxCharsValue,
  normalizeProofreadChunkSizeValue,
  normalizeThemeModeValue,
  normalizeTranscriptionDeviceValue,
  normalizeTranscriptionLanguageValue,
  normalizeVoiceInputErrorMessageValue,
  needsFullSetupValue,
  parallelModeHintValue,
  parseRuntimeEstimateSamplesValue,
  pickRuntimeEstimateSamplesValue,
  resolveRuntimeLogAudioSecondsValue,
  resolveEstimateComputeTypeValue,
  resolveGeneralAppSettingsValue,
  resolveLlmAppSettingsValue,
  resolvePersistedLlmBackendModeValue,
  resolveTimeInputRangeValue,
  resamplePcmTo16kValue,
  resolveAudioPreprocessPresetValue,
  resolveLlmDeviceVramMibValue,
  resolveLlmInstallableGpuEntryValue,
  resolveLlmTargetBackendKeyValue,
  resolveStepForStageValue,
  shouldShowVoiceInputShortCandidateHintValue,
  showProofreadSystemPromptEditorValue,
  selectedFileNameValue,
  selectedLocationPrefectureTotalCountValue,
  segmentRetranscribeTooltipValue,
  segmentRetranscribeUnavailableReasonValue,
  selectedGpuAsrWarningValue,
  speakerOptionLabelValue,
  stepTimeInputValuesValue,
  setupNeedsHfTokenValue,
  locationDetectionScopeHintValue,
  themeModeLabelValue,
  themeToggleIconValue,
  transcriptionTabDisabledValue,
  transcriptionTabLabelValue,
  updateLlmSelectionSettingsValue,
  updateStoredLlmInferenceParamsValue,
  validateHfTokenFormatValue,
  voiceInputButtonTooltipValue,
  processingStatusTextValue,
  type AudioPreprocessPreset,
  type ConcreteComputeType,
  type DocumentExportSourceRow,
  type LocationAreaCode,
  type LocationDetectionScope,
  type NoiseReductionMode,
  type RuntimeEstimateSample,
  type EditorVoiceInputMemoryTierValue
} from './app-utils';
import {
  buildDiarizationEditedTextMapValue,
  buildExportTranscriptionPayloadValue,
  buildProofreadHintValue,
  describeProofreadDiffReasonValue,
  getSensitiveEntityHighlightLevelValue,
  isPunctuationOnlyProofreadReasonValue,
  normalizeProofreadMetadataValue,
  parseImportedTranscriptionJsonValue,
  reconcileRetranscriptionStateValue,
  type ExportProofreadMetadata,
  type ExportTranscriptionPayload,
  type ProofreadHighlightLevel,
  type SensitiveEntityHighlightInput
} from './proofread-metadata.utils';
import { MatTabsModule } from '@angular/material/tabs';
import { MatToolbarModule } from '@angular/material/toolbar';
import { MatTooltipModule } from '@angular/material/tooltip';
import { save, open } from '@tauri-apps/plugin-dialog';
import { getVersion } from '@tauri-apps/api/app';
import { invoke } from '@tauri-apps/api/core';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import { environment } from '../environments/environment';

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

interface ReadFileSizeResponse {
  sizeBytes: number;
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
type TranscriptionDeviceOption = 'cuda' | 'cpu';
interface ProofreadSegmentInput {
  id: number;
  text: string;
  speaker?: string | null;
  speakerLabel?: string | null;
  start?: number;
  end?: number;
  words?: TranscriptionSegmentWord[];
}

// 「AI校正バックエンド」セレクタの UI 上の選択肢。内蔵モデルは E4B / 12B の
// 2階層を別項目として見せるが、内部的にはどちらも backendMode='local_gguf' で、
// 階層は proofreadModelTier（'e4b' / '12b'）で表す。'local_gguf_12b' は CUDA 版のみ。
type LlmBackendSelection = LlmBackendMode | 'local_gguf_12b';

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
type CancelRunKind = 'transcription' | 'transcriptionPipeline' | 'proofread' | 'diarization' | 'llmProofread';
type ConfirmDialogActionKind = 'removeSegment' | 'cancelRun' | 'mergeUtterances' | 'importJsonOverwrite' | 'startTranscriptionConfirm' | 'resetOverallProofreadSystemPrompt' | 'gemmaNotFoundBeforeTranscription' | 'overallProofreadBeforeMerge' | 'downloadGemma12bForOverallProofread' | 'lowerLlmParallelOnOom' | 'installVoiceInputPackLowMemory' | 'enableVoiceInputLowMemory';
type ConfirmDialogColor = 'primary' | 'accent' | 'warn' | null;
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

interface AmdGpuFailureDialogState {
  operation: string;
  message: string;
}

interface LlmModelEntry {
  name: string;
  path: string;
}

interface LlmBackendEntry {
  label: string;
  state: 'installed' | 'installable' | 'update_required';
  category: 'gpu' | 'npu' | 'cpu';
  installKey: string;
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

interface SegmentTextHistoryEntry {
  before: string;
  after: string;
  beforeCaret: number;
  afterCaret: number;
  inputKind: string;
  timestamp: number;
}

interface SegmentTextHistory {
  undo: SegmentTextHistoryEntry[];
  redo: SegmentTextHistoryEntry[];
}

@Component({
  selector: 'app-root',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
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
    MatMenuModule,
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
    PreserveUndoValueDirective,
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
  readonly cpuOnlyBuild = environment.cpuOnly === true;
  readonly aiProofreadBuild = !this.editorOnlyBuild && !this.cpuOnlyBuild;
  readonly cpuVoiceInputBuild = this.editorOnlyBuild || this.cpuOnlyBuild;
  readonly isDevModeBuild = isDevMode();
  readonly appDisplayName = this.editorOnlyBuild
    ? 'Local Transcription for Therapy (LoTT) (Editor)'
    : this.cpuOnlyBuild
      ? 'Local Transcription for Therapy (LoTT) (CPU)'
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
  readonly diarizationDevice = signal<TranscriptionDeviceOption>(this.cpuOnlyBuild ? 'cpu' : 'cuda');
  readonly computeType = signal<ComputeTypeOption>(this.cpuOnlyBuild ? 'float32' : 'auto');
  readonly whisperModel = signal<string>('turbo');
  readonly transcriptionLanguage = signal<string>('ja');
  readonly transcriptionDevice = signal<TranscriptionDeviceOption>(this.cpuOnlyBuild ? 'cpu' : 'cuda');
  // 編集UIの「+、」「+。」ボタンが挿入する句読点。日本語のときは全角（、。）、
  // それ以外の言語では半角（, .）。判定は結果が実際に文字起こしされた言語を優先し、
  // 無ければ現在の言語設定にフォールバックする。
  readonly editPunctuationIsJapanese = computed<boolean>(() => {
    const lang = (this.result()?.settings?.language ?? this.transcriptionLanguage() ?? 'ja').toLowerCase();
    return isJapaneseLanguageValue(lang);
  });
  readonly initialPrompt = signal<string>('');
  readonly baseInitialPrompt = signal<string>('');
  readonly running = signal<boolean>(false);
  /** 文字起こし開始ボタンから連続実行する、話者分離・AI句読点・固有名詞確認までの全工程。 */
  readonly transcriptionPipelineRunning = signal<boolean>(false);
  readonly transcriptionPipelineCanceling = signal<boolean>(false);
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
  readonly buildVariant = signal<'cuda' | 'rocm' | 'cpu'>(this.cpuOnlyBuild ? 'cpu' : 'cuda');
  /** Rustが返す実行OS。GPU導入案内をLinux/Windowsで分離するために使う。 */
  readonly runtimePlatform = signal<'windows' | 'linux' | 'macos' | 'other' | 'unknown'>('unknown');
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
    normalizeDevEmulationModeValue(this.appSettings.devEmulation?.mode) === 'no_cuda'
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
  readonly llmServerStatus = signal<'unknown' | 'running' | 'stopped' | 'starting' | 'not_installed' | 'error'>('unknown');
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
    this.aiProofreadBuild && this.llmBackendMode() === 'local_gguf'
  );
  // Lemonade が必要な場面でバックエンドバイナリが未インストールのとき非 null を返す。
  // GPU 検出結果に基づいて適切なバックエンドを自動選択する。
  // 「不要」（lemonadeBackendNotNeeded=true）が押されたときは null を返してプロンプトを抑制。
  readonly llmInstallableGpuEntry = computed<LlmBackendEntry | null>(() => {
    return resolveLlmInstallableGpuEntryValue(
      this.llmEngineUiVisible(),
      this.lemonadeBackendNotNeeded(),
      this.llmGpuBackendInstalled(),
      this.llmGpuMode(),
      this.cudaAvailable() === true,
      this.rocmAvailable() === true
    );
  });
  // インストール済みかどうかに関わらず、GPU モードから期待されるバックエンドキーを返す
  readonly llmTargetBackendKey = computed(() => {
    return resolveLlmTargetBackendKeyValue(
      this.llmGpuMode(),
      this.cudaAvailable() === true,
      this.rocmAvailable() === true
    );
  });

  readonly llmBackendModeHint = computed(() => {
    return llmBackendModeHintValue(
      this.llmBackendMode(),
      this.proofreadModelTier(),
      this.gemma12bInstalled()
    );
  });
  readonly availableLlmModels = signal<LlmModelEntry[]>([]);
  /** コンテキスト長(n_ctx)。0=自動（VRAMで判定 / CUDAサーバーの--ctx-size）。手動値で上書き可。 */
  readonly llmNCtx = signal<number>(0);
  readonly llmMaxBatch = signal<number>(40);
  /** 選択中のLLM用GPUデバイスのVRAM(MiB)。不明なら null。自動判定の現在値ヒントに使う。 */
  readonly llmDeviceVramMib = computed<number | null>(() => {
    const info = this.computeEnvInfo();
    return resolveLlmDeviceVramMibValue(
      info?.devices ?? [],
      this.selectedLlmHipDeviceIndex(),
      info?.recommendedIndex
    );
  });
  /** 並列処理数フィールドのヒント。自動(0)選択時のみ、VRAMから解決した実値（Rust choose_llm_parallelism 相当）を表示。手動値は空（非表示）。 */
  readonly llmParallelHint = computed<string>(() => {
    return llmParallelHintValue(
      this.selectedLlmParallel(),
      this.computeEnvInfo()?.backendType,
      this.llmDeviceVramMib()
    );
  });
  /** コンテキスト長フィールドのヒント。自動(0)選択時のみ、VRAM/バックエンドから解決した実値を表示。手動値は空（非表示）。 */
  readonly llmNCtxHint = computed<string>(() => {
    return llmNCtxHintValue(
      this.llmNCtx(),
      this.llmBackendMode(),
      this.computeEnvInfo()?.backendType,
      this.llmDeviceVramMib()
    );
  });
  readonly llmPromptType = signal<LlmPromptType>('gemma4');
  readonly proofreadSystemPrompt = signal<string>('');
  readonly fixedProofreadSystemPrompt = signal<string>('');
  readonly defaultProofreadSystemPrompt = signal<string>('');
  readonly proofreadSystemPromptReadonly = computed(() =>
    this.llmBackendMode() === 'local_gguf' && isGemma4DefaultLlmModelPathValue(this.llmModelPath())
  );
  readonly showProofreadSystemPromptEditor = computed(() => {
    return showProofreadSystemPromptEditorValue(
      this.proofreadSystemPromptReadonly(),
      this.llmBackendMode(),
      this.llmModelPath()
    );
  });
  readonly overallProofreadSystemPrompt = signal<string>('');
  readonly fixedOverallProofreadSystemPrompt = signal<string>('');
  readonly defaultOverallProofreadSystemPrompt = signal<string>('');
  private readonly overallPromptSaveVersion = signal(0);
  readonly canSaveOverallProofreadSystemPrompt = computed(() => {
    return canSaveOverallProofreadSystemPromptValue(
      this.proofreadSystemPromptReadonly(),
      this.llmBackendMode(),
      this.activeOpenAiModelInput(),
      this.llmModelPath()
    );
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
    const key = getLlmModelFileNameValue(this.llmModelPath());
    if (!key || isGemma4DefaultLlmModelFileNameValue(key)) return false;
    return typeof this.appSettings.llm?.overallSystemPromptsByModelFileName?.[key] === 'string';
  });
  readonly llmSegmentStatus = signal<Record<number, 'processing' | 'done'>>({});
  readonly proofreadProgressText = signal<string>('');
  readonly diarizationPhaseActive = signal<boolean>(false);
  readonly diarizationStage = signal<string>('');
  readonly progressSnackbarVisible = signal<boolean>(false);
  readonly processingStatusText = computed(() => {
    return processingStatusTextValue({
      visible: this.progressSnackbarVisible(),
      transcriptionRunning: this.running(),
      displayProgress: this.displayProgress(),
      diarizationPhaseActive: this.diarizationPhaseActive(),
      diarizationStage: this.diarizationStage(),
      parallelDiarizationStatus: this.parallelDiarizationStatus(),
      llmProofreadRunning: this.llmProofreadRunning(),
      llmProofreadStatus: this.llmProofreadStatus(),
      ruleProofreadRunning: this.proofreadRunning(),
      cpuOnlyBuild: this.cpuOnlyBuild,
      ruleProofreadProgressText: this.proofreadProgressText(),
      ruleProofreadStatus: this.proofreadStatus()
    });
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
  readonly amdGpuFailureDialog = signal<AmdGpuFailureDialogState | null>(null);
  readonly proofreadHintBySegmentId = signal<Record<number, string>>({});
  readonly proofreadMetadataBySegmentId = signal<Record<number, ExportProofreadMetadata>>({});
  readonly proofreadUpdatedCount = signal<number>(0);
  readonly proofreadCompleted = signal<boolean>(false);
  readonly proofreadChunkSize = signal<number>(12);
  readonly proofreadChunkMaxChars = signal<number>(1200);
  readonly selectedLocationArea = signal<LocationAreaCode>('kanto');
  readonly selectedLocationPrefectures = signal<string[]>([]);
  readonly selectedLocationPrefecturesByArea = signal<Partial<Record<LocationAreaCode, string[]>>>({});
  readonly filteredLocationPrefectureOptions = computed(() => {
    const areaCodes = new Set(getLocationAreaPrefectureCodesValue(this.selectedLocationArea()));
    return this.locationPrefectureOptions.filter((option) => areaCodes.has(option.value));
  });
  readonly selectedLocationPrefectureTotalCount = computed(() => {
    return selectedLocationPrefectureTotalCountValue(
      this.selectedLocationPrefecturesByArea(),
      this.selectedLocationPrefectures()
    );
  });
  readonly locationDetectionScopeHint = computed(() =>
    locationDetectionScopeHintValue(this.selectedLocationPrefectureTotalCount())
  );
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
    return filterOverallProofreadVisibleItemsValue(
      this.overallProofreadResult()?.items,
      this.overallProofreadDismissedIds()
    );
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
    if (this.overallProofreadBtnAboveViewport() !== scrolledPast) {
      this.ngZone.run(() => this.overallProofreadBtnAboveViewport.set(scrolledPast));
    }
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
  private readonly segmentTextHistory = new Map<number, SegmentTextHistory>();
  private readonly segmentTextHistoryLimit = 200;
  private readonly segmentTextHistoryMergeWindowMs = 1000;
  readonly playingSegmentId = signal<number | null>(null);
  readonly playbackRateOptions = [0.4, 0.6, 0.8, 1.0, 1.2, 1.4, 1.6 /*, 1.8, 2.0 */];
  readonly playbackRate = signal<number>(1.0);
  readonly shortcutHints: ReadonlyArray<string> = [
    'Ctrl+Shift+F（置換）',
    'Ctrl+Shift+Space（連続再生 / 停止）',
    'Ctrl+Shift+A（5秒戻す）',
    'Ctrl+Shift+D（5秒進める）',
    'Ctrl+Shift+E（話者を切替）',
    'Ctrl+Shift+M（音声入力）'
  ];
  // 全ヒントを最初から描画し、CSS の合成レイヤー内だけで切り替える。
  // 実行中に Angular signal や textContent を更新しないことで、sticky な編集画面全体の
  // Layout / Paint を避ける。
  readonly shortcutHintDisplaySeconds = 5;
  readonly shortcutHintFadeSeconds = 0.5;
  readonly shortcutHintCycleDuration = `${this.shortcutHints.length * this.shortcutHintDisplaySeconds}s`;
  readonly shortcutHintsAriaLabel = `キーボードショートカットのヒント: ${this.shortcutHints.join('、')}`;
  readonly hiddenSegmentIds = signal<Record<number, boolean>>({});
  readonly diarizationModelChecked = signal<boolean>(false);
  readonly diarizationModelExists = signal<boolean>(true);
  readonly diarizationModelHasConfig = signal<boolean>(true);
  readonly diarizationModelExpectedPath = signal<string>('');
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
  readonly editorVoiceInputMemoryTier = computed<EditorVoiceInputMemoryTierValue>(() =>
    editorVoiceInputMemoryTierValue(
      this.cpuVoiceInputBuild,
      this.editorInstalledMemoryChecked(),
      this.editorInstalledMemoryBytes(),
      this.editorVoiceInputMinimumMemoryBytes,
      this.editorVoiceInputRecommendedMemoryBytes
    )
  );
  readonly editorVoiceInputMemoryAllowed = computed(
    () => !this.cpuVoiceInputBuild
      || this.editorVoiceInputMemoryTier() !== 'low'
      || this.editorLowMemoryVoiceInputOptIn()
  );
  readonly editorVoiceInputButtonsVisible = computed(
    () => this.isTauriRuntime() && this.editorVoiceInputMemoryAllowed()
  );
  readonly editorVoiceInputMemoryWarning = computed<string | null>(() =>
    editorVoiceInputMemoryWarningValue(this.editorVoiceInputMemoryTier())
  );
  readonly editorVoiceInputDownloadButtonColor = computed<'primary' | 'warn'>(
    () => editorVoiceInputDownloadButtonColorValue(
      this.cpuVoiceInputBuild,
      this.editorVoiceInputMemoryTier()
    )
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
  readonly editorVoiceInputUnavailableTooltip = computed(() =>
    editorVoiceInputUnavailableTooltipValue(this.editorVoiceInputPackChecked())
  );
  readonly editorVoiceInputDevControlsVisible = computed(
    () => this.isDevModeBuild && this.isTauriRuntime()
  );
  readonly editorVoiceInputInstallPercent = computed(() => {
    return aggregateDownloadProgressPercentValue(Object.values(this.editorVoiceInputPackProgressMap()));
  });
  readonly needsFullSetup = computed(() => {
    return needsFullSetupValue({
      editorOnlyBuild: this.editorOnlyBuild,
      tauriRuntime: this.isTauriRuntime(),
      setupChecked: this.allSetupChecked(),
      status: this.allSetupStatus(),
      transcriptionTabVisible: this.transcriptionTabVisible(),
      aiProofreadBuild: this.aiProofreadBuild,
      buildVariant: this.buildVariant()
    });
  });
  readonly transcriptionTabDisabled = computed(() => {
    return transcriptionTabDisabledValue({
      transcriptionTabVisible: this.transcriptionTabVisible(),
      editorOnlyBuild: this.editorOnlyBuild,
      setupChecked: this.allSetupChecked(),
      devEmulationMode: normalizeDevEmulationModeValue(this.appSettings.devEmulation?.mode),
      cpuOnlyBuild: this.cpuOnlyBuild,
      needsFullSetup: this.needsFullSetup(),
      pythonEnvReady: this.allSetupStatus()?.pythonEnv === true,
      transcriptionRuntimeAvailable: this.transcriptionRuntimeAvailable()
    });
  });

  readonly setupNeedsHfToken = computed(() => {
    const s = this.allSetupStatus();
    return setupNeedsHfTokenValue(
      s !== null,
      this.transcriptionTabVisible(),
      s?.diarization === true,
      this.diarizationInstallToken()
    );
  });

  readonly segmentRowFilter = signal<'all' | 'caution' | 'caution_context'>('all');
  readonly parallelMode = signal<'standard' | 'fast'>('standard');
  readonly clusteringAdjust = signal<'standard' | 'over_split' | 'under_split'>('standard');
  readonly parallelModeHint = computed(() => parallelModeHintValue(this.parallelMode()));
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
    return resolveAudioPreprocessPresetValue({
      highpassFilter: this.highpassFilter(),
      noiseReduction: this.noiseReduction(),
      normalizeAudio: this.normalizeAudio(),
      noiseReductionMode: this.noiseReductionMode()
    });
  });
  readonly audioPreprocessPresetHint = computed<string>(() =>
    getAudioPreprocessPresetHintValue(this.audioPreprocessPreset())
  );
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
    return downloadProgressPercentValue(this.largeV3DownloadProgress());
  });
  readonly largeV3DownloadBytesLabel = computed(() => {
    return downloadProgressBytesLabelValue(this.largeV3DownloadProgress());
  });
  // 内蔵校正AIモデルの階層選択（CUDA版のみ）。'e4b'=標準（既定）、'12b'=高精度（後からDL）。
  readonly proofreadModelTier = signal<'e4b' | '12b'>('e4b');
  readonly gemma12bInstalled = signal<boolean | null>(null);
  readonly gemma12bDownloading = signal<boolean>(false);
  readonly gemma12bDownloadMessage = signal<string>('');
  readonly gemma12bDownloadProgress = computed<SetupProgressEvent | undefined>(() => this.setupProgressMap()['gemma_12b']);
  readonly gemma12bDownloadPercent = computed(() => {
    return downloadProgressPercentValue(this.gemma12bDownloadProgress());
  });
  readonly gemma12bDownloadBytesLabel = computed(() => {
    return downloadProgressBytesLabelValue(this.gemma12bDownloadProgress());
  });
  /**
   * 12B（高精度）関連 UI（説明アイコン・ダウンロード進捗）の表示条件:
   * CUDA版・Editor版以外・内蔵バックエンド時のみ。階層選択自体は
   * 「AI校正バックエンド」セレクタ（llmBackendSelection）へ統合済み。
   */
  readonly proofreadModelTierVisible = computed<boolean>(() =>
    this.aiProofreadBuild && this.llmBackendMode() === 'local_gguf'
  );
  readonly whisperModelOptions = computed<ReadonlyArray<{ value: string; label: string }>>(() => [
    { value: 'turbo', label: 'turbo（高速・既定）' },
    { value: 'large-v3', label: 'large-v3（高精度）' },
    // { value: 'medium', label: 'medium' },
    // { value: 'small', label: 'small' },
    // { value: 'base', label: 'base（最軽量）' },
  ]);
  readonly computeTypeOptions: ReadonlyArray<{ value: ComputeTypeOption; label: string }> = this.cpuOnlyBuild
    ? [
        { value: 'auto', label: 'auto（CPU向け自動推定）' },
        { value: 'int8', label: 'int8（軽量）' },
        { value: 'float32', label: 'float32（高精度だが重い）' }
      ]
    : [
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
    return llmBackendModeOptionsValue(this.aiProofreadBuild, this.localLlmAppsEnabled());
  });
  /**
   * 「AI校正バックエンド」セレクタの現在値（UI 表示用）。
   * 内蔵モデルかつ CUDA 版で 12B 階層なら 'local_gguf_12b' を返し、それ以外は backendMode そのもの。
   */
  readonly llmBackendSelection = computed<LlmBackendSelection>(() =>
    llmBackendSelectionValue(this.llmBackendMode(), this.proofreadModelTier())
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
  private overallProofreadProgressCurrent = 0;
  private overallProofreadProgressStarted = false;
  private _gemmaCheckBypassed = false;
  private progressSnackBarRef: MatSnackBarRef<ProgressSnackbarComponent> | null = null;
  private progressUnlisten: UnlistenFn | null = null;
  private parallelDiarUnlisten: UnlistenFn | null = null;
  private voiceInputPackProgressUnlisten: UnlistenFn | null = null;
  private playbackTranscodeUnlisten: UnlistenFn | null = null;
  private playbackTranscodeSnackBarRef: MatSnackBarRef<ProgressSnackbarComponent> | null = null;
  private readonly playbackTranscodePercent = signal(0);
  private readonly playbackTranscodeStatusText = computed(
    () => `再生用に音声を変換しています（初回のみ）… ${this.playbackTranscodePercent()}%`
  );
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
  // Ctrl+Shift+Space による一時停止状態。stop（完全停止）とは別に扱う。
  private previewPaused = false;
  private readonly shortcutSeekSeconds = 5;
  private shortcutFocusRetryTimer: ReturnType<typeof setTimeout> | null = null;
  private sequenceSnackBarRef: MatSnackBarRef<PlaybackControlSnackbarComponent> | null = null;
  private previewLoopEnabled = false;
  private previewSequenceSegmentIds: number[] = [];
  private previewSequenceIndex = -1;

  private previewStartSeconds: number | null = null;
  private previewEndSeconds: number | null = null;
  private seekPlayGeneration = 0;
  private pendingOverallProofreadTier: 'e4b' | '12b' = 'e4b';
  private pendingImportedPayload: ExportTranscriptionPayload | null = null;
  // undefined = 未取得, null = 存在しない, string = パス
  private devDemoDataDir: string | null | undefined = undefined;
  readonly devDeletingModels = signal(false);
  readonly devDeleteModelsResult = signal<{ deleted: string[]; notFound: string[]; errors: string[] } | null>(null);
  readonly devDeleteTarget = signal<'all' | 'whisper_turbo' | 'whisper_large_v3' | 'diarization' | 'llm'>('all');
  private readonly estimateMinRequired = 5;
  private readonly estimateStorageKey = 'offline_transcriber_runtime_estimate_samples_v2';
  private readonly appSettingsStorageKey = 'offline_transcriber_app_settings_v1';
  private readonly browserStorage = new BestEffortBrowserStorage();
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

  // ===== 画面テーマ（システム / ライト / ダーク） =====
  readonly themeMode = signal<ThemeMode>('system');
  /** OS 側のダークモード設定。system モードのときの実効テーマ判定に使う。 */
  readonly systemPrefersDark = signal(false);
  readonly themeIsDark = computed(
    () => this.themeMode() === 'dark' || (this.themeMode() === 'system' && this.systemPrefersDark())
  );
  readonly themeToggleIcon = computed(() => themeToggleIconValue(this.themeMode()));
  readonly themeToggleTooltip = computed(
    () => `表示テーマ: ${themeModeLabelValue(this.themeMode())}（クリックで切り替え）`
  );
  private systemDarkQuery: MediaQueryList | null = null;
  private readonly _onSystemThemeChange = (event: MediaQueryListEvent): void => {
    this.ngZone.run(() => this.systemPrefersDark.set(event.matches));
  };

  get segmentRows(): ReadonlyArray<TranscriptionSegment> {
    return this._segmentRowsComputed();
  }

  readonly segmentRowNumberMap = computed<Record<number, number>>(() => {
    return buildSegmentRowNumberMapValue(this.result()?.segments ?? [], this.hiddenSegmentIds());
  });

  // 同一話者が連続するランの先頭セグメントIDに合計セグメント数を格納する。
  // 非表示セグメントも含めた生データで判定し、5未満のランは記録しない。
  readonly consecutiveSpeakerRunMap = computed<Record<number, number>>(() => {
    const segments = this.result()?.segments ?? [];
    return buildConsecutiveSpeakerRunMapValue(
      segments,
      (segment) => this.getAssignedSpeakerKey(segment)
    );
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
    return buildUniqueSpeakersValue(this._segmentRowsComputed(), this.selectedSpeakerBySegmentId());
  });

  get displayedSegmentRows(): ReadonlyArray<TranscriptionSegment> {
    return this._displayedSegmentRowsComputed();
  }

  get selectedAudioFileName(): string {
    return selectedFileNameValue(this.selectedAudioPath());
  }

  get gpuSetupHint(): string {
    return gpuSetupHintValue(this.result()?.fallbackUsed === true, this.error());
  }

  private buildFinalInitialPrompt(): string {
    return buildFinalInitialPromptValue(this.baseInitialPrompt(), this.initialPrompt());
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
    return normalizeErrorMessageValue(error);
  }

  private buildProofreadHint(
    originalText: string,
    revisedText: string,
    reasonRaw: string,
    sensitiveEntityRaw?: unknown
  ): string {
    return buildProofreadHintValue(originalText, revisedText, reasonRaw, sensitiveEntityRaw);
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
    return describeProofreadDiffReasonValue(prev, revised);
  }

  private normalizeProofreadMetadata(
    originalTextRaw: string,
    revisedTextRaw: string,
    confidenceRaw: number,
    reasonRaw: string,
    sensitiveEntityRaw?: unknown,
    lintIssuesRaw?: unknown
  ): ExportProofreadMetadata {
    return normalizeProofreadMetadataValue(
      originalTextRaw,
      revisedTextRaw,
      confidenceRaw,
      reasonRaw,
      sensitiveEntityRaw,
      lintIssuesRaw
    );
  }

  private getSensitiveEntityHighlightLevel(sensitive?: SensitiveEntityHighlightInput): ProofreadHighlightLevel {
    return getSensitiveEntityHighlightLevelValue(sensitive);
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
    return normalizeProofreadChunkSizeValue(value);
  }

  private normalizeProofreadChunkMaxChars(value: number): number {
    return normalizeProofreadChunkMaxCharsValue(value);
  }

  private isPunctuationOnlyProofreadReason(reasonRaw: string): boolean {
    return isPunctuationOnlyProofreadReasonValue(reasonRaw);
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

  formatEstimatedMinutes(minutes: number | null): string {
    return formatEstimatedMinutesValue(minutes);
  }

  formatAudioDuration(seconds: number | null): string {
    return formatAudioDurationValue(seconds);
  }

  getAudioDurationMessage(): string {
    return getAudioDurationMessageValue(this.estimatingTime(), this.estimatedAudioSeconds());
  }

  getEstimatedTimeMessage(): string {
    return getEstimatedTimeMessageValue({
      estimating: this.estimatingTime(),
      audioSeconds: this.estimatedAudioSeconds(),
      estimateReady: this.estimateReady(),
      sampleCount: this.estimateSampleCount(),
      minimumSamples: this.estimateMinRequired,
      minMinutes: this.estimatedMinMinutes(),
      avgMinutes: this.estimatedAvgMinutes()
    });
  }

  getEstimatedTimeLabel(): string {
    return `文字起こし推定所要時間（${this.resolveEstimateComputeType()}）`;
  }

  private async updateEstimatedTimeFromPath(path: string): Promise<void> {
    this.estimatingTime.set(true);
    try {
      const duration = await this.loadAudioDurationForPath(path);
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

  /**
   * 再生時間は同梱 LGPL ffmpeg で取得する。ファイル選択の時点では再生用の変換を走らせず、
   * WebView がその形式を再生できるかどうかにも依存させない。
   * ffmpeg が解決できない構成のときだけ、従来どおり WebView 側で読む。
   */
  private async loadAudioDurationForPath(path: string): Promise<number> {
    if (this.isTauriRuntime()) {
      try {
        const seconds = await invoke<number>('get_audio_duration_seconds', { path });
        if (Number.isFinite(seconds) && seconds > 0) {
          return seconds;
        }
      } catch {
        // ffmpeg 未解決などのときは WebView 側の読み取りへフォールバックする
      }
    }
    const src = await this.resolvePlayableAudioSrc(path);
    return loadAudioMetadataDuration(src);
  }

  private async updateEstimatedTimeFromFile(file: File): Promise<void> {
    this.estimatingTime.set(true);
    const objectUrl = URL.createObjectURL(file);
    try {
      const duration = await loadAudioMetadataDuration(objectUrl);
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
    const estimate = calculateRuntimeEstimateValue(durationSeconds, samples, this.estimateMinRequired);
    this.estimateReady.set(estimate.ready);
    this.estimatedMinMinutes.set(estimate.minMinutes);
    this.estimatedAvgMinutes.set(estimate.avgMinutes);
    this.estimatedAvgSeconds.set(estimate.avgSeconds);
  }

  private loadEstimateSamples(): void {
    const raw = this.browserStorage.readText(this.estimateStorageKey);
    this.estimateSamples = parseRuntimeEstimateSamplesValue(raw, this.cpuOnlyBuild);
  }

  private persistEstimateSamples(): void {
    this.browserStorage.writeJson(this.estimateStorageKey, this.estimateSamples);
  }

  private loadAppSettings(): void {
    this.appSettings = this.browserStorage.readObject<AppSettingsV1>(this.appSettingsStorageKey) ?? {};
  }

  private persistAppSettings(): void {
    this.browserStorage.writeJson(this.appSettingsStorageKey, this.appSettings);
  }

  private applyAppSettings(): void {
    const general = resolveGeneralAppSettingsValue(this.appSettings, {
      cpuOnlyBuild: this.cpuOnlyBuild,
      transcriptionLanguageOptions: this.transcriptionLanguageOptions,
      playbackRateOptions: this.playbackRateOptions
    });
    if (general.transcriptionDevice !== undefined) {
      this.transcriptionDevice.set(general.transcriptionDevice);
    }
    if (general.computeType !== undefined) {
      this.computeType.set(general.computeType);
    }
    if (general.transcriptionLanguage !== undefined) {
      this.transcriptionLanguage.set(general.transcriptionLanguage);
    }
    if (general.hipDeviceIndex !== undefined) {
      this.selectedHipDeviceIndex.set(general.hipDeviceIndex);
    }
    if (general.playbackRate !== undefined) {
      this.playbackRate.set(general.playbackRate);
    }
    if (general.proofread) {
      if (general.proofread.chunkSize !== undefined) {
        this.proofreadChunkSize.set(general.proofread.chunkSize);
      }
      if (general.proofread.chunkMaxChars !== undefined) {
        this.proofreadChunkMaxChars.set(general.proofread.chunkMaxChars);
      }
      const locationScope = general.proofread.locationDetectionScope;
      this.selectedLocationArea.set(locationScope.area ?? 'kanto');
      this.selectedLocationPrefecturesByArea.set(locationScope.prefecturesByArea ?? {});
      this.selectedLocationPrefectures.set(locationScope.prefectures);
    }
    if (general.diarizationDevice !== undefined) {
      this.diarizationDevice.set(general.diarizationDevice);
    }
    if (general.speakerCount !== undefined) {
      this.speakerCount.set(general.speakerCount);
    }
    if (general.addUtteranceNumber !== undefined) {
      this.addUtteranceNumber.set(general.addUtteranceNumber);
    }

    const llm = resolveLlmAppSettingsValue(this.appSettings, {
      localLlmAppsEnabled: this.localLlmAppsEnabled(),
      aiProofreadBuild: this.aiProofreadBuild
    });
    if (llm.modelPath !== undefined) this.llmModelPath.set(llm.modelPath);
    if (llm.backendMode !== undefined) this.llmBackendMode.set(llm.backendMode);
    this.llmGpuMode.set(llm.llmGpuMode);
    if (llm.lemonadeUrl !== undefined) this.lemonadeUrl.set(llm.lemonadeUrl);
    if (llm.lemonadeModel !== undefined) this.lemonadeModel.set(llm.lemonadeModel);
    if (llm.lmstudioModel !== undefined) this.lmstudioModelInput.set(llm.lmstudioModel);
    if (llm.ollamaModel !== undefined) this.ollamaModelInput.set(llm.ollamaModel);
    if (llm.lemonadeBackendNotNeeded !== undefined) {
      this.lemonadeBackendNotNeeded.set(llm.lemonadeBackendNotNeeded);
    }
    if (llm.llmHipDeviceIndex !== undefined) {
      this.selectedLlmHipDeviceIndex.set(llm.llmHipDeviceIndex);
    }
    if (llm.llmPromptType !== undefined) this.llmPromptType.set(llm.llmPromptType);
    if (llm.llmParallel !== undefined) this.selectedLlmParallel.set(llm.llmParallel);
    // localStorage は初期UI値であり、最終的にはバックエンドの階層マーカーと同期する。
    this.proofreadModelTier.set(llm.proofreadModelTier);
    if (this.llmBackendMode() === 'local_gguf') {
      this.llmPromptType.set('gemma4');
    }

    this.applyLlmInferenceParamsForSelectedModel();
    this.updateDevEmulationLabelFromSettings();
  }

  private normalizeThemeMode(value: unknown): ThemeMode {
    return normalizeThemeModeValue(value);
  }

  /** 保存済みテーマを復元し、OS のダークモード設定の監視を開始する。 */
  private initTheme(): void {
    if (typeof window !== 'undefined' && typeof window.matchMedia === 'function') {
      try {
        this.systemDarkQuery = window.matchMedia('(prefers-color-scheme: dark)');
        this.systemPrefersDark.set(this.systemDarkQuery.matches);
        this.systemDarkQuery.addEventListener('change', this._onSystemThemeChange);
      } catch {
        this.systemDarkQuery = null;
      }
    }
    this.themeMode.set(this.normalizeThemeMode(this.appSettings.ui?.themeMode));
    this.applyThemeToDocument();
  }

  private applyThemeToDocument(): void {
    if (typeof document === 'undefined') {
      return;
    }
    const root = document.documentElement;
    const mode = this.themeMode();
    if (mode === 'system') {
      root.removeAttribute('data-theme');
    } else {
      root.setAttribute('data-theme', mode);
    }
  }

  /** システムに合わせる → ライト → ダーク の順に切り替える。 */
  onThemeToggleClick(): void {
    const order: ThemeMode[] = ['system', 'light', 'dark'];
    const next = order[(order.indexOf(this.themeMode()) + 1) % order.length];
    this.themeMode.set(next);
    this.applyThemeToDocument();
    this.appSettings = {
      ...this.appSettings,
      ui: { ...this.appSettings.ui, themeMode: next }
    };
    this.persistAppSettings();
    const suffix = next === 'system' ? `（現在: ${this.themeIsDark() ? 'ダーク' : 'ライト'}）` : '';
    this.snackBar.open(`表示テーマ: ${themeModeLabelValue(next)}${suffix}`, undefined, { duration: 2400 });
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
    return normalizeComputeTypeValue(valueRaw, this.cpuOnlyBuild);
  }

  /** 文字起こし言語コードを正規化する。選択肢に無い値は既定の ja に戻す。 */
  private normalizeTranscriptionLanguage(valueRaw: string): string {
    return normalizeTranscriptionLanguageValue(valueRaw, this.transcriptionLanguageOptions);
  }

  onTranscriptionLanguageChange(value: string): void {
    this.transcriptionLanguage.set(this.normalizeTranscriptionLanguage(value));
    this.persistTranscriptionSettings();
  }

  private normalizeTranscriptionDevice(valueRaw: string): TranscriptionDeviceOption {
    return normalizeTranscriptionDeviceValue(valueRaw, this.cpuOnlyBuild);
  }

  private normalizeTranscriptionDeviceForEstimate(valueRaw: string): 'cuda' | 'cpu' {
    return normalizeTranscriptionDeviceValue(valueRaw, this.cpuOnlyBuild);
  }

  private buildLocationDetectionScopeRequest(): LocationDetectionScope {
    return buildLocationDetectionScopeValue(
      this.selectedLocationArea(),
      this.selectedLocationPrefectures(),
      this.selectedLocationPrefecturesByArea()
    );
  }

  private persistProofreadSettings(): void {
    this.appSettings = {
      ...this.appSettings,
      proofread: {
        chunkSize: this.normalizeProofreadChunkSize(this.proofreadChunkSize()),
        chunkMaxChars: this.normalizeProofreadChunkMaxChars(this.proofreadChunkMaxChars()),
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
    const next = appendRuntimeEstimateSampleValue(this.estimateSamples, sample);
    if (!next) {
      return;
    }
    this.estimateSamples = next;
    this.persistEstimateSamples();
  }

  /**
   * WebKit が音声形式のメタデータを読めない環境でも、完了済みの文字起こし区間から
   * 所要時間ログ用の音声長を補完する。
   */
  private resolveRuntimeLogAudioSeconds(): number | null {
    return resolveRuntimeLogAudioSecondsValue(
      this.estimatedAudioSeconds(),
      this.result()?.segments ?? []
    );
  }

  private pickEstimateSamplesForCurrentProfile(): RuntimeEstimateSample[] {
    const diarization = this.diarization();
    const device = this.normalizeTranscriptionDeviceForEstimate(this.transcriptionDevice());
    const compute = this.resolveEstimateComputeType();
    return pickRuntimeEstimateSamplesValue(this.estimateSamples, diarization, device, compute);
  }

  private resolveEstimateComputeType(): ConcreteComputeType {
    return resolveEstimateComputeTypeValue(this.transcriptionDevice(), this.computeType());
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
    this.initTheme();
    this.applyAppSettings();
    this.loadEstimateSamples();
    void this.initializeStartupState();
    this.ngZone.runOutsideAngular(() => {
      window.addEventListener('scroll', this._overallProofreadScrollListener, { passive: true });
    });
  }

  ngAfterViewInit(): void {
    this.segmentViewports.changes.subscribe(() =>
      requestAnimationFrame(this._refreshSegmentTableInView)
    );
    this.ngZone.runOutsideAngular(() =>
      window.addEventListener('scroll', this._refreshSegmentTableInView, { passive: true })
    );
  }

  private readonly _refreshSegmentTableInView = (): void => {
    const viewport = this.activeSegmentViewport;
    const el = viewport?.elementRef.nativeElement as HTMLElement | undefined;
    const rect = el?.getBoundingClientRect();
    const inView = !!rect && rect.bottom > 0 && rect.top < window.innerHeight;
    if (this.isSegmentTableInView() !== inView) {
      this.ngZone.run(() => this.isSegmentTableInView.set(inView));
    }
  };

  ngOnDestroy(): void {
    if (this.systemDarkQuery) {
      this.systemDarkQuery.removeEventListener('change', this._onSystemThemeChange);
      this.systemDarkQuery = null;
    }
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
    if (this.playbackTranscodeUnlisten) {
      this.playbackTranscodeUnlisten();
      this.playbackTranscodeUnlisten = null;
    }
    this.dismissPlaybackTranscodeSnackbar();
    this.cleanupVoiceInputRecording(false);
    if (this.llmEngineUiVisible()) {
      this.stopLlm();
    }
    window.removeEventListener('scroll', this._overallProofreadScrollListener);
    if (this._overallProofreadScrollRaf !== null) {
      cancelAnimationFrame(this._overallProofreadScrollRaf);
    }
    window.removeEventListener('scroll', this._refreshSegmentTableInView);
    if (this.shortcutFocusRetryTimer !== null) {
      clearTimeout(this.shortcutFocusRetryTimer);
      this.shortcutFocusRetryTimer = null;
    }
  }

  /**
   * keydown の唯一の入口。
   *
   * 重要: Angular は @HostListener を「イベント名」をキーにしたマップで保持するため、
   * 同じ 'window:keydown' を複数のメソッドに付けると **最後の1つだけが登録され、
   * それ以前のものはエラーも警告も出さずに無効化される**。
   * 過去に追加したショートカットが効かなかった原因はこれ。
   * キーボードショートカットを増やすときは、必ずこのメソッドから呼び出すこと。
   *
   * 先に処理したハンドラが preventDefault() したら後続は動かさない。
   */
  @HostListener('window:keydown', ['$event'])
  onWindowKeydown(event: KeyboardEvent): void {
    this.onWindowFindShortcut(event);
    if (event.defaultPrevented) {
      return;
    }
    this.onWindowTextUndoRedo(event);
    if (event.defaultPrevented) {
      return;
    }
    this.onWindowVoiceInputShortcut(event);
    if (event.defaultPrevented) {
      return;
    }
    this.onWindowPlaybackShortcut(event);
  }

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

  onWindowTextUndoRedo(event: KeyboardEvent): void {
    if (event.defaultPrevented || event.isComposing || event.altKey) {
      return;
    }
    const primaryModifier = event.ctrlKey !== event.metaKey && (event.ctrlKey || event.metaKey);
    if (!primaryModifier) {
      return;
    }
    const key = (event.key ?? '').toLowerCase();
    const undo = key === 'z' && !event.shiftKey;
    const redo = (key === 'y' && !event.shiftKey) || (key === 'z' && event.shiftKey);
    if (!undo && !redo) {
      return;
    }
    const textarea = event.target;
    if (
      !(textarea instanceof HTMLTextAreaElement) ||
      !textarea.classList.contains('segment-content-input') ||
      textarea.disabled ||
      textarea.readOnly
    ) {
      return;
    }
    const segmentId = Number(textarea.dataset['segmentId']);
    if (!Number.isInteger(segmentId)) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    if (undo) {
      this.undoSegmentTextEdit(segmentId, textarea);
    } else {
      this.redoSegmentTextEdit(segmentId, textarea);
    }
  }

  onWindowPlaybackShortcut(event: KeyboardEvent): void {
    if (event.defaultPrevented) {
      return;
    }
    if (!event.ctrlKey || !event.shiftKey || event.altKey || event.metaKey) {
      return;
    }
    // 注意: event.isComposing での早期returnはしない。これは文字入力用ではなく
    // 再生操作用のショートカットであり、IME変換中に反応しないと
    // 「ショートカットが効かない」という不具合報告の主因になりうるため。
    const code = matchPlaybackShortcutCodeValue(event.code, event.key);
    if (!code) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    switch (code) {
      case 'Space':
        this.handlePlaybackToggleShortcut();
        break;
      case 'KeyA':
        void this.handleSeekShortcut(-this.shortcutSeekSeconds);
        break;
      case 'KeyD':
        void this.handleSeekShortcut(this.shortcutSeekSeconds);
        break;
      case 'KeyE':
        this.handleSpeakerCycleShortcut();
        break;
    }
  }

  /** Ctrl+Shift+M: 対象行で Gemma 4 の音声入力を開始 / 停止する。 */
  private onWindowVoiceInputShortcut(event: KeyboardEvent): void {
    if (event.defaultPrevented || !event.ctrlKey || !event.shiftKey || event.altKey || event.metaKey) {
      return;
    }
    const keyMatches = event.code === 'KeyM'
      || ((!event.code || event.code === 'Unidentified') && (event.key ?? '').toLowerCase() === 'm');
    if (!keyMatches) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    void this.toggleVoiceInputFromShortcut();
  }

  private async toggleVoiceInputFromShortcut(): Promise<void> {
    if (!this.isTauriRuntime()) {
      this.snackBar.open('この環境では音声入力を使用できません', undefined, { duration: 3000 });
      return;
    }
    const recordingSegmentId = this.voiceInputRecordingSegmentId();
    if (recordingSegmentId !== null) {
      await this.finishVoiceInputRecording(recordingSegmentId);
      return;
    }
    if (!this.editorInstalledMemoryChecked()) {
      await this.checkEditorInstalledMemory();
    }
    if (this.cpuVoiceInputBuild && !this.editorVoiceInputMemoryAllowed()) {
      this.snackBar.open('このPCはスペック（メモリ容量）が足りないため、音声入力を使用できません', undefined, { duration: 4000 });
      return;
    }
    if (!this.editorVoiceInputPackChecked()) {
      await this.checkEditorVoiceInputPackStatus();
    }
    if (this.editorVoiceInputPackStatus()?.installed !== true) {
      this.snackBar.open('音声入力用のGemma 4が未導入です。設定画面の「音声入力パック」からAIモデルをダウンロードしてください', undefined, { duration: 5000 });
      return;
    }
    if (this.voiceInputProcessingSegmentId() !== null) {
      this.snackBar.open('音声入力の処理中です。完了してから再試行してください', undefined, { duration: 3000 });
      return;
    }

    const focusedSegment = this.segmentFromFocusedTextarea();
    const targetSegment = focusedSegment ?? this.resolveShortcutTargetSegment();
    if (!targetSegment) {
      this.snackBar.open('先に文字起こしを行ってください', undefined, { duration: 2200 });
      return;
    }
    const textarea = document.querySelector<HTMLTextAreaElement>(
      `.segment-content-input[data-segment-id="${targetSegment.id}"]`
    );
    if (!textarea || textarea.disabled || textarea.readOnly) {
      this.snackBar.open('音声入力する行の編集欄を選択してください', undefined, { duration: 3000 });
      return;
    }
    await this.toggleVoiceInputForSegment(targetSegment.id, textarea);
  }

  /** Ctrl+Shift+Space: 連続再生の再生 / 一時停止をトグルする。 */
  private handlePlaybackToggleShortcut(): void {
    if (this.isPlaybackDisabled() || !this.selectedAudioPath()) {
      this.snackBar.open('音声ファイルが読み込まれていません', undefined, { duration: 2200 });
      return;
    }
    const audio = this.previewAudio;
    const playingId = this.playingSegmentId();
    if (playingId !== null && audio && !audio.paused) {
      this.pauseSegmentPlayback(false);
      return;
    }
    if (playingId !== null && this.previewPaused && audio) {
      this.previewPaused = false;
      // 一時停止中に手動で閉じられたり、別の通知に置き換えられたりした場合は
      // 再開と同時に連続再生コントロールも復元する。
      this.openPlaybackSnackbar(this.previewLoopEnabled);
      void audio.play();
      return;
    }
    const segment = this.resolveShortcutTargetSegment();
    if (!segment) {
      this.snackBar.open('音声ファイルが読み込まれていません', undefined, { duration: 2200 });
      return;
    }
    void this.playSegmentOnce(segment);
  }

  /** Ctrl+Shift+A / D: ±5秒シークする。リピート再生中はセグメント境界内に留める。 */
  private async handleSeekShortcut(deltaSeconds: number): Promise<void> {
    if (this.playingSegmentId() === null) {
      this.snackBar.open('再生中に使えます', undefined, { duration: 2200 });
      return;
    }
    const audio = this.previewAudio;
    if (!audio) {
      return;
    }
    const duration = audio.duration;
    let target = audio.currentTime + deltaSeconds;
    if (Number.isFinite(duration) && duration > 0) {
      target = Math.min(Math.max(target, 0), duration);
    } else {
      target = Math.max(target, 0);
    }

    if (this.previewLoopEnabled) {
      // リピート再生中はセグメントを切り替えず、区間内にクランプする。
      const lo = this.previewStartSeconds ?? 0;
      const hi = this.previewEndSeconds ?? target;
      target = Math.min(Math.max(target, lo), hi);
      await this.seekPreviewToSegmentTime(null, target);
      return;
    }

    // 連続再生中: target 秒を含むセグメントを探し、そこから始まるシーケンスへ作り直す。
    const rows = this.segmentRows;
    let seg: TranscriptionSegment | null = null;
    for (const s of rows) {
      if (s.start > target) {
        break;
      }
      seg = s;
      if (target < s.end) {
        break;
      }
    }
    if (!seg && rows.length > 0) {
      seg = rows[0];
    }
    if (!seg) {
      return;
    }

    const ids = rows.map((v) => v.id);
    const idx = ids.indexOf(seg.id);
    this.previewSequenceSegmentIds = idx >= 0 ? ids.slice(idx) : [seg.id];
    this.previewSequenceIndex = 0;
    this.setActivePlayingSegment(seg.id);
    await this.seekPreviewToSegmentTime(seg, target);
  }

  /** Ctrl+Shift+E: 対象行の話者を次の選択肢へ送る（未入力は飛ばす）。 */
  private handleSpeakerCycleShortcut(): void {
    // 再生系と違い、話者切り替えは「今フォーカスしている行」を最優先にする。
    // 一時停止中は playingSegmentId が残るため、共通の解決順のままだと
    // 別の行を編集していても停止した行の話者を書き換えてしまう。
    const segment = this.segmentFromFocusedTextarea() ?? this.resolveShortcutTargetSegment();
    if (!segment) {
      return;
    }
    const options = this.speakerOptions;
    if (options.length === 0) {
      return;
    }
    const current = this.getAssignedSpeakerKey(segment);
    const index = options.indexOf(current);
    const next = index === -1 ? options[0] : options[(index + 1) % options.length];
    this.setAssignedSpeaker(segment.id, next);
  }

  /**
   * ショートカットの対象セグメントを解決する優先順位:
   * 1. 再生中のセグメント（表示中の行に限る）
   * 2. フォーカス中の編集欄（.segment-content-input）が指すセグメント
   * 3. 表示中の先頭行
   */
  private resolveShortcutTargetSegment(): TranscriptionSegment | null {
    const rows = this.displayedSegmentRows;
    if (rows.length === 0) {
      return null;
    }
    const playingId = this.playingSegmentId();
    if (playingId !== null) {
      const playing = rows.find((s) => s.id === playingId);
      if (playing) {
        return playing;
      }
    }
    const focused = this.segmentFromFocusedTextarea();
    if (focused) {
      return focused;
    }
    return rows[0];
  }

  /** フォーカス中の編集欄（.segment-content-input）が指す表示中のセグメントを返す。 */
  private segmentFromFocusedTextarea(): TranscriptionSegment | null {
    const active = document.activeElement;
    if (!(active instanceof HTMLTextAreaElement) || !active.classList.contains('segment-content-input')) {
      return null;
    }
    const id = Number(active.dataset['segmentId']);
    if (!Number.isInteger(id)) {
      return null;
    }
    return this.displayedSegmentRows.find((s) => s.id === id) ?? null;
  }

  /**
   * 仮想スクロールで対象行がまだ描画されていないことがあるため、
   * まず中央へスクロールし、その後 DOM に描画されるまで一定間隔でリトライして
   * textarea を取得してからフォーカス・キャレットを末尾へ移動する。
   */
  private focusSegmentTextareaById(segmentId: number, attemptsLeft = 12): void {
    if (this.shortcutFocusRetryTimer !== null) {
      clearTimeout(this.shortcutFocusRetryTimer);
      this.shortcutFocusRetryTimer = null;
    }
    const index = this.displayedSegmentRows.findIndex((s) => s.id === segmentId);
    const viewport = this.activeSegmentViewport;
    if (viewport && index >= 0) {
      this.scrollSegmentRowIntoCenter(viewport, segmentId, index, ++this.followScrollGeneration, 10);
    }
    this.retryFocusSegmentTextarea(segmentId, attemptsLeft);
  }

  private retryFocusSegmentTextarea(segmentId: number, attemptsLeft: number): void {
    const textarea = document.querySelector<HTMLTextAreaElement>(
      `.segment-content-input[data-segment-id="${segmentId}"]`
    );
    if (textarea) {
      textarea.focus();
      const len = textarea.value.length;
      textarea.setSelectionRange(len, len);
      return;
    }
    if (attemptsLeft <= 0) {
      return;
    }
    this.shortcutFocusRetryTimer = setTimeout(() => {
      this.shortcutFocusRetryTimer = null;
      this.retryFocusSegmentTextarea(segmentId, attemptsLeft - 1);
    }, 40);
  }

  /**
   * ontimeupdate の再入・進行中の advanceSequencePlayback を避けるため、
   * startSegmentPlayback / advanceSequencePlayback と同じ手順でシークする:
   * pause → previewEndSeconds を null 化 → 世代カウンタを進めて古い処理を無効化 →
   * seeked 待ち（最大500ms）→ previewEndSeconds を復元 → 再生中だったら再開。
   * segment が null の場合（リピート区間内シーク）はセグメント境界を変更しない。
   */
  private async seekPreviewToSegmentTime(segment: TranscriptionSegment | null, targetSeconds: number): Promise<void> {
    const audio = this.previewAudio;
    if (!audio) {
      return;
    }
    const wasPlaying = !audio.paused;
    // 先に一時停止してからシークする。ontimeupdate が中途半端な位置で
    // 再入して意図しないセグメント送りが起きるのを防ぐ。
    audio.pause();
    const previousEnd = this.previewEndSeconds;
    if (segment) {
      this.previewStartSeconds = Math.max(0, segment.start);
    }
    this.previewEndSeconds = null;
    // 進行中の advanceSequencePlayback や別の seek 処理を打ち切るための世代カウンタ。
    const gen = ++this.seekPlayGeneration;
    await new Promise<void>((resolve) => {
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
      audio.currentTime = targetSeconds;
    });
    if (gen !== this.seekPlayGeneration) {
      return;
    }
    this.previewEndSeconds = segment
      ? Math.max((this.previewStartSeconds ?? 0) + 0.1, segment.end)
      : previousEnd;
    if (wasPlaying && !this.previewPaused) {
      void audio.play();
    }
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
      const count = countSubstringOccurrencesValue(before, findText);
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
    const settings = getAudioPreprocessSettingsForPresetValue(value);
    if (!settings) {
      return;
    }
    this.highpassFilter.set(settings.highpassFilter);
    this.noiseReduction.set(settings.noiseReduction);
    this.normalizeAudio.set(settings.normalizeAudio);
    this.noiseReductionMode.set(settings.noiseReductionMode);
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
    if (this.transcriptionPipelineRunning()) {
      return;
    }
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

    if (this.aiProofreadBuild && this.allSetupStatus()?.gemmaGguf === false && !this._gemmaCheckBypassed) {
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
    this.transcriptionPipelineRunning.set(true);
    this.transcriptionPipelineCanceling.set(false);
    this.running.set(true);
    this.openProgressSnackbar();
    this.runningStatus.set('実行準備中...');
    this.transcriptionCanceling.set(false);
    this.runningProgress.set(0);
    this.displayProgress.set(0);
    this.runningStepCurrent.set(0);
    this.runningStepTotal.set(getProgressStageOrderValue(this.diarization()).length);
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
    try {
      await this.ensureProgressListener();
    } catch (error) {
      this.running.set(false);
      this.transcriptionPipelineRunning.set(false);
      this.dismissProgressSnackbar();
      this.error.set(this.normalizeErrorMessage(error));
      return;
    }
    this.startRunningTicker();
    this.startSmoothProgress();
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

      if (hasFallbackInTranscriptionResultValue(response.result) || this.hadRetryInCurrentRun()) {
        this.lastRunNotice.set('再試行またはフォールバックが発生しました。結果は取得できていますが、初回実行は失敗しています。');
      }

      this.result.set(response.result);
      this.resultSource.set('transcription');
      const reconciledState = reconcileRetranscriptionStateValue(
        response.result.segments,
        this.editedSegmentTextMap(),
        this.proofreadHintBySegmentId(),
        this.proofreadMetadataBySegmentId()
      );
      this.editedSegmentTextMap.set(reconciledState.editedTextBySegmentId);
      this.proofreadHintBySegmentId.set(reconciledState.proofreadHintBySegmentId);
      this.proofreadMetadataBySegmentId.set(reconciledState.proofreadMetadataBySegmentId);
      this.speakerAliasMap.set(buildInitialSpeakerAliasMapValue(response.result.segments));
      this.selectedSpeakerBySegmentId.set(buildInitialSpeakerSelectionMapValue(response.result.segments));
      this.focusFirstSpeakerAliasInput();
      this.lastObservedComputeType =
        String((response.result.settings as { computeType?: unknown })?.computeType ?? this.computeType());
      this.lastObservedTranscriptionDevice =
        String((response.result.settings as { device?: unknown })?.device ?? this.transcriptionDevice());
      autoEntityCheckAfterTranscription = true;
    } catch (error) {
      const message = this.normalizeErrorMessage(error);
      this.error.set(message);
      this.showAmdGpuProcessingFailure('文字起こし・話者分離', message);
    } finally {
      this.stopSmoothProgress();
      this.running.set(false);
      this.runningStatus.set('');
      this.runningProgress.set(0);
      this.displayProgress.set(0);
      this.runningStepCurrent.set(0);
      this.runningStepTotal.set(0);
      this.runningComputeType.set('');
      this.parallelDiarizationStatus.set('');
    }

    try {
      if (autoEntityCheckAfterTranscription && !this.transcriptionPipelineCanceling()) {
        if (this.aiProofreadBuild) {
          // GPU版は、保存中の高精度モデル設定に関係なくE4Bで句読点を自動付与する。
          await this.startAutoLlmProofread();
        } else if (this.cpuOnlyBuild) {
          // CPU版のpunctモードは、単純句読点付与と固有名詞チェックを一度に実行する。
          await this.runProofread('transcription', false, 'punct');
          autoEntityCheckAfterTranscription = false;
        }
        // 表示する所要時間は、文字起こし開始からAI句読点付与の完了までとする。
        // この後に続く固有名詞チェックの時間は含めない。
        this.stopRunningTicker();
        const elapsed = this.runningSeconds();
        this.lastRunElapsedSeconds.set(elapsed);
        // 所要時間ログと次回以降の予測にも、AI句読点付与までの総時間を使う。
        if (this.proofreadCompleted() && elapsed > 0) {
          const audioSeconds = this.resolveRuntimeLogAudioSeconds();
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
      }
      if (autoEntityCheckAfterTranscription && !this.transcriptionPipelineCanceling()) {
        await this.runProofread('transcription', false, 'entity');
      }
    } finally {
      // 句読点付与前の失敗・中止などでもタイマーを確実に終了する。
      this.stopRunningTicker();
      this.lastRunElapsedSeconds.set(this.runningSeconds());
      this.transcriptionPipelineRunning.set(false);
      this.transcriptionPipelineCanceling.set(false);
      this.dismissProgressSnackbar();
    }
  }

  async runDiarization(): Promise<void> {
    if (this.transcriptionPipelineRunning() || this.running() || this.proofreadRunning() || this.diarizationRunning()) {
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
      this.editedSegmentTextMap.set(
        buildDiarizationEditedTextMapValue(response.result.segments, this.editedSegmentTextMap())
      );
      this.selectedSpeakerBySegmentId.set(buildInitialSpeakerSelectionMapValue(response.result.segments));
      const existingAlias = this.speakerAliasMap();
      const inferredAlias = buildInitialSpeakerAliasMapValue(response.result.segments);
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
      const message = this.normalizeErrorMessage(error);
      this.error.set(message);
      this.diarizationStatus.set('');
      this.showAmdGpuProcessingFailure('話者分離', message);
    } finally {
      this.stopDiarizationTicker();
      this.diarizationRunning.set(false);
      this.diarizationCanceling.set(false);
    }

    if (autoEntityCheckSource) {
      // 話者割り当ての変化を反映して、GPU版はE4B句読点付与を再実行する。
      this.llmSegmentStatus.set({});
      this.llmProgressOffset = 0;
      this.llmTotalProcessedCount = 0;
      this.proofreadUpdatedCount.set(0);
      if (this.aiProofreadBuild) {
        await this.startAutoLlmProofread();
        await this.runProofread(autoEntityCheckSource, false, 'entity');
      } else if (this.cpuOnlyBuild) {
        await this.runProofread(autoEntityCheckSource, false, 'punct');
      }
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

  /** 統合実行の現在工程に対応するキャンセルAPIへ振り分ける。 */
  async cancelTranscriptionPipelineRun(): Promise<void> {
    if (!this.transcriptionPipelineRunning() || this.transcriptionPipelineCanceling()) {
      return;
    }
    this.errorWasCancelledByUser.set(true);
    this.transcriptionPipelineCanceling.set(true);
    if (this.running()) {
      await this.cancelTranscriptionRun();
      return;
    }
    if (this.llmProofreadRunning()) {
      await this.cancelLlmProofread();
      return;
    }
    if (this.proofreadRunning()) {
      await this.cancelProofreadRun();
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
      this.llmProofreadStatus.set('全セグメント処理済みです。');
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
        await this.startLlm(false, autoMode ? 'e4b' : undefined);
        if (this.llmServerStatus() !== 'running') {
          // 起動時にKVキャッシュ確保でVRAM不足になった場合は、並列処理数を下げて再試行を促す
          if (await this.maybePromptLowerParallelOnOom(this.llmLastError, () => this.runLlmProofread(autoMode, segments, backendOverride))) {
            this.llmProofreadStatus.set('VRAM不足の可能性があります。並列処理数を下げて再実行できます。');
          } else {
            this.llmProofreadStatus.set('AI校正エンジンの起動に失敗しました。');
            this.showAmdGpuProcessingFailure(
              'AI校正',
              this.llmLastError || 'AI校正エンジンの起動に失敗しました。'
            );
          }
          return;
        }
      }
      if (this.llmGpuMode() === 'gpu') {
        await this.refreshLlmLoadedDevice();
        if (this.llmLoadedDevice() === 'cpu') {
          const msg = 'CPU 専用バックエンドが検出されました。AI校正を中止しました。設定タブから GPU バックエンドを再インストールしてください。';
          this.llmProofreadStatus.set(msg);
          this.showAmdGpuProcessingFailure('AI校正', msg);
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
        if (backend !== 'openai_compatible') {
          this.showAmdGpuProcessingFailure('AI校正', msg);
        }
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

  /** 話者分離完了後、内蔵E4Bで句読点付与を自動実行する。 */
  private async startAutoLlmProofread(): Promise<void> {
    if (!this.result()) return;
    // 12BやローカルAIアプリの選択は全体校正などの明示操作にだけ適用する。
    await this.runLlmProofread(true, undefined, 'lemonade');
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
      if (origText.length > 0 && prev.length > 0 && levenshteinDistanceValue(origText, prev) > origPrevThreshold) {
        // console.warn(`[proofread] ID混在の疑い: sid=${sid} origText="${origText}" prev="${prev}"`);
        hintMap[sid] = 'AI校正：（変更無し）';
        continue;
      }
      const maxAllowedDist = Math.max(5, Math.floor(origText.length * 0.3));
      if (origText.length > 0 && levenshteinDistanceValue(origText, revised) > maxAllowedDist) {
        hintMap[sid] = 'AI校正：（変更無し）';
        continue;
      }
      if (revised === prev || revised === '') {
        if (existingMeta?.sensitiveEntity?.hasSensitiveEntity === true || (existingMeta?.lintIssues?.length ?? 0) > 0) {
          hintMap[sid] = this.buildProofreadHint(
            existingMeta.diff.from,
            existingMeta.diff.to,
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
          levenshteinDistanceValue(prev, revised) <= Math.max(2, Math.ceil(prev.length * 0.34));
        if (!allowWordEdit) {
          if (existingMeta?.sensitiveEntity?.hasSensitiveEntity === true || (existingMeta?.lintIssues?.length ?? 0) > 0) {
            hintMap[sid] = this.buildProofreadHint(
              existingMeta.diff.from,
              existingMeta.diff.to,
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
      hintMap[sid] = this.buildProofreadHint(metadata.diff.from, metadata.diff.to, metadata.reason, metadata.sensitiveEntity);
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
    } else if (kind === 'transcriptionPipeline') {
      if (!this.transcriptionPipelineRunning() || this.transcriptionPipelineCanceling()) {
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
      : kind === 'transcriptionPipeline' ? '文字起こし・話者分離・AI句読点付与の一括処理を中止しますか？'
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
      if (dialog.cancelRunKind === 'transcriptionPipeline') {
        await this.cancelTranscriptionPipelineRun();
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

    if (dialog.actionKind === 'resetOverallProofreadSystemPrompt') {
      this.resetOverallProofreadSystemPromptForSelectedModel();
    }

    if (dialog.actionKind === 'overallProofreadBeforeMerge') {
      await this.runOverallProofread(this.pendingOverallProofreadTier);
    }

    if (dialog.actionKind === 'downloadGemma12bForOverallProofread') {
      const downloaded = await this.downloadGemma12b();
      if (downloaded) {
        this.openOrRunOverallProofread(false, '12b');
      }
      return;
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

  openOrRunOverallProofread(withConfirm: boolean, proofreadTier: 'e4b' | '12b' = 'e4b'): void {
    if (this.overallProofreadHasPendingItems()) {
      this.overallProofreadDialogOpen.set(true);
      return;
    }
    if (withConfirm) {
      this.pendingOverallProofreadTier = proofreadTier;
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
      void this.runOverallProofread(proofreadTier);
    }
  }

  async openOrRunOverallProofreadWith12b(withConfirm: boolean): Promise<void> {
    if (this.overallProofreadHasPendingItems()) {
      this.overallProofreadDialogOpen.set(true);
      return;
    }
    if (!this.isTauriRuntime()) return;
    let installed = false;
    try {
      installed = await invoke<boolean>('check_gemma_12b_installed');
      this.gemma12bInstalled.set(installed);
    } catch {
      // 状態を確認できない場合にE4Bへ黙ってフォールバックしないよう、未導入として扱う。
      installed = false;
    }
    if (!installed) {
      this.openConfirmDialog({
        actionKind: 'downloadGemma12bForOverallProofread',
        title: '高精度モデルをダウンロードしますか？',
        message: 'Gemma 4 12Bはまだダウンロードされていません。約7GBのダウンロードが必要で、回線速度によっては数分から十数分かかります。これからダウンロードしますか？',
        confirmLabel: 'ダウンロードする',
        cancelLabel: 'キャンセル',
        confirmColor: 'primary',
        cancelColor: null,
      });
      return;
    }
    this.openOrRunOverallProofread(withConfirm, '12b');
  }

  async runOverallProofread(proofreadTier: 'e4b' | '12b' = 'e4b'): Promise<void> {
    if (this.overallProofreadRunning()) return;
    if (this.running() || this.proofreadRunning() || this.diarizationRunning() || this.llmProofreadRunning()) {
      this.overallProofreadError.set('他の処理が実行中のため、全体校正を開始できません。');
      this.overallProofreadDialogOpen.set(true);
      return;
    }
    if (!this.isTauriRuntime() || !this.result()) return;

    // 分割ボタンからの全体校正は、設定中の外部ローカルAIアプリに左右されず
    // 指定された内蔵 Gemma 4 階層をジョブ単位で使用する。
    const backend: 'lemonade' = 'lemonade';
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

    await this.checkLlmStatus();
    if (this.llmServerStatus() !== 'running') {
      this.overallProofreadStatus.set('AI校正エンジンを起動中...');
      await this.startLlm(false, proofreadTier);
      if (this.llmServerStatus() !== 'running') {
        if (await this.maybePromptLowerParallelOnOom(this.llmLastError, () => this.runOverallProofread(proofreadTier))) {
          this.overallProofreadStatus.set('VRAM不足の可能性があります。並列処理数を下げて再実行できます。');
        } else {
          this.overallProofreadError.set('AI校正エンジンの起動に失敗しました。');
          this.showAmdGpuProcessingFailure(
            '全体校正',
            this.llmLastError || 'AI校正エンジンの起動に失敗しました。'
          );
          if (this.buildVariant() !== 'rocm') {
            this.overallProofreadDialogOpen.set(true);
          }
        }
        return;
      }
    }

    await this.ensureProgressListener();
    this.overallProofreadRunning.set(true);
    this.overallProofreadError.set('');
    this.overallProofreadResult.set(null);
    this.overallProofreadDismissedIds.set(new Set());
    this.overallProofreadProgressCurrent = 0;
    this.overallProofreadProgressStarted = false;
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
            nGpuLayers: 0,
            backend,
            lemonadeUrl: this.lemonadeUrl(),
            lemonadeModel: this.lemonadeModel(),
            openaiBaseUrl: this.activeOpenAiBaseUrl(),
            openaiModel: this.activeOpenAiModelInput(),
            nCtx: this.llmNCtx() > 0 ? this.llmNCtx() : 16384,
            promptType: 'gemma4',
            systemPrompt: null,
          }
        }
      );

      if (!response.success || !response.result) {
        const msg = response.errorMessage ?? '全体校正に失敗しました。';
        if (await this.maybePromptLowerParallelOnOom(msg, () => this.runOverallProofread(proofreadTier))) {
          oomHandled = true;
          this.overallProofreadStatus.set('VRAM不足の可能性があります。並列処理数を下げて再実行できます。');
        } else {
          this.overallProofreadError.set(msg);
          if (backend === 'lemonade') {
            this.showAmdGpuProcessingFailure('全体校正', msg);
          }
        }
      } else {
        this.overallProofreadResult.set(response.result);
        this.overallProofreadStatus.set('全体校正が完了しました。');
      }
    } catch (error) {
      const msg = this.normalizeErrorMessage(error);
      if (await this.maybePromptLowerParallelOnOom(msg, () => this.runOverallProofread(proofreadTier))) {
        oomHandled = true;
        this.overallProofreadStatus.set('VRAM不足の可能性があります。並列処理数を下げて再実行できます。');
      } else {
        this.overallProofreadError.set(msg);
        if (backend === 'lemonade') {
          this.showAmdGpuProcessingFailure('全体校正', msg);
        }
      }
    } finally {
      const wasCanceled = this.overallProofreadCanceling();
      this.overallProofreadRunning.set(false);
      this.overallProofreadCanceling.set(false);
      if (!wasCanceled && !oomHandled && !this.amdGpuFailureDialog()) {
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
        ? buildDefaultExportFileName('json').replace(/\.json$/, '.zip')
        : buildDefaultExportFileName('json'),
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
      defaultPath: buildDefaultExportFileName('docx'),
      filters: [{ name: 'Word', extensions: ['docx'] }]
    });

    if (!targetPath) {
      return;
    }

    try {
      const rows = buildDocxExportRowsValue(this.buildDocumentExportSourceRows(), this.addUtteranceNumber());

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
      defaultPath: buildDefaultExportFileName('xlsx'),
      filters: [{ name: 'Excel', extensions: ['xlsx'] }]
    });

    if (!targetPath) {
      return;
    }

    try {
      const finalPath = targetPath.toLowerCase().endsWith('.xlsx') ? targetPath : `${targetPath}.xlsx`;
      const rows = buildXlsxExportRowsValue(this.buildDocumentExportSourceRows(), this.addUtteranceNumber());

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

  async saveSrt(): Promise<void> {
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
      title: '文字起こし結果（SRT字幕）を保存',
      defaultPath: hasPassword
        ? buildDefaultExportFileName('srt').replace(/\.srt$/, '.zip')
        : buildDefaultExportFileName('srt'),
      filters: hasPassword
        ? [{ name: 'パスワード付きZIP', extensions: ['zip'] }]
        : [{ name: 'SRT字幕', extensions: ['srt'] }]
    });

    if (!targetPath) {
      return;
    }

    try {
      const ext = hasPassword ? '.zip' : '.srt';
      const finalPath = targetPath.toLowerCase().endsWith(ext) ? targetPath : `${targetPath}${ext}`;
      const rows = buildSrtExportRowsValue(this.buildDocumentExportSourceRows());
      await invoke('save_transcription_srt', {
        request: {
          path: finalPath,
          rows,
          password: hasPassword ? password : null
        }
      });
    } catch (error) {
      this.error.set(this.normalizeErrorMessage(error));
    }
  }

  async exportRuntimeEstimateLog(): Promise<void> {
    if (!this.isTauriRuntime()) {
      this.error.set('ブラウザ起動では保存できません。Tauri ウィンドウから実行してください。');
      return;
    }

    this.error.set('');
    const targetPath = await save({
      title: '文字起こし・AI句読点付与 所要時間ログを保存',
      defaultPath: buildDefaultExportFileName('runtime-csv'),
      filters: [{ name: 'CSV', extensions: ['csv'] }]
    });

    if (!targetPath) {
      return;
    }

    const finalPath = targetPath.toLowerCase().endsWith('.csv') ? targetPath : `${targetPath}.csv`;
    try {
      await invoke('save_runtime_estimate_csv', {
        request: {
          path: finalPath,
          samples: this.estimateSamples
        }
      });
    } catch (error) {
      this.error.set(this.normalizeErrorMessage(error));
    }
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

  onAddUtteranceNumberChange(checked: boolean): void {
    this.addUtteranceNumber.set(checked);
    this.appSettings = { ...this.appSettings, export: { ...this.appSettings.export, addUtteranceNumber: checked } };
    this.persistAppSettings();
  }

  private buildDocumentExportSourceRows(): DocumentExportSourceRow[] {
    return this.segmentRows.map((segment) => ({
      id: segment.id,
      startSeconds: segment.start,
      endSeconds: segment.end,
      speakerLabel: this.displaySpeaker(this.getAssignedSpeakerKey(segment)),
      text: this.getEditableText(segment)
    }));
  }

  private buildExportTranscriptionPayload(): ExportTranscriptionPayload {
    const segments = this.segmentRows;
    return buildExportTranscriptionPayloadValue({
      audioFileName: this.selectedAudioFileName,
      rows: segments.map((segment) => ({
        id: segment.id,
        startTime: segment.start,
        endTime: segment.end,
        speakerValue: this.getAssignedSpeakerKey(segment),
        content: this.getEditableText(segment)
      })),
      speakerDisplayNameByValue: this.speakerAliasMap(),
      proofreadMetadataBySegmentId: this.proofreadMetadataBySegmentId(),
      llmSegmentStatusBySegmentId: this.llmSegmentStatus(),
      proofreadCompleted: this.proofreadCompleted()
    });
  }

  private loadImportJsonContent(content: string): void {
    this.importExpectedAudioFileName.set('');
    const parsed = parseImportedTranscriptionJsonValue(content);
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
    return isPlaybackDisabledValue(this.isJsonResult(), this.importAudioReady());
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
    return transcriptionTabLabelValue(
      this.isTranscriptionTabDisabled(),
      this.isDiarizationModelMissing(),
      this.cpuOnlyBuild
    );
  }

  isTranscriptionTabDisabled(): boolean {
    return this.transcriptionTabDisabled();
  }

  isDiarizationModelMissing(): boolean {
    return isDiarizationModelMissingValue(
      this.diarizationModelChecked(),
      this.diarizationModelExists(),
      this.diarizationModelHasConfig()
    );
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
    if (this.cpuOnlyBuild) {
      void this.loadLargeV3InstallStatus();
    } else {
      void this.checkGpuAvailability();
      void this.loadComputeEnv();
    }
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
    if (this.aiProofreadBuild) {
      await this.loadProofreadSystemPrompt();
      await this.loadOverallProofreadSystemPrompt();
    }
    this.ngZone.run(() => this.runtimeCheckDone.set(true));
    // ここまでで GPU/セットアップ判定の signal は確定している。eventCoalescing 構成では
    // 変更検知がフレーム単位にまとめられ、ウィンドウが前面化されるまで描画が遅延しうる
    // （GPU 未検出バナーが古いまま残り、最前面化で初めて消える）。確定値を即座に反映させる
    // ため、同期的な変更検知を一度だけ強制する。
    this.appRef.tick();
    if (this.aiProofreadBuild) {
      void this.initDefaultLlmModelPath();
      void this.initProofreadModelTier();
      void this.refreshLlmUiState();
    }
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
      const result = await invoke<{
        cudaAvailable: boolean;
        rocmAvailable: boolean;
        buildVariant?: string;
        runtimePlatform?: string;
        localLlmAppsEnabled?: boolean;
      }>('check_gpu_availability');
      // invoke の Promise は NgZone 外で resolve されうるため、signal 更新を zone 内で行い再描画を保証する
      this.ngZone.run(() => {
        this.cudaAvailable.set(result.cudaAvailable);
        this.rocmAvailable.set(result.rocmAvailable);
        if (result.buildVariant === 'rocm') this.buildVariant.set('rocm');
        if (result.buildVariant === 'cpu') this.buildVariant.set('cpu');
        if (result.runtimePlatform === 'windows' || result.runtimePlatform === 'linux' || result.runtimePlatform === 'macos') {
          this.runtimePlatform.set(result.runtimePlatform);
        } else if (result.runtimePlatform) {
          this.runtimePlatform.set('other');
        }
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

  private async loadLargeV3InstallStatus(): Promise<void> {
    if (!this.isTauriRuntime()) return;
    try {
      const installed = await invoke<boolean>('check_whisper_model_installed', { modelName: 'large-v3' });
      this.ngZone.run(() => this.largeV3Installed.set(installed));
    } catch {
      // 取得失敗時は未確認の状態を維持
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
    if (!this.isTauriRuntime() || !this.aiProofreadBuild) return;
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

  private async downloadGemma12b(): Promise<boolean> {
    if (this.gemma12bDownloading()) return false;
    await this.ensureSetupProgressListener();
    this.gemma12bDownloading.set(true);
    this.gemma12bDownloadMessage.set('Gemma 4 12B（QAT+MTP）をダウンロード中... （約7GB・数分〜十数分かかります）');
    try {
      await invoke<boolean>('download_gemma_12b');
      this.gemma12bInstalled.set(true);
      this.gemma12bDownloadMessage.set('');
      this.snackBar.open('Gemma 4 12B のダウンロードが完了しました', undefined, { duration: 3000 });
      return true;
    } catch (e) {
      this.gemma12bDownloadMessage.set(`ダウンロード失敗: ${e}`);
      this.snackBar.open(`Gemma 4 12B ダウンロード失敗: ${e}`, undefined, { duration: 5000 });
      return false;
    } finally {
      this.gemma12bDownloading.set(false);
    }
  }

  computeEnvBackendLabel(): string {
    return computeEnvBackendLabelValue(this.computeEnvInfo()?.backendType);
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

  readonly selectedGpuAsrWarning = computed<string>(() => {
    const info = this.computeEnvInfo();
    let idx = this.selectedHipDeviceIndex();
    if (idx < 0) {
      idx = this.recommendedGpuDeviceIndex();
    }
    const device = info?.devices.find(d => d.index === idx);
    return selectedGpuAsrWarningValue(info?.backendType, !!device, device?.gcnArchName);
  });

  gpuDeviceLabel(device: GpuDeviceInfo): string {
    return gpuDeviceLabelValue(
      device,
      this.recommendedGpuDeviceIndex(),
      this.computeEnvInfo()?.backendType
    );
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
    const mode = resolvePersistedLlmBackendModeValue(
      this.appSettings.llm?.backendMode,
      this.localLlmAppsEnabled()
    );
    if (mode !== undefined) {
      this.llmBackendMode.set(mode);
    }
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
    const key = getLlmModelFileNameValue(this.llmModelPath());
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
      const key = getLlmModelFileNameValue(this.llmModelPath());
      if (!key || isGemma4DefaultLlmModelFileNameValue(key)) return;
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
      const key = getLlmModelFileNameValue(this.llmModelPath());
      if (!key || isGemma4DefaultLlmModelFileNameValue(key)) return;
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
    this.appSettings = updateLlmSelectionSettingsValue(this.appSettings, {
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
      proofreadModelTier: this.proofreadModelTier()
    });
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
    if (!isVramOomErrorValue(errorMsg)) return false;
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

  async startLlm(silent = false, proofreadTier?: 'e4b' | '12b'): Promise<void> {
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
        llmCtx: llmCtxVal > 0 ? llmCtxVal : null,
        proofreadTier: proofreadTier ?? null
      });
      this.llmServerStatus.set('running');
      await this.syncLlmUrl();
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

  private getStoredProofreadSystemPrompt(): string {
    const fallback = this.getDefaultForCurrentPromptType();
    if (this.llmBackendMode() !== 'local_gguf') {
      const model = this.activeOpenAiModelInput().trim();
      if (!model) return fallback;
      const key = `${this.llmBackendMode()}:${model}`;
      const value = this.appSettings.llm?.systemPromptsByBackend?.[key];
      return typeof value === 'string' ? value : fallback;
    }
    const key = getLlmModelFileNameValue(this.llmModelPath());
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
    return buildLlmInferenceParamsKeyValue(
      this.llmBackendMode(),
      this.activeOpenAiModelInput()
    );
  }

  private normalizeLlmNCtx(value: number): number {
    return normalizeLlmNCtxValue(value);
  }

  private normalizeLlmMaxBatch(value: number): number {
    return normalizeLlmMaxBatchValue(value);
  }

  private normalizeLlmParallel(value: number): number {
    return normalizeLlmParallelValue(value);
  }

  private getStoredLlmInferenceParams(): { nCtx: number; maxBatch: number } {
    return getStoredLlmInferenceParamsValue(
      this.appSettings,
      this.buildLlmInferenceParamsKey()
    );
  }

  private applyLlmInferenceParamsForSelectedModel(): void {
    const { nCtx, maxBatch } = this.getStoredLlmInferenceParams();
    this.llmNCtx.set(nCtx);
    this.llmMaxBatch.set(maxBatch);
  }

  private persistLlmInferenceParams(): void {
    const key = this.buildLlmInferenceParamsKey();
    this.appSettings = updateStoredLlmInferenceParamsValue(this.appSettings, key, {
      nCtx: this.llmNCtx(),
      maxBatch: this.llmMaxBatch()
    });
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
    this.appSettings = updateStoredLlmInferenceParamsValue(this.appSettings, key, null, true);
    this.persistAppSettings();
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
          mode: normalizeDevEmulationModeValue(status.mode),
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
    const mode = normalizeDevEmulationModeValue(emu.mode);
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
        cpuBackendRequired: this.cpuVoiceInputBuild,
        cpuBackend: false,
        cpuBackendExpectedPath: '',
        gemmaGguf: false,
        gemmaGgufExpectedPath: '',
        mmprojGguf: false,
        mmprojGgufExpectedPath: '',
        ffmpegRequired: this.cpuVoiceInputBuild,
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
    if (!this.cpuVoiceInputBuild || !this.isTauriRuntime()) {
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
    if (this.cpuVoiceInputBuild
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
    if (!this.cpuVoiceInputBuild || this.editorVoiceInputMemoryTier() !== 'low' || this.editorLowMemoryVoiceInputOptIn()) {
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
    if (!this.cpuVoiceInputBuild) return;
    this.editorLowMemoryVoiceInputOptIn.set(
      this.browserStorage.readFlag(this.editorLowMemoryVoiceInputOptInStorageKey)
    );
  }

  private persistEditorLowMemoryVoiceInputOptIn(): void {
    this.editorLowMemoryVoiceInputOptIn.set(true);
    // 保存できない場合も、現在の起動中は明示的な同意を有効として扱う。
    this.browserStorage.writeFlag(this.editorLowMemoryVoiceInputOptInStorageKey);
  }

  async devDeleteEditorVoiceInputPack(): Promise<void> {
    if (!this.editorVoiceInputDevControlsVisible() || this.editorVoiceInputPackDeleting()) return;
    const ok = window.confirm(
      this.cpuVoiceInputBuild
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
    return validateHfTokenFormatValue(rawToken);
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

      // 自動句読点付与で常に内蔵E4Bを使うため、選択中の全体校正バックエンドに
      // 関係なくGPUバックエンドを準備する。
      if (this.aiProofreadBuild && !this.allSetupStatus()?.llmBackend) {
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

        // バックエンド未導入の段階では起動を試さない。特に Linux NVIDIA 開発環境は
        // CUDA llama-server を同梱しておらず、Vulkan 取得前の起動は必ず失敗する。
        // 校正エンジンは実際の校正実行時に遅延起動する。
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
    return getImportCompletedMessageValue(this.canShowTranscriptionTab());
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
        if (!this.running() && !this.diarizationRunning() && !this.proofreadRunning() && !this.llmProofreadRunning() && !this.overallProofreadRunning()) {
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
        } else if (this.overallProofreadRunning()) {
          if (stage === 'overall_proofread') {
            const total = typeof payload.total === 'number' && Number.isFinite(payload.total)
              ? Math.floor(payload.total)
              : null;
            if (total !== null && total > 0) {
              const current = typeof payload.current === 'number' && Number.isFinite(payload.current)
                ? payload.current
                : this.overallProofreadProgressCurrent;
              this.overallProofreadProgressCurrent = Math.min(
                Math.max(0, Math.floor(current)),
                total,
              );
              this.overallProofreadProgressStarted = true;
              this.overallProofreadStatus.set(
                formatOverallProofreadProgressValue(this.overallProofreadProgressCurrent, total),
              );
            }
            return;
          }
          if (stage === 'llm_loading' && !this.overallProofreadProgressStarted) {
            if (typeof payload.message === 'string' && payload.message.length > 0) {
              this.overallProofreadStatus.set(payload.message);
            }
          }
          return;
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

        const step = resolveStepForStageValue(stage, this.diarization());
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

  get uniqueSpeakers(): ReadonlyArray<string> {
    return this._uniqueSpeakersComputed();
  }

  get speakerOptions(): ReadonlyArray<string> {
    return this.uniqueSpeakers;
  }

  speakerOptionLabel(key: string): string {
    return speakerOptionLabelValue(key, this.speakerAliasMap());
  }

  trackBySegmentId(_index: number, segment: TranscriptionSegment): number {
    return segment.id;
  }

  getSpeakerColorClass(speakerKey: string): string {
    return getSpeakerColorClassValue(speakerKey);
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
    return displaySpeakerValue(source, this.speakerAliasMap());
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
    return normalizeSpeakerKeyValue(value);
  }

  formatMinuteSecond(seconds: number): string {
    return formatMinuteSecondValue(seconds);
  }

  formatElapsedMinuteSecond(seconds: number): string {
    return formatElapsedMinuteSecondValue(seconds);
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

    this.previewPaused = false;
    const audio = this.getOrCreatePreviewAudio();
    // 再生用の変換（Linux の AAC 等）が失敗しうるため、ここで止めて理由を出す。
    let src: string;
    try {
      src = await this.resolvePlayableAudioSrc(path);
    } catch (e) {
      this.error.set(`音声を再生できませんでした: ${this.normalizeErrorMessage(e)}`);
      return;
    }
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

  private pauseSegmentPlayback(dismissControls: boolean): void {
    const playingId = this.playingSegmentId();
    if (playingId === null || !this.previewAudio) return;

    // 読み込み・seek中の遅延playも無効化し、現在位置と連続再生キューは保持する。
    ++this.seekPlayGeneration;
    this.previewAudio.pause();
    this.previewPaused = true;
    if (dismissControls) {
      this.sequenceSnackBarRef?.dismiss();
      this.sequenceSnackBarRef = null;
    }
    // 一時停止した行をそのまま直せるようにキャレットを末尾へ置く。
    this.focusSegmentTextareaById(playingId);
  }

  stopSegmentPlayback(): void {
    ++this.seekPlayGeneration;
    this.sequenceSnackBarRef?.dismiss();
    this.sequenceSnackBarRef = null;
    this.previewPaused = false;
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
    const ref = this.snackBar.openFromComponent(PlaybackControlSnackbarComponent, {
      data: {
        playbackRateOptions: this.playbackRateOptions,
        playbackRate: this.playbackRate,
        onRateChange: (rate: number) => this.onPlaybackRateChange(rate),
        onPause: () => this.pauseSegmentPlayback(true),
        isLoop,
      },
      duration: 0,
      horizontalPosition: 'center',
      verticalPosition: 'bottom',
    });
    this.sequenceSnackBarRef = ref;
    // Escape、スワイプ、別のスナックバーによる置換など、親以外から閉じられた場合も
    // 破棄済み参照を残さない。新しいrefへ切り替え済みなら古い通知では消さない。
    ref.afterDismissed().subscribe(() => {
      if (this.sequenceSnackBarRef === ref) {
        this.sequenceSnackBarRef = null;
      }
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
    // Linux の同梱 GStreamer は LGPL プラグインのみのため、AAC 等は Rust 側が
    // 同梱 LGPL ffmpeg で FLAC へ変換し、そのキャッシュのパスを返す。
    await this.ensurePlaybackTranscodeProgressListener();
    try {
      const servedPath = await invoke<string>('prepare_playback_source', { path });
      return `http://127.0.0.1:${this.audioStreamInfo.port}/${encodeURIComponent(servedPath)}?token=${this.audioStreamInfo.token}`;
    } finally {
      this.dismissPlaybackTranscodeSnackbar();
    }
  }

  /**
   * 再生用変換の進捗を表示する。変換は形式ごとに初回だけ走り、以降はキャッシュを使うため
   * 通常はイベントが来ずスナックバーも出ない。
   */
  private async ensurePlaybackTranscodeProgressListener(): Promise<void> {
    if (!this.isTauriRuntime() || this.playbackTranscodeUnlisten) {
      return;
    }
    this.playbackTranscodeUnlisten = await listen<{ state: string; percent: number }>(
      'playback-transcode-progress',
      (event) => {
        const { state, percent } = event.payload;
        if (state === 'done' || state === 'error') {
          this.dismissPlaybackTranscodeSnackbar();
          return;
        }
        this.playbackTranscodePercent.set(Number.isFinite(percent) ? percent : 0);
        if (!this.playbackTranscodeSnackBarRef) {
          this.playbackTranscodeSnackBarRef = this.snackBar.openFromComponent(
            ProgressSnackbarComponent,
            {
              data: { statusText: this.playbackTranscodeStatusText },
              duration: 0,
              horizontalPosition: 'center',
              verticalPosition: 'bottom',
            }
          );
        }
      }
    );
  }

  private dismissPlaybackTranscodeSnackbar(): void {
    if (this.playbackTranscodeSnackBarRef) {
      this.playbackTranscodeSnackBarRef.dismiss();
      this.playbackTranscodeSnackBarRef = null;
    }
    this.playbackTranscodePercent.set(0);
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

  getEditableText(segment: TranscriptionSegment): string {
    const map = this.editedSegmentTextMap();
    return this.getEditableTextFromMap(segment, map);
  }

  getEditableTextFromMap(segment: TranscriptionSegment, map: Partial<Record<number, string>>): string {
    return getEditableTextFromMapValue(segment, map);
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
    this.segmentTextHistory.delete(segmentId);
    this.updateEditableText(segmentId, value);
  }

  onSegmentTextInput(segmentId: number, event: Event): void {
    const textarea = event.target;
    if (!(textarea instanceof HTMLTextAreaElement)) {
      return;
    }
    const before = this.getEditableTextById(segmentId);
    const after = textarea.value;
    if (before === after) {
      return;
    }
    const inputKind = event instanceof InputEvent ? event.inputType : '';
    this.recordSegmentTextEdit(
      segmentId,
      before,
      after,
      textarea.selectionStart ?? after.length,
      inputKind,
    );
    this.updateEditableText(segmentId, after);
  }

  private updateEditableText(segmentId: number, value: string): void {
    const next = { ...this.editedSegmentTextMap() };
    next[segmentId] = value;
    this.editedSegmentTextMap.set(next);
    this.clearProofreadMetadataIfTextDiverged(segmentId, value);
  }

  private recordSegmentTextEdit(
    segmentId: number,
    before: string,
    after: string,
    afterCaret: number,
    inputKind: string,
  ): void {
    const history = this.segmentTextHistory.get(segmentId) ?? { undo: [], redo: [] };
    const timestamp = Date.now();
    const normalizedKind = coalescingInputKindValue(inputKind);
    const beforeCaret = changedRangeEndValue(before, after);
    const previous = history.undo.at(-1);
    const canMerge = !!previous
      && normalizedKind.length > 0
      && previous.inputKind === normalizedKind
      && previous.after === before
      && timestamp - previous.timestamp <= this.segmentTextHistoryMergeWindowMs;

    if (canMerge && previous) {
      previous.after = after;
      previous.afterCaret = afterCaret;
      previous.timestamp = timestamp;
    } else {
      if (previous && previous.after !== before) {
        history.undo = [];
      }
      history.undo.push({
        before,
        after,
        beforeCaret,
        afterCaret,
        inputKind: normalizedKind,
        timestamp,
      });
      if (history.undo.length > this.segmentTextHistoryLimit) {
        history.undo.splice(0, history.undo.length - this.segmentTextHistoryLimit);
      }
    }
    history.redo = [];
    this.segmentTextHistory.set(segmentId, history);
  }

  private undoSegmentTextEdit(segmentId: number, textarea: HTMLTextAreaElement): void {
    const history = this.segmentTextHistory.get(segmentId);
    const entry = history?.undo.at(-1);
    if (!history || !entry) {
      return;
    }
    if (this.getEditableTextById(segmentId) !== entry.after) {
      this.segmentTextHistory.delete(segmentId);
      return;
    }
    history.undo.pop();
    history.redo.push(entry);
    this.applySegmentTextHistoryValue(segmentId, entry.before, entry.beforeCaret, textarea);
  }

  private redoSegmentTextEdit(segmentId: number, textarea: HTMLTextAreaElement): void {
    const history = this.segmentTextHistory.get(segmentId);
    const entry = history?.redo.at(-1);
    if (!history || !entry) {
      return;
    }
    if (this.getEditableTextById(segmentId) !== entry.before) {
      this.segmentTextHistory.delete(segmentId);
      return;
    }
    history.redo.pop();
    history.undo.push(entry);
    this.applySegmentTextHistoryValue(segmentId, entry.after, entry.afterCaret, textarea);
  }

  private applySegmentTextHistoryValue(
    segmentId: number,
    value: string,
    caret: number,
    textarea: HTMLTextAreaElement,
  ): void {
    textarea.value = value;
    this.updateEditableText(segmentId, value);
    const safeCaret = Math.max(0, Math.min(value.length, caret));
    textarea.setSelectionRange(safeCaret, safeCaret);
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
        .reduce((acc, text) => mergeSegmentTextValue(acc, text), '');
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
    const newSegmentId = generateNextSegmentIdValue(segments);

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

  onLocationAreaChange(value: LocationAreaCode): void {
    const area = normalizeLocationAreaValue(value);
    this.selectedLocationArea.set(area);
    this.selectedLocationPrefectures.set(this.selectedLocationPrefecturesByArea()[area] ?? []);
    this.persistProofreadSettings();
  }

  onSelectedLocationPrefecturesChange(value: string[] | string): void {
    const area = this.selectedLocationArea();
    const areaCodes = new Set(getLocationAreaPrefectureCodesValue(area));
    const prefectures = normalizeLocationPrefectureCodesValue(Array.isArray(value) ? value : [value])
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
    return shouldShowVoiceInputShortCandidateHintValue(candidates);
  }

  voiceInputButtonTooltip(segmentId: number): string {
    return voiceInputButtonTooltipValue(
      this.editorVoiceInputAvailable(),
      this.editorVoiceInputUnavailableTooltip(),
      this.isVoiceInputRecording(segmentId)
    );
  }

  segmentRetranscribeUnavailableReason(): string | null {
    return segmentRetranscribeUnavailableReasonValue({
      packChecked: this.editorVoiceInputPackChecked(),
      voiceInputAvailable: this.editorVoiceInputAvailable(),
      retranscribeSupported: this.segmentRetranscribeSupported(),
      cpuVoiceInputBuild: this.cpuVoiceInputBuild,
      playbackDisabled: this.isPlaybackDisabled(),
      selectedAudioPath: this.selectedAudioPath()
    });
  }

  segmentRetranscribeTooltip(segmentId: number): string {
    return segmentRetranscribeTooltipValue(
      this.segmentRetranscribeUnavailableReason(),
      this.isVoiceInputProcessing(segmentId)
    );
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
        const message = '候補を生成できませんでした。';
        this.voiceInputError.set(message);
        this.voiceInputCandidates.set(null);
        this.voiceInputStatus.set('');
        this.showAmdGpuProcessingFailure('区間の聞き直し', message);
      } else {
        this.voiceInputCandidates.set({ segmentId: segment.id, candidates, mode: 'replace' });
        this.voiceInputStatus.set('');
      }
    } catch (error) {
      this.voiceInputCandidates.set(null);
      this.voiceInputStatus.set('');
      const message = this.normalizeErrorMessage(error);
      this.voiceInputError.set(message);
      this.showAmdGpuProcessingFailure('区間の聞き直し', message);
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
      this.voiceInputError.set(normalizeVoiceInputErrorMessageValue(error));
    }
  }

  private async finishVoiceInputRecording(segmentId: number): Promise<void> {
    if (this.voiceInputRecordingSegmentId() !== segmentId) {
      return;
    }
    const chunks = this.voiceInputChunks.map((chunk) => new Float32Array(chunk));
    const sourceRate = this.voiceInputSampleRate || 48000;
    this.cleanupVoiceInputRecording(false);
    const merged = mergeFloat32ChunksValue(chunks);
    if (merged.length < sourceRate * 0.15) {
      this.voiceInputStatus.set('');
      this.voiceInputError.set('録音が短すぎます。');
      return;
    }
    const maxSourceSamples = Math.floor(sourceRate * this.voiceInputMaxRecordingSeconds);
    const clipped = merged.length > maxSourceSamples ? merged.slice(0, maxSourceSamples) : merged;
    const resampled = resamplePcmTo16kValue(clipped, sourceRate);
    const wav = encodePcm16WavValue(resampled, 16000);
    const wavBase64 = arrayBufferToBase64Value(wav);
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
        const message = '候補を生成できませんでした。';
        this.voiceInputError.set(message);
        this.voiceInputCandidates.set(null);
        this.showAmdGpuProcessingFailure('音声入力', message);
      } else {
        this.voiceInputCandidates.set({ segmentId, candidates, mode: 'insert' });
        this.voiceInputStatus.set('');
        this.voiceInputFeedbackSegmentId.set(segmentId);
      }
    } catch (error) {
      this.voiceInputCandidates.set(null);
      this.voiceInputStatus.set('');
      const message = normalizeVoiceInputErrorMessageValue(error);
      this.voiceInputError.set(message);
      this.showAmdGpuProcessingFailure('音声入力', message);
    } finally {
      this.voiceInputProcessingSegmentId.set(null);
    }
  }

  private buildVoiceInputContext(segmentId: number): EditorVoiceInputContext | null {
    const rows = this.segmentRows;
    const editedMap = this.editedSegmentTextMap();
    return buildVoiceInputContextValue(
      rows,
      this.result()?.segments ?? [],
      segmentId,
      this.segmentRowNumberMap(),
      (segment) => this.displaySpeaker(this.getAssignedSpeakerKey(segment)),
      (segment) => this.getEditableTextFromMap(segment, editedMap)
    );
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
    const range = resolveTimeInputRangeValue(this.editingTimeValues());
    if (!range) {
      return;
    }
    const current = this.result();
    if (current) {
      const segments = current.segments.map((s) =>
        s.id === segmentId ? { ...s, start: range.startSeconds, end: range.endSeconds } : s
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
    const next = stepTimeInputValuesValue(this.editingTimeValues(), field, delta);
    if (next) {
      this.editingTimeValues.set(next);
    }
  }

  onTimeInputChange(value: string, field: 'startMm' | 'startSs' | 'endMm' | 'endSs'): void {
    const numeric = normalizeTimeInputValue(value);
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

  closeAmdGpuFailureDialog(): void {
    this.amdGpuFailureDialog.set(null);
  }

  private showAmdGpuProcessingFailure(operation: string, message: string): void {
    if (this.buildVariant() !== 'rocm') return;
    const normalized = String(message ?? '').trim() || `${operation}に失敗しました。`;
    if (/中止しました|cancel(?:led|ed)?/i.test(normalized)) return;
    this.amdGpuFailureDialog.set({ operation, message: normalized });
  }

  confirmDialogButtonClass(color: ConfirmDialogColor, role: 'confirm' | 'cancel'): string {
    return confirmDialogButtonClassValue(color, role);
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
