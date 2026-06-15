"""Populace release diagnostics.

Serves the populace-US build published on the Hugging Face dataset
``policyengine/populace-us``. The current release is resolved through the
``latest.json`` pointer at the repo root (PolicyEngine/populace#9); its
``paths`` name the ``build_manifest.json`` (gate verdicts) and
``release_manifest.json`` (artifact registry) for that release, which this
route reads live with a TTL cache.

Per-target calibration diagnostics come from ``calibration_diagnostics.json``
(PolicyEngine/populace#10) — populace's own calibration fit against its target
surface: per target the declared value, the aggregate under the design weights
(initial) and the calibrated weights (final), the relative error, and the
tolerance verdict. That artifact is large, so the deployed static snapshot
committed under ``frontend/data/populace/latest/`` is the source for target
rows; only the small manifests are fetched live.

The eCPS head-to-head comparison moved out of live populace into
``PolicyEngine/populace-benchmarks``; this view reports calibration fit, not a
populace-vs-enhanced-CPS score.
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
_LATEST_POINTER_PATH = "latest.json"

_STATIC_ROOT = Path(__file__).resolve().parents[2] / "frontend/data/populace/latest"
_STATIC_BUILD_MANIFEST = _STATIC_ROOT / "build_manifest.json"
_STATIC_RELEASE_MANIFEST = _STATIC_ROOT / "release_manifest.json"
_STATIC_CALIBRATION_DIAGNOSTICS = _STATIC_ROOT / "calibration_diagnostics.json"
_STATIC_COMPARISON_SCORECARD = _STATIC_ROOT / "comparison_scorecard.json"

_CALIBRATION_DIAGNOSTICS_PUBLIC_PATH = (
    "frontend/data/populace/latest/calibration_diagnostics.json"
)
_COMPARISON_SCORECARD_PUBLIC_PATH = (
    "frontend/data/populace/latest/comparison_scorecard.json"
)

# The live incumbent-comparison scorecard is not published yet
# (PolicyEngine/populace-benchmarks#3). Set this to the artifact URL to serve it
# live; otherwise the route serves the archived 9f1260b snapshot.
_BENCHMARKS_SCORECARD_URL = os.environ.get("POPULACE_BENCHMARKS_SCORECARD_URL")

_CACHE: dict[str, tuple[float, Any]] = {}
_TTL_SECONDS = 300

_STATE_CODE = re.compile(r"^[A-Z]{2}$")
_STATE_FIPS = re.compile(r"^US\d{2}$")


def _scrub(value: Any) -> Any:
    if isinstance(value, dict):
        return {key: _scrub(item) for key, item in value.items()}
    if isinstance(value, list):
        return [_scrub(item) for item in value]
    if isinstance(value, float) and (
        value != value or value in (float("inf"), float("-inf"))
    ):
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


def _load_live_release(snapshot_release_id: str) -> dict[str, Any]:
    try:
        pointer = _fetch_json(_hf_resolve_url(_LATEST_POINTER_PATH))
        if not isinstance(pointer, dict) or not pointer.get("release_id"):
            return {"available": False, "reason": "latest.json has no release_id."}
        release_id = str(pointer["release_id"])
        paths = pointer.get("paths") if isinstance(pointer.get("paths"), dict) else {}
        build_path = paths.get(
            "build_manifest", f"releases/{release_id}/build_manifest.json"
        )
        release_path = paths.get(
            "release_manifest", f"releases/{release_id}/release_manifest.json"
        )
        build_manifest = _fetch_json(_hf_resolve_url(build_path))
        try:
            release_manifest = _fetch_json(_hf_resolve_url(release_path))
        except Exception:
            release_manifest = {}
        return {
            "available": True,
            "source": "huggingface_live",
            "repo_id": _HF_REPO,
            "revision": _HF_REVISION,
            "release_id": release_id,
            "updated_at": pointer.get("updated_at"),
            "build_manifest": build_manifest,
            "release_manifest": release_manifest,
            "build_manifest_path": build_path,
            "release_manifest_path": release_path,
            "calibration_diagnostics_path": paths.get("calibration_diagnostics"),
        }
    except Exception as exc:
        return {"available": False, "reason": str(exc)}


def _relative_error(estimate: float | None, target: float | None) -> float | None:
    if estimate is None or target is None:
        return None
    return estimate - target if target == 0 else (estimate - target) / abs(target)


def _derive_family(name: str) -> str:
    parts = name.split("/")
    if len(parts) < 2:
        return name
    geo, second = parts[0], parts[1]
    # Per-state distribution targets ("state/AL/...") collapse to one family.
    if _STATE_CODE.match(second):
        return "state_distribution"
    # Per-state-FIPS program targets ("US01/snap-cost") collapse to the measure.
    if _STATE_FIPS.match(geo):
        return second
    return f"{geo}/{second}"


def _derive_state(name: str) -> str | None:
    parts = name.split("/")
    if len(parts) >= 2 and _STATE_CODE.match(parts[1]):
        return parts[1]
    return None


def _enrich(row: dict[str, Any]) -> dict[str, Any]:
    name = str(row.get("name", ""))
    target = row.get("target")
    initial = row.get("initial_estimate")
    final = row.get("final_estimate")
    final_rel = row.get("relative_error")
    if final_rel is None:
        final_rel = _relative_error(final, target)
    initial_rel = _relative_error(initial, target)
    abs_rel = abs(final_rel) if isinstance(final_rel, (int, float)) else None
    improvement = (
        abs(initial_rel) - abs(final_rel)
        if isinstance(initial_rel, (int, float)) and isinstance(final_rel, (int, float))
        else None
    )
    direction = None
    if isinstance(final_rel, (int, float)):
        direction = "over" if final_rel > 0 else "under" if final_rel < 0 else "exact"
    return {
        **row,
        "family": _derive_family(name),
        "state": _derive_state(name),
        "initial_relative_error": initial_rel,
        "abs_relative_error": abs_rel,
        "improvement": improvement,
        "direction": direction,
    }


def _family_fit(rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
    groups: dict[str, list[dict[str, Any]]] = {}
    for row in rows:
        groups.setdefault(str(row.get("family", "")), []).append(row)
    out = []
    for family, members in groups.items():
        abs_errors = [
            r["abs_relative_error"]
            for r in members
            if isinstance(r.get("abs_relative_error"), (int, float))
        ]
        out.append(
            {
                "family": family,
                "n_targets": len(members),
                "within_tolerance": sum(
                    1 for r in members if r.get("within_tolerance") is True
                ),
                "within_10pct": sum(
                    1
                    for r in members
                    if isinstance(r.get("abs_relative_error"), (int, float))
                    and r["abs_relative_error"] <= 0.1
                ),
                "mean_abs_relative_error": (
                    sum(abs_errors) / len(abs_errors) if abs_errors else None
                ),
            }
        )
    return sorted(out, key=lambda f: f["n_targets"], reverse=True)


def _calibration_summary(
    payload: dict[str, Any], rows: list[dict[str, Any]]
) -> dict[str, Any]:
    return {
        "available": True,
        "path": _CALIBRATION_DIAGNOSTICS_PUBLIC_PATH,
        "release_id": payload.get("release_id"),
        "schema_version": payload.get("schema_version"),
        "weight_entity": payload.get("weight_entity"),
        "options": payload.get("options") or {},
        "l0_lambda": payload.get("l0_lambda"),
        "n_nonzero": payload.get("n_nonzero"),
        "n_records": payload.get("n_records"),
        "initial_loss": payload.get("initial_loss"),
        "final_loss": payload.get("final_loss"),
        "fraction_within_10pct": payload.get("fraction_within_10pct"),
        "loss_trajectory": payload.get("loss_trajectory") or [],
        "skipped": payload.get("skipped") or [],
        "total_targets": len(rows),
        "within_tolerance_count": sum(
            1 for r in rows if r.get("within_tolerance") is True
        ),
        "family_fit": _family_fit(rows),
    }


@router.get("/populace")
def populace_overview() -> dict[str, Any]:
    static_build = _load_static(_STATIC_BUILD_MANIFEST)
    static_release = _load_static(_STATIC_RELEASE_MANIFEST)
    payload = _load_static(_STATIC_CALIBRATION_DIAGNOSTICS)
    rows = [_enrich(row) for row in (payload.get("targets") or [])]
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

    calibration = _calibration_summary(payload, rows)

    def with_abs(row: dict[str, Any]) -> bool:
        return isinstance(row.get("abs_relative_error"), (int, float))

    worst_fit = sorted(
        (r for r in rows if with_abs(r)),
        key=lambda r: r["abs_relative_error"],
        reverse=True,
    )[:15]
    biggest_improvements = sorted(
        (r for r in rows if isinstance(r.get("improvement"), (int, float))),
        key=lambda r: r["improvement"],
        reverse=True,
    )[:15]

    def artifact(name: str, live_path_key: str, static_path: str):
        live_path = live.get(live_path_key)
        return {
            "name": name,
            "path": str(live_path) if live_available and live_path else static_path,
            "url": (
                _hf_resolve_url(str(live_path))
                if live_available and live_path
                else "deployed-static-snapshot"
            ),
        }

    return _scrub(
        {
            "source_repo": _HF_REPO,
            "repo_type": "dataset",
            "revision": _HF_REVISION,
            "source": "huggingface_live"
            if live_available
            else "deployed_static_snapshot",
            "live_unavailable_reason": None if live_available else live.get("reason"),
            "release_id": release_id,
            "snapshot_release_id": snapshot_release_id,
            "updated_at": live.get("updated_at") if live_available else None,
            "source_artifacts": [
                {
                    "name": "latest_pointer",
                    "path": _LATEST_POINTER_PATH,
                    "url": (
                        _hf_resolve_url(_LATEST_POINTER_PATH)
                        if live_available
                        else "deployed-static-snapshot"
                    ),
                },
                artifact(
                    "build_manifest",
                    "build_manifest_path",
                    "frontend/data/populace/latest/build_manifest.json",
                ),
                artifact(
                    "release_manifest",
                    "release_manifest_path",
                    "frontend/data/populace/latest/release_manifest.json",
                ),
                artifact(
                    "calibration_diagnostics",
                    "calibration_diagnostics_path",
                    _CALIBRATION_DIAGNOSTICS_PUBLIC_PATH,
                ),
            ],
            "limitations": [
                "Build and release manifests are read live from the "
                "policyengine/populace-us Hugging Face dataset via latest.json; "
                "per-target calibration diagnostics come from a deployed static "
                "snapshot of calibration_diagnostics.json.",
                "The eCPS head-to-head comparison moved out of live populace into "
                "PolicyEngine/populace-benchmarks, so this view reports populace's "
                "calibration fit against its own target surface, not a "
                "populace-vs-enhanced-CPS score.",
                "The published loss trajectory for this release was reconstructed "
                "from saved scalars (the historical build did not store the full "
                "epoch trace), so the convergence curve is coarse.",
            ],
            "calibration_snapshot_stale": release_id
            != str(payload.get("release_id", snapshot_release_id)),
            "build_manifest": build_manifest,
            "release_manifest": release_manifest,
            "gates": build_manifest.get("gates") or {},
            "calibration": calibration,
            "highlights": {
                "worst_fit": worst_fit,
                "biggest_improvements": biggest_improvements,
            },
        }
    )


def _matches_search(row: dict[str, Any], search: str) -> bool:
    haystack = " ".join(
        str(row.get(key))
        for key in ("name", "family", "state")
        if row.get(key) is not None
    ).lower()
    return search.lower() in haystack


@router.get("/populace/target-diagnostics")
def populace_target_diagnostics(
    limit: int = Query(100, ge=1, le=500),
    offset: int = Query(0, ge=0),
    family: str | None = None,
    state: str | None = None,
    direction: str | None = None,
    within_tolerance: str | None = None,
    search: str | None = None,
    sort_by: str | None = None,
    sort_dir: str = "desc",
) -> dict[str, Any]:
    payload = _load_static(_STATIC_CALIBRATION_DIAGNOSTICS)
    rows = [_enrich(row) for row in (payload.get("targets") or [])]
    families = sorted({str(row.get("family", "")) for row in rows})

    within: bool | None = None
    if within_tolerance is not None and within_tolerance != "":
        within = within_tolerance.lower() in ("1", "true", "yes")

    filtered = rows
    if family:
        filtered = [r for r in filtered if r.get("family") == family]
    if state:
        filtered = [r for r in filtered if r.get("state") == state]
    if direction:
        filtered = [r for r in filtered if r.get("direction") == direction]
    if within is not None:
        filtered = [r for r in filtered if r.get("within_tolerance") is within]
    if search and search.strip():
        filtered = [r for r in filtered if _matches_search(r, search.strip())]

    sort_key = sort_by or "abs_relative_error"
    descending = sort_dir != "asc"
    present = [r for r in filtered if r.get(sort_key) is not None]
    missing = [r for r in filtered if r.get(sort_key) is None]

    def key_fn(row: dict[str, Any]):
        value = row.get(sort_key)
        if isinstance(value, bool) or not isinstance(value, (int, float)):
            return (1, 0.0, str(value))
        return (0, float(value), "")

    filtered = sorted(present, key=key_fn, reverse=descending) + missing

    page = filtered[offset : offset + limit]
    return _scrub(
        {
            "available": True,
            "path": _CALIBRATION_DIAGNOSTICS_PUBLIC_PATH,
            "release_id": payload.get("release_id"),
            "schema_version": payload.get("schema_version"),
            "metric": "relative_error",
            "families": families,
            "summary": {
                "total_targets": len(rows),
                "within_tolerance_count": sum(
                    1 for r in rows if r.get("within_tolerance") is True
                ),
                "fraction_within_10pct": payload.get("fraction_within_10pct"),
            },
            "total_targets": len(rows),
            "filtered_total": len(filtered),
            "returned": len(page),
            "limit": limit,
            "offset": offset,
            "has_next": offset + limit < len(filtered),
            "display_limit": limit,
            "filters": {
                "family": family,
                "state": state,
                "direction": direction,
                "within_tolerance": within,
                "search": search,
                "sort_by": sort_key,
                "sort_dir": sort_dir,
            },
            "targets": page,
        }
    )


def _num(value: Any) -> float | None:
    return value if isinstance(value, (int, float)) and not isinstance(value, bool) else None


def _normalize_comparison_scorecard(raw: dict[str, Any]) -> dict[str, Any]:
    """Flatten an incumbent-comparison scorecard to the shared shape.

    The archived ``sound_ecps_replacement_comparison.json`` splits the clean
    win/loss block (``target_diagnostics_summary``) from the refit/loss scalars
    (``summary``); the proposed benchmarks scorecard
    (PolicyEngine/populace-benchmarks#3) is a single flat ``summary``. Read both.
    """
    summary = raw.get("summary") if isinstance(raw.get("summary"), dict) else {}
    td = (
        raw.get("target_diagnostics_summary")
        if isinstance(raw.get("target_diagnostics_summary"), dict)
        else {}
    )

    def pick(*keys: str) -> float | None:
        # First key wins, across both sources: the kept-target ``n_targets``
        # (target_diagnostics_summary) takes precedence over the pre-drop
        # ``n_targets_total`` (summary), so it matches the win/loss/tie counts.
        for key in keys:
            for source in (td, summary):
                if key in source:
                    value = _num(source[key])
                    if value is not None:
                        return value
        return None

    flat = {
        "candidate_loss": pick("candidate_loss", "candidate_enhanced_cps_native_loss"),
        "baseline_loss": pick("baseline_loss", "baseline_enhanced_cps_native_loss"),
        "loss_delta": pick("loss_delta", "enhanced_cps_native_loss_delta"),
        "candidate_holdout_loss": pick("candidate_holdout_loss"),
        "baseline_holdout_loss": pick("baseline_holdout_loss"),
        "candidate_train_loss": pick("candidate_train_loss"),
        "baseline_train_loss": pick("baseline_train_loss"),
        "candidate_unweighted_msre": pick("candidate_unweighted_msre"),
        "baseline_unweighted_msre": pick("baseline_unweighted_msre"),
        "candidate_wins": pick("candidate_wins"),
        "baseline_wins": pick("baseline_wins"),
        "ties": pick("ties"),
        "n_targets": pick("n_targets", "n_targets_total"),
        "holdout_targets": pick("holdout_targets"),
        "train_targets": pick("train_targets"),
        "candidate_beats_baseline": (
            summary.get("candidate_beats_baseline")
            if isinstance(summary.get("candidate_beats_baseline"), bool)
            else None
        ),
        # The archived summary's ``matched_household_count`` is a stray bool;
        # the real matched count is the per-dataset household count. ``pick``
        # skips non-numeric values, so the count keys are the real source.
        "matched_household_count": pick(
            "matched_household_count",
            "candidate_household_count",
            "baseline_household_count",
        ),
    }
    protocol = raw.get("protocol")
    if not isinstance(protocol, str) and flat["matched_household_count"] is not None:
        protocol = (
            f"Matched {int(flat['matched_household_count']):,} households, "
            f"symmetric refit, {flat['holdout_targets']}-target holdout."
        )
    return {
        "release_id": raw.get("candidate_release_id") or raw.get("release_id"),
        "incumbent_manifest": raw.get("incumbent_manifest", "pinned-production-ecps-2024"),
        "period": _num(raw.get("period")),
        "baseline_label": raw.get("baseline_label", "enhanced_cps"),
        "candidate_label": raw.get("candidate_label", "populace"),
        "protocol": protocol if isinstance(protocol, str) else None,
        "summary": flat,
        "family_breakdown": raw.get("family_breakdown") or [],
        "top_improvements": raw.get("top_improvements") or [],
        "top_regressions": raw.get("top_regressions") or [],
        "gates": raw.get("gates") or {},
    }


@router.get("/populace/comparison")
def populace_comparison() -> dict[str, Any]:
    snapshot = _normalize_comparison_scorecard(_load_static(_STATIC_COMPARISON_SCORECARD))
    source = "deployed_static_snapshot"
    path = _COMPARISON_SCORECARD_PUBLIC_PATH
    live_error = None

    if _BENCHMARKS_SCORECARD_URL:
        try:
            live = _normalize_comparison_scorecard(_fetch_json(_BENCHMARKS_SCORECARD_URL))
            snapshot = live
            source = "populace_benchmarks_live"
            path = _BENCHMARKS_SCORECARD_URL
        except Exception as exc:
            live_error = str(exc)

    archived = source != "populace_benchmarks_live"
    return _scrub(
        {
            "available": True,
            "source": source,
            "path": path,
            "archived": archived,
            "live_scorecard_configured": bool(_BENCHMARKS_SCORECARD_URL),
            "live_scorecard_error": live_error,
            **snapshot,
            "notes": [
                "Populace (candidate) is scored against the enhanced CPS "
                "(incumbent) with a matched-household, symmetric-refit, "
                "held-out-target protocol.",
                (
                    "This is the archived scorecard for release "
                    "populace-us-2024-9f1260b-20260611. The live incumbent "
                    "comparison is not published as a machine-readable artifact "
                    "yet (PolicyEngine/populace-benchmarks#3); set "
                    "POPULACE_BENCHMARKS_SCORECARD_URL to serve it live."
                    if archived
                    else "Served live from the configured populace-benchmarks "
                    "scorecard."
                ),
                "The eCPS comparison is benchmark-harness material and "
                "intentionally lives outside live populace "
                "(PolicyEngine/populace#37); the live calibration-fit view is "
                "the populace release summary.",
            ],
        }
    )
