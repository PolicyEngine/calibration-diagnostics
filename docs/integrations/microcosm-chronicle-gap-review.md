# Microcosm–Chronicle gap review

This review classifies every Chronicle fact against the pinned 2024 Microcosm
release. A model expression is added only when the Chronicle concept and the
Microcosm variable or build target are a direct match with at least 90%
confidence. Zero remains a real scored estimate, not an unsupported result.

## Final evaluation outcome

The immutable artifact is
`chronicle-7917ea815df710fb20db076b-microcosm-expanded-v9`, with run ID
`evaluation-c1fbcdd72da02ae43aeccdda`.

| Treatment | Executable facts |
| --- | ---: |
| Native-period evaluation | 38,825 |
| Exact Microcosm-aligned prior-year evaluation | 5,159 |
| Reproduction of a Microcosm build target | 362 |
| **Total** | **44,346** |

Microcosm's display score is 74.17. Native facts score 69.54, aligned facts
score 77.77, and build-target reproductions score 92.12. Coverage and fit are
separate: adding a directly comparable fact can lower fit when Microcosm misses
it.

## Old congressional districts

All 23,968 Chronicle facts using `5001700US` now execute. The harness joins the
57,240 Microcosm households' 55,736 unique 2020 block GEOIDs to the official
Census 2020 Block Assignment Files and constructs their exact 117th-Congress
district. The 116th district layer in those files has the same boundaries as
the 117th Congress.

This preserves a one-to-one comparison with each original Chronicle fact. It
does not invert Microcosm's many-to-many 117th-to-119th population crosswalk.
The lookup artifact records the URL and SHA-256 of every state BAF, matches all
55,736 requested blocks, and has assignment SHA-256
`f710c1d5404ff2ab7540135ebe6be5ce7f34a326cc5f9569f870f6aa54cdc618`.

These facts are out-of-sample validation. The pinned release knew how to
translate old district target support to the current district surface, but
`gate_congressional_district_targets=false` meant that it did not make the
district facts hard targets.

## Prior-year facts: use the actual build targets

The previous remainder contained 2,966 tax-year 2022/2023 IRS dollar facts,
excluding rental/royalty. The exact pinned release answers whether Microcosm
used them:

- 2,017 are direct targets in the release. The harness now compares against the
  exact compiled build values, including the release's chained SOI/CBO aging,
  any within-surface uprating, and recorded factor provenance.
- 949 are not targets in that release. The harness does not invent factors for
  them; they remain unsupported unless Microcosm's own target contract can
  transform them.

Across all concepts and units, 4,086 cross-period Chronicle facts match direct
targets in the pinned release. Every one now has an executable adapter path.
Another 1,463 Chronicle facts match native-period release targets. The join uses
stable Chronicle source-record IDs because the pinned build used `arch.*` fact
keys while the current snapshot uses `ledger.*` keys.

The harness pins and verifies the release's
`calibration_diagnostics.json` at SHA-256
`870449b44e86b13b25bcea1a57f0e7af37f4d4db18be815eea3acdf9fe6eb40e`.
This is more faithful than reconstructing factors from the current Chronicle
snapshot, which does not contain every intermediate control fact used by the
build.

## Does Microcosm calibrate on the other remainder families?

“Yes” below means the exact pinned release used the Chronicle record as a hard
weight target. “Related only” means Microcosm targets a sibling measure or an
older source record, not the remaining Chronicle value itself.

