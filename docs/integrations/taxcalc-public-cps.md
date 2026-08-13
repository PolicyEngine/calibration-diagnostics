# Public CPS + Tax-Calculator integration overview

Status: **adapter implemented and audited against Tax-Calculator 6.7.1**

This pairing uses Tax-Calculator 6.7.1's bundled public CPS records. The CPS
microdata have a 2014 base and Tax-Calculator advances them to each evaluated
year with year-specific growth factors and weights. Chronicle tax-year 2022,
2023, and 2024 facts therefore run against Tax-Calculator calculations for the
same year; no prior-year fact is silently compared with a 2024 array.

The adapter constructs `Records.cps_constructor()`, advances one calculator at
a time to the requested fact year, calls `calc_all()`, and exposes direct CPS
inputs and calculated Tax-Calculator variables to the shared aggregator. Every
aggregate uses `s006`.

The public CPS also retains a two-digit state `fips` field. The adapter supports
national and state results, including D.C. It does not claim congressional-
district coverage because the public CPS has no district assignment.

## Full Chronicle result

Run `evaluation-1d81ff4bcc6cf662b47baf00` evaluates 7,525 facts:

| Geography | Chronicle facts | Evaluated | Coverage |
| --- | ---: | ---: | ---: |
| National | 1,405 | 1,048 | 74.59% |
| State | 11,691 | 6,477 | 55.40% |
| Congressional district | 33,145 | 0 | 0.00% |
| **All U.S. facts** | **46,241** | **7,525** | **16.27%** |

All 7,525 results are score eligible. Their fact-level mean error, capped at
100% per fact, is 38.73%.

| Observed period | Evaluated | Mean capped error |
| --- | ---: | ---: |
| Calendar year 2024 | 53 | 17.23% |
| Tax year 2022 | 4,807 | 38.70% |
| Tax year 2023 | 232 | 31.78% |
| Tax year 2024 | 2,433 | 39.92% |

## Executed concepts

Direct advanced CPS inputs include wages, taxable and tax-exempt interest,
ordinary and qualified dividends, Schedule C income, taxable IRA and pension
distributions, unemployment compensation, gross Social Security benefits, and
imputed SSI benefits.

Calculated Tax-Calculator outputs include AGI, taxable income, income tax
before and after nonrefundable credits, EITC, child and additional child tax
credits, QBI deduction, itemized deductions and their medical, SALT, interest,
charitable, and real-estate components. Matching return counts use the nonzero
calculated amount. The same expressions execute Chronicle's explicit AGI bands,
filing-status slices, EITC-child groups, and state geographies.

The full remaining-gap classification is in
`docs/integrations/taxcalc-public-cps-gap-audit.md`.

## Ten-fact checkpoint

The original ten-fact checkpoint remains a small adapter smoke test. It covers
returns with income-tax liability, AGI, CBO wages, taxable interest, ordinary
dividends, taxable pensions, taxable Social Security, unemployment,
income-tax liability, and EITC. It is no longer treated as the adapter's total
capability surface.
