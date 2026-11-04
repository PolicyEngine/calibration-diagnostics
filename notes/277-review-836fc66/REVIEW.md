67e6d0b..836fc66 — CHANGES NEEDED

## Findings, most severe first

1. **P2 — A combined target still reads “All” when its representative has no layout pair.** At `836fc66`, `frontend/components/microcosm/target-row-labels.ts:19` only recognizes `layout_groupby_unlisted_across_facts === true`; the fallback at `:25` treats null evidence as “All”. `latest-artifact.ts:572` correctly returns null when the representative carries no pair. This combination leaves the review's unresolved case misleading.

   Concrete producer-valid input: take the mixed-storage fixture's two 2024 GB facts, with values 20 each. One has ordinary dimensions `{loan_type:"a", sex:"female"}` and no layout pair; the other has ordinary `{sex:"male"}` and layout `loan_type=a`. Rename the first key from `a-explicit` to `z-explicit`. Microcosm's catalog sum resolver sorts the selected facts by key (`ledger_targets.py:2180-2183`), so the tuple is `[b-layout,z-explicit]`. Its compiler chooses `z-explicit`, emits no layout pair and no hierarchy dimensions, and sums to 40. Both facts describe loan type A. The public dashboard reader emits `layout_groupby_unlisted_across_facts:null`, and the actual Dimensions function returns **“All”**. Merely changing a fact identifier changes the page from the neutral combination phrase to “All”. Directly compiling the original tuple in reverse likewise chooses `a-explicit` and produces “All”; reversing catalog input alone does not, because the resolver sorts it.

   Smallest safe fix: carry the already computed distinction between a one-fact identity and a several-fact identity to the UI, and use “Combines several source cells” when a several-fact identity has no trustworthy displayed dimension/pair. Keep null for the missing group-by evidence. Do not use `member_fact_count > 1` alone: ratio operands increase membership without increasing identity size. Add the producer-derived no-pair regression and narrow the null-plus-five-members “All” expectation at `target-row-labels.test.ts:94`.

   Evidence: `work/null-pair/producer.log`, `null-pair.log`, and `no-false-all-regression.log`. The regression prints **expected “Combines several source cells”, received “All”**, **0 pass / 1 fail**. This fallback also existed at `67e6d0b`; it is an unresolved part of the target-description problem, not a newly introduced regression.

2. **P3 — The documented three-value rule needs its actual precedence.** `frontend/lib/api/hooks/use-microcosm.ts:176` and `frontend/packages/calibration-tree/src/latest-artifact.ts:561` say false for a one-fact identity and null for no hierarchy, without resolving the overlap. Concrete input: a pair-carrying `scaled_by_ratio` target in schema 6 has **false**, despite no hierarchy. Conversely, a one-fact ratio identity without a pair has **null**. Smallest fix: describe the ordered rule: no complete representative pair → null; otherwise one-fact identity or listed pair → false; otherwise hierarchy present → true; otherwise null. Apply the same qualification to PR body `:92` and hand-off `:6`. The hand-off's judgment at `:30` already acknowledges the first exception.

3. **P3 — The supplied PR body overstates its result and test-first history.** In `inputs/pr/pr-body-836fc66.md:79`, “The Dimensions column no longer reads ‘All’ for a target that combines several cells” fails on finding 1's concrete target. At `:67`, “Each change of behavior landed as a failing test commit, then a fix commit that touches no test” and “every fix commit passing them” conflict with the body's own `:86`: `a5e604e` changed the test, and the original `6843fe0` test still fails against the fix. Smallest fixes: scope the no-All sentence to the FSA balance, and scope the blanket test-first claim to this three-commit round or state the documented exception. These are claims in the supplied body for `836fc66`, not production source changes.

4. **P3 — Two hand-off claims overstate their mechanisms/counts.** `inputs/pr/handoff-6994-6639793646.md:31` says every target marked by the neutral phrase “sums several facts”. A several-base `rolled_forward_by_ratio` target marked true also applies a ratio; other supported operations subtract or multiply. Say “combines several facts”. At `:33`, “20,000 times each” misses the roundtrip property's second `shownCount` call (`latest-artifact-invariants.test.ts:97`): successful runs build **20,000 and 40,000** releases, respectively. Correct those counts. Neither issue makes the neutral phrase inaccurate or demonstrates a CI failure.

## Review environment and evidence boundaries

