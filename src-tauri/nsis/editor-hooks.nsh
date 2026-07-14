; Editor 版インストーラーフック
; LLM / Lemonade を含まない軽量 (校正・編集中心) 構成のためのフック。
; Full 版の lemonade-hooks.nsh と異なり、Lemonade のインストール促しは行わない。

!macro NSIS_HOOK_POSTINSTALL
  ; Editor 版は追加ランタイム (Lemonade / Python パッケージ) を必要としないため、
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
