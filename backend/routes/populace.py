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

# The incumbent comparison lives in PolicyEngine/populace-benchmarks
# (PolicyEngine/populace#37). By default the route resolves that repo's
# latest.json pointer (PolicyEngine/populace-benchmarks#3) and serves the
# scorecard it names, falling back to the committed archived snapshot until the
# artifact is reachable. POPULACE_BENCHMARKS_POINTER_URL overrides the pointer;
# POPULACE_BENCHMARKS_SCORECARD_URL points straight at a scorecard.
_BENCHMARKS_RAW_BASE = (
    "https://raw.githubusercontent.com/PolicyEngine/populace-benchmarks/main"
)
_DEFAULT_POINTER_URL = (
    f"{_BENCHMARKS_RAW_BASE}/benchmarks/us/incumbent-comparison/latest.json"
)
_BENCHMARKS_POINTER_URL = (
    os.environ.get("POPULACE_BENCHMARKS_POINTER_URL") or _DEFAULT_POINTER_URL
)
_BENCHMARKS_SCORECARD_URL = os.environ.get("POPULACE_BENCHMARKS_SCORECARD_URL")

_CACHE: dict[str, tuple[float, Any]] = {}
_TTL_SECONDS = 300

_STATE_CODE = re.compile(r"^[A-Z]{2}$")
_STATE_FIPS = re.compile(r"^US\d{2}$")

# Canonical name decomposition, matching populace.dev's parse_target so both
# consumers agree. The constraint registry knows these fields; the published
# surface only carries the slash-joined name, so we reconstruct them.
_FIPS_TO_ABBR = {
    "01": "AL", "02": "AK", "04": "AZ", "05": "AR", "06": "CA", "08": "CO",
    "09": "CT", "10": "DE", "11": "DC", "12": "FL", "13": "GA", "15": "HI",
    "16": "ID", "17": "IL", "18": "IN", "19": "IA", "20": "KS", "21": "KY",
    "22": "LA", "23": "ME", "24": "MD", "25": "MA", "26": "MI", "27": "MN",
    "28": "MS", "29": "MO", "30": "MT", "31": "NE", "32": "NV", "33": "NH",
    "34": "NJ", "35": "NM", "36": "NY", "37": "NC", "38": "ND", "39": "OH",
    "40": "OK", "41": "OR", "42": "PA", "44": "RI", "45": "SC", "46": "SD",
    "47": "TN", "48": "TX", "49": "UT", "50": "VT", "51": "VA", "53": "WA",
    "54": "WV", "55": "WI", "56": "WY",
}
_STATE_ABBRS = {
    "AL", "AK", "AZ", "AR", "CA", "CO", "CT", "DE", "DC", "FL", "GA", "HI", "ID",
    "IL", "IN", "IA", "KS", "KY", "LA", "ME", "MD", "MA", "MI", "MN", "MS", "MO",
    "MT", "NE", "NV", "NH", "NJ", "NM", "NY", "NC", "ND", "OH", "OK", "OR", "PA",
    "RI", "SC", "SD", "TN", "TX", "UT", "VT", "VA", "WA", "WV", "WI", "WY", "US",
}


def _parse_target(name: str) -> dict[str, str]:
    parts = name.split("/")
    p0 = parts[0] if parts else ""
    fips = re.match(r"^US(\d{2})$", p0)
    if fips:
        return {
            "geography": _FIPS_TO_ABBR.get(fips.group(1), p0),
            "level": "state",
            "source": "admin",
            "variable": parts[1] if len(parts) > 1 else "",
            "breakdown": " · ".join(parts[2:]),
        }
    if p0 == "state":
        second = parts[1] if len(parts) > 1 else ""
        # state-keyed ("state/AL/adjusted_gross_income/..."): slot 2 is the
        # state, not a source. Group all states under one synthetic "state"
        # source so the 50 state codes don't masquerade as sources/variables.
        if second in _STATE_ABBRS and second != "US":
            return {
                "geography": second,
                "level": "state",
                "source": "state",
                "variable": parts[2] if len(parts) > 2 else "",
                "breakdown": " · ".join(parts[3:]),
            }
        # source-keyed with a trailing state ("state/census/rent/AK").
        if len(parts) >= 4 and parts[-1] in _STATE_ABBRS:
            return {
                "geography": parts[-1],
                "level": "state",
                "source": parts[1],
                "variable": parts[2],
                "breakdown": " · ".join(parts[3:-1]),
            }
        return {
            "geography": "state",
            "level": "state",
            "source": parts[1] if len(parts) > 1 else "",
            "variable": parts[2] if len(parts) > 2 else "",
            "breakdown": " · ".join(parts[3:]),
        }
    if p0 in ("nation", "national", "us"):
        return {
            "geography": "United States",
            "level": "national",
            "source": parts[1] if len(parts) > 1 else "",
            "variable": parts[2] if len(parts) > 2 else "",
            "breakdown": " · ".join(parts[3:]),
        }
    return {
        "geography": "",
        "level": "",
        "source": p0,
        "variable": parts[1] if len(parts) > 1 else "",
        "breakdown": " · ".join(parts[2:]),
    }