All source locations above and below refer to the supplied `836fc66` snapshot unless labeled otherwise. No network, installation, commit, push, GitHub write, or publication occurred. Scripts and raw logs are under `work/`; inputs remain unchanged. Available Bun is **1.3.12**, not the hand-off's 1.4.4. The GitNexus review skill was read; no GitNexus tool/index was available, so callers were checked with local searches.

Exact `latest-artifact` imports reach missing `@vercel/blob` through the release locator. The isolated package copies replace only that unrelated manifest-reading import with a local throw-if-called boundary; fetch is disabled by preload. The tested in-memory readers never invoke that boundary. The shared frontend formatter is also missing: the label-suite copy uses a documented formatter stand-in. The three new/changed neutral-wording assertions on head do not call it. The no-pair regression extracts the exact UI function and makes both unavailable formatter functions throw if reached; neither is reached. These runs establish the stated shaping/label behavior, not a reproduction of the complete CI environment.

## 1. Finding 1's fix and every field reader

Commands run from workspace root:

```sh
python3 -I work/review/audit.py > work/review/audit.log
python3 -I work/review/prepare_matrix.py > work/review/prepare-matrix.log
BUN_INSTALL_CACHE_DIR="$PWD/work/review/bun-cache" ~/.bun/bin/bun test --preload ./work/tests-properties/deny-network.ts ./work/review/matrix.test.ts > work/review/matrix.log 2>&1
python3 -I work/null-pair/producer.py > work/null-pair/producer.log 2>&1
BUN_INSTALL_CACHE_DIR="$PWD/work/null-pair/bun-cache" ~/.bun/bin/bun test --preload ./work/tests-properties/deny-network.ts ./work/null-pair/null-pair.test.ts > work/null-pair/null-pair.log 2>&1
BUN_INSTALL_CACHE_DIR="$PWD/work/null-pair/bun-cache" ~/.bun/bin/bun test --preload ./work/tests-properties/deny-network.ts ./work/null-pair/no-false-all-regression.test.ts > work/null-pair/no-false-all-regression.log 2>&1
```

Printed results: audit finds **7 changed common files**, all **3 fixture projections exact**, and hashes **470 input files**. The matrix prints **2 pass / 0 fail / 35 assertions**, the no-pair observations **8 pass / 0 fail / 26 assertions**, and the deliberately failing regression **0 pass / 1 fail / 3 assertions**. The producer log contains the original catalog case, reversed catalog input, reversed direct tuple, and renamed-key catalog witness.

Actual behavior:

| Target kind | `layout_groupby_unlisted_across_facts` | Dimensions cell |
| --- | --- | --- |
| Single fact, including singleton `sum` | Absent: early return before adding member fields | Existing dimensions, else its group-by value, else “All” |
| Multi-member `scaled_by_ratio`, identity one base fact, complete pair | false | Base's dimensions/value; Alabama probe reads “Alabama” |
| `rolled_forward_by_ratio`, one base cell, complete pair | false | Same; “Alabama” |
| `allocated_residual_by_ratio`, receipt has one base cell, complete pair | false | Same; “Alabama” |
| Any of those one-fact identities without a complete pair | null | Its dimensions if present, otherwise “All”; pair absence wins before the one-fact check |
| One-fact ratio identity with pair but no hierarchy | false | Existing dimensions or formatted pair; the matrix records the call `humanizeName("al")` rather than guessing the omitted formatter's capitalization |
| Several-fact identity whose hierarchy lists the representative pair | false | Listed dimensions, e.g. “Alabama” or “A”; group-by ID remains visible |
| Several-fact identity whose hierarchy omits a carried pair, values actually differ or not | true | Listed dimensions followed by “Combines several source cells”; group-by ID is null |
| Original mixed storage: ordinary A + layout A, representative `b-layout` | true | “Combines several source cells”, with no claim of several loan types |
| No representative pair, hierarchy has shared dimensions | null | Those listed dimensions; pair absence does not erase them |
| No representative pair and empty hierarchy, including reversed direct mixed tuple / renamed catalog witness | null | **“All”**, finding 1 |
| Schema 6 several-fact FSA aggregate, no recognized filter | null | Representative-derived **“stafford unsubsidized”** from `metadataDimensions`, despite five loan types |
| Schema 6 same aggregate with recognized `cell_be2_female_18_64` filter | null | **“Female · 18–64”** from filter decomposition; it takes precedence over representative metadata |
| Schema 7, several-fact identity, structured dimensions empty, no hierarchy | null | “All”; structured dimensions, when present, take precedence instead |
| Schema 8/9 row missing a required hierarchy | No successful response | Validation throws; a missing hierarchy is not silently an unknown schema-8 row |

