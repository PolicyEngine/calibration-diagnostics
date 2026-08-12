# Cross-dataset artifact API

The Cross-dataset API serves immutable evaluation artifacts; an HTTP request
never imports or runs a microsimulation model. The current approved run
contains Microcosm + PolicyEngine-US, Public CPS + Tax-Calculator, Yale
Tax-Data + Tax-Simulator (reconstruction), and raw 2024 ACS PUMS. The Yale item
is a byte-pinned, precomputed reconstruction checkpoint, not official Yale
output and not a claim that the underlying PUF-based run can be reproduced from
public inputs alone.

This page is explicitly US-only. The run records `jurisdictions: [US]` and
filters the immutable Chronicle source snapshot before capability
classification. Its current scope is 46,241 US facts. The pinned snapshot
contains no non-US facts; future snapshots will still exclude any non-US rows
before capability classification.

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

The compatibility route `GET /api/populace/cross-dataset` accepts these views;
the `populace` path segment is a legacy internal identifier for Microcosm:

- `view=summary` (default): source-level score, coverage, capability statuses,
  unsupported reasons, period treatments, and target-performance buckets.
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

The page's headline error is `score.loss × 100`: the arithmetic mean across
individual comparable facts of `min(abs(estimate / benchmark - 1), 1)`. Thus
each fact contributes at most 100% error, facts are not first averaged into
families, and lower is better. Zero-valued benchmarks remain evaluated but do
not enter this relative-error mean; `relative_error_count` is the exact
denominator shown by the page. The legacy inverse `display_score` remains in
the artifact for compatibility but is not presented as a score out of 100.

The performance bars are computed while publishing the immutable artifact,
not inferred from the aggregate error in the browser. Every fact is assigned
to exactly one display bucket: green for absolute relative error at or below
10%, yellow for error above 10% through 25%, red for error above 25%, and dark
gray when no comparable relative error exists (including unmapped facts).

The performance section's Sample selector is defined once from Microcosm's
capability rows. `in_sample` is the set of Chronicle facts marked
`direct_calibration_target` for Microcosm; `out_of_sample` is its complement in
the run's US fact catalog. The publisher materializes both sets, and their
geography intersections, for every source. Selecting a sample therefore scores
all models and standalone datasets against the same facts rather than applying
each source's own calibration-exposure labels.
