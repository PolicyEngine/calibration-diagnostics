# Mechanism and PR prose audit

No network, installs, commits, pushes, or input edits. Ran `python3 -I work/prose/audit_citations.py > work/prose/citations.log`, `python3 -I work/prose/layout_override_probe.py > work/prose/layout_override_probe.log`, `python3 -I work/prose/fixture_reader_audit.py > work/prose/fixture-and-reader-audit.log`, `python3 -I work/prose/compare_probes.py > work/prose/probe-comparison.log`, and `python3 -I work/prose/claim_inventory.py > work/prose/claim-inventory.log`. The last output has 686 lines, pairing each body/hand-off sentence with its line's assessment below (or identifying non-mechanism logistics).

## Corrections worth carrying to the review

1. PR body line 67's blanket “Each change of behavior landed as a failing test commit, then a fix commit that touches no test. Replaying each commit's tests at that commit shows every test commit failing only the tests it names, and every fix commit passing them” contradicts its own line 86: `a5e604e` changed the test, and the test at `6843fe0` still fails against the fix. Scope the blanket claim to this review round, or state the exception. This is prose, P3.
2. Hand-off line 31 says “each one sums several facts.” The `true` field also covers rolled-forward ratios with several base cells, allocations, calendar-window ratios, differences, count-times-mean, etc.; the operation list is in microcosm lines 96-111. Say “each one combines several facts.” The neutral UI phrase remains accurate for those operations. Prose, P3.
3. Three-value descriptions omit precedence: latest-artifact.ts:561-566; use-microcosm.ts:176-180; PR body:92; hand-off:6. The code returns null first if the representative has no complete pair; otherwise it returns false for a one-fact identity even with no hierarchy; only several-fact identities with no hierarchy return null. Hand-off:30 acknowledges the one-fact/no-hierarchy exception. Qualify the null/false clauses; no variation claim is implied by the implementation.
4. multi-fact-identity.test.ts:387-388 says the common ordinary A pair lists A “whatever their layouts say.” `_inherited_dimensions`:1583-1594 gives a constant layout pair priority. The real producer run with ordinary A in both facts and layout B in both prints hierarchy B. Such conflicting fact validity is open, as the hand-off already says about the existing third fixture, so this is a narrow comment issue (P3), not a demonstrated valid-release bug. Say “in these two cases” and name the layouts used.

## Every microcosm-citing comment in the delta

| Head location | Cited source opened | Assessment |
| --- | --- | --- |
| target-row-labels.test.ts:57-60 | Review `hierarchy_probe.py`; producer label validator and inheritance | Correct for the supplied mixed case; actual producer reproduced it. |
| latest-artifact.ts:219-221 (context of export removal) | registry.py:149-150 | Correct: TargetSpec stringifies every metadata value. |
| latest-artifact.ts:539-549 | ledger_targets.py:1096-1100; 1486-1490; 1578-1611; 1614-1623; 1649-1651 | All citations identify the claimed mechanism. Compiler passes identity facts; validator adds layout pair with setdefault; inheritance intersects ordinary dimensions and separately tests constant layout pair; mixed storage can disappear. |
| latest-artifact.ts:582-596 | ledger_targets.py:1085-1090; 1318-1341; 1018-1035; 1174; 4270-4272; 4331 | Correct. Metadata stamps representative and member fields; identity is representative/base subset/selected allocation base/window/all facts. Window weights are two years at :143-145. |
| latest-artifact.ts:597-601 | ledger_targets.py:1232-1245; 1012-1016 | Correct for successful compiler inputs: first fact for singleton; first base for the three named operations; otherwise latest-period, final tuple index breaks tie; window ratio passes only window facts to representative selection. Non-aggregating multi-fact operations fail at :887-891. |
| latest-artifact.ts:602-610 | Same producer metadata and dashboard code | Correct masking behavior; null/false precedence qualification noted above. Producer has no general shared-universe evidence field. |
| latest-artifact.ts:611-615 | ledger_targets.py:1323; 1626-1646 | Correct for these ordinary fact dimension values: scans all operands, reads only ordinary dimensions, missing values appear as null in JSON comparison. Unchanged internal Chronicle still supports comparison fact-key matching. |
| multi-fact-identity.test.ts:305-313 | ledger_targets.py:1578-1611 | Correct omission argument; “without a hierarchy cannot tell” concerns multi-fact identity. |
| multi-fact-identity.test.ts:379-388 | Review hierarchy probe; ledger_targets.py:1490 | All three supplied cases are accurately described. The final “whatever their layouts say” generalization needs qualification as above. |

## PR body mechanism sentences

Locations refer to `inputs/pr/pr-body-836fc66.md`. Multiple sentences on a line are assessed in order.

