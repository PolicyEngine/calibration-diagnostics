# Cross-dataset artifact API

The Cross-dataset API serves immutable evaluation artifacts; an HTTP request
never imports or runs PolicyEngine or Tax-Calculator. The current approved run
contains Microcosm + PolicyEngine-US, Tax-Calculator + public CPS, and raw 2024
ACS PUMS. Yale is deferred pending a reproducible reconstruction, and the API
is source-agnostic so it can be added later without changing the response
contract.

## Publish frontend partitions

After a full evaluation run, publish the web partitions from the same pinned
Chronicle snapshot and content-addressed evaluation artifact:

```bash
uv run python scripts/publish_cross_dataset_frontend_bundle.py \
  --snapshot /path/to/ledger-snapshot \
  --run /path/to/evaluation-run \
  --output /path/to/evaluation-run/frontend
```

`scripts/run_full_ledger_evaluation.py` performs this step automatically for
new runs. The publisher verifies the snapshot and every hash in the evaluation
run before writing. It emits a manifest, summary and group partitions, a fact
index, and bounded fact pages. Every partition carries the immutable run and
snapshot IDs and has a SHA-256 recorded in the manifest.

## Configure the application

For local use, point the server at the generated bundle and optionally pin the
expected content-addressed run ID:

```bash
export CROSS_DATASET_ARTIFACT_DIR=/path/to/evaluation-run/frontend
export CROSS_DATASET_EXPECTED_RUN_ID=evaluation-...
npm run dev
```

Hosted deployments can instead set `CROSS_DATASET_ARTIFACT_BASE_URL` to an
HTTP(S) directory containing the same files. Configure exactly one local or
remote location. A missing, stale, partial, malformed, or hash-mismatched
bundle returns HTTP 503 rather than serving mixed results.

## Read the API

`GET /api/populace/cross-dataset` accepts these views:

- `view=summary` (default): source-level score, coverage, capability statuses,
  unsupported reasons, and period treatments.
- `view=groups`: groups by `ledger_source`, `concept`, observed `period`,
  `geography`, `period_treatment`, or `calibration_exposure`; optional
  `dimension` and `source` filters.
- `view=source&source=...`: one source and its group results.
- `view=facts`: paginated facts, with optional `source`, `status`,
  `ledger_source`, `measure`, `period`, `geography`, `period_treatment`,
  `calibration_exposure`, and `search` filters. Source-specific filters require
  `source`.
- `view=fact&fact_key=...`: one Chronicle observation and its sparse source cells,
  including capability, mapping, estimate, benchmark, error, period treatment,
  calibration exposure, alignment provenance, and dataset uncertainty where
  applicable.

Fact filters use the bundle's page index to fetch only candidate partitions.
The API never sends the entire Chronicle catalog to the browser.
