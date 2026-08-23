# Cross-dataset artifact API

> Deprecated artifact identifiers: version 1 bundles retain `ledger_source`,
> `populace_calibration_sample`, and the `populace_us_policyengine_us_2024`
> source ID; responses label those concepts Chronicle and Microcosm.

The Cross-dataset API serves immutable, jurisdiction-scoped evaluation
artifacts; an HTTP request never imports or runs a microsimulation model. Every
bundle records its explicit `jurisdictions` list, and the runner selects that
jurisdiction's source-plan registry before loading any source adapter. The
default remains `US`. A `--jurisdictions BE` run selects only the Belgium
registry, so it does not authenticate or execute any US source.

The US registry contains Microcosm + PolicyEngine-US, Public CPS +
Tax-Calculator, Yale Tax-Data + Tax-Simulator (reconstruction), and raw 2024 ACS
PUMS. The Yale item is a byte-pinned, precomputed reconstruction checkpoint,
not official Yale output and not a claim that the underlying PUF-based run can
be reproduced from public inputs alone. The US run filters its immutable
Chronicle snapshot to US facts and explicitly excludes unsupported territory
geography IDs.

The Belgium registry contains these three immutable precomputed sources:

- `microcosm_be_v04_axiom` — Microcosm-BE v0.4 × Axiom rules engine. Provenance:
  Microcosm-BE: synthetic Belgian population calibrated to Belgian administrative and national-accounts targets (sums of Chronicle facts; surveys validation-only). Support records: US survey donor pool, reweighted; a Belgian donor pool is the planned upgrade.
- `microcosm_be_v04_euromod` — Microcosm-BE v0.4 × EUROMOD BE_2025. Provenance:
  Microcosm-BE: synthetic Belgian population calibrated to Belgian administrative and national-accounts targets (sums of Chronicle facts; surveys validation-only). Support records: US survey donor pool, reweighted; a Belgian donor pool is the planned upgrade.
- `euromod_be2025_jrc_silc` — EUROMOD BE_2025 on EU-SILC (JRC country report
  2025). Provenance:
  Microcosm-BE: synthetic Belgian population calibrated to Belgian administrative and national-accounts targets (sums of Chronicle facts; surveys validation-only). Support records: US survey donor pool, reweighted; a Belgian donor pool is the planned upgrade.

Belgium jurisdiction is derived only from Chronicle producer evidence: source
package ID `belgium`, Eurostat `geo=BE`, or a NIS geography vintage. Unknown or
foreign comparator rows are not defaulted to Belgium. Each checkpoint row joins
to snapshot facts through `lineage.source_record_id`; multi-record rows use one
score-eligible anchor and a semantic alignment to the exact Chronicle sum.

## Publish frontend partitions

After a full evaluation run, publish the web partitions from the same pinned
Chronicle snapshot and content-addressed evaluation artifact:

```bash
uv run python scripts/publish_cross_dataset_frontend_bundle.py \
  --snapshot /path/to/chronicle-snapshot \
  --run /path/to/evaluation-run \
  --output /path/to/evaluation-run/frontend
```

`scripts/run_full_chronicle_evaluation.py` performs this step automatically for
new runs. The publisher verifies the snapshot and every hash in the evaluation
run before writing. It emits a manifest, summary and group partitions, a fact
index, and bounded fact pages. Every partition carries the immutable run and
snapshot IDs and has a SHA-256 recorded in the manifest.

## Configure the application

Set exactly one of `CROSS_DATASET_ARTIFACT_DIR` or
`CROSS_DATASET_ARTIFACT_BASE_URL` before starting the application for
Cross-dataset work. The Cross-dataset API has no default artifact location: if
neither variable is set, the application process starts, but the Cross-dataset
page is unavailable and its API returns HTTP 503. Setting both variables is
also invalid.

For a bundle on the local filesystem, set `CROSS_DATASET_ARTIFACT_DIR` to the
generated frontend bundle directory. `CROSS_DATASET_EXPECTED_RUN_ID` is
optional and rejects a bundle whose content-addressed run ID does not match:

```bash
export CROSS_DATASET_ARTIFACT_DIR=/path/to/evaluation-run/frontend
export CROSS_DATASET_EXPECTED_RUN_ID=evaluation-...
make dev
```

For a remotely hosted bundle, set `CROSS_DATASET_ARTIFACT_BASE_URL` to the
HTTP(S) directory containing the same files before starting the application:

```bash
export CROSS_DATASET_ARTIFACT_BASE_URL=https://example.org/evaluation-run/frontend/
make dev
```

A missing, stale, partial, malformed, or hash-mismatched bundle returns HTTP
503 rather than serving mixed results.

## Read the API

`GET /api/microcosm/cross-dataset` accepts these views:

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

The performance section's Sample selector is defined once from the Microcosm
capability rows. `in_sample` is the union of Chronicle facts marked
`direct_calibration_target` across the run's Microcosm sources;
`out_of_sample` is its complement in that jurisdiction's fact catalog. With the
single US Microcosm source this is byte-for-byte the former rule; Belgium uses
the union of its Axiom and EUROMOD Microcosm source rows. The publisher
materializes both sets, and their geography intersections, for every source.
Selecting a sample therefore scores all models and standalone datasets against
the same facts rather than applying each source's own calibration-exposure
labels.
