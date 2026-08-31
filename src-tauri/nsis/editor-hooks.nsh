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
