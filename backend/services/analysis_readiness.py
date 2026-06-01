"""Analyst-facing readiness checks for reform analysis.

This module turns the lower-level calibration artifacts into answers an
analyst can use before trusting a reform estimate:

- Are the relevant aggregates targeted?
- Were those targets included in the fitted loss?
- Did the published dataset evaluate them successfully?
- Which upstream nodes feed a selected output, and which leaves are only
  carried by source data rather than calibration targets?
"""

from __future__ import annotations

from collections import deque
from dataclasses import dataclass
from typing import Any

import numpy as np
import pandas as pd

from backend.state import AppState


@dataclass(frozen=True)
class CaseStudy:
    id: str
    label: str
    description: str
    primary_variables: tuple[str, ...]
    dependency_variables: tuple[str, ...]
    state_fips: int | None = None
    domain_keywords: tuple[str, ...] = ()
    modeled_variable_prefixes: tuple[str, ...] = ()


CASE_STUDIES: dict[str, CaseStudy] = {
    "federal_snap": CaseStudy(
        id="federal_snap",
        label="Federal SNAP reform",
        description=(
            "Assess whether SNAP benefit and caseload aggregates are usable "
            "for a federal reform analysis."
        ),
        primary_variables=("snap", "household_count"),
        dependency_variables=("snap",),
        domain_keywords=("snap",),
    ),
    "montana_ctc": CaseStudy(
        id="montana_ctc",
        label="Montana CTC reform",
        description=(
            "Assess whether Montana child tax credit analysis is supported by "
            "state-level CTC targets and modeled PolicyEngine variables."
        ),
        primary_variables=(
            "ctc",
            "refundable_ctc",
            "non_refundable_ctc",
            "tax_unit_count",
        ),
        dependency_variables=("ctc", "refundable_ctc", "non_refundable_ctc"),
        state_fips=30,
        domain_keywords=("ctc", "refundable_ctc", "non_refundable_ctc"),
        modeled_variable_prefixes=("mt_ctc", "mt_refundable_ctc"),
    ),
    "california_income_tax": CaseStudy(
        id="california_income_tax",
        label="California income tax reform",
        description=(
            "Assess whether California income tax analysis is supported by "
            "state income-tax targets and modeled California tax variables."
        ),
        primary_variables=(
            "ca_income_tax",
            "income_tax",
            "state_income_tax",
            "tax_unit_count",
        ),
        dependency_variables=(
            "ca_income_tax",
            "ca_income_tax_before_credits",
            "ca_income_tax_before_refundable_credits",
        ),
        state_fips=6,
        domain_keywords=("income_tax", "ca_income_tax", "state_income_tax"),
        modeled_variable_prefixes=("ca_income_tax",),
    ),
}


def list_case_studies() -> list[dict[str, Any]]:
    return [
        {
            "id": cs.id,
            "label": cs.label,
            "description": cs.description,
            "primary_variables": list(cs.primary_variables),
            "dependency_variables": list(cs.dependency_variables),
            "state_fips": cs.state_fips,
        }
        for cs in CASE_STUDIES.values()
    ]


def list_policyengine_variables(
    state: AppState,
    *,
    search: str | None = None,
    limit: int = 100,
) -> list[dict[str, Any]]:
    """Return every PolicyEngine variable available in the loaded simulation."""
    tbs = _tax_benefit_system(state)
    if tbs is None:
        return []

    targets = state.targets_enriched
    target_counts: dict[str, int] = {}
    included_counts: dict[str, int] = {}
    domain_counts: dict[str, int] = {}
    if targets is not None and not targets.empty:
        variable_col = targets.get("variable", pd.Series([], dtype=str)).fillna("")
        target_counts = variable_col.astype(str).value_counts().to_dict()
        if "included" in targets.columns:
            included = targets[targets["included"].astype(bool)]
            included_counts = (
                included.get("variable", pd.Series([], dtype=str))
                .fillna("")
                .astype(str)
                .value_counts()
                .to_dict()
            )
        domain_col = targets.get("domain_variable", pd.Series("", index=targets.index))
        for value in domain_col.fillna("").astype(str):
            for part in [p.strip() for p in value.split(",") if p.strip()]:
                domain_counts[part] = domain_counts.get(part, 0) + 1

    items = []
    for name, var in getattr(tbs, "variables", {}).items():
        label = getattr(var, "label", None) or name
        if search:
            q = search.lower()
            if q not in name.lower() and q not in label.lower():
                continue
        items.append(
            {
                "name": name,
                "label": label,
                "entity": getattr(getattr(var, "entity", None), "key", None),
                "definition_period": str(getattr(var, "definition_period", "") or ""),
                "is_formula": bool(getattr(var, "formulas", None)),
                "is_aggregate": bool(
                    getattr(var, "adds", None) or getattr(var, "subtracts", None)
                ),
                "is_target_variable": target_counts.get(name, 0) > 0,
                "is_domain_variable": domain_counts.get(name, 0) > 0,
                "target_count": int(target_counts.get(name, 0)),
                "included_target_count": int(included_counts.get(name, 0)),
                "domain_count": int(domain_counts.get(name, 0)),
            }
        )
    items.sort(
        key=lambda r: (
            0 if r["is_target_variable"] or r["is_domain_variable"] else 1,
            r["name"],
        )
    )
    return items[:limit]