`calendar_year_window_scaled_by_ratio` and other multi-member operations default to a several-fact identity; they use the listed/unlisted/unknown rules above. Two-base rolled and allocated cases do too. Neither the enum strings nor any value of the renamed field claims that the facts differ. The new name fits its limited evidence: it concerns a **complete pair carried by the representative**, not all pairs that might occur anywhere among members. It is not a complete test of whether an aggregate has dimensions or combines cells.

The exhaustive FSA comparison prints:

```text
total: 132; unchanged: 131
ed_fsa.portfolio_by_loan_type.fy2026_q2.dollars_outstanding.excluding_parent_plus.dollars_outstanding@2024
before: Combines several loan type values
after:  Combines several source cells
oldFormatterCalls: ["loan_type"]; newFormatterCalls: []
```

Thus all 131 other cells match without needing the missing formatter. The one old formatter input is the already asserted “loan type” title. No new misleading All/single-value reading appears relative to `67e6d0b`; the no-pair “All” and schema-6 representative-only reading persist. The schema-6 single-value limitation is disclosed in the PR body and is separate from the hierarchy-backed no-pair case in finding 1.

Reader audit command, also saved in `work/review/field-readers.log`:

```sh
rg -n 'layout_groupby_value_varies|layout_groupby_unlisted_across_facts|dimensionSummary|shownChronicle' inputs/dashboard-836fc66
```

The only runtime writer is `shownChronicle` (`latest-artifact.ts:626`); the hook declares the new field (`use-microcosm.ts:181`); the sole boolean-consuming UI reader is `dimensionSummary` (`target-row-labels.ts:19`), invoked for text and title at `microcosm-targets-view.tsx:201`. Other `shownChronicle` callers are the response row (`:2888`), investigation packet (`:2906`), direct target lookup (`:3339`) and member lookup (`:3382`); they consume the appropriate shaped keys, not either boolean by name. All old-name matches in the head dashboard are negative test assertions. No production, documentation or script reader of the old field remains. Old and new names in the supplied PR/review documents are explanatory or historical data, not stale runtime readers.

## 2. Every mechanism claim and citation

Commands and output:

```sh
python3 -I work/prose/audit_citations.py > work/prose/citations.log
python3 -I work/prose/layout_override_probe.py > work/prose/layout_override_probe.log
python3 -I work/prose/compare_probes.py > work/prose/probe-comparison.log
python3 -I work/prose/fixture_reader_audit.py > work/prose/fixture-and-reader-audit.log
python3 -I work/prose/claim_inventory.py > work/prose/claim-inventory.log
```

The first captures the cited source lines; the second reproduces the three original resolver/compiler outputs and adds the layout-priority probe. The sentence inventory records every body/hand-off sentence with its location and assessment. The accompanying saved projection checks print **“Reproduced first three original probe lines structurally equal: True”** and **“Fixture matches selected fields of original first three lines: True”**. `work/review/microcosm-citations.log` additionally contains the actual cited ledger lines.

Every microcosm-citing comment touched by the delta:

| Dashboard comment at head | Opened microcosm evidence at `0ff293b` | Result |
| --- | --- | --- |
| `target-row-labels.test.ts:57` | Probe plus `ledger_targets.py:1486-1490`, `:1578-1611` | Correct: original mixed-storage facts both describe A and omit it from hierarchy |
| `latest-artifact.ts:219`, context of export removal | calibrate `registry.py:149-150` | Correct: TargetSpec stringifies metadata |
| `latest-artifact.ts:539` above `hierarchyListsGroupBy` | `:1096-1100`, `:1486-1490`, `:1578-1611`, `:1614-1623`, `:1649-1651` | Correct mechanism: identity facts feed hierarchy; ordinary intersection and constant-layout test are separate; validator's `setdefault` merges layout into its dimension view |
| `latest-artifact.ts:582-596` above `shownChronicle` | `:1085-1090`, `:1318-1341`, `:1018-1035`, `:1174`, `:4270-4272`, `:4331` | Correct representative stamping, all-member metadata and operation-specific identities; window uses two years per series |
| `latest-artifact.ts:597-601` | `:1232-1245`, `:1012-1016` | Correct: singleton first; first base for the three ratio operations; otherwise latest period with last tuple index breaking ties; window operation selects from its window |
| `latest-artifact.ts:602-615` | Same identity/metadata paths plus `:1323`, `:1626-1646` | Masking and varying-dimensions limitation correct; flag description needs finding 2's precedence. Varying dimensions compares ordinary dimensions across all operands and treats absence as a distinct value |
| `multi-fact-identity.test.ts:305` | `:1578-1611` | Correct omission-is-not-variation argument |
| `multi-fact-identity.test.ts:379` | Probe, `:1490`, `:1578-1611` | All three specific fixtures correctly described; “whatever their layouts say” at `:388` is too broad |

