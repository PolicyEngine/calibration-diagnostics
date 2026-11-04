# P2: hierarchy omission is not proof of differing group-by values

**Dashboard location at `67e6d0b`:** `frontend/packages/calibration-tree/src/latest-artifact.ts:571` classifies an unlisted value as `"differs"`; `:615` publishes `layout_groupby_value_varies: true`. `frontend/components/microcosm/target-row-labels.ts:17-20` consequently describes the target as combining several values of that dimension. The core bug is the inference at `:571`, not the equality comparison in `hierarchyListsGroupBy`.

## Concrete successful producer input

Run `python3 -I work/identity/hierarchy_probe.py > work/identity/hierarchy_probe.log 2>&1` (exit 0). The script loads the supplied module's actual AST with unavailable Microcosm imports replaced only by generic output/model objects; it uses the actual `_ledger_fact_index`, `_resolve_reference_fact`, `target_spec_from_ledger_reference`, `_validate_chronicle_hierarchy_labels`, `_calibration_hierarchy` and `_inherited_dimensions`. Unlike the earlier allocation observer, this script does **not** intercept the hierarchy builder. The raw log contains the complete two fact dictionaries, reference semantics and final target metadata/hierarchy.

The first case is a normal sum across two disjoint sex cells of the same loan type:

| fact key | ordinary `dimensions` | `layout.groupby_dimension` | `layout.groupby_value_id` |
|---|---|---|---|
| `a-explicit` | `{"loan_type":"a","sex":"female"}` | absent | absent |
| `b-layout` | `{"sex":"male"}` | `loan_type` | `a` |

Both facts have source `Publisher`, measure/source concept `balance`, aggregation `sum`, entity `person`, period calendar year 2024, geography GB/United Kingdom, value 20 and complete consistent dimension/value labels. The layout-owning fact labels its group-by as Loan type / A. The ordinary-dimension-owning fact labels the exact same semantic dimension/value as Loan type / A. There is no contradictory dimension value in either fact.

The reference is `LedgerTargetReference(name="combined-balance", ledger_selector={"source_name":"Publisher"}, value_operation="sum", expected_member_count=2, entity="person", measure="balance", period=2024, hierarchy=<valid provider/category seed with explicit target_label="Combined balance">)`.

The catalog resolver selects and sorts both facts (`ledger_targets.py:2146-2183`); the representative is last on the period tie (`:1245`), `b-layout`. `identity_facts` contains both facts (`:1034`), so the target's identity shares loan_type=a semantically. The actual final target writes `ledger_member_fact_count="2"`, `ledger_layout_groupby_dimension="loan_type"`, `ledger_layout_groupby_value_id="a"`, and `hierarchy.dimensions=[]`. The log records `dashboard_layout_groupby_value_varies: true` under the same hierarchy-list test the dashboard uses.

Thus this target is advertised as combining several loan-type values despite every constituent carrying the same Loan type A. The target genuinely combines several source cells (female + male), so neutral source-cell wording would be accurate.

## Why the producer accepts it, and why its hierarchy omits the value

The supplied module explicitly describes its input as duck-typed against the Ledger aggregate fact schema and consumes JSONL without importing the Ledger implementation (`ledger_targets.py:1-7`). The local validator intentionally treats layout group-by and ordinary dimensions as two storage forms for dimensions: it copies ordinary dimensions then does `dimensions.setdefault(groupby_id, groupby_value_id)` for the layout pair (`:1483-1489`). This is sufficient for all labels in the example to validate (`:1491-1554`), and the actual catalog + compiler execution succeeds.

However, hierarchy construction has two separate routes:

1. `_constant_text` must find one common **literal layout field** across every fact (`:1583-1585`, helper `:1649-1651`). Missing layout fields on `a-explicit` make both constants empty, so it adds no layout dimension.
2. `_common_dimensions` intersects only raw ordinary dimensions (`:1614-1623`); it does not merge each fact's layout pair as the validator does. The second fact lacks ordinary loan_type and sex differs, so the intersection is empty.

Consequently the hierarchy omits a semantically common dimension. It is sound positive evidence when an ordinary dimension/value is common or the layout pair is constant, but absence does not prove the two underlying semantic values differ.

The second logged case proves a related distinction without any conflicting data: both facts store ordinary loan_type=a, but only the representative has a layout pair. The hierarchy **does** list loan_type=a through its ordinary-dimension route despite the literal layout pairs not being constant. Therefore the comments/body must distinguish a common dimension value from identical layout fields.

The third logged case deliberately gives one fact ordinary loan_type=a but layout loan_type=b. The compiler accepts it and emits a from the ordinary dimensions, illustrating that the local producer also does not enforce agreement between these storage forms. **Do not use this third case as the primary finding:** the external Chronicle schema is unavailable locally, so its acceptance by that upstream schema is not established. The primary mixed-storage case has no such contradiction.

## Available-contract limit

The evidence proves a successful input through every relevant supplied Microcosm selection, validation and target-compilation function. No supplied contract forbids one fact to store a dimension in `dimensions` and another in `layout`; the validator's explicit merge supports that interpretation. The external Chronicle schema and its validators are absent, so this review cannot certify its external validation independently. A claim that Chronicle rejects the **noncontradictory** example would require a contract not present in the provided inputs; it should not be assumed to rescue the dashboard inference.

## Smallest safe fix

Keep the positive common-value check, but treat an unlisted group-by as **unknown**, rather than `"differs"`: `layout_groupby_value_varies` must be null for the example. There is not enough target metadata to infer a missing layout pair's other members' values.

Retain a separate indicator that a multi-fact identity's representative group-by is unlisted (or rename the new field before release to reflect this actual condition), and show **"Combines several source cells"** in the Dimensions cell for that condition. This still fixes FSA's misleading `All`, preserves shared dimensions in the cell, and states something the producer metadata proves. A mere wording change while leaving `layout_groupby_value_varies=true` would leave the API claim false.

Alternatively, first change upstream `_inherited_dimensions` to normalize each fact's ordinary dimensions plus its layout pair before intersection, validate contradictory storage, regenerate the release and prove that missing dimensions now mean differing values. That is a larger cross-repository prerequisite; current source does not establish it.

## Mechanism claims to correct

- The phrase "only when every identity fact shares it" is only a one-way claim. Positive presence can establish common semantic dimension/value for noncontradictory inputs; **absence is not its converse**.
- The comment at `latest-artifact.ts:555-558` and `groupByAcrossIdentity`'s `:571` assume that converse and are wrong for this accepted input.
- PR body/hand-off descriptions that state hierarchy omission means varying values or that it lists the value **exactly when** all facts share it need the same correction.
- `hierarchyListsGroupBy`'s raw id vs value-id field mapping remains correct; this finding does not depend on casing, trimming or schema 6.
