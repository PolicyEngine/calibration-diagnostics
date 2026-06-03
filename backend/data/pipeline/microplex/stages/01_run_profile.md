# Run Profile

This stage fixes the runtime contract before any data is loaded. It resolves the selected Microplex profile, source bundle, target period, calibration backend, random seed, artifact root, and incumbent-comparison mode.

## Inputs

- Profile defaults and runtime overrides.
- Target period and target profile.
- Source-provider names and query settings.

## Outputs

- Resolved config.
- Provider/query plan.
- Run manifest.

## Analyst Checks

- Confirm whether the run is an incumbent-compatibility profile or a challenger mode.
- Confirm that the source bundle and target period match the comparison being shown.
- Confirm that the artifact root and manifest are versioned enough to reproduce the run.