For that last comment, ordinary A in both facts plus constant layout B in both makes the producer emit B: `_inherited_dimensions:1583-1594` gives the constant layout pair priority. The validity of contradictory ordinary/layout values remains unestablished, as the hand-off acknowledges for its third fixture; this is a wording qualification, not another proven valid-release runtime bug. Smallest edit: “in these two cases” and describe their actual layouts.

The unchanged surrounding citations (`stringListOrEmpty`, allocation receipts, lookup membership) were also checked: `:1321-1327` writes JSON member keys; `:3069-3071`/`:3188-3189` lists allocation base keys; `generate_uk_target_references.py:1117-1119` restates twelve region cells using one Table 1 share. No stale/wrong available line citation was found.

Sentence-by-sentence mechanism assessment of the PR body (line numbers in `inputs/pr/pr-body-836fc66.md`; multiple claims on a line are separated below):

| Body lines | Assessment of each mechanism sentence/claim |
| --- | --- |
| 3 | 132 targets verified; listed earlier follow-ups and two reviews describe supplied history |
| 11 | Each measure category has 14 country + 51 state targets; original-main first-row citations cannot be reopened from these two snapshots |
| 13 | Both readers return sorted levels; one level stays scalar, several read null; empty defaults are `""`/null by caller — all correct |
| 17-19 | Current statistic key uses levels; single-level key stays identical; current `VariableGroup` uses levels; no supplied UI reads comparison `variables[].level`; comparison returns both fields. Historical no-reader/main assertions remain historical evidence |
| 21 | FSA level and statistic tests match the description |
| 25, 27 | Current source/level labeling, raw option values, fallbacks and tests match. Main's exact old line contents are unavailable |
| 31 | `numberOrNull` is number-only; producer `:5913` writes count as string; TargetSpec stringifies metadata — correct |
| 33 | Count parser and both public responses agree; malformed examples and fixture counts agree. Several-fact identity counts intentionally remain masked as the later section says |
| 37 | Representative stamping and the same-period FSA last-operand statement are correct; old direct lookup used that representative's keys |
| 39 | All-member fields include ratio operands; shownChronicle adds its three fields for member count >1 |
| 41 | Identity-preserving three ratio cases and lookup by name/record/four fact keys are correct |
| 42-44 | Several-identity masking, hierarchy-based pair visibility, unchanged raw-row comparison matching, and single-fact early return are correct; the historical fifteen-output count cannot be reconstructed here |
| 46 | APIs carry members; supplied UI components do not read member fields or call investigation API |
| 48-49 | Current/new and 67e6d0b Dimensions strings verified; Source tooltip selects shown record else target name; ratio base keeps its record. Older two UI strings are supplied history |
| 51 | Identity test builds the four named operations, not every operation |
| 55 | Fixture SHA is exactly `037d28028b28b865eb0bacd09bb81285ff7b18e442bcf5e27ec762ae1008459b`. Release-gate source, matrix source and all fifteen fixture inputs are absent, so gate/rebuild claims cannot be independently checked here |
| 59, 61 | Current facet rule and 51 state values agree; map elides one-value tiers at `calibration-tree.ts:601-610`; URL filtering still works independently of listed facets |
| 63 | Belgium and mixed-category assertions support the described narrower rule; historical failed broader implementation cannot be replayed |
| 67 | Blanket test-first/no-test-edit claims contradict line 86 — finding 3 |
| 71-76 | All five identity branches agree with producer, including allocation base selection and the corrected “multi-member inputs” qualifier |
| 78 | First-three/latest/tie representative statements, ordinary-varying-dimensions limitation, group-by masking, universe masking and own-base lookups agree. Window representative additionally uses its window, as the production comment states |
| 79 | Generic no-All claim is false — finding 1; FSA-specific explanation is correct; helper-move history comes from previous review |
| 80 | Miss response lists member-key/raw-representative matches, stays unavailable and names targets; twelve-region/Table-1 example supported |
| 81-82 | Packet prints unavailable detail; workflow tells caller to choose/rerun named target. Historical local-server execution cannot be authenticated |
| 84 | Malformed examples catch stated mutants; generated tests have described scopes; behaviors already existed |
| 85-86 | Prior review supports sort-citation correction and the expressly disclosed test-edit exception |
| 90-91 | Every cited inheritance/validator line supports omission-is-not-variation; three fixture cases reproduce |
| 92 | Field rename/no-variation claim correct; false/null clauses need precedence qualification — finding 2 |
| 93-94 | Neutral phrase and 132-row comparison correct for marked targets; fixture exact; non-loan-type dimension test present |
| 95 | Reconstructed five failures support the test-first claim; exact intermediate commit executions unavailable |
| 96 | Lookup fields and line citation now exact; neither group-by nor universe constraint is a lookup key |
| 97 | Representative prose narrowing, four named operations and recognized legacy-filter precedence all correct |
| 98-99 | Four export removals and public reader paths correct; stronger category expectations and facet converse present; test audit below gives actual limits |
| 110 | Test-count increments match source; historical/full CI counts remain supplied results |
| 116 | Supplied detail component displays no record/fact identity to replace |
| 117-119 | Multi-identity universe null, omitted pair null, retained representative filters/dimension-set key all agree with code |
| 120 | Recognized legacy filter precedes metadata; representative-only schema-6 Dimensions limitation and null evidence flag are real |
| 121 | Member-key/representative-record limitation correct generally; another record can still coincide with a published member fact key |
| 122 | `targetNames` still uses raw representative record; unchanged |