def _sim_from_state(state: AppState):
    sim = state.sim_service
    return getattr(sim, "_sim", sim)


def _tax_benefit_system(state: AppState):
    sim = _sim_from_state(state)
    return getattr(sim, "tax_benefit_system", None)


def _available_model_variables(state: AppState) -> set[str]:
    tbs = _tax_benefit_system(state)
    if tbs is None:
        return set()
    return set(getattr(tbs, "variables", {}).keys())


def _fallback_target_config() -> tuple[dict | None, str | None]:
    try:
        import yaml
        import policyengine_us_data

        from pathlib import Path

        root = Path(policyengine_us_data.__file__).resolve().parent
        path = root / "calibration" / "target_config.yaml"
        if not path.exists():
            return None, None
        config = yaml.safe_load(path.read_text(encoding="utf-8")) or {}
        return config, f"installed_package:{path}"
    except Exception:
        return None, None


def _target_config_with_source(state: AppState) -> tuple[dict | None, str]:
    if state.target_config:
        return state.target_config, "run_artifact"
    config, source = _fallback_target_config()
    if config:
        return config, source or "installed_package"
    return None, "unavailable"


def _targets_with_inclusion(state: AppState) -> pd.DataFrame:
    targets = state.targets_enriched.copy()
    if targets.empty:
        return targets
    if not targets.get("included", pd.Series(False, index=targets.index)).any():
        config, _source = _target_config_with_source(state)
        if config:
            targets["included"] = _infer_included_from_config(targets, config)
    return targets


def _match_config_rules(targets: pd.DataFrame, rules: list[dict]) -> pd.Series:
    mask = pd.Series(False, index=targets.index)
    for rule in rules:
        mask |= _target_config_rule_mask(targets, rule)
    return mask


def _target_config_rule_mask(targets: pd.DataFrame, rule: dict) -> pd.Series:
    mask = pd.Series(True, index=targets.index)
    if "variable" in rule:
        mask &= targets["variable"].astype(str) == str(rule["variable"])
    if "geo_level" in rule:
        mask &= targets["geo_level"].astype(str) == str(rule["geo_level"])
    if "domain_variable" in rule:
        domain = targets.get("domain_variable", pd.Series("", index=targets.index))
        mask &= domain.fillna("").astype(str) == str(rule["domain_variable"])
    return mask


def _target_rows_for_variable(targets: pd.DataFrame, variable: str) -> pd.Series:
    if targets.empty:
        return pd.Series(False, index=targets.index)
    variable_col = targets.get("variable", pd.Series("", index=targets.index))
    direct = variable_col.fillna("").astype(str) == variable
    domain_col = targets.get("domain_variable", pd.Series("", index=targets.index))
    domain = domain_col.fillna("").astype(str)
    as_domain = domain.str.split(",").apply(
        lambda values: variable in {part.strip() for part in values if part.strip()}
    )
    return direct | as_domain


def _rule_mentions_variable(rule: dict, variable: str) -> bool:
    if str(rule.get("variable", "")) == variable:
        return True
    domain = str(rule.get("domain_variable", ""))
    return variable in {part.strip() for part in domain.split(",") if part.strip()}


def _infer_included_from_config(targets: pd.DataFrame, config: dict) -> pd.Series:
    include_rules = config.get("include", [])
    exclude_rules = config.get("exclude", [])
    if include_rules:
        keep = _match_config_rules(targets, include_rules)
    else:
        keep = pd.Series(True, index=targets.index)
    if exclude_rules:
        keep &= ~_match_config_rules(targets, exclude_rules)
    return keep


