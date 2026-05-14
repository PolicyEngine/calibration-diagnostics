# Calibration artifact publishing spec

This document is the contract between the **PolicyEngine data pipeline**
(the producer of calibration runs) and **calibration-diagnostics** (the
dashboard that visualises them).

## TL;DR for the data team

To unlock the dashboard against canonical `PolicyEngine/policyengine-us-data`
runs, please add two files to each staging publish:

| File | How to produce it |
|---|---|
| `X_sparse.npz` | Save the `X_sparse` your `UnifiedMatrixBuilder.build_matrix()` already returns. `scipy.sparse.save_npz(staging_dir / "X_sparse.npz", X_sparse)`. |
| `calibration_weights.npy` | The final per-household weights vector. `np.save(staging_dir / "calibration_weights.npy", final_weights)`. |

Optional but very useful:

| File | Why |
|---|---|
| `target_names.json` | The string labels for each target row in `X_sparse`. Cheap to dump (`json.dump(target_names, ...)`). |
| `target_config.yaml` | Source-of-truth for which targets the calibration is opted into. The dashboard surfaces the REMOVED commentary, so it's a high-leverage file. |

Two-line change in the pipeline (post-`build_matrix`) is enough. Everything
else (policy_data.db, enhanced_cps_2024.h5) is already published.

The rest of this document is the longer-form spec.

---

## Why this is needed

The dashboard's core diagnostics — error per target, loss contribution,
contributor analysis, convergence — all need the **household-by-target
sparse matrix** that the pipeline builds during calibration. The pipeline
needs it too (it's how the optimizer fits weights), so it's already being
computed; it just isn't published as an artifact.

Without it, the dashboard can either:
- Rebuild X at load time — tried, takes 1h+ per run, unusable, OR
- Compute only the trivial geographic-only aggregates (~2% of targets), OR
- Ship the published artifact and load it in seconds (this proposal)

## Concepts

- **Dataset** — a logically-distinct calibration (e.g. US enhanced CPS, US
  PUF, UK). One HuggingFace repo per dataset.
- **Run** — a single build of that calibration. One prefix per run in the
  dataset's repo.

Two prefix conventions are supported:

| Layout | Pattern | Example |
|---|---|---|
| **flat** | `<repo>/<run_id>/<files>` | `policyengine-us-data-pipeline/test/calibration_package.pkl` |
| **staging** | `<repo>/staging/<run_id>/<files>` | `policyengine-us-data/staging/usdata-gha25719239158-a1-889ab438/policy_data.db` |

The dashboard auto-detects which layout a dataset uses (declared in
`DatasetConfig.layout`).

## Files per run

### Required for full diagnostics

| File | What |
|---|---|
| `X_sparse.npz` *or* `calibration_package.pkl` | The sparse household-by-target contribution matrix. `.npz` (scipy.sparse) is preferred for canonical staging; `.pkl` (the legacy `load_calibration_package` bundle, containing X plus metadata) is what the sandbox uses today. |
| `calibration_weights.npy` | Final per-household weights (1-D float array). |
| `policy_data.db` | SQLite DB with the canonical `targets`, `strata`, `stratum_constraints` tables. |
| `enhanced_cps_2024.h5` *(or other primary microdata h5)* | The calibrated dataset itself — needed to evaluate PE variables for comparison. |

If `X_sparse.npz` is present, the dashboard computes `estimate = X @ weights`
directly. If only the four `.pkl`-bundle keys are present, same thing via
the legacy code path.

### Optional (each unlocks a specific view)

| File | What it enables |
|---|---|
| `target_names.json` | Cleaner labels in the Target Explorer (otherwise derived from variable/geo/constraint columns). |
| `target_config.yaml` | The Used / Unused split + REMOVED commentary surfaced in the dashboard. |
| `calibration_log.csv` | Per-target convergence traces (Target Explorer detail tab). |
| `unified_diagnostics.csv` | Per-category epoch summaries. |
| `source_imputed_stratified_extended_cps.h5` | Detail-panel views that need the pre-calibration source data. |

## Path convention

```
<dataset_repo>/[staging/]<run_id>/<filename>
```

Where:
- `<dataset_repo>` — any HF model repo. e.g.
  `PolicyEngine/policyengine-us-data`.
- `<run_id>` — uniquely identifies the build. Either the team's own
  convention (`usdata-gha25719239158-a1-889ab438`) or a versioned one
  (`1.110.12_22f922eb_20260329T2233Z`).

## Registering a new dataset in the dashboard

After the data team publishes a new dataset's first run to HF, add an entry
to `DEFAULT_DATASETS` in `backend/services/runs.py`:

```python
DatasetConfig(
    id="us-puf",                                # short id, used in URLs
    label="US PUF-enhanced",                    # shown in dropdown
    repo_id="PolicyEngine/policyengine-us-puf-pipeline",
    layout="staging",                           # or "flat"
    primary_h5="enhanced_cps_2024.h5",          # for staging layout
),
```

Runs within the repo are auto-discovered: any prefix whose contents
include the required files appears in the Run dropdown.

## Minimum viable publish

If you only have time to add two files to your existing staging output:

1. `X_sparse.npz` (the matrix you already build internally)
2. `calibration_weights.npy` (the weights you already optimise)

That's enough to unlock the dashboard's full diagnostics suite on every
existing staging run. The other files are nice-to-haves.

## Example (canonical staging)

```
PolicyEngine/policyengine-us-data/
└── staging/
    └── usdata-gha25719239158-a1-889ab438/
        ├── X_sparse.npz                    ← please add (required)
        ├── calibration_weights.npy         ← please add (required)
        ├── target_names.json                 nice-to-have
        ├── target_config.yaml                nice-to-have
        ├── policy_data.db                  ← already published
        ├── enhanced_cps_2024.h5            ← already published
        ├── cps_2024.h5                     ← already published
        ├── small_enhanced_cps_2024.h5      ← already published
        └── _run_context.json               ← already published
```
