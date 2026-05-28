"""FastAPI application factory.

The backend hosts a registry of loaded calibration runs; each request
selects a run via ?dataset & ?run query params. See backend.state.get_state.
"""

import logging
import os
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from backend.routes import (
    compare,
    geography,
    nodes,
    pipeline,
    runs as runs_route,
    strata,
    summary,
    target_inventory,
    targets,
    weights,
)
from backend.services import runs as runs_service
from backend.services.registry import RunRegistry

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s - %(levelname)s - %(message)s",
)
logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI):
    cache_size = int(os.environ.get("RUN_CACHE_SIZE", "3"))
    app.state.registry = RunRegistry(max_size=cache_size)

    # Optional warm-load of a default run, so /health and existing endpoints
    # work without query params during development.
    default = runs_service.default_selection()
    if default is not None:
        dataset_id, run_id = default
        logger.info("Warming default run %s/%s", dataset_id, run_id)
        try:
            app.state.registry.get(dataset_id, run_id)
        except Exception:
            logger.exception("Failed to warm-load default run")
    else:
        logger.info(
            "No DEFAULT_DATASET/DEFAULT_RUN set; clients must pass "
            "?dataset & ?run query params."
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

app.include_router(runs_route.router, tags=["runs"])
app.include_router(summary.router, tags=["summary"])
app.include_router(pipeline.router, tags=["pipeline"])
app.include_router(target_inventory.router, tags=["target-inventory"])
app.include_router(nodes.router, tags=["nodes"])
app.include_router(compare.router, tags=["compare"])
app.include_router(geography.router, prefix="/geography", tags=["geography"])
app.include_router(targets.router, prefix="/targets", tags=["targets"])
app.include_router(strata.router, prefix="/strata", tags=["strata"])
app.include_router(weights.router, prefix="/weights", tags=["weights"])


@app.get("/health")
def health(request: Request):
    registry: RunRegistry = request.app.state.registry
    return {
        "status": "ok",
        "loaded_runs": [
            {"dataset": d, "run": r} for d, r in registry.loaded_keys()
        ],
        "default": runs_service.default_selection(),
    }


@app.exception_handler(ValueError)
async def value_error_handler(request: Request, exc: ValueError):
    return JSONResponse(status_code=400, content={"detail": str(exc)})


@app.exception_handler(IndexError)
async def index_error_handler(request: Request, exc: IndexError):
    return JSONResponse(status_code=404, content={"detail": "Index out of range"})
