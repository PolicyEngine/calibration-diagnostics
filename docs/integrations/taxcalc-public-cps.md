# Tax-Calculator / public CPS integration overview

Status: **adapter implemented and verified against Tax-Calculator 6.7.1**

This pairing uses Tax-Calculator 6.7.1's bundled public CPS records. The CPS
microdata are a 2014 base that Tax-Calculator advances to 2024 using its growth
factors and year-specific weights; therefore every checkpoint result is labeled
`advanced_population`, not native 2024 data. Policy parameters and calculated
variables are evaluated for tax year 2024.

The adapter constructs `Records.cps_constructor()`, creates one `Calculator`,
call `advance_to_year(2024)` and `calc_all()` once, and expose Tax-Calculator
arrays to the shared aggregator. Inputs such as `e00200`, `e00300`, `e00600`,
`e01700`, and `e02300` are read directly after advancement. Derived concepts
such as `c00100`, `c02500`, `iitax`, and `c59660` come from the model. Every
aggregate uses `s006`. The public CPS supports only national comparisons here;
no state or local geography is inferred.

## Proposed ten-fact checkpoint

| Ledger fact | Tax-Calculator expression | Method |
|---|---|---|
| Returns with income-tax liability | weighted count where `iitax != 0` | Model |
| Adjusted gross income | weighted sum of `c00100` | Model |
| CBO wages and salaries projection | weighted sum of `e00200` | Direct advanced input |
| Taxable interest | weighted sum of `e00300` | Direct advanced input |
| Ordinary dividends | weighted sum of `e00600` | Direct advanced input |
| Taxable pensions and annuities | weighted sum of `e01700` | Direct advanced input |
| Taxable Social Security | weighted sum of `c02500` | Model |
| Unemployment compensation | weighted sum of `e02300` | Direct advanced input |
| Income-tax liability after credits | weighted sum of `iitax` | Model |
| Earned income tax credit | weighted sum of `c59660` | Model |

These are ten exact numeric rows from Ledger snapshot
`ledger-7917ea815df710fb20db076b`. They span ten concepts, include a count and
dollar amounts, and all have concrete Tax-Calculator expressions. The adapter
checkpoint will run all ten; unsupported results cannot pass it.

The actual checkpoint returned ten finite estimates and no unsupported results:

| Ledger fact | Relative error |
|---|---:|
| Returns with income-tax liability | 4.794% |
| Adjusted gross income | 5.592% |
| CBO wages and salaries projection | 2.914% |
| Taxable interest | 6.860% |
| Ordinary dividends | 79.308% |
| Taxable pensions and annuities | 3.401% |
| Taxable Social Security | 38.845% |
| Unemployment compensation | 5.648% |
| Income-tax liability after credits | 8.920% |
| Earned income tax credit | 17.960% |

The large dividend and Social Security errors remain visible results; they are
not converted to missing coverage. `scripts/verify_taxcalc_cps_adapter.py`
reproduces this gate directly from the bundled public CPS.

## Breakdown coverage

The ten-fact gate uses national totals, but the adapter is not limited to those
totals. It exposes normalized filing status and EITC qualifying-child arrays,
maps Ledger's canonical AGI and qualifying-child variables to `c00100` and
`EIC`, and applies Ledger's explicit comparison operators for income bands and
child groups. A full pass over the pinned snapshot produced 38 finite 2024
results: the ten checkpoint totals plus all currently mapped EITC income-band
and qualifying-child facts. Older-period facts remain explicit unsupported
periods until a year-specific source run is declared; they are not silently
evaluated with 2024 arrays.

The combined full Ledger run classified all 48,313 facts for public CPS and
executed those 38 mapped national 2024 cells. The remaining facts are present
in the capability matrix with explicit jurisdiction, geography, entity,
period, or concept reason codes; most are subnational facts, which this CPS
adapter does not claim to represent.

All ten comparisons are external validation, not calibration fit. A poor public
CPS estimate remains a valid test result and must not be dropped after seeing
its error. In particular, ordinary dividends remain in this transparent
checkpoint even though the existing Cross-dataset implementation excluded that
concept after observing a large discrepancy.

## Important semantic boundaries

- The total IRS return count is not used because public CPS contains constructed
  tax units but does not supply an observed filing-decision flag. The count gate
  instead uses the directly testable IRS count of returns with nonzero final
  income-tax liability.
- The wage benchmark is the CBO individual-income-tax projection, whose tax-unit
  entity and tax-year basis match `e00200`; the BEA employee/NIPA observation is
  not silently relabeled as a tax-unit fact.
- Ledger dimensions `filing_status=all` and `income_range=all` are descriptive
  total labels and do not become fictitious Tax-Calculator columns.
- The overview deliberately covers only total national cells. Income bands,
  itemizers, and EITC-child slices will require their explicit masks in the
  adapter, rather than parsing labels.
- Public CPS is a model-specific dataset shipped with Tax-Calculator, so this is
  a model/dataset pairing—not a standalone raw-CPS score.
