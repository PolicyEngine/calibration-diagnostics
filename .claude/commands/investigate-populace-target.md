---
description: Investigate a Populace calibration target discrepancy with specialist agents
argument-hint: "[--release RELEASE_ID] TARGET_ID"
---

# Investigate Populace Target

Investigate a discrepant Populace calibration target using the Claude Code harness, not the dashboard UI.

## Inputs

- `$ARGUMENTS` is either:
  - `TARGET_ID`
  - `--release RELEASE_ID TARGET_ID`

`TARGET_ID` may be any of:
- diagnostics row `name`, with or without `@period`
- Ledger `source_record_id`
- Ledger `fact_key`
- semantic, aggregate, or legacy fact key

## Workflow

### 1. Fetch The Evidence Packet

Run:

```bash
node scripts/populace-investigation-packet.mjs $ARGUMENTS --out investigations/latest-target-packet.json
```

If this fails, stop and report the API error. Do not guess the target metadata.

Read `investigations/latest-target-packet.json`. Treat it as the canonical investigation input.

### 2. Build The Initial Evidence Frame

Extract:
- release id
- target id and source record id
- source, geography, period, measure, unit, dimensions, filters
- source period, target period, value operation, and any transformation/uprating metadata
- target value, initial estimate, final estimate
- final miss, final error, improvement
- calibration status and artifact warnings

Also gather, when available from the packet or release artifacts:
- raw `calibration_diagnostics.json` row,
- `build_manifest.json` target options,
- sibling rows in the same source, measure, geography, and breakdown family,
- aggregate rows for the same source/measure when present,
- release-level loss and target inclusion counts.

### 3. Classify The Discrepancy Shape

Before assigning blame, classify what kind of failure this appears to be. Use the artifact evidence, not screenshots.

Pick all preliminary shapes that apply:
- `single-target outlier`: only this row looks wrong.
- `family-wide miss`: many targets for the same source/measure are off.
- `breakdown redistribution`: aggregate totals are close, but bins/slices are badly redistributed.
- `period-transformation risk`: source period differs from target period for nominal money buckets, law-sensitive benefits, or zero-valued source rows.
- `materialization/filter risk`: sibling slices share estimates, filters are missing, entity grain is unclear, or compiled selectors are not exported.
- `model-mapping risk`: source concept and PolicyEngine variable may differ by unit, sign, entity, period, or amount/count semantics.
- `calibration tradeoff`: the row is included and moves in a plausible direction, but competing targets prevent a better fit.
- `instrumentation gap`: the artifact does not expose enough target compiler or loss details to prove the cause.

This classification should guide the specialist prompts and must appear in the final report.

### 4. Launch Specialist Agents

Use the following subagents, preferably in parallel when the tool supports it.

#### `populace-ledger-auditor`

Input:
- full packet JSON
- target/source ids
- ledger fields

Task:
- Find target declaration/source facts in Populus, Arch, or related source repos.
- Verify source period, target period, geography, unit, measure concept, source concept, value operation, group-by dimensions, filters, and target value.
- Determine whether the target value is raw source-period identity or transformed for the target period.
- Identify whether zero or tiny targets are real, suppressed, missing, or transformed.

#### `populace-materialization-auditor`

Input:
- full packet JSON
- ledger dimensions and filters
- artifact warnings

Task:
- Inspect Populus target compiler/materializer code.
- Determine whether the target's exact dimensions become a compiled model filter/expression.
- For source-period facts used in a later target period, verify whether nominal bucket boundaries are transformed or copied literally.
- Verify selected population scope, child-count/income/geography/entity filters, and whether sibling slices share the same estimate.
- Identify missing artifact fields needed for certainty.

#### `policyengine-model-auditor`

Input:
- full packet JSON
- source/model variable names from packet and ledger

Task:
- Inspect `policyengine-us`, `policyengine-core`, and any relevant model repos.
- Verify variable definition, entity, period, unit, sign convention, and whether it matches the ledger measure.
- Check whether the variable's law/parameters are period-sensitive in a way that can invalidate source-period target surfaces.
- Check whether amount/count variants map to distinct expressions.

#### `populace-calibration-auditor`

Input:
- full packet JSON
- release diagnostics

Task:
- Verify target inclusion status, skipped/dropped state, initial versus final movement, loss scale, target weight, tolerance semantics, and competing constraints.
- Inspect nearby/common targets in the same variable family and release, including sibling breakdown slices and aggregate totals.
- Look for contradictions such as a zero source target with a large positive model estimate in the target period.

### 5. Produce A Root-Cause Report

The final answer must use this structure:

```markdown
## Target
- Release:
- Target:
- Source record:
- Measure:
- Dimensions:
- Target / initial / final:
- Final miss:

## Discrepancy Shape
- Preliminary shape(s):
- Why:

## Verdict
One of:
- confirmed ledger/source target issue
- confirmed materialization/filter issue
- confirmed model variable mapping issue
- confirmed calibration tradeoff/weighting issue
- confirmed period-transformation issue
- inconclusive because missing artifact instrumentation

## Evidence
- Ledger/source evidence:
- Period transformation evidence:
- Materialization evidence:
- Model mapping evidence:
- Calibration evidence:

## Root Cause
Concise explanation with confidence: high / medium / low.

## Decision Path
Briefly state how the investigation moved from symptom to classification to verdict. For example: bad row -> sibling/aggregate check -> source/target period check -> code evidence.

## Next PRs
- Populus:
- PolicyEngine model:
- Ledger/source:
- Diagnostics artifact/dashboard:

## Missing Instrumentation
Only include if needed. Be specific about what Populus should export.
```

## Rules

- Do not rely on dashboard screenshots.
- Do not infer source semantics when a source repo can be searched.
- Prefer local cloned repos under `/Users/pavelmakarchuk` when available.
- Use GitHub/web only when local repos are missing or stale.
- Quote file paths and line numbers for claims about code.
- Separate confirmed evidence from hypotheses.
- If a claim depends only on artifact metadata, say so explicitly.
- Treat `source_period != target_period` as a required investigation branch, especially for nominal currency buckets, law-sensitive tax benefits, and zero-valued source targets.
