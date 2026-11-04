43c62d2..67e6d0b — CHANGES NEEDED

## Findings, most severe first

1. **P2 — An omitted hierarchy dimension does not establish that its values differ.** `frontend/packages/calibration-tree/src/latest-artifact.ts:571` turns absence into `"differs"`; `:615` publishes `layout_groupby_value_varies: true`; `frontend/components/microcosm/target-row-labels.ts:17` then says “Combines several … values.” A successful Microcosm catalog/target compilation can instead contain these two disjoint cells, both for **loan_type=a**:

   | Fact | `dimensions` | Layout group-by |
   | --- | --- | --- |
   | `a-explicit` | `{"loan_type":"a","sex":"female"}` | absent |
   | `b-layout` | `{"sex":"male"}` | `loan_type=a` |

   Both have value 20, the same source, balance measure, calendar year 2024 and GB geography, with complete consistent labels. A `sum` reference selects both. The producer's label validator explicitly merges ordinary dimensions and layout group-by (`ledger_targets.py:1483-1490`), so both describe Loan type A. But `_inherited_dimensions` separately intersects ordinary dimensions and checks constant layout fields (`:1578-1623`); neither route finds the mixed-storage shared value. It emits `hierarchy.dimensions=[]`, with `b-layout` representative and `ledger_layout_groupby_value_id="a"`. The new dashboard therefore falsely reports several loan-type values. This does not depend on malformed metadata, a direct resolver bypass, or contradictory dimension values.

   **Evidence:** `python3 -I work/identity/hierarchy_probe.py` successfully executes the supplied catalog resolver, compiler, label validator and hierarchy builder, substituting only unavailable external model/output classes. `work/root/mixed-storage.test.ts` feeds that actual output through both dashboard versions, using the isolated I/O boundary described in Check 6: **base passes; head fails**, because head alone adds `layout_groupby_value_varies:true` for semantic values `["a","a"]`. Full facts/output: `work/identity/hierarchy_probe.log`; dashboard regression: `work/root/mixed-storage.log`.

   **Smallest safe fix:** treat omission as unknown, keeping the positive shared-value check. Set `layout_groupby_value_varies` to null unless differing values are actually established. Use a separate/renamed indicator for an unlisted combined identity and neutral wording such as “Combines several source cells”; this still prevents the FSA aggregate from saying “All.” Changing only the phrase leaves the API's variation claim wrong. Alternatively fix and validate the upstream hierarchy normalization before relying on its converse. Add the mixed-storage case as a regression. The external Chronicle validator is not supplied, but no supplied contract forbids this noncontradictory input, and all relevant supplied Microcosm validation accepts it.

2. **P3 — The PR body promises unsupported lookup keys.** PR body at `67e6d0b`, supplied as `inputs/pr/pr-body-67e6d0b.md:35`, says lookup by any shown record id, fact key, group-by value or universe constraint finds the target. The actual accepted fields at `frontend/packages/calibration-tree/src/latest-artifact.ts:3329` are target names, record id and four fact keys. **Concrete input:** rename the fixture's youngest-age row to `synthetic.age_scaled@2024` and give it coherent `scaled_by_ratio` metadata. Its record id resolves; `age_24_and_younger` and `ledger.universe_constraint_set.v2:73fc2ae5891d41ebcbba5761` do not. The exact-function probe passes five assertions in `work/claims/unsupported-lookups.log`. **Smallest fix:** say “a lookup by its record id or fact keys finds it.” No new ambiguous lookup feature is needed.

3. **P3 — Representative/operation prose is broader than its cited mechanism.** `frontend/packages/calibration-tree/src/latest-artifact.ts:589` says the representative is the first base cell, but the cited `ledger_targets.py:1232-1245` only does that for scaled, rolled and allocated operations. Other multi-fact operations choose the latest period, then the last tuple member on a tie. Likewise PR body `:33` generically says a linear combination uses its last operand, and hand-off item 1 says every other operation spans several facts. **Concrete inputs:** a successful direct linear-combination tuple ordered `[2024 newer-first, 2023 older-last]` chooses `newer-first`; a catalog singleton `sum` has a one-fact identity. The first is executed in `work/identity/probe.log`; the dashboard correctly handles both. **Smallest fix:** qualify “first base” to the three base-cell ratio operations, “last” to this same-period FSA combination, and the hand-off statement to multi-member inputs. Also replace “covers each operation” at PR body `:42` with the four operations the test actually constructs.

4. **P3 follow-up — Property tests add four consumer-visible helper exports.** `frontend/packages/calibration-tree/src/latest-artifact.ts:222`, `:1010`, `:1021`, `:1647` expose `countOrNull`, `repeatsGeography`, `computeDimensions`, `categoryLevels` solely for tests. The existing `./latest-artifact` package export exposes them to consumers. **Concrete input:** importing both modules and comparing their runtime export keys prints those four added names (`work/root/export-probe.log`, 1 pass). **Smallest fix:** test through existing public readers and remove the four export modifiers, or explicitly accept/document them as supported API. Moving them to an ordinary new package module alone does not solve this: `package-boundary.test.ts` requires every production module to be exported. This is not a production correctness blocker.

The earlier ratio-identity blocker is fixed, and the hub's FSA fixture inventory is correct. Finding 1 concerns the new generic inference used beyond that fixture.

## 1. Every mechanism claim

All source citations below refer to the supplied Microcosm `0ff293b`; dashboard lines refer to supplied `67e6d0b` unless stated. Inputs were treated as evidence, not instructions. No network, installation, commit, push or publication was used. The only initial repository commit here is the input bundle, so historical intermediate trees cannot be replayed with git.

