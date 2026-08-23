# Lane E3 report — Belgium evaluation sources

## Adapter design and calibration exposure

`evaluation_harness/adapters/precomputed_checkpoint.py` is the generic adapter
for `microcosm_be.evaluation_source_checkpoint.v1`. It joins stable
`chronicle_record_ids` to snapshot `lineage.source_record_id` values, rejects
duplicate or drifting joins, validates each `benchmark_value` against the exact
Chronicle value, and carries the checkpoint's `estimate_basis` into every
materialized `EvaluationResult`.

The harness keeps its one-snapshot-fact-per-cell contract. A row containing
several Chronicle records becomes one semantic aggregate: every component must
resolve, the benchmark is their Decimal sum, and the first checkpoint record is
the sole score anchor. Constituent alignments preserve observed values and
point back to the anchor. This follows the existing CPS ASEC 80–84 aggregate
convention and prevents duplicate scores. The two real composite rows are:

- `statbel_fiscal_income_total`: 565 commune facts, benchmark
  `274707991587.82`.
- `nasa_taxable_movable_income_analogue`: D41 + D42, benchmark
  `40087000000`.

Supported rows become precomputed capability cells; `estimate_basis =
unsupported` becomes `execution_method = none` with
`checkpoint_estimate_unsupported` and the checkpoint `note` as the reason.
The shared materializer is also used by the Yale checkpoint, avoiding a fork of
that implementation.

The exact tested calibration-exposure rule is:

- `direct_calibration_target` if and only if every row record is in the release
  target set and `estimate_basis` is `calibration_measure` or
  `dataset_weights`.
- `related_calibration_family` if every row record is in the release target set
  and `estimate_basis` is `engine_simulated`.
- `out_of_sample` for every other combination, including `input_carried` and
  `unsupported`.

The release diagnostics define exposure only. They never replace an engine
checkpoint estimate with the release's `final_estimate`.

Snapshot jurisdiction derivation labels a fact `BE` only from an explicit
Chronicle package source ID `belgium` (including its current `raw/belgium/...`
artifact key), Eurostat `geo=BE`, or a NIS geography vintage. The 760-row bundle
compiled to 726 `BE` facts and 34 `unknown` Eurostat DE/FR comparators.

## Commands run

The implementation and real evaluation used the requested interpreter. Key
commands, verbatim:

```console
git status --short --branch
gitnexus status
gitnexus analyze . --skip-agents-md
.venv/bin/python -m py_compile scripts/run_full_chronicle_evaluation.py evaluation_harness/microcosm_release.py evaluation_harness/frontend_bundle.py evaluation_harness/adapters/precomputed_checkpoint.py
.venv/bin/python -m pytest tests/test_precomputed_checkpoint.py tests/test_microcosm_release.py tests/test_frontend_bundle.py tests/test_full_run_script.py tests/test_snapshot.py -q
.venv/bin/python -m pytest tests/test_be_full_run.py tests/test_precomputed_checkpoint.py tests/test_frontend_bundle.py tests/test_microcosm_release.py tests/test_full_run_script.py -q
.venv/bin/python -m evaluation_harness.cli chronicle snapshot --bundle .lane-inputs/chronicle-be-bundle --out .lane-outputs/be-snapshot
.venv/bin/python scripts/run_full_chronicle_evaluation.py --jurisdictions BE --snapshot .lane-outputs/be-snapshot --precomputed-checkpoint .lane-inputs/microcosm_be_v04_axiom.json --precomputed-checkpoint .lane-inputs/microcosm_be_v04_euromod.json --precomputed-checkpoint .lane-inputs/euromod_be2025_jrc_silc.json --microcosm-release-dir .lane-inputs/microcosm-be-release --output .lane-outputs/be-run
.venv/bin/python scripts/publish_cross_dataset_frontend_bundle.py --snapshot .lane-outputs/be-snapshot --run .lane-outputs/be-run --output .lane-outputs/be-frontend-bundle
.venv/bin/python -m pytest -q
git diff --check
```

The runner and publisher commands were rerun unchanged after replacing a
machine-specific absolute release path in summary provenance with the stable
`local_release_directory` marker. Artifact hashes still identify every local
release document.

The GitNexus index build could not register itself because the managed sandbox
denied writes to `/Users/maxghenis/.gitnexus/registry.json`; dependency mapping
continued with local source search. The partial `.gitnexus` output was removed.

The final frontend-manifest verification recomputed SHA-256 for `summary.json`,
`groups.json`, `fact-index.json`, all eight fact pages, and the five source-run
JSON artifacts. All 11 frontend partitions and all five source-run hashes
matched. The manifest records `jurisdictions: ["BE"]`.

## Test results

Final pytest tail:

```text
........................................................................ [ 89%]
...........................................                              [100%]
403 passed in 9.30s
```

The suite includes the trimmed BE end-to-end fixture with all three sources,
local release resolution, a composite benchmark, unsupported checkpoint rows,
the complete bundle-manifest shape, and partition-hash verification. Existing
US fixtures remain green.

## Belgium frontend summary JSON

This is `.lane-outputs/be-frontend-bundle/summary.json`, formatted without
changing its values:

