#!/usr/bin/env python3
"""File encryption helper for LoTT exports.

Subcommands
-----------
office <file_path> <password>
    Password-protect a DOCX or XLSX file in-place using OOXML encryption
    (requires msoffcrypto-tool).

json <json_temp_path> <output_zip_path> <password>
    Wrap a JSON file in an AES-256 encrypted ZIP and write to output_zip_path
    (requires pyzipper). The input temp file is NOT deleted here; the caller
    is responsible for cleanup.
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


def main() -> None:
    if len(sys.argv) < 2:
        print("Usage: encrypt_office_cli.py <office|json> ...", file=sys.stderr)
        sys.exit(1)

    mode = sys.argv[1]
    if mode == "office":
        if len(sys.argv) != 4:
            print("Usage: encrypt_office_cli.py office <file_path> <password>", file=sys.stderr)
            sys.exit(1)
        cmd_office(sys.argv[2], sys.argv[3])
    elif mode == "json":
        if len(sys.argv) != 5:
            print("Usage: encrypt_office_cli.py json <json_temp> <zip_out> <password>", file=sys.stderr)
            sys.exit(1)
        cmd_json(sys.argv[2], sys.argv[3], sys.argv[4])
    else:
        print(f"Unknown mode: {mode}", file=sys.stderr)
        sys.exit(1)

    print("OK")


if __name__ == "__main__":
    main()
