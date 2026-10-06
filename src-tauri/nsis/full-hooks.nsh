; フル機能版（Vulkan）インストーラーフック
; 音声モデルは初回起動後にセットアップ画面からダウンロードする。
; アンインストール時は、Tauri 標準の「アプリデータを削除する」の選択を尊重する。
; Called by Tauri NSIS template via NSIS_HOOK_POSTINSTALL / NSIS_HOOK_POSTUNINSTALL

!macro NSIS_HOOK_POSTINSTALL
  ; v0.9.8より前の実行ファイル名を上書きインストール後に残さない。
  Delete "$INSTDIR\offline-transcriber.exe"

  ; 旧版（CUDA 版）が作成した実行時ポリシーマーカーは不要なため削除する。
  Delete "$LOCALAPPDATA\${BUNDLEID}\external-llm-policy.txt"
!macroend

!macro NSIS_HOOK_POSTUNINSTALL
  ; ── 一時データ（private-temp）は無条件に削除する ───────────────────────────────
  ; 変換済み音声・文字起こしの中間 JSON・再生用キャッシュなど、会話データのコピーが
  ; 異常終了後に残りうる専用一時領域。モデルとは違い再利用する価値がないので、
  ; 「アプリデータを削除する」のチェックやバックグラウンド更新（/UPDATE）に関係なく消す。
  ; Tauri の app_cache_dir は Windows で %LOCALAPPDATA%\{identifier} になる。
  DetailPrint "一時ファイル ($LOCALAPPDATA\${BUNDLEID}\private-temp) を削除しています..."
  RMDir /r "$LOCALAPPDATA\${BUNDLEID}\private-temp"

  ; アップデート（バックグラウンド更新 /UPDATE）時はクリーンアップせず、
  ; ユーザーのモデル・パッケージを保持する。真のアンインストール時のみ削除する。
  StrCmp $UpdateMode "1" nsis_skip_full_cleanup 0

  ; ── チェックONの場合だけアプリ固有データを削除 ─────────────────────────────
  ; HF Hub キャッシュなどアプリ固有ディレクトリをまとめて削除する。
  ; %LOCALAPPDATA%\${BUNDLEID}\ が対象。
  ; （${BUNDLEID} は Tauri NSIS テンプレートが提供する define。${IDENTIFIER} は未定義）
  ; OFFの場合はダウンロード済みモデルを残し、同じエディションの再インストールで再利用する。
  StrCmp $DeleteAppDataCheckboxState "1" 0 nsis_skip_app_data_cleanup
  DetailPrint "アプリキャッシュ ($LOCALAPPDATA\${BUNDLEID}) を削除しています..."
  RMDir /r "$LOCALAPPDATA\${BUNDLEID}"
  nsis_skip_app_data_cleanup:

  ; ── インストール先に残る未追跡ファイルを削除 ────────────────────────────────
  ; 旧版（CUDA 版）が pip で後から入れた resources\python312\Lib\site-packages\ など、
  ; インストーラーの追跡対象外のファイルは、Tauri 標準のアンインストール（非再帰 RMDir）では
  ; 空にならず削除されない。残さないよう $INSTDIR ごと再帰削除する。
  ; （再インストール時にインストーラーが必要なファイルを再展開する。
  ;  実行中の uninstall.exe 自身はロック中で消えないが問題ない）
  DetailPrint "インストールフォルダの残存ファイルを削除しています..."
  RMDir /r "$INSTDIR"

  ; ── 共有 HuggingFace キャッシュ (~/.cache/huggingface) には触れない ──────────
  ; リリース版はモデルを %LOCALAPPDATA%\${BUNDLEID}\ 配下にのみ保存する
  ; (Rust: get_app_hf_hub_cache / release_models_root)。~/.cache/huggingface は
  ; dev 実行や他プロジェクトと共有される汎用キャッシュであり、本アプリが
  ; インストールした領域ではないため、アンインストール時には削除しない。

  nsis_skip_full_cleanup:
!macroend
