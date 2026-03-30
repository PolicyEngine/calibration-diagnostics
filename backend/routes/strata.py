"""Strata browser endpoint."""

from fastapi import APIRouter, Depends, HTTPException
from sqlmodel import Session

from backend.app import get_state
from backend.models import StratumDetail
from backend.services import db_service
from backend.state import AppState

router = APIRouter()


@router.get("/{stratum_id}")
def get_stratum(
    stratum_id: int,
    state: AppState = Depends(get_state),
) -> StratumDetail:
    if state.db_engine is None:
        raise HTTPException(status_code=503, detail="No database connected")

    with Session(state.db_engine) as session:
        detail = db_service.get_stratum_detail(session, stratum_id)

    if detail is None:
        raise HTTPException(
            status_code=404, detail=f"Stratum {stratum_id} not found"
        )
    return StratumDetail(**detail)
