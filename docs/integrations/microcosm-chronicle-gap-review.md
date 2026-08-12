# Microcosm–Chronicle gap audit

This audit classifies every U.S. Chronicle fact against the pinned 2024
Microcosm release. A scored mapping is added only when the Chronicle concept
and the Microcosm dataset or PolicyEngine-US output are a direct match with at
least 90% confidence. A similar variable name is not enough: accounting basis,
population, period, and entity must also agree.

## Current evaluation outcome

The immutable artifact is
`chronicle-7917ea815df710fb20db076b-full-audit-v18`, with run ID
`evaluation-ba3388c22230d3eb3bd56838`.

| Result | Fact count |
| --- | ---: |
| U.S. Chronicle facts | 46,241 |
| Microcosm results | 45,633 |
| Scored Microcosm results | 45,625 |
| Unsupported | 608 |
| Intentionally held-out December 2025 CMS facts | 255 |
| **Non-held-out audit remainder** | **353** |

Microcosm coverage is 98.69%. Its fact-level mean capped error is 43.69%.
Coverage and fit remain separate: adding a valid but poorly fit comparison can
increase coverage while increasing mean error.

## Additions from this audit

The audit added 54 directly executable, scored facts.

### TANF average monthly families: 52 facts

Chronicle's national and state average-monthly TANF family caseloads now run as
weighted counts of SPM units with a positive modeled `tanf` value. The mapping
uses `execution_entity: spm_unit`; it does not pretend that Chronicle's `family`
entity is a native Microcosm table.

These are external validation facts, not Microcosm calibration targets. The
pinned build calibrates TANF benefit dollars, while PolicyEngine's positive
`tanf` result supplies the model's family-caseload prediction.

| TANF family result | Value |
| --- | ---: |
| Chronicle national benchmark | 841,208.7 |
| Microcosm national estimate | 894,135.9 |
| National error | 6.29% |
| Mean capped error across national and state facts | 69.76% |

The high state error is real model evidence: several published-release state
estimates are zero or far from the administrative caseload even though the
national total is close.

### Employer contributions for government social insurance: 1 fact

The BEA NIPA employer-contribution total now runs as the person-level sum of:

- `employer_social_security_tax`
- `employer_medicare_tax`
- `employer_federal_unemployment_tax`
- `employer_state_payroll_tax`

This matches the employer-side social-insurance scope without adding local
occupational payroll taxes. Chronicle's benchmark is $866.444 billion;
Microcosm estimates $778.822 billion, for 10.11% error.

### Gross Medicare benefits: 1 fact

BEA records Medicare program benefits gross and records beneficiary premiums
separately as government-social-insurance contributions. PolicyEngine's
`medicare_cost` is explicitly net of Part A and Part B premiums. The harness
therefore reproduces PolicyEngine's gross benefit representation as:

```text
medicare_cost + base_part_a_premium + gross_medicare_part_b_premium
```

Chronicle's benchmark is $1.102358 trillion; Microcosm estimates $667.074
billion, for 39.49% error.

## Complete remaining gap accounting

The 608 unsupported facts contain 255 December 2025 CMS enrollment facts. They
remain deliberately held out because the pinned release is a 2024 society and
does not have a reviewed 2025 population contract. The other 353 facts are:

| Family | Count | Why no scored direct mapping exists |
| --- | ---: | --- |
| Six BEA regional macro series | 312 | The model has micro-level components, but the BEA lines include national-account imputations and coverage adjustments that are not present in Microcosm. |
| Other national BEA facts | 20 | Seventeen are non-equivalent macro aggregates, two require a pension-plan entity and employer pension contributions, and one is a 2018 wage fact with no reviewed 2018-to-2024 build transformation. |
| TANF recipient and family-type breakouts | 6 | Microcosm can count positive-benefit SPM units, but it cannot identify administrative recipients or no-/one-/two-parent cases exactly. |
| ICI mutual-fund capital-gain distributions | 12 | Microcosm has taxpayer capital gains, not the institutional-sector paid-versus-reinvested mutual-fund distribution split. |
| CBO federal individual-income-tax receipts | 1 | Fiscal-year cash receipts are not the same quantity as tax-year household income-tax liability. |
| Tennessee state income-tax collections | 1 | The Hall tax was repealed; the residual fiscal collection has no corresponding current-law liability in PolicyEngine-US. |
| Private-employer ESI premium contribution | 1 | The pinned release lacks the employer-sector split and its employer-premium producer is structurally zero. |
| **Non-held-out remainder** | **353** | |