Hand-off mechanism sentences (line numbers in `inputs/pr/handoff-6994-6639793646.md`):

| Lines | Assessment |
| --- | --- |
| 6 | Rename, reader inventory, neutral wording, exact retained fixture fields and FSA-only difference agree; three-value description needs finding 2's precedence |
| 7 | Name/base name/shown record/four shown keys precisely match `latest-artifact.ts:3336-3348`; no lookup added |
| 8 | Singleton, three base-cell operations, latest-period/tie and window representative descriptions all correct; filter precedence correct |
| 9-10 | Private helpers/public reader routes and stronger level comparisons exist; deterministic mutation probes confirm stated ability to fail |
| 25 | Correction of the earlier item 1 is correct: singleton sum returns unchanged; “every other operation spans several facts” needed “multi-member inputs” |
| 30 | Correctly acknowledges false for a pair-carrying one-fact identity without hierarchy; no-pair guard still wins |
| 31 | Neutral phrase is accurate, variation-free, and suitable wording; “each one sums” is false — finding 4 |
| 32 | Five retained fields match original first three log records; UK fixture-based tests and third-case validity caveat are accurate. Ancillary `member_keys`/`layout_pair` also disappear, besides the old dashboard flag |
| 33 | Public path, count-mutant distinction and example coverage correct; actual builds are 20k/40k, not 20k each. Full nine-second fast-check timing is supplied, not independently rerun |
| 34 | Page never calls repeatsGeography for Geography; added converse assertion exists |
| 35 | Comparison uses first eight distinct FSA rows, generated levels, one variable, same release both sides |
| 36 | Type field has no runtime effect; exact historical test-commit tree unavailable |

The lookup is unchanged in this delta. The legacy precedence is explicit at `latest-artifact.ts:1250-1259`, `:1289-1293`: hierarchy, then structured identity, then recognized filter dimensions, then metadata. The hub's narrower representative and hierarchy citation assessments are supported by the opened source.

## 3. New/changed tests, fail-first record and counts

Executed commands (each Bun invocation used the displayed work-local cache and deny-network preload):

