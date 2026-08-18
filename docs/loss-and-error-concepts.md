# Loss and error concepts in the calibration diagnostics app

This document inventories the analytically meaningful loss and error calculations currently present in the application. Two concepts are treated as distinct whenever their transformation, cap, weighting, aggregation, benchmark handling, eligibility rules, or denominator differs.

Programming errors such as failed API requests are outside scope. Sampling **standard error** is included separately because the application displays it, although it measures statistical uncertainty rather than model fit.

## Executive summary

The application does not have one universal definition of either “error” or “loss.” Its main calculation families are:

- Per-target calibration errors, expressed either as a percentage of the target or in the target's original units.
- Unweighted descriptive summaries such as mean error, median error, and the share within 10%.
- Microcosm's normalized target loss, which is the objective used during calibration and includes custom target-importance weights.
- An older raw optimizer objective supported for historical releases.
- Two Fit Map loss transformations: capped squared loss and Huber loss/error intensity.
- Cross-dataset loss, which is an equal-fact mean with a 100% cap.
- Reform-validation error, which has its own benchmark and zero-benchmark rules.
- Sampling standard error and margin of error, which describe uncertainty and do not enter any fit score.

The most important naming conflict is the Fit Map's **Loss sources** mode. It does not decompose Microcosm Final loss. It uses an unweighted, squared, 200%-capped calculation of its own.

## 1. Per-target calibration errors

### 1.1 Signed relative error

For a nonzero target, signed relative error compares the estimate's over- or under-shoot with the magnitude of the target:

- Positive means the estimate is above the target.
- Negative means the estimate is below the target.
- Zero means an exact match.

Zero targets receive special treatment. If the estimate is within 0.0001 of zero, the error is 0%. Any substantively nonzero estimate becomes positive or negative 100%, depending on its direction.

For a nonzero final target, the application normally trusts the `relative_error` published by Microcosm. Initial error and structural-zero cases are calculated locally.

Used in:

- Target tables and target detail
- Release comparison
- Staging candidate comparison
- Over/under/exact direction labels

