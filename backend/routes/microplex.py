"""Microplex target-performance view.

Reads the parity / regression / drilldown JSONs that microplex-us
commits under ``artifacts/`` directly from GitHub. Newer Microplex runs
write full per-target diagnostics as a run-bundle artifact named
``policyengine_native_target_diagnostics`` with path
``pe_native_target_diagnostics.json``. Those run bundles, the run index,
native audit, and output H5 are generated artifacts, not committed public
JSONs, so the committed summaries are the only public signal we can pull
in without credentials or a separately supplied artifact root.

This view is intentionally read-only and aggregate. When microplex
publishes its generated target diagnostics or H5 artifacts, this route can
serve Microplex's standalone target-oracle performance table and optionally
compare it with us-data.
"""

from __future__ import annotations

import json
import logging
import os
import time
from functools import lru_cache
from pathlib import Path
from typing import Any

from fastapi import APIRouter, HTTPException
import numpy as np

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
_RUN_LEVEL_TARGET_DIAGNOSTICS_PATH = "pe_native_target_diagnostics.json"
_RUN_LEVEL_TARGET_DIAGNOSTICS_MANIFEST_KEY = (
    "policyengine_native_target_diagnostics"
)
_LEGACY_STATIC_TARGET_DIAGNOSTICS_PATH = (
    "artifacts/pe_native_target_diagnostics_current.json"
)

_GITHUB_RAW = "https://raw.githubusercontent.com/PolicyEngine/microplex-us/main"

_ARTIFACTS = {
    "parity": _PARITY_PATH,
    "regression_summary": _REGRESSION_SUMMARY_PATH,
    "irs_drilldown": _IRS_DRILLDOWN_PATH,
}

_GENERATED_ARTIFACT_CONTRACT = [
    {
        "name": "full_target_diagnostics",
        "path_hint": _RUN_LEVEL_TARGET_DIAGNOSTICS_PATH,
        "manifest_key": _RUN_LEVEL_TARGET_DIAGNOSTICS_MANIFEST_KEY,
        "legacy_static_dashboard_path": _LEGACY_STATIC_TARGET_DIAGNOSTICS_PATH,
        "producer": "build_us_pe_native_target_diagnostics_payload",
        "public_committed": False,
        "description": (
            "Full per-target PE-native rows saved inside each newer Microplex "
            "run bundle. The rows show Microplex aggregate estimates against "
            "target values, with us-data comparator fields when present."
        ),
    },
    {
        "name": "dashboard_payload",
        "path_hint": "artifacts/microplex_dashboard_current.json",
        "producer": "microplex-us-dashboard",
        "public_committed": False,
        "description": "Living dashboard payload with score runs, logs, and target diagnostics.",
    },
    {
        "name": "native_scores",
        "path_hint": "policyengine_native_scores.json",
        "producer": "compute_us_pe_native_scores",
        "public_committed": False,
        "description": "Compact broad native-loss summary for one artifact bundle.",
    },
    {
        "name": "native_audit",
        "path_hint": "pe_us_data_rebuild_native_audit.json",
        "producer": "build_policyengine_us_data_rebuild_native_audit",
        "public_committed": False,
        "description": "Top family and target regressions plus support audit evidence.",
    },
    {
        "name": "run_index",
        "path_hint": "run_index.duckdb",
        "producer": "append_us_microplex_run_index_entry",
        "public_committed": False,
        "description": "DuckDB index for querying target deltas across saved runs.",
    },
]

_TARGET_DIAGNOSTIC_ROW_FIELDS = [
    "target_id",
    "family",
    "in_loss",
    "supported_by_microplex",
    "baseline_dataset",
    "candidate_dataset",
    "baseline_label",
    "candidate_label",
    "target_value",
    "us_data_aggregate",
    "microplex_aggregate",
    "us_data_absolute_error",
    "microplex_absolute_error",
    "us_data_relative_error",
    "microplex_relative_error",
    "delta_absolute_error",
    "delta_relative_error",
    "loss_contribution",
]

# In-process cache: the JSONs change only when microplex-us commits, so a
# few minutes of TTL is plenty.
_CACHE: dict[str, tuple[float, Any]] = {}
_TTL_SECONDS = 300
_REFORM_COMPARISON_CACHE: dict[
    tuple[str, str, str, str, int],
    tuple[float, dict[str, Any]],
] = {}
_REFORM_COMPARISON_TTL_SECONDS = 900
_BUDGET_BENCHMARK_CACHE: dict[
    tuple[str, str, int],
    tuple[float, dict[str, Any]],
] = {}
_BUDGET_BENCHMARK_TTL_SECONDS = 900

