# -*- coding: utf-8 -*-
"""collect_licenses.py — 第三者依存のフルライセンス本文を収集して結合する。

3エコシステムを手元のファイルからオフラインで収集する:
  - Python: <venv>/Lib/site-packages/*.dist-info/（LICENSE 等）
  - Rust:   `cargo metadata` の依存グラフ + 各 crate ソース（registry キャッシュ）の LICENSE
  - Node:   frontend/package.json の production 依存クロージャの LICENSE

出力: licenses/{python,rust,node}-third-party.txt と、結合版 THIRD_PARTY_FULL.txt

使い方:
  python scripts/collect_licenses.py
  python scripts/collect_licenses.py --venv .venv312 --frontend frontend --tauri src-tauri
"""
from __future__ import annotations

import argparse
import json
import re
import subprocess
import sys
from pathlib import Path

LICENSE_NAME_RE = re.compile(
    r"^(LICEN[SC]E|COPYING|COPYRIGHT|NOTICE|AUTHORS)", re.IGNORECASE
)
SEP = "=" * 80
SUB = "-" * 80


def read_text(p: Path) -> str:
    for enc in ("utf-8", "latin-1"):
        try:
            return p.read_text(encoding=enc)
        except (UnicodeDecodeError, OSError):
            continue
    return ""


def find_license_files(base: Path, recursive: bool = False) -> list[Path]:
    if not base.is_dir():
        return []
    out: list[Path] = []
    it = base.rglob("*") if recursive else base.iterdir()
    for f in it:
        if f.is_file() and LICENSE_NAME_RE.match(f.name):
            out.append(f)
    return sorted(set(out))


# ----------------------------------------------------------------------------
# SPDX フォールバック: LICENSE ファイルを同梱しない permissive パッケージ向けに
# 宣言された SPDX 識別子から標準ライセンス本文を補完する。
# （MIT / BSD 系は本来パッケージ固有の著作権表示を伴うが、未同梱のため標準文面で補う）
# ----------------------------------------------------------------------------
_MIT = """MIT License

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE."""

_BSD_DISCLAIMER = """THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS"
AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE
IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE
DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT HOLDER OR CONTRIBUTORS BE LIABLE
FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL
DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR
SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER
CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY,
OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE
OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE."""

_BSD3 = """Redistribution and use in source and binary forms, with or without
modification, are permitted provided that the following conditions are met:

1. Redistributions of source code must retain the above copyright notice, this
   list of conditions and the following disclaimer.
2. Redistributions in binary form must reproduce the above copyright notice,
   this list of conditions and the following disclaimer in the documentation
   and/or other materials provided with the distribution.
3. Neither the name of the copyright holder nor the names of its contributors
   may be used to endorse or promote products derived from this software
   without specific prior written permission.

""" + _BSD_DISCLAIMER

_BSD2 = """Redistribution and use in source and binary forms, with or without
modification, are permitted provided that the following conditions are met:

1. Redistributions of source code must retain the above copyright notice, this
   list of conditions and the following disclaimer.
2. Redistributions in binary form must reproduce the above copyright notice,
   this list of conditions and the following disclaimer in the documentation
   and/or other materials provided with the distribution.

""" + _BSD_DISCLAIMER

_ISC = """Permission to use, copy, modify, and/or distribute this software for any
purpose with or without fee is hereby granted, provided that the above
copyright notice and this permission notice appear in all copies.

THE SOFTWARE IS PROVIDED "AS IS" AND THE AUTHOR DISCLAIMS ALL WARRANTIES WITH
REGARD TO THIS SOFTWARE INCLUDING ALL IMPLIED WARRANTIES OF MERCHANTABILITY AND
FITNESS. IN NO EVENT SHALL THE AUTHOR BE LIABLE FOR ANY SPECIAL, DIRECT,
INDIRECT, OR CONSEQUENTIAL DAMAGES OR ANY DAMAGES WHATSOEVER RESULTING FROM
LOSS OF USE, DATA OR PROFITS, WHETHER IN AN ACTION OF CONTRACT, NEGLIGENCE OR
OTHER TORTIOUS ACTION, ARISING OUT OF OR IN CONNECTION WITH THE USE OR
PERFORMANCE OF THIS SOFTWARE."""

