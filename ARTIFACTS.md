# Calibration artifact publishing spec

This document describes the HuggingFace layout the diagnostics dashboard
expects. It's the contract between the data pipeline (producer) and this
dashboard (consumer).

## Concepts

- **Dataset** — a logically-distinct calibration (e.g. US national, US
  district). One HuggingFace repo per dataset.
- **Run** — a single build of that calibration (typically one pipeline
  invocation). One top-level prefix per run within the dataset's repo.

The Dataset / Run pickers in the UI map directly onto these.

## Path convention

```
<dataset_repo>/<run_id>/<filename>
```

Where:
- `<dataset_repo>` — any HF model repo, e.g.
  `PolicyEngine/policyengine-us-data-pipeline`.
- `<run_id>` — any string that uniquely identifies the build. Recommended:
  `<version>_<short_commit>_<utc_timestamp>` (e.g.
  `1.110.12_22f922eb_20260329T2233Z`). One prefix per run.
- `<filename>` — one of the artifact filenames below, placed directly
  under the run prefix (no further nesting).

## Files

### Required (a run is hidden from the UI unless both are present)

| File | What |
|---|---|
| `calibration_package.pkl` | Pickled dict produced by `policyengine_us_data.calibration.unified_calibration.load_calibration_package`. Must contain `X_sparse` (csr matrix, n_targets × n_households), `targets_df`, `target_names`, `initial_weights`, optionally `cd_geoid` and `metadata`. |
| `calibration_weights.npy` | 1-D numpy array of final household weights, length must equal `X_sparse.shape[1]`. |

### Optional (each unlocks a feature; missing files degrade gracefully)

| File | Without it, you lose |
|---|---|
| `policy_data.db` | Constraint audit, eligibility audit, target provenance |
| `source_imputed_stratified_extended_cps.h5` | Variable decomposition, household inspector profiles, contributor analysis |
| `calibration_log.csv` | Per-target convergence traces |
| `unified_diagnostics.csv` | Per-category epoch summaries |
| `target_config.yaml` | Included/excluded target flagging (everything counted as included otherwise) |

## Registering a new dataset in the dashboard

After the data team publishes a new dataset's first run to HF, add an
entry to `DEFAULT_DATASETS` in `backend/services/runs.py`:

```python
DatasetConfig(
    id="us-district",                                              # short id, used in URLs
    label="US District calibration",                               # shown in dropdown
    repo_id="PolicyEngine/policyengine-us-district-data-pipeline", # the HF repo
    repo_type="model",
),
```

Runs within the repo are auto-discovered — any top-level prefix whose
content includes both required files appears in the Run dropdown.

## Minimum useful publish

If the goal is just to get a dataset visible in the dashboard for
inspection (e.g. compare worst-fit targets), publishing only the two
required files is enough. The dashboard's Summary view, Target list, and
Weight landscape will work; detail views that need the DB or dataset h5
will surface "data unavailable" rather than crash.

## Example

```
PolicyEngine/policyengine-us-district-data-pipeline/
├── 1.110.12_22f922eb_20260329T2233Z/
│   ├── calibration_package.pkl       ← required
│   ├── calibration_weights.npy       ← required
│   ├── policy_data.db                  optional
│   ├── source_imputed_stratified_extended_cps.h5
│   ├── calibration_log.csv
│   ├── unified_diagnostics.csv
│   └── target_config.yaml
└── 1.110.12_d4a8c1f5_20260330T0810Z/
    └── ...
```