```sh
python3 -I work/tests-properties/prepare.py
BUN_INSTALL_CACHE_DIR="$PWD/work/tests-properties/bun-cache" ~/.bun/bin/bun test --preload ./work/tests-properties/deny-network.ts ./work/tests-properties/old-package/src/multi-fact-identity.test.ts
BUN_INSTALL_CACHE_DIR="$PWD/work/tests-properties/bun-cache" ~/.bun/bin/bun test --preload ./work/tests-properties/deny-network.ts ./work/tests-properties/new-package/src/multi-fact-identity.test.ts
python3 -I work/tests-properties/prepare_labels.py
BUN_INSTALL_CACHE_DIR="$PWD/work/tests-properties/bun-cache" ~/.bun/bin/bun test --preload ./work/tests-properties/deny-network.ts ./work/tests-properties/old-front/target-row-labels.test.ts
BUN_INSTALL_CACHE_DIR="$PWD/work/tests-properties/bun-cache" ~/.bun/bin/bun test --preload ./work/tests-properties/deny-network.ts ./work/tests-properties/new-front/target-row-labels.test.ts
python3 -I work/tests-properties/fixture_check.py
```

Raw logs: `work/tests-properties/{old,new}-multi-fact.log`, `{old,new}-labels.log`, `fixture_check.log`. Results: multi-fact **7 pass / 2 fail / 60 assertions → 9 pass / 0 fail / 72 assertions**; labels **1 pass / 3 fail / 8 assertions → 4 pass / 0 fail / 10 assertions**, with the formatter limitation stated above.

| Every new/changed test at head | `67e6d0b` implementation → `836fc66` implementation |
| --- | --- |
| Labels `:44`, FSA neutral phrase | Fail → pass, isolated execution |
| Labels `:61`, mixed-storage neutral phrase, new | Fail → pass, isolated execution |
| Labels `:76`, listed Female + age-band group-by | Fail → pass, isolated execution |
| Labels `:90`, All/none/fallback, changed field name | Pass → pass; fallback formatter casing not independently verified |
| Multi-fact `:314`, renamed field's true/false/null/absent table | Fail → pass, exact final assertions on isolated readers |
| Multi-fact `:389`, three compiled mixed/ordinary probes, new | Fail → pass, exact final assertions on isolated readers |
| Invariants `:83`, count shape through page | Expected pass → pass; fast-check unavailable, deterministic public witnesses pass both |
| Invariants `:91`, count roundtrip through page | Same; unchanged parser, numeric/string roundtrips reach it |
| Invariants `:143` loop, category shape with none `""` | Same; new stronger expectations agree with unchanged category helper |
| Same loop, none null | Same; distinct comparison target identities preserve generated rows |
| Invariants `:200`, facets through page with suppression converse | Same; deterministic real-breakdown/repeated-geography witnesses pass both |
| Statistic groups `:76`, category key via public summary | Expected pass → pass by code; fast-check unavailable; grouping under `v` preserves previous helper semantics |

Other tests in those four files are unchanged. There are **23** final tests: 9 multi-fact + 4 labels + 5 invariants + 5 statistic. The prior files contain **21**: 8 + 3 + 5 + 5. Thus package **427→428**, frontend **888→890**, and unchanged file counts are structurally consistent. This round adds one package test and one extra frontend test; frontend also discovers package tests.

Observed failures reproduce **3 frontend + 2 package**. The ten generated tests' unchanged semantics make the reported **18 pass / 5 fail → 23 pass / 0 fail** consistent. Local git contains only the input-bundle commit `fa524d0`; the actual `5db3130` and `4046000` trees are not available. Transplanting final tests demonstrates failure sensitivity, not historical proof that those exact intermediate trees ran or that the fix commit touched no tests. Full 427/428 and 888/890 counts are supplied CI/cloud evidence, not claimed local reruns.

Plausible wrong implementations:

- Hard-coded “loan type values” wording fails the three changed/new label assertions. The listed-dimension test uses borrower age, as required.
- A formatter still reading `layout_groupby_value_varies` after the API rename fails all three neutral-label assertions.
- Continuing to emit the **old** field, including true on omission, fails explicit absence assertions. A **new** unlisted field true on omission deliberately passes: its numeric decision is unchanged; the semantic name and displayed claim changed. Those tests should not assert that omitted values differ.
- A helper returning no category levels fails both strengthened category properties on `[{level:"state"}]`; the prior output-only assertions admitted that mutant.
- All changed PR tests still admit finding 1's missing-pair “All”; the existing null-evidence example explicitly expects it. The new independent regression exposes this gap.