_REFORM_PRESETS: dict[str, dict[str, Any]] = {
    "american_family_act_2025": {
        "id": "american_family_act_2025",
        "label": "American Family Act 2025 CTC expansion",
        "description": (
            "Expands the Child Tax Credit using the American Family Act "
            "structure implemented in PolicyEngine-US."
        ),
        "variable": "ctc",
        "entity": "tax_unit",
        "period": 2026,
        "unit": "USD",
        "source_url": "https://www.policyengine.org/us/research/american-family-act-2025",
    },
    "working_parents_tax_relief_act_2026": {
        "id": "working_parents_tax_relief_act_2026",
        "label": "Working Parents Tax Relief Act EITC enhancement",
        "description": (
            "Enhances the EITC for parents with young children, using the "
            "2026 PolicyEngine-US reform implementation."
        ),
        "variable": "eitc",
        "entity": "tax_unit",
        "period": 2026,
        "unit": "USD",
        "source_url": "https://www.policyengine.org/us/working-parents-tax-relief-act",
    },
    "halve_joint_eitc_phase_out_rate": {
        "id": "halve_joint_eitc_phase_out_rate",
        "label": "Halve joint-filer EITC phase-out rate",
        "description": (
            "Structural PolicyEngine-US reform that halves the EITC phase-out "
            "rate for joint filers. Useful as a simple smoke test."
        ),
        "variable": "eitc",
        "entity": "tax_unit",
        "period": 2024,
        "unit": "USD",
        "source_url": None,
    },
    "wyden_smith_ctc_2024": {
        "id": "wyden_smith_ctc_2024",
        "label": "Wyden-Smith / TRAFWA CTC provisions",
        "description": (
            "Implements the 2024 Child Tax Credit provisions from H.R. 7024: "
            "per-child ACTC phase-in, prior-year earnings lookback, 2024 ACTC "
            "refundable maximum increase, and 2024 CTC indexing."
        ),
        "variable": "ctc",
        "entity": "tax_unit",
        "period": 2024,
        "unit": "USD",
        "source_url": "https://www.policyengine.org/us/research/trafwa-ctc",
    },
}

_BUDGET_BENCHMARKS: list[dict[str, Any]] = [
    {
        "id": "american_family_act_2025",
        "title": "American Family Act 2025 CTC expansion",
        "policy_area": "Child Tax Credit",
        "live_reform_id": "american_family_act_2025",
        "budget_effect_rule": "credit_delta_is_cost",
        "benchmark_period": "2026 annual",
        "comparison_status": "live_model_no_third_party_score",
        "external_estimates": [
            {
                "source": "CBO/JCT",
                "source_type": "official_score",
                "url": "https://www.congress.gov/bill/119th-congress/house-bill/2763",
                "estimate": None,
                "estimate_label": "No public CBO/JCT score found for H.R.2763 / S.1393.",
                "period": "not available",
            }
        ],
        "notes": (
            "No independent public budget score is attached for this bill. "
            "PolicyEngine has a published static analysis, but that is not a "
            "third-party benchmark and is intentionally excluded from the "
            "external comparison slot."
        ),
    },
    {
        "id": "working_parents_tax_relief_act_2026",
        "title": "Working Parents Tax Relief Act EITC enhancement",
        "policy_area": "Earned Income Tax Credit",
        "live_reform_id": "working_parents_tax_relief_act_2026",
        "budget_effect_rule": "credit_delta_is_cost",
        "benchmark_period": "2026 annual",
        "comparison_status": "live_model_partial_external_context",
        "external_estimates": [
            {
                "source": "Thomson Reuters coverage",
                "source_type": "third_party_context",
                "url": "https://tax.thomsonreuters.com/news/bill-seeks-earned-income-tax-credit-boost-per-child-for-working-parents/",
                "estimate": None,
                "estimate_label": (
                    "Third-party coverage found; no single budget score is "
                    "attached in this catalog."
                ),
                "period": "not available",
            },
            {
                "source": "PolicyEngine policy page",
                "source_type": "published_model_result",
                "url": "https://www.policyengine.org/us/working-parents-tax-relief-act",
                "estimate": None,
                "estimate_label": "PolicyEngine analysis; not a CBO/JCT comparator.",
                "period": "2026+",
            },
        ],
        "notes": (
            "Live values are annual aggregate EITC deltas for the implemented "
            "PolicyEngine-US reform."
        ),
    },
    {
        "id": "wyden_smith_ctc_2024",
        "title": "Wyden-Smith / TRAFWA CTC provisions",
        "policy_area": "Child Tax Credit",
        "live_reform_id": "wyden_smith_ctc_2024",
        "budget_effect_rule": "credit_delta_is_cost",
        "benchmark_period": "2024 annual",
        "comparison_status": "live_model_with_third_party_score",
        "external_estimates": [
            {
                "source": "Joint Committee on Taxation",
                "source_type": "jct",
                "url": "https://waysandmeans.house.gov/wp-content/uploads/2024/01/Estimated-Revenue-Effects-of-H.R.-7024.pdf",
                "estimate": 10_700_000_000,
                "estimate_label": (
                    "$10.7B 2024 cost for the combined CTC provisions, as "
                    "reported in PolicyEngine's JCT comparison table."
                ),
                "period": "2024",
            },
            {
                "source": "Joint Committee on Taxation",
                "source_type": "jct",
                "url": "https://waysandmeans.house.gov/wp-content/uploads/2024/01/Estimated-Revenue-Effects-of-H.R.-7024.pdf",
                "estimate": 33_493_000_000,
                "estimate_label": (
                    "$33.493B 2024-2033 revenue effect for the Tax Relief for "
                    "Working Families line in JCX-3-24."
                ),
                "period": "2024-2033",
            },
        ],
        "notes": (
            "This row is the first true third-party benchmark: the live model "
            "runs the CTC outcome against a JCT provision-level score. The "
            "annual comparison uses PolicyEngine's published JCT comparison "
            "table for the 2024 CTC provisions; the decade score is included "
            "as context but is not directly comparable to the single-year live "
            "run."
        ),
    },
    {
        "id": "tcja_extension_2026_2035",
        "title": "TCJA individual provisions extension",
        "policy_area": "Federal individual income tax",
        "live_reform_id": None,
        "budget_effect_rule": "full_budget_score",
        "benchmark_period": "2026-2035",
        "comparison_status": "external_score_available_reform_not_wired",
        "external_estimates": [
            {
                "source": "CBO/JCT",
                "source_type": "cbo_jct",
                "url": "https://www.policyengine.org/us/research/tcja-extension",
                "estimate": 3_877_600_000_000,
                "estimate_label": "$3.8776T cost over 2026-2035",
                "period": "2026-2035",
            },
            {
                "source": "CRFB",
                "source_type": "third_party_score",
                "url": "https://www.policyengine.org/us/research/tcja-extension",
                "estimate": 3_830_000_000_000,
                "estimate_label": "$3.83T cost over 2026-2035",
                "period": "2026-2035",
            },
            {
                "source": "PolicyEngine dynamic",
                "source_type": "published_model_result",
                "url": "https://www.policyengine.org/us/research/tcja-extension",
                "estimate": 3_885_500_000_000,
                "estimate_label": "$3.8855T cost over 2026-2035",
                "period": "2026-2035",
            },
        ],
        "notes": (
            "External benchmark is strong, but the dashboard does not yet have "
            "a matching live TCJA-extension reform preset for us-data and "
            "Microplex."
        ),
    },
    {
        "id": "final_2025_reconciliation_tax",
        "title": "Final 2025 reconciliation individual income tax provisions",
        "policy_area": "Federal individual income tax",
        "live_reform_id": None,
        "budget_effect_rule": "full_budget_score",
        "benchmark_period": "2026-2035",
        "comparison_status": "external_score_available_reform_not_wired",
        "external_estimates": [
            {
                "source": "PolicyEngine static analysis",
                "source_type": "published_model_result",
                "url": "https://www.policyengine.org/us/research/final-2025-reconciliation-tax",
                "estimate": 3_785_000_000_000,
                "estimate_label": "$3.785T cost over 2026-2035",
                "period": "2026-2035",
            },
            {
                "source": "JCT JCX-26-25",
                "source_type": "jct",
                "url": "https://www.jct.gov/publications/2025/jcx-26-25/",
                "estimate": None,
                "estimate_label": "Official JCT revenue estimate available; row-level match not wired.",
                "period": "2025 budget reconciliation",
            },
        ],
        "notes": (
            "PolicyEngine-US baseline now contains many OBBBA provisions, so "
            "a live before/after comparison needs an explicit counterfactual "
            "reform branch rather than a simple preset."
        ),
    },
]


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


