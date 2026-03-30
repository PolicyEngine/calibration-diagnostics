"""Epoch-level calibration analysis endpoints."""

from fastapi import APIRouter, Depends, HTTPException, Query

from backend.app import get_state
from backend.models import ConvergencePoint, EpochSummaryRow
from backend.state import AppState

router = APIRouter()


@router.get("/summary")
def epoch_summary(
    group_by: str = "variable",
    state: AppState = Depends(get_state),
) -> list[EpochSummaryRow]:
    if state.cal_log is None:
        raise HTTPException(status_code=404, detail="No calibration log available")

    log = state.cal_log
    enriched = state.targets_enriched

    # Build a mapping from target_name to the group_by column
    name_to_group = {}
    for idx, row in enriched.iterrows():
        name = row.get("target_name", "")
        name_to_group[name] = str(row.get(group_by, "unknown"))

    log = log.copy()
    log["group"] = log["target_name"].map(name_to_group).fillna("unknown")

    grouped = log.groupby(["group", "epoch"])["rel_abs_error"].mean().reset_index()
    grouped.columns = ["group", "epoch", "mean_abs_rel_error"]

    return [
        EpochSummaryRow(
            group=str(r["group"]),
            epoch=int(r["epoch"]),
            mean_abs_rel_error=float(r["mean_abs_rel_error"]),
        )
        for _, r in grouped.iterrows()
    ]


@router.get("/traces")
def epoch_traces(
    target_indices: str | None = Query(None),
    variable: str | None = None,
    state: AppState = Depends(get_state),
) -> list[dict]:
    if state.cal_log is None:
        raise HTTPException(status_code=404, detail="No calibration log available")

    target_name_set = set()

    if target_indices:
        for idx_str in target_indices.split(","):
            idx = int(idx_str.strip())
            if 0 <= idx < state.n_targets:
                target_name_set.add(state.target_names[idx])

    if variable:
        for idx, row in state.targets_enriched.iterrows():
            if variable.lower() in str(row.get("variable", "")).lower():
                name = row.get("target_name", "")
                if name:
                    target_name_set.add(name)

    if not target_name_set:
        raise HTTPException(
            status_code=400,
            detail="Provide target_indices or variable to filter traces",
        )

    log = state.cal_log
    filtered = log[log["target_name"].isin(target_name_set)]

    result = []
    for name, group in filtered.groupby("target_name"):
        epochs = [
            ConvergencePoint(
                epoch=int(r["epoch"]),
                estimate=float(r["estimate"]),
                target=float(r["target"]),
                rel_error=float(r["rel_error"]),
                loss=float(r["loss"]),
            )
            for _, r in group.sort_values("epoch").iterrows()
        ]
        result.append({
            "target_name": name,
            "epochs": [e.model_dump() for e in epochs],
        })
    return result