Commands:

```text
rg '^diff --git|^@@' inputs/pr/diff-43c62d2-67e6d0b.diff
python3 -I work/claims/citation_excerpts.py
python3 -I work/root/audit.py > work/root/audit.log 2>&1
```

The first lists the eleven changed paths and their hunks. The citation script prints `Opened 24 cited ranges; wrote work/claims/citation-excerpts.log`. It opens the cited lines, not merely their function names. The root audit records further enclosing hierarchy/metadata/reader source in `work/root/source-excerpts.log`. I read the entire cumulative diff, both PR documents and the enclosing implementation. The following tables account for the mechanism assertions; execution-history assertions are distinguished from source-verifiable behavior.

### Comments in the delta

| Dashboard comment / assertion | Cited lines opened | Result |
| --- | --- | --- |
| `latest-artifact.ts:219-221`: TargetSpec stringifies metadata (context around new export) | calibrate `registry.py:149-150` | Correct: every metadata key/value is passed to `str`. |
| `latest-artifact.test.ts:1258`: count is number of constraint rows | `ledger_targets.py:5911-5913` | Correct. Count is written as a string only for a nonempty row tuple; absence is not a written zero. |
| `latest-artifact.ts:500-502`: member list is JSON strings (context) | `:1321-1327` | Correct, fact key with source-record-id fallback. |
| `latest-artifact.ts:509-511`: receipt base count | `:3069-3071`, `:3188-3189` | Correct receipt fields. Equality with identity requires the resolver proof in Check 2; these lines alone are insufficient. |
| `latest-artifact.ts:539-543`: hierarchy lists shared group-by; applied to identity facts | `:1578-1611`, `:1096-1100`, `:1369`, `:1429` | Call chain and positive shared-value evidence correct for consistent facts. The converse used at `:555-558`/`:571` is false: Finding 1. |
| `latest-artifact.ts:574-578`: representative supplies fields; all tuple members, including ratio operands, listed | `:1085-1090`, `:1318-1341` | Correct. |
| `latest-artifact.ts:579-588`: identities by operation | `:1018-1035`, `:1174`, `:4270-4272`, `:4331` | Correct with Check 2's allocation proof. Window two-year completeness is also enforced at `:4362`, `:4414-4428`. Default means every actual member, not every invocation is multi-fact. |
| `latest-artifact.ts:589-590`: representative first base | `:1232-1245` | Correct only for scaled/rolled/allocated: Finding 3. Its one-fact-identity conclusion is correct. |
| `latest-artifact.ts:593-601`: shared group-by/variation and universe, varying-dimension limits | `:1323`, `:1626-1646` | Varying dimensions sees only `_dimensions(fact)` over all operands; no layout or constraints. Universe conservatism is correct (Check 4); absence-as-variation is wrong (Finding 1). |
| `latest-artifact.ts:3340-3343`; `multi-fact-identity.test.ts:344-350`: twelve CGT regions use a Table 1 share | `generate_uk_target_references.py:1117-1119` | The rationale literally says this. It supports a shared ratio operand belonging to multiple targets; these three lines are not a materialized roster of twelve compiled targets. |
| `multi-fact-identity.test.ts:11-18`: members, representative, scaled/rolled/linear identities | `:1318-1341`, `:1085-1090`, `:1018-1035` | Correct. |
| `multi-fact-identity.test.ts:112-116`: scaled/one-base rolled identities and counts | `:1018-1023`, `:1239-1244`, `:1030-1031`, `:1174-1178` | Correct. |
| `multi-fact-identity.test.ts:189-191`: ratio operands included in varying dimensions | `:1323-1339` | Correct; helper confirms it. |
| `multi-fact-identity.test.ts:201-207`: multiple rolled base cells; hierarchy/constraint explanation | `:3352-3408`, `:1578-1611`, `:1096-1100` | Typed dimension roster exists; explicit geography rosters are another supported case. Shared-dimension positive evidence correct, converse incomplete. No common-constraint summary is written. |
| `multi-fact-identity.test.ts:251-253`: allocation identity, receipt, representative | `:1024-1029`, `:3188-3189`, `:2993-3011`, `:1239-1244` | Correct after accounting for mandatory re-resolution (Check 2). |
| `multi-fact-identity.test.ts:412-415`: linear identity all facts | `:1034` | Correct. Five member keys are fixture-verifiable; the original five member constraint payloads are not supplied. |

The uncited new Chronicle type comment and the UI helper comment inherit Finding 1's false absence/variation equivalence. “A member fact is not the target” in lookup comments should be read conditionally: a ratio base is both a member and its target's identity. The endpoint correctly tries direct resolution first.

### PR body, sentence groups

Line numbers here are those of `inputs/pr/pr-body-67e6d0b.md`. “Supported” means inspected source supports the mechanism, not that I witnessed the cloud session execute historical commands.