def _configured_artifact_roots() -> list[Path]:
    raw = os.environ.get("MICROPLEX_ARTIFACT_ROOTS") or os.environ.get(
        "MICROPLEX_ARTIFACT_ROOT"
    )
    if not raw:
        return []
    separators = [os.pathsep, ","]
    parts = [raw]
    for separator in separators:
        next_parts: list[str] = []
        for part in parts:
            next_parts.extend(part.split(separator))
        parts = next_parts
    return [Path(part).expanduser().resolve() for part in parts if part.strip()]


def _read_json_file(path: Path) -> Any | None:
    try:
        return json.loads(path.read_text())
    except (OSError, json.JSONDecodeError):
        return None


def _resolve_artifact_path(bundle_dir: Path, value: Any) -> Path | None:
    if not isinstance(value, str) or not value:
        return None
    path = Path(value).expanduser()
    if not path.is_absolute():
        path = bundle_dir / path
    return path.resolve()


def _discover_configured_run_bundles() -> dict[str, Any]:
    roots = _configured_artifact_roots()
    bundles: list[dict[str, Any]] = []
    missing_roots = []
    for root in roots:
        if not root.exists():
            missing_roots.append(str(root))
            continue
        for manifest_path in root.rglob("manifest.json"):
            manifest = _read_json_file(manifest_path)
            if not isinstance(manifest, dict):
                continue
            bundle_dir = manifest_path.parent
            artifacts = manifest.get("artifacts")
            artifacts = artifacts if isinstance(artifacts, dict) else {}
            diagnostics_path = _resolve_artifact_path(
                bundle_dir,
                artifacts.get(_RUN_LEVEL_TARGET_DIAGNOSTICS_MANIFEST_KEY),
            )
            native_scores_path = _resolve_artifact_path(
                bundle_dir,
                artifacts.get("policyengine_native_scores")
                or "policyengine_native_scores.json",
            )
            native_audit_path = _resolve_artifact_path(
                bundle_dir,
                artifacts.get("policyengine_native_audit")
                or "pe_us_data_rebuild_native_audit.json",
            )
            policyengine_dataset_path = _resolve_artifact_path(
                bundle_dir,
                artifacts.get("policyengine_dataset") or "policyengine_us.h5",
            )
            modified_at = manifest_path.stat().st_mtime
            bundles.append(
                {
                    "artifact_id": (
                        manifest.get("artifact_id")
                        or manifest.get("artifactId")
                        or bundle_dir.name
                    ),
                    "artifact_dir": str(bundle_dir),
                    "manifest_path": str(manifest_path),
                    "modified_at_unix": modified_at,
                    "target_diagnostics_path": (
                        str(diagnostics_path) if diagnostics_path is not None else None
                    ),
                    "target_diagnostics_exists": (
                        diagnostics_path.exists()
                        if diagnostics_path is not None
                        else False
                    ),
                    "native_scores_path": (
                        str(native_scores_path) if native_scores_path is not None else None
                    ),
                    "native_scores_exists": (
                        native_scores_path.exists()
                        if native_scores_path is not None
                        else False
                    ),
                    "native_audit_path": (
                        str(native_audit_path) if native_audit_path is not None else None
                    ),
                    "native_audit_exists": (
                        native_audit_path.exists()
                        if native_audit_path is not None
                        else False
                    ),
                    "policyengine_dataset_path": (
                        str(policyengine_dataset_path)
                        if policyengine_dataset_path is not None
                        else None
                    ),
                    "policyengine_dataset_exists": (
                        policyengine_dataset_path.exists()
                        if policyengine_dataset_path is not None
                        else False
                    ),
                }
            )

    bundles.sort(key=lambda item: item["modified_at_unix"], reverse=True)
    latest = bundles[0] if bundles else None
    return {
        "artifact_root_env": "MICROPLEX_ARTIFACT_ROOTS",
        "single_artifact_root_env": "MICROPLEX_ARTIFACT_ROOT",
        "configured_artifact_roots": [str(root) for root in roots],
        "missing_artifact_roots": missing_roots,
        "detected_run_bundle_count": len(bundles),
        "detected_target_diagnostics_count": sum(
            1 for bundle in bundles if bundle["target_diagnostics_exists"]
        ),
        "latest_run_bundle": latest,
        "sampled_run_bundles": bundles[:10],
    }


