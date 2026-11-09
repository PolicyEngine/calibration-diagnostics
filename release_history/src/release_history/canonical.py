"""Canonical JSON digests and file hashing.

The digest convention is the one `frontend/scripts/hosted_release.py` uses for
manifests (sorted keys, compact separators, ASCII escapes), so an id computed
here can be recomputed by any other reader of the same document.
"""

from __future__ import annotations

import hashlib
import json
import os
import tempfile
from pathlib import Path
from typing import Any

DIGEST_ALGORITHM = "sha256-json-sort-keys-compact-ascii-escaped-utf8"


def canonical_json(value: Any) -> str:
    """Serialize semantic JSON deterministically. NaN and infinity are refused."""
    return json.dumps(
        value, sort_keys=True, separators=(",", ":"), ensure_ascii=True, allow_nan=False
    )


def json_sha256(value: Any) -> str:
    """The sha256 of a value's canonical JSON."""
    return hashlib.sha256(canonical_json(value).encode("utf-8")).hexdigest()


def file_sha256(path: str | os.PathLike[str]) -> str:
    """Hash a file's bytes in 1 MiB chunks."""
    digest = hashlib.sha256()
    with open(path, "rb") as stream:
        for chunk in iter(lambda: stream.read(1 << 20), b""):
            digest.update(chunk)
    return digest.hexdigest()


def document_bytes(value: Any) -> bytes:
    """The stored form of a document: readable, sorted, newline-terminated."""
    text = json.dumps(value, sort_keys=True, indent=2, ensure_ascii=False, allow_nan=False)
    return (text + "\n").encode("utf-8")


def write_atomic(path: str | os.PathLike[str], data: bytes) -> None:
    """Write bytes to a path through a temporary file in the same directory."""
    target = Path(path)
    target.parent.mkdir(parents=True, exist_ok=True)
    handle, temporary = tempfile.mkstemp(dir=target.parent, prefix=f".{target.name}.")
    try:
        with os.fdopen(handle, "wb") as stream:
            stream.write(data)
        os.replace(temporary, target)
    except BaseException:
        Path(temporary).unlink(missing_ok=True)
        raise
