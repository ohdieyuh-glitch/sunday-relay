"""Artifact digests: the bundle analysed is the bundle GitHub recorded, or the analysis says so."""

from __future__ import annotations

import hashlib
import os
from typing import Any


def sha256_file(path: str) -> str:
    digest = hashlib.sha256()
    with open(path, "rb") as handle:
        for chunk in iter(lambda: handle.read(1 << 16), b""):
            digest.update(chunk)
    return digest.hexdigest()


def verify_artifact(path: str, expected: str) -> dict[str, Any]:
    """Compare a downloaded artifact with the digest GitHub reported (``sha256:<hex>`` or ``<hex>``)."""
    expected_hex = expected.split(":", 1)[1] if expected.startswith("sha256:") else expected
    if not os.path.isfile(path):
        return {"path": path, "verdict": "MISSING", "expected": expected_hex}
    actual = sha256_file(path)
    return {"path": path, "verdict": "MATCH" if actual == expected_hex.lower() else "MISMATCH",
            "expected": expected_hex.lower(), "actual": actual}


def verify_sums(directory: str, sums_file: str = "SHA256SUMS") -> dict[str, Any]:
    """Check every ``<hex>  <name>`` line of a sums file; a listed file that is absent is a failure."""
    path = os.path.join(directory, sums_file)
    if not os.path.isfile(path):
        return {"verdict": "NO_SUMS_FILE", "files": []}
    files = []
    with open(path, "r", encoding="utf-8") as handle:
        for line in handle:
            line = line.strip()
            if not line:
                continue
            expected, _, name = line.partition("  ")
            name = name.lstrip("*")
            full = os.path.join(directory, name)
            if not os.path.isfile(full):
                files.append({"file": name, "verdict": "MISSING"})
            else:
                files.append({"file": name, "verdict": "MATCH" if sha256_file(full) == expected.lower() else "MISMATCH"})
    verdict = "MATCH" if files and all(f["verdict"] == "MATCH" for f in files) else "MISMATCH"
    return {"verdict": verdict, "files": files}
