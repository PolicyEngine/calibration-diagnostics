# PolicyEngine Entities

This stage converts the synthetic population into PolicyEngine-compatible entity tables and materializes PE-derived features needed by targets.

## Inputs

- Synthetic candidate population.
- PolicyEngine entity mapping rules.
- `policyengine-us` variable definitions.

## Outputs

- Person, tax-unit, SPM-unit, household, and marital-unit tables.
- Materialized PolicyEngine input and derived feature tables.

## Analyst Checks

- Confirm variables sit on the correct PolicyEngine entity.
- Confirm entity joins are valid.
- Distinguish stored inputs from formula outputs when diagnosing a target.

