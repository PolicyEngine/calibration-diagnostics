# Calibration Diagnostics

Interactive tool for diagnosing calibration quality in PolicyEngine's Enhanced CPS dataset builds. Provides a FastAPI backend and Next.js frontend for exploring calibration artifacts — sparse matrices, target databases, calibration logs, and Microsimulation outputs.

## What this does

After the PolicyEngine data pipeline calibrates survey weights against ~3,000 demographic and economic targets, this tool helps answer:

- **Which targets have the worst fit?** Sortable/filterable target table with error metrics and pull scores.
- **Why is a target badly fit?** Error decomposition (raw data vs initial weights vs final weights), contributor analysis, and automated constraint auditing against the targets database.
- **Which households are distorted?** Filter by g-weight and any variable to find households whose weights shifted most, inspect their full variable profiles, and see which targets are pulling their weights.
- **What shifted under calibration?** Decompose any composite variable (e.g., `spm_unit_net_income`) into its formula dependencies and see which components changed most.
- **How did calibration converge?** Per-target and per-category error traces over training epochs.

## Architecture

```
backend/       Python FastAPI (20 endpoints)
frontend/      Next.js 15 + React 19 + @policyengine/ui-kit
```

The backend loads calibration artifacts at startup and exposes REST endpoints. The frontend calls these endpoints and provides interactive visualization.

## Quick start

### Frontend (fixture mode — no backend needed)

```bash
cd frontend
bun install
NEXT_PUBLIC_USE_FIXTURES=true bun run dev
```

Open http://localhost:3000. All views render with sample data.

### Backend

Requires calibration artifacts (calibration_package.pkl, calibration_weights.npy, policy_data.db, CPS H5 dataset).

```bash
pip install -e .
PACKAGE_PATH=/path/to/calibration_package.pkl \
WEIGHTS_PATH=/path/to/calibration_weights.npy \
DB_PATH=/path/to/policy_data.db \
DATASET_PATH=/path/to/extended_cps_2024.h5 \
uvicorn backend.app:app --reload
```

### Both via Make

```bash
make install-frontend
make install-backend
make frontend   # starts frontend on port 3000
make backend    # starts backend on port 8000
```

## Frontend views

| View | Description |
|------|-------------|
| Overview | Weight distribution stats, income distribution comparison, worst-fit targets |
| Target Explorer | Sortable target table with detail panel (error decomposition, provenance, constraint audit, contributors, convergence) |
| Weight Landscape | G-weight histogram with metric/slice controls, distribution stats |
| Variable Decomposition | Decompose any variable into shifted components |
| Household Inspector | Filter distorted households by any variable, inspect profiles and target attributions |
| Convergence | Per-category and per-target error traces over epochs |

## Backend endpoints

20 endpoints across 7 route groups:

- `POST /decompose` — variable decomposition
- `GET /targets`, `/targets/search`, `/targets/poverty-impact`, `/targets/{id}/error-decomposition`, `/targets/{id}/provenance`, `/targets/{id}/eligibility-audit`, `/targets/{id}/constraint-diff`, `/targets/{id}/contributors`, `/targets/{id}/convergence`
- `GET /strata/{id}`
- `GET /households/distorted`, `/households/{id}/profile`, `/households/{id}/attributions`
- `GET /weights/distribution`, `/weights/histogram`
- `GET /statistics/poverty-rate`, `/statistics/income-distribution`
- `GET /epochs/summary`, `/epochs/traces`

## Dependencies

**Backend:** FastAPI, uvicorn, policyengine-us-data, policyengine-us, scipy, numpy, pandas, sqlalchemy, sqlmodel

**Frontend:** Next.js 15, React 19, @policyengine/ui-kit, TanStack React Query v5, Tailwind CSS v4, Recharts
