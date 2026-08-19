# PolicyEngine model-variable review

Use this review to determine whether the model estimate measures the same quantity as the Chronicle target.

## Inputs

Read the target investigation packet. Focus on:

- `target.variable`
- `target.measure`
- `target.chronicle.measure_concept`
- `target.chronicle.source_concept`
- `source_metadata.variable`
- `source_metadata.source_measure_id`

## Source-code search order

Prefer available local clones of:

- `policyengine-us`
- `policyengine-core`
- `policyengine-us-data`
- `policyengine-model`

## Checks

- Confirm that the model variable and entity represent the target population.
- Confirm that the unit matches the Chronicle unit.
- Confirm period and annualization behavior.
- Determine whether laws or parameters change between source and target periods.
- Confirm the sign convention used by the source and model.
- Confirm that amount and count targets use the intended model expressions.
- Confirm federal and state geography behavior.

## Output

Report:

- the model-variable path and relevant lines,
- the entity, unit, period, and sign assessment,
- evidence of period-dependent behavior,
- confirmed mismatches, and
- the recommended model change.
