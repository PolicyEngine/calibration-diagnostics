"""FastAPI application for the populace-US calibration dashboard.

A thin API layer over the populace-US dataset published on Hugging Face: it
resolves the current release via ``latest.json`` and serves release manifests,
per-target calibration diagnostics, and version-over-version comparisons,
reading everything live from the Hub. The Next.js API routes are the primary
API surface; this mirrors them for local development and Python clients.
"""

import logging

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from backend.routes import populace

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s - %(levelname)s - %(message)s",
)
logger = logging.getLogger(__name__)

app = FastAPI(
    title="Populace calibration diagnostics API",
    description="Live diagnostics for the populace-US synthetic population",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(populace.router, tags=["populace"])


@app.get("/health")
def health():
    return {"status": "ok", "dataset": "policyengine/populace-us"}


@app.exception_handler(ValueError)
async def value_error_handler(request: Request, exc: ValueError):
    return JSONResponse(status_code=400, content={"detail": str(exc)})
