# Microcosm target investigation checklist

Use this checklist when investigating a large target error, unexpected target value or estimate, or substantial change between releases. For the full procedure and report structure, follow [Investigate a Microcosm calibration target](../workflows/investigate-microcosm-target.md).

## Required evidence

Start by generating a target investigation packet:

```bash
node scripts/microcosm-investigation-packet.mjs \
  --release <release-id> <target-id> \
  --out investigations/latest-target-packet.json
```

Use evidence from:

1. the target investigation packet,
2. release artifacts,
3. Populus and Chronicle source code,
4. PolicyEngine model code, and
5. calibration diagnostics.

## Classify the discrepancy first

Before identifying a cause, determine whether the evidence indicates:

- one discrepant target or a related family of targets,
- an incorrect aggregate or an incorrect distribution across categories,
- different source and target periods,
- missing filters or an incorrect entity,
- a model-variable semantic mismatch,
- competing calibration constraints, or
- missing diagnostic data.

## Chronicle and source data

Verify:

- source and target periods,
- whether calibration uses the original source value or a transformed value,
- geography and geography level,
- measured quantity and source concept,
- unit and value aggregation,
- grouping dimensions and values,
- filters and population constraints, and
- whether zero or very small values represent observed data, suppression, or missingness.

## Target materialization

Verify:

- that each Chronicle filter becomes a model selector,
- whether nominal source-period ranges are transformed when required,
- the selected entity,
- income, child-count, filing-status, geography, and age filters,
- that sibling target ranges do not unintentionally share estimates, and
- that amount and count targets use the intended expressions.

If the release does not publish compiled filters or expressions, record the exact missing fields.

## PolicyEngine model mapping

Verify:

- variable or aggregate expression,
- entity,
- definition period,
- unit,
- sign convention,
- annualization,
- tax-year alignment,
- period-dependent laws and parameters, and
- amount-versus-count behavior.

## Calibration calculations

Verify:

- whether the target was included, skipped, or removed,
- target importance weight and error scale,
- declared tolerance,
- initial and final estimates,
- related target-family fit,
- sibling ranges and aggregate totals,
- zero-valued targets with positive estimates,
- competing constraints on the same population, and
- whether the remaining error is a constraint tradeoff rather than a source or mapping defect.

## Report requirements

Include:

- target identity and numeric discrepancy,
- discrepancy classification,
- evidence from every relevant technical area,
- the reasoning sequence from symptom to conclusion,
- confidence,
- recommended repository changes, and
- missing diagnostic fields, when applicable.

Keep confirmed evidence and hypotheses in separate bullets.
