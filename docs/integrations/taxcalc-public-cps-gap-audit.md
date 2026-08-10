# Public CPS + Tax-Calculator–Chronicle gap audit

This audit classifies all 46,241 U.S. Chronicle facts against Tax-Calculator
6.7.1 and its bundled public CPS. A fact is scored only when its concept,
period, entity conversion, and geography have a reviewed direct interpretation.

## Audit outcome

The immutable artifact is
`chronicle-7917ea815df710fb20db076b-taxcalc-audit-v19`, with run ID
`evaluation-1d81ff4bcc6cf662b47baf00`.

| Result | Count |
| --- | ---: |
| Chronicle facts | 46,241 |
| Public CPS + Tax-Calculator results | 7,525 |
| Direct advanced-input results | 2,922 |
| Model-derived results | 4,603 |
| Unsupported | 38,716 |

The audit increased coverage from 38 to 7,525 facts. The additions consist of
same-year 2022 and 2023 execution, a broad IRS tax-variable mapping, state FIPS
execution, and national/state gross benefit totals that exist in the CPS.

## Geography accounting

| Geography | Evaluated | Unsupported | Explanation |
| --- | ---: | ---: | --- |
| National | 1,048 | 357 | Most tax concepts are covered; the remainder is detailed below. |
| State | 6,477 | 5,214 | CPS state FIPS is available, but many non-tax concepts and absent tax inputs remain unsupported. |
| Congressional district | 0 | 33,145 | Public CPS records have no congressional-district identifier. |

State results use the record-level Tax-Calculator `fips` input, which contains
all 50 states and D.C. They are not synthesized from national shares.

## Remaining tax-concept gaps

The remaining 1,622 concept gaps include 1,609 IRS facts and 13 federal-model
benchmarks.

### Public CPS inputs that are structurally absent

| Missing family | National | State | Why it remains unsupported |
| --- | ---: | ---: | --- |
| Capital gains amount/return facts | 24 | 204 | Public CPS `p22250`, `p23250`, and calculated capital-gain arrays are structural zero. |
| Partnership/S-corporation amount/return facts | 24 | 204 | `e02000` and `e26270` are unavailable in `taxdata_cps` and structural zero. |
| Rental/royalty amount/return facts | 24 | 204 | The required Schedule E `e02000` input is unavailable in `taxdata_cps`. |
| Premium tax credit amount/return facts | 24 | 204 | Tax-Calculator has no public-CPS ACA premium-tax-credit producer matching the SOI concept. |
| Pension/IRA contribution and Form W-2 contribution facts | 6 | 0 | `pencon_p` and `pencon_s` are structural zero and do not provide the required Roth/traditional splits. |
| Social Security tip facts | 3 | 0 | The public CPS does not carry the historical Form W-2 Social Security tip reporting fields. |

The two remaining CBO projections are net capital gains and net business
income. The first lacks public-CPS capital gains. The second requires Schedule
E partnership/S-corporation income, so Schedule C plus farm income would be an
incomplete substitute.

### Filing-universe counts

Chronicle has 13 national and 561 state `individual_income_tax_returns` facts,
plus 12 national and 102 state `tax_filer_individuals` facts. Tax-Calculator's
public CPS is constructed as tax units and does not retain an observed filing-
decision flag. Counting all CPS tax units or summing `XTOT` would count modeled
nonfiling units as returns, so those 688 facts remain unscored.

### JCT tax expenditures

The 11 JCT revenue-loss facts are not baseline aggregates. They require a
separate counterfactual policy run for each provision, plus an explicit
convention for interactions and ordering. Tax-Calculator can support a future
counterfactual adapter for several of these provisions, but a baseline variable
is not a valid revenue-loss estimate.

## Remaining entity gaps

After bridging gross Social Security and total SSI payments from person facts
to tax-unit sums, 3,949 entity gaps remain:

| Family | Count | Limitation |
| --- | ---: | --- |
| Census age distributions | 2,028 | CPS tax-unit records retain exact ages only for primary and spouse; dependent ages are aggregated, so single-year/five-year person counts cannot be reconstructed. |
| BEA national/regional accounts | 445 | Tax variables omit NIPA imputations, employer accruals, institutional flows, and residence adjustments. |
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
  `taxcalc-public-cps-chronicle-expansion-v2`.
- Same-year calculator switching, state FIPS, and composite expressions:
  `evaluation_harness/adapters/taxcalc_cps.py`.
- Tax-Calculator variable availability and definitions:
  installed `taxcalc/records_variables.json` for version 6.7.1.
