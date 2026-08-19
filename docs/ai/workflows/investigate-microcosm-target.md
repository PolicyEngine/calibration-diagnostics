# Investigate a Microcosm calibration target

Use this procedure to determine why a Microcosm calibration target has a large error, an unexpected target value or estimate, or a substantial change between releases.

## Inputs

Provide a target identifier and, when required, a release identifier. The target identifier may be:

- a diagnostic row `name`, with or without `@period`,
- a Chronicle `source_record_id`,
- a Chronicle `fact_key`, or
- a semantic, aggregate, or legacy fact key.

## 1. Generate the evidence packet

Run:

```bash
node scripts/microcosm-investigation-packet.mjs \
  --release <release-id> <target-id> \
  --out investigations/latest-target-packet.json
```

The release argument may be omitted when the current release is intended. If the command fails, report the API error and stop; do not infer missing target metadata.

Read `investigations/latest-target-packet.json` and use it as the primary investigation input.

## 2. Summarize the initial evidence

Extract:

- release identifier,
- target identifier and source-record identifier,
- source, geography, period, measured quantity, unit, dimensions, and filters,
- source period, target period, value aggregation, and transformation metadata,
- target value, initial estimate, and final estimate,
- final absolute difference, final relative error, and improvement,
- calibration status, and
- artifact warnings.

When available, also inspect:

- the original `calibration_diagnostics.json` row,
- target options in `build_manifest.json`,
- sibling diagnostic rows with the same source, measured quantity, geography, and dimensions,
- aggregate rows for the same source and quantity, and
- release-level loss and target-inclusion counts.

## 3. Classify the discrepancy

Select every preliminary classification supported by artifact evidence:

- **Single-target discrepancy:** only the selected row differs substantially from its benchmark.
- **Family-wide discrepancy:** many targets for the same source and measured quantity differ from their benchmarks.
- **Incorrect breakdown distribution:** aggregate totals fit, but their values are distributed incorrectly across ranges or categories.
- **Period-transformation risk:** source and target periods differ for nominal currency ranges, policy-dependent values, or zero-valued source rows.
- **Target construction or filter risk:** sibling targets share estimates, filters are absent, entity selection is unclear, or compiled selectors are not published.
- **Model-variable mapping risk:** the source quantity and PolicyEngine variable may differ in unit, sign, entity, period, or amount-versus-count behavior.
- **Competing calibration constraints:** the target is included and moves toward its benchmark, but other constraints prevent a closer fit.
- **Missing diagnostic data:** the artifact omits compiler output, error scaling, importance weights, or other fields required to establish the cause.

Use this classification to select the reviews in the next step. Include it in the final report.

## 4. Perform the relevant technical reviews

These reviews can run independently when multiple workers are available:

### Chronicle and source data

Follow [Chronicle and source-data review](../roles/microcosm-chronicle-auditor.md).

Verify the source fact, source and target periods, geography, unit, measured quantity, value aggregation, dimensions, filters, and target value. Determine whether the target uses an original source value or a transformed value.

### Target materialization

Follow [Target materialization review](../roles/microcosm-materialization-auditor.md).

Inspect Populus target construction. Confirm that every source dimension becomes the intended model filter, nominal boundaries receive the intended period treatment, the entity is correct, and amount and count targets use distinct expressions where required.

### PolicyEngine model mapping

Follow [PolicyEngine model-variable review](../roles/policyengine-model-auditor.md).

Confirm the variable definition, entity, period, unit, sign, annualization, and policy sensitivity. Confirm that the model expression measures the same quantity as the source fact.

### Calibration calculations

Follow [Calibration calculation review](../roles/microcosm-calibration-auditor.md).

Confirm target inclusion, initial and final movement, error scale, importance weight, tolerance behavior, related target fit, and competing constraints.

When coordinating several reviews, follow [Investigation coordinator](../roles/microcosm-investigation-supervisor.md).

## 5. Produce the report

Use this structure:

```markdown
## Target
- Release:
- Target:
- Source record:
- Measured quantity:
- Dimensions:
- Target / initial estimate / final estimate:
- Final absolute difference:

## Discrepancy classification
- Preliminary classifications:
- Supporting evidence:

## Conclusion
One primary conclusion from the list below.

## Evidence
- Chronicle and source-data evidence:
- Period-transformation evidence:
- Target-construction evidence:
- Model-variable evidence:
- Calibration evidence:

## Cause
Concise explanation with high, medium, or low confidence.

## Reasoning sequence
The sequence from observed discrepancy through comparisons and source-code evidence to the conclusion.

## Recommended changes
- Populus:
- PolicyEngine model:
- Chronicle or source ingestion:
- Diagnostic artifact or dashboard:

## Missing diagnostic data
Include only when required, and identify the exact fields that should be published.
```

Use exactly one primary conclusion:

- confirmed Chronicle or source-target issue
- confirmed target construction or filter issue
- confirmed model-variable mapping issue
- confirmed competing calibration constraints or importance-weight issue
- confirmed period-transformation issue
- inconclusive because published artifacts omit required diagnostic data

## Evidence rules

- Do not use dashboard screenshots as evidence.
- Do not infer source semantics when the relevant source repository can be inspected.
- Prefer available local repository clones; use GitHub when a local clone is absent or stale.
- Cite exact file paths and line numbers for code claims.
- Separate confirmed evidence from hypotheses.
- Identify claims supported only by artifact metadata.
- Always inspect period transformation when the source and target periods differ, especially for nominal currency ranges, policy-dependent values, and zero-valued targets.
