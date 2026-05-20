"""Endpoints for the cross-tier Target Inventory view.

Serves the per-tier audit summary (small, committed) and the full per-record
union (large, gitignored, regenerable). The latter is streamed/paginated so
the frontend can render filtered slices without shipping the 25MB blob.
"""

from __future__ import annotations

import json
from pathlib import Path

from fastapi import APIRouter, HTTPException, Query

router = APIRouter()

DATA_ROOT = Path(__file__).resolve().parents[1] / "data"
SUMMARY_PATH = DATA_ROOT / "target_index.json"
UNION_PATH = DATA_ROOT / "target_index.json.union.jsonl"


def _load_summary() -> dict:
    if not SUMMARY_PATH.exists():
        raise HTTPException(
            status_code=503,
            detail=(
                "target_index.json not built. Run "
                "`python -m backend.scripts.target_index.audit`."
            ),
        )
    return json.loads(SUMMARY_PATH.read_text())


def _load_union() -> list[dict]:
    if not UNION_PATH.exists():
        raise HTTPException(
            status_code=503,
            detail=(
                "Per-record union not built. Run "
                "`python -m backend.scripts.target_index.audit` to regenerate "
                f"{UNION_PATH.name} (gitignored, ~25MB)."
            ),
        )
    with UNION_PATH.open() as f:
        return [json.loads(line) for line in f if line.strip()]


@router.get("/target-inventory/summary")
def get_summary():
    """The audit summary: per-tier counts + match rates."""
    return _load_summary()


@router.get("/target-inventory")
def list_targets(
    tier: str | None = Query(None, description="Filter by storage tier (db/csv/python)"),
    source_path: str | None = Query(None, description="Filter by exact source file path"),
    variable: str | None = Query(None, description="Filter by PE variable name"),
    in_db: bool | None = Query(None, description="Filter to only matched (true) or only unmatched (false)"),
    search: str | None = Query(None, description="Substring match against variable/source/notes"),
    limit: int = Query(100, ge=1, le=2000),
    offset: int = Query(0, ge=0),
):
    """Paginated listing of the full union. Each row already carries
    storage_tier / source_path / source_row / notes / signature, plus an
    `in_db` flag derived from cross-tier matching against policy_data.db."""
    union = _load_union()

    def _freeze(x):
        """Recursively convert nested lists to tuples so the signature is
        hashable (the JSONL stores constraints as list-of-lists)."""
        if isinstance(x, list):
            return tuple(_freeze(i) for i in x)
        return x

    # Build a set of DB signatures for the in_db flag.
    db_sigs = {_freeze(r["signature"]) for r in union if r.get("storage_tier") == "db"}

    def annotate(r):
        # DB rows trivially have in_db=True; otherwise check membership.
        r["in_db"] = (
            r.get("storage_tier") == "db"
            or _freeze(r["signature"]) in db_sigs
        )
        return r

    rows = [annotate(r) for r in union]

    # Filters
    if tier:
        rows = [r for r in rows if r.get("storage_tier") == tier]
    if source_path:
        rows = [r for r in rows if r.get("source_path") == source_path]
    if variable:
        rows = [r for r in rows if r.get("variable") == variable]
    if in_db is not None:
        rows = [r for r in rows if r.get("in_db") is in_db]
    if search:
        s = search.lower()
        rows = [
            r for r in rows
            if s in (r.get("variable") or "").lower()
            or s in (r.get("source_path") or "").lower()
            or s in (r.get("notes") or "").lower()
        ]

    total = len(rows)
    return {
        "items": rows[offset : offset + limit],
        "total": total,
        "offset": offset,
        "limit": limit,
    }
