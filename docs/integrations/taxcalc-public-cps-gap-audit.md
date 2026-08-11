# Public CPS + Tax-Calculator–Chronicle gap audit

This audit classifies all 46,241 U.S. Chronicle facts against Tax-Calculator
6.7.1 and its bundled public CPS. A fact is scored only when its concept,
period, entity conversion, and geography have a reviewed direct interpretation.

## Audit outcome

The immutable artifact is
`chronicle-7917ea815df710fb20db076b-taxcalc-expanded-v21`, with run ID
`evaluation-45599b6d31eeab4a002ecd95`.

| Result | Count |
| --- | ---: |
| Chronicle facts | 46,241 |
| Public CPS + Tax-Calculator results | 7,877 |
| Direct advanced-input results | 3,213 |
| Model-derived results | 4,612 |
| Semantically aligned BEA wage results | 52 |
| Unsupported | 38,364 |

The audit increased coverage from 38 to 7,877 facts. The additions consist of
same-year 2022 and 2023 execution, a broad IRS tax-variable mapping, state FIPS
execution, national/state gross benefit totals that exist in the CPS, public-
CPS capital gains, PEP total population, residence-adjusted BEA wages, national
BEA benefit totals, and nine Tax-Calculator policy counterfactuals.

## Geography accounting

| Geography | Evaluated | Unsupported | Explanation |
| --- | ---: | ---: | --- |
| National | 1,094 | 311 | Most tax concepts are covered; the remainder is detailed below. |
| State | 6,783 | 4,908 | CPS state FIPS is available, but many non-tax concepts and absent tax inputs remain unsupported. |
| Congressional district | 0 | 33,145 | Public CPS records have no congressional-district identifier. |

State results use the record-level Tax-Calculator `fips` input, which contains
all 50 states and D.C. They are not synthesized from national shares.

## Remaining tax-concept gaps

The remaining 1,384 concept gaps are concepts for which no exact reviewed
public-CPS or Tax-Calculator representation has been approved.

### Public CPS inputs that are structurally absent

| Missing family | National | State | Why it remains unsupported |
| --- | ---: | ---: | --- |
| Partnership/S-corporation amount/return facts | 24 | 204 | `e02000` and `e26270` are unavailable in `taxdata_cps` and structural zero. |
| Rental/royalty amount/return facts | 24 | 204 | The required Schedule E `e02000` input is unavailable in `taxdata_cps`. |
| Premium tax credit amount/return facts | 24 | 204 | Tax-Calculator has no public-CPS ACA premium-tax-credit producer matching the SOI concept. |
| Pension/IRA contribution and Form W-2 contribution facts | 6 | 0 | `pencon_p` and `pencon_s` are structural zero and do not provide the required Roth/traditional splits. |
| Social Security tip facts | 3 | 0 | The public CPS does not carry the historical Form W-2 Social Security tip reporting fields. |

Public CPS capital gains are now evaluated through `e01100`. Although the
schedule-D split arrays `p22250` and `p23250` are structural zero, TaxData
imputes the CPS capital-gains concept into `e01100`. The remaining CBO net-
business-income projection requires Schedule E partnership/S-corporation
income, so Schedule C plus farm income would be an incomplete substitute.

### Filing-universe counts

Chronicle has 13 national and 561 state `individual_income_tax_returns` facts,
plus 12 national and 102 state `tax_filer_individuals` facts. Tax-Calculator's
public CPS is constructed as tax units and does not retain an observed filing-
decision flag. Counting all CPS tax units or summing `XTOT` would count modeled
nonfiling units as returns, so those 688 facts remain unscored.

### JCT tax expenditures

The harness now evaluates nine of the 11 JCT revenue-loss facts with separate,
cached current-law and provision-repeal Tax-Calculator runs. Each result is the
weighted sum of reform income tax minus baseline income tax, holding the public
CPS population and behavior fixed. Because every provision is repealed from
the same current-law baseline, the results do not depend on an arbitrary
ordering.

Two JCT facts remain held out. The public CPS has no usable HSA deduction input,
and Tax-Calculator can repeal the child and dependent care credit but cannot
separately remove the employer-provided child-care exclusion included in the
combined Chronicle target.

## Remaining entity gaps

After the reviewed person-to-tax-unit bridges, 2,899 entity gaps remain. PEP
total population is evaluated with `XTOT`; the 936 PEP age slices are now
explicitly classified as unsupported constraints because dependent single-year
ages cannot be reconstructed from the public CPS. BEA residence-adjusted wages,
NIPA wages, six national benefit totals, and the CMS Medicaid expenditure total
are also evaluated through reviewed additive arrays.

| Family | Count | Limitation |
| --- | ---: | --- |
| Census age distributions | — | CPS tax-unit records retain exact ages only for primary and spouse; dependent ages are aggregated, so most single-year/five-year person counts cannot be reconstructed. |
| BEA national/regional accounts | — | Reviewed wage and benefit components are covered; remaining facts require NIPA imputations, employer accruals, or institutional flows absent from the tax records. |
| SSA payment categories and recipients | 373 | `e02400` supplies gross OASDI and `ssi_ben` total SSI dollars, but not administrative benefit type or person recipient counts. |
| CMS/KFF health enrollment and expenditures | 724 | Actuarial benefit-value inputs are not person enrollment records or administrative expenditure totals. |
| TANF | 110 | `tanf_ben` is a tax-unit benefit amount, not administrative family/recipient composition. |
| SNAP | 208 | `snap_ben` does not identify monthly participating people or households, and fiscal-year administrative totals do not share its period basis. |
| ICI capital-gain distributions | 12 | Household tax variables do not reproduce the institutional paid-versus-reinvested split. |
| Other government/wealth facts | 49 | State tax collections, LIHEAP households, and household net worth require concepts absent from the Tax-Calculator records. |

## Evidence in code

- Integration period and geography declaration:
  `integrations/taxcalc_cps/overview.yaml`.
- Reviewed mapping release:
  `integrations/taxcalc_cps/mappings.yaml`, release
  `taxcalc-public-cps-chronicle-expansion-v3`.
- Same-year calculator switching, state FIPS, composite expressions, and
  cached JCT provision-repeal runs:
  `evaluation_harness/adapters/taxcalc_cps.py`.
- Tax-Calculator variable availability and definitions:
  installed `taxcalc/records_variables.json` for version 6.7.1.