def _target_mask(df: pd.DataFrame, case: CaseStudy) -> pd.Series:
    variable = df.get("variable", pd.Series([], dtype=str)).fillna("").astype(str)
    domain = df.get("domain_variable", pd.Series("", index=df.index)).fillna("")
    domain = domain.astype(str)

    direct_variables = [
        v
        for v in case.primary_variables
        if v not in {"person_count", "household_count", "tax_unit_count"}
        and not v.endswith("_count")
    ]
    mask = variable.isin(direct_variables)
    for keyword in case.domain_keywords:
        mask = mask | domain.str.contains(keyword, case=False, regex=False)

    if case.state_fips is not None:
        gid = df.get("geographic_id", pd.Series("", index=df.index)).fillna("")
        geo = df.get("geo_level", pd.Series("", index=df.index)).fillna("")

        def _state_match(value, geo_level) -> bool:
            if geo_level == "national":
                return True
            s = str(value)
            if not s.isdigit():
                return False
            n = int(s)
            return n == case.state_fips or n // 100 == case.state_fips

        geo_mask = pd.Series(
            [_state_match(g, level) for g, level in zip(gid, geo)],
            index=df.index,
        )
        mask = mask & geo_mask
    return mask


def _finite_float(value) -> float | None:
    if value is None:
        return None
    try:
        f = float(value)
    except (TypeError, ValueError):
        return None
    return f if np.isfinite(f) else None


def _safe_bool(value) -> bool:
    try:
        if pd.isna(value):
            return False
    except (TypeError, ValueError):
        pass
    return bool(value)


def _error_summary(df: pd.DataFrame) -> dict[str, Any]:
    if df.empty:
        return {
            "count": 0,
            "evaluated": 0,
            "median_abs_rel_error": None,
            "max_abs_rel_error": None,
            "pct_under_10pct": None,
            "pct_under_25pct": None,
        }
    err = pd.to_numeric(df.get("abs_rel_error"), errors="coerce")
    finite = err[np.isfinite(err)]
    if finite.empty:
        return {
            "count": int(len(df)),
            "evaluated": 0,
            "median_abs_rel_error": None,
            "max_abs_rel_error": None,
            "pct_under_10pct": None,
            "pct_under_25pct": None,
        }
    return {
        "count": int(len(df)),
        "evaluated": int(len(finite)),
        "median_abs_rel_error": float(finite.median()),
        "max_abs_rel_error": float(finite.max()),
        "pct_under_10pct": float((finite < 0.10).mean()),
        "pct_under_25pct": float((finite < 0.25).mean()),
    }


def _bundle_summary(df: pd.DataFrame) -> dict[str, Any]:
    err = pd.to_numeric(df.get("abs_rel_error"), errors="coerce")
    finite = err[np.isfinite(err)]
    included = df.get("included", pd.Series(False, index=df.index)).fillna(False).astype(bool)
    if finite.empty:
        return {
            "target_count": int(len(df)),
            "included_target_count": int(included.sum()),
            "evaluated_target_count": 0,
            "median_abs_rel_error": None,
            "p90_abs_rel_error": None,
            "max_abs_rel_error": None,
            "pct_under_10pct": None,
            "pct_under_25pct": None,
        }
    return {
        "target_count": int(len(df)),
        "included_target_count": int(included.sum()),
        "evaluated_target_count": int(len(finite)),
        "median_abs_rel_error": float(finite.median()),
        "p90_abs_rel_error": float(finite.quantile(0.9)),
        "max_abs_rel_error": float(finite.max()),
        "pct_under_10pct": float((finite < 0.10).mean()),
        "pct_under_25pct": float((finite < 0.25).mean()),
    }


def _bundle_for_targets(state: AppState, dataset_file: str) -> pd.DataFrame:
    from backend.services.geo_utils import runtime_dataset_bundle_for

    available = None
    try:
        from backend.services.runs import get_dataset
        from backend.services.bundle_availability import published_bundles

        ds = get_dataset(state.dataset_id)
    except Exception:
        available = None
    else:
        if ds is not None:
            available = published_bundles(ds.repo_id, state.run_id)
            if available and dataset_file not in available:
                raise KeyError(f"Dataset file is not published for this run: {dataset_file}")

    targets = state.targets_enriched.copy()
    if targets.empty:
        return targets
    mask = targets.apply(
        lambda row: runtime_dataset_bundle_for(
            row.get("geo_level"),
            row.get("geographic_id"),
            available=available,
        )
        == dataset_file,
        axis=1,
    )
    return targets[mask].copy()


