"""Analyst readiness endpoints."""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Query

from backend.services.analysis_readiness import (
    audit_target_config,
    build_dependency_trace,
    build_domain_breakdown,
    build_bundle_health,
    build_readiness,
    list_case_studies,
    list_policyengine_variables,
)
from backend.state import AppState, get_state

router = APIRouter()


@router.get("/case-studies")
def case_studies() -> dict:
    return {"items": list_case_studies()}


@router.get("/variables")
def variables(
    search: str | None = None,
    limit: int = Query(100, ge=1, le=500),
    state: AppState = Depends(get_state),
) -> dict:
    return {
        "items": list_policyengine_variables(
            state,
            search=search,
            limit=limit,
        )
    }


@router.get("/readiness/{case_study_id}")
def readiness(
    case_study_id: str,
    state: AppState = Depends(get_state),
) -> dict:
    try:
        return build_readiness(case_study_id, state)
    except KeyError as exc:
        raise HTTPException(
            status_code=404,
            detail=f"Unknown case study: {case_study_id}",
        ) from exc


@router.get("/dependency/{variable}")
def dependency_trace(
    variable: str,
    period: int | None = None,
    max_nodes: int = Query(250, ge=25, le=1000),
    state: AppState = Depends(get_state),
) -> dict:
    try:
        return build_dependency_trace(
            variable,
            state,
            period=period,
            max_nodes=max_nodes,
        )
    except KeyError as exc:
        raise HTTPException(
            status_code=404,
            detail=f"Unknown PolicyEngine variable: {variable}",
        ) from exc
    except RuntimeError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc


@router.get("/target-config-audit")
def target_config_audit(
    variable: str | None = None,
    state: AppState = Depends(get_state),
) -> dict:
    return audit_target_config(state, variable=variable)


@router.get("/domain-breakdown")
def domain_breakdown(
    variable: str | None = None,
    domain_variable: str = "adjusted_gross_income",
    geo_level: str | None = None,
    state: AppState = Depends(get_state),
) -> dict:
    return build_domain_breakdown(
        state,
        variable=variable,
        domain_variable=domain_variable,
        geo_level=geo_level,
    )


@router.get("/bundle-health")
def bundle_health(
    dataset_file: str,
    limit: int = Query(10, ge=1, le=100),
    state: AppState = Depends(get_state),
) -> dict:
    try:
        return build_bundle_health(
            state,
            dataset_file=dataset_file,
            limit=limit,
        )
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
