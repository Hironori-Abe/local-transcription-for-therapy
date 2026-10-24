# Brotli2Shell 調査・対策記録

確認日: 2026-10-25。対象: `5ec3f2a` の LoTT 0.9.9 と今回の修正。

## 脆弱性と条件

Brotli2Shell / Node2Shell などと呼ばれている CVE-2026-111497 は、Google の C Brotli デコーダの境界外書き込み。攻撃者が制御する不正な圧縮ストリームを展開した場合、クラッシュ・メモリ漏えい・コード実行につながりうる。インターネット公開サーバーだけでなく、外部から取得した Brotli 応答を展開するクライアントも確認対象になる。圧縮処理だけの利用は、この展開処理の脆弱性の成立条件にはならない。

- [Node.js 公式セキュリティ告知](https://nodejs.org/en/blog/vulnerability/october-2026-security-releases): 修正版は 22.23.4 / 24.22.1 / 26.12.1。
- [Google Brotli 公式リリース](https://github.com/google/brotli/releases): 修正版は 1.0.10 / 1.1.1 / 1.2.1。
- [Ubuntu の調査状況](https://ubuntu.com/security/CVE-2026-111497): 確認時点で Ubuntu 24.04 等は Needs evaluation。修正済みとは判断しない。

## プロジェクトの確認結果

| 対象 | 確認結果・判断 |
| --- | --- |
| 開発・ビルド用 Node.js | Dockerfile は 22.23.2、作業PCは 22.23.3。どちらも公式修正前。Node は配布アプリには含まないが、開発用サーバーや依存ツールが動く環境として更新が必要 |
| Angular | 実際のビルダーは `@angular/build:application` / `@angular/build:dev-server`。アプリコードには Brotli 展開・プロキシ・サーバー側 fetch の利用なし。ビルド側に圧縮サイズ計測の `brotliCompress` がある。依存には展開可能な body-parser 等もあるが、存在だけを根拠に実際の攻撃経路があるとは判断しない |
| Rust `brotli 8.0.2` / `brotli-decompressor 5.0.0` | Google C 版の FFI ではなく [Rust 実装](https://github.com/dropbox/rust-brotli)。Cargo feature tree で `unsafe` feature が無効であることを確認。Tauri の同梱フロント資源の圧縮・展開に使用。この C 実装の CVE を理由とする更新対象にはしない |
| Linux WebKitGTK / libsoup / FreeType | C Brotli を間接的に使用する。AppImage はホストOSの更新だけでは同梱物が直らないため、修正版を同梱する必要がある。deb / 開発版はホストのライブラリを使う |
| Windows WebView2 | OS側の外部ランタイム。プロジェクトはその C Brotli をビルド・同梱していない。導入済み各版が修正済みかは今回未確認。ランタイム更新は利用者の Windows / Edge 更新経路で行う |
| 音声再生HTTPサーバー | Rust の手動HTTP処理で 127.0.0.1 のみ。要求の Brotli 展開も、応答の `Content-Encoding: br` もない |
| モデル取得 | curl / PowerShell で固定URLから取得し SHA-256 照合。curl に `--compressed` や Brotli の Accept-Encoding を渡していない。ダウンロード結果をこのアプリが Brotli 展開する経路もない |
| ローカルファイル・画面 | 会話テキストはHTMLとして取り込まず、フォントは同梱。CSPは外部接続・外部フォント・フレームを制限。不審な Brotli ストリームを通常運用で取り込む経路は今回のコードレビューでは見つからなかった。脆弱な依存ライブラリの放置を正当化するものではない |

## 実装した対策

1. Docker の Node.js を 22.23.4 へ更新。
2. ルートと frontend の `engines` / `.npmrc` と npm ライフサイクルで、サポートする修正済み Node の最低版を検査。Windows / CachyOS / Ubuntu に共通する CJS スクリプトを使用。古い Node で install・開発起動・ビルド・frontend test を実行すると中止する。Linux setup も同じ検査を使用する。
3. Ubuntu ビルダー内だけで、C Brotli 1.1.1 の固定ソースを SHA-256 検証してビルド。ABI互換の common / decoder / encoder をまとめて置換し、古い実体を残さない。上流テストを実行。MIT ライセンスを同梱する。
4. ビルダーと最終 AppDir のデコーダ実体を `BrotliDecoderVersion()` で検査。欠落や修正前の版は配布ビルドを中止。下位の版番号を維持したディストリビューションのバックポートは自動承認せず、別途パッチ確認を要する。

Node 公式修正版は、内部 Brotli の表示版番号が古いままでも修正をバックポートしている場合がある。実際に取得・SHA-256確認した Node 22.23.4 の `process.versions.brotli` は `1.1.0`。したがって Node の判定は公式 Node リリース番号で行い、上流ソースから作る AppImage の C ライブラリとは判定基準を分ける。

## 検証と限界

- 修正前 Node 22.23.3 で検査が失敗し、公式修正済み 22.23.4 で成功することを確認。最低版の直前・直後とサポート外の版も回帰テストで確認。
- Node 22.23.4 で frontend の13テストファイル、Full / Editor の本番ビルド成功。
- C Brotli の版判定テスト成功。修正済み 1.1.1 の実ライブラリで検査成功。
- CachyOS上と、既存 Ubuntu 24.04 ビルダーの使い捨てコンテナ内で、同じ固定ソースのビルド・上流14テスト成功。Ubuntu側では実際にシステムライブラリの置換を行い、libsoup / FreeType / WebKitGTK のロード成功。
- シェル構文検査、Full / Editor のビルドスクリプトの dry-run、`git diff --check` 成功。
- 完成した AppImage / deb / Windows インストーラーの再生成と実機UI動作、Windows WebView2各版の調査、攻撃によるコード実行の再現は行っていない。

このPCの Node 22.23.3 とホスト Brotli 1.2.0-1.1 は未更新。テストには `/tmp` の修正済み Node を使用した。Node は上記修正版へ更新してから開発すること。ホスト Brotli を使う CachyOS / Ubuntu の開発版・deb版は、ディストリビューションが提供する修正を適用すること。版番号が旧版のままでもバックポートされる場合があるため、配布元の修正情報で判断する。今回、ホストOSの更新や既存配布物の差し替えは行っていない。
