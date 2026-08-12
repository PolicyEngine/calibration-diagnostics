# Microcosm / PolicyEngine-US integration overview

> Deprecated upstream identifiers: the current Microcosm HF release, files,
> diagnostics metadata, and Chronicle fact keys still use `populace`/`ledger`.

Status: **adapter implemented and verified against the pinned release**

Reviewed Microcosm release: `populace-us-2024-buildp-sparse-rmloss100-cae8640-20260728T011454Z`

Chronicle snapshot: `chronicle-7917ea815df710fb20db076b`

## What will be connected

This is a model/dataset pairing, not a raw-dataset adapter:

- Dataset: Microcosm US, published at
  `policyengine/populace-us`, file `populace_us_2024.h5`, SHA-256
  `48b9d479fb4fd1c3537f9383ce4697d130b6f618658409d74f6233c43b994c7e`.
- Dataset build: Microcosm commit
  `cae8640f9e65e274aea65c7916cb37b956978e32`.
- Model: `policyengine-us==1.764.6` (with `policyengine-core==3.26.11` in the
  release manifest).
- Population period: calendar year 2024.
- Policy calculation period: tax year 2024.
- Weight entities: person, household, and tax unit.
- Geography paths: national, state FIPS, and congressional-district GEOID.

The adapter downloads the release-pinned H5, verifies its hash, constructs one
cached `policyengine_us.Microsimulation`, calculate all required variables once,
and expose entity-aligned arrays to the common harness aggregator. Direct
microdata variables (for example `age` and `employment_income`) and calculated
PolicyEngine variables (for example `eitc`) use the same aggregation interface.

`frontend/scripts/microcosm_variable_core.py` proves the local
loading path and documents the dataset's substantial disk and memory needs. The
new adapter will move the reusable loading behavior behind a harness interface;
it will not call a browser API once per fact.

## Exact ten-fact verification set

These are exact rows from the pinned, 48,313-row Chronicle snapshot. The committed
fixture is a lossless copy of their material comparison fields. The checkpoint
was also validated against the full locally compiled snapshot, rather than only
against that fixture.

| # | Chronicle fact | Period | Geography | Model-side expression | Target | Exposure |
|---:|---|---|---|---|---:|---|
| 1 | US resident population | CY 2024 | US | `sum(person_weight)` | 340,110,988 | External holdout |
| 2 | Resident population age 0–4 | CY 2024 | US | `sum(person_weight where 0 <= age < 5)` | 18,599,314 | Calibration target |
| 3 | California resident population | CY 2024 | CA | `sum(person_weight where state_fips == 6)` | 39,431,263 | External holdout |
| 4 | California population age 0–4 (ACS) | CY 2024 | CA | `sum(person_weight where state_fips == 6 and 0 <= age < 5)` | 2,083,154 | External holdout |
| 5 | Alabama CD-01 household count (ACS) | CY 2024 | AL-01 | `sum(household_weight where district == AL-01)` | 300,636 | External holdout |
| 6 | Returns with EITC | TY 2024 | US | `sum(tax_unit_weight where eitc != 0)` | 23,837,149 | Calibration target |
| 7 | Total EITC | TY 2024 | US | `sum(eitc * tax_unit_weight)` | $69,041,649,000 | Calibration target |
| 8 | BEA wages and salaries | CY 2024 | US | `sum(employment_income * person_weight)` | $12,387,929,000,000 | Calibration target |
| 9 | Returns with EITC, AGI $10k–$15k | TY 2024 | US | `sum(tax_unit_weight where eitc != 0 and 10000 <= AGI < 15000)` | 3,819,056 | Calibration target |
| 10 | EITC, AGI $10k–$15k | TY 2024 | US | `sum(eitc * tax_unit_weight where 10000 <= AGI < 15000)` | $9,085,291,000 | Calibration target |

The precise aggregate fact keys, constraints, source record IDs, and values live
in `integrations/microcosm_policyengine_us/chronicle_snapshot_fixture/facts.jsonl`.
The reviewed mapping rules live in the adjacent `mappings.yaml`. Tests require
all ten planner cells to contain executable queries; zero `N/A` results pass.

