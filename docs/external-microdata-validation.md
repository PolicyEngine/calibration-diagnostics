# External microdata validation — PSL (TMD / Tax-Calculator) and Yale Budget Lab

Scope for adding external tax microdata as comparison datasets on the calibration
dashboard (Slack ask from Max, 2026-07-06; recon verified against the PSL and
Budget-Lab-Yale GitHub orgs the same day).

## Comparison model: datasets scored against shared ground truth, not each other

Each dataset is scored against the **same external benchmark surface** the
dashboard already maintains — official actuals stay the referee, and datasets
compare *by their errors*:

```
benchmark row (official actual)   populace   eCPS   taxcalc-CPS   TMD    Yale
SOI income tax net (TY2023) ....  -1.4%      …      …             …      (pending)
SOI wages & salaries ..........   …          …      …             …
IRS EITC — NY (TY2024) ........   -17.5%     …      …             …
```

This generalizes the populace-vs-eCPS evidence pattern from issue #88
(populace within ±20% on 24/29 state EITCs vs 14/29 for per-state eCPS) into a
standing view.

## Metrics (phase 1)

1. **Aggregate levels vs official actuals** — per-row % error, and per-dataset
   summary: median |error|, within-10% share, worst row.
   - IRS SOI Pub 1304 TY2023 lines (income tax net, AMT, NIIT, SE tax, credit
     lines) — already benchmarked for populace.
   - Federal EITC by state vs IRS TY2024 — already benchmarked (18 rows).
   - SOI income concepts (wages, interest, dividends, Sch C, capital gains,
     pensions, Social Security) — input-side, computable from any file.
2. **Distribution by AGI bracket** — totals per SOI Pub 1304 AGI band for the
   concepts above (the same 16-bracket grid Yale's own target spec uses).
3. **Coverage** — how many benchmark rows each dataset can express at all.
   TMD/taxcalc are federal-only (no state income tax, no benefit programs);
   Yale is federal tax units; populace covers the full surface. Coverage is a
   first-class metric, not a footnote.

Phase 2 (later): reform deltas (OBBBA lines via Tax-Calculator's reform JSONs /
Yale's public scenario YAMLs) — engine-dependent, bigger lift.

## UI: separate tab

New view under **Dataset accuracy → Cross-dataset comparison** (per Pavel):
benchmark-row × dataset matrix with error cells (fit-scale colors), a
per-dataset summary header, and a coverage strip. No changes to existing views.

## Dataset feasibility (recon results, 2026-07-06)

| dataset | availability | vintage | compute | asks |
|---|---|---|---|---|
| **Tax-Calculator public CPS** | fully public — ships in `pip install taxcalc` (`cps.csv.gz`, 280,005 records, weights WT2014–WT2036) | 2014 base, advanced to 2024 | verified: 2024 `calc_all()` ≈ 11 s / 1.8 GB; iitax 2024 = $1,867.8B | none |
| **PSL TMD 2.1.3** | no public artifacts (zero releases; PUF-gated by design) — but **buildable in-house**: `puf_2015.csv` is already in policyengine-us-data storage; needs `demographics_2015.csv` + SIPP24/CEX23 inputs + `make data` | 2022 base (2015 PUF × 2022 CPS), growfactors to base+53 | taxcalc `tmd_constructor` + `TMD_CREDIT_CLAIMING` reform | none external; internal build effort. **Publish aggregates only, never microdata** |
| **Yale Tax-Data** | microdata **not shareable** (PUF-derived; their docs say so explicitly). Tax-law params + all reform scenarios + runscripts + variable guide + target spec **are public** | 2015 PUF base, files per year 2017–2097 (2024 exists) on Yale HPC only | their R pipeline; not reproducible without PUF + their internal Compiled-SOI-Tables | **ask Ricco for an aggregated export** — totals by variable × AGI bracket × filing status for 2024 (shareable; grid = their public `target_info/baseline.csv`, 165 rows, 16 AGI brackets) |

Correction to the Slack thread: Yale's **tax parameter files are public**
(`Tax-Simulator/config/scenarios/tax_law/` — 26 baseline YAMLs + every
published reform). The blocker is the microdata, and the right ask is the
aggregated export above, which is also exactly the shape the dashboard needs.

## Pipeline (git-native, same pattern as reform-overrides)

1. `frontend/scripts/score_external_dataset.py --dataset taxcalc-cps --year 2024`
   → loads the file, applies a variable-concept mapping
   (`e00200→wages`, `iitax→income_tax_net`, …), computes weighted totals
   (national + AGI-bracket + EITC-by-state where fips exists), and emits
   `frontend/lib/populace/external-datasets/<dataset>.json` keyed by the same
   benchmark ids the suites use.
2. Frontend joins external JSONs to benchmark rows by id; unmatched rows show
   as no-coverage.
3. Yale's aggregated export (when it arrives) drops into the same JSON shape.

Concept caveats to encode in the mapping, not hide: tax-unit vs household
weighting; filer vs all-units scope; taxcalc CPS's own docs warn its data
accuracy is not unit-tested (PUF/TMD "more accurate"); TMD's iitax needs the
credit-claiming reform applied.

## Sequencing

1. **PR 1 (this scope)** — doc + mapping table + `score_external_dataset.py`
   with the taxcalc-CPS path + committed JSON + the comparison tab reading it.
   Zero external dependencies.
2. **PR 2** — TMD build (in-house PUF) + its JSON. Aggregates-only publishing
   gate in the script.
3. **PR 3** — Yale ingestion once Ricco sends the aggregated export;
   optionally their published estimates as benchmark rows in the meantime.
