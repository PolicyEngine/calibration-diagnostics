# Chronicle update workflow

The Cross-dataset page never reads a mutable Chronicle checkout. It reads a
content-addressed evaluation run built from an immutable Chronicle snapshot. A new
Chronicle release must pass this review before an integration changes its pinned
`chronicle_snapshot_id`.

## 1. Compile the candidate snapshot

```bash
uv run evaluation-harness chronicle snapshot \
  --bundle /path/to/chronicle-consumer-bundle \
  --out .artifacts/chronicle/<candidate-snapshot>
```

Compilation validates the Chronicle consumer schema, manifest hash, row count,
duplicate keys, and normalized fact contracts. It refuses to overwrite an
existing snapshot.

## 2. Review it against the approved snapshot

```bash
uv run evaluation-harness chronicle review \
  --from .artifacts/chronicle/<approved-snapshot> \
  --to .artifacts/chronicle/<candidate-snapshot> \
  --integration integrations/microcosm_policyengine_us \
  --integration integrations/taxcalc_cps \
  --integration integrations/census_acs_pums \
  --out .artifacts/chronicle-reviews/<review-id>
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
after checking the underlying Chronicle fact semantics. Re-run the review until
`ready_for_evaluation` is true, then update each approved integration's
`chronicle_snapshot_id`.

The review's `affected_sources` section determines the work:

- `classify`: rebuild the complete capability matrix;
- `execute`: run the dataset/model only for new or changed executable queries;
- `rescore`: recompute scores when a benchmark value changed;
- `publish`: produce a new immutable run and frontend bundle.

The current full-run entry point is:

```bash
uv run --extra microcosm --extra taxcalc-cps \
  python scripts/run_full_chronicle_evaluation.py \
  --snapshot .artifacts/chronicle/<candidate-snapshot> \
  --microcosm-dataset /path/to/pinned-microcosm.h5 \
  --acs-pums-aggregates /path/to/pinned-acs-pums-person-age.parquet \
  --output .artifacts/evaluations/<new-run>
```

The command refuses to use an integration reviewed against another snapshot.
It classifies every fact for every registered source, runs Microcosm +
PolicyEngine-US, Public CPS + Tax-Calculator, and Raw ACS PUMS, incorporates the
reviewed Yale reconstruction checkpoint, scores the results, and publishes the
frontend partitions.

## 4. Manual harness verification

The Python evaluation harness and adapter gates are intentionally not run on
every commit or pull request. Run the maintenance script periodically, after a
Chronicle or dependency update, and before publishing a new evaluation:

```bash
uv run python scripts/verify_evaluation_harness.py
```

The script installs the locked dependencies, runs the complete Python harness
suite, and executes Public CPS + Tax-Calculator against its ten real Chronicle
facts. All ten must remain executable and produce finite numerical results.
It does not regenerate the full evaluation artifact described in step 3.

The numerical Microcosm and Raw ACS gates require local pinned inputs and can be
included in the same maintenance run:

```bash
uv run python scripts/verify_evaluation_harness.py \
  --microcosm-dataset /path/to/pinned-microcosm.h5 \
  --acs-pums-aggregates /path/to/pinned-acs-pums-person-age.parquet
```

Raw ACS includes uncertainty from all 80 replicate weights. The Microcosm gate
uses the pinned H5. Each optional gate must return ten numerical estimates;
unsupported results do not count as completion.

Frontend tests, type checking, and the production build remain in CI because
they are lightweight and do not execute the evaluation models.

## Immutable history

Snapshot, review, evaluation-run, and frontend-bundle identities are derived
from their content and source hashes. Publishers refuse existing output
directories. A deployment can change which run it points to, but must not
replace the contents of a published identity.
