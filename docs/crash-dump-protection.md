# クラッシュダンプ対策の範囲

会話音声・逐語録がクラッシュ時の診断ファイルへ入ることを抑えるため、アプリが扱えるプロセス内の設定を適用する。OS の sysctl、収集サービス、管理者のダンプ設定は変更しない。Full / Editor 共通で、画面や音声エンジンの初期化より先に設定する。GPU 列挙専用の子プロセスにも適用する。

## Windows

- `SEM_NOGPFAULTERRORBOX` による Windows エラー報告抑止。子プロセスにもエラーモードを継承する。
- 本体の `WerSetFlags` に `WER_FAULT_REPORTING_FLAG_NOHEAP` を追加し、異常終了・応答停止時のヒープ収集を抑止する。既存の WER フラグは保つ。このフラグ単独で、すべての診断情報の収集を禁止するものではない。
- 音声エンジン・ffmpeg に Job Object の `DIE_ON_UNHANDLED_EXCEPTION` を適用する。従来からの、本体・音声エンジンに限定した利用者ごとの WER 除外登録も維持する。汎用の `ffmpeg.exe` は他アプリでも使うため除外登録しない。
- WebView2 は `IsCustomCrashReportingEnabled=true` とし、自動送信を抑止する。アプリ自身がダンプを収集・送信する処理は持たない。

管理者が設定した LocalDumps や外部の診断ツールによる収集は対象外。

## Linux（CachyOS / Ubuntu）

同じ実装を両環境に適用する。収集サービスの種類を判定して OS を変更する処理は持たない。

1. 本体の `RLIMIT_CORE` をソフト・ハードともに 0 にする。子・孫プロセスにも引き継ぐ。CachyOS 等の systemd-coredump はこの制限を尊重する。
2. `/proc/self/coredump_filter` を 0 にし、ヒープ・スタック・共有メモリ・ファイルのマッピングなど、通常のメモリ領域をダンプ対象から外す。fork / exec を通じて whisper・NeMo・ffmpeg・WebKit にも引き継ぐため、Ubuntu の Apport など、`RLIMIT_CORE=0` でも収集する方式に対してもメモリ領域を除外する。静的リンクの実行ファイルにも有効。
3. 本体には `PR_SET_DUMPABLE=0` を設定し、コアダンプ自体を禁止する。設定後に適用結果を確認する。`coredump_filter` は先に設定する（ダンプ禁止にすると `/proc/self` の所有者が変わり、フィルターを書き換えられなくなるため）。

設定に失敗した場合は、会話データを読み込む前に起動を中止する。設定の再適用時にも、本体のダンプ禁止を一時的に解除しない。

`PR_SET_DUMPABLE` は exec 後にリセットされるため、子プロセスの**ダンプファイル自体を完全に禁止したとは説明しない**。フィルターを 0 にしても、レジスタ、コマンドライン等のプロセス情報、カーネルが必ず含める vDSO は残りうる。OS や外部診断ツールが別の仕組みで収集する情報も対象外。デバッガの通常の attach は、本体のダンプ禁止によって制限される。

## 検証

- Linux の単体テストは専用子プロセスで本体のダンプ禁止・両 core limit の 0・メモリフィルターの 0・再適用を確認する。さらに exec 後の子プロセスとシェル経由の孫プロセスでもフィルターと制限が残ることを確認する。テスト本体のプロセス設定は変更しない。
- Windows の単体テストは、既存フラグを保ったまま NOHEAP を追加することを確認する。従来のエラーモード・Job Object・WER 除外のテストも維持する。
- テストでアプリを意図的にクラッシュさせたり、OS の収集サービスへダンプを渡したりしない。

## 仕様の参照先

- [Linux core(5): メモリフィルター、fork / exec での継承](https://man7.org/linux/man-pages/man5/core.5.html)
- [Linux execve(2): dumpable 属性のリセット](https://man7.org/linux/man-pages/man2/execve.2.html)
- [systemd のコアダンプ処理](https://systemd.io/COREDUMP/)
- [Canonical Apport の収集実装](https://github.com/canonical/apport/blob/main/data/apport)
- [Microsoft WerSetFlags: NOHEAP](https://learn.microsoft.com/en-us/windows/win32/api/werapi/nf-werapi-wersetflags)
