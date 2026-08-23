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

## Publish a bundle to Hugging Face

Publish the verified bundle to the
[`policyengine/microcosm-evaluation`](https://huggingface.co/datasets/policyengine/microcosm-evaluation)
dataset with one command. It reproduces the layout of the Belgium bundle
referenced below:

```bash
export HF_TOKEN=...   # or HUGGINGFACE_TOKEN; a write token for the dataset
uv run --extra publish python scripts/publish_evaluation_bundle_to_hf.py \
  --bundle /path/to/evaluation-run/frontend \
  --jurisdiction BE
```

Options: `--repo <owner/name>` targets another dataset, `--dry-run` verifies the
bundle and prints the upload plan without any network call (and without the
`publish` extra or a token), and `--no-latest` leaves the country's pointer
alone. The dataset layout is:

```text
<cc>/<run_id>/frontend/{manifest,summary,groups,fact-index}.json
<cc>/<run_id>/frontend/facts/NNNNN.json
<cc>/latest.json
```

`<cc>` is the dashboard country code: the lower-case jurisdiction (`us`, `uk`,
`be`), with `GB`-coded bundles published under `uk`. The command:

1. verifies the bundle locally: `schema_version` must be
   `cross_dataset.frontend_bundle.v1`, the manifest's `jurisdictions` must
   contain `--jurisdiction`, every listed partition must match its recorded
   SHA-256, and every partition must carry the manifest's run and snapshot IDs;
2. compares the bundle with `<cc>/<run_id>/frontend/` on the Hub. Files that
   already exist with the same size and content are skipped, so a re-run is a
   no-op. A file that differs under an existing run ID aborts the publish
   before anything is uploaded: run directories are immutable;
3. uploads the missing files and, unless `--no-latest`, writes
   `<cc>/latest.json` in one commit:

   ```json
   {
    "schema_version": 1,
    "jurisdiction": "BE",
    "run_id": "evaluation-f28ca06a0b0d2baf13c87f2f",
    "snapshot_id": "chronicle-82b574e3a8526ce0718ad08d",
    "base_path": "be/evaluation-f28ca06a0b0d2baf13c87f2f/frontend/"
   }
   ```

4. re-downloads `manifest.json` and `summary.json` (and `latest.json` when
   written) through the public resolve URL, exactly as the dashboard reads
   them, and checks their hashes against the local bundle;
5. prints the variable to set for the dashboard, for example
   `CROSS_DATASET_ARTIFACT_BASE_URL_BE=https://huggingface.co/datasets/policyengine/microcosm-evaluation/resolve/main/be/<run_id>/frontend/`.

The token is read only from `HF_TOKEN` or `HUGGINGFACE_TOKEN`; the script never
reads a keychain or a cached login. Files in the bundle directory that the
manifest does not list are reported and never uploaded.

## Configure the application

Configure at most one local directory or remote base URL for each country. The
unsuffixed variables remain the US configuration so existing deployments keep
working; UK and Belgium use country suffixes:

| Country | Local bundle | Remote bundle | Optional pinned run |
| --- | --- | --- | --- |
| US | `CROSS_DATASET_ARTIFACT_DIR` | `CROSS_DATASET_ARTIFACT_BASE_URL` | `CROSS_DATASET_EXPECTED_RUN_ID` |
| UK | `CROSS_DATASET_ARTIFACT_DIR_UK` | `CROSS_DATASET_ARTIFACT_BASE_URL_UK` | `CROSS_DATASET_EXPECTED_RUN_ID_UK` |
| Belgium | `CROSS_DATASET_ARTIFACT_DIR_BE` | `CROSS_DATASET_ARTIFACT_BASE_URL_BE` | `CROSS_DATASET_EXPECTED_RUN_ID_BE` |

Setting both the directory and URL for the same country is invalid. Configuring
different countries at the same time is valid. If neither location is set for
the selected country, the application process still starts, but that country's
Cross-dataset page is unavailable and its API returns HTTP 503 naming the
applicable variables.

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

A bundle published with `scripts/publish_evaluation_bundle_to_hf.py` is
selected with the base URL the command prints; `<cc>/latest.json` on the
dataset names the current run. For the published Belgium bundle:

```bash
export CROSS_DATASET_ARTIFACT_BASE_URL_BE=https://huggingface.co/datasets/policyengine/microcosm-evaluation/resolve/main/be/evaluation-f28ca06a0b0d2baf13c87f2f/frontend/
make dev
```

A missing, stale, partial, malformed, or hash-mismatched bundle returns HTTP
503 rather than serving mixed results. The API also verifies the selected
country against the manifest and fails closed on a mismatch: US requires `US`,
Belgium requires `BE`, and UK accepts either `UK` or `GB`.

## Read the API

`GET /api/microcosm/cross-dataset` accepts `country=us|uk|be` (default `us`)
and these views:

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
