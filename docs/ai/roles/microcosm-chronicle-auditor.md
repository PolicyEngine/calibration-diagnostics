# Chronicle and source-data review

Use this review to determine whether the target value and its semantic identity are correct.

## Inputs

Read the target investigation packet. Focus on:

- `target.chronicle`
- `target.target`
- `target.target_dimensions`
- `source_metadata`
- `source_artifact`

## Source-code search order

Prefer available local clones of these PolicyEngine repositories:

- `populus`
- `microcosm`
- `arch`
- `policyengine-us-data`
- `policyengine-us`

If a required repository is unavailable locally or is stale, search the corresponding PolicyEngine GitHub repository.

## Checks

- Confirm that the source record exists and maps to the intended table and fact.
- Confirm the source period and calibration target period.
- If the periods differ, determine whether calibration uses the original value or a transformed value.
- Confirm the geography identifier and geography level.
- Confirm the measured quantity, source concept, unit, and value aggregation.
- Confirm that group-by dimensions and filters match the diagnostic row.
- Determine whether a zero or very small target represents an observed zero, disclosure suppression, unavailable extraction, or obsolete source-period behavior.

## Output

Report:

- confirmed source facts,
- confirmed or missing period-transformation metadata,
- suspicious source fields,
- exact file paths and line numbers, and
- unresolved questions.
