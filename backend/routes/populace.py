"""Populace release diagnostics.

Serves the populace-US build published on the Hugging Face dataset
``policyengine/populace-us``. Each release under ``releases/<build_id>/``
ships a ``build_manifest.json`` (gate verdicts + score vs the enhanced
CPS), a ``release_manifest.json`` (artifact registry + compatibility
matrix), and a ``sound_ecps_replacement_comparison.json`` with full
per-target diagnostics.

The small manifests are fetched live with a TTL cache. The per-target
comparison artifact is ~3.7 MB, so the deployed static snapshot committed
under ``frontend/data/populace/latest/`` is the default source for target
rows; the live artifact is fetched only when the snapshot's release does
not match the live release and ``POPULACE_FETCH_LIVE_COMPARISON`` is set.
"""

from __future__ import annotations

import json
import logging
import os
import re
import time
from pathlib import Path
from typing import Any

from fastapi import APIRouter, HTTPException, Query

logger = logging.getLogger(__name__)
router = APIRouter()

_HF_REPO = os.environ.get("POPULACE_HF_REPO", "policyengine/populace-us")
_HF_REVISION = os.environ.get("POPULACE_HF_REVISION", "main")
_HF_API = "https://huggingface.co/api/datasets"

_STATIC_ROOT = Path(__file__).resolve().parents[2] / "frontend/data/populace/latest"
_STATIC_BUILD_MANIFEST = _STATIC_ROOT / "build_manifest.json"
_STATIC_RELEASE_MANIFEST = _STATIC_ROOT / "release_manifest.json"
_STATIC_COMPARISON_SUMMARY = _STATIC_ROOT / "comparison_summary.json"
_STATIC_TARGET_DIAGNOSTICS = _STATIC_ROOT / "target_diagnostics.json"

_CACHE: dict[str, tuple[float, Any]] = {}
_TTL_SECONDS = 300


def _scrub(value: Any) -> Any:
    if isinstance(value, dict):
        return {key: _scrub(item) for key, item in value.items()}
    if isinstance(value, list):
        return [_scrub(item) for item in value]
    if isinstance(value, float) and (value != value or value in (float("inf"), float("-inf"))):
        return None
    return value


def _fetch_json(url: str) -> Any:
    cached = _CACHE.get(url)
    if cached and time.time() - cached[0] < _TTL_SECONDS:
        return cached[1]
    import urllib.request

    logger.info("Fetching populace artifact: %s", url)
    with urllib.request.urlopen(url, timeout=30) as resp:
        body = resp.read().decode("utf-8")
    data = json.loads(body)
    _CACHE[url] = (time.time(), data)
    return data


def _hf_resolve_url(path: str) -> str:
    return f"https://huggingface.co/datasets/{_HF_REPO}/resolve/{_HF_REVISION}/{path}"


def _load_static(path: Path) -> dict[str, Any]:
    try:
        return json.loads(path.read_text())
    except Exception as exc:
        raise HTTPException(
            status_code=500,
            detail=f"Deployed populace snapshot missing or unreadable at {path}: {exc}",
        )


def _list_releases() -> list[dict[str, Any]]:
    tree = _fetch_json(f"{_HF_API}/{_HF_REPO}/tree/{_HF_REVISION}/releases?recursive=true")
    releases: dict[str, list[str]] = {}
    if not isinstance(tree, list):
        return []
    for entry in tree:
        if not isinstance(entry, dict) or entry.get("type") != "file":
            continue
        match = re.match(r"^releases/([^/]+)/(.+)$", str(entry.get("path", "")))
        if not match:
            continue
        releases.setdefault(match.group(1), []).append(match.group(2))
    return [
        {"release_id": release_id, "files": sorted(files)}
        for release_id, files in sorted(releases.items())
    ]


