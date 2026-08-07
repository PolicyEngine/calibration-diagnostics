# Microcosm–Chronicle gap review

This review classifies every Chronicle fact that was not executable by the
Microcosm adapter before the mapping expansion. A fact was added only when the
Chronicle concept and the Microcosm variable or build target were judged to be
a direct match with at least 90% confidence. A zero estimate is retained as a
real scored result; it is not converted into an unsupported result.

## Evaluation outcome

The expanded immutable artifact is:

`chronicle-7917ea815df710fb20db076b-microcosm-expanded-v4`

Its run ID is `evaluation-15f329def1e177498c197716`. It contains 48,313
Chronicle facts and 144,939 fact-adapter cells. Microcosm now executes 18,143
facts, a net gain of 3,489 over the pre-review artifact:

| Treatment | Executable facts |
| --- | ---: |
| Native-period evaluation | 14,753 |
| Exact Microcosm-aligned prior-year evaluation | 3,028 |
| Reproduction of a Microcosm build target | 362 |
| **Total** | **18,143** |

The Microcosm display score is 77.96. Native-period facts score 77.76,
prior-year aligned facts score 73.77, and build-target reproductions score
92.12. Coverage and fit remain separate: adding a directly comparable fact can
lower the fit score when Microcosm misses it.

## What was added

The high-confidence pass added direct support for:

- Census population estimates and projections;
- ACS household SNAP receipt;
- IRS SOI concepts already represented in Microcosm's fiscal target mappings;
- CMS Medicaid Title XIX spending, Medicare Part B premiums, ACA selections,
  APTC consumers, and average APTC;
- KFF marketplace effectuated enrollment;
- Federal Reserve net worth;
- USDA SNAP benefits and average participating households;
- LIHEAP households, TANF cash expenditures, and state individual-income-tax
  collections where the period and geography match a Microcosm build target;
- CMS total Medicaid, CHIP, and combined enrollment;
- federal SSI recipient age bands;
- Social Security tips as a dollar amount; and
- selected national and regional BEA concepts for which the Microcosm source
  documents an equivalent definition.

Microcosm's own aging contract consumes tax-year 2022 and 2023 targets when
building the 2024 dataset. The harness now invokes that same contract for both
source years. Counts stay unchanged, exactly as they do in Microcosm. Dollar
facts execute only when the Microcosm aging code can produce the exact factor;
the harness does not invent a proxy factor or compare an unaged dollar amount.
This made 3,028 prior-year facts comparable. Of the 6,123 prior-year US facts
inspected, 3,033 dollar facts still lack an exact usable transformation, and 62
otherwise comparable return-count facts combine rental income with royalty
income, which Microcosm cannot reproduce directly.

The implementation evidence is in
`packages/populace-build/src/populace/build/us_runtime/fiscal_targets.py` and
`target_aging.py` in the sibling Populace repository. The adapter contract and
mappings are recorded in `integrations/populace_policyengine_us/` in this
repository.

## Exact remainder accounting

After the expansion, 30,170 Microcosm cells remain non-executable. Of these,
2,064 are non-US facts and therefore outside the US model's scope. The 28,106
US remainders are:

| Chronicle source | Geography | Period | Concept mapping | Entity | Total |
| --- | ---: | ---: | ---: | ---: | ---: |
| IRS SOI | 23,968 | 3,028 | 168 | 0 | 27,164 |
| BEA | 0 | 2 | 383 | 2 | 387 |
| CMS Medicaid | 0 | 359 | 0 | 0 | 359 |
| USDA SNAP | 0 | 110 | 0 | 2 | 112 |
| TANF | 0 | 3 | 0 | 55 | 58 |
| Investment Company Institute | 0 | 0 | 0 | 12 | 12 |
| JCT | 0 | 0 | 11 | 0 | 11 |
| CBO | 0 | 0 | 0 | 1 | 1 |
| Census state tax collections | 0 | 0 | 0 | 1 | 1 |
| CMS National Health Expenditure Accounts | 0 | 0 | 1 | 0 | 1 |
| **Total** | **23,968** | **3,502** | **563** | **73** | **28,106** |

“Period” means the concept may exist but the requested fact cannot be aligned
under the current Microcosm period contract. “Entity” includes facts whose
published unit cannot be constructed from the available Microcosm entities
without changing its meaning.

