"""Microplex-vs-us-data comparison view.

Reads the parity / regression / drilldown JSONs that microplex-us
commits under ``artifacts/`` directly from GitHub. The full per-target
diff (``pe_native_target_diagnostics_current.json``) and the output h5
files are gitignored and only archived to a private Cloudflare R2
bucket, so the committed JSONs are the only public signal we can pull
in without credentials.

This view is intentionally read-only and aggregate. When microplex
starts publishing its h5 artifacts to HuggingFace we can swap to a full
per-target compare against us-data's loaded run.
"""

from __future__ import annotations

import json
import logging
import time
from typing import Any

from fastapi import APIRouter, HTTPException

logger = logging.getLogger(__name__)
router = APIRouter()


# Pinned filenames in the microplex-us repo. If the team renames or
# rotates these the dashboard will surface a 404 with the path so we can
# bump the constants.
_PARITY_PATH = (
    "artifacts/live_pe_native_cps_puf_rich_broad_fixed_20260329/"
    "20260329T175330Z-057066af/pe_us_data_rebuild_parity.json"
)
_REGRESSION_SUMMARY_PATH = (
    "artifacts/live_pe_us_data_rebuild_checkpoint_modelpass_"
    "regression_summary_20260410.json"
)
_IRS_DRILLDOWN_PATH = (
    "artifacts/live_pe_us_data_rebuild_checkpoint_national_irs_"
    "other_drilldown_20260410.json"
)

_GITHUB_RAW = "https://raw.githubusercontent.com/PolicyEngine/microplex-us/main"

# In-process cache: the JSONs change only when microplex-us commits, so a
# few minutes of TTL is plenty.
_CACHE: dict[str, tuple[float, Any]] = {}
_TTL_SECONDS = 300


def _fetch_json(path: str) -> Any:
    cached = _CACHE.get(path)
    if cached and time.time() - cached[0] < _TTL_SECONDS:
        return cached[1]
    import urllib.request
    url = f"{_GITHUB_RAW}/{path}"
    logger.info("Fetching microplex artifact: %s", url)
    try:
        with urllib.request.urlopen(url, timeout=30) as resp:
            body = resp.read().decode("utf-8")
        data = json.loads(body)
        _CACHE[path] = (time.time(), data)
        return data
    except Exception as exc:
        raise HTTPException(
            status_code=502,
            detail=f"Failed to fetch microplex artifact {path}: {exc}",
        )


def _scrub(obj):
    """Replace non-finite floats with None for JSON serialization."""
    if isinstance(obj, dict):
        return {k: _scrub(v) for k, v in obj.items()}
    if isinstance(obj, list):
        return [_scrub(x) for x in obj]
    if isinstance(obj, float):
        import math
        if not math.isfinite(obj):
            return None
    return obj


@router.get("/microplex")
def microplex_overview() -> dict:
    """Return a consolidated microplex-vs-us-data parity payload.

    Pulls three committed JSONs from PolicyEngine/microplex-us via raw
    GitHub (no auth required). The response is structured for a single
    dashboard page; consumers should pluck what they need.
    """
    parity = _fetch_json(_PARITY_PATH)
    regression = _fetch_json(_REGRESSION_SUMMARY_PATH)
    drilldown = _fetch_json(_IRS_DRILLDOWN_PATH)

    # Pull the parity headline numbers up to a flat shape the frontend
    # can render without spelunking. Leave the raw payload available too.
    headline = {}
    ph = parity.get("comparison", {}).get("policyengineHarness") or {}
    if ph.get("isPolicyEngineComparison"):
        headline = {
            "baseline_label": parity.get("baselineSlice", {}).get("baselineLabel"),
            "candidate_label": parity.get("baselineSlice", {}).get("candidateLabel"),
            "calibration_target_profile": parity.get("baselineSlice", {}).get(
                "calibrationTargetProfile"
            ),
            "n_synthetic": parity.get("baselineSlice", {})
                .get("comparisonMetadata", {})
                .get("n_synthetic"),
            "target_period": parity.get("baselineSlice", {}).get("targetPeriod"),
            "baseline_composite_parity_loss": ph.get("baseline_composite_parity_loss"),
            "candidate_composite_parity_loss": ph.get("candidate_composite_parity_loss"),
            "composite_parity_loss_delta": ph.get("composite_parity_loss_delta"),
            "baseline_mean_abs_relative_error": ph.get("baseline_mean_abs_relative_error"),
            "candidate_mean_abs_relative_error": ph.get("candidate_mean_abs_relative_error"),
            "mean_abs_relative_error_delta": ph.get("mean_abs_relative_error_delta"),
            "slice_win_rate": ph.get("slice_win_rate"),
            "supported_target_rate": ph.get("supported_target_rate"),
            "tag_summaries": ph.get("tag_summaries", {}),
        }

    return _scrub({
        "source_repo": "PolicyEngine/microplex-us",
        "artifact_id": parity.get("artifactId"),
        "verdict": parity.get("verdict"),
        "headline": headline,
        "regression_summary": {
            "total_scored_runs": regression.get("totalScoredRuns"),
            "total_audited_runs": regression.get("totalAuditedRuns"),
            "best_runs": regression.get("bestRuns", [])[:10],
            "worst_runs": regression.get("worstRuns", [])[:10],
            "largest_family_counts": regression.get("largestFamilyCounts", {}),
            "top3_family_counts": regression.get("top3FamilyCounts", {}),
            "target_counts_from_audits": regression.get("targetCountsFromAudits", {}),
        },
        "irs_drilldown": {
            "family": drilldown.get("family"),
            "audits_where_family_leads": drilldown.get("auditsWhereFamilyLeads"),
            "audits_with_matching_targets": drilldown.get(
                "auditsWithMatchingTargets"
            ),
            "lead_audits": drilldown.get("leadAudits", [])[:10],
            "lead_target_counts": drilldown.get("leadTargetCounts", {}),
            "lead_filing_status_gap_summary": drilldown.get(
                "leadFilingStatusGapSummary"
            ),
            "lead_mfs_agi_gap_summary": drilldown.get("leadMFSAgiGapSummary"),
        },
    })