| Lines | Mechanism assertion(s) | Assessment |
| --- | --- | --- |
| 3, 11 | 132 FSA targets; measure categories hold 14 country + 51 state; old first-row level behavior | Fixture and tests confirm counts. No `2306113` source snapshot is supplied to reopen exact old line claims. Current comparison sorts by absolute fit delta. |
| 12 | Both summaries return all levels in filter order, one/null/empty sentinels | Supported: shared `categoryLevels` and `microcosmTargetLevels`; ordering is lexical, caller-specific empty sentinel preserved. |
| 14-16 | Shared statistic key at picker/cards, VariableGroup.level unused, comparison level lacks UI reader | Supplied call sites use the shared helper and `levels`; no supplied UI reader of comparison level found. `lib/microcosm/statistic-groups.ts` itself is omitted, so its implementation and full-repository negative-reader claims cannot be independently established. |
| 17 | FSA/census test expectations | Source supports; all 13 FSA tests pass in both isolated versions (Check 6). |
| 21-23 | Source/Level labels, release label/fallback, unchanged raw option ids | Current helper/view/map code supports this, including `ED · Federal Student Aid`. Exact pre-PR 230 source absent. Source-label citation is indeed `microcosm-targets-view.tsx:278` now, `:291` at 43. |
| 27-29 | Counts previously ignored as strings; stringification/count reader/fixture counts | Producer and current reader support it. Baseline already contains this earlier PR fix; no old230 reader supplied. Counts 1/2/missing are fixture/test-verifiable. “Targets page rows” means API fields; there is no count column in the supplied page. |
| 33-36 | Representative, member metadata, identity-size preservation/nulling, hierarchy group-by | Member/identity implementation supported by Check 2. Generic last-operand and any-shown-field lookup claims need Findings 2/3. Positive hierarchy check is useful; absence does not imply variation (Finding 1). |
| 37 | Raw fields retained for renamed fact-key comparison, test checks this | Supported: shownChronicle returns a copy; matching reads raw Chronicle. Existing FSA test checks renamed comparison. |
| 38 | Single-fact rows unchanged/no members; abandoned approach changed fifteen outputs | Guard returns original Chronicle. Fifteen abandoned-output changes are historical and cannot be reproduced from final trees. |
| 39 | Members reach both APIs but no page component reads them/investigation | Both response paths verified. No production reader found in supplied components; full-repository absence is limited by partial inputs. |
| 40-41 | Dimensions and Source tooltip before/after; ratio tooltip record | 43 helper returns `All` for FSA aggregate. Head appends combined-values phrase; tooltip at `:176` falls back to target name. Exact lowercase behavior of `titleFromIdentifier` cannot be rerun: `components/shared/format.ts` is omitted. No casing defect is inferred. Exact230 rendering is also unavailable. |
| 42 | New test “covers each operation” | Four constructed operations only: scaled, rolled, allocated, linear. Not all 15: Finding 3. |
| 46 | Release gate counts skipped targets/CD exception; fixture docstring/rebuild/hash | Current docstring and claimed hash are present; hash recomputes exactly. `tools/build_us_fiscal_refresh_release.py`, `matrix.py`, and the remaining fixture SOURCES are absent. Cannot verify gate lines `:9389-9399` or rerun the full fifteen-source builder offline. These are unverified, not accepted on citation alone. |
| 50-53 | Facet >1-value rule; location repeats geography; narrow equality suppression; URL filter preserved; map analogy | Supported by reader, fixture and existing tests. Map suppresses locally single-valued tiers; it is an analogy, not an identical algorithm. Historical abandoned Belgium failure is not freshly reproducible. |
| 57 | Every behavior test first, fixes touch no tests | Old/head results corroborate failure subsets; intermediate commits unavailable. Exact chronology/no-test-fix-diff claim cannot be independently proved. |
| 59-66 | Previous blocker, operation-specific metadata, ratio searches/lookups, varying dimensions, universe strategy | Supported with Check 2 allocation proof; Check 3 corrects hierarchy converse. Unknown/missing metadata conservatively keeps nulling. |
| 67 | true/false/null variation states and Dimensions/default wording, unchanged move | Describes current implementation, but `true` meaning is wrong for Finding 1. `All` is used only if there are no displayed dimensions/group values. Move otherwise preserves original helper. |
| 68-71 | Conditional member lookup, CGT reuse, packet prints detail, workflow retry | Supported; Check 5 probes resolution. Cloud local-server execution remains a historical assertion, not a fresh run here. |
| 72 | Four invalid strings, mutants, seven scoped properties and exports | Strings and all three mutant kills reproduced. Properties statically audited; missing fast-check prevents execution. Four new exports confirmed. |
| 73 | Citation corrections | Current file/function/source-label/tooltip/Dimensions locations verified. |
| 74 | Earlier item4 test-first distinction | Supplied old review logs substantiate the stated failure locations (Check 6). |
| 78-85 | Suite counts and additions | Arithmetic consistent: +14 package, +19 frontend. Full counts/typechecks not rerun under constraints. |
| 89-90 | Debt-size order prerequisite; Chronicle has no FSA webpage | No value-order metadata in supplied fixture. General upstream prerequisite/live website state cannot be established from these local inputs; no network used. |
| 91-93 | Detail UI lacks keys; universe always null for several; filters/dimension_set_key stay representative | Supported. Original members' universe equality is not available from aggregate metadata; See Check 4. Fixture aggregate representative filters are empty. |
| 94 | Schema6 always uses representative metadata dimensions | Correct for the FSA-like filter-null case, but too broad: recognized legacy filter decomposition takes precedence. Check 3 demonstrates both paths. |
| 95 | Nonrepresentative record-id lookup limitation; member key/id fallback | Supported absent accidental name/key collisions or members without fact keys. Release lacks a general other-member id-to-key map. |
| 96 | targetNames still uses representative id for calibration status | Supported and unchanged. |

### Hand-off mechanism sentences

Locations refer to `inputs/pr/handoff-6968-6634998289.md`.