def _latest_microplex_policyengine_dataset() -> dict[str, Any] | None:
    discovery = _discover_configured_run_bundles()
    latest = discovery.get("latest_run_bundle")
    if not isinstance(latest, dict):
        return None
    if not latest.get("policyengine_dataset_exists"):
        return None
    path = latest.get("policyengine_dataset_path")
    if not isinstance(path, str) or not path:
        return None
    return latest


def _working_parents_tax_relief_parameter_reform():
    from policyengine_core.periods import instant
    from policyengine_us.model_api import Reform

    class working_parents_tax_relief_parameter_reform(Reform):
        def apply(self):
            def modify_parameters(parameters):
                parameter = (
                    parameters.gov.contrib.congress.mcdonald_rivet
                    .working_parents_tax_relief_act.in_effect
                )
                parameter.update(
                    start=instant("2026-01-01"),
                    stop=instant("2035-12-31"),
                    value=True,
                )
                return parameters

            self.modify_parameters(modify_parameters)

    return working_parents_tax_relief_parameter_reform


def _wyden_smith_ctc_2024_parameter_reform():
    from policyengine_core.periods import instant
    from policyengine_us.model_api import Reform

    class wyden_smith_ctc_2024_parameter_reform(Reform):
        def apply(self):
            def modify_parameters(parameters):
                wyden_smith = parameters.gov.contrib.congress.wyden_smith
                wyden_smith.per_child_actc_phase_in.update(
                    start=instant("2024-01-01"),
                    stop=instant("2024-12-31"),
                    value=True,
                )
                wyden_smith.actc_lookback.update(
                    start=instant("2024-01-01"),
                    stop=instant("2024-12-31"),
                    value=True,
                )
                parameters.gov.irs.credits.ctc.refundable.individual_max.update(
                    start=instant("2024-01-01"),
                    stop=instant("2024-12-31"),
                    value=1_900,
                )
                parameters.gov.irs.credits.ctc.amount.base[0].amount.update(
                    start=instant("2024-01-01"),
                    stop=instant("2024-12-31"),
                    value=2_100,
                )
                return parameters

            self.modify_parameters(modify_parameters)

    return wyden_smith_ctc_2024_parameter_reform


def _reform_object(reform_id: str):
    if reform_id == "halve_joint_eitc_phase_out_rate":
        from policyengine_us.reforms.eitc.halve_joint_eitc_phase_out_rate import (
            halve_joint_eitc_phase_out_rate,
        )

        return halve_joint_eitc_phase_out_rate
    if reform_id == "american_family_act_2025":
        from policyengine_us.reforms.congress.afa.afa_other_dependent_credit import (
            afa_other_dependent_credit,
        )

        return afa_other_dependent_credit
    if reform_id == "working_parents_tax_relief_act_2026":
        from policyengine_us.reforms.congress.mcdonald_rivet.working_parents_tax_relief_act.working_parents_tax_relief_act import (  # noqa: E501
            working_parents_tax_relief_act,
        )

        return (
            working_parents_tax_relief_act,
            _working_parents_tax_relief_parameter_reform(),
        )
    if reform_id == "wyden_smith_ctc_2024":
        from policyengine_us.reforms.congress.wyden_smith.ctc_expansion import (
            ctc_expansion,
        )

        return (
            ctc_expansion,
            _wyden_smith_ctc_2024_parameter_reform(),
        )
    raise ValueError(f"Unknown reform_id: {reform_id}")


@lru_cache(maxsize=8)
def _microsimulation(dataset: str, reform_id: str | None):
    from policyengine_us import Microsimulation

    if reform_id is None:
        return Microsimulation(dataset=dataset)
    return Microsimulation(dataset=dataset, reform=_reform_object(reform_id))


def _finite_float(value: Any) -> float | None:
    try:
        result = float(value)
    except (TypeError, ValueError):
        return None
    return result if np.isfinite(result) else None


def _weighted_total(
    sim,
    *,
    variable: str,
    period: int,
    entity: str,
) -> dict[str, Any]:
    values = sim.calculate(variable, period=period, map_to=entity)
    weights = sim.calculate("household_weight", period=period, map_to=entity)
    value_array = np.asarray(values.values, dtype=float)
    weight_array = np.asarray(weights.values, dtype=float)
    return {
        "total": _finite_float(np.sum(value_array * weight_array)),
        "unweighted_mean": _finite_float(np.mean(value_array)),
        "record_count": int(value_array.size),
        "weight_sum": _finite_float(np.sum(weight_array)),
    }


