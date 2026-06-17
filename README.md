# Populace calibration diagnostics

Interactive dashboard for the **populace-US** synthetic population — PolicyEngine's
calibrated microdataset published on Hugging Face at
[`policyengine/populace-us`](https://huggingface.co/datasets/policyengine/populace-us).

Everything is read **live from Hugging Face**: the current release is resolved
through `latest.json`, and each release's manifests and per-target calibration
diagnostics are fetched on demand. There is no committed data snapshot and no
separate service layer — the Next.js API routes are the API layer.

## What it shows

- **Release summary** (`/populace`) — calibration loss and convergence, within-10%
  and within-tolerance, records kept after L0, acceptance gates, solver
  provenance, per-family fit, and worst-fit / biggest-improvement targets, for
  the current release (or any release via `?release=`).
- **Target diagnostics** (`/populace/targets`) — browse the calibration target
  surface by the quantity each constraint measures (e.g. *adjusted gross income*),
  then drill its breakdown dimensions (income band x return type x filing status,
  geography, ...). Every axis a variable varies on becomes a filterable, sortable
  facet, and any target opens a canonical detail card (structured registry
  fields, source citation, initial -> final -> target).
- **Compare versions** (`/populace/compare`) — diff two releases: targets matched
  by name, common targets get a fit change, and added/removed targets are
  surfaced.

## API

The Next.js route handlers are the API layer; all read live from Hugging Face:

| Endpoint | Purpose |
|---|---|
| `GET /api/populace/releases` | List published releases (newest first) |
| `GET /api/populace?release=<id>` | Release summary (default: latest) |
| `GET /api/populace/target-diagnostics?release=<id>&...` | Faceted per-target diagnostics |
| `GET /api/populace/compare?a=<id>&b=<id>` | Version-over-version diff |

## Develop

```bash
make install   # cd frontend && bun install
make dev       # next dev (http://localhost:3000)
make typecheck # tsc --noEmit
make test      # bun test (data-layer suite)
make build     # next build
```

Optional env: `POPULACE_HF_REPO`, `POPULACE_HF_REVISION` to point at a different
dataset/revision.