| Sentence group | Assessment |
| --- | --- |
| Items 1-2 | Operation/field behavior is implemented as described, with singleton/first-base wording qualifications (Finding 3) and the substantive hierarchy-converse bug (Finding 1). The requested lowercase label is asserted by tests; missing formatter prevents independent exact rendering. |
| Item 3 | available:false/member_of/detail and conditional workflow retry are correct. Packet script already prints the supplied detail. |
| Item 4 | Four invalid strings rejected; three mutations killed here. Property seed 277 and 20,000 runs present in code; fast-check runs unavailable locally. |
| Items 5-6 | Current sort/file/source-label/tooltip/cell citations and closing body footer verified. Checking cited lines does not prove the incorrect hierarchy converse. API-only member metadata agrees with supplied component reads. |
| Test-first/count paragraphs | Corroborated only to extent in Check 6; no intermediate commit trees or independently repeated full CI. |
| Judgment: group-by evidence | Correct that varying dimensions omits layout/constraints and hierarchy uses identity facts. Incorrect to treat absence as proving differing values. |
| Judgment: universe | Constraint rows are in `_selector_period_invariant_key:5039-5063`. Compiler re-resolves monthly windows/count×mean and allocations at `:877-886`, not every operation. No universal common-universe target summary: null is conservative. |
| Judgment: calendar-year ratio | Two annual periods per series required; window-member metadata lists them. |
| Judgment: unknown/missing metadata | Dashboard defaults several for valid multi-member rows; scaled operation independently returns true. Correct. |
| Judgment: no key cross-check | Valid rolled and allocated producers guarantee first-base representative membership; receipt equivalence proven in Check 2. Correct. |
| Judgment: new field/wording/type field | Only multi-member rows get three fields. Appending after dimensions and identifier-leaf use verified. `true` semantics defective per Finding 1; type-only change itself has no runtime effect. Commit placement not independently verifiable. |
| Judgment: member_of | Correct for a not-found target query. Missing-query error is separate and has no member_of. Listed keys/representative ids matched, names comma-separated. |
| Judgment: packet/README | Script behavior verified and unchanged. README is not supplied, so route-table description claim cannot be reopened. |
| Judgment: exports/properties | Four public exports verified. Seed/run counts verified statically; under-one-second cloud runtime not independently checked. |
| Judgment: schema6 | FSA-like metadata path confirmed; blanket wording misses filter-decomposition precedence. |
| Judgment: body corrections | Four fact keys + record id is correct. Old capitalisation claim cannot be established with missing old230/formatter source. |

Other hand-off sentences concern branch/session/push/body-edit actions, not mechanisms. They remain supplied history; I did not make external requests to verify them. Detailed source inventory and sentence-by-sentence group notes are retained in `work/claims/report.md`; the resolved allocation/hierarchy conclusions here supersede its pending cross-references.

## 2. Identity size, operation by operation

Commands:

```text
python3 -I work/identity/probe.py > work/identity/probe.log 2>&1
```

Exit 0. The script executes the supplied module's unchanged operation/resolver code via its AST, removing unavailable Microcosm imports and substituting output/model types. It observes identity inputs to hierarchy construction; it is not a full installed Microcosm test. Output lists all 15 allowed operations; six allocation cases report matching receipt-base/identity keys, including reused growth/base atoms, and two extra matching-growth attempts are rejected. The last case prints `successful mixed-period linear tuple; representative is not last: newer-first identity: ('newer-first', 'older-last')`.

`shownChronicle:606-608` first returns raw Chronicle if member count is absent or <=1. The producer only writes member metadata for a tuple with more than one member (`:1318-1327`). Therefore the switch's default applies to actual multi-member tuples, not all invocations of those operations.

| Operation | Facts tuple and identity | Dashboard cardinality result | Representative belongs? |
| --- | --- | --- | --- |
| `identity` | One fact; >1 forbidden at `:887-892` | Early exit, no member fields | Yes, sole fact |
| `scaled_by_ratio` | base, numerator, denominator (`:3534-3587`); identity representative alone (`:1021-1023`) | One; preserves fields | Yes, base `facts[0]` |
| `rolled_forward_by_ratio` | Nonempty bases, numerator, denominator (`:3299-3357`); identity `facts[:-2]` | `ledger_value_base_cells == 1`, exactly base count written at `:1174-1178` | Yes, first base |
| `allocated_residual_by_ratio` | Deduplicated selected bases, partition atoms, total, optional growth; identity all selector matches | Receipt base length ==1; equality proved below | Yes, first selected base |
| `calendar_year_window_scaled_by_ratio` | Window followed by operand groups (`:4256-4304`); identity window (`:1032-1033`) | Default several; two years for each series (`:4331`, `:4362`, `:4414-4428`) | Yes, representative explicitly selected from window |
| `linear_combination` | All resolved weighted operand members (`:3692-3767`); all are identity | Default several for >1, early exit singleton | Yes |
| `sum` | Selected cells at chosen latest period (`:2146-2183`); identity all | Same | Yes |
| `difference` | Minuend/subtrahend (`:2186-2242`); identity both | Default several | Yes |
| `count_x_mean` | Count and mean (`:4566-4617`); identity both | Default several | Yes |
| `calendar_year_average` | Monthly series in year (`:3988-4007`); identity all | Default several, early exit singleton | Yes |
| `latest_plateau` | Trailing plateau facts (`:4542-4563`); identity all, despite value using last | Default several, early exit singleton | Yes |
| `calendar_year_window` | Two years per selected series (`:4307-4428`); identity all | Default several | Yes |
| `monthly_window_average` | Exact declared month/cell grid (`:3909-3985`); identity all | Default several, early exit one-month/one-cell | Yes |
| `monthly_window_sum_average` | Same grid; identity all | Same | Yes |
| `monthly_window_count_x_mean` | Count and mean for each month (`:2405-2474`); identity all | Default several, at least two | Yes |