| Lines | Sentence-level assessment |
| --- | --- |
| 3 | 132 targets is verified; scope includes earlier work outside this three-commit delta; review history is input evidence, not a code mechanism. |
| 11 | Original-main line citations cannot be opened from supplied snapshots; 14 country + 51 state in each of two FSA measure categories is confirmed from fixture. Old level choice at main is historical; current package consistently sorts levels. |
| 13 | Both readers now use categoryLevels; non-empty levels sorted with microcosmTargetLevels; singular level/null behavior correct; empty category default differs by caller exactly as described (:1712, :3445). |
| 17 | Current key uses levels, joins by `+`, combines source/variable; single-level key unchanged. Main historical grouped-key citations unavailable. |
| 18 | VariableGroup uses levels; prior no-reader claim is historical but no remaining production reader of VariableGroup.level appears in supplied head. |
| 19 | No supplied UI reader of comparison variables[].level; API returns both via categoryLevels. |
| 21 | Test descriptions match source. |
| 25 | Main historical labels unavailable; current changed option helpers and tests match intended labels. |
| 27 | Each sentence matches target-filter-options.ts:14-39 and targets-view.tsx:278. Options retain raw values. Tests exist. |
| 31 | numberOrNull accepts only finite numbers; producer count is str(len(...)); registry stringifies metadata. Correct mechanism. Historical universal releases phrase assumes normal TargetSpec publication, as context supplies. |
| 33 | Safe non-negative integer reader accepts strings/numbers; public rows/investigation use it; malformed examples and fixture counts match tests (all multi-identity counts intentionally masked). Fixture debt 10K–20K metadata count is 2; no-state count omission observed. |
| 37 | Correct metadata representative (:1085-1090); FSA sum-like linear combination same-period representative is last operand (:1232-1245); old lookup behavior follows unmasked fields. |
| 39 | Correct complete member list (:1318-1341), ratio operands included; shownChronicle emits the three fields for >1 member. |
| 41 | Correct identity-preserving branches; lookup accepts name/base_name/record/four fact keys, does not accept layout value or universe constraint. |
| 42 | Correct masking; hierarchy pair is prerequisite for group-by shown on several-fact identity. |
| 43 | Raw row Chronicle retained; matching logic reads raw fact keys; renamed-row regression exists. |
| 44 | Single-fact shownChronicle early-returns untouched; fifteen historical snapshot changes are not independently reconstructible from supplied commits. |
| 46 | Only hook type declares member fields in production frontend outside package; no component displays them; script calls investigation, no page does in supplied components. |
| 48 | Current source phrase correct and Dimensions invokes helper at :201; 67e6d0b phrase visible in snapshot. 2306113/43c62d2 UI wordings not independently reconstructible. |
| 49 | Source title :176 chooses shown record id else name; masked FSA record yields name; identity-preserving ratio base keeps own record. |
| 51 | Tests build all four named operations. |
| 55 | Provided microcosm sources do not include tools/build_us_fiscal_refresh_release.py or matrix.py, nor all fifteen producer source files; cannot independently verify those source claims/rebuild. Existing fixture hash exactly matches quoted `037d2802...8459b`. No new delta changes this docstring. |
| 59 | computeDimensions scans dimensions; fixture state locations match own geography and 51 states; old comparison to main cannot be opened. |
| 61 | New/current geography repeat rule matches computeDimensions/repeatsGeography; map hierarchyPartitions elides one-value tier at :601-610; URL filtering still uses rows independent of listed facets. |
| 63 | Belgium test source matches intended narrower rule; mixed-category test assertions match descriptions. Historical failed broader implementation unavailable. |
| 67 | Blanket test-first claims contradict line 86; see correction above. Current round's concrete test-first record is another agent's test audit. |
| 71-76 | Identity operation branches match producer :1018-1035; base-cell count :1174; allocation fact_keys.base :3069-3071/:3188-3189; window both years :4270-4272/:4331, weights :143-145; “several for multi-member inputs” is correct. Historical 43c62d2 lookup failure unavailable directly but earlier review supplies it. |
| 78 | First-three representative sentence correct; latest/tie sentence correct, with window ratio selects from window (:1012-1016); varying dimension limitation correct; shown group-by only hierarchy on multi identity, universe always null, own-ratio record/fact lookup correct. |
| 79 | Historical move/failure story comes from previous review; current no-All statement is overbroad for no-pair identity or no hierarchy (covered by root review), while following FSA-specific explanation is correct. |
| 80 | Lookup miss member_of matches member list or raw representative record/fact keys; available remains false; detail includes names; CGT source :1117-1119 says exactly twelve-area restatement by one Table 1 share. |
| 81 | Script :85-86 prints unavailable detail; claimed local-server historical run not independently repeatable without that server. |
| 82 | Workflow source says to rerun packet for target named in membership error. |
| 84 | Examples catch fractional/negative/space mutants; generated test descriptions agree with source. Broader property outcomes delegated to test audit. |
| 85-86 | Earlier review provides citation/test-first history; line 86 qualifies line 67 and confirms exception. |
| 90 | All producer citations correct; actual compiler reproduced mixed target. |
| 91 | Listed evidence/omitted no-evidence distinction correct within ordinary valid facts; shown group-by branch matches. |
| 92 | Rename correct, no value asserts variation; false/null wording needs precedence qualification described above. |
| 93 | Neutral phrase matches dimensionSummary; FSA row-only change delegated to exhaustive root probe. No generic phrase when no representative pair is code's remaining issue. |
| 94 | Fixture matches first three old probe outputs projected to five named fields. Test uses ed_fsa.borrower_age_band. |
| 96 | Lookup sentence is now exact: candidate name/base_name plus shown record and four shown keys at :3336-3348, no group-by/universe lookup. |
| 97 | Narrowed representative statements correct; named four operations correct; legacy precedence correct :1250-1259, :1289-1293. |
| 98 | Four exports removed; properties use public APIs; statistic-group property obtains levels from public summary. Full reachability/test strength delegated to test audit. |
| 99 | Properties compare sorted unique non-empty levels and exact singular level; facets add suppression converse. Mutant/run outcomes delegated to test audit. |
| 110 | Added test counts from source are +1 package, +2 frontend; full-count validation unavailable without dependencies. Prior main/43c62d2 counts are supplied historical claims. |
| 116 | Supplied detail component has no record id/fact-key presentation. |
| 117 | shownChronicle nulls universe fields for multi identity; producer generic metadata only stamps representative universe info, not proof over every identity fact. |
| 118 | Correct: omitted shared group-by nulls; mixed fixture is witness. |
| 119 | Correct: mask does not remove filters/dimension_set_key. |
| 120 | Correct precedence: hierarchy, structured identity, recognized filter decomposition, then metadataDimensions. No hierarchy several-identity flag null, representative metadata can produce a misleading dimension. |
| 121 | Correct general limitation except a member record id can coincidentally equal a published member fact key; producer :1321 uses `_fact_key(fact) or _source_record_id(fact)`. Raw representative record is also matched. |
| 122 | targetNames still reads raw representative record; unchanged. |

