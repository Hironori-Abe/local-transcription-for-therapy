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

  ; ── 旧 HuggingFace デフォルトキャッシュの Whisper モデルを削除 ──────────────
  ; v0.1 以前のインストールでは Whisper モデルが %USERPROFILE%\.cache\huggingface\hub\
  ; に保存されていた。ユーザーに確認してから削除する。
  IfFileExists "$PROFILE\.cache\huggingface\hub\models--mobiuslabsgmbh--faster-whisper-large-v3-turbo\*.*" legacy_hf_exists 0
  IfFileExists "$PROFILE\.cache\huggingface\hub\models--Systran--faster-whisper-turbo\*.*" legacy_hf_exists 0
  IfFileExists "$PROFILE\.cache\huggingface\hub\models--Systran--faster-whisper-large-v3\*.*" legacy_hf_exists 0
  Goto legacy_hf_skip

  legacy_hf_exists:
    MessageBox MB_YESNO \
      "以前のバージョンでダウンロードした音声認識モデル（Whisper）が見つかりました。$\n\
削除しますか？（合計数GB）$\n$\n\
保存場所: $PROFILE\.cache\huggingface\hub\$\n$\n\
「いいえ」を選ぶとファイルはそのまま残ります。$\n\
他のアプリでも同じモデルを使っている場合は「いいえ」を選んでください。" \
      /SD IDNO IDNO legacy_hf_skip

    DetailPrint "旧 HuggingFace キャッシュの Whisper モデルを削除しています..."
    RMDir /r "$PROFILE\.cache\huggingface\hub\models--mobiuslabsgmbh--faster-whisper-large-v3-turbo"
    RMDir /r "$PROFILE\.cache\huggingface\hub\models--Systran--faster-whisper-turbo"
    RMDir /r "$PROFILE\.cache\huggingface\hub\models--Systran--faster-whisper-large-v3"
    RMDir /r "$PROFILE\.cache\huggingface\hub\models--Systran--faster-whisper-large-v2"
    ; ディレクトリが空になった場合のみ削除（他アプリのキャッシュが残っていれば削除されない）
    RMDir "$PROFILE\.cache\huggingface\hub"
    RMDir "$PROFILE\.cache\huggingface"

  legacy_hf_skip:

  nsis_skip_full_cleanup:
!macroend