Thus the operations reaching default as multi-fact targets are the calendar-year ratio and the ten ordinary aggregating operations listed after it. `identity` is in the switch default syntactically but cannot produce a normal multi-member target. Each default classification is correct. The representative for ordinary operations is chosen from their entire identity by definition (`:1245`); for calendar-year ratio it is chosen from the window; for the three base operations it is first base. No size/membership bug found in the new classifier.

**Allocation proof:** compilation unconditionally calls `_resolve_allocation_reference_facts(reference,facts)` with no preselected `base_matches` (`:883-886`). That decisive call computes base by filtering **every input fact** with the same selector (`:2932-2940`), requires the declared base count and that all base keys be partition-atom keys (`:2942-2949`), then orders selected bases first, atoms, total, growth (`:2993-2998`). It deduplicates by fact key, refuses nonidentical reused keys and returns the tuple (`:3003-3011`). Every later identity match was consequently already a selected atom, and every selected atom remains in the returned tuple. The version-2 receipt filters atoms by that selector (`:3069-3071`); version 1 does the same (`:3145-3149`, serialized at `:3188-3189`). Hence receipt base equals identity. A distinct matching growth fact fails; reusing an identical base atom as growth adds no identity member. Even an internal preselected-base bypass is rejected by the final compiler's second resolution. The total is not an additional matching atom; its dimension set must be a strict subset of atomic dimensions (`:2800-2805`).

`allocationBaseCellCount` correctly accepts the producer's JSON string receipt; its weaker validation of array contents is immaterial for valid emitted receipts. Missing/malformed base metadata conservatively stays several. As an upstream integrity limit, arbitrary reference metadata is merged last (`:1094`, `:5388-5390`) and could overwrite computed receipt/count fields. No supplied reference does that; the proof concerns the producer's computed fields, not forged overrides.

## 3. Group-by across the identity

Commands and outputs:

```text
python3 -I work/root/audit.py > work/root/audit.log 2>&1
python3 -I work/identity/hierarchy_probe.py > work/identity/hierarchy_probe.log 2>&1
BUN_INSTALL_CACHE_DIR="$PWD/work/root/bun-cache" ~/.bun/bin/bun test ./work/root/hierarchy-probe.test.ts
BUN_INSTALL_CACHE_DIR="$PWD/work/root/bun-cache" ~/.bun/bin/bun test --preload ./work/tests/deny-network.ts ./work/root/mixed-storage.test.ts
BUN_INSTALL_CACHE_DIR="$PWD/work/root/bun-cache" ~/.bun/bin/bun test --preload ./work/tests/deny-network.ts ./work/root/legacy-probe.test.ts
```

Logs are respectively `audit.log`, `hierarchy_probe.log`, `hierarchy-probe.log`, `mixed-storage.log`, `legacy-probe.log`. Audit prints schema **8**, **132** targets, **131** single-fact, **1** multi-fact, **131** exact single-fact hierarchy/group-by matches. Aggregate prints count **5**, dimensions `[]`, varying-dimension metadata absent (`null` in audit). This confirms the hub's observation. Fixture hash is `037d28028b28b865eb0bacd09bb81285ff7b18e442bcf5e27ec762ae1008459b`.

Ordinary shared/differing/whitespace hierarchy probes: **10 pass, 0 fail, 33 assertions**. They copy the actual pure Chronicle helper functions verbatim and use the unchanged hierarchy reader from the copied package; no external dependency is present. An initial incomplete extraction omitted asObject and failed before useful assertions; its raw failure is retained separately as `hierarchy-probe-incomplete-extraction.log`, then corrected. Producer mixed-storage compilation exits 0; the dashboard regression gives **1 pass, 1 fail**, intentionally demonstrating Finding 1 on head. Legacy probes give **2 pass, 0 fail, 4 assertions**.

`_inherited_dimensions` first uses `_common_dimensions` over raw ordinary dimensions, and separately adds a layout group-by when `_constant_text` finds a common nonempty pair. It does **not** establish the requested iff over semantic dimensions: mixed storage can omit a shared value. It can also list a common ordinary value despite nonconstant/missing literal layout pairs. See Finding 1. For complete, consistent same-form layout pairs, it does list exactly the common pair.

The dashboard's **comparison itself is correct**: `readHierarchyTarget` maps hierarchy `id` to `target_dimensions[].key`, and `value_id` to `value_id`. The reader trims both (`hierarchy-target-reader.ts:89-121`); `hierarchyListsGroupBy:545-551` trims raw metadata key/value before comparing. Microcosm `_ledger_metadata:5903-5904` writes raw layout strings, while `_constant_text:1649-1651` trims hierarchy values. Thus surrounding whitespace agrees; label-vs-id, case-folding and value-vs-value_id are not confused. It preserves the raw metadata value on successful match. The error is interpreting absence, not matching ids.

Current behavior:

| Kind | Shown `layout_groupby_value_varies` / group-by | Dimensions cell |
| --- | --- | --- |
| Single actual member | Field absent; original group-by retained | Hierarchy/adapter dimension labels; fallback humanized group value, then All |
| Multi-member but one-fact identity | false if group-by exists, null if absent; representative value retained, even without hierarchy | Identity hierarchy dimensions or existing adapter values; no combines phrase |
| Several-fact identity, hierarchy lists pair | false; value retained; record/keys/universe null | Shared dimension values |
| Several-fact identity, hierarchy omits pair | true; value null | Shared dimensions followed by `Combines several <identifier leaf> values`; accurate for FSA, false for mixed-storage witness |
| Several-fact identity, no group-by pair | null; no usable group-by | Existing dimensions, else All |
| Several-fact identity, schema7/6 without hierarchy | null; shown group-by null | Existing structured/legacy target_dimensions still display; not cleared by shownChronicle |