def _run_dataset_reform_comparison(
    *,
    dataset: str,
    reform_id: str,
    variable: str,
    period: int,
    entity: str,
) -> dict[str, Any]:
    baseline = _microsimulation(dataset, None)
    reformed = _microsimulation(dataset, reform_id)
    baseline_total = _weighted_total(
        baseline,
        variable=variable,
        period=period,
        entity=entity,
    )
    reformed_total = _weighted_total(
        reformed,
        variable=variable,
        period=period,
        entity=entity,
    )
    baseline_value = baseline_total["total"]
    reformed_value = reformed_total["total"]
    delta = (
        reformed_value - baseline_value
        if baseline_value is not None and reformed_value is not None
        else None
    )
    return {
        "dataset": dataset,
        "baseline": baseline_total,
        "reform": reformed_total,
        "delta": _finite_float(delta),
    }


def _budget_effect_from_delta(
    delta: float | None,
    *,
    rule: str,
) -> float | None:
    if delta is None:
        return None
    # Positive budget effect means higher federal cost / lower federal revenue.
    if rule == "credit_delta_is_cost":
        return _finite_float(delta)
    if rule == "tax_revenue_delta_is_negative_cost":
        return _finite_float(-delta)
    return _finite_float(delta)


def _budget_gap(
    model_effect: float | None,
    external_estimate: Any,
) -> dict[str, float | None]:
    estimate = _finite_float(external_estimate)
    if model_effect is None or estimate is None:
        return {"gap": None, "ratio": None}
    return {
        "gap": _finite_float(model_effect - estimate),
        "ratio": _finite_float(model_effect / estimate) if estimate else None,
    }


@router.get("/microplex/reform-comparison")
def microplex_reform_comparison(
    reform_id: str = "american_family_act_2025",
    variable: str | None = None,
    period: int | None = None,
):
    """Run the same PolicyEngine reform over us-data and Microplex H5s."""
    preset = _REFORM_PRESETS.get(reform_id)
    if preset is None:
        raise HTTPException(
            status_code=400,
            detail=f"Unknown reform_id. Available: {sorted(_REFORM_PRESETS)}",
        )
    selected_variable = variable or str(preset["variable"])
    selected_period = int(period or preset["period"])
    entity = str(preset["entity"])

    latest = _latest_microplex_policyengine_dataset()
    if latest is None:
        return {
            "available": False,
            "reason": (
                "No configured Microplex run bundle with policyengine_us.h5 was "
                "found. Set MICROPLEX_ARTIFACT_ROOTS or MICROPLEX_ARTIFACT_ROOT."
            ),
            "reform": None,
            "period": selected_period,
            "available_reforms": list(_REFORM_PRESETS.values()),
            "outcomes": [],
        }

    microplex_dataset = str(latest["policyengine_dataset_path"])
    us_data_dataset = os.environ.get(
        "MICROSIM_US_DATASET",
        "hf://policyengine/policyengine-us-data/enhanced_cps_2024.h5",
    )
    cache_key = (
        microplex_dataset,
        us_data_dataset,
        reform_id,
        selected_variable,
        selected_period,
    )
    cached = _REFORM_COMPARISON_CACHE.get(cache_key)
    if cached and time.time() - cached[0] < _REFORM_COMPARISON_TTL_SECONDS:
        return cached[1]

    started = time.time()
    try:
        us_data = _run_dataset_reform_comparison(
            dataset=us_data_dataset,
            reform_id=reform_id,
            variable=selected_variable,
            period=selected_period,
            entity=entity,
        )
        microplex_result = _run_dataset_reform_comparison(
            dataset=microplex_dataset,
            reform_id=reform_id,
            variable=selected_variable,
            period=selected_period,
            entity=entity,
        )
    except Exception as exc:
        logger.exception("Failed to run Microplex reform comparison")
        raise HTTPException(
            status_code=500,
            detail=f"Failed to run reform comparison: {exc}",
        ) from exc

    us_delta = us_data["delta"]
    microplex_delta = microplex_result["delta"]
    delta_gap = (
        microplex_delta - us_delta
        if microplex_delta is not None and us_delta is not None
        else None
    )
    delta_ratio = (
        microplex_delta / us_delta
        if microplex_delta is not None and us_delta not in (None, 0)
        else None
    )
    payload = _scrub(
        {
            "available": True,
            "runtime_seconds": time.time() - started,
            "period": selected_period,
            "available_reforms": list(_REFORM_PRESETS.values()),
            "reform": {
                "id": reform_id,
                "label": preset["label"],
                "description": preset["description"],
                "source_url": preset["source_url"],
            },
            "microplex_bundle": {
                "artifact_id": latest.get("artifact_id"),
                "artifact_dir": latest.get("artifact_dir"),
                "policyengine_dataset_path": microplex_dataset,
            },
            "us_data_dataset": us_data_dataset,
            "outcomes": [
                {
                    "variable": selected_variable,
                    "entity": entity,
                    "unit": preset["unit"],
                    "us_data": us_data,
                    "microplex": microplex_result,
                    "delta_gap": _finite_float(delta_gap),
                    "microplex_delta_as_share_of_us_data": _finite_float(
                        delta_ratio
                    ),
                }
            ],
        }
    )
    _REFORM_COMPARISON_CACHE[cache_key] = (time.time(), payload)
    return payload


