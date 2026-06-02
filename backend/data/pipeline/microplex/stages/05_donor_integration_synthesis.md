# Donor Integration And Synthesis

This stage adds donor-only variables and materializes the synthetic candidate population. It is one of the highest-risk stages because donor matching, projection, and support enforcement can move downstream tax and benefit aggregates.

## Inputs

- Seed scaffold.
- Donor frames.
- Donor-block manifest and condition surfaces.
- Random seed and support requirements.

## Outputs

- Imputed variable blocks.
- Synthetic population.
- Imputation sidecars and source-weight diagnostics.

## Analyst Checks

- Identify which donor block supplied a variable.
- Inspect the match conditions used for high-impact variables.
- Check whether entity projection changed totals or invalidated combinations.

