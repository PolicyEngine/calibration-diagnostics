"""Modal deployment for the calibration-diagnostics FastAPI backend.

Serves ``backend/app.py``'s ASGI app (the "Calibration Diagnostics API") so the
Vercel-hosted frontend has a live Python backend for the run-based calibration
views (datasets, runs, weights, strata, geography, microsim estimates). The
populace and microplex dashboards also work through this backend, though the
frontend can serve those from its own same-origin Next.js API routes when
``NEXT_PUBLIC_API_URL`` is left unset.

The backend is self-contained: it discovers and downloads every calibration run
artifact from HuggingFace at request time (``backend/services/runs.py``), so the
image only needs the Python deps plus the committed data files the routes read
directly (``backend/data`` and ``frontend/data/microplex|populace``).

Deploy with:
    modal deploy modal_app.py

The deployed URL prints as
``https://policyengine--calibration-diagnostics-api.modal.run``.
Set that as ``NEXT_PUBLIC_API_URL`` on the Vercel project, then redeploy the
frontend.
"""

from __future__ import annotations

import modal

app = modal.App("calibration-diagnostics")

# Deps mirror pyproject.toml's [project].dependencies, plus the libraries the
# service layer imports directly (h5 IO, yaml target config, HF discovery).
# policyengine-us / -us-data are unpinned so a fresh deploy bakes in current
# latest, matching how the calibration runs on HF are built.
image = (
    modal.Image.debian_slim(python_version="3.12")
    .apt_install("git")
    .pip_install(
        "fastapi>=0.115.0",
        "uvicorn[standard]>=0.30.0",
        "numpy",
        "pandas",
        "scipy",
        "sqlalchemy",
        "sqlmodel",
        "pyyaml",
        "tables>=3.10.2",
        "h5py",
        "huggingface_hub",
        "policyengine-us",
        "policyengine-us-data",
    )
    # The FastAPI package + the committed data files its routes read. Layout
    # mirrors the repo so microplex.py's repo-root anchor
    # (Path(__file__).resolve().parents[2]) resolves /root/frontend/data/...
    # These are runtime mounts (copy=False): the files are only needed when a
    # request runs, not during image build, so there's no reason to bake them
    # into image layers (which needs a builder container and is slow).
    .add_local_dir(
        "backend",
        remote_path="/root/backend",
        ignore=[
            "__pycache__/**",
            "**/__pycache__/**",
            "**/*.pyc",
        ],
    )
    .add_local_dir(
        "frontend/data",
        remote_path="/root/frontend/data",
    )
)


@app.function(
    image=image,
    cpu=4.0,
    memory=16384,
    # Loading a calibration run (download HF artifacts + evaluate PE variables
    # on the published h5) can take a while on a cold run; give it headroom.
    timeout=900,
    # Stay warm 5 min after the last request so the run cache survives bursts.
    scaledown_window=300,
)
@modal.concurrent(max_inputs=8)
@modal.asgi_app(label="calibration-diagnostics-api")
def web():
    """Serve the calibration-diagnostics FastAPI app."""
    from backend.app import app as fastapi_app

    return fastapi_app