For the fixture's schema8 FSA aggregate the requested phrase is “Combines several loan type values”; for Parent PLUS the hierarchy supplies `Parent PLUS`; for Alabama it supplies `Alabama`. The omitted shared formatter prevents independently executing the exact casing of the new identifier phrase. The test expectation and hand-off request lowercase; no unsupported claim that it renders title case is made here.

For a schema6 copy of the FSA aggregate with hierarchy removed and filter null, the probe prints `dimension_adapter:"legacy_name"`, `target_dimensions:[{value:"stafford unsubsidized",...}]`, shown group-by null and varies null. The UI returns that dimension text. This disclosed preexisting limitation remains. The body/hand-off's blanket metadataDimensions explanation needs qualification: a recognized filter such as `cell_be2_female_18_64` selects `legacy_filter` first (`latest-artifact.ts:1239-1282`), and the second probe displays `Female · 18–64` instead. Schema6 fields do not universally come from representative metadata.

## 4. Universe constraint

Command: `python3 -I work/root/audit.py > work/root/audit.log 2>&1`; relevant raw reads in `work/root/source-excerpts.log` include `ledger_targets.py:5039-5063`, `:5853-5921`, member metadata and hierarchy construction. Output shows identical hierarchy dimensions for facts sharing universe key `u` and facts with keys `u`/`v`.

Microcosm stamps **only the representative's** `universe_constraint_set_key` (`:5865-5867`) and its nonempty constraint-row count (`:5911-5913`). Member metadata contains count, member keys, digest and varying ordinary dimensions (`:1318-1341`), not member universe keys/counts or a shared-universe assertion. Hierarchy dimensions do not include the constraint rows. Allocation receipts do not supply the complete member universe sets either. A shared dimension/hierarchy says nothing sufficient about them.

Some resolvers compare constraint rows as part of one-series identity (`:5039-5063`), so calendar-year/monthly series can share constraints. That is not a universal released-target summary: target_spec accepts pre-resolved tuples for several operations and does not rerun every resolver (`:877-886`). Count equality alone would not establish set equality, and operation names do not prove identical arbitrary universe-set keys. Therefore always nulling the set key/count for a several-fact identity is conservative and correct with these published fields. It loses valid common constraints in some cases, as disclosed. A one-fact identity correctly keeps its representative universe, including string-parsed counts. The original five FSA operand constraint payloads are not supplied, so their asserted pairwise differences are not independently established here; null remains justified without them.

## 5. Member-fact lookups

Commands:

```text
python3 -I work/claims/extract_lookup.py
BUN_INSTALL_CACHE_DIR="$PWD/work/claims/bun-cache" ~/.bun/bin/bun test ./work/claims/lookup.test.ts
BUN_INSTALL_CACHE_DIR="$PWD/work/claims/bun-cache" ~/.bun/bin/bun test ./work/claims/lookup.test.ts --test-name-pattern 'group-by'
```

The extractor prints that lookup functions are unchanged and successful packet construction is stubbed to the target name. First lookup run: **2 pass, 0 fail, 34 assertions**, checking ten member/representative identifiers and both own names (`extracted-lookup.log`). Targeted unsupported-key run: **1 pass, 2 filtered, 0 fail, 5 assertions** (`unsupported-lookups.log`). These are local exact-function probes, not unmodified package runs. An initial unmodified import attempt stopped at missing @vercel/blob (`lookup.log`); no fetch/install followed. The isolated original member-lookup test also fails on base/passes head (Check 6).

| Query | Actual result |
| --- | --- |
| Any aggregate member's string listed in `ledger_member_fact_keys` | If no direct target resolves, available:false, member_of contains every matching multi-member row; detail names them |
| Several-fact identity's representative record id or any of four representative keys | Same membership advice via raw row.chronicle, although shown fields are null |
| One-fact identity's own record id/keys (including ratio base) | Direct success; member_of not returned |
| Target name or base_name | Direct success, regardless of null shown fact identity |
| A key both naming a direct target and appearing as another's member | First direct target wins; membership advice only runs after no direct match. This matches the body's conditional wording |
| Unlisted/unknown key | available:false, member_of:[], unchanged not-found detail |
| Nonrepresentative member record id | Generally cannot link unless it is itself the listed fallback key or another accepted target key/name; release lacks mapping for arbitrary member ids |
| Group-by value/universe key | Not accepted lookup fields: Finding 2 |

`listsMemberFact:3370-3383` requires a nonempty shown member list, tries its strings then the five raw representative identifiers. Producer multi-member lists are nonempty; invalid/empty metadata is not a valid emitted case. It uses all four fact-key fields plus record id, not just aggregate_fact_key. For schema8 labels member_of uses producer target_label; legacy labels can be null, but actual names are still supplied. A missing target parameter has its separate error without member_of.

The workflow paragraph is correctly conditional on a membership error: retry with an own target name from that list and explain the choice. It does not interrupt successful ratio-base resolution. `microcosm-investigation-packet.mjs:85-86` already throws payload.detail for unavailable answers, and its handler prints it, so the target names survive without a script change. I inspected this code; the cloud session's exact local-server exercise is historical evidence, not repeated here.

