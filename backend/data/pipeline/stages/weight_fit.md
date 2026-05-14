# Weight fit pathway

## Purpose

The `weight_fit` stage is the actual optimization heart of the calibration pipeline. Given a pre-built `calibration_package.pkl` (a sparse targets-by-records matrix `X_sparse`, a vector of target values, and a `targets_df` of metadata), it produces a single 1-D vector of household weights such that `X_sparse @ weights` approximates `targets` as closely as possible. It uses L0-regularized stochastic optimization (HardConcrete gates) to push as many record weights to exactly zero as it can while still matching aggregate targets — yielding a sparse, lightweight microdata file that reproduces external benchmarks (ACS, Census, IRS SOI, etc.) on each congressional district.

## Inputs and outputs

**In** (from `calibration_package.pkl`, built by the `calibration_package` stage):
- `X_sparse`: scipy CSR/COO matrix of shape `(n_targets, n_records)` — each row encodes how each cloned-household contributes to one target.
- `targets`: `targets_df["value"].values`, length `n_targets`.
- `targets_df`: per-target metadata (`variable`, `domain_variable`, `geo_level`, `geographic_id`, `value`); also used to derive district-level initial weights and `target_groups`.
- `target_names`, `target_groups`, `achievable` flag (from `X_sparse.sum(axis=1) > 0`).

**Out** (written to the output directory next to the package):
- `calibration_weights.npy` — final 1-D float weight vector of length `n_records` (deterministic gate-product weights from `model.get_weights(deterministic=True)`).
- `unified_diagnostics.csv` — per-target estimate vs. target plus relative/absolute error and an `achievable` flag.
- `*.checkpoint.pt` (optional, when `checkpoint_path` is set) — resumable PyTorch state for `SparseCalibrationWeights`.
- Per-epoch `log_path` CSV (optional) — per-target estimate/error trajectory, written when `log_freq` is set.

## Key sub-stages (in order)

1. **`init_weights` (`compute_initial_weights`, line 712)** — Builds a population-proportional warm-start by summing `person_count` / `age` / district targets to get each CD's population, then distributing that evenly across the household columns that actually contribute to that CD; falls back to uniform `100` if no age targets exist.
2. **`fit_model` (`fit_l0_weights`, line 791)** — Instantiates `l0.calibration.SparseCalibrationWeights` with the initial weights, optimizes with Adam (`lr=LEARNING_RATE`) using a relative-error loss plus L0 + L2 penalties, logs per-epoch loss/sparsity/weight-distribution, and (optionally) writes per-target trajectories and resumable checkpoints. Returns the deterministic weight vector.
3. **`calibration_diagnostics` (`compute_diagnostics`, line 1147)** — Multiplies `X_sparse @ weights`, compares to `targets_df["value"]`, and returns a DataFrame with `target`, `true_value`, `estimate`, `rel_error`, `abs_rel_error`, and a row-sum-derived `achievable` flag (targets whose matrix row is all zeros cannot possibly be hit).
4. **`run_calibration` (line 1273)** — The transitional orchestrator. Either loads a pre-built package (early-exit path, line ~1353) or builds one in-process (steps 1-7 ending at line 1717), then calls `fit_l0_weights`, writes `calibration_weights.npy`, and runs `compute_diagnostics` to emit `unified_diagnostics.csv` plus aggregate logging.

## What L0 regularization actually does here

The optimization minimizes a **relative-error squared loss** (`loss_type="relative"` at line 997/1096) — i.e. for each target `i`, `((X_sparse @ w)[i] - y[i]) / |y[i]|` squared — averaged (optionally with `target_groups` to balance heterogeneous target counts). On top of that, two penalties are added: an **L0 penalty** (`lambda_l0`, default `1e-8` in `run_calibration`) and a tiny **L2 penalty** (`lambda_l2 = 1e-12`). The L0 term doesn't directly penalize the magnitude of weights; instead, `SparseCalibrationWeights` parameterizes each record's weight as `log_weight_i * gate_i`, where `gate_i` is a stochastic HardConcrete gate (Louizos et al.) with learnable `log_alpha`. The L0 penalty is the expected number of open gates, which is differentiable through the HardConcrete relaxation. This pushes the model to **literally drop records to zero weight** (gate closed) rather than just shrinking them, producing a genuinely sparse calibrated microdata file.

The HardConcrete hyperparameters that matter:

- **`BETA = 0.35`** — temperature of the gate distribution. Lower = harder gates (more zero-or-one), higher = softer (smoother gradients but blurrier sparsity).
- **`GAMMA = -0.1`, `ZETA = 1.1`** — the stretch interval `(γ, ζ)` of the HardConcrete; values outside `[0, 1]` are clipped, which is what makes exact zeros possible.
- **`INIT_KEEP_PROB = 0.999`** — gates start almost fully open, so the optimizer begins close to the initial weights and only sparsifies as the L0 pressure outweighs the loss benefit of keeping a record.
- **`LAMBDA_L2 = 1e-12`** — vanishing L2 on `log_weight`, mostly numerical insurance against runaway log-weights.
- **`LEARNING_RATE = 0.15`** — Adam step size; relatively large because parameters are in log-space.
- **`LOG_WEIGHT_JITTER_SD = 0.05`, `LOG_ALPHA_JITTER_SD = 0.01`** — tiny initialization noise so identical initial weights don't have identical gradients. Jitter is zeroed after the first chunk (line 946/1000) so resumed runs stay deterministic.