def _load_live_release(snapshot_release_id: str) -> dict[str, Any]:
    try:
        releases = _list_releases()
        complete = [r for r in releases if "build_manifest.json" in r["files"]]
        live = next(
            (r for r in complete if r["release_id"] == snapshot_release_id),
            complete[-1] if complete else None,
        )
        if live is None:
            return {
                "available": False,
                "reason": "No release with a build_manifest.json found on Hugging Face.",
                "releases": releases,
            }
        prefix = f"releases/{live['release_id']}"
        build_manifest = _fetch_json(_hf_resolve_url(f"{prefix}/build_manifest.json"))
        release_manifest = (
            _fetch_json(_hf_resolve_url(f"{prefix}/release_manifest.json"))
            if "release_manifest.json" in live["files"]
            else {}
        )
        return {
            "available": True,
            "source": "huggingface_live",
            "repo_id": _HF_REPO,
            "revision": _HF_REVISION,
            "release_id": live["release_id"],
            "releases": releases,
            "build_manifest": build_manifest,
            "release_manifest": release_manifest,
            "comparison_url": (
                _hf_resolve_url(f"{prefix}/sound_ecps_replacement_comparison.json")
                if "sound_ecps_replacement_comparison.json" in live["files"]
                else None
            ),
        }
    except Exception as exc:
        return {"available": False, "reason": str(exc)}


@router.get("/populace")
def populace_overview() -> dict[str, Any]:
    static_build = _load_static(_STATIC_BUILD_MANIFEST)
    static_release = _load_static(_STATIC_RELEASE_MANIFEST)
    comparison = _load_static(_STATIC_COMPARISON_SUMMARY)
    snapshot_release_id = str(static_build.get("build_id", ""))

    live = _load_live_release(snapshot_release_id)
    live_available = live.get("available") is True
    build_manifest = live["build_manifest"] if live_available else static_build
    release_manifest = (
        live["release_manifest"]
        if live_available and live.get("release_manifest")
        else static_release
    )
    release_id = str(live["release_id"]) if live_available else snapshot_release_id
    releases = live.get("releases") or []

    target_diagnostics = _load_static(_STATIC_TARGET_DIAGNOSTICS)
    targets = target_diagnostics.get("targets") or []

    gates = build_manifest.get("gates") or {}
    score = build_manifest.get("score_vs_enhanced_cps") or {}

    return _scrub(
        {
            "source_repo": _HF_REPO,
            "repo_type": "dataset",
            "revision": _HF_REVISION,
            "source": "huggingface_live" if live_available else "deployed_static_snapshot",
            "live_unavailable_reason": None if live_available else live.get("reason"),
            "release_id": release_id,
            "snapshot_release_id": snapshot_release_id,
            "releases": releases,
            "source_artifacts": [
                {
                    "name": "build_manifest",
                    "path": f"releases/{release_id}/build_manifest.json",
                    "url": (
                        _hf_resolve_url(f"releases/{release_id}/build_manifest.json")
                        if live_available
                        else "deployed-static-snapshot"
                    ),
                },
                {
                    "name": "release_manifest",
                    "path": f"releases/{release_id}/release_manifest.json",
                    "url": (
                        _hf_resolve_url(f"releases/{release_id}/release_manifest.json")
                        if live_available
                        else "deployed-static-snapshot"
                    ),
                },
                {
                    "name": "sound_ecps_replacement_comparison",
                    "path": "frontend/data/populace/latest/comparison_summary.json",
                    "url": live.get("comparison_url") or "deployed-static-snapshot",
                },
                {
                    "name": "target_diagnostics",
                    "path": "frontend/data/populace/latest/target_diagnostics.json",
                    "url": "deployed-static-snapshot",
                },
            ],
            "limitations": [
                "Build and release manifests are read live from the "
                "policyengine/populace-us Hugging Face dataset when reachable; "
                "per-target diagnostics come from a deployed static snapshot of "
                "sound_ecps_replacement_comparison.json.",
                "populace does not yet publish a latest.json pointer, so the live "
                "release is resolved by listing the releases/ tree and picking the "
                "lexicographically latest complete release "
                "(PolicyEngine/populace#9).",
                "Calibration internals (loss trajectory, skipped targets, "
                "per-record L0 gates) are computed by populace-calibrate but not "
                "published, so the dashboard cannot show convergence or skip "
                "reasons yet (PolicyEngine/populace#10).",
            ],
            "comparison_snapshot_stale": release_id
            != str(comparison.get("release_id", snapshot_release_id)),
            "build_manifest": build_manifest,
            "release_manifest": release_manifest,
            "gates": gates,
            "score_vs_enhanced_cps": score,
            "comparison": {"available": True, **comparison},
            "target_diagnostics": {
                "available": True,
                "path": "frontend/data/populace/latest/target_diagnostics.json",
                "release_id": target_diagnostics.get("release_id"),
                "schema_version": target_diagnostics.get("schema_version"),
                "metric": target_diagnostics.get("metric"),
                "period": target_diagnostics.get("period"),
                "baseline_label": "enhanced_cps",
                "candidate_label": "populace",
                "summary": target_diagnostics.get("summary") or {},
                "total_targets": len(targets),
                "display_limit": 100,
                "targets": targets[:100],
            },
        }
    )


