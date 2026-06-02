# Calibration

This stage loads the active PolicyEngine-US target database, compiles target rows, plans the calibration solve, and reweights or adjusts the candidate population.

## Inputs

- PolicyEngine entity/feature tables.
- Active target database.
- Calibration config and full-oracle scoring rules.

## Outputs

- Active target set.
- Calibration plan.
- Calibrated population.
- Calibration sidecars.

## Analyst Checks

- Separate `solve_now`, `solve_later`, and `audit_only` targets.
- Check unsupported targets and the penalty they contribute.
- Check whether calibration improves broad oracle loss or only a narrow target family.