_ZLIB = """This software is provided 'as-is', without any express or implied
warranty. In no event will the authors be held liable for any damages arising
from the use of this software.

Permission is granted to anyone to use this software for any purpose, including
commercial applications, and to alter it and redistribute it freely, subject to
the following restrictions:

1. The origin of this software must not be misrepresented; you must not claim
   that you wrote the original software. If you use this software in a product,
   an acknowledgment in the product documentation would be appreciated but is
   not required.
2. Altered source versions must be plainly marked as such, and must not be
   misrepresented as being the original software.
3. This notice may not be removed or altered from any source distribution."""

_0BSD = """Permission to use, copy, modify, and/or distribute this software for any
purpose with or without fee is hereby granted.

THE SOFTWARE IS PROVIDED "AS IS" AND THE AUTHOR DISCLAIMS ALL WARRANTIES WITH
REGARD TO THIS SOFTWARE INCLUDING ALL IMPLIED WARRANTIES OF MERCHANTABILITY AND
FITNESS. IN NO EVENT SHALL THE AUTHOR BE LIABLE FOR ANY SPECIAL, DIRECT,
INDIRECT, OR CONSEQUENTIAL DAMAGES OR ANY DAMAGES WHATSOEVER RESULTING FROM
LOSS OF USE, DATA OR PROFITS, WHETHER IN AN ACTION OF CONTRACT, NEGLIGENCE OR
OTHER TORTIOUS ACTION, ARISING OUT OF OR IN CONNECTION WITH THE USE OR
PERFORMANCE OF THIS SOFTWARE."""

# 識別子（正規化後）→ 本文。Apache-2.0 は main() で repo の LICENSE から充填する。
_SPDX: dict[str, str] = {
    "MIT": _MIT, "BSD-3-CLAUSE": _BSD3, "BSD-2-CLAUSE": _BSD2,
    "ISC": _ISC, "ZLIB": _ZLIB, "0BSD": _0BSD,
}


def normalize_license_ids(lic: str) -> list[str]:
    """ライセンス文字列を SPDX 風 ID 群へ正規化する（dual ライセンスは全て返す）。"""
    s = " " + lic.upper().replace("/", " OR ") + " "
    ids: list[str] = []
    if "APACHE" in s:
        ids.append("APACHE-2.0")
    if re.search(r"\bMIT\b", s):
        ids.append("MIT")
    if "BSD-3" in s or "BSD 3" in s:
        ids.append("BSD-3-CLAUSE")
    if "BSD-2" in s or "BSD 2" in s:
        ids.append("BSD-2-CLAUSE")
    if re.search(r"\bBSD\b", s) and "BSD-3-CLAUSE" not in ids and "BSD-2-CLAUSE" not in ids:
        ids.append("BSD-3-CLAUSE")  # 無印 BSD は 3-Clause を採用
    if re.search(r"\bISC\b", s):
        ids.append("ISC")
    if "ZLIB" in s:
        ids.append("ZLIB")
    if "0BSD" in s:
        ids.append("0BSD")
    return list(dict.fromkeys(ids))


def synth_texts(lic: str) -> list[tuple[str, str]]:
    """LICENSE ファイル未同梱時、SPDX 識別子から標準本文を補完する。"""
    out: list[tuple[str, str]] = []
    for cid in normalize_license_ids(lic):
        text = _SPDX.get(cid)
        if text:
            out.append((f"SPDX {cid} (canonical text — copyright held by package authors)", text))
    return out


def finalize(name, version, lic, texts, entries, missing):
    if not texts:
        texts = synth_texts(lic)
    if texts:
        entries.append((name, version, lic, texts))
    else:
        missing.append((name, version, lic))


def load_apache2(root: Path) -> str:
    """repo の LICENSE（Apache-2.0 + 付録）から、正準の条項本文のみを取り出す。"""
    p = root / "LICENSE"
    if not p.exists():
        return ""
    t = read_text(p)
    marker = "END OF TERMS AND CONDITIONS"
    idx = t.find(marker)
    return (t[: idx + len(marker)] + "\n") if idx != -1 else ""