@router.get("/microplex/budget-benchmarks")
def microplex_budget_benchmarks() -> dict[str, Any]:
    """Return budget-score benchmark rows for us-data and Microplex.

    This endpoint intentionally distinguishes exact live comparisons from
    external-only benchmark rows. The dashboard should only interpret a row as
    a CBO/JCT validation when a matching live reform preset and comparable
    external estimate are both present.
    """
    latest = _latest_microplex_policyengine_dataset()
    microplex_dataset = (
        str(latest["policyengine_dataset_path"])
        if isinstance(latest, dict) and latest.get("policyengine_dataset_path")
        else ""
    )
    us_data_dataset = os.environ.get(
        "MICROSIM_US_DATASET",
        "hf://policyengine/policyengine-us-data/enhanced_cps_2024.h5",
    )
    cache_key = (
        microplex_dataset or "no-microplex-h5",
        us_data_dataset,
        len(_BUDGET_BENCHMARKS),
    )
    cached = _BUDGET_BENCHMARK_CACHE.get(cache_key)
    if cached and time.time() - cached[0] < _BUDGET_BENCHMARK_TTL_SECONDS:
        return cached[1]

    started = time.time()
    rows: list[dict[str, Any]] = []
    errors: list[dict[str, str]] = []

    for benchmark in _BUDGET_BENCHMARKS:
        row = {
            "id": benchmark["id"],
            "title": benchmark["title"],
            "policy_area": benchmark["policy_area"],
            "benchmark_period": benchmark["benchmark_period"],
            "comparison_status": benchmark["comparison_status"],
            "budget_effect_rule": benchmark["budget_effect_rule"],
            "notes": benchmark["notes"],
            "external_estimates": benchmark["external_estimates"],
            "live": {
                "available": False,
                "reason": None,
                "reform": None,
                "period": None,
                "outcome_variable": None,
                "outcome_entity": None,
                "unit": None,
                "us_data": None,
                "microplex": None,
                "microplex_budget_effect_as_share_of_us_data": None,
                "budget_effect_gap": None,
            },
        }
        live_reform_id = benchmark.get("live_reform_id")
        preset = (
            _REFORM_PRESETS.get(str(live_reform_id))
            if live_reform_id is not None
            else None
        )
        if preset is None:
            row["live"]["reason"] = "No matching live reform preset is wired yet."
            rows.append(row)
            continue
        if not microplex_dataset:
            row["live"]["reason"] = (
                "No configured Microplex run bundle with policyengine_us.h5 was found."
            )
            rows.append(row)
            continue

        variable = str(preset["variable"])
        period = int(preset["period"])
        entity = str(preset["entity"])
        try:
            us_data = _run_dataset_reform_comparison(
                dataset=us_data_dataset,
                reform_id=str(live_reform_id),
                variable=variable,
                period=period,
                entity=entity,
            )
            microplex_result = _run_dataset_reform_comparison(
                dataset=microplex_dataset,
                reform_id=str(live_reform_id),
                variable=variable,
                period=period,
                entity=entity,
            )
        except Exception as exc:
            logger.exception("Failed to run budget benchmark %s", live_reform_id)
            message = f"Failed to run live microsim: {exc}"
            row["live"]["reason"] = message
            errors.append({"benchmark_id": str(benchmark["id"]), "error": message})
            rows.append(row)
            continue

        us_budget_effect = _budget_effect_from_delta(
            us_data["delta"],
            rule=str(benchmark["budget_effect_rule"]),
        )
        microplex_budget_effect = _budget_effect_from_delta(
            microplex_result["delta"],
            rule=str(benchmark["budget_effect_rule"]),
        )
        budget_effect_gap = (
            microplex_budget_effect - us_budget_effect
            if microplex_budget_effect is not None and us_budget_effect is not None
            else None
        )
        budget_effect_ratio = (
            microplex_budget_effect / us_budget_effect
            if microplex_budget_effect is not None
            and us_budget_effect not in (None, 0)
            else None
        )
        external_estimates = []
        for estimate in benchmark["external_estimates"]:
            us_gap = _budget_gap(us_budget_effect, estimate.get("estimate"))
            microplex_gap = _budget_gap(
                microplex_budget_effect,
                estimate.get("estimate"),
            )
            external_estimates.append(
                {
                    **estimate,
                    "comparable_to_live_annual_result": False,
                    "us_data_gap": us_gap["gap"],
                    "us_data_ratio": us_gap["ratio"],
                    "microplex_gap": microplex_gap["gap"],
                    "microplex_ratio": microplex_gap["ratio"],
                }
            )

        row["external_estimates"] = external_estimates
        row["live"] = {
            "available": True,
            "reason": None,
            "reform": {
                "id": preset["id"],
                "label": preset["label"],
                "description": preset["description"],
                "source_url": preset["source_url"],
            },
            "period": period,
            "outcome_variable": variable,
            "outcome_entity": entity,
            "unit": preset["unit"],
            "us_data": {
                **us_data,
                "budget_effect": us_budget_effect,
            },
            "microplex": {
                **microplex_result,
                "budget_effect": microplex_budget_effect,
            },
            "microplex_budget_effect_as_share_of_us_data": _finite_float(
                budget_effect_ratio
            ),
            "budget_effect_gap": _finite_float(budget_effect_gap),
        }
        rows.append(row)

    payload = _scrub(
        {
            "available": True,
            "runtime_seconds": time.time() - started,
            "generated_at_unix": time.time(),
            "sign_convention": (
                "Positive budget effect means higher federal cost or lower "
                "federal revenue. For current live CTC/EITC rows, this equals "
                "the aggregate credit increase."
            ),
            "comparison_caveat": (
                "External decade scores are shown as references until a "
                "matching live reform preset is wired. Live rows currently "
                "show annual modeled outcome deltas."
            ),
            "us_data_dataset": us_data_dataset,
            "microplex_bundle": {
                "available": bool(microplex_dataset),
                "artifact_id": latest.get("artifact_id") if isinstance(latest, dict) else None,
                "artifact_dir": latest.get("artifact_dir") if isinstance(latest, dict) else None,
                "policyengine_dataset_path": microplex_dataset or None,
            },
            "rows": rows,
            "errors": errors,
        }
    )
    _BUDGET_BENCHMARK_CACHE[cache_key] = (time.time(), payload)
    return payload