def _variable_key(parsed: dict[str, str]) -> str:
    return " / ".join(p for p in (parsed["source"], parsed["variable"]) if p)


_FILING_MODIFIERS = {"Surviving Spouse"}
_FILING_STATUSES = {
    "All", "Single", "Head of Household", "Married Filing Jointly",
    "Married Filing Separately", "Surviving Spouse",
}
_RETURN_TYPES = {"taxable", "all returns", "nontaxable"}
_MEASURES = {"total", "count", "mean", "filers", "nonfilers"}


def _split_breakdown(breakdown: str) -> list[str]:
    raw = [t for t in breakdown.split(" · ") if t] if breakdown else []
    out: list[str] = []
    for token in raw:
        if token in _FILING_MODIFIERS and out:
            out[-1] = f"{out[-1]} · {token}"
        else:
            out.append(token)
    return out


def _classify_dimension(values: list[str]) -> str:
    v = [x for x in values if x]
    if not v:
        return "Breakdown"

    def all_match(pred):
        return all(pred(x) for x in v)

    if all_match(lambda s: s.startswith("AGI in ")):
        return "Income band"
    if all_match(lambda s: s in _RETURN_TYPES):
        return "Return type"
    if all_match(lambda s: s.split(" · ")[0] in _FILING_STATUSES):
        return "Filing status"
    if all_match(lambda s: s.isdigit()):
        return "Age"
    if all_match(lambda s: s in _MEASURES):
        return "Measure"
    return "Breakdown"


def _parse_amount(token: str) -> float:
    if re.match(r"^-?inf$", token, re.I):
        return float("-inf") if token.startswith("-") else float("inf")
    m = re.match(r"^(-?)(\d+(?:\.\d+)?)([km]?)$", token, re.I)
    if not m:
        return 0.0
    mult = {"k": 1e3, "m": 1e6, "": 1}[m.group(3).lower()]
    return (-1 if m.group(1) else 1) * float(m.group(2)) * mult


def _band_lower(label: str) -> float:
    body = label[len("AGI in "):] if label.startswith("AGI in ") else label
    m = re.match(r"^(-?inf|-?\d+(?:\.\d+)?[km]?)-(-?inf|-?\d+(?:\.\d+)?[km]?)$", body, re.I)
    return _parse_amount(m.group(1)) if m else 0.0


def _sort_dimension_values(label: str, values: list[str]) -> list[str]:
    if label == "Income band":
        return sorted(values, key=_band_lower)
    if label == "Age":
        return sorted(values, key=lambda s: int(s) if s.isdigit() else 0)
    return sorted(values, key=lambda s: (s != "All", s))


def _row_facet_value(row: dict[str, Any], key: str) -> str | None:
    if key == "geography":
        return row.get("geography") or None
    if key == "level":
        return row.get("level") or None
    m = re.match(r"^dim(\d+)$", key)
    if m:
        idx = int(m.group(1))
        dims = row.get("dims") or []
        return dims[idx] if len(dims) > idx and dims[idx] else None
    value = row.get(key)
    return value if isinstance(value, str) else None


def _sort_facet_values(label: str, values: list[str]) -> list[str]:
    if label == "Geography":
        return sorted(values, key=lambda s: (s != "United States", s))
    return _sort_dimension_values(label, values)


