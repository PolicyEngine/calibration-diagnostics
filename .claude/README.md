# Claude Code Harness

Agentic workflows for Populace calibration diagnostics.

## Commands

### `/investigate-populace-target`

Run a full root-cause investigation for one discrepant target.

Example:

```text
/investigate-populace-target irs_soi.ty2022.table_2_5.eitc_by_agi_children.no_qualifying_children.25k_to_30k.eitc_total@2024
```

Optional release:

```text
/investigate-populace-target --release populace-us-2024-incumbent-improved-996401a-20260618 irs_soi.ty2022.historic_table_2.us.under_1.ctc_amount
```

The command fetches a machine-readable target packet from the diagnostics API, then uses specialist agents to inspect the relevant source repositories and produce a root-cause report with next PRs.

## Agents

- `populace-investigation-supervisor` - coordinates the investigation and writes the final report.
- `populace-ledger-auditor` - verifies ledger/source target semantics.
- `populace-materialization-auditor` - verifies Populus target compilation/materialization.
- `policyengine-model-auditor` - verifies PolicyEngine model variable/entity/unit mapping.
- `populace-calibration-auditor` - verifies calibration status, fit movement, loss weighting, and competing constraints.

## Skill

- `populace-target-investigation` - reusable checklist and report schema for target discrepancy investigations.

