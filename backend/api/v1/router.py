"""Stable v1 API routes for programmatic calibration diagnostics."""

from __future__ import annotations

from pathlib import Path
from time import perf_counter
from typing import Annotated

import numpy as np
import pandas as pd
from fastapi import APIRouter, HTTPException, Query, Request

from backend.api.v1.models import (
    BundleItem,
    BundleListResponse,
    CompareRequest,
    CompareResponse,
    CompareSideMetadata,
    CompareTargetRow,
    CompareVariableRow,
    ComparisonSide,
    DatasetItem,
    DatasetListResponse,
    EvaluationRequest,
    EvaluationResponse,
    EvaluationResult,
    ProvenanceInfo,
    RunItem,
    RunListResponse,
    SummaryMetrics,
    SummaryResponse,
    TargetItem,
    TargetListResponse,
)
from backend.services import runs as runs_service
from backend.services.bundle_availability import published_bundles
from backend.services.geo_utils import (
    STATE_FIPS_TO_ABBREV,
    runtime_dataset_bundle_for,
    state_name,
)
from backend.state import AppState

router = APIRouter(prefix="/api/v1", tags=["api-v1"])


@router.get("/datasets")
def list_datasets_v1() -> DatasetListResponse:
    return DatasetListResponse(
        items=[
            DatasetItem(
                dataset_id=d.id,
                label=d.label,
                repo_id=d.repo_id,
                repo_type=d.repo_type,
                layout=d.layout,
                primary_h5=d.primary_h5,
            )
            for d in runs_service.list_datasets()
        ]
    )


@router.get("/datasets/{dataset_id}/runs")
def list_runs_v1(dataset_id: str) -> RunListResponse:
    try:
        runs = runs_service.list_runs(dataset_id)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc))
    return RunListResponse(
        dataset_id=dataset_id,
        items=[
            RunItem(
                dataset_id=r.dataset_id,
                run_id=r.run_id,
                label=r.label,
                last_modified=r.last_modified,
            )
            for r in runs
        ],
    )


@router.get("/datasets/{dataset_id}/runs/{run_id}/bundles")
def list_bundles_v1(
    request: Request,
    dataset_id: str,
    run_id: str,
    kind: str | None = None,
    state_fips: int | None = None,
    include_target_counts: bool = True,
    include_cache_status: bool = True,
) -> BundleListResponse:
    dataset = _get_dataset_or_404(dataset_id)
    bundles = sorted(published_bundles(dataset.repo_id, run_id))
    state = (
        _load_state(request, dataset_id, run_id)
        if include_target_counts or include_cache_status
        else None
    )
    counts = _bundle_target_counts(state, bundles) if state is not None else {}
    included_counts = (
        _bundle_target_counts(state, bundles, included_only=True)
        if state is not None
        else {}
    )

    items: list[BundleItem] = []
    for bundle in bundles:
        item = _bundle_item(bundle)
        if kind and item.kind != kind:
            continue
        if state_fips is not None:
            if item.kind != "state" or item.geography_id != str(state_fips):
                continue
        if include_target_counts:
            item.target_count = counts.get(bundle, 0)
            item.included_target_count = included_counts.get(bundle, 0)
        if include_cache_status:
            item.cache_status = _bundle_cache_status(dataset.repo_id, run_id, bundle)
        items.append(item)

    return BundleListResponse(dataset_id=dataset_id, run_id=run_id, items=items)


@router.get("/datasets/{dataset_id}/runs/{run_id}/summary")
def get_summary_v1(
    request: Request,
    dataset_id: str,
    run_id: str,
    bundle: str | None = None,
    included: bool | None = None,
    geo_level: Annotated[list[str] | None, Query()] = None,
    state_fips: Annotated[list[int] | None, Query()] = None,
) -> SummaryResponse:
    dataset = _get_dataset_or_404(dataset_id)
    state = _load_state(request, dataset_id, run_id)
    active_bundle = bundle or dataset.primary_h5
    df = _prepare_targets(
        state,
        dataset,
        run_id,
        bundle=active_bundle if bundle else None,
        geo_level=geo_level,
        state_fips=state_fips,
        included=included,
    )
    return _summary_response(
        state,
        dataset,
        run_id,
        active_bundle,
        df,
    )