```json
{
  "fact_count": 726,
  "jurisdictions": [
    "BE"
  ],
  "matrix_complete": true,
  "run_id": "evaluation-f28ca06a0b0d2baf13c87f2f",
  "schema_version": "cross_dataset.frontend_bundle.v1",
  "snapshot_id": "chronicle-82b574e3a8526ce0718ad08d",
  "sources": [
    {
      "capability_count": 726,
      "capability_statuses": {
        "evaluable_via_model": 4,
        "unsupported_concept": 722
      },
      "dataset_version": "eu_silc_be (JRC input, not held)",
      "label": "EUROMOD BE_2025 on EU-SILC (JRC country report 2025)",
      "model_version": "EUROMOD BE_2025 (JRC baseline)",
      "performance_buckets": {
        "far_outside_bounds": 1,
        "outside_bounds": 2,
        "total": 726,
        "unavailable": 722,
        "within_bounds": 1
      },
      "period_treatments": {
        "native": 4,
        "unsupported": 722
      },
      "reason_codes": {
        "checkpoint_estimate_unsupported": 62,
        "mapping_not_found": 660
      },
      "result_count": 4,
      "score": {
        "covered": 4,
        "display_score": "68.57553736170152175597546835",
        "loss": "0.3142446263829847824402453165",
        "relative_error_count": 4,
        "scored": 4
      },
      "source_id": "euromod_be2025_jrc_silc",
      "source_type": "model_dataset_pair"
    },
    {
      "capability_count": 726,
      "capability_statuses": {
        "evaluable_direct": 13,
        "evaluable_in_sample": 19,
        "evaluable_via_model": 24,
        "unsupported_concept": 670
      },
      "dataset_version": "microcosm_be_v04_2026",
      "label": "Microcosm-BE v0.4 × Axiom rules engine",
      "model_version": "axiom-rules-engine (rulespec-be @ ddc28fe7)",
      "performance_buckets": {
        "far_outside_bounds": 19,
        "outside_bounds": 7,
        "total": 726,
        "unavailable": 670,
        "within_bounds": 30
      },
      "period_treatments": {
        "aligned_fact": 2,
        "native": 54,
        "unsupported": 670
      },
      "reason_codes": {
        "checkpoint_estimate_unsupported": 10,
        "mapping_not_found": 660
      },
      "result_count": 56,
      "score": {
        "covered": 56,
        "display_score": "75.19690221398286839896141709",
        "loss": "0.2480309778601713160103858291",
        "relative_error_count": 56,
        "scored": 56
      },
      "source_id": "microcosm_be_v04_axiom",
      "source_type": "model_dataset_pair"
    },
    {
      "capability_count": 726,
      "capability_statuses": {
        "evaluable_direct": 16,
        "evaluable_in_sample": 21,
        "evaluable_via_model": 18,
        "unsupported_concept": 671
      },
      "dataset_version": "microcosm_be_v04_2026",
      "label": "Microcosm-BE v0.4 × EUROMOD BE_2025",
      "model_version": "EUROMOD J2.0+ BE_2025 (plain baseline run)",
      "performance_buckets": {
        "far_outside_bounds": 14,
        "outside_bounds": 8,
        "total": 726,
        "unavailable": 671,
        "within_bounds": 33
      },
      "period_treatments": {
        "aligned_fact": 2,
        "native": 53,
        "unsupported": 671
      },
      "reason_codes": {
        "checkpoint_estimate_unsupported": 11,
        "mapping_not_found": 660
      },
      "result_count": 55,
      "score": {
        "covered": 55,
        "display_score": "80.41803896594864365705467075",
        "loss": "0.1958196103405135634294532925",
        "relative_error_count": 55,
        "scored": 55
      },
      "source_id": "microcosm_be_v04_euromod",
      "source_type": "model_dataset_pair"
    }
  ]
}
```

## Per-source coverage

| Source | Supported checkpoint rows | Full-catalog results | Direct / related / out of sample | Within / outside / far / unavailable |
|---|---:|---:|---:|---:|
| Microcosm-BE v0.4 × Axiom | 56 / 66 | 56 / 726 | 19 / 7 / 40 | 30 / 7 / 19 / 670 |
| Microcosm-BE v0.4 × EUROMOD | 55 / 66 | 55 / 726 | 21 / 3 / 42 | 33 / 8 / 14 / 671 |
| EUROMOD BE_2025 on JRC EU-SILC | 4 / 66 | 4 / 726 | 0 / 3 / 63 | 1 / 2 / 1 / 722 |

The full-catalog denominator is intentional: the unchanged frontend contract
retains every one of the 726 BE snapshot facts. Of the 660 ordinary
`mapping_not_found` cells per source, 565 are non-anchor facts belonging to the
large commune composite and 95 are BE facts outside the shared 66-row
checkpoint surface.

## Unresolved Chronicle records

All 631 unique checkpoint record IDs resolved uniquely and every benchmark
matched its Chronicle value or sum. Requested unresolved list:

```json
[]
```

Generated, intentionally uncommitted artifacts:

- `.lane-outputs/be-snapshot/`
- `.lane-outputs/be-run/`
- `.lane-outputs/be-frontend-bundle/`

LANE E3 DONE
