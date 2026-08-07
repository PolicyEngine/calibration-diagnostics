# Raw ACS PUMS integration overview

Status: **adapter implemented and verified against the official 2024 files**

This source is the Census Bureau's 2024 ACS 1-year Public Use Microdata
Sample person file. It is a standalone dataset, not a model/dataset pair. The
harness therefore declares `aggregate_dataset`, a null model version, and only
direct execution.

The pinned release is `census-acs-pums-2024-1y-person@2025-09-17`. Execution
uses the national `csv_pus.zip` file plus `csv_ppr.zip` for Puerto Rico. The
input SHA-256 hashes and the hash of the derived aggregate file are recorded by
the preprocessor rather than treating a mutable download URL as a version.

The executed inputs contain 3,422,888 U.S. and 25,905 Puerto Rico person
records. Their pinned SHA-256 values are:

- `csv_pus.zip`: `afdc6d90c6e2f0bab365ed32d95ba4c4d8ac651162f46ac7861295b2dc469894`
- `csv_ppr.zip`: `c9cff0bf3f488f379570c8ff70ed86ac55cbdbb107428da9a445dce103694e35`

The 4,881-row derived sufficient statistic has SHA-256
`2c3ef941f83b25dc9ffe01c26272f89073483fb8b6e4a23c5e990394c372326f`.

## Current Ledger coverage

The pinned Ledger snapshot has 10,131 Census ACS facts:

| Ledger surface | Facts | Capability |
|---|---:|---|
| National population by age band | 18 | Direct |
| State population by age band | 936 | Direct |
| Congressional-district population | 7,866 | Unsupported geography |
| Congressional-district households | 1,311 | Unsupported geography |

The confirmed adapter surface therefore has 954 executable facts. It does not
allocate PUMAs to congressional districts. Such a crosswalk would be a modeled
geographic allocation rather than a direct PUMS aggregate.

Ledger currently has no ACS state or national household, employment, wage,
self-employment, sex, or tenure facts. The adapter will not manufacture ten
apparently diverse checks by comparing non-equivalent concepts from other
sources. Its ten-fact gate instead exercises five national and five state
population estimates across the age distribution.

## Execution and uncertainty

Each fact is a weighted sum of `PWGTP` after applying its exact Ledger GEOID
and `AGEP` bounds. Both the source and the benchmark are native 2024; no aging,
uprating, or Populace period transformation is involved. Other years remain
unsupported until a separately reviewed PUMS release is declared.

Preprocessing reduces the person records to a sufficient statistic keyed by
state or country and single year of age. It retains the full weight and all 80
replicate-weight aggregates. This is lossless for every supported age-count
query while keeping repeated evaluation small and deterministic.

For each estimate `X`, the standard error uses the Census successive difference
replicate formula:

```text
SE = sqrt((4 / 80) * sum((X_r - X) ** 2 for r in 1..80))
MOE90 = 1.645 * SE
```

The existing score continues to compare the point estimate with the Ledger
benchmark. Standard error and 90 percent margin of error are diagnostics; they
do not convert a discrepancy into a perfect score.

## Interpretation boundary

This comparison measures how closely the public-use ACS subsample reproduces
published full-sample ACS S0101 estimates. It is not independent external
validation. Census derives PUMS from ACS and adjusts person weights toward ACS
demographic estimates. The mapping is therefore marked
`used_in_imputation_or_reweighting`, and that exposure remains visible in the
fact artifact and UI.

PUMS can still differ from published ACS estimates because it adds a sampling
stage and disclosure processing. Those differences are retained as numerical
results rather than suppressed.

## Confirmed ten-fact gate

| Geography and age | Ledger target | Fact key |
|---|---:|---|
| United States, 0-4 | 18,365,047 | `ledger.aggregate_fact.v2:aa16f206fd09f97084b67314` |
| United States, 20-24 | 22,232,555 | `ledger.aggregate_fact.v2:28c8b35f03f5098ddcbb237a` |
| United States, 40-44 | 22,701,029 | `ledger.aggregate_fact.v2:06bd1927915c0067b2cfafbf` |
| United States, 65-69 | 19,356,883 | `ledger.aggregate_fact.v2:566a18fd49c5b43ea91ce205` |
| United States, 85+ | 6,343,153 | `ledger.aggregate_fact.v2:224acf500d92eae5b6c734be` |
| Alabama, 60-64 | 338,081 | `ledger.aggregate_fact.v2:00411972c11eca98b255d061` |
| California, 0-4 | 2,083,154 | `ledger.aggregate_fact.v2:ceb7ba00099219f300397c09` |
| New York, 25-29 | 1,365,498 | `ledger.aggregate_fact.v2:3fd47cffbfe7f01f9cec2373` |
| Texas, 15-19 | 2,269,275 | `ledger.aggregate_fact.v2:b895c85916a74d8c3d25ce62` |
| Wyoming, 85+ | 9,802 | `ledger.aggregate_fact.v2:6602bd548d348950081306bc` |

Completion requires ten finite direct estimates, ten scored results, and
replicate-weight diagnostics for every row. Unsupported or `N/A` rows cannot
pass the checkpoint.

The actual gate passed all ten:

| Geography and age | PUMS estimate | Relative error | 90% PUMS MOE |
|---|---:|---:|---:|
| United States, 0-4 | 18,305,390 | 0.325% | 31,755 |
| United States, 20-24 | 22,277,920 | 0.204% | 53,910 |
| United States, 40-44 | 22,757,678 | 0.250% | 96,084 |
| United States, 65-69 | 19,354,445 | 0.013% | 63,948 |
| United States, 85+ | 6,333,041 | 0.159% | 44,760 |
| Alabama, 60-64 | 338,634 | 0.164% | 8,700 |
| California, 0-4 | 2,075,077 | 0.388% | 5,708 |
| New York, 25-29 | 1,360,632 | 0.356% | 7,860 |
| Texas, 15-19 | 2,267,401 | 0.083% | 13,298 |
| Wyoming, 85+ | 11,025 | 12.477% | 1,932 |

`integrations/census_acs_pums/verification_results.json` retains the exact
unrounded diagnostics and input manifest.

## Full Ledger run

The full pass classified all 48,313 facts for raw ACS PUMS and executed all 954
supported cells. Every executed row has an estimate, standard error, and 90%
margin of error in both the immutable run and the frontend fact artifact. The
source scored 99.427 on the current display scale. That high result must be
read with the related-weighting caveat above, not as independent validation.

The combined three-source artifact is run
`evaluation-94fc97cc315f20a50de892a3`: 144,939 capability cells, 10,403
estimates, and a complete frontend bundle.

Rebuild and verify with:

```bash
uv run python scripts/build_acs_pums_aggregates.py \
  --us-person-zip /path/to/csv_pus.zip \
  --puerto-rico-person-zip /path/to/csv_ppr.zip \
  --output .artifacts/acs-pums-2024/person-age.parquet

uv run python scripts/verify_acs_pums_adapter.py \
  --aggregates .artifacts/acs-pums-2024/person-age.parquet
```