def build_bundle_health(
    state: AppState,
    *,
    dataset_file: str,
    limit: int = 10,
) -> dict[str, Any]:
    targets = _bundle_for_targets(state, dataset_file)
    bundle_evaluated = False
    evaluation_error: str | None = None
    if not targets.empty and dataset_file != "enhanced_cps_2024.h5":
        try:
            from backend.services.runs import get_dataset
            from backend.services.bundle_eval import evaluate_bundle

            ds = get_dataset(state.dataset_id)
            if ds is not None:
                targets = evaluate_bundle(
                    targets,
                    repo_id=ds.repo_id,
                    run_id=state.run_id,
                    bundle=dataset_file,
                    time_period=state.time_period,
                )
                bundle_evaluated = True
        except Exception as exc:
            evaluation_error = str(exc)

    summary = _bundle_summary(targets)
    variable_rows = []
    if not targets.empty:
        for variable, group in targets.groupby("variable", dropna=False):
            row = {"variable": str(variable), **_bundle_summary(group)}
            variable_rows.append(row)
        variable_rows.sort(
            key=lambda row: (
                -1 if row["median_abs_rel_error"] is None else row["median_abs_rel_error"],
                row["variable"],
            ),
            reverse=True,
        )

    if "abs_rel_error" in targets.columns:
        worst_df = targets.copy()
        worst_df["_sort_abs_rel_error"] = pd.to_numeric(
            worst_df["abs_rel_error"],
            errors="coerce",
        )
        worst_df = worst_df.sort_values("_sort_abs_rel_error", ascending=False)
    else:
        worst_df = targets

    worst_targets = []
    for _, row in worst_df.head(limit).iterrows():
        target_value = _finite_float(row.get("value"))
        estimate = _finite_float(row.get("estimate"))
        worst_targets.append(
            {
                "target_id": int(row["target_id"]) if pd.notna(row.get("target_id")) else None,
                "variable": str(row.get("variable", "")),
                "geo_level": str(row.get("geo_level", "")),
                "geographic_id": str(row.get("geographic_id", "")),
                "target_value": target_value,
                "estimate": estimate,
                "rel_error": _finite_float(row.get("rel_error")),
                "abs_rel_error": _finite_float(row.get("abs_rel_error")),
                "included": _safe_bool(row.get("included")),
                "source": str(row.get("source", "")) if pd.notna(row.get("source")) else None,
                "constraints": _constraints_for_row(row),
            }
        )

    return {
        "dataset_file": dataset_file,
        "bundle_evaluated": bundle_evaluated,
        "evaluation_error": evaluation_error,
        "summary": summary,
        "by_variable": variable_rows[:50],
        "worst_targets": worst_targets,
    }


def _group_coverage(df: pd.DataFrame) -> list[dict[str, Any]]:
    if df.empty:
        return []
    group_cols = ["variable", "geo_level", "domain_variable"]
    rows = []
    for keys, group in df.groupby(group_cols, dropna=False):
        included = group[group.get("included", False).astype(bool)]
        summary = _error_summary(included)
        rows.append(
            {
                "variable": keys[0] or "",
                "geo_level": keys[1] or "",
                "domain_variable": keys[2] or "",
                "target_count": int(len(group)),
                "included_count": int(len(included)),
                "evaluated_count": summary["evaluated"],
                "median_abs_rel_error": summary["median_abs_rel_error"],
                "max_abs_rel_error": summary["max_abs_rel_error"],
            }
        )
    rows.sort(
        key=lambda r: (
            r["geo_level"],
            r["variable"],
            r["domain_variable"],
        )
    )
    return rows


def _weight_quality(state: AppState, case: CaseStudy) -> dict[str, Any]:
    households = state.households_df
    if households is None or households.empty:
        return {
            "households": 0,
            "kish_effective_n": None,
            "top_1pct_weight_share": None,
            "top_5pct_weight_share": None,
        }
    df = households
    if case.state_fips is not None and "state" in df.columns:
        df = df[df["state"].astype(int) == case.state_fips]
    weights = pd.to_numeric(df.get("final_weight"), errors="coerce").fillna(0)
    total = float(weights.sum())
    if len(weights) == 0 or total <= 0:
        return {
            "households": int(len(df)),
            "kish_effective_n": None,
            "top_1pct_weight_share": None,
            "top_5pct_weight_share": None,
        }
    sorted_w = weights.sort_values(ascending=False).to_numpy()
    top_1_n = max(1, int(np.ceil(len(sorted_w) * 0.01)))
    top_5_n = max(1, int(np.ceil(len(sorted_w) * 0.05)))
    denom = float(np.square(weights).sum())
    return {
        "households": int(len(df)),
        "kish_effective_n": float(total**2 / denom) if denom > 0 else None,
        "top_1pct_weight_share": float(sorted_w[:top_1_n].sum() / total),
        "top_5pct_weight_share": float(sorted_w[:top_5_n].sum() / total),
    }


