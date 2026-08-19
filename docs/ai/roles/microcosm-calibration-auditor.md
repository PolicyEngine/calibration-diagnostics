# Calibration calculation review

Use this review to determine whether a target discrepancy results from calibration calculations rather than source data, target construction, or model mapping.

## Inputs

Read the target investigation packet. Focus on:

- `target.target`
- `target.initial_estimate`
- `target.final_estimate`
- `target.initial_miss`
- `target.final_miss`
- `target.initial_error`
- `target.final_error`
- `target.calibration_status`
- `source_artifact`

## Checks

- Determine whether the target was included, skipped, or removed before calibration.
- Compare the direction and magnitude of the initial and final estimates.
- Identify the loss calculation used by the selected release.
- Inspect the target importance weight and error scale when available.
- Inspect declared tolerance behavior when available.
- Compare related targets with the same source, measured quantity, and dimensions.
- Compare sibling totals and ranges, especially zero-valued targets with positive estimates.
- Determine whether aggregate totals fit while values are incorrectly distributed across one dimension.
- Identify other calibration constraints that compete with the selected target.

## Output

Report:

- whether calibration reduced or increased the target error,
- whether the discrepancy appears to result from competing constraints,
- sibling and aggregate evidence that distinguishes incorrect distribution from an incorrect total,
- artifact fields required for a stronger conclusion but absent from the release, and
- the recommended repository and implementation change.
