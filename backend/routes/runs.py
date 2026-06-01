"""Endpoints for run discovery and dataset listing."""

from fastapi import APIRouter, HTTPException

from backend.services import runs as runs_service

router = APIRouter()


@router.get("/datasets")
def list_datasets():
    return [
        {
            "id": d.id,
            "label": d.label,
            "repo_id": d.repo_id,
            "primary_h5": d.primary_h5,
        }
        for d in runs_service.list_datasets()
    ]


@router.get("/runs")
def list_runs(dataset: str):
    try:
        runs = runs_service.list_runs(dataset)
    except KeyError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    return [
        {
            "dataset_id": r.dataset_id,
            "run_id": r.run_id,
            "label": r.label,
            "last_modified": r.last_modified,
        }
        for r in runs
    ]