def _diagnosis(
    *,
    case: CaseStudy,
    modeled_matches: list[str],
    included: pd.DataFrame,
    target_summary: dict[str, Any],
    weight_quality: dict[str, Any],
) -> tuple[str, list[str], list[str]]:
    blockers: list[str] = []
    warnings: list[str] = []

    if case.modeled_variable_prefixes and not modeled_matches:
        blockers.append(
            "No existing PolicyEngine variable appears to model this state-specific reform."
        )
    if included.empty:
        blockers.append("No relevant targets are included in the calibration loss.")
    elif target_summary["evaluated"] == 0:
        blockers.append("Relevant in-loss targets have no available PE aggregate estimates.")

    max_err = target_summary.get("max_abs_rel_error")
    med_err = target_summary.get("median_abs_rel_error")
    if max_err is not None and max_err > 0.25:
        warnings.append("At least one relevant in-loss target is more than 25% off.")
    if med_err is not None and med_err > 0.10:
        warnings.append("Median relevant target error is above 10%.")
    if weight_quality.get("households") == 0:
        warnings.append("No households are available for the selected geography.")
    if _finite_float(weight_quality.get("top_1pct_weight_share")) is not None:
        if weight_quality["top_1pct_weight_share"] > 0.25:
            warnings.append("Top 1% of records carry more than 25% of weight.")

    if blockers:
        status = "blocked"
    elif warnings:
        status = "caution"
    else:
        status = "ready"
    return status, blockers, warnings


def build_readiness(case_id: str, state: AppState) -> dict[str, Any]:
    if case_id not in CASE_STUDIES:
        raise KeyError(case_id)
    case = CASE_STUDIES[case_id]
    target_config_source = "run_artifact"
    inferred_inclusion = False
    targets = state.targets_enriched.copy()
    if not targets.empty and not targets.get("included", pd.Series(False, index=targets.index)).any():
        config, target_config_source = _target_config_with_source(state)
        if config:
            targets["included"] = _infer_included_from_config(targets, config)
            inferred_inclusion = True
    if targets.empty:
        relevant = targets
    else:
        relevant = targets[_target_mask(targets, case)].copy()
    included = relevant[relevant.get("included", False).astype(bool)].copy()

    model_vars = _available_model_variables(state)
    modeled_matches = sorted(
        v
        for v in model_vars
        if any(v.startswith(prefix) for prefix in case.modeled_variable_prefixes)
    )
    present_dependency_variables = [
        v for v in case.dependency_variables if v in model_vars
    ]
    missing_dependency_variables = [
        v for v in case.dependency_variables if v not in model_vars
    ]

    target_summary = _error_summary(included)
    weight_quality = _weight_quality(state, case)
    status, blockers, warnings = _diagnosis(
        case=case,
        modeled_matches=modeled_matches,
        included=included,
        target_summary=target_summary,
        weight_quality=weight_quality,
    )
    if inferred_inclusion:
        warnings.append(
            "Target inclusion is inferred from target_config because "
            "published diagnostics were not available."
        )
        if status == "ready":
            status = "caution"

    recommendations = []
    if "federal_snap" == case.id:
        recommendations.extend(
            [
                "Compare national SNAP spending and state SNAP spending before interpreting reform costs.",
                "Check SNAP household-count targets when analyzing caseload-sensitive reforms.",
                "Use dependency tracing to review eligibility inputs such as household composition, income, and state rules.",
            ]
        )
    if "montana_ctc" == case.id:
        recommendations.extend(
            [
                "Add Montana-specific CTC variables and parameters in policyengine-us before treating this as a modeled current-law program.",
                "Keep Montana refundable CTC targets visible, but add non-refundable/total CTC targets if the reform affects those components.",
                "Run a Montana H5 bundle evaluation after changing CTC variables or target configuration.",
            ]
        )
    if "california_income_tax" == case.id:
        recommendations.extend(
            [
                "Trace ca_income_tax before changing parameters to confirm which income and credit nodes propagate.",
                "Check California state-level income_tax targets and California district income-tax support before using local estimates.",
                "Run the California state H5 bundle evaluation when validating aggregate impacts for CA-only reforms.",
            ]
        )
    if blockers:
        recommendations.append("Resolve blockers before using this dataset for headline estimates.")

    return {
        "case_study": {
            "id": case.id,
            "label": case.label,
            "description": case.description,
            "state_fips": case.state_fips,
            "primary_variables": list(case.primary_variables),
            "dependency_variables": list(case.dependency_variables),
        },
        "status": status,
        "blockers": blockers,
        "warnings": warnings,
        "target_summary": {
            "relevant_targets": int(len(relevant)),
            "included_targets": int(len(included)),
            "inclusion_inferred": inferred_inclusion,
            "target_config_source": target_config_source,
            **target_summary,
        },
        "target_coverage": _group_coverage(relevant),
        "modeled_variables": {
            "present_dependency_variables": present_dependency_variables,
            "missing_dependency_variables": missing_dependency_variables,
            "state_specific_matches": modeled_matches[:50],
        },
        "weight_quality": weight_quality,
        "recommendations": recommendations,
    }