### The 312 BEA regional macro facts

Each of these six measures has one national row and 51 state rows:

| Chronicle measure | Count | Blocking mismatch |
| --- | ---: | --- |
| Contributions for government social insurance | 52 | Includes employer, employee, self-employed, Medicare-premium, railroad-retirement, veterans-insurance, and temporary-disability flows. A payroll-tax-only proxy is incomplete. |
| Dividends, interest, and rent | 52 | Includes imputed interest, trust and pension flows, and imputed owner-occupied rent absent from the corresponding tax/CPS variables. |
| Personal current transfer receipts | 52 | Includes cash and in-kind national-account benefits; `household_benefits` is not the same program or accounting universe. |
| Personal income | 52 | Inherits all component differences and subtracts the broader social-insurance contribution concept. |
| Residence adjustment | 52 | A BEA place-of-work-to-residence balancing item, not a person-level income variable. |
| Supplements to wages and salaries | 52 | Includes pension, insurance, and social-insurance employer contributions; the published release lacks a complete employer pension/insurance producer. |

### The 20 other BEA facts

The two defined-contribution rows need employer pension contributions and a
pension-plan entity that Microcosm does not represent. The 2018 wage row cannot
be evaluated against a 2024 society without a reviewed transformation.

The remaining 17 are disposable personal income; employer pension and
insurance contributions; farm and nonfarm proprietors' income separately;
government benefits and other transfers; personal taxes; personal transfer
receipts; dividend, interest, rental, and total personal income; personal
outlays; personal saving and its rate; and total supplements. These are BEA
national-account aggregates. PolicyEngine can produce tempting partial proxies,
but those proxies omit imputed flows, institutions serving households,
consumption, employer pension accruals, or other required components.

Farm and nonfarm proprietors' income could be summed, but that would only
duplicate the already scored total proprietors' income target; it would not add
an independent validation observation.

### The six TANF composition facts

The three recipient facts are total, adult, and child recipients. PolicyEngine's
`tanf_person` divides the SPM-unit benefit across every SPM-unit member. Federal
TANF reporting distinguishes people receiving assistance from other people
whose income or relationship makes them part of the reported TANF family.
Therefore nonzero `tanf_person` is not an exact recipient indicator.

The no-parent, one-parent, and two-parent facts require administrative parent
and recipient roles. `spm_unit_count_adults` is not equivalent: a child-only
case may contain an adult caretaker who is not a recipient.

## Closest possible proxies, in descending confidence

These remain deliberately unscored:

1. CBO individual-income-tax receipts could be compared with aggregate
   `income_tax`, but only as a labeled fiscal-cash-versus-tax-liability proxy.
2. TANF total/adult/child recipients could use nonzero `tanf_person`, but it
   would count all SPM-unit members rather than administrative recipients.
3. BEA regional social-insurance contributions could use payroll-tax
   components, but would omit several BEA contribution programs and premiums.
4. BEA transfer receipts and personal income could use constructed benefit and
   income totals, but the national-account universe materially differs.
5. The private-employer ESI fact cannot be isolated until Microcosm has both a
   nonzero employer-premium producer and private/public employer lineage.

## Evidence

- Pinned Microcosm release (legacy artifact identifier):
  `populace-us-2024-buildp-sparse-rmloss100-cae8640-20260728T011454Z`.
- Pinned PolicyEngine-US version: `1.764.6`.
- Reviewed Microcosm target inclusions and exclusions (legacy internal source path):
  `packages/populace-build/src/populace/build/us/target_parity_manifest.json`
  at commit `cae8640f9e65e274aea65c7916cb37b956978e32`.
- TANF model result: PolicyEngine-US `tanf` on SPM units; the federal TANF
  reporting family definition is documented in ACF's `InstructionsFed.pdf`.
- BEA personal-income composition and residence basis:
  <https://www.bea.gov/help/glossary/local-area-personal-income>.
- BEA Medicare benefit and contribution accounting:
  <https://www.bea.gov/help/faq/170>.
- Harness mappings (legacy source-ID path):
  `integrations/populace_policyengine_us/mappings.yaml` release v10.
- Adapter expressions (legacy Python module path):
  `evaluation_harness/adapters/populace.py`.
