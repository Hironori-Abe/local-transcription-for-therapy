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
import { BestEffortBrowserStorage, loadAudioMetadataDuration, waitForAudioSeek } from './browser-adapters';
import {
  APP_SETTINGS_STORAGE_KEY,
  LEGACY_APP_SETTINGS_STORAGE_KEY,
  LEGACY_RUNTIME_ESTIMATE_STORAGE_KEY,
  RUNTIME_ESTIMATE_STORAGE_KEY
} from './storage-keys';
import { replaceAllInRows, replaceFirstInRows } from './find-replace';
import { formatLegacyDataSize, groupLegacyData, legacyDataTotalLabel, type LegacyDataItem } from './legacy-data';
import { AsyncCleanupSlot, OneShotTimer, RepeatingTimer } from './lifecycle-resources';
import {
  PlaybackSession,
  playbackActionFor,
  type PlaybackSnapshot,
  buildPlaybackQueue,
  clampPlaybackTarget,
  clampTargetToRange,
  normalizePlaybackRange,
  expandShortPlaybackRange,
  resolveNextPlaybackSegment,
  resolveSequenceSeek,
  resolveShortcutTarget
} from './playback-state';
import {
  insertSegmentRelative as buildRelativeSegmentInsertion,
  insertTextAtSelection,
  type SegmentStructureResult,
  SegmentTextHistoryStore,
  splitSegmentAtSentenceEndings
} from './text-editing';
import {
  buildTranscriptionSavePlan,
  ensureExportPathExtension,
  type TranscriptionExportKind
} from './transcription-io';
import {
  type AppSettingsV1,
  type GgmlSpeechStatus,
  type ThemeMode,
  type VulkanGpuDevice,
  type VulkanGpuList
} from './app-settings';
import {
  aggregateDownloadProgressPercent,
  browserSetupStatus,
  browserVoiceInputPackStatus,
  needsFullSetup,
  projectSetupStatus,
  setupErrorProgress,
  unavailableSetupProjection,
  updateSetupProgress,
  type AllSetupStatus,
  type EditorVoiceInputPackStatus,
  type SetupProgressEvent
} from './setup-state';
import {
  buildVoiceInputContext,
  normalizeVoiceInputCandidates,
  normalizeVoiceInputErrorMessage,
  prepareVoiceInput,
  type VoiceInputContext
} from './voice-input';
import {
  appendRuntimeEstimateSampleValue,
  buildDocxExportRowsValue,
  buildInitialSpeakerAliasMapValue,
  buildInitialSpeakerSelectionMapValue,
  buildLocationDetectionScopeValue,
  buildConsecutiveSpeakerRunMapValue,
  buildSegmentRowNumberMapValue,
  buildSrtExportRowsValue,
  buildXlsxExportRowsValue,
  buildUniqueSpeakersValue,
  calculateRuntimeEstimateValue,
  confirmDialogButtonClassValue,
  displaySpeakerValue,
  editorVoiceInputUnavailableTooltipValue,
  formatAudioDurationValue,
  formatElapsedMinuteSecondValue,
  formatEstimatedMinutesValue,
  formatMinuteSecondValue,
  getAudioDurationMessageValue,
  getEditableTextFromMapValue,
  getEstimatedTimeMessageValue,
  getImportCompletedMessageValue,
  getProgressStageOrderValue,
  getLocationAreaPrefectureCodesValue,
  getSpeakerColorClassValue,
  hasFallbackInTranscriptionResultValue,
  isDiarizationModelMissingValue,
  isJapaneseLanguageValue,
  isPlaybackDisabledValue,
  matchPlaybackShortcutCodeValue,
  normalizeErrorMessageValue,
  normalizeLocationAreaValue,
  normalizeSpeakerKeyValue,
  normalizeTimeInputValue,
  normalizeLocationPrefectureCodesValue,
  normalizeProofreadChunkMaxCharsValue,
  normalizeProofreadChunkSizeValue,
  normalizeThemeModeValue,
  normalizeTranscriptionDeviceValue,
  effectiveVulkanGpuUuidValue,
  speechDeviceLineValue,
  activeVulkanGpuNameValue,
  diarizationGpuFallbackNoticeValue,
  vulkanGpuAutoLabelValue,
  vulkanGpuLabelValue,
  normalizeTranscriptionLanguageValue,
  parseRuntimeEstimateSamplesValue,
  pickRuntimeEstimateSamplesValue,
  resolveRuntimeLogAudioSecondsValue,
  GGML_ESTIMATE_PROFILE,
  resolveGeneralAppSettingsValue,
  AUDIO_PREPROCESS_PRESET_OPTIONS,
  getAudioPreprocessPresetHintValue,
  normalizeAudioPreprocessPresetValue,
  type AudioPreprocessPreset,
  resolveTimeInputRangeValue,
  resolveStepForStageValue,
  shouldShowVoiceInputShortCandidateHintValue,
  selectedFileNameValue,
  selectedLocationPrefectureTotalCountValue,
  stripRemovedSettingsValue,
  speakerOptionLabelValue,
  stepTimeInputValuesValue,
  locationDetectionScopeHintValue,
  themeModeLabelValue,
  themeToggleIconValue,
  transcriptionTabDisabledValue,
  transcriptionTabLabelValue,
  transcriptionRuntimeReasonValue,
  voiceInputButtonTooltipValue,
  processingStatusTextValue,
  type DocumentExportSourceRow,
  type LocationAreaCode,
  type LocationDetectionScope,
  type RuntimeEstimateSample,
  type BuildVariant,
  isBuildVariantValue
} from './app-utils';
import {
  buildExportTranscriptionPayloadValue,
  buildImportedTranscriptionStateValue,
  buildProofreadHintValue,
  getSensitiveEntityHighlightLevelValue,
  isPunctuationOnlyProofreadReasonValue,
  mergeConsecutiveSpeakerSegmentsValue,
  normalizeProofreadMetadataValue,
  parseImportedTranscriptionJsonValue,
  resolveProofreadLanguageValue,
  reconcileRetranscriptionStateValue,
  type ExportProofreadMetadata,
  type ExportTranscriptionPayload,
  type ProofreadHighlightLevel,
  type SensitiveEntityHighlightInput
} from './proofread-metadata.utils';
import { TRANSCRIPTION_LANGUAGE_OPTIONS } from './transcription-language-options';
import { MatTabsModule } from '@angular/material/tabs';
import { MatToolbarModule } from '@angular/material/toolbar';
import { MatTooltipModule } from '@angular/material/tooltip';
import { save, open } from '@tauri-apps/plugin-dialog';
import { getVersion } from '@tauri-apps/api/app';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
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
    requestedDevice?: string | null;
    gpuFallback?: boolean | null;
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

interface ReadTextFileResponse {
  content: string;
}

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

type ProofreadRunSource = 'transcription' | 'reader';
type CancelRunKind = 'transcription' | 'transcriptionPipeline' | 'proofread' | 'diarization';
type ConfirmDialogActionKind = 'removeSegment' | 'cancelRun' | 'mergeUtterances' | 'importJsonOverwrite' | 'startTranscriptionConfirm' | 'deleteAllModels';
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

interface EditorVoiceInputResponse {
  candidates: string[];
}

