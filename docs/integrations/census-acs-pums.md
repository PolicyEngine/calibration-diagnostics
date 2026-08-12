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

The v2 4,881-row derived sufficient statistic has SHA-256
`552db188a651739fd05968dbbf7a018dd5695b0ccbe82cf6b3ccdf73d3917c33`.
It contains single-age population weights plus `ADJINC`-adjusted `WAGP`
totals for the full weight and all 80 replicate weights.

## Current Chronicle coverage

The pinned Chronicle snapshot has 46,241 US facts. Raw ACS PUMS executes these
reviewed surfaces:

| Chronicle surface | Facts | Capability |
|---|---:|---|
| Published ACS national/state population by age | 954 | Native direct |
| Census Population Estimates national/state population by age | 988 | Native direct |
| 2024 national population projections by single age | 86 | Native direct |
| BEA regional wages on the reviewed residence basis | 52 | Aligned direct |
| BEA 2024 national NIPA wages | 1 | Native direct |

The confirmed adapter surface therefore has 2,081 executable facts. It does not
allocate PUMAs to congressional districts. Such a crosswalk would be a modeled
geographic allocation rather than a direct PUMS aggregate.

The 2023-vintage projection facts are native 2024 comparisons because their
observed target period is 2024; no aging is applied. Regional BEA wages use the
same reviewed residence adjustment and NIPA scaling as the other adapters.
Both regional and national wage comparisons are external validation.

## Execution and uncertainty

Population facts are weighted sums of `PWGTP` after applying their Chronicle GEOID
and `AGEP` bounds. Both the source and the benchmark are native 2024; no aging,
uprating, or Microcosm period transformation is involved. Other years remain
unsupported until a separately reviewed PUMS release is declared.

Preprocessing reduces the person records to a sufficient statistic keyed by
state or country and single year of age. It retains the full weight and all 80
replicate-weight aggregates. This is lossless for every supported age-count
query while keeping repeated evaluation small and deterministic. Wage queries
sum the precomputed `WAGP * ADJINC / 1,000,000 * PWGTP_r` statistic for each
full or replicate weight.

For each estimate `X`, the standard error uses the Census successive difference
replicate formula:

```text
SE = sqrt((4 / 80) * sum((X_r - X) ** 2 for r in 1..80))
MOE90 = 1.645 * SE
```

The existing score continues to compare the point estimate with the Chronicle
benchmark. Standard error and 90 percent margin of error are diagnostics; they
do not convert a discrepancy into a perfect score.

## Interpretation boundary

This comparison measures how closely the public-use ACS subsample reproduces
published full-sample ACS and population-control estimates, and also evaluates
external population projections and BEA wages. The ACS and Population
Estimates mappings are marked `used_in_imputation_or_reweighting`; projection
and wage mappings are marked `external_validation`.

PUMS can still differ from published ACS estimates because it adds a sampling
stage and disclosure processing. Those differences are retained as numerical
results rather than suppressed.

## Confirmed ten-fact gate

| Geography and age | Chronicle target | Fact key |
|---|---:|---|
| United States, 0-4 | 18,365,047 | `chronicle.aggregate_fact.v2:aa16f206fd09f97084b67314` |
| United States, 20-24 | 22,232,555 | `chronicle.aggregate_fact.v2:28c8b35f03f5098ddcbb237a` |
| United States, 40-44 | 22,701,029 | `chronicle.aggregate_fact.v2:06bd1927915c0067b2cfafbf` |
| United States, 65-69 | 19,356,883 | `chronicle.aggregate_fact.v2:566a18fd49c5b43ea91ce205` |
| United States, 85+ | 6,343,153 | `chronicle.aggregate_fact.v2:224acf500d92eae5b6c734be` |
| Alabama, 60-64 | 338,081 | `chronicle.aggregate_fact.v2:00411972c11eca98b255d061` |
| California, 0-4 | 2,083,154 | `chronicle.aggregate_fact.v2:ceb7ba00099219f300397c09` |
| New York, 25-29 | 1,365,498 | `chronicle.aggregate_fact.v2:3fd47cffbfe7f01f9cec2373` |
| Texas, 15-19 | 2,269,275 | `chronicle.aggregate_fact.v2:b895c85916a74d8c3d25ce62` |
| Wyoming, 85+ | 9,802 | `chronicle.aggregate_fact.v2:6602bd548d348950081306bc` |

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

## Full Chronicle run

The full pass classifies all 46,241 US facts and executes all 2,081 supported
cells. Every executed row has an estimate, standard error, and 90% margin of
error in both the immutable run and the frontend fact artifact. Raw ACS has a
1.9075% fact-level capped mean error: 2,056 facts are within 10%, 24 are between
10% and 25%, and one is above 25%.

The combined three-source artifact is run
`evaluation-4369e3a7976eaa38569edb21`: 138,723 capability cells, 55,591
estimates, and a complete 463-partition frontend bundle.

Rebuild and verify with:

```bash
uv run python scripts/build_acs_pums_aggregates.py \
  --us-person-zip /path/to/csv_pus.zip \
  --puerto-rico-person-zip /path/to/csv_ppr.zip \
  --output .artifacts/acs-pums-2024/person-age-wages-v2.parquet

uv run python scripts/verify_acs_pums_adapter.py \
  --aggregates .artifacts/acs-pums-2024/person-age-wages-v2.parquet
```
