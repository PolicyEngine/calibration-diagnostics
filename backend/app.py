"""FastAPI application factory with lifespan for artifact loading."""

import logging
import os
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from backend.routes import (
    decompose,
    epochs,
    geography,
    households,
    statistics,
    strata,
    targets,
    weights,
)
from backend.services.loader import load_all_artifacts

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s - %(levelname)s - %(message)s",
)
logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI):
    config = {
        "package_path": os.environ.get(
            "PACKAGE_PATH", "calibration_package.pkl"
        ),
        "weights_path": os.environ.get(
            "WEIGHTS_PATH", "calibration_weights.npy"
        ),
        "db_path": os.environ.get("DB_PATH", "policy_data.db"),
        "dataset_path": os.environ.get(
            "DATASET_PATH", "source_imputed_stratified_extended_cps.h5"
        ),
        "cal_log_path": os.environ.get("CAL_LOG_PATH"),
        "diagnostics_path": os.environ.get("DIAGNOSTICS_PATH"),
    }
    logger.info("Loading artifacts with config: %s", config)
    state = load_all_artifacts(config)
    app.state.diagnostics = state
    logger.info(
        "Ready: %d targets, %d households",
        state.n_targets,
        state.n_households,
    )
    yield


app = FastAPI(
    title="Calibration Diagnostics API",
    description="Interactive diagnostics for survey weight calibration",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(geography.router, prefix="/geography", tags=["geography"])
app.include_router(targets.router, prefix="/targets", tags=["targets"])
app.include_router(decompose.router, tags=["decompose"])
app.include_router(strata.router, prefix="/strata", tags=["strata"])
app.include_router(households.router, prefix="/households", tags=["households"])
app.include_router(weights.router, prefix="/weights", tags=["weights"])
app.include_router(statistics.router, prefix="/statistics", tags=["statistics"])
app.include_router(epochs.router, prefix="/epochs", tags=["epochs"])


@app.get("/health")
def health(request: Request):
    state = request.app.state.diagnostics
    return {
        "status": "ok",
        "n_targets": state.n_targets,
        "n_households": state.n_households,
        "time_period": state.time_period,
        "has_cal_log": state.cal_log is not None,
        "has_db": state.db_engine is not None,
    }


@app.exception_handler(ValueError)
async def value_error_handler(request: Request, exc: ValueError):
    return JSONResponse(status_code=400, content={"detail": str(exc)})


@app.exception_handler(IndexError)
async def index_error_handler(request: Request, exc: IndexError):
    return JSONResponse(status_code=404, content={"detail": "Index out of range"})
