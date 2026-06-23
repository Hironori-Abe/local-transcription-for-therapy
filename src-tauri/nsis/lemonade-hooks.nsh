; Lemonade NPU/GPU backend optional install hook
; Called by Tauri NSIS template via NSIS_HOOK_POSTINSTALL / NSIS_HOOK_POSTUNINSTALL
; （旧名 customInstall / customUninstall は現行 Tauri テンプレートでは無視される）

!macro NSIS_HOOK_POSTINSTALL
  ; バンドルバイナリが同梱されている場合はwingetインストール不要
  IfFileExists "$INSTDIR\resources\lemonade\lemonade-server.exe" lemonade_bundled 0
  IfFileExists "$INSTDIR\resources\lemonade\lemonade.exe" lemonade_bundled 0
  IfFileExists "$INSTDIR\lemonade\lemonade-server.exe" lemonade_bundled lemonade_ask_install

  lemonade_ask_install:
    MessageBox MB_YESNO \
      "Lemonade (NPU/GPU LLM バックエンド) をインストールしますか?$\n$\n\
対応環境: AMD Ryzen AI (NPU), NVIDIA GPU, AMD Radeon GPU$\n\
winget を使ってインストールします。$\n$\n\
「いいえ」を選んでも、アプリ内の設定から後でインストールできます。" \
      /SD IDNO IDNO lemonade_install_skip

      DetailPrint "Lemonade をインストール中... (数分かかる場合があります)"
      ExecWait \
        '"$WINDIR\System32\WindowsPowerShell\v1.0\powershell.exe" \
         -NoProfile -NonInteractive -WindowStyle Hidden \
         -Command "winget install --id lemonade-sdk.lemonade --silent --accept-package-agreements --accept-source-agreements"' \
        $0
      ${If} $0 == 0
        DetailPrint "Lemonade のインストールが完了しました。"
      ${Else}
        DetailPrint "Lemonade のインストールに失敗しました (コード: $0)。後でアプリ内からインストールできます。"
      ${EndIf}
    Goto lemonade_install_skip

  lemonade_bundled:
    DetailPrint "Lemonade バイナリはアプリに同梱されています。追加インストールは不要です。"

  lemonade_install_skip:

  ; ── 外部LLMアプリ (LM Studio / Ollama) 連携のオプトイン ──────────────────────
  ; 既定は無効。明示的に「はい」を選んだときだけ external-llm-policy.txt に enabled を
  ; 書き込む。アプリ (Rust external_llm_enabled) はこのマーカーを見て連携可否を決める。
  ; 後から変更するには再インストールが必要 (アプリ内に再有効化トグルは無い)。
  ; バックグラウンド更新 (/UPDATE) では再プロンプトせず既存の選択を保持する。
  ; ※ Lemonade (内蔵AI バックエンド) はこの選択に関わらず常に利用可能。
  StrCmp $UpdateMode "1" ext_llm_done 0

  MessageBox MB_YESNO|MB_ICONQUESTION \
    "外部のLLMアプリ (LM Studio / Ollama) との連携を有効にしますか?$\n$\n\
通常は不要です (内蔵AI で文章校正できます)。$\n\
有効にすると、これらのアプリの設定によっては会話データが外部に送信される$\n\
可能性があり、その挙動は本アプリの管理外です。$\n$\n\
後から変更するには再インストールが必要です。" \
    /SD IDNO IDYES ext_llm_enable

  ; IDNO もしくはサイレント既定 → 無効 (残骸マーカーも削除)
  Delete "$LOCALAPPDATA\${BUNDLEID}\external-llm-policy.txt"
  DetailPrint "外部LLMアプリ連携は無効です (既定)。"
  Goto ext_llm_done

  ext_llm_enable:
    CreateDirectory "$LOCALAPPDATA\${BUNDLEID}"
    FileOpen $1 "$LOCALAPPDATA\${BUNDLEID}\external-llm-policy.txt" w
    FileWrite $1 "enabled"
    FileClose $1
    DetailPrint "外部LLMアプリ連携を有効化しました。"

  ext_llm_done:
!macroend

!macro NSIS_HOOK_POSTUNINSTALL
  ; アップデート（バックグラウンド更新 /UPDATE）時はクリーンアップせず、
  ; ユーザーのモデル・パッケージを保持する。真のアンインストール時のみ削除する。
  StrCmp $UpdateMode "1" nsis_skip_full_cleanup 0

  ; ── アプリ固有キャッシュを削除 ──────────────────────────────────────────────
  ; Lemonade バックエンドバイナリ・HF Hub キャッシュ（アプリ固有ディレクトリ）を
  ; まとめて削除する。%LOCALAPPDATA%\${BUNDLEID}\ が対象。
  ; （${BUNDLEID} は Tauri NSIS テンプレートが提供する define。${IDENTIFIER} は未定義）
  ; ユーザーが再インストールした場合はモデルを再ダウンロードする必要がある。
  DetailPrint "アプリキャッシュ ($LOCALAPPDATA\${BUNDLEID}) を削除しています..."
  RMDir /r "$LOCALAPPDATA\${BUNDLEID}"

  ; ── インストール先に残る未追跡ファイルを削除 ────────────────────────────────
  ; resources\python312\Lib\site-packages\ 以下は setup_venv_cli.py が pip で
  ; 後からインストールしたファイルで、インストーラーの追跡対象外。Tauri 標準の
  ; アンインストールは非再帰 RMDir のため空にならず削除されない。同様に実行時に
  ; 生成された python_sidecar\models 等も残る。これらが残ると再インストール時に
  ; 「ランタイム導入済み」と誤検出されるため、$INSTDIR ごと再帰削除する。
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