Source: [`frontend/lib/microcosm/latest-artifact.ts`](../frontend/lib/microcosm/latest-artifact.ts#L152) and its target-row enrichment beginning at [line 885](../frontend/lib/microcosm/latest-artifact.ts#L885).

### 1.2 Absolute relative error

Absolute relative error removes direction from signed relative error. A 10% overestimate and a 10% underestimate both become 10% errors.

Used in:

- Target sorting and filtering
- Fit Map colors
- Fit bands
- Mean and median summaries
- “Within 10%” classifications
- Error-change comparisons

Source: [`frontend/lib/microcosm/latest-artifact.ts`](../frontend/lib/microcosm/latest-artifact.ts#L920).

### 1.3 Signed absolute miss

Signed absolute miss is the estimate minus the target, expressed in the original target unit. It might be dollars, people, returns, or another unit.

- Positive means the estimate is high.
- Negative means the estimate is low.

Used in target investigation data and as a comparison fallback when a relative error is unavailable.

Source: [`frontend/lib/microcosm/latest-artifact.ts`](../frontend/lib/microcosm/latest-artifact.ts#L912).

### 1.4 Absolute miss

Absolute miss is the magnitude of the signed absolute miss. It discards direction but retains the original unit.

Used in largest-absolute-miss diagnostics and absolute-improvement calculations.

Source: [`frontend/lib/microcosm/latest-artifact.ts`](../frontend/lib/microcosm/latest-artifact.ts#L914).

### 1.5 Relative-error improvement

Within one calibration run, relative-error improvement is the initial absolute relative error minus the final absolute relative error.

- Positive means calibration improved the fit.
- Negative means calibration made the fit worse.

Used in target detail and improvement highlights.

Source: [`frontend/lib/microcosm/latest-artifact.ts`](../frontend/lib/microcosm/latest-artifact.ts#L923).

### 1.6 Absolute-miss improvement

Absolute-miss improvement is the initial absolute miss minus the final absolute miss, expressed in the target's original unit.

Used in target investigation and highlight API data.

Source: [`frontend/lib/microcosm/latest-artifact.ts`](../frontend/lib/microcosm/latest-artifact.ts#L916).

### 1.7 Cross-release absolute-relative-error change

When comparing release A with release B, the application subtracts A's absolute relative error from B's absolute relative error.

- Negative means B improved.
- Positive means B regressed.

This has the opposite sign convention from the within-release `improvement` field, where positive means improvement.

Used on the Compare page and in Staging candidate comparisons.

Source: [`frontend/lib/microcosm/latest-artifact.ts`](../frontend/lib/microcosm/latest-artifact.ts#L2474).

## 2. Descriptive summaries of calibration error

These summaries do not use Microcosm's custom target-importance weights. Unless noted otherwise, each included target row counts equally.

### 2.1 Mean absolute relative error

The basic version is the ordinary average of the uncapped absolute relative errors among rows with finite errors.

Used in:

- Targets-page variable summaries
- Target-family summaries
- Calibration Fit Map metrics
- Healthcare target summary
- Reform validation
- Staging candidate comparison

Sources: [`frontend/lib/microcosm/latest-artifact.ts`](../frontend/lib/microcosm/latest-artifact.ts#L1231) and [`frontend/lib/microcosm/calibration-tree.ts`](../frontend/lib/microcosm/calibration-tree.ts#L135).

The app has several variants because the selected population differs:

#### Targets and Fit Map

These average all rows with finite absolute relative error. There is no error cap.

#### Healthcare summary

This averages variable-level means, weighting each variable by its total target count. This can differ from a direct row-level mean if a variable contains targets without a scorable error.

Source: [`frontend/components/microcosm/microcosm-targets-view.tsx`](../frontend/components/microcosm/microcosm-targets-view.tsx#L292).

#### Staging common-target mean

This includes only targets present in both compared releases. It also removes a target when either release has an absolute relative error greater than 1,000%.

Source: [`frontend/components/microcosm/microcosm-staging-view.tsx`](../frontend/components/microcosm/microcosm-staging-view.tsx#L250).

#### Reform-validation mean

This excludes reforms whose JCT benchmark is zero. It can also be restricted to out-of-sample reforms. The errors are uncapped.

Source: [`frontend/lib/microcosm/reforms.ts`](../frontend/lib/microcosm/reforms.ts#L184).

### 2.2 Median absolute relative error

The ordinary version sorts the uncapped absolute relative errors and returns the middle value, or the average of the two middle values when the count is even.

Used for:

- Fit Map color
- Map and cluster “Median error”
- Reform-validation summaries
- Staging common-target comparison

The Staging version uses the same common-target and 1,000%-outlier exclusion described above.

Sources: [`frontend/lib/microcosm/calibration-tree.ts`](../frontend/lib/microcosm/calibration-tree.ts#L120), [`frontend/lib/microcosm/reforms.ts`](../frontend/lib/microcosm/reforms.ts#L177), and [`frontend/components/microcosm/microcosm-staging-view.tsx`](../frontend/components/microcosm/microcosm-staging-view.tsx#L260).

### 2.3 Condensed-map “median”

When the Fit Map condenses several already-aggregated nodes, it calculates a target-count-weighted average of the child medians.

This is not mathematically the median of all underlying targets and can differ from it.

Source: [`frontend/lib/microcosm/calibration-treemap-layout.ts`](../frontend/lib/microcosm/calibration-treemap-layout.ts#L52).

## 3. “Within 10%” concepts

The row-level test is consistently whether absolute relative error is no greater than 10%. The reported rates can still differ because their eligible populations and denominators differ.

| Surface | Population and denominator |
|---|---|
| Overview | Displays Microcosm's upstream `fraction_within_10pct`. |
| Targets page | Uses all target rows in the selected scope. A missing error fails the test but remains in the denominator. |
| Variable and healthcare summaries | Uses the total target count for the selected variables. |
| Fit Map cluster | Uses only targets with a scorable error. |
| Staging common-target scorecard | Uses only targets shared by both releases after excluding rows where either error exceeds 1,000%. |
| Reform validation | Uses only reforms with a nonzero, comparable JCT benchmark; it may be restricted to out-of-sample reforms. |
| Cross-dataset performance buckets | Uses score-eligible facts with comparable errors. Unmapped or otherwise incomparable facts enter an unavailable bucket. |

Relevant sources:

- Targets-page derivation: [`frontend/lib/microcosm/latest-artifact.ts`](../frontend/lib/microcosm/latest-artifact.ts#L2256)
- Fit Map cluster denominator: [`frontend/components/microcosm/cluster-detail.tsx`](../frontend/components/microcosm/cluster-detail.tsx#L143)
- Staging common-target population: [`frontend/components/microcosm/microcosm-staging-view.tsx`](../frontend/components/microcosm/microcosm-staging-view.tsx#L334)
- Reform population: [`frontend/lib/microcosm/reforms.ts`](../frontend/lib/microcosm/reforms.ts#L184)
- Cross-dataset buckets: [`evaluation_harness/frontend_bundle.py`](../evaluation_harness/frontend_bundle.py#L298)

### 3.1 Fit Map bands

The Fit Map classifies targets into:

- 0–5%
- 5–10%
- 10–20%
- 20–40%
- More than 40%
- Unscored

Source: [`frontend/lib/microcosm/calibration-tree.ts`](../frontend/lib/microcosm/calibration-tree.ts#L92).

### 3.2 Cross-dataset performance bands

Cross-dataset facts use a different classification:

- Within 10%
- More than 10% through 25%
- More than 25%
- No mapping or no comparable error

Source: [`evaluation_harness/frontend_bundle.py`](../evaluation_harness/frontend_bundle.py#L298).

## 4. Calibration loss functions

### 4.1 Normalized target loss: current Initial loss, Final loss, and loss trajectory

This is the current Microcosm calibration objective. It is calculated by:

1. Calculating every target's scaled miss.
2. Taking the magnitude of that miss.
3. Capping it.
4. Applying the target's custom importance weight.
5. Calculating the weighted average across targets.

For the current US build, the scaling behaves like percentage error, the cap is 100%, and the build supplies nonuniform target-importance weights.

The importance weights are calculated before calibration and used throughout optimization. They influence which target errors the optimizer prioritizes.

Used as:

- Overview **Final loss**
- Initial loss
- Loss trajectory
- Staging latest, best, and final loss
- Release-comparison loss

The dashboard does not reconstruct this loss. It passes through the values published by Microcosm.

Sources:

- Dashboard pass-through and classification: [`frontend/lib/microcosm/latest-artifact.ts`](../frontend/lib/microcosm/latest-artifact.ts#L136) and [line 1700](../frontend/lib/microcosm/latest-artifact.ts#L1700)
- Upstream objective: [Microcosm `solve.py`](https://github.com/PolicyEngine/microcosm/blob/main/packages/microcosm-calibrate/src/microcosm/calibrate/solve.py#L448-L493)
- Upstream target-weight construction: [Microcosm US release builder](https://github.com/PolicyEngine/microcosm/blob/main/tools/build_us_fiscal_refresh_release.py#L5793-L5826)

Initial loss, Final loss, and loss trajectory are not distinct loss functions. They are the same objective evaluated at different stages of calibration.

### 4.2 Raw optimizer objective

Older releases without target-loss scaling or weighting metadata are classified as `raw_optimizer_objective`.

This is a producer-defined optimization number. Its scale may depend on the Microcosm version, target units, and optimizer configuration. It is not necessarily a percentage and is not portable across releases.

It is displayed on the same Overview, Compare, and Staging surfaces when an older release is selected. The app formats it in scientific notation.

Source: [`frontend/lib/microcosm/latest-artifact.ts`](../frontend/lib/microcosm/latest-artifact.ts#L136).

### 4.3 Fit Map “Loss sources”: capped squared loss

For each target row, the map:

1. Takes absolute relative error.
2. Caps it at 200%.
3. Squares it.
4. Adds the result to the group total.

Every target row is equally weighted. The result is a sum, not an average.

Used to determine tile area when **Loss sources** is selected.

Source: [`frontend/lib/microcosm/calibration-tree.ts`](../frontend/lib/microcosm/calibration-tree.ts#L129).

This differs from current Final loss in four material ways:

- Final loss uses custom target-importance weights; map loss does not.
- Final loss caps at 100%; map loss caps at 200%.
- Final loss uses the capped error directly; map loss squares it.
- Final loss is a weighted average; map loss is an unweighted sum.

Therefore, the current labels **“Loss sources”** and **“share of calibration loss”** do not accurately describe a decomposition of Microcosm Final loss.

### 4.4 Fit Map Huber loss

For ordinary errors up to 200%, Huber loss behaves like squared error. Above 200%, it switches to linear growth so an extreme outlier has less influence than it would under unrestricted squaring.

The target-level values are added into `huberLoss`. This intermediate total is not directly displayed but drives Error intensity.

It is unweighted and does not use Microcosm target importance.

Source: [`frontend/lib/microcosm/calibration-tree.ts`](../frontend/lib/microcosm/calibration-tree.ts#L129).

### 4.5 Fit Map Huber error intensity

Huber error intensity converts the accumulated Huber loss into a percentage-like per-target intensity by normalizing it by the number of scorable targets and transforming it back toward the scale of an error percentage.

Used to determine tile area when **Error intensity** is selected.

It is distinct from the raw Huber-loss total.

Source: [`frontend/lib/microcosm/calibration-tree.ts`](../frontend/lib/microcosm/calibration-tree.ts#L143).

### 4.6 Cross-dataset loss

For every score-eligible fact, the evaluation harness:

1. Calculates absolute relative error against the selected benchmark.
2. Treats a zero benchmark as 0% error when the estimate is within 0.0001 of zero, and as 100% otherwise.
3. Caps every fact's error at 100%.
4. Calculates an equal-fact arithmetic mean.

Used as the Cross-dataset page's headline and grouped mean error.

Source: [`evaluation_harness/scoring.py`](../evaluation_harness/scoring.py#L37).

This loss does not use:

- Microcosm target-importance weights
- Concept budgets
- Amount/count balancing
- Squared errors
- Huber errors

It may use an aligned or projected benchmark rather than the original observed value, depending on the fact's period treatment.

## 5. Reform-validation errors

Reform validation compares Microcosm budget effects with JCT estimates.

Each reform can have:

- Signed absolute error in dollars
- Signed relative error
- Absolute relative error

Unlike calibration and Cross-dataset scoring, a zero JCT benchmark is left unscored. It does not become either a 0% or 100% structural-zero result.

The summary calculations are uncapped and give each scorable reform equal importance:

- Mean absolute relative error
- Median absolute relative error
- Within 10%
- Out-of-sample mean absolute relative error
- Out-of-sample within-10% rate

Used on the Staging page's reform table and validation scorecard.

Source: [`frontend/lib/microcosm/reforms.ts`](../frontend/lib/microcosm/reforms.ts#L123).

## 6. Loss comparison calculations

The Compare and Staging pages calculate several values derived from an underlying loss:

### 6.1 Absolute loss difference

Final loss B minus Final loss A.

### 6.2 Relative loss change

The difference between B and A, divided by the magnitude of A's loss.

### 6.3 Within-release loss reduction

Final loss compared with initial loss, relative to initial loss.

### 6.4 Latest and best staging loss

- Latest loss is the last recorded trajectory value.
- Best loss is the smallest recorded trajectory value.

These are comparison or selection operations, not new loss objectives.

Source: [`frontend/components/microcosm/microcosm-compare-view.tsx`](../frontend/components/microcosm/microcosm-compare-view.tsx#L47) and [`frontend/components/microcosm/microcosm-staging-view.tsx`](../frontend/components/microcosm/microcosm-staging-view.tsx#L350).

### 6.5 Comparability limitation

The app checks whether releases have the same target surface and the same broad loss kind. It does not verify that two normalized releases use identical target weights, target scales, and caps.

Two releases can therefore both be classified as normalized target loss without having exactly the same objective.

Source: [`frontend/lib/microcosm/latest-artifact.ts`](../frontend/lib/microcosm/latest-artifact.ts#L2542).

## 7. Statistical error rather than model-fit error

Cross-dataset ACS PUMS facts can display two sampling-uncertainty measures.

### 7.1 Standard error

ACS PUMS standard error is calculated from the full estimate and 80 successive-difference replicate estimates.

### 7.2 90% margin of error

The 90% margin of error is the standard error multiplied by 1.645.

These values appear only in Cross-dataset fact details. They are informational and do not affect absolute relative error or Cross-dataset loss.

Source: [`evaluation_harness/adapters/acs_pums.py`](../evaluation_harness/adapters/acs_pums.py#L300) and the display in [`frontend/components/microcosm/cross-dataset-facts-view.tsx`](../frontend/components/microcosm/cross-dataset-facts-view.tsx#L654).

## 8. Present in the repository but not active application metrics

### 8.1 Legacy 200%-capped Cross-dataset loss

[`frontend/lib/microcosm/cross-dataset.ts`](../frontend/lib/microcosm/cross-dataset.ts#L50) contains an older Cross-dataset calculation that caps errors at 200%. Only tests import it. The live page uses the Python evaluation harness's 100%-capped loss.

### 8.2 Legacy inverse display score

Cross-dataset artifacts retain `display_score`, calculated as an inverse transformation of loss, for backwards compatibility. The current page displays loss directly and does not present this score.

Source: [`evaluation_harness/scoring.py`](../evaluation_harness/scoring.py#L79).

### 8.3 Model Coverage `coverageError`

The Model Coverage page maps coverage share onto the application's error color scale. Despite its function name, this is a visual color coordinate, not an analytical error.

Source: [`frontend/components/microcosm/model-coverage-view.tsx`](../frontend/components/microcosm/model-coverage-view.tsx#L150).

### 8.4 Alignment `backtest_error`

`backtest_error` exists in an alignment contract, but the live application does not currently calculate or display it.

Source: [`evaluation_harness/contracts.py`](../evaluation_harness/contracts.py#L383).

### 8.5 Legacy `within_tolerance`

`within_tolerance` remains in the target schema, but current target filtering derives the 10% result from absolute relative error because the published artifact does not reliably populate the field.

Source: [`frontend/lib/microcosm/latest-artifact.ts`](../frontend/lib/microcosm/latest-artifact.ts#L2307).

## 9. Surface-by-surface summary

| Application surface | Error or loss concepts used |
|---|---|
| Overview | Upstream Initial/Final normalized target loss or historical raw optimizer objective; upstream within-10% fraction; Fit Map median error, capped squared loss, and Huber error intensity. |
| Targets | Signed relative error, absolute relative error, within-10% classifications, uncapped mean absolute relative error, and target-level improvement. |
| Compare | Per-target signed relative error, absolute-relative-error change, Final-loss difference, relative loss change, and within-release loss reduction. |
| Staging | Upstream calibration loss and trajectory, filtered common-target mean/median/within-10%, and reform-validation error. |
| Cross-dataset | Fact-level absolute relative error, equal-fact 100%-capped mean loss, performance buckets, standard error, and 90% margin of error. |
| Model Coverage | No model-fit error or loss; `coverageError` is only an internal color mapping. |
| Variables and Pipeline | No additional analytical error or loss calculation beyond values linked from the surfaces above. |

## 10. Main terminology risks

1. **Fit Map “Loss sources” is not a decomposition of Final loss.** It uses a different cap, transformation, aggregation, and weighting rule.
2. **“Within 10%” rates do not always have the same denominator.** The result depends on whether unscored, unmatched, extreme, or in-sample rows are included.
3. **A displayed median can be a weighted average of child medians after map condensation.** That is not the true median of all underlying target errors.
4. **Normalized loss comparability is only partially checked.** The application does not compare the exact importance weights, scales, and cap between releases.
5. **Cross-dataset loss is not calibration loss.** It is an equal-fact, 100%-capped mean and does not use Microcosm's target importance.
6. **Reform error handles zero benchmarks differently.** Zero-benchmark reforms are unscored, while calibration and Cross-dataset structural zeros receive special 0% or 100% treatment.
7. **Standard error and margin of error are sampling uncertainty.** They are not evidence that an estimate missed its benchmark and do not enter the score.