@router.get("/datasets/{dataset_id}/runs/{run_id}/targets")
def list_targets_v1(
    request: Request,
    dataset_id: str,
    run_id: str,
    bundle: str | None = None,
    geo_level: Annotated[list[str] | None, Query()] = None,
    state_fips: Annotated[list[int] | None, Query()] = None,
    geographic_id: str | None = None,
    variable: Annotated[list[str] | None, Query()] = None,
    source: Annotated[list[str] | None, Query()] = None,
    included: bool | None = None,
    min_abs_rel_error: float | None = None,
    sort: str = "abs_rel_error",
    order: str = "desc",
    limit: Annotated[int, Query(ge=1, le=5000)] = 50,
    offset: Annotated[int, Query(ge=0)] = 0,
) -> TargetListResponse:
    dataset = _get_dataset_or_404(dataset_id)
    state = _load_state(request, dataset_id, run_id)
    active_bundle = bundle or dataset.primary_h5
    df = _prepare_targets(
        state,
        dataset,
        run_id,
        bundle=active_bundle if bundle else None,
        geo_level=geo_level,
        state_fips=state_fips,
        geographic_id=geographic_id,
        variable=variable,
        source=source,
        included=included,
        min_abs_rel_error=min_abs_rel_error,
    )
    total = len(df)
    if sort in df.columns:
        df = df.sort_values(sort, ascending=(order == "asc"))
    page = df.iloc[offset : offset + limit]
    return TargetListResponse(
        dataset_id=dataset_id,
        run_id=run_id,
        bundle=active_bundle,
        items=[_target_item(row, active_bundle) for _, row in page.iterrows()],
        total=total,
        offset=offset,
        limit=limit,
    )


@router.get("/datasets/{dataset_id}/runs/{run_id}/targets/{target_id}")
def get_target_v1(
    request: Request,
    dataset_id: str,
    run_id: str,
    target_id: int,
    bundle: str | None = None,
) -> TargetItem:
    dataset = _get_dataset_or_404(dataset_id)
    state = _load_state(request, dataset_id, run_id)
    active_bundle = bundle or dataset.primary_h5
    df = _prepare_targets(
        state,
        dataset,
        run_id,
        bundle=active_bundle if bundle else None,
    )
    match = df[df["target_id"].astype("Int64") == target_id]
    if match.empty:
        raise HTTPException(status_code=404, detail=f"Unknown target_id: {target_id}")
    return _target_item(match.iloc[0], active_bundle)


@router.post("/evaluate")
def evaluate_v1(
    request: Request,
    payload: EvaluationRequest,
) -> EvaluationResponse:
    start = perf_counter()
    dataset = _get_dataset_or_404(payload.dataset_id)
    state = _load_state(request, payload.dataset_id, payload.run_id)
    active_bundle = payload.bundle or dataset.primary_h5
    filters = payload.filters
    before_status = _bundle_cache_status(dataset.repo_id, payload.run_id, active_bundle)
    df = _prepare_targets(
        state,
        dataset,
        payload.run_id,
        bundle=active_bundle if payload.bundle else None,
        geo_level=filters.geo_level,
        state_fips=filters.state_fips,
        geographic_id=filters.geographic_id,
        variable=filters.variable,
        source=filters.source,
        included=filters.included,
        min_abs_rel_error=filters.min_abs_rel_error,
    )
    limited = df.head(max(0, payload.limit))
    computed = int(
        np.isfinite(limited.get("estimate", pd.Series(dtype=float)).to_numpy(dtype=float)).sum()
    )
    after_status = _bundle_cache_status(dataset.repo_id, payload.run_id, active_bundle)
    params = [f"bundle={active_bundle}"]
    if filters.included is not None:
        params.append(f"included={str(filters.included).lower()}")
    for level in filters.geo_level or []:
        params.append(f"geo_level={level}")
    for fips in filters.state_fips or []:
        params.append(f"state_fips={fips}")
    query = "&".join(params)
    items_url = (
        f"/api/v1/datasets/{payload.dataset_id}/runs/{payload.run_id}/targets"
        f"?{query}"
    )
    return EvaluationResponse(
        status="complete",
        cache_status=after_status if after_status != "not_computed" else before_status,
        elapsed_ms=(perf_counter() - start) * 1000,
        result=EvaluationResult(
            target_count=int(len(limited)),
            computed_target_count=computed,
            items_url=items_url,
        ),
    )