# ----------------------------------------------------------------------------
# Python
# ----------------------------------------------------------------------------
def parse_metadata(meta_path: Path) -> tuple[str, str, str]:
    name = version = ""
    licenses: list[str] = []
    for line in read_text(meta_path).splitlines():
        if line.startswith("Name:") and not name:
            name = line.split(":", 1)[1].strip()
        elif line.startswith("Version:") and not version:
            version = line.split(":", 1)[1].strip()
        elif line.startswith("License-Expression:"):
            licenses.append(line.split(":", 1)[1].strip())
        elif line.startswith("License:"):
            v = line.split(":", 1)[1].strip()
            if v and v.upper() != "UNKNOWN":
                licenses.append(v)
        elif line.startswith("Classifier: License ::"):
            licenses.append(line.split("::")[-1].strip())
        elif line and not line[0].isspace() and ":" not in line.split(" ", 1)[0]:
            break  # body started
    lic = "; ".join(dict.fromkeys(x for x in licenses if x)) or "(unspecified)"
    return name, version, lic


def record_license_files(di: Path, site_packages: Path) -> list[Path]:
    """dist-info/RECORD からパッケージ本体側の LICENSE 類を探す。
    （例: nvidia-cusparselt-cu12 は site-packages/nvidia/cusparselt/LICENSE.txt に置く）"""
    out: list[Path] = []
    for line in read_text(di / "RECORD").splitlines():
        rel = line.split(",", 1)[0]
        if LICENSE_NAME_RE.match(Path(rel).name):
            p = (site_packages / rel).resolve()
            if p.is_file():
                out.append(p)
    return sorted(set(out))


def collect_python(site_packages: Path) -> tuple[list, list]:
    entries, missing = [], []
    for di in sorted(site_packages.glob("*.dist-info")):
        name, version, lic = parse_metadata(di / "METADATA")
        if not name:
            name = di.name.split("-")[0]
        files = find_license_files(di, recursive=False)
        files += find_license_files(di / "licenses", recursive=True)
        files = sorted(set(files))
        if not files:
            files = record_license_files(di, site_packages)
        texts = [(f.name, read_text(f)) for f in files if read_text(f).strip()]
        finalize(name, version, lic, texts, entries, missing)
    return entries, missing


# ----------------------------------------------------------------------------
# Rust
# ----------------------------------------------------------------------------
def collect_rust(tauri_dir: Path, project_root: Path) -> tuple[list, list]:
    try:
        raw = subprocess.check_output(
            ["cargo", "metadata", "--format-version", "1"],
            cwd=str(tauri_dir), stderr=subprocess.DEVNULL,
        )
    except Exception as e:  # noqa: BLE001
        print(f"  WARN: cargo metadata 失敗: {e}", file=sys.stderr)
        return [], []
    md = json.loads(raw)
    entries, missing = [], []
    for pkg in sorted(md.get("packages", []), key=lambda p: p["name"].lower()):
        mpath = Path(pkg["manifest_path"])
        # ローカル（ワークスペース自身）はスキップ
        try:
            if project_root in mpath.parents:
                continue
        except Exception:  # noqa: BLE001
            pass
        name, version = pkg["name"], pkg["version"]
        lic = pkg.get("license") or pkg.get("license_file") or "(unspecified)"
        files = find_license_files(mpath.parent, recursive=False)
        texts = [(f.name, read_text(f)) for f in files if read_text(f).strip()]
        finalize(name, version, lic, texts, entries, missing)
    return entries, missing


# ----------------------------------------------------------------------------
# Node (production 依存クロージャのみ)
# ----------------------------------------------------------------------------
def node_pkg_dir(node_modules: Path, name: str) -> Path:
    return node_modules / name  # "@scope/name" も Path 結合で解決


def collect_node(frontend: Path) -> tuple[list, list]:
    nm = frontend / "node_modules"
    pj = json.loads(read_text(frontend / "package.json") or "{}")
    queue = list(pj.get("dependencies", {}).keys())
    seen: set[str] = set()
    entries, missing = [], []
    while queue:
        name = queue.pop()
        if name in seen:
            continue
        seen.add(name)
        d = node_pkg_dir(nm, name)
        meta = json.loads(read_text(d / "package.json") or "{}")
        for dep in meta.get("dependencies", {}):
            if dep not in seen:
                queue.append(dep)
        version = meta.get("version", "")
        lic = meta.get("license") or "(unspecified)"
        if isinstance(lic, dict):
            lic = lic.get("type", "(unspecified)")
        files = find_license_files(d, recursive=False)
        texts = [(f.name, read_text(f)) for f in files if read_text(f).strip()]
        finalize(name, version, lic, texts, entries, missing)
    entries.sort(key=lambda e: e[0].lower())
    missing.sort(key=lambda e: e[0].lower())
    return entries, missing


