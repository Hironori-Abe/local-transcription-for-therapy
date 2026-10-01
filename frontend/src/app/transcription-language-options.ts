export interface TranscriptionLanguageOption {
  value: string;
  label: string;
  diarizationSupported: boolean;
}

/**
 * Languages exposed by the current Whisper ASR workflow. A false
 * `diarizationSupported` value marks language coverage that LoTT has not
 * verified; it only affects the option label and never gates diarization.
 */
export const TRANSCRIPTION_LANGUAGE_OPTIONS: ReadonlyArray<TranscriptionLanguageOption> = [
  { value: 'ja', label: '日本語', diarizationSupported: true },
  { value: 'en', label: '英語', diarizationSupported: true },
  { value: 'zh', label: '中国語', diarizationSupported: true },
  { value: 'hi', label: 'ヒンディー語', diarizationSupported: true },
  { value: 'te', label: 'テルグ語', diarizationSupported: true },
  { value: 'bn', label: 'ベンガル語', diarizationSupported: true },
  { value: 'kn', label: 'カンナダ語', diarizationSupported: true },
  { value: 'ko', label: '韓国語（話者分離非対応）', diarizationSupported: false },
  { value: 'ar', label: 'アラビア語（話者分離非対応）', diarizationSupported: false },
  { value: 'de', label: 'ドイツ語（話者分離非対応）', diarizationSupported: false },
  { value: 'es', label: 'スペイン語（話者分離非対応）', diarizationSupported: false },
  { value: 'fr', label: 'フランス語（話者分離非対応）', diarizationSupported: false },
  { value: 'it', label: 'イタリア語（話者分離非対応）', diarizationSupported: false },
  { value: 'pt', label: 'ポルトガル語（話者分離非対応）', diarizationSupported: false },
  { value: 'ru', label: 'ロシア語（話者分離非対応）', diarizationSupported: false },
  { value: 'fa', label: 'ペルシア語（話者分離非対応）', diarizationSupported: false },
  { value: 'id', label: 'インドネシア語（話者分離非対応）', diarizationSupported: false },
  { value: 'tr', label: 'トルコ語（話者分離非対応）', diarizationSupported: false },
  { value: 'vi', label: 'ベトナム語（話者分離非対応）', diarizationSupported: false },
  { value: 'th', label: 'タイ語（話者分離非対応）', diarizationSupported: false },
  { value: 'ur', label: 'ウルドゥー語（話者分離非対応）', diarizationSupported: false },
  { value: 'ta', label: 'タミル語（話者分離非対応）', diarizationSupported: false },
  { value: 'mr', label: 'マラーティー語（話者分離非対応）', diarizationSupported: false },
  { value: 'sw', label: 'スワヒリ語（話者分離非対応）', diarizationSupported: false }
];