def _load_target_diagnostics(latest_bundle: dict[str, Any]) -> dict[str, Any]:
    path_text = latest_bundle.get("target_diagnostics_path")
    if not path_text:
        return {
            "available": False,
            "path": None,
            "summary": {},
            "total_targets": 0,
            "display_limit": 100,
            "targets": [],
        }
    path = Path(str(path_text))
    payload = _read_json_file(path)
    if not isinstance(payload, dict):
        return {
            "available": False,
            "path": str(path),
            "summary": {},
            "total_targets": 0,
            "display_limit": 100,
            "targets": [],
        }
    targets = payload.get("targets")
    rows = targets if isinstance(targets, list) else []
    display_limit = 100
    summary = payload.get("summary")
    return {
        "available": True,
        "path": str(path),
        "diagnostic_schema_version": payload.get("diagnostic_schema_version"),
        "metric": payload.get("metric"),
        "period": payload.get("period"),
        "baseline_dataset": payload.get("baseline_dataset"),
        "candidate_dataset": payload.get("candidate_dataset"),
        "dataset_labels": payload.get("dataset_labels", {}),
        "summary": summary if isinstance(summary, dict) else {},
        "total_targets": len(rows),
        "display_limit": display_limit,
        "targets": rows[:display_limit],
    }


def _load_bundle_native_scores(latest_bundle: dict[str, Any]) -> dict[str, Any] | None:
    path_text = latest_bundle.get("native_scores_path")
    if not path_text:
        return None
    path = Path(str(path_text))
    payload = _read_json_file(path)
    if not isinstance(payload, dict):
        return None

    summary = payload.get("summary")
    if not isinstance(summary, dict):
        summary = payload.get("broad_loss")
    if not isinstance(summary, dict):
        summary = payload

    scores = {
        "available": True,
        "metric": payload.get("metric") or summary.get("metric"),
        "period": payload.get("period") or summary.get("period"),
        "baseline_enhanced_cps_native_loss": summary.get(
            "baseline_enhanced_cps_native_loss"
        ),
        "candidate_enhanced_cps_native_loss": summary.get(
            "candidate_enhanced_cps_native_loss"
        ),
        "enhanced_cps_native_loss_delta": summary.get(
            "enhanced_cps_native_loss_delta"
        ),
        "baseline_unweighted_msre": summary.get("baseline_unweighted_msre"),
        "candidate_unweighted_msre": summary.get("candidate_unweighted_msre"),
        "unweighted_msre_delta": summary.get("unweighted_msre_delta"),
        "candidate_beats_baseline": summary.get("candidate_beats_baseline"),
        "n_targets_total": summary.get("n_targets_total"),
        "n_targets_kept": summary.get("n_targets_kept"),
        "n_national_targets": summary.get("n_national_targets"),
        "n_state_targets": summary.get("n_state_targets"),
        "n_targets_bad_dropped": summary.get("n_targets_bad_dropped"),
        "n_targets_zero_dropped": summary.get("n_targets_zero_dropped"),
        "source": "configured_run_bundle",
        "source_path": str(path),
        "artifact_id": latest_bundle.get("artifact_id"),
    }
    if scores["candidate_beats_baseline"] is None:
        delta = scores["enhanced_cps_native_loss_delta"]
        if isinstance(delta, int | float):
            scores["candidate_beats_baseline"] = float(delta) < 0.0
    return scores


