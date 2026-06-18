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
- **Staging runs** (`/populace/staging`) — monitor pre-release Populace build
  runs from the staging Hub repo: current stage, calibration loss progress,
  final candidate diagnostics once uploaded, and candidate-vs-latest fit.
- **Agentic investigations** (`.claude/`) — Claude Code slash command,
  specialist agents, and a reusable skill for root-causing a discrepant target
  from release artifacts and relevant source repos.

## API

The Next.js route handlers are the API layer; all read live from Hugging Face:

| Endpoint | Purpose |
|---|---|
| `GET /api/populace/releases` | List published releases (newest first) |
| `GET /api/populace?release=<id>` | Release summary (default: latest) |
| `GET /api/populace/target-diagnostics?release=<id>&...` | Faceted per-target diagnostics |
| `GET /api/populace/target-investigation?target=<id>&release=<id>` | Copyable investigation packet for one target: fit evidence, ledger metadata, artifact paths, repo searches, and next checks |
| `GET /api/populace/compare?a=<id>&b=<id>` | Version-over-version diff |
| `GET /api/populace/staging/runs` | List staging build runs |
| `GET /api/populace/staging/run?id=<run_id>` | One staging run's progress and uploaded candidate diagnostics |
| `GET /api/populace/staging/target-diagnostics?id=<run_id>&...` | Faceted diagnostics for a staging candidate once diagnostics exist |
| `GET /api/populace/staging/compare?run=<run_id>&release=latest` | Diff staging candidate against a published release |

## Agentic target investigations

The dashboard is only the observation surface. Root-cause work should run through
the Claude Code harness in `.claude/`.

```text
/investigate-populace-target --release <release-id> <target-id>
```

The command fetches a target packet, then coordinates specialist agents for
ledger/source semantics, Populus materialization, PolicyEngine model mapping,
and calibration mechanics. The underlying packet can also be fetched directly:

```bash
node scripts/populace-investigation-packet.mjs \
  --release populace-us-2024-incumbent-improved-996401a-20260618 \
  irs_soi.ty2022.historic_table_2.us.under_1.ctc_amount \
  --out investigations/ctc-under-1.json
```

## Develop

```bash
make install   # cd frontend && bun install
make dev       # next dev (http://localhost:3000)
make typecheck # tsc --noEmit
make test      # bun test (data-layer suite)
make build     # next build
```

Optional env: `POPULACE_HF_REPO`, `POPULACE_HF_REVISION` to point at a different
published dataset/revision. Staging defaults to `policyengine/populace-us-staging`;
set `POPULACE_STAGING_HF_REPO`, `POPULACE_STAGING_HF_REVISION`, and `HF_TOKEN`
if the staging dataset is private.
