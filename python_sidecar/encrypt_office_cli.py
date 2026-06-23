#!/usr/bin/env python3
"""File encryption helper for LoTT exports.

The password is read from stdin (a single line), never passed as a command-line
argument. On Windows, another process running as the same user can read the
command line of a running process, so the encryption password (which protects
PII in the exported file) must not appear in argv.

Subcommands
-----------
office <file_path>
    Password-protect a DOCX or XLSX file in-place using OOXML encryption
    (requires msoffcrypto-tool). Password is read from stdin.

json <json_temp_path> <output_zip_path>
    Wrap a JSON file in an AES-256 encrypted ZIP and write to output_zip_path
    (requires pyzipper). The input temp file is NOT deleted here; the caller
    is responsible for cleanup. Password is read from stdin.
"""

import io
import os
import sys
import zipfile


def cmd_office(file_path: str, password: str) -> None:
    import msoffcrypto

    with open(file_path, "rb") as f:
        file_data = f.read()

    office_file = msoffcrypto.OfficeFile(io.BytesIO(file_data))
    encrypted = io.BytesIO()
    office_file.encrypt(password, encrypted)

    with open(file_path, "wb") as f:
        f.write(encrypted.getvalue())


def cmd_json(json_temp_path: str, output_zip_path: str, password: str) -> None:
    import pyzipper

    arcname = os.path.splitext(os.path.basename(output_zip_path))[0] + ".json"
    with pyzipper.AESZipFile(
        output_zip_path,
        "w",
        compression=zipfile.ZIP_DEFLATED,
        encryption=pyzipper.WZ_AES,
    ) as zf:
        zf.setpassword(password.encode("utf-8"))
        zf.write(json_temp_path, arcname=arcname)


def read_password_from_stdin() -> str:
    """Read the encryption password from stdin (UTF-8, trailing newline stripped)."""
    data = sys.stdin.buffer.read()
    # 末尾の改行のみ除去する（パスワード途中・末尾の空白文字は保持）。
    return data.decode("utf-8").rstrip("\r\n")


def main() -> None:
    if len(sys.argv) < 2:
        print("Usage: encrypt_office_cli.py <office|json> ...  (password via stdin)", file=sys.stderr)
        sys.exit(1)

    mode = sys.argv[1]
    if mode == "office":
        if len(sys.argv) != 3:
            print("Usage: encrypt_office_cli.py office <file_path>  (password via stdin)", file=sys.stderr)
            sys.exit(1)
        password = read_password_from_stdin()
        if not password:
            print("password (stdin) is empty", file=sys.stderr)
            sys.exit(1)
        cmd_office(sys.argv[2], password)
    elif mode == "json":
        if len(sys.argv) != 4:
            print("Usage: encrypt_office_cli.py json <json_temp> <zip_out>  (password via stdin)", file=sys.stderr)
            sys.exit(1)
        password = read_password_from_stdin()
        if not password:
            print("password (stdin) is empty", file=sys.stderr)
            sys.exit(1)
        cmd_json(sys.argv[2], sys.argv[3], password)
    else:
        print(f"Unknown mode: {mode}", file=sys.stderr)
        sys.exit(1)

    print("OK")


if __name__ == "__main__":
    main()
