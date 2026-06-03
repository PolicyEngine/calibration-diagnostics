# Dataset Assembly

This stage writes the calibrated candidate into a PolicyEngine-ingestable H5 and records dataset assembly metadata.

## Inputs

- Calibrated population.
- PolicyEngine entity tables.
- Export maps and dataset-year metadata.

## Outputs

- `policyengine_us.h5` or equivalent Microplex H5.
- Stage manifest.
- Data-flow snapshot and artifact inventory.

## Analyst Checks

- Confirm PolicyEngine can load the H5 without schema repair.
- Confirm all required entity arrays are present.
- Check whether the H5 is public, private, or only referenced by summary artifacts.