def _base_trace_key(key: str) -> str:
    return key.split("<", 1)[0]


def _period_from_trace_key(key: str) -> str | None:
    if "<" not in key or ">" not in key:
        return None
    return key.split("<", 1)[1].split(",", 1)[0].split(">", 1)[0]


def _parse_constraints_from_target_name(target_name: str) -> list[str]:
    if not isinstance(target_name, str) or "[" not in target_name:
        return []
    try:
        bracket = target_name[target_name.index("[") + 1 : target_name.rindex("]")]
    except ValueError:
        return []
    if not bracket:
        return []
    return [c.strip() for c in bracket.split(",") if c.strip()]


def _constraints_for_row(row: pd.Series) -> list[str]:
    constraints = row.get("constraints")
    if isinstance(constraints, list):
        return [str(c) for c in constraints]
    return _parse_constraints_from_target_name(str(row.get("target_name", "")))


def _parse_constraint(constraint: str) -> tuple[str, str, str] | None:
    for op in (">=", "<=", "==", "!=", ">", "<", "="):
        if op in constraint:
            left, right = constraint.split(op, 1)
            return left.strip(), op, right.strip()
    return None


def _float_bound(value: str) -> float | None:
    try:
        return float(value)
    except (TypeError, ValueError):
        lowered = str(value).strip().lower()
        if lowered in {"inf", "+inf", "infinity", "+infinity"}:
            return float("inf")
        if lowered in {"-inf", "-infinity"}:
            return float("-inf")
    return None


def _format_bucket_bound(value: float | None) -> str:
    if value is None:
        return "?"
    if value == float("-inf"):
        return "-inf"
    if value == float("inf"):
        return "inf"
    return f"{value:,.0f}"


def _bucket_from_constraints(
    constraints: list[str],
    domain_variable: str,
) -> tuple[float | None, float | None, str] | None:
    lower: float | None = None
    upper: float | None = None
    equality: str | None = None
    for constraint in constraints:
        parsed = _parse_constraint(constraint)
        if parsed is None:
            continue
        variable, op, value = parsed
        if variable != domain_variable:
            continue
        bound = _float_bound(value)
        if op in {">", ">="}:
            lower = bound
        if op in {"<", "<="}:
            upper = bound
        if op in {"=", "=="}:
            equality = value

    if equality is not None:
        return None, None, f"{domain_variable} = {equality}"
    if lower is None and upper is None:
        return None
    if lower == float("-inf") and upper is not None:
        label = f"< {_format_bucket_bound(upper)}"
    elif upper == float("inf") and lower is not None:
        label = f">= {_format_bucket_bound(lower)}"
    else:
        label = f"{_format_bucket_bound(lower)} to {_format_bucket_bound(upper)}"
    return lower, upper, label


