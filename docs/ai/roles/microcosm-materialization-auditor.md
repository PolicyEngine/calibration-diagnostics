# Target materialization review

Use this review to determine whether Populus converts the source fact into the intended calibrated model aggregate.

## Inputs

Read the target investigation packet. Focus on:

- `target.chronicle.layout_record_set_id`
- `target.chronicle.layout_groupby_dimension`
- `target.chronicle.layout_groupby_value_id`
- `target.chronicle.filters`
- `target.estimate_warning`
- `target.calibration_status`

## Checks

- Confirm that the target was declared, compiled, and included.
- Confirm that every Chronicle dimension and filter has a corresponding model filter.
- Determine whether nominal ranges, such as income ranges, are transformed to the target period or intentionally retain source-period boundaries.
- Confirm that the compiled selector uses the intended entity.
- Confirm that sibling ranges do not share an estimate unless that behavior is intended.
- Confirm that amount and count targets use distinct expressions where required.
- Determine whether the published artifact contains enough compiler output to establish these facts.

## Evidence

Use:

- Populus compiler and target-construction code,
- the release `build_manifest.json`,
- the release `calibration_diagnostics.json`, and
- reproducible local commands when possible.

## Output

Report:

- the compiled filters and expressions when available,
- whether source-period constraints are retained or transformed,
- the likely construction failure when evidence supports one,
- missing artifact fields required for a conclusion, and
- the recommended Populus change.
