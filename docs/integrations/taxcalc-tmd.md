# Tax-Calculator / TMD integration overview

Status: **awaiting confirmation before adapter implementation**

This pairing uses Tax-Calculator 6.7.1 with
`tax-microdata-benchmarking==2.1.3`. TMD combines PUF- and CPS-derived inputs in
a 2022 base, then Tax-Calculator advances it to 2024. Results will therefore be
labeled `advanced_population`, not native 2024 observations.

The adapter will accept explicit paths for `tmd.csv.gz`, `tmd_weights.csv.gz`,
and `tmd_growfactors.csv`, verify a user-supplied manifest of their hashes, call
`Records.tmd_constructor(..., exact_calculations=True)`, apply TMD's SOI income
tax configuration, advance once, and reuse the Tax-Calculator array machinery
already tested by the public-CPS adapter. Restricted microdata will never be
committed or published; only aggregate results and reproducibility metadata may
leave the runner.

## Proposed ten-fact checkpoint

| Ledger fact | Expression |
|---|---|
| Returns with income-tax liability | count where `iitax > 0` |
| Adjusted gross income | `c00100` |
| CBO wages and salaries projection | `e00200` |
| Net capital gains | `c01000` |
| Partnership/S-corporation net income | `e26270` |
| Qualified dividends | `e00650` |
| Total itemized deductions | `c04470` |
| Income tax before credits | `c05800` |
| Income-tax liability after credits | `iitax` |
| Earned income tax credit | `c59660` |

Each expression is weighted by `s006`. These are ten exact, finite Ledger rows
from snapshot `ledger-7917ea815df710fb20db076b`, and every one has an explicit
TMD/Tax-Calculator path. The plan originally named taxable income, but the
current Ledger snapshot has no taxable-income fact; income tax before credits
is used instead rather than inventing a target.

All results are external-validation results. TMD construction may itself use
SOI information, so the eventual adapter must also record more specific
calibration exposure where a TMD target manifest demonstrates direct use.
Missing local restricted inputs will block execution honestly; they cannot be
reported as ten successful `N/A` checks.