`generate_uk_target_references.py:1117-1119` explicitly states the twelve Table5 regional cells are restated on an individuals basis by the Table1 share. This validates the shared-member motivation. It is a rationale entry; it is not evidence from a freshly generated twelve-target roster. Scaled base facts can themselves still be direct target identities.

## 6. Tests, red/green claims and properties

No dependencies were installed. Bun is **1.3.12**, not the hand-off's 1.4.4. Package copies and Bun cache are inside `work/`. Exact changed data tests import latest-artifact, whose transitive calibration-release-locator import reaches missing `@vercel/blob`; properties also require missing `fast-check`. Frontend formatter/statistic helper sources and full alias setup are omitted. These limitations prevent an unmodified full frontend/package run, typecheck, lint and Next build.

Commands and actual output summaries:

| Command | Printed result / raw evidence |
| --- | --- |
| `python3 -I work/tests/import_graph.py` | Selects only unchanged local/node/bun dependency graphs: **166 pass, 0 fail, 18 files, 645 assertions on each version**. `work/tests/{base,head}-eligible.log`; exclusions recorded in `*-test-selection.json` |
| `python3 -I work/tests/run_isolated.py` | Head original test assertions on base/head code: identity **1 pass/7 fail → 8 pass/0 fail**; new invalid-count **1/0 → 1/0**; FSA **13/0 → 13/0**. `*-isolated.log` |
| `python3 -I work/tests/count_mutants.py` | All three formerly surviving count mutations now exit 1, **0 pass/1 fail** each. `count-mutant-accept-{fraction,negative,space}.log` |
| `BUN_INSTALL_CACHE_DIR="$PWD/work/root/bun-cache" ~/.bun/bin/bun test --preload ./work/tests/deny-network.ts ./work/root/export-probe.test.ts` | **1 pass/0 fail**, prints the four new helper exports |

The isolated copies change **one unrelated I/O boundary**: `calibration-release-locator.ts`'s `readCalibrationTreeManifest` import is replaced with a local function that throws if called. The tested shaping/lookup paths never call it. A preload also forbids fetch. Neither assertions nor tested logic are edited. These are explicitly isolated tests, not claimed CI reproductions. A preliminary export inventory also used `bun run --no-install work/tests/export-delta.ts`; it imports only the same isolated local modules, and the final export check above runs as bun:test. No dependency fetch was involved.

### Every added or changed test

| Test at head | 43 code vs 67 code | Weakness / plausible wrong implementation it permits |
| --- | --- | --- |
| multi-fact `:145`, scaled case | Fail → pass, executed | Handcrafted coherent metadata; no other selector or ambiguous target |
| multi-fact `:145`, rolled one-base case | Fail → pass, executed | Count trusted; no independent producer membership oracle |
| multi-fact `:191`, ratio operand dimensions vary | Fail → pass, executed | Only proves operand varying dimensions must not null scaled base |
| multi-fact `:207`, rolled two-base cases | Fail → pass, executed | Only clean counts 2/complete hierarchy; no unknown metadata |
| multi-fact `:254`, allocation one/two | Fail → pass, executed | Assumes receipt length is identity size; no actual selectors/labelled total/growth. Check 2 supplies missing independent proof |
| multi-fact `:293`, varies flag | Fail → pass, executed | Fixtures with exact clean pair or omission; a wrong implementation treating all omission as variation **passes**, as current Finding 1 demonstrates |
| multi-fact `:351`, member lookup | Fail → pass, executed | No ambiguous direct target/member key beyond explicit ratio base; no malformed member list |
| multi-fact `:416`, FSA combination | Pass → pass, executed | Preserves fixture-specific behavior; no default-operation completeness proof |
| latest-artifact `:1259`, four invalid counts | Pass → pass, executed | Coverage-only; each of three old surviving mutants is now killed |
| ed-fsa `:686`, sort citation | Comment-only; 13 FSA tests pass both | Adds no behavioral coverage |
| target-row-labels `:40`, combined wording | Static: moved old helper returns All, head builds expected phrase | Cannot run exact test with missing formatter/aliases. Hardcoded loan-type wording would pass |
| target-row-labels `:53`, shared dimensions first | Static: old returns Female, head appends phrase | Cannot run exact test; wrong hierarchy classification still passes |
| target-row-labels `:67`, All/none and visible group fallback | Static: already passes old helper (formatter caveat); head unchanged branches | Does not establish variation flag correctness |
| latest-artifact-invariants, five properties | Not run; expected pass both when old private helpers are exposed for the test | Original head imports fail on old due missing export modifiers; runtime helper implementations themselves are unchanged |
| statistic-groups, two added properties (diff) | Not run; equivalent old scoped review tests/same unchanged implementation support pass both | Source module omitted, fast-check absent; cannot independently execute |

The identity suite tests only scaled, rolled, allocated and linear operations, not all defaults or calendar-year ratio. The FSA baseline test would fail against simply returning raw Chronicle, so even its pass-before/pass-after case is useful. All new properties have predicates that can fail, but their passing does not imply complete correctness.

### Each fast-check property's scope and ability to fail

All specify seed 277, 20,000 runs. No property is made automatically true by fc.pre. These were statically audited, not run without fast-check.