@router.post("/compare")
def compare_v1(
    request: Request,
    payload: CompareRequest,
) -> CompareResponse:
    side_a = _comparison_side(request, payload.a)
    side_b = _comparison_side(request, payload.b)
    merged = _merge_comparison_targets(side_a["df"], side_b["df"])
    if merged.empty:
        raise HTTPException(
            status_code=400,
            detail="No compatible targets matched between comparison sides.",
        )

    valid = merged.dropna(subset=["abs_rel_error_a", "abs_rel_error_b"]).copy()
    if valid.empty:
        computed_pair_count = 0
        improved_rows: list[CompareTargetRow] = []
        regressed_rows: list[CompareTargetRow] = []
        by_variable: list[CompareVariableRow] = []
        improved_count = 0
        regressed_count = 0
    else:
        valid["delta_abs_rel_error"] = (
            valid["abs_rel_error_b"] - valid["abs_rel_error_a"]
        )
        computed_pair_count = int(len(valid))
        improved = valid[valid["delta_abs_rel_error"] < 0]
        regressed = valid[valid["delta_abs_rel_error"] > 0]
        improved_count = int(len(improved))
        regressed_count = int(len(regressed))
        improved_rows = [
            _compare_target_row(row, side_a["bundle"], side_b["bundle"])
            for _, row in improved.nsmallest(
                payload.top_n,
                "delta_abs_rel_error",
            ).iterrows()
        ]
        regressed_rows = [
            _compare_target_row(row, side_a["bundle"], side_b["bundle"])
            for _, row in regressed.nlargest(
                payload.top_n,
                "delta_abs_rel_error",
            ).iterrows()
        ]
        by_variable = _compare_by_variable(valid, payload.top_n)

    return CompareResponse(
        a=_compare_side_metadata(side_a),
        b=_compare_side_metadata(side_b),
        matched_target_count=int(len(merged)),
        computed_pair_count=computed_pair_count,
        improved_count=improved_count,
        regressed_count=regressed_count,
        improved=improved_rows,
        regressed=regressed_rows,
        by_variable=by_variable,
    )


def _get_dataset_or_404(dataset_id: str):
    try:
        return runs_service.get_dataset(dataset_id)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc))


def _load_state(request: Request, dataset_id: str, run_id: str) -> AppState:
    try:
        return request.app.state.registry.get(dataset_id, run_id)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc))
    except Exception as exc:
        raise HTTPException(
            status_code=500,
            detail=f"Failed to load run {dataset_id}/{run_id}: {exc}",
        )


def _available_bundles(dataset, run_id: str) -> frozenset[str]:
    if dataset.layout not in {"staging", "root"}:
        return frozenset()
    return published_bundles(dataset.repo_id, run_id)


