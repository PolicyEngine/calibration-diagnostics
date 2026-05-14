# Data build pathway

## Purpose

The `data_build` pathway constructs the **enhanced CPS microdata file** that everything downstream of calibration consumes. It starts from raw Census CPS ASEC plus IRS PUF tax records, layers in donor imputations from ACS/SIPP/SCF/ORG, doubles records to splice plausible high-AGI tax filers into the survey, assigns synthetic geography, and stratifies the result down to a calibration-sized sample. It is intentionally a *separate* pathway from `calibration_package` (which packages and ships the artifacts the api/app consume) and from `local_h5` (which is the developer escape hatch for editing an h5 in place without re-running the build). Re-running `data_build` is expensive (QRF training, microsimulation passes, h5 IO); calibration runs typically reuse a cached `extended_cps_2024.h5` or `stratified_extended_cps_2024.h5`.

## Inputs and outputs

**Upstream sources**
- **CPS ASEC** raw person/household frames (e.g. RESNSS1/RESNSS2 SS-source codes, SS_VAL, SEMP_VAL, H_TENURE, A_AGE) — primary survey backbone.
- **IRS PUF** tax records — donor for high-AGI tax variables (`PUF_REPORTED_CALCULATED_TAX_OUTPUT_VARIABLES`).
- **ACS** (`ACS_2022`) — donor for rent and real-estate taxes with state-FIPS predictor.
- **SIPP** — donor for tip income, bank/stock/bond assets, vehicles.
- **SCF** (`SCF_2022`) — donor for net worth, auto loans, mortgage balance hints.
- **CPS-ORG** — donor for hourly wage, paid-hourly flag, union coverage.
- **Census block × CD distributions** (`block_cd_distributions.csv.gz`) — population-weighted lookup for geography assignment.

**Outputs**
- `extended_cps_2024.h5` — full doubled (CPS half + PUF-cloned half), QRF-imputed dataset with geography assigned.
- `stratified_extended_cps_2024.h5` — calibration-sized (~30k household) stratified sample preserving the high-AGI tail.
- `source_imputed_stratified_extended_cps_2024.h5` — stratified file with ACS/SIPP/ORG/SCF imputations re-run (this is what calibration loss matrices are built against).

## Key sub-stages (ordered)

1. **Raw CPS construction** (`datasets/cps/cps.py`) — `add_id_variables`, `add_personal_variables`, `add_personal_income_variables`, `add_household_variables`, `add_spm_variables`, `add_ssn_card_type`, `add_previous_year_income`. Builds person/tax-unit/SPM-unit ID skeleton and populates ASEC-derived demographics, SS sub-component classification (RESNSS codes), income, prior-year income link, and immigration status. `downsample` optionally subsamples for released vintages.

2. **PUF preprocessing + clone preparation** (`datasets/puf/puf.py`) — `preprocess_puf` renames IRS variables, `impute_puf_demographics` fills missing PUF demographics from donor records, `impute_puf_pension` (CPS donor) and `simulate_qbi` (Section 199A W-2 wage and UBIA synthesis from QBI components) populate the variables PUF doesn't carry natively.

3. **Doubled-record build / "extended CPS"** (`calibration/puf_impute.py`, `datasets/cps/extended_cps.py`) — `record_double`/`puf_clone_dataset` concatenates each CPS household with a clone whose tax variables come from PUF via QRF (`puf_qrf_pass`). Clone half gets `household_weight=0` so it only contributes once calibration picks it up. `weeks_impute` and `retire_impute` fill clone-half labor/retirement holes; `ss_reconcile` scales Social Security sub-components so they sum to the imputed total. A second QRF pass (`cps_only` → `qrf_pass2` → `clone_features`) replaces naive donor copies of CPS-only variables on the clone half with predictions consistent with the clone's imputed PUF income. `formula_drop` strips variables policyengine-us will compute via formula so they don't poison reforms.

4. **Mortgage structural conversion** (`utils/mortgage_interest.py`) — `mortgage_hints` imputes SCF-backed first/second-home balance hints, then `mortgage_convert` rewrites formula-level `deductible_mortgage_interest` and `interest_deduction` into structural mortgage balances + origination years + person-level home/investment interest. Required so reforms to the MID don't no-op against pre-imputed deductibles.

5. **ACA take-up override** (`datasets/cps/enhanced_cps.py`) — `aca_2025_override` adds synthetic 2025 marketplace take-up draws until calibrated person-level APTC enrollment hits national (or per-state) targets.