interface DeleteModelsResponse {
  deleted: string[];
  notFound: string[];
  errors: string[];
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
  readonly isDevModeBuild = isDevMode();
  readonly appDisplayName = this.editorOnlyBuild
    ? 'Local Transcription for Therapy (LoTT) (Editor)'
    : 'Local Transcription for Therapy (LoTT)';
  readonly appVersion = signal<string>('');
  readonly isTauriRuntime = signal<boolean>(this.detectTauriRuntime());
  readonly runtimeCheckDone = signal<boolean>(false);
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
  readonly diarizationDevice = signal<TranscriptionDeviceOption>('cuda');
  readonly whisperModel = signal<string>('turbo');
  readonly transcriptionLanguage = signal<string>('ja');
  readonly transcriptionDevice = signal<TranscriptionDeviceOption>('cuda');
  // 編集UIの「+、」「+。」ボタンが挿入する句読点。日本語のときは全角（、。）、
  // それ以外の言語では半角（, .）。判定は結果が実際に文字起こしされた言語を優先し、
  // 無ければ現在の言語設定にフォールバックする。
  readonly editPunctuationIsJapanese = computed<boolean>(() => {
    const lang = (this.result()?.settings?.language ?? this.transcriptionLanguage() ?? 'ja').toLowerCase();
    return isJapaneseLanguageValue(lang);
  });
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
  readonly parallelDiarizationStatus = signal<string>('');
  readonly runningSeconds = signal<number>(0);
  readonly proofreadRunning = signal<boolean>(false);
  readonly proofreadStatus = signal<string>('');
  readonly punctStatus = signal<string>('');
  /** ビルド種別。'vulkan' = フル機能版、'editor' = Editor 版（Rust の identifier で判定）。 */
  readonly buildVariant = signal<BuildVariant>(this.editorOnlyBuild ? 'editor' : 'vulkan');
  /** Rust側の実行時判定。nullの間だけAngularのコンパイル時値へフォールバックする。 */
  readonly runtimeBuildVariant = signal<BuildVariant | null>(null);
  readonly vulkanBuild = computed(() => this.buildVariant() === 'vulkan');
  /** Vulkan 版: Vulkan で使える GPU があるか（null は未確認）と、自動選択される GPU の名前。 */
  readonly vulkanAvailable = signal<boolean | null>(null);
  readonly vulkanGpuName = signal<string>('');
  /** 開発ビルドで LOTT_DEV_FORCE_CPU=1 が有効なとき true（GPU を無いものとして CPU で動かす）。 */
  readonly devForceCpu = signal<boolean>(false);
  /** Full 版: 今 CPU で処理する（GPU が見つからない／開発用の CPU 強制）。 */
  readonly speechRunsOnCpu = computed(() => this.vulkanBuild() && this.vulkanAvailable() === false);
  /** 文字起こし画面に出すGPU/CPUの説明行（未確認・Editor 版は空）。 */
  readonly speechDeviceLine = computed(() =>
    this.vulkanBuild()
      ? speechDeviceLineValue({
          vulkanAvailable: this.vulkanAvailable(),
          gpuName: activeVulkanGpuNameValue(this.ggmlGpuUuid(), this.vulkanGpus(), this.vulkanGpuName()),
          devForceCpu: this.devForceCpu()
        })
      : ''
  );
  /** Vulkan 版: CUDA 版から上書きしたときに残った不要データ（リリース版のみ。無ければ空）。 */
  readonly legacyCudaData = signal<LegacyDataItem[]>([]);
  readonly legacyCudaDataConfirming = signal<boolean>(false);
  /** セットアップ画面で開いているライセンス本文（Nemotron。空なら閉じている）。 */
  readonly setupLicenseText = signal<string>('');
  readonly legacyCudaDataDeleting = signal<boolean>(false);
  readonly legacyCudaDataMessage = signal<string>('');
  readonly legacyCudaDataTotalLabel = computed(() => legacyDataTotalLabel(this.legacyCudaData()));
  readonly legacyCudaDataGroups = computed(() => groupLegacyData(this.legacyCudaData()));
  readonly formatLegacyDataSize = formatLegacyDataSize;
  /** Rustが返す実行OS。GPU導入案内をLinux/Windowsで分離するために使う。 */
  readonly runtimePlatform = signal<'windows' | 'linux' | 'macos' | 'other' | 'unknown'>('unknown');
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
      ruleProofreadRunning: this.proofreadRunning(),
      ruleProofreadProgressText: this.proofreadProgressText(),
      ruleProofreadStatus: this.proofreadStatus(),
      cpuMode: this.speechRunsOnCpu()
    });
  });
  readonly mergeStatus = signal<string>('');
  readonly mergeRunning = signal<boolean>(false);
  readonly proofreadStatusSource = signal<ProofreadRunSource | null>(null);
  readonly proofreadRunningSeconds = signal<number>(0);
  readonly diarizationRunning = signal<boolean>(false);
  readonly diarizationCanceling = signal<boolean>(false);
  readonly diarizationStatus = signal<string>('');
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
  private readonly segmentTextHistory = new SegmentTextHistoryStore();
  readonly playbackState = signal<PlaybackSnapshot>({ status: 'idle', segmentId: null, loop: false });
  private readonly playbackSession = new PlaybackSession(state => this.playbackState.set(state));
  readonly playingSegmentId = computed(() => this.playbackState().segmentId);
  readonly playbackRateOptions = [0.4, 0.6, 0.8, 1.0, 1.2, 1.4, 1.6 /*, 1.8, 2.0 */];
  readonly playbackRate = signal<number>(1.0);
  readonly shortcutHints: ReadonlyArray<string> = [
    'Ctrl+Shift+F（置換）',
    'Ctrl+Shift+Space or P（連続再生 / 一時停止 / 再開）',
    'Ctrl+Shift+A（5秒戻す）',
    'Ctrl+Shift+D（5秒進める）',
    'Ctrl+Shift+E（話者を切替）',
    'Ctrl+Shift+M（音声入力）'
  ];
  // 全ヒントを最初から描画し、CSS の合成レイヤー内だけで切り替える。
  // 実行中に Angular signal や textContent を更新しないことで、sticky な編集画面全体の
  // Layout / Paint を避ける。
  readonly shortcutHintDisplaySeconds = 5;
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
  readonly voiceInputCandidates = signal<{ segmentId: number; candidates: string[] } | null>(null);
  readonly voiceInputStatus = signal<string>('');
  readonly voiceInputError = signal<string>('');
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
    () => this.editorVoiceInputPackStatus()?.installed === true
  );
  readonly editorVoiceInputUnavailableTooltip = computed(() =>
    editorVoiceInputUnavailableTooltipValue(
      this.editorVoiceInputPackChecked(),
      this.vulkanBuild() || this.editorOnlyBuild
    )
  );
  readonly editorVoiceInputDevControlsVisible = computed(
    () => this.isDevModeBuild && this.isTauriRuntime()
  );
  readonly editorVoiceInputInstallPercent = computed(() => {
    return aggregateDownloadProgressPercent(Object.values(this.editorVoiceInputPackProgressMap()));
  });
  readonly needsFullSetup = computed(() => {
    return needsFullSetup({
      editorOnlyBuild: this.editorOnlyBuild,
      tauriRuntime: this.isTauriRuntime(),
      setupChecked: this.allSetupChecked(),
      status: this.allSetupStatus(),
      transcriptionTabVisible: this.transcriptionTabVisible()
    });
  });
  readonly transcriptionTabDisabled = computed(() => {
    return transcriptionTabDisabledValue({
      transcriptionTabVisible: this.transcriptionTabVisible(),
      editorOnlyBuild: this.editorOnlyBuild,
      setupChecked: this.allSetupChecked(),
      needsFullSetup: this.needsFullSetup(),
      transcriptionRuntimeAvailable: this.transcriptionRuntimeAvailable()
    });
  });

  readonly segmentRowFilter = signal<'all' | 'caution' | 'caution_context'>('all');
  readonly parallelMode = signal<'standard' | 'fast'>('standard');
  readonly ggmlSpeechStatus = signal<GgmlSpeechStatus | null>(null);
  /** ggml エンジン（Vulkan 版）の GPU 一覧と、設定で選ばれた GPU（UUID。'' は自動）。 */
  readonly vulkanGpus = signal<VulkanGpuList | null>(null);
  /** GPU が見つからないとき、ドライバーの確認を促す案内文（無ければ null）。 */
  readonly gpuDriverHint = signal<string | null>(null);
  readonly ggmlGpuUuid = signal<string>('');
  /** 文字起こし用音声の調整プリセット（話者分離には適用しない）。 */
  readonly audioPreprocess = signal<AudioPreprocessPreset>('none');
  readonly audioPreprocessPresetOptions = AUDIO_PREPROCESS_PRESET_OPTIONS;
  readonly audioPreprocessPresetHint = computed<string>(() =>
    getAudioPreprocessPresetHintValue(this.audioPreprocess())
  );
  /** Vulkan 版の ggml エンジンを使う設定のときだけ GPU 選択欄を出す。 */
  /** 音声エンジンで使う GPU を選べるよう、GPU が1つでもあれば選択欄を出す（Editor 版は GPU を使わない）。 */
  readonly ggmlGpuSelectorVisible = computed(
    () => this.vulkanBuild() && (this.vulkanGpus()?.devices.length ?? 0) > 0
  );
  readonly ggmlGpuSelectValue = computed(() => effectiveVulkanGpuUuidValue(this.ggmlGpuUuid(), this.vulkanGpus()));
  readonly ggmlGpuAutoLabel = computed(() => vulkanGpuAutoLabelValue(this.vulkanGpus()));
  readonly ggmlSpeechWarning = computed(() => {
    const status = this.ggmlSpeechStatus();
    const lines: string[] = [];
    if (status && !status.transcriptionReady) {
      lines.push(`文字起こし（whisper.cpp）の準備が済んでいません: ${status.missingForTranscription.join(' / ')}`);
    }
    if (status && !status.diarizationReady) {
      lines.push(`話者分離（Nemotron）の準備が済んでいません: ${status.missingForDiarization.join(' / ')}`);
    }
    return lines.join('\n');
  });
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
  readonly cautionPinnedSegmentIds = signal<Record<number, boolean>>({});
  readonly cautionExtracting = signal<boolean>(false);
  readonly cautionExtractingProgress = signal<{ current: number; total: number } | null>(null);
  private _cautionFilterGen = 0;
  private readonly _allRenderLimit = signal<number>(Number.MAX_SAFE_INTEGER);
  readonly findReplaceOpen = signal<boolean>(false);
  readonly findReplaceQuery = signal<string>('');
  readonly findReplaceWith = signal<string>('');
  readonly findReplaceStatus = signal<string>('');
  readonly transcriptionLanguageOptions = TRANSCRIPTION_LANGUAGE_OPTIONS;
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
  readonly speakerCountOptions: ReadonlyArray<number> = [1, 2, 3, 4, 5];
  private readonly runningTicker = new RepeatingTimer();
  // 表示用の進捗を滑らかに進めるためのティッカー（500ms）と、現在実行中の概算所要時間（秒）。
  private readonly smoothProgressTicker = new RepeatingTimer();
  private activeRunEstimatedSeconds: number | null = null;
  private readonly proofreadTicker = new RepeatingTimer();
  private readonly diarizationTicker = new RepeatingTimer();
  private progressSnackBarRef: MatSnackBarRef<ProgressSnackbarComponent> | null = null;
  private readonly progressSubscription = new AsyncCleanupSlot();
  private readonly parallelDiarizationSubscription = new AsyncCleanupSlot();
  private readonly voiceInputPackProgressSubscription = new AsyncCleanupSlot();
  private readonly playbackTranscodeSubscription = new AsyncCleanupSlot();
  private readonly setupProgressSubscription = new AsyncCleanupSlot();
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
  private readonly voiceInputAutoStopTimer = new OneShotTimer();
  private voiceInputSelection: { segmentId: number; start: number; end: number } | null = null;
  private readonly voiceInputMaxRecordingSeconds = 15;
  private previewAudio: HTMLAudioElement | null = null;
  private lastLoadedAudioSrc: string | null = null;
  private get previewPaused(): boolean { return this.playbackState().status === 'paused'; }
  private readonly shortcutSeekSeconds = 5;
  private readonly shortcutFocusRetryTimer = new OneShotTimer();
  private readonly findReplaceFocusTimer = new OneShotTimer();
  private readonly segmentCursorFocusTimer = new OneShotTimer();
  private readonly timeEditFocusTimer = new OneShotTimer();
  private sequenceSnackBarRef: MatSnackBarRef<PlaybackControlSnackbarComponent> | null = null;
  private get previewLoopEnabled(): boolean { return this.playbackState().loop; }
  private previewSequenceSegmentIds: number[] = [];
  private previewSequenceIndex = -1;

  private previewStartSeconds: number | null = null;
  private previewEndSeconds: number | null = null;
  private get seekPlayGeneration(): number { return this.playbackSession.generation; }
  private pendingImportedPayload: ExportTranscriptionPayload | null = null;
  // undefined = 未取得, null = 存在しない, string = パス
  private devDemoDataDir: string | null | undefined = undefined;
  readonly devDeletingModels = signal(false);
  readonly devDeleteModelsResult = signal<{ deleted: string[]; notFound: string[]; errors: string[] } | null>(null);
  readonly devDeleteTarget = signal<'all' | 'whisper_turbo' | 'diarization'>('all');
  private readonly estimateMinRequired = 5;
  private readonly estimateStorageKey = RUNTIME_ESTIMATE_STORAGE_KEY;
  private readonly appSettingsStorageKey = APP_SETTINGS_STORAGE_KEY;
  private readonly browserStorage = new BestEffortBrowserStorage();
  private readonly fixedProofreadChunkSize = 12;
  private readonly fixedProofreadChunkMaxChars = 1200;
  private estimateSamples: RuntimeEstimateSample[] = [];
  private appSettings: AppSettingsV1 = {};
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
    return `推定所要時間（${this.effectiveSpeechDevice() === 'cpu' ? 'CPU' : 'GPU'}）`;
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
    const raw = this.browserStorage.readTextWithLegacy(
      this.estimateStorageKey,
      LEGACY_RUNTIME_ESTIMATE_STORAGE_KEY
    );
    this.estimateSamples = parseRuntimeEstimateSamplesValue(raw);
  }

  private persistEstimateSamples(): void {
    this.browserStorage.writeJson(this.estimateStorageKey, this.estimateSamples);
  }

  private loadAppSettings(): void {
    const stored = this.browserStorage.readObjectWithLegacy<AppSettingsV1>(
      this.appSettingsStorageKey,
      LEGACY_APP_SETTINGS_STORAGE_KEY
    ) ?? {};
    this.appSettings = stripRemovedSettingsValue(stored);
  }

  private persistAppSettings(): void {
    this.appSettings = stripRemovedSettingsValue(this.appSettings);
    this.browserStorage.writeJson(this.appSettingsStorageKey, this.appSettings);
  }

  private applyAppSettings(): void {
    const general = resolveGeneralAppSettingsValue(this.appSettings, {
      transcriptionLanguageOptions: this.transcriptionLanguageOptions,
      playbackRateOptions: this.playbackRateOptions
    });
    if (general.transcriptionDevice !== undefined) {
      this.transcriptionDevice.set(general.transcriptionDevice);
    }
    if (general.transcriptionLanguage !== undefined) {
      this.transcriptionLanguage.set(general.transcriptionLanguage);
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
    if (general.audioPreprocess !== undefined) {
      this.audioPreprocess.set(general.audioPreprocess);
    }
    if (general.ggmlGpuUuid !== undefined) {
      this.ggmlGpuUuid.set(general.ggmlGpuUuid);
      this.syncPreferredVulkanGpu();
    }
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
        language: this.normalizeTranscriptionLanguage(this.transcriptionLanguage()),
        ggmlGpuUuid: this.ggmlGpuUuid(),
        audioPreprocess: this.audioPreprocess()
      }
    };
    this.persistAppSettings();
  }

  onAudioPreprocessPresetChange(value: unknown): void {
    this.audioPreprocess.set(normalizeAudioPreprocessPresetValue(value));
    this.persistTranscriptionSettings();
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
    return normalizeTranscriptionDeviceValue(valueRaw);
  }

  /**
   * 実際に使う実行デバイス。GPU が見つからないときは CPU を送る
   * （'cuda' のまま送ると、話者分離エンジンが GPU を探して一度失敗してから CPU に切り替わるため）。
   */
  private effectiveSpeechDevice(): TranscriptionDeviceOption {
    return this.vulkanAvailable() === false ? 'cpu' : 'cuda';
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
    const device = this.effectiveSpeechDevice();
    return pickRuntimeEstimateSamplesValue(this.estimateSamples, diarization, device, GGML_ESTIMATE_PROFILE);
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
    this.loadAppSettings();
    this.initTheme();
    this.applyAppSettings();
    this.loadEstimateSamples();
    void this.initializeStartupState();
    void this.refreshGgmlSpeechStatus();
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
    this.progressSubscription.clear();
    this.parallelDiarizationSubscription.clear();
    this.voiceInputPackProgressSubscription.clear();
    this.playbackTranscodeSubscription.clear();
    this.setupProgressSubscription.clear();
    this.dismissPlaybackTranscodeSnackbar();
    this.cleanupVoiceInputRecording(false);
    window.removeEventListener('scroll', this._refreshSegmentTableInView);
    this.shortcutFocusRetryTimer.cancel();
    this.findReplaceFocusTimer.cancel();
    this.segmentCursorFocusTimer.cancel();
    this.timeEditFocusTimer.cancel();
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
      case 'KeyP':
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

  /** Ctrl+Shift+M: 対象行の音声入力を開始 / 停止する。 */
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
    if (!this.editorVoiceInputPackChecked()) {
      await this.checkEditorVoiceInputPackStatus();
    }
    if (this.editorVoiceInputPackStatus()?.installed !== true) {
      this.snackBar.open(
        this.editorOnlyBuild
          ? '音声入力には音声認識モデル（whisper.cpp）が必要です。設定画面の「音声入力パック」からダウンロードしてください'
          : '音声入力には文字起こし用のモデル（whisper.cpp）が必要です。設定画面のセットアップを完了してください',
        undefined,
        { duration: 5000 }
      );
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

  /** Ctrl+Shift+Space / P: 連続再生の再生 / 一時停止 / 再開をトグルする。 */
  private handlePlaybackToggleShortcut(): void {
    if (this.isPlaybackDisabled() || !this.selectedAudioPath()) {
      this.snackBar.open('音声ファイルが読み込まれていません', undefined, { duration: 2200 });
      return;
    }
    if (this.playingSegmentId() !== null) {
      this.toggleActivePlayback();
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
    let target = clampPlaybackTarget(audio.currentTime, deltaSeconds, audio.duration);

    if (this.previewLoopEnabled) {
      // リピート再生中はセグメントを切り替えず、区間内にクランプする。
      target = clampTargetToRange(target, {
        start: this.previewStartSeconds ?? 0,
        end: this.previewEndSeconds ?? target
      });
      await this.seekPreviewToSegmentTime(null, target);
      return;
    }

    // 連続再生中: target 秒を含むセグメントを探し、そこから始まるシーケンスへ作り直す。
    const resolved = resolveSequenceSeek(this.segmentRows, audio.currentTime, deltaSeconds, audio.duration);
    if (!resolved) return;
    this.previewSequenceSegmentIds = resolved.queue.segmentIds;
    this.previewSequenceIndex = resolved.queue.index;
    this.setActivePlayingSegment(resolved.segment.id);
    await this.seekPreviewToSegmentTime(resolved.segment, resolved.targetSeconds);
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
    return resolveShortcutTarget(
      this.displayedSegmentRows,
      this.playingSegmentId(),
      this.segmentFromFocusedTextarea()?.id ?? null
    );
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
    this.shortcutFocusRetryTimer.cancel();
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
    this.shortcutFocusRetryTimer.schedule(() => {
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
    const gen = this.playbackSession.beginSeek();
    try {
      await waitForAudioSeek(audio, targetSeconds);
    } catch {
      // seek不能でも現在の再生状態を壊さず、次の操作を受け付ける。
    }
    if (gen !== this.seekPlayGeneration) {
      return;
    }
    this.previewEndSeconds = segment
      ? Math.max((this.previewStartSeconds ?? 0) + 0.1, segment.end)
      : previousEnd;
    this.playbackSession.seekCompleted(gen);
    if (wasPlaying && !this.previewPaused) {
      void this.playPreviewAudio(audio, gen);
    }
  }

  openFindReplaceDialog(): void {
    if (!this.result() || this.segmentRows.length === 0) {
      this.snackBar.open('先に文字起こしを行ってください', undefined, { duration: 2200 });
      return;
    }
    this.findReplaceStatus.set('');
    this.findReplaceOpen.set(true);
    this.findReplaceFocusTimer.schedule(() => {
      const input = document.getElementById('find-replace-find-input') as HTMLInputElement | null;
      input?.focus();
      input?.select();
    }, 0);
  }

  closeFindReplaceDialog(): void {
    this.findReplaceFocusTimer.cancel();
    this.findReplaceOpen.set(false);
    this.findReplaceStatus.set('');
  }

  replaceOneInContents(): void {
    const findText = this.findReplaceQuery();
    if (!findText) {
      this.findReplaceStatus.set('検索文字列を入力してください。');
      return;
    }
    const result = replaceFirstInRows(
      this.segmentRows.map((segment) => ({ id: segment.id, text: this.getEditableText(segment) })),
      findText,
      this.findReplaceWith()
    );
    const update = result.updates[0];
    if (!update) {
      this.findReplaceStatus.set('一致が見つかりませんでした。');
      return;
    }
    const current = { ...this.editedSegmentTextMap() };
    current[update.id] = update.text;
    this.editedSegmentTextMap.set(current);
    this.clearProofreadMetadataIfTextDiverged(update.id, update.text);
    this.findReplaceStatus.set('1 件置換しました。');
  }

  replaceAllInContents(): void {
    const findText = this.findReplaceQuery();
    if (!findText) {
      this.findReplaceStatus.set('検索文字列を入力してください。');
      return;
    }
    const result = replaceAllInRows(
      this.segmentRows.map((segment) => ({ id: segment.id, text: this.getEditableText(segment) })),
      findText,
      this.findReplaceWith()
    );
    if (result.replacements === 0) {
      this.findReplaceStatus.set('一致が見つかりませんでした。');
      return;
    }
    const current = { ...this.editedSegmentTextMap() };
    for (const update of result.updates) {
      current[update.id] = update.text;
      this.clearProofreadMetadataIfTextDiverged(update.id, update.text);
    }
    this.editedSegmentTextMap.set(current);
    this.findReplaceStatus.set(`${result.replacements} 件置換しました。`);
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
      this.error.set('文字起こし・話者分離のエンジンが見つかりません。アプリを再インストールしてください。');
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

  onSpeakerCountChange(value: number): void {
    const normalized = Number.isFinite(value) ? Math.max(1, Math.min(5, Math.floor(value))) : 2;
    this.speakerCount.set(normalized);
    this.persistDiarizationSettings();
  }

  /** ggml エンジンの実行ファイル・モデルが揃っているかを確認する（起動はしない）。 */
  async refreshGgmlSpeechStatus(): Promise<void> {
    try {
      const status = await invoke<GgmlSpeechStatus>('check_ggml_speech_status', { model: this.whisperModel() });
      this.ggmlSpeechStatus.set(status);
      if ((status.whisperBackend === 'vulkan' || status.nemoBackend === 'vulkan') && !this.vulkanGpus()) {
        await this.refreshVulkanGpus(false);
      }
    } catch {
      this.ggmlSpeechStatus.set(null);
    }
  }

  /** Vulkan の GPU 一覧を取得する（列挙は Rust 側の子プロセスで行い、失敗時は空）。 */
  async refreshVulkanGpus(refresh: boolean): Promise<void> {
    try {
      this.vulkanGpus.set(await invoke<VulkanGpuList>('list_vulkan_gpus', { refresh }));
    } catch {
      this.vulkanGpus.set(null);
    }
    if (this.editorOnlyBuild || !this.isTauriRuntime()) return;
    try {
      this.gpuDriverHint.set(await invoke<string | null>('get_gpu_driver_hint'));
    } catch {
      this.gpuDriverHint.set(null);
    }
  }

  onGgmlGpuChange(uuid: string): void {
    this.ggmlGpuUuid.set(uuid);
    this.persistTranscriptionSettings();
    this.syncPreferredVulkanGpu();
  }

  async toggleNemotronLicense(): Promise<void> {
    if (this.setupLicenseText()) {
      this.setupLicenseText.set('');
      return;
    }
    try {
      const text = await invoke<string>('read_bundled_license', { name: 'nemotron' });
      this.ngZone.run(() => this.setupLicenseText.set(text));
    } catch (e) {
      this.ngZone.run(() => this.setupLicenseText.set(this.normalizeErrorMessage(e)));
    }
  }

  async refreshLegacyCudaData(): Promise<void> {
    if (!this.isTauriRuntime()) return;
    try {
      const items = await invoke<LegacyDataItem[]>('list_legacy_cuda_data');
      this.ngZone.run(() => this.legacyCudaData.set(items));
    } catch {
      this.ngZone.run(() => this.legacyCudaData.set([]));
    }
  }

  async deleteLegacyCudaData(): Promise<void> {
    if (this.legacyCudaDataDeleting()) return;
    this.legacyCudaDataDeleting.set(true);
    this.legacyCudaDataConfirming.set(false);
    try {
      const remaining = await invoke<LegacyDataItem[]>('delete_legacy_cuda_data');
      this.ngZone.run(() => {
        this.legacyCudaData.set(remaining);
        this.legacyCudaDataMessage.set(remaining.length === 0
          ? '不要なデータを削除しました。'
          : '一部を削除できませんでした。アプリを再起動してから、もう一度お試しください（使用中のファイルは削除できません）。');
      });
    } catch (e) {
      this.ngZone.run(() => this.legacyCudaDataMessage.set(`削除に失敗しました: ${this.normalizeErrorMessage(e)}`));
    } finally {
      this.ngZone.run(() => this.legacyCudaDataDeleting.set(false));
    }
  }

  /** 選んだ GPU を Rust 側へ伝える（音声入力など、要求ごとに GPU を渡さない処理も同じ GPU を使う）。 */
  private syncPreferredVulkanGpu(): void {
    if (!this.isTauriRuntime()) return;
    void invoke('set_preferred_vulkan_gpu', { uuid: this.ggmlGpuUuid() || null }).catch(() => {
      // 未対応の古いバックエンドでは何もしない
    });
  }

  vulkanGpuLabel(device: VulkanGpuDevice): string {
    return vulkanGpuLabelValue(device);
  }

  /** セットアップ行の進捗表示。ダウンロード量が分かるときは割合を添える。 */
  setupProgressLabel(p: SetupProgressEvent): string {
    if (p.status === 'downloading' && p.totalBytes && p.downloadedBytes != null) {
      const percent = Math.min(100, Math.floor((p.downloadedBytes / p.totalBytes) * 100));
      return `${p.message} ${percent}%`;
    }
    return p.message;
  }

  async runTranscription(): Promise<void> {
    if (this.transcriptionPipelineRunning()) {
      return;
    }
    if (this.isTranscriptionTabDisabled() || (this.transcriptionDevice() === 'cuda' && !this.transcriptionTabVisible())) {
      this.error.set('文字起こし・話者分離のエンジンが見つかりません。アプリを再インストールしてください。');
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
    this.diarizationPhaseActive.set(false);
    this.diarizationStage.set('');
    this.segmentRowFilter.set('all');
    this._allRenderLimit.set(Number.MAX_SAFE_INTEGER);
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
    const runId = Date.now();

    try {
      this.runningStatus.set('音声エンジンを起動しています...');
      console.info(`[LoTT][transcription][run_id=${runId}][frontend_stage=invoke_start]`);
      const response = await invoke<{ success: boolean; result?: TranscriptionResult; errorMessage?: string }>(
        'run_transcription',
        {
          request: {
            runId,
            audioPath: this.selectedAudioPath(),
            diarization: true,
            speakerCount: this.speakerCount(),
            device: this.effectiveSpeechDevice(),
            model: this.whisperModel(),
            language: this.transcriptionLanguage(),
            parallelDiarization: this.parallelMode() === 'fast',
            ggmlGpuUuid: this.ggmlGpuUuid() || null,
            audioPreprocess: this.audioPreprocess(),
          }
        }
      );
      console.info(
        `[LoTT][transcription][run_id=${runId}][frontend_stage=invoke_resolved] success=${response.success} segments=${response.result?.segments.length ?? 0}`
      );

      if (!response.success || !response.result) {
        throw new Error(response.errorMessage ?? '文字起こしに失敗しました。');
      }

      const gpuFallbackNotice = diarizationGpuFallbackNoticeValue(response.result);
      if (gpuFallbackNotice) {
        // 結果カード内の案内として表示する（再生中のスナックバーを消さないよう、スナックバーは使わない）。
        this.lastRunNotice.set(gpuFallbackNotice);
      } else if (hasFallbackInTranscriptionResultValue(response.result) || this.hadRetryInCurrentRun()) {
        this.lastRunNotice.set('再試行またはフォールバックが発生しました。結果は取得できていますが、初回実行は失敗しています。');
      }

      console.info(`[LoTT][transcription][run_id=${runId}][frontend_stage=result_state_start]`);
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
      // 結果反映直後の入力欄への自動フォーカスは行わない。WebKitGTK + XWayland +
      // IMEの組み合わせでは、処理完了の描画中にIMEを起動するとイベントループが
      // 停止することがある。利用者が明示的にクリックしたときだけ入力を開始する。
      this.lastObservedTranscriptionDevice =
        String((response.result.settings as { device?: unknown })?.device ?? this.effectiveSpeechDevice());
      autoEntityCheckAfterTranscription = true;
      console.info(`[LoTT][transcription][run_id=${runId}][frontend_stage=result_state_done]`);
    } catch (error) {
      const message = this.normalizeErrorMessage(error);
      console.error(`[LoTT][transcription][run_id=${runId}][frontend_stage=invoke_error]`);
      this.error.set(message);
    } finally {
      this.stopSmoothProgress();
      this.running.set(false);
      this.runningStatus.set('');
      this.runningProgress.set(0);
      this.displayProgress.set(0);
      this.runningStepCurrent.set(0);
      this.runningStepTotal.set(0);
      this.parallelDiarizationStatus.set('');
      console.info(`[LoTT][transcription][run_id=${runId}][frontend_stage=transcription_ui_released]`);
    }

    try {
      if (autoEntityCheckAfterTranscription && !this.transcriptionPipelineCanceling()) {
        // whisper.cpp は、フィラーの例文（句読点を含む）をまねて句読点を付けて出力する
        // （実測で99%の行が句読点で終わる）。ルールで全角化と欠けた文末だけを補い、
        // 固有名詞チェックも同時に行う。
        console.info(`[LoTT][transcription][run_id=${runId}][frontend_stage=rule_punctuation_start]`);
        await this.runProofread('transcription', false, 'punct');
        autoEntityCheckAfterTranscription = false;
        console.info(`[LoTT][transcription][run_id=${runId}][frontend_stage=rule_punctuation_done]`);
        // 表示する所要時間は、文字起こし開始から句読点付与の完了までとする。
        // この後に続く固有名詞チェックの時間は含めない。
        this.stopRunningTicker();
        const elapsed = this.runningSeconds();
        this.lastRunElapsedSeconds.set(elapsed);
        // 所要時間ログと次回以降の予測にも、句読点付与までの総時間を使う。
        if (this.proofreadCompleted() && elapsed > 0) {
          const audioSeconds = this.resolveRuntimeLogAudioSeconds();
          if (audioSeconds && audioSeconds > 0) {
            this.recordEstimateSample({
              audioSeconds,
              elapsedSeconds: elapsed,
              diarization: true,
              device: this.normalizeTranscriptionDevice(
                this.lastObservedTranscriptionDevice ?? this.effectiveSpeechDevice()
              ),
              computeType: GGML_ESTIMATE_PROFILE,
              createdAt: Date.now(),
              fileSizeBytes: this.selectedAudioFileSizeBytes()
            });
            this.recalculateEstimatedTime(audioSeconds);
          }
        }
      }
      if (autoEntityCheckAfterTranscription && !this.transcriptionPipelineCanceling()) {
        console.info(`[LoTT][transcription][run_id=${runId}][frontend_stage=entity_check_start]`);
        await this.runProofread('transcription', false, 'entity');
        console.info(`[LoTT][transcription][run_id=${runId}][frontend_stage=entity_check_done]`);
      }
    } finally {
      // 句読点付与前の失敗・中止などでもタイマーを確実に終了する。
      this.stopRunningTicker();
      this.lastRunElapsedSeconds.set(this.runningSeconds());
      this.transcriptionPipelineRunning.set(false);
      this.transcriptionPipelineCanceling.set(false);
      this.dismissProgressSnackbar();
      console.info(`[LoTT][transcription][run_id=${runId}][frontend_stage=pipeline_released]`);
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
      const proofreadLanguage = resolveProofreadLanguageValue(
        current.settings.language,
        this.transcriptionLanguage()
      );

      const response = await invoke<{ success: boolean; result?: ProofreadResultPayload; errorMessage?: string }>(
        'proofread_transcription',
        {
          request: {
            segments,
            language: proofreadLanguage,
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
    } else if (!this.diarizationRunning() || this.diarizationCanceling()) {
      return;
    }
    const message = kind === 'transcription'
      ? '文字起こし処理を中止しますか？'
      : kind === 'transcriptionPipeline' ? '文字起こし・話者分離・句読点付与の一括処理を中止しますか？'
      : kind === 'proofread' ? '校正処理を中止しますか？'
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
    this.pendingConfirmDialog.set(null);
  }

  async confirmDialogAction(): Promise<void> {
    const dialog = this.pendingConfirmDialog();
    this.pendingConfirmDialog.set(null);
    if (!dialog) {
      return;
    }

    if (dialog.actionKind === 'deleteAllModels') {
      await this.performDevDeleteModels();
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

  }

  private promptPassword(): Promise<string | null> {
    return new Promise(resolve => {
      const ref = this.dialog.open(PasswordDialogComponent, { width: '380px' });
      ref.afterClosed().subscribe((result: string | null | undefined) => {
        resolve(result ?? null);
      });
    });
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
    const targetPath = await this.selectExportTargetPath('json', hasPassword);
    if (!targetPath) {
      return;
    }

    try {
      await invoke('save_transcription_json', {
        request: {
          path: targetPath,
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
    const targetPath = await this.selectExportTargetPath('docx', password.length > 0);
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
    const targetPath = await this.selectExportTargetPath('xlsx', password.length > 0);
    if (!targetPath) {
      return;
    }

    try {
      const rows = buildXlsxExportRowsValue(this.buildDocumentExportSourceRows(), this.addUtteranceNumber());

      await invoke('save_transcription_xlsx', {
        request: {
          path: targetPath,
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
    const targetPath = await this.selectExportTargetPath('srt', hasPassword);
    if (!targetPath) {
      return;
    }

    try {
      const rows = buildSrtExportRowsValue(this.buildDocumentExportSourceRows());
      await invoke('save_transcription_srt', {
        request: {
          path: targetPath,
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
    const targetPath = await this.selectExportTargetPath('runtime-csv', false);
    if (!targetPath) {
      return;
    }

    try {
      await invoke('save_runtime_estimate_csv', {
        request: {
          path: targetPath,
          samples: this.estimateSamples
        }
      });
    } catch (error) {
      this.error.set(this.normalizeErrorMessage(error));
    }
  }

  private async selectExportTargetPath(
    kind: TranscriptionExportKind,
    hasPassword: boolean
  ): Promise<string | null> {
    const plan = buildTranscriptionSavePlan(kind, hasPassword);
    const targetPath = await save({
      title: plan.title,
      defaultPath: plan.defaultPath,
      filters: plan.filters
    });
    return targetPath ? ensureExportPathExtension(targetPath, plan.extension) : null;
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
      // 保存形式を保つため項目は残す（AI 校正は無くなったので常に空）。
      llmSegmentStatusBySegmentId: {},
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
    this.stopProofreadTicker();
    this.segmentTextHistory.clearAll();

    const imported = buildImportedTranscriptionStateValue(payload);
    const importedResult: TranscriptionResult = {
      text: imported.text,
      segments: imported.segments,
      settings: {
        model: 'imported-json',
        device: 'n/a',
        computeType: 'n/a',
        language: imported.language ?? this.normalizeTranscriptionLanguage(this.transcriptionLanguage()),
        vadFilter: false,
        wordTimestamps: false
      },
      diarizationRequested: false
    };

    this.result.set(importedResult);
    this.resultSource.set('json');
    this.lastRunElapsedSeconds.set(0);
    this.lastRunNotice.set('JSON から結果を読み込みました。');
    this.editedSegmentTextMap.set(imported.editedTextBySegmentId);
    this.selectedSpeakerBySegmentId.set(imported.speakerBySegmentId);
    this.speakerAliasMap.set(imported.speakerAliasMap);
    this.proofreadMetadataBySegmentId.set(imported.proofreadMetadataBySegmentId);
    this.proofreadHintBySegmentId.set(imported.proofreadHintBySegmentId);
    this.proofreadCompleted.set(imported.proofreadCompleted);
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

  canShowTranscriptionTab(): boolean {
    return !this.editorOnlyBuild && this.transcriptionTabVisible();
  }

  getTranscriptionTabLabel(): string {
    return transcriptionTabLabelValue(
      this.isTranscriptionTabDisabled(),
      this.isDiarizationModelMissing()
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
    // Rustのidentifierを実行時のビルド種別（フル機能版 / Editor 版）の真実として先に取得する。
    await this.checkGpuAvailability();
    // GPU は Vulkan の一覧で判定する（Editor 版は GPU を使わない）。
    if (this.vulkanBuild()) void this.refreshVulkanGpus(false);
    void this.refreshLegacyCudaData();
    await this.checkTranscriptionRuntimeSupport();
    void this.ensureSetupProgressListener();
    await this.checkAllSetupStatus();
    await this.checkEditorVoiceInputPackStatus();
    // ここ以降は直前までの await で実行コンテキストが Angular ゾーン外に出ている。
    // 画面表示を左右する signal（タブ表示を gate する runtimeCheckDone と
    // activeTabIndex）の更新を ngZone.run で包み、確定済みの値で変更検知を
    // 確実に走らせる。これをしないと spinner → タブ表示の切替が描画されず、
    // ウィンドウ再フォーカス等で CD が走るまで古い（未確定の）画面が残る。
    this.ngZone.run(() => this.activeTabIndex.set(0));
    this.ngZone.run(() => this.runtimeCheckDone.set(true));
    // ここまでで GPU/セットアップ判定の signal は確定している。eventCoalescing 構成では
    // 変更検知がフレーム単位にまとめられ、ウィンドウが前面化されるまで描画が遅延しうる
    // （GPU 未検出バナーが古いまま残り、最前面化で初めて消える）。確定値を即座に反映させる
    // ため、同期的な変更検知を一度だけ強制する。
    this.appRef.tick();
  }

  /**
   * 「GPU を再確認」ボタン用。ドライバーを入れた後などに、Vulkan の GPU 一覧を取り直す。
   * 最大の効果は「クリック＝変更検知が走る」こと（eventCoalescing 構成で描画が遅延し、
   * バナーが古いまま残るケースを、アプリ再起動なしにその場で解消できる）。
   */
  async recheckGpuRuntime(): Promise<void> {
    if (!this.isTauriRuntime() || this.gpuRechecking()) return;
    this.gpuRechecking.set(true);
    try {
      await this.checkGpuAvailability(true);
      if (this.vulkanBuild()) await this.refreshVulkanGpus(true);
      await this.checkTranscriptionRuntimeSupport();
    } finally {
      this.gpuRechecking.set(false);
      // 確定値を即座に描画へ反映させる（フレーム単位の遅延を回避）
      this.appRef.tick();
    }
  }

  private async checkGpuAvailability(retry = false): Promise<void> {
    if (!this.isTauriRuntime()) return;
    try {
      const result = await invoke<{
        buildVariant?: string;
        runtimePlatform?: string;
        vulkanAvailable?: boolean;
        vulkanGpuName?: string | null;
        devForceCpu?: boolean;
      }>('check_gpu_availability', { retry });
      // invoke の Promise は NgZone 外で resolve されうるため、signal 更新を zone 内で行い再描画を保証する
      this.ngZone.run(() => {
        if (isBuildVariantValue(result.buildVariant)) {
          this.runtimeBuildVariant.set(result.buildVariant);
          this.buildVariant.set(result.buildVariant);
        }
        if (result.buildVariant === 'vulkan') {
          if (this.whisperModel() !== 'turbo') {
            this.whisperModel.set('turbo');
          }
          this.vulkanAvailable.set(result.vulkanAvailable === true);
          this.vulkanGpuName.set(result.vulkanGpuName ?? '');
          this.devForceCpu.set(result.devForceCpu === true);
        }
        if (result.runtimePlatform === 'windows' || result.runtimePlatform === 'linux' || result.runtimePlatform === 'macos') {
          this.runtimePlatform.set(result.runtimePlatform);
        } else if (result.runtimePlatform) {
          this.runtimePlatform.set('other');
        }
      });
    } catch {
      // GPU確認失敗時は既存の設定値を維持する
    }
  }

  devDeleteModels(): void {
    if (this.devDeleteTarget() === 'all') {
      this.openConfirmDialog({
        actionKind: 'deleteAllModels',
        title: 'すべて削除の確認',
        message: 'ダウンロード済みの音声認識モデルと話者分離モデルをすべて削除します。再び利用するには、セットアップから約1.7GBの再ダウンロードが必要です。続行しますか？',
        confirmLabel: 'すべて削除',
        cancelLabel: 'キャンセル',
        confirmColor: 'warn',
        cancelColor: null
      });
      return;
    }
    void this.performDevDeleteModels();
  }

  private async performDevDeleteModels(): Promise<void> {
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

  async checkEditorVoiceInputPackStatus(): Promise<void> {
    if (!this.isTauriRuntime()) {
      this.editorVoiceInputPackStatus.set(browserVoiceInputPackStatus());
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

  private async ensureEditorVoiceInputPackProgressListener(): Promise<void> {
    if (!this.isTauriRuntime()) return;
    await this.voiceInputPackProgressSubscription.ensure(() =>
      listen<SetupProgressEvent>('voice-input-pack-progress', (event) => {
        const p = event.payload;
        this.editorVoiceInputPackProgressMap.update((m) => updateSetupProgress(m, p));
      })
    );
  }

  async installEditorVoiceInputPack(): Promise<void> {
    if (this.editorVoiceInputPackInstalling()) return;
    await this.performInstallEditorVoiceInputPack();
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
        this.editorVoiceInputPackProgressMap.update((m) => updateSetupProgress(
          m,
          setupErrorProgress('_error', '音声入力パックの導入が完了しませんでした。')
        ));
      }
    } catch (error) {
      this.editorVoiceInputPackProgressMap.update((m) => updateSetupProgress(
        m,
        setupErrorProgress('_error', this.normalizeErrorMessage(error))
      ));
    } finally {
      this.editorVoiceInputPackInstalling.set(false);
      await this.checkEditorVoiceInputPackStatus();
    }
  }

  async devDeleteEditorVoiceInputPack(): Promise<void> {
    if (!this.editorVoiceInputDevControlsVisible() || this.editorVoiceInputPackDeleting()) return;
    const ok = window.confirm(
      'ダウンロード済みのWhisper large-v3-turboモデルと無音検出モデルを削除します。Whisper実行ファイルは削除しません。'
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
    }
  }

  editorVoiceInputPackComponentProgress(component: string): SetupProgressEvent | null {
    return this.editorVoiceInputPackProgressMap()[component] ?? null;
  }

  async checkAllSetupStatus(): Promise<void> {
    if (!this.isTauriRuntime()) {
      const status = browserSetupStatus();
      this.allSetupStatus.set(status);
      this.applySetupStatusProjection(projectSetupStatus(status));
      this.allSetupChecked.set(true);
      this.diarizationModelChecked.set(true);
      return;
    }
    try {
      const status = await invoke<AllSetupStatus>('check_all_setup_status');
      this.ngZone.run(() => {
        this.allSetupStatus.set(status);
        this.applySetupStatusProjection(projectSetupStatus(status));
      });
    } catch (error) {
      this.ngZone.run(() => {
        this.allSetupStatus.set(null);
        this.applySetupStatusProjection(unavailableSetupProjection());
      });
    } finally {
      this.ngZone.run(() => {
        this.allSetupChecked.set(true);
        this.diarizationModelChecked.set(true);
      });
    }
    // セットアップでモデルが揃った後に、起動時の「準備が済んでいません」表示が残らないようにする
    await this.refreshGgmlSpeechStatus();
  }

  private applySetupStatusProjection(projection: ReturnType<typeof projectSetupStatus>): void {
    this.diarizationModelExists.set(projection.diarizationExists);
    this.diarizationModelHasConfig.set(projection.diarizationHasConfig);
    this.diarizationModelExpectedPath.set(projection.diarizationExpectedPath);
    this.diarizationSetupVisible.set(projection.diarizationSetupVisible);
  }

  async onRecheckAllSetupStatus(): Promise<void> {
    // 統合セットアップ表示中は上部のGPU再確認ボタンが隠れるため、
    // この再チェックでもセットアップ完了直後のGPU状態を更新する。
    await this.checkGpuAvailability(true);
    await this.checkAllSetupStatus();
    await this.checkTranscriptionRuntimeSupport();
    this.ngZone.run(() => this.activeTabIndex.set(0));
    // Tauri の invoke 完了は Angular のイベントループ外で解決することがある。
    // 状態値は更新済みでも、eventCoalescing 中にGPU警告やセットアップ行だけが
    // 古いまま残らないよう、再チェック完了時に確定描画する。
    this.appRef.tick();
  }

  async runFullSetup(): Promise<void> {
    if (this.setupRunning()) return;

    this.setupRunning.set(true);
    this.setupProgressMap.set({});
    try {
      await invoke<boolean>('run_full_setup', { hfToken: null });
    } catch (error) {
      this.setSetupProgress(setupErrorProgress('_error', this.normalizeErrorMessage(error)));
    } finally {
      this.ngZone.run(() => {
        this.setupRunning.set(false);
      });
      // モデルの導入後にGPU状態も再確認し、再起動なしで警告を更新する。
      await this.checkGpuAvailability(true);
      await this.checkAllSetupStatus();
      await this.checkTranscriptionRuntimeSupport();
      this.ngZone.run(() => {
        this.activeTabIndex.set(0);
      });
      // モデル取得後の最終GPU/セットアップ判定は invoke の外側で signal を更新する
      // ため、再起動やウィンドウ再フォーカスを待たずに画面へ反映する。
      this.appRef.tick();
    }
  }

  private async ensureSetupProgressListener(): Promise<void> {
    if (!this.isTauriRuntime()) return;
    await this.setupProgressSubscription.ensure(() =>
      listen<SetupProgressEvent>('setup_progress', (event) => {
        this.setSetupProgress(event.payload);
      })
    );
  }

  private setSetupProgress(progress: SetupProgressEvent): void {
    this.setupProgressMap.update((current) => updateSetupProgress(current, progress));
  }

  async checkTranscriptionRuntimeSupport(retry = false): Promise<void> {
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
      this.transcriptionRuntimeReason.set(transcriptionRuntimeReasonValue(false, null));
      return;
    }

    try {
      const status = await invoke<TranscriptionRuntimeStatusResponse>('check_transcription_runtime_support', { retry });
      this.ngZone.run(() => {
        this.transcriptionTabVisible.set(true);
        this.transcriptionRuntimeAvailable.set(status.available === true);
        this.activeTabIndex.set(0);
        this.transcriptionRuntimeReason.set(transcriptionRuntimeReasonValue(
          status.available === true,
          status.reason
        ));
      });
    } catch (error) {
      this.ngZone.run(() => {
        this.transcriptionTabVisible.set(true);
        this.transcriptionRuntimeAvailable.set(false);
        this.activeTabIndex.set(0);
        this.transcriptionRuntimeReason.set(transcriptionRuntimeReasonValue(
          false,
          'GPU 確認に失敗したため、文字起こし機能は利用できません。'
        ));
      });
    }
  }

  onTabIndexChange(index: number): void {
    this.activeTabIndex.set(index);
    if (index === this.getSettingsTabIndex()) {
      void this.checkEditorVoiceInputPackStatus();
    }
    requestAnimationFrame(this._refreshSegmentTableInView);
  }

  private getImportCompletedMessage(): string {
    return getImportCompletedMessageValue(this.canShowTranscriptionTab());
  }

  private startRunningTicker(): void {
    this.runningTicker.start(() => {
      this.runningSeconds.set(this.runningSeconds() + 1);
    }, 1000);
  }

  private stopRunningTicker(): void {
    this.runningTicker.stop();
  }

  // 表示用の進捗を 1000ms ごとに滑らかに前進させる（表示専用。Python/Rust 側の処理には一切触れない）。
  // - バックエンドからの離散イベント（runningProgress）を「後退しない」アンカーとして尊重する
  // - 概算所要時間が分かるときは 経過時間/概算 で滑らかに進める（イベントが疎でも止まって見えない）
  // - 概算が無いときは上限に向けて減速トリックルし、常に少しずつ動かす
  private startSmoothProgress(): void {
    this.stopSmoothProgress();
    this.displayProgress.set(0);
    this.activeRunEstimatedSeconds = this.estimatedAvgSeconds();
    this.smoothProgressTicker.start(() => this.updateSmoothProgress(), 1000);
  }

  private stopSmoothProgress(): void {
    this.smoothProgressTicker.stop();
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
    this.proofreadTicker.start(() => {
      this.proofreadRunningSeconds.set(this.proofreadRunningSeconds() + 1);
      this.updateProofreadRunningStatus();
    }, 1000);
  }

  private stopProofreadTicker(): void {
    this.proofreadTicker.stop();
  }

  private stopDiarizationTicker(): void {
    this.diarizationTicker.stop();
  }

  private updateProofreadRunningStatus(): void {
    if (!this.proofreadRunning() || this.proofreadCanceling()) {
      return;
    }
    const elapsed = this.proofreadRunningSeconds();
    this.proofreadStatus.set(`校正を実行中... ${elapsed}秒`);
  }

  private async ensureProgressListener(): Promise<void> {
    if (!this.isTauriRuntime()) {
      return;
    }
    await this.progressSubscription.ensure(() => listen<{ stage?: string; message?: string; progress?: number; current?: number; total?: number }>(
      'transcription-progress',
      (event) => {
        if (!this.running() && !this.diarizationRunning() && !this.proofreadRunning()) {
          return;
        }
        const payload = event.payload ?? {};
        const stage = typeof payload.stage === 'string' ? payload.stage : '';

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
          const retrySuffix = isRetryStage ? '（再試行中）' : '';
          const doneLike = stage.endsWith('_done') || payload.message.includes('完了');
          const message = doneLike && this.hadRetryInCurrentRun()
            ? '再試行が発生しました。最終結果を確認しています...'
            : payload.message;
          this.runningStatus.set(`${message}${retrySuffix}`);
        }
      }
    ));

    await this.parallelDiarizationSubscription.ensure(() => listen<{ stage?: string; message?: string }>(
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
    ));
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
    return this.isSegmentPlaying(segmentId) && this.previewLoopEnabled && !this.previewPaused;
  }

  isSegmentSinglePlaying(segmentId: number): boolean {
    return this.isSegmentPlaying(segmentId) && !this.previewLoopEnabled && !this.previewPaused;
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

    const action = this.playbackSession.actionFor(segment.id, loopEnabled);
    if (action !== 'start') {
      this.toggleActivePlayback();
      return;
    }
    this.stopSegmentPlayback();
    const gen = this.playbackSession.start(segment.id, loopEnabled);
    const audio = this.getOrCreatePreviewAudio();
    let src: string;
    try {
      src = await this.resolvePlayableAudioSrc(path);
    } catch (e) {
      if (this.playbackSession.canPlay(gen)) {
        this.stopSegmentPlayback();
        this.error.set(`音声を再生できませんでした: ${this.normalizeErrorMessage(e)}`);
      }
      return;
    }
    if (!this.playbackSession.canPlay(gen)) return;
    const baseRange = normalizePlaybackRange(segment);
    const range = loopEnabled ? expandShortPlaybackRange(baseRange) : baseRange;
    const { start, end } = range;

    textInputEl?.focus();

    const queue = buildPlaybackQueue(this.segmentRows, segment.id, loopEnabled);
    this.previewSequenceSegmentIds = queue.segmentIds;
    this.previewSequenceIndex = queue.index;
    this.previewStartSeconds = start;
    this.previewEndSeconds = end;
    this.setActivePlayingSegment(segment.id);
    this.openPlaybackSnackbar(loopEnabled);
    this.error.set('');

    const seekAndPlay = async (): Promise<void> => {
      if (!this.playbackSession.canPlay(gen)) return;
      try {
        // Wait for seek to complete before play().
        // On Linux WebKitGTK, currentTime assignment is asynchronous and play()
        // called immediately would start at the wrong position.
        await waitForAudioSeek(audio, start);
        // GStreamer sometimes fires 'seeked' before the pipeline actually moves.
        // Retry up to 3 times until position is within 0.5 s of the target.
        for (let i = 0; i < 3 && this.playbackSession.canPlay(gen) && start > 0.5 && Math.abs(audio.currentTime - start) > 0.5; i++) {
          await waitForAudioSeek(audio, start);
        }
      } catch {
        // ignore seek issue
      }
      // Abort if stop() was called or a newer play() request was issued while seeking.
      if (gen !== this.seekPlayGeneration) return;
      this.playbackSession.seekCompleted(gen);
      await this.playPreviewAudio(audio, gen);
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

  segmentPlaybackLabel(segmentId: number, loop: boolean): string {
    const action = playbackActionFor(this.playbackState(), segmentId, loop);
    return action === 'pause' ? '一時停止' : action === 'resume' ? '再開' : loop ? 'ループ再生' : '連続再生';
  }

  segmentPlaybackIcon(segmentId: number, loop: boolean): string {
    const action = playbackActionFor(this.playbackState(), segmentId, loop);
    return action === 'pause' ? 'pause' : action === 'resume' ? 'play_arrow' : loop ? 'repeat' : 'arrow_shape_up_stack_2';
  }

  private toggleActivePlayback(): void {
    const audio = this.previewAudio;
    if (!audio || this.playingSegmentId() === null) return;
    if (!this.previewPaused) {
      this.pauseSegmentPlayback();
      return;
    }
    // Loading/seek cancellation may leave the source or range unfinished: restart that row.
    if (!this.playbackSession.positionReady || audio.readyState < 1 || this.previewEndSeconds === null) {
      const segment = this.segmentRows.find(row => row.id === this.playingSegmentId());
      const loop = this.previewLoopEnabled;
      this.stopSegmentPlayback();
      if (segment) void this.startSegmentPlayback(segment, loop);
      return;
    }
    const gen = this.playbackSession.resume();
    this.openPlaybackSnackbar(this.previewLoopEnabled);
    void (async () => {
      if (audio.seeking) {
        try { await waitForAudioSeek(audio, audio.currentTime); } catch { /* keep the current position */ }
      }
      await this.playPreviewAudio(audio, gen);
    })();
  }

  private async playPreviewAudio(audio: HTMLAudioElement, generation: number): Promise<void> {
    if (!this.playbackSession.canPlay(generation)) return;
    try {
      audio.playbackRate = this.playbackRate();
      await audio.play();
      this.playbackSession.playing(generation);
    } catch (e) {
      if (!this.playbackSession.canPlay(generation)) return;
      if (e instanceof DOMException && e.name === 'AbortError') {
        this.pauseSegmentPlayback();
        return;
      }
      this.stopSegmentPlayback();
      this.error.set(this.normalizeErrorMessage(e));
    }
  }

  private pauseSegmentPlayback(): void {
    const playingId = this.playingSegmentId();
    if (playingId === null || !this.previewAudio) return;

    // 読み込み・seek中の遅延playも無効化し、現在位置と連続再生キューは保持する。
    this.playbackSession.pause();
    this.previewAudio.pause();
    // 一時停止した行をそのまま直せるようにキャレットを末尾へ置く。
    this.focusSegmentTextareaById(playingId);
  }

  stopSegmentPlayback(): void {
    this.playbackSession.invalidatePendingPlay();
    this.sequenceSnackBarRef?.dismiss();
    this.sequenceSnackBarRef = null;
    if (!this.previewAudio) {
      this.resetPlaybackState();
      return;
    }
    this.previewAudio.onloadedmetadata = null;
    this.previewAudio.pause();
    this.resetPlaybackState();
  }

  private resetPlaybackState(): void {
    this.playbackSession.stop();
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
        state: this.playbackState,
        onToggle: () => this.toggleActivePlayback(),
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
      if (this.previewPaused) return;
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
      if (this.previewPaused) return;
      if (this.playingSegmentId() !== null && this.previewLoopEnabled && this.previewStartSeconds !== null) {
        try {
          audio.currentTime = this.previewStartSeconds;
          void this.playPreviewAudio(audio, this.seekPlayGeneration);
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
      this.stopSegmentPlayback();
      this.error.set('音声の再生に失敗しました。ファイル形式やパスを確認してください。');
    };
    this.previewAudio = audio;
    return audio;
  }

  private advanceSequencePlayback(audio: HTMLAudioElement): boolean {
    if (this.previewLoopEnabled) {
      return false;
    }
    const next = resolveNextPlaybackSegment(this.segmentRows, {
      segmentIds: this.previewSequenceSegmentIds,
      index: this.previewSequenceIndex
    });
    if (!next) return false;

    this.previewSequenceIndex = next.queueIndex;
    const { start: newStart, end: newEnd } = next.range;
    this.setActivePlayingSegment(next.segment.id);

    // Pause immediately so audio does not bleed past the segment boundary while seeking.
    // Clear previewEndSeconds first to prevent ontimeupdate from re-entering this method
    // before the seek completes.
    audio.pause();
    this.previewStartSeconds = newStart;
    this.previewEndSeconds = null;

    const gen = this.seekPlayGeneration;
    void waitForAudioSeek(audio, newStart).then(() => {
      if (gen !== this.seekPlayGeneration) return;
      this.previewEndSeconds = newEnd;
      this.playbackSession.seekCompleted(gen);
      void this.playPreviewAudio(audio, gen);
    }).catch(() => {
      if (gen === this.seekPlayGeneration) this.stopSegmentPlayback();
    });
    return true;
  }


  private setActivePlayingSegment(segmentId: number | null, autoScroll = true): void {
    if (segmentId === null) this.playbackSession.stop();
    else this.playbackSession.selectSegment(segmentId);
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
    if (!this.isTauriRuntime()) {
      return;
    }
    await this.playbackTranscodeSubscription.ensure(() =>
      listen<{ state: string; percent: number }>(
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
      )
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
    this.segmentTextHistory.clear(segmentId);
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
    this.segmentTextHistory.record(segmentId, {
      before,
      after,
      afterCaret: textarea.selectionStart ?? after.length,
      inputKind
    });
    this.updateEditableText(segmentId, after);
  }

  private updateEditableText(segmentId: number, value: string): void {
    const next = { ...this.editedSegmentTextMap() };
    next[segmentId] = value;
    this.editedSegmentTextMap.set(next);
    this.clearProofreadMetadataIfTextDiverged(segmentId, value);
  }

  private undoSegmentTextEdit(segmentId: number, textarea: HTMLTextAreaElement): void {
    const transition = this.segmentTextHistory.undo(segmentId, this.getEditableTextById(segmentId));
    if (!transition) {
      return;
    }
    this.applySegmentTextHistoryValue(segmentId, transition.value, transition.caret, textarea);
  }

  private redoSegmentTextEdit(segmentId: number, textarea: HTMLTextAreaElement): void {
    const transition = this.segmentTextHistory.redo(segmentId, this.getEditableTextById(segmentId));
    if (!transition) {
      return;
    }
    this.applySegmentTextHistoryValue(segmentId, transition.value, transition.caret, textarea);
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

    const merged = mergeConsecutiveSpeakerSegmentsValue(
      sourceRows.map((segment) => ({
        ...segment,
        editableText: this.getEditableText(segment),
        assignedSpeaker: this.getAssignedSpeakerKey(segment)
      })),
      this.proofreadMetadataBySegmentId()
    );
    if (merged.mergedCount <= 0) {
      this.mergeStatus.set('統合対象がありません。');
      return;
    }

    this.stopSegmentPlayback();
    this.segmentTextHistory.clearAll();
    this.result.set({
      ...currentResult,
      segments: merged.segments,
      text: merged.segments
        .map((segment) => merged.editedTextBySegmentId[segment.id] ?? segment.text)
        .join(' ')
        .trim()
    });
    this.editedSegmentTextMap.set(merged.editedTextBySegmentId);
    this.selectedSpeakerBySegmentId.set(merged.speakerBySegmentId);
    this.hiddenSegmentIds.set({});
    this.proofreadHintBySegmentId.set(merged.proofreadHintBySegmentId);
    this.proofreadMetadataBySegmentId.set(merged.proofreadMetadataBySegmentId);
    this.proofreadUpdatedCount.set(Object.keys(merged.proofreadMetadataBySegmentId).length);
    if (this.segmentRowFilter() === 'caution' || this.segmentRowFilter() === 'caution_context') {
      this.refreshCautionPinnedSegmentIds(this.segmentRowFilter() === 'caution_context', this._cautionFilterGen);
    }
    this.mergeStatus.set(`${merged.mergedCount} 行を統合しました。`);
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
    if (!currentResult) return;
    const source = currentResult.segments.find((segment) => segment.id === sourceSegmentId);
    if (!source) return;
    const structuralEdit = buildRelativeSegmentInsertion(
      currentResult.segments,
      sourceSegmentId,
      position,
      this.getEditableText(source),
      this.currentSegmentStructureMaps()
    );
    if (structuralEdit) this.applySegmentStructureResult(currentResult, structuralEdit);
  }

  splitSegmentByPeriod(sourceSegmentId: number): void {
    const currentResult = this.result();
    if (!currentResult) return;

    const sourceSegment = currentResult.segments.find((segment) => segment.id === sourceSegmentId);
    if (!sourceSegment) return;
    const sourceText = this.getEditableText(sourceSegment);
    const structuralEdit = splitSegmentAtSentenceEndings(
      currentResult.segments,
      sourceSegmentId,
      sourceText,
      this.getAssignedSpeakerKey(sourceSegment),
      this.editPunctuationIsJapanese(),
      this.currentSegmentStructureMaps()
    );
    if (!structuralEdit) return;
    this.segmentTextHistory.clear(sourceSegmentId);
    this.applySegmentStructureResult(currentResult, structuralEdit);
  }

  private currentSegmentStructureMaps() {
    return {
      editedTextById: this.editedSegmentTextMap(),
      hiddenById: this.hiddenSegmentIds(),
      speakerById: this.selectedSpeakerBySegmentId(),
      proofreadHintById: this.proofreadHintBySegmentId(),
      proofreadMetadataById: this.proofreadMetadataBySegmentId()
    };
  }

  private applySegmentStructureResult(
    currentResult: TranscriptionResult,
    edit: SegmentStructureResult<TranscriptionSegmentWord, ExportProofreadMetadata>
  ): void {
    for (const id of edit.createdIds) this.segmentTextHistory.clear(id);
    this.result.set({ ...currentResult, segments: edit.segments, text: edit.transcriptText });
    this.editedSegmentTextMap.set(edit.editedTextById);
    this.hiddenSegmentIds.set(edit.hiddenById);
    this.selectedSpeakerBySegmentId.set(edit.speakerById);
    this.proofreadHintBySegmentId.set(edit.proofreadHintById);
    this.proofreadMetadataBySegmentId.set(edit.proofreadMetadataById);
    this.proofreadUpdatedCount.set(Object.keys(edit.proofreadMetadataById).length);
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

  private async isVoiceInputModelLoaded(): Promise<boolean> {
    if (!this.isTauriRuntime()) return false;
    try {
      return await invoke<boolean>('get_voice_input_server_status');
    } catch {
      return false;
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
      this.voiceInputAutoStopTimer.schedule(() => {
        if (this.voiceInputRecordingSegmentId() === segmentId) {
          void this.finishVoiceInputRecording(segmentId);
        }
      }, this.voiceInputMaxRecordingSeconds * 1000);
    } catch (error) {
      this.cleanupVoiceInputRecording(false);
      this.voiceInputError.set(normalizeVoiceInputErrorMessage(error));
    }
  }

  private async finishVoiceInputRecording(segmentId: number): Promise<void> {
    if (this.voiceInputRecordingSegmentId() !== segmentId) {
      return;
    }
    const chunks = this.voiceInputChunks.map((chunk) => new Float32Array(chunk));
    const sourceRate = this.voiceInputSampleRate || 48000;
    this.cleanupVoiceInputRecording(false);
    const prepared = prepareVoiceInput(chunks, sourceRate, this.voiceInputMaxRecordingSeconds);
    if (!prepared.ok) {
      this.voiceInputStatus.set('');
      this.voiceInputError.set(prepared.message);
      return;
    }
    this.voiceInputProcessingSegmentId.set(segmentId);
    this.voiceInputFeedbackSegmentId.set(segmentId);
    const whisperVoiceInputBuild = this.vulkanBuild() || this.editorOnlyBuild;
    if (whisperVoiceInputBuild) {
      this.voiceInputStatus.set('文字起こし中...');
    } else {
      const modelLoaded = await this.isVoiceInputModelLoaded();
      this.voiceInputStatus.set(modelLoaded
        ? '候補を生成中...'
        : 'モデルを読み込んでいます。1回目は時間がかかります...');
    }
    this.voiceInputError.set('');
    try {
      const context = whisperVoiceInputBuild ? null : this.buildVoiceInputContext(segmentId);
      const response = await invoke<EditorVoiceInputResponse>('generate_editor_voice_input_candidates', {
        request: {
          wavBase64: prepared.wavBase64,
          maxCandidates: 3,
          language: this.normalizeTranscriptionLanguage(this.transcriptionLanguage()),
          ...(context ? { context } : {})
        },
      });
      const candidates = normalizeVoiceInputCandidates(response.candidates);
      if (candidates.length === 0) {
        const message = '候補を生成できませんでした。';
        this.voiceInputError.set(message);
        this.voiceInputCandidates.set(null);
      } else {
        this.voiceInputCandidates.set({ segmentId, candidates });
        this.voiceInputStatus.set('');
        this.voiceInputFeedbackSegmentId.set(segmentId);
      }
    } catch (error) {
      this.voiceInputCandidates.set(null);
      this.voiceInputStatus.set('');
      const message = normalizeVoiceInputErrorMessage(error);
      this.voiceInputError.set(message);
    } finally {
      this.voiceInputProcessingSegmentId.set(null);
    }
  }

  private buildVoiceInputContext(segmentId: number): VoiceInputContext | null {
    const rows = this.segmentRows;
    const editedMap = this.editedSegmentTextMap();
    return buildVoiceInputContext(
      rows,
      this.result()?.segments ?? [],
      segmentId,
      this.segmentRowNumberMap(),
      (segment) => this.displaySpeaker(this.getAssignedSpeakerKey(segment)),
      (segment) => this.getEditableTextFromMap(segment, editedMap)
    );
  }

  private cleanupVoiceInputRecording(clearStatus: boolean): void {
    this.voiceInputAutoStopTimer.cancel();
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
    this.insertTextAtSegmentCursor(segmentId, candidate, textInputEl);
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
    const insertion = insertTextAtSelection(base, text, selectionStart, selectionEnd);
    const updatedText = insertion.text;
    const next = { ...current, [segmentId]: updatedText };
    this.editedSegmentTextMap.set(next);
    this.clearProofreadMetadataIfTextDiverged(segmentId, updatedText);
    const nextPos = insertion.caret;
    this.segmentCursorFocusTimer.schedule(() => {
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
    this.timeEditFocusTimer.schedule(() => {
      const el = document.querySelector<HTMLInputElement>(`[data-time-edit-id="${segment.id}"] .time-input`);
      el?.focus();
      el?.select();
    }, 0);
  }

  commitTimeEdit(segmentId: number): void {
    if (this.editingTimeSegmentId() !== segmentId) return;
    this.timeEditFocusTimer.cancel();
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
    this.timeEditFocusTimer.cancel();
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
