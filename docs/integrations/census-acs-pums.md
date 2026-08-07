# Raw ACS PUMS integration overview

Status: **integration surface confirmed; adapter implementation pending**

This source is the Census Bureau's 2024 ACS 1-year Public Use Microdata
Sample person file. It is a standalone dataset, not a model/dataset pair. The
harness therefore declares `aggregate_dataset`, a null model version, and only
direct execution.

The pinned release is `census-acs-pums-2024-1y-person@2025-09-17`. Execution
uses the national `csv_pus.zip` file plus `csv_ppr.zip` for Puerto Rico. The
input SHA-256 hashes and the hash of the derived aggregate file are recorded by
the preprocessor rather than treating a mutable download URL as a version.

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
