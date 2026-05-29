# Calibration Diagnostics API Layer Scope

## Goal

Create a stable, scriptable API layer for calibration diagnostics so users can inspect datasets, runs, H5 bundles, targets, aggregates, errors, and comparisons without depending on UI-oriented endpoints or dashboard state.

The API should make these facts explicit:

- Which target universe and calibration metadata are being used.
- Which H5 bundle produced each PE aggregate.
- Whether a target was included in the calibration loss.
- Whether loss contribution is meaningful for the selected target set.
- Which cache or computation path produced the result.

## Non-Goals

- Do not replace the existing dashboard routes in the first pass.
- Do not infer calibration loss membership when the published artifacts do not prove it.
- Do not make state/district H5 files look like standalone datasets unless the response also names the parent target DB and diagnostics source.
- Do not expose household-level contributor detail for dataset-mode runs until sparse matrix artifacts are available.

## API Shape

All stable endpoints should live under `/api/v1`. Existing dashboard endpoints can continue to serve the frontend while we migrate.

### Dataset And Run Discovery

`GET /api/v1/datasets`

Returns dataset definitions and their supported layout:

```json
{
  "items": [
    {
      "dataset_id": "us-data-production",
      "label": "US Data - Production Enhanced CPS",
      "repo_id": "PolicyEngine/policyengine-us-data",
      "repo_type": "model",
      "layout": "root",
      "primary_h5": "enhanced_cps_2024.h5"
    }
  ]
}
```

`GET /api/v1/datasets/{dataset_id}/runs`

Returns runs available for a dataset. Root production has a synthetic `main` run.

### Bundle Discovery

`GET /api/v1/datasets/{dataset_id}/runs/{run_id}/bundles`

Returns H5 bundles available for a run, grouped by bundle type:

```json
{
  "dataset_id": "us-data-production",
  "run_id": "main",
  "items": [
    {
      "bundle": "states/CA.h5",
      "kind": "state",
      "geography_id": "06",
      "geography_name": "California",
      "target_count": 116,
      "included_target_count": 0,
      "cache_status": "not_computed"
    }
  ]
}
```

The endpoint should support filters:

- `kind=national|state|district|city|primary`
- `state_fips=6`
- `include_target_counts=true`
- `include_cache_status=true`

### Run Summary

`GET /api/v1/datasets/{dataset_id}/runs/{run_id}/summary`

Query parameters:

- `bundle`: optional H5 bundle path. If omitted, use the dataset primary H5.
- `included`: `true`, `false`, or omitted.
- `geo_level`: optional.
- `state_fips`: optional.

Response should separate coverage from fit quality:

```json
{
  "dataset_id": "us-data-production",
  "run_id": "main",
  "bundle": "states/CA.h5",
  "target_universe_count": 116,
  "included_target_count": 0,
  "computed_target_count": 116,
  "loss_contribution_available": false,
  "metrics": {
    "median_abs_rel_error": 0.21,
    "mean_abs_rel_error": 0.37,
    "p95_abs_rel_error": 1.4,
    "total_loss": null
  },
  "provenance": {
    "target_db": "policy_data.db",
    "diagnostics": "calibration/logs/unified_diagnostics.csv",
    "aggregate_source": "states/CA.h5",
    "calibration_pattern_source": null
  }
}
```

### Targets

`GET /api/v1/datasets/{dataset_id}/runs/{run_id}/targets`

Stable query parameters:

- `bundle`
- `geo_level`
- `state_fips`
- `geographic_id`
- `variable`
- `source`
- `included`
- `min_abs_rel_error`
- `sort`
- `order`
- `limit`
- `offset`

Each target row should distinguish the facts currently overloaded in the UI:

```json
{
  "target_id": 25388,
  "target_name": "state/tax_unit_partnership_s_corp_income/56/[...]",
  "variable": "tax_unit_partnership_s_corp_income",
  "geo_level": "state",
  "geographic_id": "56",
  "target_value": 2208928000.0,
  "pe_aggregate": 8863508975.77,
  "rel_error": 3.01258,
  "abs_rel_error": 3.01258,
  "included_in_loss": false,
  "loss_contribution": null,
  "computed_from_bundle": "states/WY.h5",
  "target_value_source": "policy_data.db",
  "included_source": "unified_diagnostics.csv",
  "calibration_pattern_source": null,
  "eval_note": null
}
```

Rules:

- `loss_contribution` should be `null` when the target is not known to be in loss.
- `included_in_loss` should only be true when a diagnostics row or target config proves inclusion.
- `computed_from_bundle` should always be present when `pe_aggregate` is present.

### Target Detail

`GET /api/v1/datasets/{dataset_id}/runs/{run_id}/targets/{target_id}`