| Property | Real scope / comment assessment | Failure witness; plausible escape |
| --- | --- | --- |
| Count output shape | Arbitrary stated union; null or safe nonnegative integer. `-0` accepted by predicate/JSON as comment explains | Accept -1 or 2.5 fails. Always-null passes this one, companion catches it |
| Count roundtrip | Safe nonnegative integers and decimal String(n); no alternative textual-format guarantee | Reject 0 or '0' fails. Accepting invalid forms too can pass |
| Category shape, none='' | Up to 8 rows with short strings/nullish/-2..2 levels; sorts/uniqueness/nonempty returned levels, scalar-null equivalence | Unsorted country/state or duplicate outputs fail. Always `{levels:[],level:none}` passes because input correspondence is not checked |
| Category shape, none=null | Same; explicitly skips null equivalence on empty returned levels, as comment states | Same failure witnesses and always-empty escape |
| Facet/repeated geography | Up to 10 rows, five geography names, 3 keys/levels, deduplicated dim keys; only >1 nonempty values require a facet | Hide Geography with two states, or Sex merely for one-per-geography, fails. Always showing redundant dimensions can pass the computeDimensions assertions |
| Statistic single-level compatibility | Coherent `levels=[level]` or `[]`, arbitrary short source/level/variable including delimiter tokens | Change delimiter or omit source fails. Always use scalar level passes; no multi-level guarantee claimed |
| Statistic one-category compatibility | 1..6 rows; <=1 distinct nonempty level; first row must carry level unless no row does. Comment names excluded empty-first case | Change delimiter/scalar representation fails. Ignoring levels array passes admitted cases |

The scopes/comments mostly describe partial invariants accurately. “Every single-level row” means the generated coherent representation, not contradictory level/levels values. Category title's null-iff is subject to its adjacent explicit none=null exception. Strengthening category properties to compare against sorted unique **input** levels would kill the always-empty mutant. Existing FSA examples provide separate positive coverage. The facet property's caption covers what must not be hidden; it is not a complete redundancy-suppression property.

### Hand-off's test-first record

- Initial identity subset has six cases: the two one-fact identities, ratio-varying dimensions, rolled two-base, allocation, FSA. Our transplanted head assertions on old code reproduce **five failures and FSA pass** for that subset. Complete head suite adds varies/member cases, giving seven failures overall on base.
- “3 fail” for the Dimensions test stage is consistent with two changed UI expectations plus the new variation-flag test. The third UI test preserves All and already passes the old helper. It would be wrong to say all three UI cases fail first; the hand-off does not explicitly say that.
- The new member lookup test fails before/passes after, matching “1 fails.” Count negatives pass before/after by design; no red commit needed for coverage-only properties.
- Supplied earlier review logs confirm old item4: original 6843fe0 test fails at `:809` on `[undefined,undefined]` vs expected `[null,[]]`, including against a5e604e code. The final a5e604e test on pre-fix code fails at aggregate assertion `:829`; final a5e604e suite passes 13. The corrected history explanation is accurate.
- Intermediate ten-commit trees are not available here, so exact historical chronology, amended local test trees and “fix touches no tests” cannot be replayed. Old/head execution and supplied prior logs corroborate the meaningful failure claims, not every historical action.
- Test-count arithmetic is correct: package +14 = 8 identity +5 properties +1 count; frontend +19 = those +3 labels +2 statistic properties. Reported full 413→427 and 869→888 counts remain supplied CI/cloud evidence, not local reproductions.

## 7. Fresh read and remaining limits

Commands include `rg '^diff --git' inputs/pr/diff-43c62d2-67e6d0b.diff` (prints eleven changed paths), the Check 5 lookup command (prints informational synthetic timing plus passing assertions), and `bun test --preload ./work/tests/deny-network.ts ./work/root/export-probe.test.ts` with the work-local cache (prints the four added names and **1 pass, 0 fail**). Their raw evidence is in `work/claims/extracted-lookup.log` and `work/root/export-probe.log`. Final `python3 -I work/root/validate_report.py` prints all seven sections, `INPUT_DIFF_EXIT: 0`, only untracked `out.md`/`work/`, and `REPORT_VALIDATION: pass` in `work/root/final-state.log`.

I read all eleven changed paths/hunks, not just the identity helper. No workflow, manifest or lockfile change is in the delta. The supplied head CI runs unfiltered frontend bun test after frozen dependency installation, and lint/typechecks/build; this review did not weaken or reconfigure it. Full CI, typechecks, Next build, hosted Python and Vercel cannot be independently rerun with missing dependencies and the no-install/no-network constraint.

Lookup now performs a second full scan only after direct resolution fails. Each pass reparses member lists, and allocation cases can parse receipts. It remains linear in rows/total parsed member payload, not a new quadratic lookup. The intentionally extreme 100,000-all-aggregate extraction probe took roughly 0.84s head vs 0.13s base on its final run, with substantial JIT/timing variability; it does not establish a production performance issue. FSA has 132 targets and only one aggregate. No evidence-backed performance blocker is claimed. Caching parsed metadata would be a possible later optimization.

The helper move retains existing formatting behavior aside from the new variation branch. No exact casing bug is proven because the shared formatter is absent. The new API boolean and phrase do, however, misdescribe the accepted mixed-storage target independently of casing. Schema6's representative-dimension display, representative filters/dimension_set_key, and status targetNames behavior are unchanged limitations; filter-decomposition precedence is more nuanced than the prose acknowledges.

Public export check command/result is in Check 6. Raw logs and scripts are entirely in `work/`; detailed supporting reports are `work/identity/report.md`, `work/identity/hierarchy-report.md`, `work/tests/report.md`, `work/claims/report.md`. They are supporting evidence, not changes to the reviewed dashboard. No file under inputs was edited. The deliverable is this verdict and its evidence; nothing was committed, pushed or published.