def build_domain_breakdown(
    state: AppState,
    *,
    variable: str | None = None,
    domain_variable: str = "adjusted_gross_income",
    geo_level: str | None = None,
) -> dict[str, Any]:
    targets = _targets_with_inclusion(state)
    if targets.empty:
        return {
            "variable": variable,
            "domain_variable": domain_variable,
            "geo_level": geo_level,
            "rows": [],
            "summary": {
                "target_count": 0,
                "included_target_count": 0,
                "evaluated_target_count": 0,
            },
        }

    domain_col = targets.get("domain_variable", pd.Series("", index=targets.index))
    mask = domain_col.fillna("").astype(str).str.split(",").apply(
        lambda values: domain_variable
        in {part.strip() for part in values if part.strip()}
    )
    if variable:
        mask &= targets.get("variable", pd.Series("", index=targets.index)).astype(str) == variable
    if geo_level:
        mask &= targets.get("geo_level", pd.Series("", index=targets.index)).astype(str) == geo_level

    scoped = targets[mask].copy()
    if scoped.empty:
        return {
            "variable": variable,
            "domain_variable": domain_variable,
            "geo_level": geo_level,
            "rows": [],
            "summary": {
                "target_count": 0,
                "included_target_count": 0,
                "evaluated_target_count": 0,
            },
        }

    bucket_values = []
    for _, row in scoped.iterrows():
        bucket = _bucket_from_constraints(_constraints_for_row(row), domain_variable)
        if bucket is None:
            bucket_values.append((None, None, "Unbucketed"))
        else:
            bucket_values.append(bucket)
    scoped["_bucket_lower"] = [b[0] for b in bucket_values]
    scoped["_bucket_upper"] = [b[1] for b in bucket_values]
    scoped["_bucket_label"] = [b[2] for b in bucket_values]

    rows = []
    for (lower, upper, label), group in scoped.groupby(
        ["_bucket_lower", "_bucket_upper", "_bucket_label"],
        dropna=False,
    ):
        included = group[group.get("included", False).astype(bool)]
        summary = _error_summary(included)
        rows.append(
            {
                "bucket": label,
                "lower": _finite_float(lower),
                "upper": _finite_float(upper),
                "target_count": int(len(group)),
                "included_target_count": int(len(included)),
                "evaluated_target_count": int(summary["evaluated"]),
                "median_abs_rel_error": summary["median_abs_rel_error"],
                "max_abs_rel_error": summary["max_abs_rel_error"],
                "variables": sorted(
                    group.get("variable", pd.Series("", index=group.index))
                    .fillna("")
                    .astype(str)
                    .unique()
                    .tolist()
                ),
                "geo_levels": sorted(
                    group.get("geo_level", pd.Series("", index=group.index))
                    .fillna("")
                    .astype(str)
                    .unique()
                    .tolist()
                ),
            }
        )

    rows.sort(
        key=lambda row: (
            float("-inf") if row["lower"] is None else row["lower"],
            float("inf") if row["upper"] is None else row["upper"],
            row["bucket"],
        )
    )
    included_all = scoped[scoped.get("included", False).astype(bool)]
    summary_all = _error_summary(included_all)
    return {
        "variable": variable,
        "domain_variable": domain_variable,
        "geo_level": geo_level,
        "rows": rows,
        "summary": {
            "target_count": int(len(scoped)),
            "included_target_count": int(len(included_all)),
            "evaluated_target_count": int(summary_all["evaluated"]),
            "median_abs_rel_error": summary_all["median_abs_rel_error"],
            "max_abs_rel_error": summary_all["max_abs_rel_error"],
        },
    }


def _node_meta(variable: str, state: AppState) -> dict[str, Any]:
    tbs = _tax_benefit_system(state)
    tbs_vars = getattr(tbs, "variables", {}) if tbs is not None else {}
    var = tbs_vars.get(variable)
    targets = _targets_with_inclusion(state)
    target_variable = False
    domain_variable = False
    included_target_count = 0
    target_count = 0
    direct_target_count = 0
    domain_target_count = 0
    evaluated_target_count = 0
    median_abs_rel_error = None
    max_abs_rel_error = None
    if targets is not None and not targets.empty:
        variable_col = targets.get("variable", pd.Series([], dtype=str)).fillna("")
        target_mask = variable_col.astype(str) == variable
        domain_col = targets.get("domain_variable", pd.Series("", index=targets.index))
        domain_col = domain_col.fillna("").astype(str)
        domain_mask = domain_col.str.split(",").apply(
            lambda xs: variable in {part.strip() for part in xs if part.strip()}
        )
        relevant = targets[target_mask | domain_mask]
        included = relevant[relevant.get("included", False).astype(bool)]
        summary = _error_summary(included)
        target_variable = bool(target_mask.any())
        domain_variable = bool(domain_mask.any())
        direct_target_count = int(target_mask.sum())
        domain_target_count = int(domain_mask.sum())
        target_count = int(len(relevant))
        included_target_count = int(len(included))
        evaluated_target_count = int(summary["evaluated"])
        median_abs_rel_error = summary["median_abs_rel_error"]
        max_abs_rel_error = summary["max_abs_rel_error"]

    stored_inputs = set(getattr(_sim_from_state(state), "input_variables", []) or [])
    is_formula = bool(getattr(var, "formulas", None)) if var is not None else False
    is_aggregate = bool(getattr(var, "adds", None) or getattr(var, "subtracts", None))
    entity = getattr(getattr(var, "entity", None), "key", None) if var is not None else None
    label = getattr(var, "label", None) if var is not None else None

    return {
        "variable": variable,
        "label": label or variable,
        "entity": entity,
        "is_policyengine_variable": var is not None,
        "is_formula": is_formula,
        "is_aggregate": is_aggregate,
        "is_stored_input": variable in stored_inputs,
        "is_target_variable": target_variable,
        "is_domain_variable": domain_variable,
        "target_count": target_count,
        "direct_target_count": direct_target_count,
        "domain_target_count": domain_target_count,
        "included_target_count": included_target_count,
        "evaluated_target_count": evaluated_target_count,
        "median_abs_rel_error": median_abs_rel_error,
        "max_abs_rel_error": max_abs_rel_error,
    }