Returns a target row plus:

- constraints
- provenance fields
- related bundle
- evaluation note
- optional compare fields

Matrix-only detail such as contributors should stay separate and return explicit `501` for dataset-mode runs without matrix artifacts.

### Evaluation Job

`POST /api/v1/evaluate`

Request:

```json
{
  "dataset_id": "us-data-production",
  "run_id": "main",
  "bundle": "states/CA.h5",
  "filters": {
    "geo_level": ["state"],
    "state_fips": [6],
    "included": null
  },
  "limit": 5000
}
```

Response:

```json
{
  "status": "complete",
  "cache_status": "computed",
  "elapsed_ms": 18320,
  "result": {
    "target_count": 116,
    "computed_target_count": 116,
    "items_url": "/api/v1/datasets/us-data-production/runs/main/targets?bundle=states/CA.h5"
  }
}
```

First implementation can be synchronous because current bundle evaluation is request/response. If large states or districts make this too slow, promote the same contract to an async job with `job_id`.

### Compare

`POST /api/v1/compare`

Supports:

- run vs run
- bundle vs bundle
- primary H5 vs state/district H5

The response should include target matching keys and only compare rows with compatible target definitions.

## Implementation Plan

## Implemented In This Branch

This branch implements the Phase 1 read-only API plus a synchronous evaluation wrapper:

- `GET /api/v1/datasets`
- `GET /api/v1/datasets/{dataset_id}/runs`
- `GET /api/v1/datasets/{dataset_id}/runs/{run_id}/bundles`
- `GET /api/v1/datasets/{dataset_id}/runs/{run_id}/summary`
- `GET /api/v1/datasets/{dataset_id}/runs/{run_id}/targets`
- `GET /api/v1/datasets/{dataset_id}/runs/{run_id}/targets/{target_id}`
- `POST /api/v1/evaluate`
- `POST /api/v1/compare`

It also exposes the current top-level us-data staging snapshot as
`us-data-current-staging` / run `staging`, backed by
`staging/calibration/policy_data.db`, `staging/calibration/source_imputed_stratified_extended_cps.h5`,
and top-level `staging/{states,districts,national,cities}` H5 bundles.

Not yet implemented:

- async evaluation jobs
- generated notebook/CI client

### Phase 1: Contract And Read-Only Wrappers

- Add Pydantic response models under `backend/api/v1/models.py`.
- Add a new router mounted at `/api/v1`.
- Implement dataset, run, bundle, summary, and target list endpoints by wrapping existing services.
- Preserve existing dashboard routes unchanged.
- Add tests for schema stability and key semantics.

### Phase 2: Evaluation Semantics

- Make bundle evaluation metadata explicit:
  - `computed_from_bundle`
  - `cache_status`
  - `eval_note`
  - `loss_contribution_available`
- Return `loss_contribution: null` for targets not known to be in loss.
- Add bundle cache inspection helpers.

### Phase 3: Compare And CI Use

- Add compare endpoint.
- Add JSON examples for CI usage.
- Add a small CLI or documented `curl` recipes for common checks:
  - latest run summary
  - worst state targets
  - compare current production state bundle to staging state bundle

## Testing Strategy

Backend tests:

- Dataset/runs endpoint returns root, staging, and H5 metadata.
- Bundles endpoint lists `states/CA.h5` for `us-data-production/main`.
- Targets endpoint marks skipped state rows with `loss_contribution: null`.
- Targets endpoint returns `computed_from_bundle` when PE aggregate is present.
- Summary endpoint reports `loss_contribution_available=false` for state-only skipped rows.
- Compare endpoint rejects incompatible datasets with a clear error.

Smoke tests:

```bash
uv run --python 3.12 pytest
uv run --python 3.12 ruff check backend tests
cd frontend && bun run lint
```

API smoke examples:

```bash
curl 'http://localhost:8000/api/v1/datasets'
curl 'http://localhost:8000/api/v1/datasets/us-data-production/runs/main/bundles?kind=state'
curl 'http://localhost:8000/api/v1/datasets/us-data-production/runs/main/targets?bundle=states/CA.h5&geo_level=state&included=false'
curl 'http://localhost:8000/api/v1/datasets/us-data-current-staging/runs/staging/bundles?kind=state'
```

## Open Questions

- Should `included=false` mean explicitly excluded, or simply not proven included?
- Can `target_config.yaml` be published alongside root production artifacts so state/district calibration patterns are provable?
- Should state H5 files appear in the top dataset selector, or stay as bundle selectors under the parent dataset/run?
- Should large bundle evaluations become async jobs before exposing the stable API publicly?
- Do we want an OpenAPI client generated for notebooks and CI?
