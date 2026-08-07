# Claude Code Harness

Agentic workflows for Microcosm calibration diagnostics.

## Commands

### `/investigate-microcosm-target`

Run a full root-cause investigation for one discrepant target.

Example:

```text
/investigate-microcosm-target irs_soi.ty2022.table_2_5.eitc_by_agi_children.no_qualifying_children.25k_to_30k.eitc_total@2024
```

Optional release:

```text
/investigate-microcosm-target --release populace-us-2024-incumbent-improved-996401a-20260618 irs_soi.ty2022.historic_table_2.us.under_1.ctc_amount
```

The command fetches a machine-readable target packet from the diagnostics API, then uses specialist agents to inspect the relevant source repositories and produce a root-cause report with next PRs.

## Agents

- `microcosm-investigation-supervisor` - coordinates the investigation and writes the final report.
- `microcosm-chronicle-auditor` - verifies chronicle/source target semantics.
- `microcosm-materialization-auditor` - verifies Populus target compilation/materialization.
- `policyengine-model-auditor` - verifies PolicyEngine model variable/entity/unit mapping.
- `microcosm-calibration-auditor` - verifies calibration status, fit movement, loss weighting, and competing constraints.

## Skill

- `microcosm-target-investigation` - reusable checklist and report schema for target discrepancy investigations.