def _prepare_targets(
    state: AppState,
    dataset,
    run_id: str,
    *,
    bundle: str | None = None,
    geo_level: list[str] | None = None,
    state_fips: list[int] | None = None,
    geographic_id: str | None = None,
    variable: list[str] | None = None,
    source: list[str] | None = None,
    included: bool | None = None,
    min_abs_rel_error: float | None = None,
) -> pd.DataFrame:
    from backend.routes.targets import _apply_target_filters
    from backend.services.bundle_eval import evaluate_bundle

    available = _available_bundles(dataset, run_id)
    df = _apply_target_filters(
        state.targets_enriched,
        variables=variable,
        geo_levels=geo_level,
        sources=source,
        geographic_id=geographic_id,
        state_fips=state_fips,
        included_only=included,
        min_abs_rel_error=min_abs_rel_error,
        dataset_files=[bundle] if bundle else None,
        available_bundles=available,
    ).copy()

    if (
        bundle
        and bundle in available
        and bundle != dataset.primary_h5
        and not df.empty
    ):
        df = evaluate_bundle(
            df,
            repo_id=dataset.repo_id,
            run_id=run_id,
            bundle=bundle,
            time_period=state.time_period,
        )
    return df


def _comparison_side(request: Request, side: ComparisonSide) -> dict:
    dataset = _get_dataset_or_404(side.dataset_id)
    state = _load_state(request, side.dataset_id, side.run_id)
    active_bundle = side.bundle or dataset.primary_h5
    filters = side.filters
    df = _prepare_targets(
        state,
        dataset,
        side.run_id,
        bundle=active_bundle if side.bundle else None,
        geo_level=filters.geo_level,
        state_fips=filters.state_fips,
        geographic_id=filters.geographic_id,
        variable=filters.variable,
        source=filters.source,
        included=filters.included,
        min_abs_rel_error=filters.min_abs_rel_error,
    )
    return {
        "dataset": dataset,
        "state": state,
        "run_id": side.run_id,
        "bundle": active_bundle,
        "df": df,
    }


def _merge_comparison_targets(df_a: pd.DataFrame, df_b: pd.DataFrame) -> pd.DataFrame:
    keep = [
        "target_id",
        "target_name",
        "variable",
        "geo_level",
        "geographic_id",
        "value",
        "estimate",
        "rel_error",
        "abs_rel_error",
        "included",
    ]
    a = df_a[[col for col in keep if col in df_a.columns]].dropna(
        subset=["target_id"],
    )
    b = df_b[[col for col in keep if col in df_b.columns]].dropna(
        subset=["target_id"],
    )
    a = a.rename(columns={col: f"{col}_a" for col in keep if col != "target_id"})
    b = b.rename(columns={col: f"{col}_b" for col in keep if col != "target_id"})
    merged = a.merge(b, on="target_id", how="inner")
    if merged.empty:
        return merged

    compatible = pd.Series(True, index=merged.index)
    for field in ("target_name", "variable", "geo_level", "geographic_id"):
        left = f"{field}_a"
        right = f"{field}_b"
        if left in merged.columns and right in merged.columns:
            compatible &= (
                merged[left].astype("string").fillna("")
                == merged[right].astype("string").fillna("")
            )
    return merged[compatible].copy()


def _compare_side_metadata(side: dict) -> CompareSideMetadata:
    summary = _summary_response(
        side["state"],
        side["dataset"],
        side["run_id"],
        side["bundle"],
        side["df"],
    )
    return CompareSideMetadata(
        dataset_id=summary.dataset_id,
        run_id=summary.run_id,
        bundle=summary.bundle,
        target_count=summary.target_universe_count,
        computed_target_count=summary.computed_target_count,
        metrics=summary.metrics,
        provenance=summary.provenance,
    )