Fixture equality: every one of `case`, `facts`, `hierarchy_dimensions`, `representative` and `dashboard_target` exactly matches the corresponding value in each of the first three `hierarchy_probe.log` lines. No substantive producer payload was reconstructed by hand. The third case's conflicting-layout validity remains open and is not the basis of the blocking finding.

## 4. Exports, public-reader properties and CI cost

Commands/results:

```sh
rg -n 'countOrNull|repeatsGeography|computeDimensions|categoryLevels' inputs/dashboard-836fc66
BUN_INSTALL_CACHE_DIR="$PWD/work/tests-properties/bun-cache" ~/.bun/bin/bun test --preload ./work/tests-properties/deny-network.ts ./work/tests-properties/exports.test.ts
BUN_INSTALL_CACHE_DIR="$PWD/work/tests-properties/bun-cache" ~/.bun/bin/bun test --preload ./work/tests-properties/deny-network.ts ./work/tests-properties/public-readers.test.ts
PROPERTY_PACKAGE=./old-package BUN_INSTALL_CACHE_DIR="$PWD/work/tests-properties/bun-cache" ~/.bun/bin/bun test --preload ./work/tests-properties/deny-network.ts ./work/tests-properties/public-readers.test.ts
python3 -I work/tests-properties/mutants.py
```

For each of `accept-fraction`, `accept-negative`, `accept-space`, `no-levels`, the following command ran with `NAME` replaced by that literal mutant name:

```sh
PROPERTY_PACKAGE=./mutant-NAME BUN_INSTALL_CACHE_DIR="$PWD/work/tests-properties/bun-cache" ~/.bun/bin/bun test --preload ./work/tests-properties/deny-network.ts ./work/tests-properties/public-readers.test.ts
```

Search results (saved in `work/review/helper-readers.log`) contain the four declarations/internal uses in `latest-artifact.ts` and test comments, **no outside imports**, including `package-boundary.test.ts`. The declarations at `:222`, `:1021`, `:1032`, `:1658` all lack `export`. Dynamic namespace comparison prints each name **before=true, after=false**, **1 pass / 0 fail / 8 assertions** (`exports.log`).

Public deterministic witnesses print **6 pass / 0 fail / 54 assertions** against each version. Fraction and negative mutants each print **5 pass / 1 fail** (shape assertion). Accept-space prints **5 pass / 1 fail**, but its failure is the blank-string example, not shape/roundtrip. No-levels prints **4 pass / 2 fail**, exactly the two category assertions. Logs are `public-readers.log`, `old-public-readers.log`, `mutant-*.log`.

| Property | Does each generated input reach its helper? | Can it fail / remaining scope |
| --- | --- | --- |
| Count shape | Yes: single-fact fixture → buildCalibration → chronicleFactFields/countOrNull → returned page count; no multi-identity mask | Numeric 2.5/-1 kills fraction/negative mutants. Always-null would pass this one, but roundtrip catches it |
| Count roundtrip | Yes for each tested numeric/string form; successful run calls helper twice | Rejecting 0 or `"0"` fails. Accept-space still passes: `" "→0` is a safe count and is not a roundtrip input; existing malformed example rejects it |
| Category, none `""`, via variable summary | Every nonempty array; empty input returns `[]` without calling helper | Exact input-derived sorted/unique/nonempty levels and scalar level make always-empty fail. Deterministic examples pass current code |
| Category, none null, via comparison | Every nonempty array; empty input returns `[]` without helper | Same, including explicit empty default. Eight distinct seeded FSA target identities prevent comparison collapsing generated rows |
| Facets via targets page for variable `v` | computeDimensions for every array, including empty. repeatsGeography only for non-Geography candidates with >1 nonempty values | Two distinct real values hidden incorrectly fails; equal-to-own-geography dimensions shown incorrectly fails. Empty/single-valued candidates legitimately bypass repeatsGeography; its Geography-key assertion has no public path |
| Changed statistic one-category compatibility | minLength 1 + variable `v` reaches categoryLevels for every generated array before preconditions | Old key delimiters/scalar representation can fail. Preconditions intentionally exclude multiple levels and first-empty/other-nonempty cases; not complete multi-level coverage |

The unchanged statistic single-level property exercises the public key directly; it need not call any of the privatized helpers. The public paths do not promise that every helper runs on every empty/unusable input. The hand-off's “every property ran through a public reader” is correct; interpreting it as universal helper invocation would be too strong.

