#!/usr/bin/env bash
# setup-build-tools-ubuntu.sh
# Ubuntu 向け NSIS に相当するビルドスクリプト。
# .deb パッケージ（NVIDIA 版）をビルドする。
# AMD 版は --amd オプションで切り替え可能。
set -euo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")/.."

CONFIG_NVIDIA="tauri.build.nvidia-ubuntu.override.json"
CONFIG_AMD="tauri.build.amd-ubuntu.override.json"
BUILD_CONFIG="$CONFIG_NVIDIA"

# --- オプション解析 ---
for arg in "$@"; do
  case "$arg" in
    --amd) BUILD_CONFIG="$CONFIG_AMD" ;;
    --help|-h)
      echo "Usage: $0 [--amd]"
      echo "  (デフォルト) NVIDIA CUDA 版 .deb をビルドします。"
      echo "  --amd        AMD ROCm 版 .deb をビルドします。"
      exit 0
      ;;
    *) echo "[WARN] 不明なオプション: $arg" ;;
  esac
done

echo "=== Build .deb Installer (Ubuntu) ==="
echo "  設定ファイル: $BUILD_CONFIG"
echo ""

# --- cargo チェック ---
if ! command -v cargo &>/dev/null; then
  echo "[ERROR] cargo が見つかりません。Rustup をインストールしてください:"
  echo "         curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh"
  exit 1
fi
echo "[OK] $(cargo --version)"

# --- tauri-cli チェック / インストール ---
if ! cargo tauri -V &>/dev/null 2>&1; then
  echo "[INFO] tauri-cli が見つかりません。インストールします..."
  cargo install tauri-cli --locked
fi
echo "[OK] $(cargo tauri -V)"
echo ""

# --- LGPL FFmpeg CLI のダウンロード ---
if ! command -v python3 &>/dev/null; then
  echo "[ERROR] python3 が見つかりません。"
  exit 1
fi
echo "[INFO] LGPL FFmpeg CLI を確認中..."
python3 scripts/setup_ffmpeg_lgpl.py --platform linux --variant lgpl
echo ""

# --- 第三者ライセンス全文の収集 ---
echo "[INFO] 第三者ライセンス全文を収集中..."
if [[ -d ".venv312/Lib/site-packages" || -d ".venv312/lib" ]]; then
  python3 scripts/collect_licenses.py --venv .venv312 --frontend frontend --tauri src-tauri --out licenses
  echo "[OK] licenses/THIRD_PARTY_FULL.txt を更新しました"
else
  echo "[WARN] .venv312 が見つかりません。Python 依存のライセンス再収集をスキップします。"
  echo "[WARN] リリース前に配布相当の Python 環境を指定して scripts/collect_licenses.py を実行してください。"
fi
if [[ ! -f "licenses/THIRD_PARTY_FULL.txt" ]]; then
  echo "[WARN] licenses/THIRD_PARTY_FULL.txt が見つかりません。ライセンス resources が不完全になります。"
fi
echo ""

echo "[INFO] LLM 校正は llama.cpp llama-server を直接起動します。Lemonade/lemond は同梱しません。"
echo ""

# --- .deb ビルド ---
echo "[INFO] .deb パッケージをビルド中..."
echo "[INFO] 初回は Rust のコンパイルがあるため数十分かかることがあります。"
echo ""
cargo tauri build --bundles deb --config "$BUILD_CONFIG"

echo ""
echo "[OK] ビルドが完了しました。"
echo "[OK] 出力先: src-tauri/target/release/bundle/deb/"
echo ""
echo "[INFO] Python パッケージはインストール後にアプリのセットアップ UI からインストールしてください。"