| Remainder family | Calibration status in the pinned release | How Microcosm treats it |
| --- | --- | --- |
| 2024 child/adult Medicaid enrollment | **No** | The release has 135 hard Medicaid rows: total Medicaid, total CHIP, and their union for available national/state rows. It does not target the child/adult breakouts. |
| TANF caseload and recipient composition | **No** | The 23 TANF targets are `all_funds` cash-assistance expenditures, materialized as weighted sums of `tanf`. Average families/recipients are explicit reviewed exclusions because no receipt indicator/assistance-unit reconstruction is wired. |
| Private-employer premium spending | **No** | It is a reviewed exclusion. The required premium producer is absent from the hermetic input lineage, so the modeled column is structurally zero; targeting it would be invalid. |
| Remaining BEA concepts | **No** | Only national wages and national proprietors' income are direct BEA targets (two rows). The remaining NIPA totals are macro cross-checks; regional state wages are deferred because BEA is place-of-work while the model is residence-based. |
| IRS rental/royalty | **Yes for Historic Table 2; no for the old-CD records** | The release has 104 national/state Historic Table 2 targets. It deliberately materializes both amount and return count from `rental_income` plus `farm_rent_income`; the harness now uses the same recipe. The old-CD source package was excluded from hard targets, so its 960 current-period comparisons are holdouts. |
| SNAP average persons and per-person benefits | **No** | The 104 SNAP hard targets are total benefits and average participating households for 52 geographic rows. Person counts are reviewed exclusions because counting all people in recipient SPM units materially overstates administrative participants. |
| Social Security tips counts | **Related only** | The release targets the 2020 W-2 tip amount and return count using `tip_income` (sum and nonzero indicator). It does not target the current 2024 source records, and never targets the taxpayer-count measure. |
| CBO federal receipts | **No** | The five CBO targets are AGI, wages, qualified dividends, net capital gains, and net business income projections. Fiscal-year total receipts are an explicit macro-control exclusion, not household tax liability. |
| JCT tax expenditures | **Yes—all 11** | Each is a `reform_minus_baseline_income_tax` row. Microcosm neutralizes the named deduction/credit variable, runs the counterfactual, and targets the weighted income-tax difference to JCT's revenue-loss value. Some rows are documented as broad-fit anchors where JCT's concept is wider than the single neutralized variable. |
| ICI paid/reinvested capital-gain distributions | **No** | The source and paid-versus-reinvested split do not appear in the target registry. |
| Tennessee individual-income-tax collections | **No** | The release has 44 state-income-tax targets, but not Tennessee. The remaining Tennessee collections have no modeled support after repeal of the Hall tax. |
| December 2025 Medicaid enrollment | **No** | This is a 2024 society-wide artifact and its Medicaid target surface is the December 2024 release (with one national Medicaid total sourced from November). A 2025 value requires a genuine 2025 population/model contract. |

## Current remainder accounting

After the expansion, 3,967 Microcosm cells remain non-executable. Of these,
2,064 are non-US facts and correctly remain not applicable. The 1,903 US
remainders are:

| Chronicle source | Period | Concept | Entity | Total |
| --- | ---: | ---: | ---: | ---: |
| IRS SOI | 959 | 2 | 0 | 961 |
| BEA | 2 | 383 | 2 | 387 |
| CMS Medicaid | 359 | 0 | 0 | 359 |
| USDA SNAP | 110 | 0 | 2 | 112 |
| TANF | 3 | 0 | 55 | 58 |
| Investment Company Institute | 0 | 0 | 12 | 12 |
| JCT | 0 | 11 | 0 | 11 |
| CBO | 0 | 0 | 1 | 1 |
| Census state tax collections | 0 | 0 | 1 | 1 |
| CMS National Health Expenditure Accounts | 0 | 1 | 0 | 1 |
| **Total** | **1,433** | **397** | **73** | **1,903** |

The remaining 959 IRS period gaps are not direct targets in the pinned release;
all direct cross-period target matches execute. The two remaining IRS concept
gaps are the current W-2 tip return and taxpayer counts described above.

## Code and release evidence

- Exact target compilation and base-variable choices:
  `packages/populace-build/src/populace/build/us_runtime/fiscal_targets.py` at
  Populace commit `cae8640f9e65e274aea65c7916cb37b956978e32`.
- Exact dollar aging policy:
  `packages/populace-build/src/populace/build/us_runtime/target_aging.py`.
- Reviewed inclusions and exclusions:
  `packages/populace-build/src/populace/build/us/target_parity_manifest.json`.
- District translation:
  `congressional_district_vintage.py` and
  `congressional_district_vintage_crosswalk.py` in the same runtime package.
- Harness implementations:
  `evaluation_harness/populace_release_targets.py`,
  `evaluation_harness/populace_old_cd.py`, and
  `evaluation_harness/adapters/populace.py`.
