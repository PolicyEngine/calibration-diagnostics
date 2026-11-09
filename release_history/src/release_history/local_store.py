"""The store layout on a local disk: the same paths the Blob store uses.

```text
<root>/release-history/<country>/<panel-id>/panel.json             written once
<root>/release-history/<country>/<panel-id>/<measurement-id>.json  immutable
<root>/release-history/<country>/<panel-id>/references.json        replaced each run
<root>/release-history/<country>/<panel-id>/timeline.json          rebuilt by finalize
```

The workflow's measure job writes here and a bun step uploads the folder, so the
Python side never holds a Blob credential. Local runs use the same layout.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from release_history.canonical import document_bytes, write_atomic

PREFIX = "release-history"
RESERVED = {"panel.json", "references.json", "timeline.json"}


class ImmutableConflict(RuntimeError):
    """An immutable document already exists with different bytes."""


def panel_dir(root: Path, country: str, panel_id: str) -> Path:
    return root / PREFIX / country / panel_id


def write_once(path: Path, document: dict[str, Any]) -> bool:
    """Write a document unless one is there; returns whether it wrote."""
    if path.exists():
        return False
    write_atomic(path, document_bytes(document))
    return True


def write_immutable(path: Path, document: dict[str, Any]) -> bool:
    """Write a document; refuse a different document at the same path."""
    data = document_bytes(document)
    if path.exists():
        if path.read_bytes() != data:
            raise ImmutableConflict(f"{path} already exists with different content")
        return False
    write_atomic(path, data)
    return True


def write_replace(path: Path, document: dict[str, Any]) -> None:
    write_atomic(path, document_bytes(document))


def read_points(root: Path, country: str, panel_id: str) -> list[dict[str, Any]]:
    folder = panel_dir(root, country, panel_id)
    if not folder.is_dir():
        return []
    points = []
    for path in sorted(folder.glob("*.json")):
        if path.name in RESERVED:
            continue
        points.append(json.loads(path.read_text(encoding="utf-8")))
    return points


def panels(root: Path, country: str) -> list[str]:
    folder = root / PREFIX / country
    if not folder.is_dir():
        return []
    return sorted(p.name for p in folder.iterdir() if (p / "panel.json").is_file())
