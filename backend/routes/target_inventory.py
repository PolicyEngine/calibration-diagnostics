"""Endpoints for the cross-tier Target Inventory view.

Serves the per-tier audit summary (small, committed) and the full per-record
union (large, gitignored, regenerable). The latter is streamed/paginated so
the frontend can render filtered slices without shipping the 25MB blob.
"""

from __future__ import annotations

import json
import re
from pathlib import Path

import pandas as pd
from fastapi import APIRouter, Depends, HTTPException, Query

from backend.state import AppState, get_state

router = APIRouter()


_GEO_VARS = {"state_fips", "congressional_district_geoid", "ucgid_str"}


def _norm_geo_id(val) -> str:
    """Mirror schema._norm_geo_id so signatures match across tiers."""
    if val is None or val == "" or pd.isna(val):
        return ""
    s = str(val)
    try:
        f = float(s)
    except (TypeError, ValueError):
        return s
    import math
    if not math.isfinite(f):
        return s
    return str(int(f))


def _signature_for_enriched_row(row, target_name_constraints=None) -> tuple:
    """Mirror TargetRecord.signature() so loaded-run targets sig-match the
    inventory rows. Pulls constraints from the row's parsed target_name when
    needed, mirroring the same logic used by the DB-load path."""
    variable = str(row.get("variable", ""))
    geo_level = (row.get("geo_level") or "national")
    geo_id = _norm_geo_id(row.get("geographic_id"))
    period = int(row.get("period") or 0)
    # Reuse already-parsed constraints if provided; else infer empty.
    cons = tuple(sorted(
        (c[0], c[1], _norm_geo_id(c[2]))
        for c in (target_name_constraints or [])
    ))
    return (variable, geo_level, geo_id, period, cons)

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


def _build_estimate_lookup(state: AppState) -> dict[int, dict]:
    """Map target_id → {estimate, rel_error, target_idx} from the loaded run.

    The DB-tier inventory rows store the DB target_id in their source_row
    ("target_id=N/stratum_id=M"), so joining by target_id is reliable —
    no fragile signature reconstruction needed.
    """
    df = state.targets_enriched
    if df is None or df.empty or "target_id" not in df.columns:
        return {}
    lookup: dict[int, dict] = {}
    for idx, row in df.iterrows():
        tid = row.get("target_id")
        if pd.isna(tid):
            continue
        est = row.get("estimate")
        rel_err = row.get("rel_error")
        lookup[int(tid)] = {
            "estimate": float(est) if pd.notna(est) else None,
            "rel_error": float(rel_err) if pd.notna(rel_err) else None,
            "target_idx": int(idx),
        }
    return lookup


_TARGET_ID_RE = re.compile(r"target_id=(\d+)")


def _target_id_from_source_row(source_row: str) -> int | None:
    """Inventory rows from the DB tier have source_row = 'target_id=N/stratum_id=M'.
    Extract N for the join."""
    if not source_row:
        return None
    m = _TARGET_ID_RE.search(source_row)
    return int(m.group(1)) if m else None


@router.get("/target-inventory")
def list_targets(
    tier: str | None = Query(None, description="Filter by storage tier (db/csv/python)"),
    source_path: str | None = Query(None, description="Filter by exact source file path"),
    variable: str | None = Query(None, description="Filter by PE variable name"),
    in_db: bool | None = Query(None, description="Filter to only matched (true) or only unmatched (false)"),
    search: str | None = Query(None, description="Substring match against variable/source/notes"),
    limit: int = Query(100, ge=1, le=2000),
    offset: int = Query(0, ge=0),
    state: AppState = Depends(get_state),
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

    # Build target_id → {estimate, rel_error, target_idx} from the loaded run.
    # DB-tier inventory rows carry target_id in their source_row; that's the
    # cleanest join key. For non-DB rows we'd need a more elaborate mapping;
    # those stay '—' here (the audit page already shows the gap).
    estimate_lookup = _build_estimate_lookup(state)

    def annotate(r):
        sig = _freeze(r["signature"])
        # DB rows trivially have in_db=True; otherwise check membership.
        r["in_db"] = r.get("storage_tier") == "db" or sig in db_sigs

        r["estimate"] = None
        r["rel_error"] = None
        r["target_idx"] = None
        # Join PE aggregates onto DB-tier rows via target_id.
        if r.get("storage_tier") == "db":
            tid = _target_id_from_source_row(r.get("source_row") or "")
            if tid is not None and tid in estimate_lookup:
                hit = estimate_lookup[tid]
                r["estimate"] = hit["estimate"]
                r["rel_error"] = hit["rel_error"]
                r["target_idx"] = hit["target_idx"]
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
