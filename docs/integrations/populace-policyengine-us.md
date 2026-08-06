# Populace / PolicyEngine-US integration overview

Status: **awaiting approval before adapter implementation**  
Reviewed release: `populace-us-2024-buildp-sparse-rmloss100-cae8640-20260728T011454Z`  
Ledger snapshot: `ledger-7917ea815df710fb20db076b`

## What will be connected

This is a model/dataset pairing, not a raw-dataset adapter:

- Dataset: `policyengine/populace-us`, file `populace_us_2024.h5`, SHA-256
  `48b9d479fb4fd1c3537f9383ce4697d130b6f618658409d74f6233c43b994c7e`.
- Dataset build: Populace commit
  `cae8640f9e65e274aea65c7916cb37b956978e32`.
- Model: `policyengine-us==1.764.6` (with `policyengine-core==3.26.11` in the
  release manifest).
- Population period: calendar year 2024.
- Policy calculation period: tax year 2024.
- Weight entities: person, household, and tax unit.
- Geography paths: national, state FIPS, and congressional-district GEOID.

The adapter will download the release-pinned H5, verify its hash, construct one
cached `policyengine_us.Microsimulation`, calculate all required variables once,
and expose entity-aligned arrays to the common harness aggregator. Direct
microdata variables (for example `age` and `employment_income`) and calculated
PolicyEngine variables (for example `eitc`) use the same aggregation interface.

The existing `frontend/scripts/populace_variable_core.py` proves the local
loading path and documents the dataset's substantial disk and memory needs. The
new adapter will move the reusable loading behavior behind a harness interface;
it will not call a browser API once per fact.

## Exact ten-fact verification set

These are exact rows from the pinned, 48,313-row Ledger snapshot. The committed
fixture is a lossless copy of their material comparison fields. The checkpoint
was also validated against the full locally compiled snapshot, rather than only
against that fixture.

| # | Ledger fact | Period | Geography | Model-side expression | Target | Exposure |
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
in `integrations/populace_policyengine_us/ledger_snapshot_fixture/facts.jsonl`.
The reviewed mapping rules live in the adjacent `mappings.yaml`. Tests require
all ten planner cells to contain executable queries; zero `N/A` results pass.

Six rows are explicitly tagged `direct_calibration_target`. Four deliberately
serve as out-of-sample checks. This distinction is fact-specific: the presence
of another fact from the same Census family in the calibration surface does not
turn every Census fact into an in-sample result.

## Constraint translation

The adapter must translate Ledger semantics rather than parse display labels:

- Ledger `<`, `<=`, `>`, `>=`, `==`, and `!=` operators become vector masks.
- The canonical AGI URI
  `us:statutes/26/62#adjusted_gross_income` maps to PolicyEngine's
  `adjusted_gross_income`.
- `income_range` is descriptive when the explicit lower and upper constraints
  are present; it must not create a second, inconsistent filter.
- `bea_nipa.series_code=A034RC` selects the meaning of the external target. It
  is source metadata, not a Populace record column, so the adapter validates the
  expected constant and then aggregates `employment_income` without applying a
  row mask.
- Domain constraints such as `resident_population` and
  `all_individual_income_tax_returns` are validated as supported universes and
  do not silently alter the record population.
- Entity arrays and weights must be obtained at the same entity level before
  aggregation; cross-entity broadcasting is forbidden.

## What `CapabilityResult` says for each fact

Before executing anything, the planner emits one `CapabilityResult` for every
Ledger-fact/source pair. It records:

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

This adapter will **not** claim that the 2024 Populace population natively
represents 2023. The source manifest therefore declares only `calendar_year:2024`
and `tax_year:2024` as native fact periods. The test suite takes a valid 2024
population fact, changes it to 2023, and requires `unsupported_period`.

Some targets used while building Populace originate in older Ledger observations
and are transformed to 2024. In that case the build compares its 2024 estimate
with a new, explicitly aligned 2024 target value—not with the raw 2023 value.
For example, current release diagnostics carry fields such as `source_period`,
`target_period`, `aged_to`, `aging_factor`, `aging_factor_source`,
`alignment_model_id`, and `alignment_model_version` for transformed targets.

The evaluation harness keeps those two propositions separate:

1. A raw `tax_year:2023` or `calendar_year:2023` Ledger fact remains a 2023
   fact and is not directly scored against the 2024 Populace population.
2. It becomes comparable only through a reviewed `AlignmentDeclaration` that
   creates a derived target with a pinned factor, source, model/version, and
   preferably a backtest error. That result is labeled `projected`, retains the
   original fact key and both periods, and is excluded from headline scores by
   default.

There is no blanket “age every 2023 dollar by CPI” behavior. Different concepts
require different projection sources, and count facts may require population or
program-specific projections rather than monetary uprating.

The same caution is why this first ten-fact gate does not yet use December 2024
Medicaid enrollment or fiscal-year 2024 SNAP averages. Both are present in the
calibration build, but treating their monthly/fiscal observations as native
annual model facts would erase a real period/stock-versus-flow question. They
remain planned adapter coverage after that mapping is reviewed; they are not
being used to make this checkpoint look broader than it is.

## Tests required before the adapter is accepted

After approval, adapter implementation starts with failing tests for:

1. release pin and H5 hash verification;
2. a single cached microsimulation and batched variable calculation;
3. correct person, household, and tax-unit weights;
4. country, state, and congressional-district masks;
5. all supported Ledger comparison operators;
6. domain and source-metadata constraint handling;
7. entity alignment and rejection of mismatched array lengths;
8. deterministic aggregation and cache keys;
9. all ten facts producing finite estimates and scored results; and
10. 2023 remaining unsupported without an explicit alignment declaration.

The adapter checkpoint passes only when the ten real facts execute end to end;
ten unsupported or `N/A` cells cannot satisfy it.
