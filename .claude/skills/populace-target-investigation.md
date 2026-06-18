# Populace Target Investigation Skill

Use this skill when investigating why a Populace calibration target has a bad fit, odd target value, suspicious estimate, or unexpected version-over-version movement.

## Core Principle

The dashboard is an observation surface, not the investigation engine. The agent must work from:

1. the target investigation packet,
2. release artifacts,
3. Populus/Arch source code,
4. PolicyEngine model code,
5. calibration diagnostics.

## Required Inputs

Start with a target packet from:

```bash
node scripts/populace-investigation-packet.mjs --release <release-id> <target-id> --out investigations/latest-target-packet.json
```

The packet includes:
- target row and estimates,
- Ledger fact fields,
- source metadata,
- artifact paths,
- repo search links,
- artifact-level warning signals,
- known limitations.

## Investigation Axes

### 0. Discrepancy Shape

Before assigning a root cause, classify the symptom pattern:
- one bad target versus many targets,
- bad aggregate versus bad breakdown distribution,
- source-period and target-period mismatch,
- possible missing filters or entity-grain mismatch,
- possible model-variable semantic mismatch,
- plausible calibration tradeoff,
- missing artifact instrumentation.

Use this classification to decide which specialist evidence matters most.

### 1. Ledger / Source Fact

Verify:
- source period and target period,
- value operation and whether the compiled target is raw source identity or transformed for the target period,
- geography and geography level,
- measure concept and source concept,
- unit and value operation,
- group-by dimension and value,
- filters and universe constraints,
- whether zero/small target values are real data or suppression/missingness.

Evidence should come from Populus, Arch, source extractors, or ledger construction code.

### 2. Target Materialization

Verify:
- exact ledger filters compile into a model selector,
- nominal source-period buckets are transformed when needed, or explicitly copied literally,
- the selected entity matches the target entity,
- income bands, child-count slices, filing-status slices, geography slices, and age bands are implemented as filters,
- sibling target slices do not accidentally share the same broad estimate,
- amount and count variants do not reuse the wrong expression.

If the release artifact does not include compiled filter/expression fields, report this as missing instrumentation.

### 3. PolicyEngine Model Mapping

Verify:
- variable name or aggregate expression,
- entity,
- definition period,
- unit,
- sign convention,
- annualization,
- tax year alignment,
- whether laws/parameters for the variable change between source and target periods,
- amount/count distinction.

### 4. Calibration Mechanics

Verify:
- included/skipped/dropped status,
- target loss weight and scale,
- declared tolerance,
- initial-to-final movement,
- same-variable family fit,
- sibling breakdown slices and aggregate totals,
- zero-target source rows with positive target-period estimates,
- competing constraints on the same slice,
- whether a poor fit is a real tradeoff rather than a source/mapping bug.

## Verdict Taxonomy

Use exactly one primary verdict:

- `confirmed ledger/source target issue`
- `confirmed materialization/filter issue`
- `confirmed model variable mapping issue`
- `confirmed calibration tradeoff/weighting issue`
- `confirmed period-transformation issue`
- `inconclusive because missing artifact instrumentation`

## Output Requirements

Every final report must include:
- target identity,
- numeric discrepancy,
- discrepancy shape,
- evidence by investigation axis,
- decision path from symptom to verdict,
- confidence,
- recommended next PRs,
- missing instrumentation, if any.

Never mix confirmed evidence and hypotheses in the same bullet.
