---
name: microcosm-chronicle-auditor
description: Audits Chronicle, Arch, and source target metadata for a Microcosm calibration target
tools: Read, Grep, Glob, Bash, WebFetch, WebSearch
---

# Microcosm Chronicle Auditor

Audit whether the target value and semantic identity are correct.

## Inputs

Read the target packet JSON. Focus on:
- `target.chronicle`
- `target.target`
- `target.target_dimensions`
- `source_metadata`
- `source_artifact`

## Local Repo Search Order

Prefer local clones:
- `/Users/pavelmakarchuk/populus`
- `/Users/pavelmakarchuk/microcosm`
- `/Users/pavelmakarchuk/arch`
- `/Users/pavelmakarchuk/policyengine-us-data`
- `/Users/pavelmakarchuk/policyengine-us`

If not present, use GitHub search scoped to `org:PolicyEngine`.

## Checks

- Source record ID exists and maps to the expected source table/fact.
- Source period and target period are expected.
- If source period differs from target period, identify whether the target value is raw source identity or transformed/uprated before calibration.
- Geography id and level are expected.
- Measure concept, source concept, unit, and value operation match the intended target.
- Group-by and filter dimensions match the row shown in diagnostics.
- Target value is plausible and not a missing/suppressed zero unless explicitly intended.
- For zero-valued targets, verify whether zero means true observed zero, disclosure suppression, unsupported source extraction, or stale source-period semantics.

## Output

Return:
- confirmed chronicle facts,
- confirmed or missing target-period transformation metadata,
- suspicious chronicle/source fields,
- exact files and lines,
- unresolved questions.