def _matches_search(row: dict[str, Any], search: str) -> bool:
    haystack = " ".join(
        str(row.get(key))
        for key in ("target_name", "family", "split", "winner")
        if row.get(key) is not None
    ).lower()
    return search.lower() in haystack


@router.get("/populace/target-diagnostics")
def populace_target_diagnostics(
    limit: int = Query(100, ge=1, le=500),
    offset: int = Query(0, ge=0),
    family: str | None = None,
    split: str | None = None,
    winner: str | None = None,
    search: str | None = None,
    sort_by: str | None = None,
    sort_dir: str = "asc",
) -> dict[str, Any]:
    payload = _load_static(_STATIC_TARGET_DIAGNOSTICS)
    rows: list[dict[str, Any]] = list(payload.get("targets") or [])
    families = sorted({str(row.get("family", "")) for row in rows})

    filtered = rows
    if family:
        filtered = [row for row in filtered if row.get("family") == family]
    if split:
        filtered = [row for row in filtered if row.get("split") == split]
    if winner:
        filtered = [row for row in filtered if row.get("winner") == winner]
    if search and search.strip():
        filtered = [row for row in filtered if _matches_search(row, search.strip())]
    if sort_by:
        descending = sort_dir == "desc"
        present = [row for row in filtered if row.get(sort_by) is not None]
        missing = [row for row in filtered if row.get(sort_by) is None]

        def sort_key(row: dict[str, Any]):
            value = row.get(sort_by)
            if isinstance(value, bool) or not isinstance(value, (int, float)):
                return (1, 0.0, str(value))
            return (0, float(value), "")

        # None values sort last regardless of direction.
        filtered = sorted(present, key=sort_key, reverse=descending) + missing

    page = filtered[offset : offset + limit]
    return _scrub(
        {
            "available": True,
            "path": "frontend/data/populace/latest/target_diagnostics.json",
            "release_id": payload.get("release_id"),
            "schema_version": payload.get("schema_version"),
            "metric": payload.get("metric"),
            "period": payload.get("period"),
            "baseline_label": "enhanced_cps",
            "candidate_label": "populace",
            "summary": payload.get("summary") or {},
            "total_targets": len(rows),
            "families": families,
            "filtered_total": len(filtered),
            "returned": len(page),
            "limit": limit,
            "offset": offset,
            "has_next": offset + limit < len(filtered),
            "filters": {
                "family": family,
                "split": split,
                "winner": winner,
                "search": search,
                "sort_by": sort_by,
                "sort_dir": sort_dir if sort_by else None,
            },
            "targets": page,
        }
    )