Performance: the shape property builds **20,000** one-row releases; roundtrip builds **40,000**. Other property `releaseOf` calls only replace rows of an already built release. Equivalent public-path loops printed **2,038 ms** and **3,629 ms**. Sixty seconds is a per-property timeout, leaving substantial margin on this host. The hand-off's whole-invariants nine-second timing is plausible but cannot be independently measured without fast-check. The CI workflow still runs unfiltered `bun test` after frozen installation on ubuntu-latest; no timeout/retry/exclusion weakened it. Added work is real, but there is no demonstrated material CI-timeout risk.

Could not run verbatim: the five fast-check invariants and changed statistic property (`fast-check` absent), full frontend/package suites, lint/typechecks/Next build, hosted Python or Vercel. An attempted package-boundary run stopped at missing `typescript`: **0 pass / 1 fail / 1 error**, before useful assertions (`package-boundary.log`); no dependency fetch followed. Boundary imports and exports were checked statically plus the runtime namespace probe instead. No passing claim here substitutes deterministic witnesses for a full 20,000-case fast-check run.

## 5. PR body against the brief

Commands/evidence:

```sh
nl -ba inputs/pr/pr-body-836fc66.md
python3 -I work/prose/claim_inventory.py > work/prose/claim-inventory.log
python3 -I work/prose/audit_citations.py > work/prose/citations.log
```

The inventory contains **677 lines** pairing body/hand-off sentences with assessments. Reading/searching the complete body found **no objective style-rule-breaking sentence**: it uses change/reader subjects, no first-person narration, no bold label leads, active finite verbs, no prohibited is/are/was/were-plus-participle construction, no “is above” comparison, and US spelling. The opening “Follow-up to #276.” is a context fragment. `## Review follow-ups` and this round's subsection exist. Its final nonempty line is exactly:

```text
🤖 Generated with [Claude Code](https://claude.com/claude-code)
```

Claims the code/evidence does not back:

1. `:79`: “The Dimensions column no longer reads ‘All’ for a target that combines several cells.” Finding 1 disproves it; scope to the FSA balance or fix the remaining fallback.
2. `:67`: the two universal historical test-first/no-test-edit sentences. The expressly documented exception at `:86` contradicts them; narrow their scope or retain the exception in the general statement.
3. `:92`: the unordered false/null description needs the no-pair and one-fact/no-hierarchy qualifications in finding 2. The implementation itself remains evidence-based.

No other current mechanism claim was disproved. Historical main/43c62d2 behavior, full CI/count results, release-gate code outside the provided microcosm subset, the fifteen-input fixture rebuild, and local-server/GitHub actions cannot be authenticated from this bundle. They are evidence limits, not invented findings that those claims are false. The present fixture's quoted hash does match.

## 6. Fresh read of the whole delta

Commands/results:

```sh
rg '^diff --git|^@@' inputs/pr/diff-67e6d0b-836fc66.diff
python3 -I work/review/audit.py > work/review/audit.log
cat inputs/dashboard-836fc66/.github/workflows/ci.yml
python3 -I work/review/validate.py > work/review/final-state.log
```

The diff lists **8 changed paths**: four test files, the added JSON fixture, and three production files. Comparing common snapshot files finds seven modifications; the fixture is new. I read all hunks and the fixture's three producer payloads. No manifest, lockfile, workflow, investigation packet, lookup implementation, or investigation doc changes in this three-commit delta.

Final validation prints **6 review-check sections**, **470 unchanged input hashes**, **INPUT_GIT_DIFF_EXIT: 0**, and **REPORT_VALIDATION: pass**.

Production changes preserve the classification's complexity: `"differs"` becomes `"unlisted"`, the emitted boolean name changes, and the UI substitutes neutral wording. Lookup still scans rows and shapes Chronicle as before; no additional scan, parse or asymptotic cost was added this round. The four helper export removals are complete; no new module or replacement test-only export appears. The revised microcosm citations are supported, subject to the comment qualification described in check 2.

The remaining page-description defect is finding 1. The known schema-6 representative dimensions, representative filters/dimension-set key and calibration-status `targetNames` limitations remain unchanged and disclosed. Tests/CI passing do not cover away the producer-valid empty-pair fallback. The changed/new tests pass for head in the stated isolation, but the independent regression fails there; that is the reason for **CHANGES NEEDED**.