6. **Stratification, source re-imputation, geography assignment** (`calibration/create_stratified_cps.py`, `calibration/source_impute.py`, `calibration/clone_and_assign.py`) — `create_stratified` subsamples to ~30k households with per-bracket caps on the high-AGI tail (`HIGH_AGI_BRACKETS`, capping the >$10M PUF pile-up at 300 and the $1M-$2M middle-high band at 400) plus optional bottom-quartile oversample. `source_impute` re-runs ACS/SIPP/SCF/ORG QRFs on the stratified subset (ACS+ORG use state_fips as a predictor; SIPP+SCF don't). `geo_assign` draws population-weighted census blocks for every clone from `block_cd_distributions.csv.gz`, optionally reweighting blocks within a CD by AGI target shares; state/CD/county/tract GEOIDs are derived from the block GEOID.

## Common failure modes

- **`extended_cps_2024.h5` missing or stale**: `create_stratified_cps_dataset` and `source_impute` both default to `STORAGE_FOLDER/extended_cps_2024.h5`. If a partial build wrote a corrupt file, `add_rent`'s stale-key warning (`cps.py:362-379`) is usually the first symptom; delete the h5 and rerun. Stage assignment for the calibration matrix will silently use stale variable values otherwise.
- **`block_cd_distributions.csv.gz` not present**: `load_global_block_distribution` (`clone_and_assign.py:48`) raises `FileNotFoundError` with a pointer to `make_block_cd_distributions.py`. The lru_cache means the first failure poisons subsequent calls in the same process.
- **QRF predictor missing in CPS at imputation time**: any of the `_impute_*` helpers in `puf_impute.py` and `source_impute.py` instantiate a fresh `Microsimulation(dataset=dataset_path)` to compute predictors. If the CPS h5 lacks a predictor variable (renamed upstream in policyengine-us or dropped by `formula_drop`), calculate raises and the surrounding `try/except` (e.g. `_impute_weeks_unemployed` at `puf_impute.py:662-667`) may silently return zeros. Check logs for "weeks_unemployed not in CPS" / "returning zeros".
- **SS sub-components don't reconcile**: `reconcile_ss_subcomponents` (`puf_impute.py:384`) only fixes the PUF half (indices `n_cps:`). If a CPS-half sub-component classification (`cps.py:1190+`) misroutes due to ASEC code changes, totals on the CPS half can drift from `social_security` and the calibration target on retirement vs. disability rolls will be off.
- **AGI-tail bracket starvation in stratified output**: if PUF templates with `household_weight=0` are missing or mislabeled, `create_stratified_cps_dataset` (`create_stratified_cps.py:156-180`) will draw fewer than `cap` records and the high-AGI calibration targets become noisy. The function prints per-bracket counts — check them whenever calibration tail metrics regress.
- **Geography QA**: at-large CD normalization (CD 00 / DC 98 → 01) happens in `load_global_block_distribution`. If a new release changes Census's at-large encoding, district-level targets will misalign without an obvious error.

## Why this exists / design notes

The pathway exists to solve four entangled problems no single source can handle:
1. **CPS top-codes income** around $1M, but tax policy lives in the upper tail. Cloning each CPS household and imputing PUF tax variables onto the clone (with `household_weight=0`) lets the calibration optimizer assign positive weight to high-AGI synthetic households without distorting low-income statistics.
2. **PUF lacks demographics and transfers**; CPS lacks tax detail. A two-pass QRF (PUF → clone, then CPS-only → clone) propagates each donor's strengths while keeping within-clone consistency between income and CPS-only variables (`extended_cps.py:439+`).
3. **Several variables policyengine-us computes via formula** (e.g. mortgage interest deductions, ACA take-up) need structural inputs, not pre-imputed outputs, or reforms become no-ops. The mortgage conversion and ACA override stages exist purely to invert formula-level imputations into structural inputs.
4. **Calibration runs on a stratified subset for tractability**, but naive subsampling would lose the high-AGI tail that drives most revenue-cost reforms. `HIGH_AGI_BRACKETS` per-bracket caps keep the tail bounded while preferring weighted CPS records over `household_weight=0` PUF templates within each cap.

A subtle point for reviewers: the clone-half `household_weight=0` is load-bearing. Every transformation in this stage assumes the first `n_cps` indices are the original CPS records and indices `n_cps:` are the PUF clones. Search for `n_cps:` or `n_half:` in `puf_impute.py` and `extended_cps.py` — most splicing logic is hard-coded around that contract.

## Source map

| Node id | Source file | Role |
|---|---|---|
| add_id_variables | `datasets/cps/cps.py:918` | Build person/household/tax-unit/SPM/family/marital ID skeleton |
| add_personal_variables | `datasets/cps/cps.py:982` | Populate demographics and occupation-derived inputs |
| add_personal_income_variables | `datasets/cps/cps.py:1126` | Populate income, transfers, retirement, QBI inputs; classify SS by RESNSS codes |
| add_spm_variables | `datasets/cps/cps.py:1402` | Populate SPM-unit poverty variables |
| add_household_variables | `datasets/cps/cps.py:1441` | Populate household geography (state, county, NYC flag) |
| add_previous_year_income | `datasets/cps/cps.py:1483` | Link adjacent CPS years for prior-year income |
| add_ssn_card_type | `datasets/cps/cps.py:1589` | Classify SSN card type / immigration status from ASEC |
| add_rent | `datasets/cps/cps.py:339` | Legacy ACS-donor rent and real-estate-tax imputation |
| add_takeup | `datasets/cps/cps.py:463` | Stochastic benefit takeup with reported-anchor alignment |
| add_tips | `datasets/cps/cps.py:2488` | Legacy SIPP-donor tip and asset imputation |
| add_org_inputs | `datasets/cps/cps.py:2663` | ORG-donor hourly wage, hourly-pay flag, union coverage |
| add_auto_loan | `datasets/cps/cps.py:2779` | Legacy SCF-donor auto loan and net worth imputation |
| downsample | `datasets/cps/cps.py:306` | Subsample CPS arrays for released vintages |
| preprocess_puf | `datasets/puf/puf.py:620` | Rename IRS variables, derive PE-ready PUF inputs |
| impute_puf_demographics | `datasets/puf/puf.py:461` | Fill missing PUF demographics from donor records |
| impute_puf_pension | `datasets/puf/puf.py:405` | Impute pre-tax retirement contributions onto PUF |
| simulate_qbi | `datasets/puf/puf.py:301` | Synthesize Section 199A W-2 wages and UBIA |
| record_double | `calibration/puf_impute.py:436` | Double CPS records; clone-half gets PUF tax imputations |
| puf_qrf_pass | `calibration/puf_impute.py:875` | QRF imputation from PUF tax variables onto clones |
| weeks_impute | `calibration/puf_impute.py:622` | Impute weeks unemployed for clone half |
| retire_impute | `calibration/puf_impute.py:730` | Impute retirement contribution inputs for clone half |
| ss_reconcile | `calibration/puf_impute.py:369` | Scale SS sub-components to reconcile to total SS (PUF half) |
| cps_only | `datasets/cps/extended_cps.py:422` | Second-stage CPS-only QRF for PUF clone records |
| qrf_pass2 | `datasets/cps/extended_cps.py:700` | Splice CPS-only QRF predictions into clone half |
| clone_features | `datasets/cps/extended_cps.py:382` | Replace clone-half feature variables with donor-matched predictions |
| formula_drop | `datasets/cps/extended_cps.py:1179` | Drop variables that policyengine-us computes via formula |
| mortgage_hints | `utils/mortgage_interest.py:45` | SCF-backed tax-unit mortgage balance hint imputation |
| mortgage_convert | `utils/mortgage_interest.py:126` | Convert deductible MID into structural mortgage inputs |
| aca_2025_override | `datasets/cps/enhanced_cps.py:404` | Synthetic 2025 ACA take-up to match APTC targets |
| reweight | `datasets/cps/enhanced_cps.py:487` | Fit enhanced CPS weights against calibration targets (hard-concrete loss) |
| create_stratified | `calibration/create_stratified_cps.py:68` | Stratified sample with high-AGI tail caps |
| source_impute | `calibration/source_impute.py:170` | Re-impute ACS/SIPP/ORG/SCF on stratified file |
| acs_qrf | `calibration/source_impute.py:319` | ACS QRF: rent + real-estate taxes (state predictor) |
| sipp_qrf | `calibration/source_impute.py:420` | SIPP QRF: tips, liquid assets, vehicles |
| scf_qrf | `calibration/source_impute.py:804` | SCF QRF: net worth, auto loans, balance-sheet components |
| geo_assign | `calibration/clone_and_assign.py:147` | Assign population-weighted blocks → CD/county/state to clones |
