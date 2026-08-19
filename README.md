# Microcosm calibration diagnostics

Interactive dashboard for the **microcosm-US** synthetic population — PolicyEngine's
calibrated microdataset published on Hugging Face at
[`policyengine/populace-us`](https://huggingface.co/datasets/policyengine/populace-us).

> Deprecated upstream identifiers: Microcosm's current Hugging Face slugs,
> release/file names, deployment variables, and Chronicle wire contracts still
> use `populace`/`ledger`; see
> [upstream identifier compatibility](docs/upstream-identifier-compatibility.md).

Everything is read **live from Hugging Face**: the current release is resolved
through `latest.json`, and each release's manifests and per-target calibration
diagnostics are fetched on demand. There is no committed data snapshot and no
separate service layer — the Next.js API routes are the API layer.

## What it shows

- **Release summary** (`/microcosm`) — calibration fit KPIs, target coverage,
  per-family fit, and worst-fit / biggest-improvement targets, for the current
  release (or any release via `?release=`).
- **Target diagnostics** (`/microcosm/targets`) — browse the calibration target
  surface by the quantity each constraint measures (e.g. *adjusted gross income*),
  then drill its breakdown dimensions (income band x return type x filing status,
  geography, ...). Every axis a variable varies on becomes a filterable, sortable
  facet, and any target opens a canonical detail card (structured registry
  fields, source citation, initial -> final -> target).
- **Compare versions** (`/microcosm/compare`) — diff two releases: targets matched
  by name, common targets get a fit change, and added/removed targets are
  surfaced.
- **Staging runs** (`/microcosm/staging`) — monitor pre-release Microcosm build
  runs from the staging Hub repo: current stage, calibration loss progress,
  final candidate diagnostics once uploaded, and candidate-vs-latest fit.
- **Calibration target investigations** (`docs/ai/`) — tool-independent procedures,
  specialist review responsibilities, and a reusable checklist for identifying
  the cause of a discrepant target from release artifacts and relevant source
  repositories.

## API

The Next.js route handlers are the API layer; all read live from Hugging Face:

| Endpoint | Purpose |
|---|---|
| `GET /api/microcosm/releases` | List published releases (newest first) |
| `GET /api/microcosm?release=<id>` | Release summary (default: latest) |
| `GET /api/microcosm/target-diagnostics?release=<id>&...` | Faceted per-target diagnostics |
| `GET /api/microcosm/target-investigation?target=<id>&release=<id>` | Copyable investigation packet for one target: fit evidence, chronicle metadata, artifact paths, repo searches, and next checks |
| `GET /api/microcosm/compare?a=<id>&b=<id>` | Version-over-version diff |
| `GET /api/microcosm/staging/runs` | List staging build runs |
| `GET /api/microcosm/staging/run?id=<run_id>` | One staging run's progress and uploaded candidate diagnostics |
| `GET /api/microcosm/staging/target-diagnostics?id=<run_id>&...` | Faceted diagnostics for a staging candidate once diagnostics exist |
| `GET /api/microcosm/staging/compare?run=<run_id>&release=latest` | Diff staging candidate against a published release |

## Calibration target investigations

The dashboard identifies discrepancies. Determine their cause from a target
investigation packet, release artifacts, and relevant source code by following
[the shared investigation workflow](docs/ai/workflows/investigate-microcosm-target.md).

```bash
node scripts/microcosm-investigation-packet.mjs \
  --release <release-id> <target-id> \
  --out investigations/latest-target-packet.json
```

The workflow separates reviews of Chronicle source semantics, target
materialization, PolicyEngine model mapping, and calibration calculations before
combining their evidence into one report.

## Develop

```bash
make install   # cd frontend && bun install
make dev       # next dev (http://localhost:3000)
make typecheck # tsc --noEmit
make test      # bun test (data-layer suite)
make build     # next build
```

Run the Python Chronicle evaluation harness and its public numerical adapter
gate manually when reviewing Chronicle or dependency updates:

```bash
uv run python scripts/verify_evaluation_harness.py
```

See [the Chronicle update workflow](docs/chronicle-update-workflow.md) for the
optional Microcosm and ACS inputs and the separate full-artifact command.

Optional env: `POPULACE_HF_REPO`, `POPULACE_HF_REVISION` to point at a different
published dataset/revision. Staging defaults to `policyengine/populace-us-staging`;
set `POPULACE_STAGING_HF_REPO`, `POPULACE_STAGING_HF_REVISION`, and `HF_TOKEN`
if the staging dataset is private.