Six rows are explicitly tagged `direct_calibration_target`. Four deliberately
serve as out-of-sample checks. This distinction is fact-specific: the presence
of another fact from the same Census family in the calibration surface does not
turn every Census fact into an in-sample result.

## Constraint translation

The adapter must translate Chronicle semantics rather than parse display labels:

- Chronicle `<`, `<=`, `>`, `>=`, `==`, and `!=` operators become vector masks.
- The canonical AGI URI
  `us:statutes/26/62#adjusted_gross_income` maps to PolicyEngine's
  `adjusted_gross_income`.
- `income_range` is descriptive when the explicit lower and upper constraints
  are present; it must not create a second, inconsistent filter.
- `bea_nipa.series_code=A034RC` selects the meaning of the external target. It
  is source metadata, not a Microcosm record column, so the adapter validates the
  expected constant and then aggregates `employment_income` without applying a
  row mask.
- Domain constraints such as `resident_population` and
  `all_individual_income_tax_returns` are validated as supported universes and
  do not silently alter the record population.
- Entity arrays and weights must be obtained at the same entity level before
  aggregation; cross-entity broadcasting is forbidden.

## What `CapabilityResult` says for each fact

Before executing anything, the planner emits one `CapabilityResult` for every
Chronicle-fact/source pair. It records:

- whether the result is executable directly, executable through the model,
  projected, approximate, a calibration target, or unsupported;
- the exact dataset/model versions, mapping release and mapping ID;
- fact, population, and policy periods and the period treatment;
- entity, weight, geography method, required variables, normalized query, and
  calibration exposure;
- a structured reason code when execution is impossible; and
- whether the cell is eligible for headline scoring.

This prevents `N/A` from being confused with poor model fit and prevents a
calibration target from being presented as independent validation. Capability
classification does not inspect an estimate or observed error, so it cannot
hide a bad result after execution.

## 2023 facts and aging

This adapter will **not** claim that the 2024 Microcosm population natively
represents 2023. The source manifest therefore declares only `calendar_year:2024`
and `tax_year:2024` as native fact periods. Instead, it automatically compiles
fact-specific 2023-to-2024 alignments and evaluates the resulting 2024 targets.
Without that alignment, the same fact still receives `unsupported_period`.

Some targets used while building Microcosm originate in older Chronicle observations
and are transformed to 2024. In that case the build compares its 2024 estimate
with a new, explicitly aligned 2024 target value—not with the raw 2023 value.
For example, current release diagnostics carry fields such as `source_period`,
`target_period`, `aged_to`, `aging_factor`, `aging_factor_source`,
`alignment_model_id`, and `alignment_model_version` for transformed targets.

The evaluation harness keeps those two propositions separate while still
scoring the transformed comparison:

1. A raw `tax_year:2023` or `calendar_year:2023` Chronicle fact remains preserved
   as the observed value.
2. The harness applies Microcosm's `cbo_growth_factor_aging` version `1.2.0`,
   from Microcosm commit `cae8640f9e65e274aea65c7916cb37b956978e32`, to
   create the benchmark actually compared with the 2024 estimate.
3. The result is labeled `projected` and publishes the original value and
   period, transformed value and period, factor, factor source, model/version,
   Microcosm commit, and a human-readable note.
4. The Cross-dataset page will score these facts in their transformed group and
   visibly distinguish that score from native-2024 and calibration-fit scores.

There is no blanket “age every 2023 dollar by CPI” behavior. The implementation
matches Microcosm's source module
`packages/microcosm-build/src/microcosm/build/us_runtime/target_aging.py`:

- USD sums use their matching CBO income-by-source series when one is declared.
- Other USD sums fall back to the CBO AGI series.
- A source year before the CBO projection surface chains observed national SOI
  growth to the first CBO year and CBO growth from there to the build year.
- Counts and non-USD facts use an explicit identity factor and remain raw.
- Publisher projections are not projected a second time.
- Missing or conflicting factor facts fail explicitly; no generic substitute is
  invented.

Parity is tested against an actual current-release row: the 2023 Federal
Reserve household/net-worth observation of $156.0807 trillion transforms to
$169,693,039,350,639.20, exactly matching the current Microcosm diagnostics.
The immutable 48,313-row Chronicle snapshot used for the full comparison contains
235 US facts from 2023. The same pass gave 116 count facts Microcosm's identity
treatment and published them as aligned 2024 benchmarks. The other 119 are USD
sums for which that snapshot does not contain the CBO/SOI factor chain required
by the exact Microcosm algorithm; they remain explicitly `unavailable`. The
harness does not invent a CPI or generic fallback to turn those into results.