def _compare_target_row(
    row: pd.Series,
    bundle_a: str,
    bundle_b: str,
) -> CompareTargetRow:
    estimate_a = _safe_float(row.get("estimate_a"))
    estimate_b = _safe_float(row.get("estimate_b"))
    return CompareTargetRow(
        target_id=_safe_int(row.get("target_id")),
        target_name=str(row.get("target_name_a", "")),
        variable=str(row.get("variable_a", "")),
        geo_level=_none_if_nan(row.get("geo_level_a")),
        geographic_id=(
            None if _none_if_nan(row.get("geographic_id_a")) is None
            else str(_none_if_nan(row.get("geographic_id_a")))
        ),
        target_value_a=_safe_float(row.get("value_a")),
        target_value_b=_safe_float(row.get("value_b")),
        pe_aggregate_a=estimate_a,
        pe_aggregate_b=estimate_b,
        rel_error_a=_safe_float(row.get("rel_error_a")),
        rel_error_b=_safe_float(row.get("rel_error_b")),
        abs_rel_error_a=_safe_float(row.get("abs_rel_error_a")),
        abs_rel_error_b=_safe_float(row.get("abs_rel_error_b")),
        delta_abs_rel_error=_safe_float(row.get("delta_abs_rel_error")),
        included_in_loss_a=bool(row.get("included_a", False)),
        included_in_loss_b=bool(row.get("included_b", False)),
        computed_from_bundle_a=bundle_a if estimate_a is not None else None,
        computed_from_bundle_b=bundle_b if estimate_b is not None else None,
    )


def _compare_by_variable(
    valid: pd.DataFrame,
    top_n: int,
) -> list[CompareVariableRow]:
    if valid.empty:
        return []
    rows: list[CompareVariableRow] = []
    grouped = valid.groupby("variable_a", dropna=False)
    for variable, df in grouped:
        deltas = df["delta_abs_rel_error"]
        rows.append(
            CompareVariableRow(
                variable=str(variable),
                target_count=int(len(df)),
                mean_abs_rel_error_a=_safe_float(df["abs_rel_error_a"].mean()),
                mean_abs_rel_error_b=_safe_float(df["abs_rel_error_b"].mean()),
                mean_delta_abs_rel_error=_safe_float(deltas.mean()),
                improved_count=int((deltas < 0).sum()),
                regressed_count=int((deltas > 0).sum()),
            )
        )
    return sorted(
        rows,
        key=lambda row: abs(row.mean_delta_abs_rel_error or 0),
        reverse=True,
    )[:top_n]


def _bundle_target_counts(
    state: AppState | None,
    available: list[str],
    *,
    included_only: bool = False,
) -> dict[str, int]:
    if state is None or state.targets_enriched.empty:
        return {}
    df = state.targets_enriched
    if included_only:
        df = df[df["included"].astype(bool)]
    available_set = frozenset(available)
    counts: dict[str, int] = {}
    for _, row in df.iterrows():
        bundle = runtime_dataset_bundle_for(
            row.get("geo_level"),
            row.get("geographic_id"),
            available=available_set,
        )
        counts[bundle] = counts.get(bundle, 0) + 1
    return counts


def _bundle_item(bundle: str) -> BundleItem:
    if bundle.startswith("states/") and bundle.endswith(".h5"):
        code = bundle.removeprefix("states/").removesuffix(".h5")
        fips = next(
            (f for f, abbrev in STATE_FIPS_TO_ABBREV.items() if abbrev == code),
            None,
        )
        return BundleItem(
            bundle=bundle,
            kind="state",
            geography_id=str(fips) if fips is not None else None,
            geography_name=state_name(fips) if fips is not None else code,
        )
    if bundle.startswith("districts/"):
        return BundleItem(
            bundle=bundle,
            kind="district",
            geography_name=bundle.removeprefix("districts/").removesuffix(".h5"),
        )
    if bundle.startswith("national/"):
        return BundleItem(bundle=bundle, kind="national", geography_id="US", geography_name="National")
    if bundle.startswith("cities/"):
        return BundleItem(
            bundle=bundle,
            kind="city",
            geography_name=bundle.removeprefix("cities/").removesuffix(".h5"),
        )
    return BundleItem(bundle=bundle, kind="primary")