## Hand-off mechanism sentences

| Line | Assessment |
| --- | --- |
| 6 | Rename/readers neutral phrase correct; three-value rule has precedence ambiguity; comments' source references correct; fixture first three targets exact; dedicated tests exist. FSA comparison/test counts delegated. |
| 7 | Exact accepted lookup fields :3336-3348; no new lookup code added. |
| 8 | Singleton / first-three ratio / latest tie / window representative claims all correct; body now scoped correctly; recognized filter precedence correct. |
| 9 | Four helpers no longer exported; properties public paths match code. Per-generated-input reachability delegated. |
| 10 | Strengthened expected-level comparison exists; mutant outcomes delegated. |
| 25 | Correction is correct: identity uses all facts for sum, but singleton sum has one member and shownChronicle early-returns; calendar window intrinsically requires two years per series, so this general multi-member qualification remains appropriate. |
| 30 | This correctly states one-fact pair may return false without hierarchy, explaining ambiguity in line 6/body/type comment. No-pair guard still wins. |
| 31 | Neutral phrase makes no dimension-variation claim and source cells is acceptable wording; “each one sums” is false for all marked operations. |
| 32 | Fixture projection confirmed; uk release matches tests; third conflicting-layout case's Chronicle validity remains explicitly open. |
| 33 | Public count tests do buildCalibration each run; no independent execution of fast-check possible without package. Source shape property rejects negative/fraction under mutants, accept-space remains a valid shape at 0; example catches it. |
| 34 | Public computeDimensions doesn't invoke repeatsGeography for geography; converse added as stated. |
| 35 | Comparison property uses first eight FSA rows, generated levels, one variable and compares release with itself. |
| 36 | Type-only declaration has no runtime effect; head removes old runtime field and type. Intermediate commit unavailable locally, so historical contents not independently opened. |

## PR style

No first-person pronouns, bold label leads, US-spelling violation, passive finite “is/are/was/were + past participle,” or “is above” comparisons found. The only naive I/we regex match is the command flag `python3 -I` (not a pronoun). `Review follow-ups` is present with this round's subsection; closing nonempty line is exactly `🤖 Generated with [Claude Code](https://claude.com/claude-code)`. Subjects generally name changes/readers; history/commit sentences support review traceability. No objective rule-breaking sentence identified, beyond factual wording corrections above. The opening `Follow-up to #276.` is a purposeful fragment, not a passive sentence.

## Raw results

`fixture-and-reader-audit.log`: fixture sha256 matches body; 132 FSA rows, two measure categories each 51 state + 14 country, two one-row country categories; production non-package member references only hook fields.

`probe-comparison.log`: `Reproduced first three original probe lines structurally equal: True`; `Fixture matches selected fields of original first three lines: True`.

`layout_override_probe.log`: original cases reproduce []/A/A; extra both ordinary A + both layout B case compiles hierarchy B. No assertion establishes Chronicle validity of conflicting input.
