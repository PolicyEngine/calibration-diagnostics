# Validation And Benchmarking

This stage evaluates Microplex and the incumbent `policyengine-us-data` baseline through the same PolicyEngine target oracle.

## Inputs

- Microplex H5.
- Incumbent baseline dataset.
- Active PolicyEngine-US target set.

## Outputs

- `policyengine_harness.json`.
- `policyengine_native_scores.json`.
- `pe_us_data_rebuild_native_audit.json`.
- `run_index.duckdb`.
- `pe_native_target_diagnostics.json` in the run bundle, recorded as `manifest.artifacts.policyengine_native_target_diagnostics`, when full row-level diagnostics are generated.
- Public parity, regression, and drilldown JSON summaries.

## Analyst Checks

- Treat the target DB as truth; treat `policyengine-us-data` as the incumbent comparator.
- Check target families that improve or regress.
- Remember that this dashboard currently reads public summary JSONs, not the generated H5, run index, or full per-target diagnostic bundle unless a generated artifact root or artifact service is wired in.
