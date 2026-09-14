# Microcosm calibration diagnostics

Interactive dashboard for PolicyEngine's calibrated **Microcosm** synthetic
populations for the US, UK, and Belgium. Each country is published as its own
Hugging Face dataset; the US repository is public, while the UK and Belgium
repositories require a server-side Hugging Face token.

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
- **Staging runs** (`/microcosm/staging`) — monitor pre-release US Microcosm build
  runs from the staging Hub repo: current stage, calibration loss progress,
  final candidate diagnostics once uploaded, candidate-vs-current-release fit,
  and a hierarchical map of weighted target-error increases and reductions.
  Countries without a staging repository show an explicit unavailable state.
- **Calibration target investigations** (`docs/ai/`) — tool-independent procedures,
  specialist review responsibilities, and a reusable checklist for identifying
  the cause of a discrepant target from release artifacts and relevant source
  repositories.

## API

The Next.js route handlers are the API layer; all read live from Hugging Face:

Published-release endpoints accept `country=us|uk|be` (default `us`).

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
| `GET /api/microcosm/staging/target-change-tree?run=<run_id>&release=<resolved_id>&mode=reported\|shared&...` | One hierarchy level of weighted target-error changes for a staging candidate and an explicit current release |

The staging target-change route supports two comparison modes. `reported` uses
each release's actual target weights and complete target surface, including
added and removed targets. `shared` restricts the calculation to shared targets,
normalizes each release's weights over that shared set, averages the two shares
target by target, and applies the resulting pooled weights to both releases.

Version and staging comparisons use the same normalized target matcher. It first
matches an exact period-normalized target name, then a unique Chronicle fact key,
then an exact structured source/statistic/measure/dimensions identity. A key must
identify one remaining target on each side; ambiguous keys are reported and left
unmatched. Comparison responses include the representation of each target, the
matching method, both release identifiers, and counts by matching method.

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
make dev       # first available loopback port, starting at 3000
make typecheck # tsc --noEmit
make test      # frontend data and development-launcher tests
make build     # next build
```

The development launcher prints the selected dashboard URL and records its port
in `frontend/.next/dev-port`. Set `PORT` to begin the search at a different
port; if that port is occupied on the IPv4 or IPv6 loopback address, the
launcher increments by one until it finds a port that is free on both network
families. Next.js binds to `127.0.0.1`, and the launcher prints that exact URL
to avoid hostname resolution selecting a different local process.

Run the Python Chronicle evaluation harness and its public numerical adapter
gate manually when reviewing Chronicle or dependency updates:

```bash
uv run python scripts/verify_evaluation_harness.py
```

The hosted variable lookup has a separate Python environment in
`backend/requirements.lock`. Its US/Core/SPM pins protect the existing model;
update them together with the certified Microcosm data release. Do not use the
root evaluation lock to install this service. Check the hosted assembly without
loading a population with:

```bash
uv venv --python 3.12 .tmp/hosted-runtime
uv pip install --python .tmp/hosted-runtime/bin/python \
  --require-hashes -r backend/requirements.lock
uv pip install --python .tmp/hosted-runtime/bin/python \
  'pytest>=8.3,<9' httpx==0.28.1 modal==1.5.5
uv pip check --python .tmp/hosted-runtime/bin/python
UV_PROJECT_ENVIRONMENT=.tmp/hosted-runtime uv run --no-sync \
  python frontend/scripts/verify_hosted_runtime.py
UV_PROJECT_ENVIRONMENT=.tmp/hosted-runtime uv run --no-sync \
  python -m pytest frontend/tests -q
```

`/api/microcosm_variable?metadata=1` reports installed packages and the deployment
commit, when available, without downloading a dataset. The mounted equivalent
is `/calibration/dashboard/api/microcosm_variable?metadata=1`. Its
`data_configuration` describes repository settings, not a verified loaded
release. Calculation responses include observed `runtime` versions. See
[the hosted runtime procedure](frontend/HOSTED_RUNTIME.md) for the separate
canonical model/data migration and deployment verification gates.

See [the Chronicle update workflow](docs/chronicle-update-workflow.md) for the
optional Microcosm and ACS inputs and the separate full-artifact command.

The US hosted application uses its reviewed immutable release. Leave
`POPULACE_HF_REPO` and `POPULACE_HF_REVISION` unset; conflicting overrides fail
validation and must be removed before a production rebuild. Optional
`POPULACE_UK_HF_REPO`, `POPULACE_UK_HF_REVISION` configure the UK;
and `POPULACE_BE_HF_REPO`, `POPULACE_BE_HF_REVISION` for Belgium. The Belgium
repository defaults in code to `policyengine/populace-be-private`. Set `HF_TOKEN`
or `HUGGINGFACE_TOKEN` to read private datasets. Each country with the
`staging` capability declares its own staging repository in the country
registry; it never falls back to another country's repository. US staging
defaults to `policyengine/populace-us-staging`; override it with the
backward-compatible `POPULACE_STAGING_HF_REPO` and
`POPULACE_STAGING_HF_REVISION` variables. UK staging defaults to the private dataset
`policyengine/populace-uk-staging`; configure its server-only read credential as
`POPULACE_UK_STAGING_HF_TOKEN`, and optionally override the dataset or revision
with `POPULACE_UK_STAGING_HF_REPO` or `POPULACE_UK_STAGING_HF_REVISION`. Never
use a `NEXT_PUBLIC_` variable for a private-repository credential.

The staging contract fixtures under
`frontend/lib/microcosm/fixtures/staging-contract/` are byte-identical copies
of Microcosm's canonical producer fixtures. The consumer tests pin each
version's `SHA256SUMS` digest and verify every listed file. A contract change
must update the canonical Microcosm fixture, its digest manifest, this copy,
and both repositories' contract tests in their respective feature branches.