def build_dependency_trace(
    variable: str,
    state: AppState,
    *,
    period: int | None = None,
    max_nodes: int = 250,
) -> dict[str, Any]:
    sim = _sim_from_state(state)
    tbs = _tax_benefit_system(state)
    if sim is None or tbs is None:
        raise RuntimeError("No PolicyEngine simulation is available for this run.")
    if variable not in getattr(tbs, "variables", {}):
        raise KeyError(variable)

    previous_trace = getattr(sim, "trace", False)
    try:
        # The PolicyEngine tracer only sees dependencies that are recalculated.
        # Cached formula outputs otherwise produce a one-node trace.
        invalidate = getattr(sim, "_invalidate_all_caches", None)
        if callable(invalidate):
            invalidate()
        else:
            delete_arrays = getattr(sim, "delete_arrays", None)
            if callable(delete_arrays):
                delete_arrays(variable, period or state.time_period)
        sim.trace = True
        sim.calculate(variable, period=period or state.time_period)
        trace = sim.tracer.get_flat_trace()
    finally:
        try:
            sim.trace = previous_trace
        except Exception:
            pass

    root_key = next((k for k in trace if _base_trace_key(k) == variable), None)
    if root_key is None:
        raise RuntimeError(f"Trace did not contain root variable {variable}.")

    reachable: set[str] = set()
    ordered: list[str] = []
    depth_by_key = {root_key: 0}
    queue = deque([root_key])
    while queue:
        key = queue.popleft()
        if key in reachable or key not in trace:
            continue
        reachable.add(key)
        ordered.append(key)
        for dep in trace[key].get("dependencies", []):
            if dep not in depth_by_key:
                depth_by_key[dep] = depth_by_key[key] + 1
            queue.append(dep)

    truncated = len(ordered) > max_nodes
    ordered = ordered[:max_nodes]
    returned = set(ordered)

    nodes = []
    edges = []
    for key in ordered:
        variable_name = _base_trace_key(key)
        deps = [d for d in trace[key].get("dependencies", []) if d in returned]
        meta = _node_meta(variable_name, state)
        nodes.append(
            {
                "id": key,
                "variable": variable_name,
                "period": _period_from_trace_key(key),
                "depth": depth_by_key.get(key, 0),
                "dependency_count": len(trace[key].get("dependencies", [])),
                "is_leaf": len(trace[key].get("dependencies", [])) == 0,
                **meta,
            }
        )
        edges.extend({"from": key, "to": dep} for dep in deps)

    leaf_nodes = [n for n in nodes if n["is_leaf"]]
    summary = {
        "total_trace_nodes": int(len(reachable)),
        "returned_nodes": int(len(nodes)),
        "truncated": truncated,
        "leaf_nodes": int(len(leaf_nodes)),
        "stored_leaf_nodes": int(sum(n["is_stored_input"] for n in leaf_nodes)),
        "targeted_leaf_nodes": int(
            sum(n["is_target_variable"] or n["is_domain_variable"] for n in leaf_nodes)
        ),
        "untargeted_stored_leaf_nodes": int(
            sum(
                n["is_stored_input"]
                and not n["is_target_variable"]
                and not n["is_domain_variable"]
                for n in leaf_nodes
            )
        ),
    }
    return {
        "variable": variable,
        "root": root_key,
        "summary": summary,
        "nodes": nodes,
        "edges": edges,
    }


def audit_target_config(
    state: AppState,
    *,
    variable: str | None = None,
) -> dict[str, Any]:
    config, source = _target_config_with_source(state)
    config = config or {}
    targets = _targets_with_inclusion(state)
    rules = list(config.get("include", [])) + list(config.get("exclude", []))
    scope = targets
    if variable:
        scope = targets[_target_rows_for_variable(targets, variable)].copy()

    out_rules = []
    for section in ("include", "exclude"):
        for idx, rule in enumerate(config.get(section, [])):
            mask = _target_config_rule_mask(scope, rule)
            matched = int(mask.sum())
            if variable and matched == 0 and not _rule_mentions_variable(rule, variable):
                continue
            out_rules.append(
                {
                    "section": section,
                    "index": idx,
                    "rule": rule,
                    "matched_targets": matched,
                    "status": "zero_match" if matched == 0 else "matched",
                }
            )

    zero = [r for r in out_rules if r["matched_targets"] == 0]
    return {
        "has_target_config": bool(config),
        "target_config_source": source,
        "selected_variable": variable,
        "target_count": int(len(scope)),
        "included_target_count": int(
            scope.get("included", pd.Series(False, index=scope.index))
            .fillna(False)
            .astype(bool)
            .sum()
        ),
        "rule_count": len(rules),
        "zero_match_count": len(zero),
        "matched_rule_count": len(out_rules) - len(zero),
        "rules": out_rules,
    }