## Common failure modes

- **NaN / exploding loss** — usually a target with `|y| → 0` blowing up the relative-error denominator; the code masks `|targets| > 0` in the *diagnostic* relative error (line 1021, 1159) but the model's internal loss still sees a divide. Look at `unified_diagnostics.csv` for `true_value ≈ 0` rows and consider filtering them out of `targets_df` before building the package.
- **`unachievable` targets** — `compute_diagnostics` flags `achievable = row_sums > 0`. If a target's row in `X_sparse` is all zero (e.g. no household in the cloned dataset can possibly contribute to that geography × variable cell), the optimizer simply cannot match it. `run_calibration` logs the achievable count at line ~1712; a sudden drop usually points to a broken clone/geography assignment upstream, not a fit problem.
- **Filer-gated mismatch** — when targets reference an IRS-filer-only variable but the matrix row is built over all CPS households (or vice versa), the row sum can be non-zero but tiny, producing huge relative errors that dominate the loss and starve other targets. Check the per-target log CSV for chronically-bad targets vs. expected magnitude.
- **Tension / oscillation between targets** — if mean error stalls but max error swings each epoch, two targets share households with opposing pulls. Inspect `target_groups` weighting and consider raising `lambda_l0` (more aggressive culling) or lowering `learning_rate`.
- **Checkpoint resume rejected** — `checkpoint_signature_mismatches` (line 888) raises on structural changes (n_features, target shape). Soft mismatches (hyperparameter changes) only warn but cause transient loss/sparsity shocks for the first few epochs — expected, not a bug.
- **All weights collapse to zero (100% sparse)** — `lambda_l0` too high relative to loss; back it off by an order of magnitude. Watch the epoch logs' `active=X/N` line.

## Why this exists / design notes

Off-the-shelf survey calibration (raking, GREG, quadratic programming over weights directly) shrinks but never zeros weights, so the output dataset stays as large as the input. PolicyEngine clones the CPS hundreds of times to give the optimizer enough degrees of freedom to hit fine-grained district targets (`DEFAULT_N_CLONES = 430`), so without sparsification the result would be unusable in production. **L0 is preferred over L1** because L1 on weights induces a smooth shrinkage toward zero but, on a non-negative weight vector with multiplicative gates, doesn't produce a clean active/inactive partition — and L1 distorts the calibration objective (it pulls all weights down, biasing aggregates). L0 with HardConcrete gates decouples the *which records survive* decision from the *what weight do they get* decision: gates handle the former (with a sparsity prior), `log_weight` handles the latter (essentially unconstrained, modulo the negligible L2). The result is a smaller dataset whose aggregates match targets, not a shrunken dataset.

Subtleties a reviewer should know:

- The loss is **relative**, not absolute. A $1M target with 1% error contributes the same as a $1k target with 1% error. Without this, IRS aggregates would dominate over CPS person-counts. If you're surprised that the optimizer "ignores" a high-magnitude target, check whether it has a small but achievable row sum — relative loss will not over-weight it.
- `target_groups` (built by `create_target_groups`) further normalizes within a group so e.g. all 435 CDs' age targets are treated as one group, not 435 independent losses — preventing geographic explosion of one variable from drowning out others.
- The returned weights come from `model.get_weights(deterministic=True)` — gates are evaluated at their expected value, not sampled — so two runs from the same checkpoint give identical weights despite the stochastic gate parameterization during training.
- `init_weights` is more than a convenience: starting from population-scaled values means the optimizer mostly has to *prune* and *fine-tune*, not discover the order of magnitude from scratch. Bad initial weights will multiply training time and risk L0 culling useful records before they can demonstrate value.

## Source map

| Node id | Source file | Role |
|---|---|---|
| `init_weights` | `policyengine_us_data/calibration/unified_calibration.py:712` (`compute_initial_weights`) | Builds population-proportional warm-start weights from district `age` targets. |
| `fit_model` | `policyengine_us_data/calibration/unified_calibration.py:791` (`fit_l0_weights`) | Runs L0-regularized HardConcrete-gate optimization; emits `calibration_weights.npy` and per-epoch logs/checkpoints. |
| `calibration_diagnostics` | `policyengine_us_data/calibration/unified_calibration.py:1147` (`compute_diagnostics`) | Computes per-target estimate, relative error, and achievability for `unified_diagnostics.csv`. |
| `run_calibration` | `policyengine_us_data/calibration/unified_calibration.py:1273` (`run_calibration`) | Transitional orchestrator: build-or-load package, call `fit_l0_weights` (line 1369 or 1717), write weights, then `compute_diagnostics` (line 1884). |
