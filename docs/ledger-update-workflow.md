# Ledger update workflow

The Cross-dataset page never reads a mutable Ledger checkout. It reads a
content-addressed evaluation run built from an immutable Ledger snapshot. A new
Ledger release must pass this review before an integration changes its pinned
`ledger_snapshot_id`.

## 1. Compile the candidate snapshot

```bash
uv run evaluation-harness ledger snapshot \
  --bundle /path/to/ledger-consumer-bundle \
  --out .artifacts/ledger/<candidate-snapshot>
```

Compilation validates the Ledger consumer schema, manifest hash, row count,
duplicate keys, and normalized fact contracts. It refuses to overwrite an
existing snapshot.

## 2. Review it against the approved snapshot

```bash
uv run evaluation-harness ledger review \
  --from .artifacts/ledger/<approved-snapshot> \
  --to .artifacts/ledger/<candidate-snapshot> \
  --integration integrations/populace_policyengine_us \
  --integration integrations/taxcalc_cps \
  --integration integrations/census_acs_pums \
  --out .artifacts/ledger-reviews/<review-id>
```

The immutable review contains:

- added, removed, value-changed, definition-changed, and key-churned facts;
- each source's old and new executable counts;
- retained facts that lost a reviewed mapping;
- facts that became executable or changed execution query;
- value changes that require rescoring but not another model run;
- source lists for classification, model execution, rescoring, and publishing;
- one gate per active integration proving that all ten reviewed facts still
  exist and are executable and score-eligible.

A gate with ten unsupported or `N/A` cells fails: `testable_count` must be
exactly ten. Mapping regressions also make `ready_for_evaluation` false.

The review starts from the snapshot currently pinned by each integration. This
prevents a candidate from silently skipping an unreviewed intermediate
snapshot.

## 3. Approve mappings, then recompute

Review any mapping regression or changed fact definition. Update mappings only
after checking the underlying Ledger fact semantics. Re-run the review until
`ready_for_evaluation` is true, then update each approved integration's
`ledger_snapshot_id`.

The review's `affected_sources` section determines the work:

- `classify`: rebuild the complete capability matrix;
- `execute`: run the dataset/model only for new or changed executable queries;
- `rescore`: recompute scores when a benchmark value changed;
- `publish`: produce a new immutable run and frontend bundle.

The current full-run entry point is:

```bash
uv run --extra populace --extra taxcalc-cps \
  python scripts/run_full_ledger_evaluation.py \
  --snapshot .artifacts/ledger/<candidate-snapshot> \
  --populace-dataset /path/to/pinned-populace.h5 \
  --acs-pums-aggregates /path/to/pinned-acs-pums-person-age.parquet \
  --output .artifacts/evaluations/<new-run>
```

The command refuses to use an integration reviewed against another snapshot.
It classifies every fact for all three active sources, runs
Populace/PolicyEngine-US, Tax-Calculator/public CPS, and raw ACS PUMS, scores
the results, and publishes the frontend partitions.

## 4. Verification and CI

CI runs the complete Python harness suite, all frontend tests, type checking,
and the production build. It also executes Tax-Calculator/public CPS against
its ten real Ledger facts and requires ten finite numerical results.

Raw ACS PUMS has the same ten-result requirement, including uncertainty from
all 80 replicate weights:

```bash
uv run python scripts/verify_acs_pums_adapter.py \
  --aggregates /path/to/pinned-acs-pums-person-age.parquet
```

The Populace ten-fact contract is checked in CI for exact snapshot membership,
mapping, executability, and score eligibility. Its numerical gate requires the
pinned Populace dataset and remains:

```bash
uv run --extra populace python scripts/verify_populace_adapter.py \
  /path/to/pinned-populace.h5
```

Run that gate before publishing a new Populace-backed artifact. It must return
ten numerical estimates; unsupported results do not count as completion.

## Immutable history

Snapshot, review, evaluation-run, and frontend-bundle identities are derived
from their content and source hashes. Publishers refuse existing output
directories. A deployment can change which run it points to, but must not
replace the contents of a published identity.