def _compute_dimensions(rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Every axis along which the rows vary, as facets: geography, level, and
    each breakdown position. Constant axes (no variation) are dropped."""
    max_len = max((len(r.get("dims") or []) for r in rows), default=0)
    candidates: list[tuple[str, str | None]] = [
        ("geography", "Geography"),
        ("level", "Level"),
    ]
    candidates += [(f"dim{i}", None) for i in range(max_len)]

    facets = []
    for key, fixed_label in candidates:
        values = list(
            dict.fromkeys(
                v for v in (_row_facet_value(r, key) for r in rows) if v
            )
        )
        if len(values) <= 1:
            continue
        label = fixed_label or _classify_dimension(values)
        facets.append(
            {"key": key, "label": label, "values": _sort_facet_values(label, values)}
        )
    return facets


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
    parsed = _parse_target(name)
    return {
        **row,
        "family": _derive_family(name),
        "state": _derive_state(name),
        "geography": parsed["geography"],
        "level": parsed["level"],
        "source": parsed["source"],
        "variable": parsed["variable"],
        "breakdown": parsed["breakdown"],
        "dims": _split_breakdown(parsed["breakdown"]),
        "variable_key": _variable_key(parsed),
        "initial_relative_error": initial_rel,
        "abs_relative_error": abs_rel,
        "improvement": improvement,
        "direction": direction,
    }


def _variable_summary(rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
    groups: dict[str, list[dict[str, Any]]] = {}
    for row in rows:
        key = str(row.get("variable_key", ""))
        if key:
            groups.setdefault(key, []).append(row)
    out = []
    for key, members in groups.items():
        first = members[0]
        abs_errors = [
            r["abs_relative_error"]
            for r in members
            if isinstance(r.get("abs_relative_error"), (int, float))
        ]
        out.append(
            {
                "variable_key": key,
                "source": str(first.get("source", "")),
                "variable": str(first.get("variable", "")),
                "level": str(first.get("level", "")),
                "n_targets": len(members),
                "within_10pct": sum(
                    1
                    for r in members
                    if isinstance(r.get("abs_relative_error"), (int, float))
                    and r["abs_relative_error"] <= 0.1
                ),
                "within_tolerance": sum(
                    1 for r in members if r.get("within_tolerance") is True
                ),
                "mean_abs_relative_error": (
                    sum(abs_errors) / len(abs_errors) if abs_errors else None
                ),
            }
        )
    return sorted(out, key=lambda v: v["n_targets"], reverse=True)


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


def _calibration_payload() -> tuple[dict[str, Any], str]:
    """The calibration_diagnostics payload, live from HF via latest.json when
    reachable, else the committed snapshot. Returns (payload, source)."""
    try:
        pointer = _fetch_json(_hf_resolve_url(_LATEST_POINTER_PATH))
        paths = pointer.get("paths") if isinstance(pointer, dict) else None
        diag_path = paths.get("calibration_diagnostics") if isinstance(paths, dict) else None
        if diag_path:
            payload = _fetch_json(_hf_resolve_url(diag_path))
            if isinstance(payload, dict) and payload.get("targets"):
                # schema v2 carries no top-level release_id — take the pointer's.
                if not payload.get("release_id") and pointer.get("release_id"):
                    payload["release_id"] = pointer["release_id"]
                return payload, "huggingface_live"
    except Exception as exc:  # noqa: BLE001 - fall back to the snapshot
        logger.info("Live calibration unavailable, using snapshot: %s", exc)
    return _load_static(_STATIC_CALIBRATION_DIAGNOSTICS), "deployed_static_snapshot"


def _calibration_summary(
    payload: dict[str, Any], rows: list[dict[str, Any]], source: str
) -> dict[str, Any]:
    return {
        "available": True,
        "source": source,
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
    payload, cal_source = _calibration_payload()
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

    calibration = _calibration_summary(payload, rows, cal_source)

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
        for key in ("name", "variable", "source", "breakdown", "geography", "state")
        if row.get(key) is not None
    ).lower()
    return search.lower() in haystack


@router.get("/populace/target-diagnostics")
def populace_target_diagnostics(
    limit: int = Query(100, ge=1, le=500),
    offset: int = Query(0, ge=0),
    family: str | None = None,
    variable: str | None = None,
    source: str | None = None,
    level: str | None = None,
    state: str | None = None,
    direction: str | None = None,
    within_tolerance: str | None = None,
    search: str | None = None,
    facet: list[str] | None = Query(default=None),
    sort_by: str | None = None,
    sort_dir: str = "desc",
) -> dict[str, Any]:
    payload, _cal_source = _calibration_payload()
    rows = [_enrich(row) for row in (payload.get("targets") or [])]
    families = sorted({str(row.get("family", "")) for row in rows})
    sources = sorted({str(row.get("source", "")) for row in rows if row.get("source")})

    within: bool | None = None
    if within_tolerance is not None and within_tolerance != "":
        within = within_tolerance.lower() in ("1", "true", "yes")

    facet_filters: list[tuple[str, str]] = []
    # `facet` is the Query sentinel (not a list) when the endpoint is called
    # directly rather than through FastAPI's request parsing.
    for entry in facet if isinstance(facet, list) else []:
        sep = entry.find(":")
        if sep >= 0:
            facet_filters.append((entry[:sep], entry[sep + 1 :]))

    filtered = rows
    if family:
        filtered = [r for r in filtered if r.get("family") == family]
    if variable:
        filtered = [r for r in filtered if r.get("variable_key") == variable]
    if source:
        filtered = [r for r in filtered if r.get("source") == source]
    if level:
        filtered = [r for r in filtered if r.get("level") == level]
    if state:
        filtered = [r for r in filtered if r.get("state") == state]
    # Facets derive from the variable's rows before the facet/within/direction/
    # search filters so every option stays selectable.
    dimensions = _compute_dimensions(filtered) if variable else []
    for key, value in facet_filters:
        filtered = [r for r in filtered if _row_facet_value(r, key) == value]
    if direction:
        filtered = [r for r in filtered if r.get("direction") == direction]
    if within is not None:
        filtered = [r for r in filtered if r.get("within_tolerance") is within]
    if search and search.strip():
        filtered = [r for r in filtered if _matches_search(r, search.strip())]

    sort_key = sort_by or "abs_relative_error"
    dim_sort = re.match(r"^dim(\d+)$", sort_key)

    def sort_value(row: dict[str, Any]):
        if dim_sort:
            idx = int(dim_sort.group(1))
            dims = row.get("dims") or []
            return dims[idx] if len(dims) > idx else None
        return row.get(sort_key)

    descending = sort_dir != "asc"
    present = [r for r in filtered if sort_value(r) is not None]
    missing = [r for r in filtered if sort_value(r) is None]

    def key_fn(row: dict[str, Any]):
        value = sort_value(row)
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
            "sources": sources,
            "variables": _variable_summary(rows),
            "dimensions": dimensions,
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
                "variable": variable,
                "source": source,
                "level": level,
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


def _scorecard_url_from_pointer(pointer_url: str, scorecard_path: str) -> str:
    if scorecard_path.startswith(("http://", "https://")):
        return scorecard_path
    suffix = "/benchmarks/us/incumbent-comparison/latest.json"
    base = pointer_url[: -len(suffix)] if pointer_url.endswith(suffix) else pointer_url
    return f"{base}/{scorecard_path.lstrip('/')}"


def _load_live_scorecard() -> dict[str, Any]:
    """Resolve the benchmarks scorecard, raising on any failure.

    A direct ``POPULACE_BENCHMARKS_SCORECARD_URL`` skips the pointer; otherwise
    the ``latest.json`` pointer names the scorecard to fetch.
    """
    if _BENCHMARKS_SCORECARD_URL:
        raw = _fetch_json(_BENCHMARKS_SCORECARD_URL)
        status = raw.get("status") if isinstance(raw, dict) else None
        return {
            "source": "populace_benchmarks_live",
            "path": _BENCHMARKS_SCORECARD_URL,
            "pointer_url": None,
            "scorecard_status": status if isinstance(status, str) else None,
            **_normalize_comparison_scorecard(raw),
        }
    pointer = _fetch_json(_BENCHMARKS_POINTER_URL)
    scorecard_path = pointer.get("scorecard_path") if isinstance(pointer, dict) else None
    if not isinstance(scorecard_path, str) or not scorecard_path:
        raise ValueError(f"Pointer {_BENCHMARKS_POINTER_URL} has no scorecard_path.")
    scorecard_url = _scorecard_url_from_pointer(_BENCHMARKS_POINTER_URL, scorecard_path)
    raw = _fetch_json(scorecard_url)
    status = pointer.get("status")
    if not isinstance(status, str):
        status = raw.get("status") if isinstance(raw, dict) else None
    return {
        "source": "populace_benchmarks_live",
        "path": scorecard_url,
        "pointer_url": _BENCHMARKS_POINTER_URL,
        "scorecard_status": status if isinstance(status, str) else None,
        **_normalize_comparison_scorecard(raw),
    }


@router.get("/populace/comparison")
def populace_comparison() -> dict[str, Any]:
    payload: dict[str, Any] = {
        "source": "deployed_static_snapshot",
        "path": _COMPARISON_SCORECARD_PUBLIC_PATH,
        "pointer_url": _BENCHMARKS_POINTER_URL,
        "scorecard_status": None,
        **_normalize_comparison_scorecard(_load_static(_STATIC_COMPARISON_SCORECARD)),
    }
    live_error = None
    try:
        payload = _load_live_scorecard()
    except Exception as exc:
        live_error = str(exc)

    live = payload["source"] == "populace_benchmarks_live"
    scorecard_status = payload.get("scorecard_status") or "archived"
    return _scrub(
        {
            **payload,
            "available": True,
            "archived": not live,
            "scorecard_status": scorecard_status,
            "source_pointer": payload.get("pointer_url") or _BENCHMARKS_POINTER_URL,
            "live_scorecard_error": live_error,
            "notes": [
                "Populace (candidate) is scored against the enhanced CPS "
                "(incumbent) with a matched-household, symmetric-refit, "
                "held-out-target protocol.",
                (
                    f"Served live from populace-benchmarks "
                    f"({scorecard_status} scorecard)."
                    if live
                    else "The benchmarks scorecard was not reachable, so this is "
                    "the committed archived snapshot for release "
                    "populace-us-2024-9f1260b-20260611 "
                    "(PolicyEngine/populace-benchmarks#3 / #4 publish it)."
                ),
                "The eCPS comparison is benchmark-harness material and "
                "intentionally lives outside live populace "
                "(PolicyEngine/populace#37); the live calibration-fit view is "
                "the populace release summary.",
            ],
        }
    )
