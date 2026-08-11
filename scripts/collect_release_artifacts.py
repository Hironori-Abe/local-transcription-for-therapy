#!/usr/bin/env python3
"""Collect Tauri build artifacts under the project's release naming convention."""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import shutil
import sys
import tempfile
from pathlib import Path
from typing import Iterable


VARIANT_TOKENS = {
    "nvidia": "cuda",
    "amd": "rocm",
    "cpu": "cpu",
    "editor": "editor",
}

CHECKSUMS_NAME = "SHA256SUMS.txt"


def repository_root() -> Path:
    return Path(__file__).resolve().parent.parent


def read_version(root: Path) -> str:
    config_path = root / "src-tauri" / "tauri.conf.json"
    try:
        config = json.loads(config_path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise SystemExit(f"[ERROR] tauri.conf.json を読み込めません: {config_path} ({exc})") from exc
    version = config.get("version")
    if not isinstance(version, str) or not version:
        raise SystemExit(f"[ERROR] tauri.conf.json の version がありません: {config_path}")
    return version


def read_product_name(root: Path, platform: str, variant: str) -> str:
    base_path = root / "src-tauri" / "tauri.conf.json"
    override_path = root / f"tauri.{variant}.{platform}.override.json"
    try:
        base_config = json.loads(base_path.read_text(encoding="utf-8"))
        override_config = (
            json.loads(override_path.read_text(encoding="utf-8"))
            if override_path.is_file()
            else {}
        )
    except (OSError, json.JSONDecodeError) as exc:
        raise SystemExit(
            f"[ERROR] productName の設定を読み込めません: {override_path if override_path.is_file() else base_path} ({exc})"
        ) from exc

    product_name = override_config.get("productName") or base_config.get("productName")
    if not isinstance(product_name, str) or not product_name:
        raise SystemExit(
            f"[ERROR] productName がありません: {override_path if override_path.is_file() else base_path}"
        )
    return product_name


def canonical_names(platform: str, variant: str, version: str) -> list[str]:
    token = VARIANT_TOKENS[variant]
    prefix = f"LoTT-v{version}-"
    if platform == "windows":
        return [f"{prefix}windows-x64-{token}-setup.exe"]
    return [
        f"{prefix}linux-x64-{token}.AppImage",
        f"{prefix}linux-x64-{token}.deb",
    ]


def has_artifact_extension(path: Path, platform: str, extension: str | None = None) -> bool:
    if not path.is_file():
        return False
    name = path.name.lower()
    if platform == "windows":
        return name.endswith("_x64-setup.exe")
    if extension == ".appimage":
        return name.endswith(".appimage")
    return name.endswith(".deb")


def is_matching_artifact(
    path: Path,
    platform: str,
    extension: str | None,
    artifact_prefix: str,
) -> bool:
    return has_artifact_extension(path, platform, extension) and path.name.startswith(artifact_prefix)


def find_candidates(
    source_dirs: Iterable[Path],
    platform: str,
    extension: str | None,
    artifact_prefix: str,
) -> list[Path]:
    candidates: list[Path] = []
    seen: set[Path] = set()
    for source_dir in source_dirs:
        if not source_dir.exists():
            continue
        if not source_dir.is_dir():
            print(f"[WARN] 成果物の探索元がディレクトリではありません: {source_dir}", file=sys.stderr)
            continue
        for path in sorted(source_dir.iterdir(), key=lambda item: item.name):
            resolved = path.resolve()
            if resolved in seen:
                continue
            seen.add(resolved)
            if not has_artifact_extension(path, platform, extension):
                continue
            if not is_matching_artifact(path, platform, extension, artifact_prefix):
                print(
                    f"[INFO] 別の配布ラインとしてスキップ: {path} "
                    f"（期待する接頭辞: {artifact_prefix}）"
                )
                continue
            candidates.append(path)
    return candidates


def choose_candidate(candidates: list[Path], label: str) -> Path:
    if len(candidates) > 1:
        names = "\n".join(f"  {path}" for path in sorted(candidates))
        raise RuntimeError(
            f"{label} の対象成果物が複数あります。自動選択を中止します。\n候補:\n{names}"
        )
    return candidates[0]


def install_artifact(source: Path, destination: Path) -> str:
    source = source.resolve()
    destination = destination.resolve()
    if source == destination:
        return "existing"

    destination.parent.mkdir(parents=True, exist_ok=True)
    temp_path: Path | None = None
    try:
        fd, temp_name = tempfile.mkstemp(prefix=f".{destination.name}.", suffix=".tmp", dir=destination.parent)
        os.close(fd)
        temp_path = Path(temp_name)
        temp_path.unlink()
        try:
            os.link(source, temp_path)
            method = "hardlink"
        except OSError:
            shutil.copy2(source, temp_path)
            method = "copy"
        os.replace(temp_path, destination)
        temp_path = None
        return method
    finally:
        if temp_path is not None:
            try:
                temp_path.unlink()
            except FileNotFoundError:
                pass


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def write_checksums(output_dir: Path) -> Path:
    checksum_path = output_dir / CHECKSUMS_NAME
    files = sorted(
        (path for path in output_dir.iterdir() if path.is_file() and path.name != CHECKSUMS_NAME),
        key=lambda path: path.name,
    )
    with checksum_path.open("w", encoding="ascii", newline="\n") as stream:
        for path in files:
            stream.write(f"{sha256(path)}  {path.name}\n")
    return checksum_path


def output_path(root: Path, raw_output_dir: str | None, version: str) -> Path:
    if raw_output_dir is None:
        return root / "dist" / f"v{version}"
    path = Path(raw_output_dir)
    return path if path.is_absolute() else Path.cwd() / path


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="ビルド成果物を規約名で dist/v{version}/ へ集約します。"
    )
    parser.add_argument("--platform", choices=("windows", "linux"), required=True)
    parser.add_argument("--variant", choices=tuple(VARIANT_TOKENS), required=True)
    parser.add_argument(
        "--source-dir",
        "--source",
        dest="source_dirs",
        action="append",
        required=True,
        help="成果物を探索するディレクトリ。複数指定可。",
    )
    parser.add_argument("--version", help="省略時は src-tauri/tauri.conf.json から取得")
    parser.add_argument("--output-dir", help="省略時は dist/v{version}/")
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="コピー・ハードリンク・チェックサム生成を行わず、生成予定名だけ表示",
    )
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    root = repository_root()
    version = args.version or read_version(root)
    product_name = read_product_name(root, args.platform, args.variant)
    artifact_prefix = f"{product_name}_{version}"
    destination_dir = output_path(root, args.output_dir, version)
    names = canonical_names(args.platform, args.variant, version)

    if args.variant == "amd":
        print("[WARN] AMD 版は一般向け Release へ添付しない方針です（docs/release-build-windows.md）")

    if args.dry_run:
        print(f"[DRY-RUN] 規約名の生成予定（出力先: {destination_dir}）:")
        for name in names:
            print(f"  {name}")
        print(f"  {CHECKSUMS_NAME}")
        return 0

    source_dirs = [Path(raw_path) for raw_path in args.source_dirs]
    specs = []
    if args.platform == "windows":
        specs.append((names[0], None, "Windows installer"))
    else:
        specs.extend(
            (
                (names[0], ".appimage", "Linux AppImage"),
                (names[1], ".deb", "Linux deb"),
            )
        )

    selected: list[tuple[str, Path]] = []
    for canonical_name, extension, label in specs:
        candidates = find_candidates(source_dirs, args.platform, extension, artifact_prefix)
        if not candidates:
            print(f"[WARN] {label} の対象成果物が見つかりません。")
            continue
        selected.append((canonical_name, choose_candidate(candidates, label)))

    if not selected:
        print("[WARN] 対象の成果物が1つも見つかりません。終了コード 0 で終了します。")
        if not destination_dir.exists():
            return 0

    installed: list[Path] = []
    for canonical_name, source in selected:
        destination = destination_dir / canonical_name
        method = install_artifact(source, destination)
        installed.append(destination)
        print(f"[OK] {method}: {destination.name} ({destination.stat().st_size} bytes)")

    if destination_dir.exists():
        checksum_path = write_checksums(destination_dir)
        print(f"[OK] 出力先: {destination_dir}")
        print(f"[OK] generated: {checksum_path.name} ({checksum_path.stat().st_size} bytes)")
        print("[OK] 配置済みファイル:")
        for path in sorted(
            (candidate for candidate in destination_dir.iterdir() if candidate.is_file()),
            key=lambda candidate: candidate.name,
        ):
            print(f"  {path.name} ({path.stat().st_size} bytes)")
    elif installed:
        raise RuntimeError(f"出力先を作成できませんでした: {destination_dir}")

    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except (OSError, RuntimeError) as exc:
        print(f"[ERROR] 成果物の集約に失敗しました: {exc}", file=sys.stderr)
        raise SystemExit(1) from exc