def _bundle_cache_status(
    repo_id: str,
    run_id: str,
    bundle: str,
    cache_root: str = ".artifacts",
) -> str:
    repo_slug = repo_id.replace("/", "__")
    layout_dir = "root" if run_id == "main" else "staging"
    safe = bundle.replace("/", "__")
    cache = (
        Path(cache_root) / repo_slug / layout_dir / run_id
        / f"{safe}.bundle_estimates.pkl"
    )
    return "computed" if cache.exists() else "not_computed"


def _summary_response(
    state: AppState,
    dataset,
    run_id: str,
    bundle: str,
    df: pd.DataFrame,
) -> SummaryResponse:
    rel = df.get("rel_error", pd.Series(dtype=float)).to_numpy(dtype=float)
    abs_rel = df.get("abs_rel_error", pd.Series(dtype=float)).to_numpy(dtype=float)
    finite = np.isfinite(rel) & np.isfinite(abs_rel)
    abs_finite = abs_rel[finite]
    included = df["included"].astype(bool) if "included" in df.columns else pd.Series(False, index=df.index)
    loss_available = bool(included.any())
    included_rel = rel[included.to_numpy(dtype=bool)] if len(rel) else np.array([])
    included_rel = included_rel[np.isfinite(included_rel)]
    return SummaryResponse(
        dataset_id=state.dataset_id,
        run_id=run_id,
        bundle=bundle,
        target_universe_count=int(len(df)),
        included_target_count=int(included.sum()),
        computed_target_count=int(finite.sum()),
        loss_contribution_available=loss_available,
        metrics=SummaryMetrics(
            median_abs_rel_error=_safe_float(np.median(abs_finite)) if len(abs_finite) else None,
            mean_abs_rel_error=_safe_float(np.mean(abs_finite)) if len(abs_finite) else None,
            p95_abs_rel_error=_safe_float(np.percentile(abs_finite, 95)) if len(abs_finite) else None,
            total_loss=(
                _safe_float(np.sum(included_rel ** 2))
                if loss_available and len(included_rel)
                else None
            ),
        ),
        provenance=_provenance(dataset, bundle),
    )


def _target_item(row: pd.Series, bundle: str) -> TargetItem:
    included = bool(row.get("included", False))
    estimate = _safe_float(row.get("estimate"))
    return TargetItem(
        target_id=_safe_int(row.get("target_id")),
        target_name=str(row.get("target_name", "")),
        variable=str(row.get("variable", "")),
        geo_level=_none_if_nan(row.get("geo_level")),
        geographic_id=(
            None if _none_if_nan(row.get("geographic_id")) is None
            else str(_none_if_nan(row.get("geographic_id")))
        ),
        target_value=_safe_float(row.get("value")),
        pe_aggregate=estimate,
        rel_error=_safe_float(row.get("rel_error")),
        abs_rel_error=_safe_float(row.get("abs_rel_error")),
        included_in_loss=included,
        loss_contribution=_safe_float(row.get("loss_contribution")) if included else None,
        computed_from_bundle=bundle if estimate is not None else None,
        target_value_source="policy_data.db",
        included_source="unified_diagnostics.csv" if included else None,
        calibration_pattern_source=None,
        eval_note=_none_if_nan(row.get("eval_note")),
    )


def _provenance(dataset, bundle: str) -> ProvenanceInfo:
    diagnostics = (
        "calibration/logs/unified_diagnostics.csv"
        if dataset.layout == "root"
        else "calibration/runs/<run_id>/diagnostics/unified_diagnostics.csv"
    )
    return ProvenanceInfo(
        target_db="policy_data.db",
        diagnostics=diagnostics,
        aggregate_source=bundle,
        calibration_pattern_source=None,
    )


def _safe_float(value) -> float | None:
    if value is None or pd.isna(value):
        return None
    try:
        out = float(value)
    except (TypeError, ValueError):
        return None
    return out if np.isfinite(out) else None


def _safe_int(value) -> int | None:
    if value is None or pd.isna(value):
        return None
    try:
        return int(value)
    except (TypeError, ValueError):
        return None


def _none_if_nan(value):
    if value is None or pd.isna(value):
        return None
    return value