# ----------------------------------------------------------------------------
# 手動補完分（licenses/manual/ に git 管理で配置）
#   - 自動収集で本文が取れないもの: pywin32 / sentencepiece / selectors (MPL-2.0)
#   - 同梱バイナリの条件文書: NVIDIA CUDA Toolkit EULA（Attachment A/B 含む）
# ----------------------------------------------------------------------------
def collect_manual(manual_dir: Path) -> list[tuple[str, str]]:
    if not manual_dir.is_dir():
        return []
    return [(f.name, read_text(f)) for f in sorted(manual_dir.glob("*.txt"))
            if read_text(f).strip()]


def render_manual(files: list[tuple[str, str]]) -> str:
    lines = [SEP, "MANUAL ADDITIONS（手動補完: 同梱バイナリの条件文書・自動収集不能パッケージ）",
             f"  files: {len(files)}", SEP, ""]
    for fname, text in files:
        lines.append(SEP)
        lines.append(f"[{fname}]")
        lines.append(SUB)
        lines.append(text.rstrip())
        lines.append("")
    return "\n".join(lines)


# ----------------------------------------------------------------------------
def render(title: str, entries: list, missing: list) -> str:
    lines = [SEP, title, f"  packages with license text: {len(entries)}"
             f" / missing: {len(missing)}", SEP, ""]
    for name, version, lic, texts in entries:
        lines.append(SEP)
        lines.append(f"{name} {version}  —  {lic}")
        lines.append(SUB)
        for fname, text in texts:
            lines.append(f"[{fname}]")
            lines.append(text.rstrip())
            lines.append("")
        lines.append("")
    if missing:
        lines.append(SEP)
        lines.append("ライセンス本文が見つからなかったパッケージ（要手動確認）:")
        lines.append(SUB)
        for name, version, lic in missing:
            lines.append(f"  - {name} {version}  —  {lic}")
        lines.append("")
    return "\n".join(lines)


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--venv", default=".venv312")
    ap.add_argument("--frontend", default="frontend")
    ap.add_argument("--tauri", default="src-tauri")
    ap.add_argument("--out", default="licenses")
    args = ap.parse_args()

    root = Path.cwd()
    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=True)

    _SPDX["APACHE-2.0"] = load_apache2(root)  # 正準 Apache-2.0 本文を充填

    site_packages = Path(args.venv) / "Lib" / "site-packages"
    if not site_packages.is_dir():
        site_packages = Path(args.venv) / "lib"  # Linux 互換
        cands = list(site_packages.glob("python*/site-packages"))
        if cands:
            site_packages = cands[0]

    print("Python ライセンス収集中 ...")
    py_e, py_m = collect_python(site_packages)
    print("Rust ライセンス収集中 ...")
    rs_e, rs_m = collect_rust(Path(args.tauri), root)
    print("Node ライセンス収集中 ...")
    nd_e, nd_m = collect_node(Path(args.frontend))

    sections = [
        ("python-third-party.txt", "PYTHON DEPENDENCIES", py_e, py_m),
        ("rust-third-party.txt", "RUST CRATES", rs_e, rs_m),
        ("node-third-party.txt", "NODE (frontend production) DEPENDENCIES", nd_e, nd_m),
    ]
    combined = ["LoTT — 第三者依存 フルライセンス本文（自動収集＋手動補完）", ""]
    for fname, title, e, m in sections:
        body = render(title, e, m)
        (out / fname).write_text(body, encoding="utf-8")
        combined.append(body)
    manual_files = collect_manual(out / "manual")
    if manual_files:
        combined.append(render_manual(manual_files))
    (out / "THIRD_PARTY_FULL.txt").write_text("\n".join(combined), encoding="utf-8")

    print("\n=== 収集サマリ ===")
    for _, title, e, m in sections:
        print(f"  {title}: {len(e)} 本文 / {len(m)} 不明")
    print(f"  MANUAL ADDITIONS: {len(manual_files)} 本文")
    print(f"\n出力先: {out.resolve()}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