## Remainders ranked for review

The confidence below is confidence in conceptual comparability, not confidence
that the current harness can already execute the fact. Counts are disjoint, so
they add to the 28,106 US remainders.

| Rank | Remaining facts | Count | Confidence | Assessment and next requirement |
| ---: | --- | ---: | ---: | --- |
| 1 | IRS concepts in old congressional-district geographies, excluding rental/royalty | 23,112 | 98% | The measures map directly. Microcosm includes a 117th-to-119th district target crosswalk, but it is many-to-many and cannot preserve a single Chronicle fact as a single comparison. Exact execution needs the old district assignment at block level, or an explicitly grouped comparison contract. |
| 2 | Tax-year 2022/2023 IRS dollar concepts, excluding rental/royalty | 2,966 | 95% | Wages, AGI, taxable interest, credits, deductions, and similar concepts are direct. They remain blocked because Microcosm's aging machinery cannot currently produce the exact required factor for these particular facts. Comparing them raw would be wrong. |
| 3 | 2024 CMS child/adult Medicaid enrollment | 104 | 85–89% | Microcosm can form age groups, but CMS child/adult reporting is not proven to use one nationally uniform age boundary. This needs a state-specific definition audit before adding it. |
| 4 | TANF caseload and recipient composition | 58 | 75–85% | Microcosm has people, families, and program receipt, but the TANF assistance-unit definitions and one-/two-parent categories need an explicit reconstruction rather than a household proxy. |
| 5 | Private-employer premium spending in CMS NHE | 1 | 80% | Total employer-sponsored premium spending is measurable and is now scored, but the requested private-employer-only component needs a defensible private/government employer split. |
| 6 | BEA concepts not accepted in the direct pass | 387 | 40–80% | Some aggregates may be derivable, but each needs an accounting-identity audit. The Microcosm source explicitly warns that regional wages use residence while BEA publishes place of work, and that NIPA interest/dividend totals include flows absent from household microdata. Those superficially similar mappings were deliberately rejected. |
| 7 | Rental-and-royalty IRS facts | 1,084 | 65–75% | Microcosm represents rental and farm-rent income but not the royalty component in the combined IRS measure. This affects old-district, prior-year-dollar, current amount, and return-count facts. A direct mapping would systematically omit part of the target. |
| 8 | SNAP average persons and per-person benefits | 112 | 60–70% | Participating households and total benefits are now covered. Microcosm's own build notes that using all people in a participating SPM unit overstates SNAP participants by roughly 50%, so that proxy is not acceptable. Guam and the US Virgin Islands also fall outside the model geography. |
| 9 | Social Security tips return/taxpayer counts | 2 | 30–50% | The dollar total is covered, but Microcosm's source has nonzero tips for less than 1% of the relevant population. A return-count comparison would test sparse imputation support rather than the Chronicle concept faithfully. |
| 10 | CBO federal receipts | 1 | 40–60% | This is fiscal-year cash accounting, while the model primarily produces tax liability. It needs a timing and accounting bridge. |
| 11 | JCT tax expenditures | 11 | 30–50% | These are counterfactual estimates. They require a separately specified reform and JCT-consistent behavioral/accounting assumptions, not a baseline aggregation. |
| 12 | ICI paid versus reinvested capital-gain distributions | 12 | 20–40% | Microcosm does not identify the paid/reinvested fund-distribution split. |
| 13 | Tennessee individual-income-tax collections | 1 | 10–30% | Chronicle records residual collections, while the relevant modeled Hall tax is repealed. A model-derived liability is not the same object. |
| 14 | 2025 CMS Medicaid enrollment | 255 | 0% for this build | These facts cannot be evaluated by a 2024 Microcosm society-wide artifact without adding a genuine 2025 build and period contract. |

The 2,064 non-US Chronicle facts remain not applicable rather than gaps in
Microcosm coverage.

## Recommended order for the next decisions

1. Decide whether grouped district-crosswalk comparisons are acceptable, or
   require exact old-district block assignment. This unlocks by far the largest
   high-confidence group.
2. Decide whether to extend Microcosm's own aging factor coverage for the 2,966
   direct prior-year dollar facts. No harness-only shortcut should be used.
3. Audit CMS's state-specific child/adult definitions.
4. Specify TANF assistance units.
5. Review BEA families one accounting identity at a time.