@router.get("/microplex")
def microplex_overview() -> dict:
    """Return a consolidated Microplex target-performance payload.

    Pulls three committed JSONs from PolicyEngine/microplex-us via raw
    GitHub (no auth required). The response is structured for a single
    dashboard page; consumers should pluck what they need.
    """
    parity = _fetch_json(_PARITY_PATH)
    regression = _fetch_json(_REGRESSION_SUMMARY_PATH)
    drilldown = _fetch_json(_IRS_DRILLDOWN_PATH)
    configured_runs = _discover_configured_run_bundles()
    latest_bundle = configured_runs.get("latest_run_bundle") or {}
    target_rows_available = bool(latest_bundle.get("target_diagnostics_exists"))
    target_diagnostics = _load_target_diagnostics(latest_bundle)

    # Pull the target-oracle headline numbers up to a flat shape the frontend
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
            "target_win_rate": (
                ph.get("tag_summaries", {})
                .get("all_targets", {})
                .get("target_win_rate")
            ),
            "tag_summaries": ph.get("tag_summaries", {}),
        }
    parity_native_scores = (
        parity.get("comparison", {}).get("policyengineNativeScores") or {}
    )
    bundle_native_scores = _load_bundle_native_scores(latest_bundle)
    native_scores = bundle_native_scores or parity_native_scores

    return _scrub({
        "source_repo": "PolicyEngine/microplex-us",
        "source_artifacts": [
            {
                "name": name,
                "path": path,
                "url": f"{_GITHUB_RAW}/{path}",
            }
            for name, path in _ARTIFACTS.items()
        ],
        "limitations": [
            "Only committed microplex-us summary JSON artifacts are public.",
            "Newer Microplex run bundles write pe_native_target_diagnostics.json, but those bundles are generated artifacts, not committed public JSONs.",
            "This is aggregate Microplex target-oracle reporting, not the full row-level target performance table.",
        ],
        "newer_runs": {
            "current_reader": "public_github_committed_summary_jsons",
            "public_branch": "PolicyEngine/microplex-us main",
            "run_bundle_manifest_key": _RUN_LEVEL_TARGET_DIAGNOSTICS_MANIFEST_KEY,
            "run_bundle_path_hint": _RUN_LEVEL_TARGET_DIAGNOSTICS_PATH,
            "legacy_static_dashboard_path": _LEGACY_STATIC_TARGET_DIAGNOSTICS_PATH,
            "required_to_load_newer_runs": (
                "Point the dashboard at a generated Microplex artifact root, "
                "publish the run-bundle JSONs, or expose the run index/artifacts "
                "through an authenticated artifact service."
            ),
            "not_loaded_reason": (
                "The committed public repo only contains summary JSONs; this "
                "process can only see newer runs when MICROPLEX_ARTIFACT_ROOTS "
                "or MICROPLEX_ARTIFACT_ROOT points at generated run bundles, "
                "or when an artifact store is wired in."
            ),
            "configured_run_discovery": configured_runs,
        },
        "repo_structure": {
            "canonical_stage_count": 9,
            "current_commit_public_artifact_count": len(_ARTIFACTS),
            "analysis_modes": [
                "microplex_vs_target_oracle",
                "microplex_vs_us_data_comparator",
                "run_to_run_microplex_comparison",
            ],
            "generated_artifacts": _GENERATED_ARTIFACT_CONTRACT,
            "full_target_diagnostics": {
                "available_in_committed_repo": False,
                "expected_path": _RUN_LEVEL_TARGET_DIAGNOSTICS_PATH,
                "run_level_path": _RUN_LEVEL_TARGET_DIAGNOSTICS_PATH,
                "manifest_key": _RUN_LEVEL_TARGET_DIAGNOSTICS_MANIFEST_KEY,
                "legacy_static_dashboard_path": _LEGACY_STATIC_TARGET_DIAGNOSTICS_PATH,
                "static_dashboard_default_url": (
                    f"../{_LEGACY_STATIC_TARGET_DIAGNOSTICS_PATH}"
                ),
                "producer_command": (
                    "Run the Microplex PE-US-data rebuild/native audit pipeline; "
                    "newer runs record manifest.artifacts."
                    f"{_RUN_LEVEL_TARGET_DIAGNOSTICS_MANIFEST_KEY} = "
                    f"{_RUN_LEVEL_TARGET_DIAGNOSTICS_PATH}."
                ),
                "row_fields": _TARGET_DIAGNOSTIC_ROW_FIELDS,
                "primary_use": (
                    "Standalone Microplex aggregate-vs-target diagnostics; "
                    "us-data baseline fields are optional comparator context."
                ),
            },
            "run_index": {
                "path_hint": "run_index.duckdb",
                "query_helpers": [
                    "list_us_microplex_target_delta_rows",
                    "compare_us_microplex_target_delta_rows",
                    "select_us_microplex_frontier_index_row",
                ],
            },
        },
        "artifact_id": latest_bundle.get("artifact_id") or parity.get("artifactId"),
        "verdict": parity.get("verdict"),
        "headline": headline,
        "native_scores": {
            "available": native_scores.get("available"),
            "source": native_scores.get("source") or "public_committed_parity",
            "source_path": native_scores.get("source_path"),
            "artifact_id": native_scores.get("artifact_id"),
            "metric": native_scores.get("metric"),
            "period": native_scores.get("period"),
            "baseline_enhanced_cps_native_loss": native_scores.get(
                "baseline_enhanced_cps_native_loss"
            ),
            "candidate_enhanced_cps_native_loss": native_scores.get(
                "candidate_enhanced_cps_native_loss"
            ),
            "enhanced_cps_native_loss_delta": native_scores.get(
                "enhanced_cps_native_loss_delta"
            ),
            "baseline_unweighted_msre": native_scores.get("baseline_unweighted_msre"),
            "candidate_unweighted_msre": native_scores.get("candidate_unweighted_msre"),
            "unweighted_msre_delta": native_scores.get("unweighted_msre_delta"),
            "candidate_beats_baseline": native_scores.get("candidate_beats_baseline"),
            "n_targets_total": native_scores.get("n_targets_total"),
            "n_targets_kept": native_scores.get("n_targets_kept"),
            "n_national_targets": native_scores.get("n_national_targets"),
            "n_state_targets": native_scores.get("n_state_targets"),
            "n_targets_bad_dropped": native_scores.get("n_targets_bad_dropped"),
            "n_targets_zero_dropped": native_scores.get("n_targets_zero_dropped"),
            "target_rows_available": target_rows_available,
            "full_target_diagnostics_path": (
                latest_bundle.get("target_diagnostics_path")
                or _RUN_LEVEL_TARGET_DIAGNOSTICS_PATH
            ),
            "full_target_diagnostics_manifest_key": (
                _RUN_LEVEL_TARGET_DIAGNOSTICS_MANIFEST_KEY
            ),
        },
        "target_diagnostics": target_diagnostics,
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