The same caution is why this first ten-fact gate does not yet use December 2024
Medicaid enrollment or fiscal-year 2024 SNAP averages. Both are present in the
calibration build, but treating their monthly/fiscal observations as native
annual model facts would erase a real period/stock-versus-flow question. They
remain planned adapter coverage after that mapping is reviewed; they are not
being used to make this checkpoint look broader than it is.

## Actual ten-fact checkpoint

The executable checkpoint was run against the checksum-verified 463 MB release
artifact with the pinned model/core versions. It returned ten finite estimates
and no unsupported or `N/A` cells. The resulting relative errors are:

| Fact | Relative error |
|---|---:|
| US resident population | 0.010% |
| Resident population age 0–4 | 0.019% |
| California resident population | 0.011% |
| California population age 0–4 (ACS) | 0.206% |
| Alabama CD-01 household count (ACS holdout) | 17.992% |
| Returns with EITC | 0.636% |
| Total EITC | 3.291% |
| BEA wages and salaries | 13.333% |
| Returns with EITC, AGI $10k–$15k | 0.370% |
| EITC, AGI $10k–$15k | 0.006% |

These are performance results, not adapter failures. Microcosm's own release
diagnostics report the same 13.333% final error for the BEA wage target. The
congressional-district row is an external holdout. The verifier in
`scripts/verify_microcosm_adapter.py` recomputes all ten from the H5 and model.

## Full Chronicle run

`scripts/run_full_chronicle_evaluation.py` loads and hash-verifies the complete
pinned Chronicle source snapshot, then applies the run's explicit US scope
before classification. It creates exactly one capability row for every scoped
fact/source pair, runs every executable query in batches, attaches the correct
observed or aligned benchmark, and publishes JSONL and Parquet artifacts.

The current full run excludes 2,064 non-US source facts and classifies all
46,249 US facts for this source. It executed
44,346 finite Microcosm/PolicyEngine-US estimates:

- 38,825 native-period comparisons;
- 5,159 prior-year facts evaluated against their explicit 2024 transformations;
  and
- 362 explicit build-target reproductions.

For the 5,538 executable Chronicle facts that were direct calibration targets,
the harness uses the pinned release diagnostics' `final_estimate`: this is the
authoritative post-calibration estimate for the exact materialized target row.
It does not substitute a generic aggregate query. The artifact records this as
`estimate_basis=microcosm_release_final_estimate`.

Chronicle holdouts are still computed from the released HDF5 population and
PolicyEngine-US. IRS SOI queries reproduce the Microcosm build's materializer
semantics: positive income components exclude net losses, Schedule A concepts
apply `tax_unit_itemizes`, PTC uses `assigned_aca_ptc`, and CTC is capped at
`ctc_limiting_tax_liability`. Unsupported rows stay in the capability output
with a reason code; they are not omitted from the run.

The reproducible command is:

```bash
uv run --extra microcosm --extra taxcalc-cps python \
  scripts/run_full_chronicle_evaluation.py \
  --snapshot /path/to/chronicle-snapshot \
  --microcosm-dataset /path/to/populace_us_2024.h5 \
  --acs-pums-aggregates /path/to/pinned-acs-pums-person-age.parquet \
  --output .artifacts/evaluations/<immutable-run-directory>
```

## Tests required before the adapter is accepted

Adapter implementation was written after failing tests covering:

1. release pin and H5 hash verification;
2. a single cached microsimulation and batched variable calculation;
3. correct person, household, and tax-unit weights;
4. country, state, and congressional-district masks;
5. all supported Chronicle comparison operators;
6. domain and source-metadata constraint handling;
7. entity alignment and rejection of mismatched array lengths;
8. deterministic aggregation and cache keys;
9. all ten facts producing finite estimates and scored results; and
10. 2023 facts executing only through the pinned, visibly published alignment.

The adapter checkpoint passes only when the ten real facts execute end to end;
ten unsupported or `N/A` cells cannot satisfy it.
