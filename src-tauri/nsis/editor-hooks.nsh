; Editor 版インストーラーフック
; 外部LLMランタイムを含まない軽量（校正・編集中心）構成のためのフック。
; インストーラーから追加ランタイムの導入を促すことはない。

!macro NSIS_HOOK_POSTINSTALL
  ; v0.9.8より前の実行ファイル名を上書きインストール後に残さない。
  Delete "$INSTDIR\offline-transcriber.exe"

  ; Editor版は追加LLMランタイムやPythonパッケージを必要としないため、
  ; インストール時の追加処理は行わない。
!macroend

!macro NSIS_HOOK_POSTUNINSTALL
  ; ── 一時データ（private-temp）は無条件に削除する ───────────────────────────────
  ; 変換済み音声・文字起こしの中間 JSON・再生用キャッシュなど、会話データのコピーが
  ; 異常終了後に残りうる専用一時領域。モデルとは違い再利用する価値がないので、
  ; 「アプリデータを削除する」のチェックやバックグラウンド更新（/UPDATE）に関係なく消す。
  ; Tauri の app_cache_dir は Windows で %LOCALAPPDATA%\{identifier} になる。
  DetailPrint "一時ファイル ($LOCALAPPDATA\${BUNDLEID}\private-temp) を削除しています..."
  RMDir /r "$LOCALAPPDATA\${BUNDLEID}\private-temp"

  ; アップデート（バックグラウンド更新 /UPDATE）時は校正設定を保持する。
  StrCmp $UpdateMode "1" nsis_skip_editor_cleanup 0

  ; チェックONの場合だけアプリ固有データ（後付けモデル・設定等）を削除する。
  ; ${BUNDLEID} は net.gakkousya.lott-editor（Tauri NSIS テンプレートが提供する define）。
  ; Full 版 (net.gakkousya.lott / net.gakkousya.lott-amd) のデータには影響しない。
  StrCmp $DeleteAppDataCheckboxState "1" 0 nsis_skip_editor_app_data_cleanup
  DetailPrint "アプリデータ ($LOCALAPPDATA\${BUNDLEID}) を削除しています..."
  RMDir /r "$LOCALAPPDATA\${BUNDLEID}"
  nsis_skip_editor_app_data_cleanup:

  nsis_skip_editor_cleanup:
!macroend
