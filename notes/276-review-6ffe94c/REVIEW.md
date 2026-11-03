Head reviewed: `6ffe94ce4cfe4937f39032bb0e7fbe0e78f25be3` (PolicyEngine/calibration-diagnostics#276, unchanged since the brief). Verdict: **CHANGES NEEDED** (small: rewrite or remove the two `test.failing` tests, correct the fixture's metadata claim, and fix the PR body).

Microcosm is cited at `0ff293b1a335a29d46f1598f2039beffa242e632` (microcosm#1357). This repo is cited at `6ffe94c`. I read or ran everything stated here in this session. The logs are in `logs/`.

**What holds.** The label commit holds. The fixture reproduces byte for byte from the nine pinned sources. Every hierarchy field the tests assert traces to the Microcosm code that writes it. `initial_estimate` and `relative_error` mean what the fixture uses them for. All counts reproduce: 412/0, 863/0, lint and typecheck pass.

**What is wrong.** The two `test.failing` tests can never flip, whatever anyone does to the readers, so they track nothing. The fixture's metadata also departs from a release on fields the target detail page shows, although the hand-off says it keeps every key the dashboard reads.

## Findings, most severe first

### 1. The two `test.failing` tests can never pass, so they guard nothing and will never report a fix (medium)

`frontend/packages/calibration-tree/src/ed-fsa-family.test.ts:452-461` and `:661-672`

- **What goes wrong.** Each test asserts `rows.filter((row) => row.level === variable.level)` has length `n_targets` / `common_targets`. That requires one level string to equal the level of all 65 rows of a measure category. The fixture gives those rows two levels (51 `state` and 14 `country`). No change to `microcosmVariableSummary` or `comparisonVariableRows` can satisfy it. So `test.failing` stays green under any fix, and also under a regression.
- **Concrete case** (`logs/step4-test-failing-never-flip.log`). I patched `latest-artifact.ts` three ways and ran the PR's own test file each time:
  - (A) level `"mixed"` for the summary and `null` for the comparison when a category spans levels: **12 pass, 0 fail**.
  - (B) level `"country,state"`: **12 pass, 0 fail**.
  - (C) every category's level blanked, a regression: the two `test.failing` still "pass". Only the one-target check in the targets-page test (`:426-430`) catches it.

  The hand-off says "the assertion would change with it [the fix]". In fact no fix ever makes the assertion fail, so no fix will ever prompt anyone to change it.
- **Smallest fix.** Remove both `test.failing` tests and track the two readers in an issue. Or decide the representation now and assert it (see step 4 for the reader fixes and their assertions). Either change is a few lines.

### 2. The fixture's row metadata departs from a release on fields the target detail page shows (low–medium)

`frontend/packages/calibration-tree/src/fixtures/ed-fsa-family/build_fixture.py:235-265` (`row_metadata`), and the hand-off's judgment call 3

- **What goes wrong.** The hand-off says the fixture keeps "only the keys the dashboard reads". `chronicleFactFields` (`latest-artifact.ts:454-486`) reads many keys the fixture drops. A release writes them through `_ledger_metadata` (microcosm `ledger_targets.py:5855-5920`), `_multi_fact_reference_metadata` (`:1318-1341`) and `_reference_metadata` (`:5388-5455`):
  - `ledger_fact_key`, `ledger_semantic_fact_key`, `ledger_aggregate_fact_key` and `ledger_legacy_fact_key`
  - `ledger_measure_concept`, `ledger_concept_relation` and `ledger_concept_authority`
  - `ledger_geography_vintage` and `ledger_dimension_set_key`
  - `ledger_universe_constraint_set_key` and `ledger_universe_constraint_count`
  - every `ledger_filter_*` key
- **Concrete cases** (`logs/step2-release-metadata.log`, `logs/step5-probe.log`):
  - **Measure.** `microcosm-target-detail.tsx:47-54` takes the "Measure" from `chronicle.measure_concept` first. A release stamps `ledger_measure_concept` = the fact's `concept_alignment.canonical_concept`, `ed_fsa.dollars_outstanding` (`ledger_targets.py:5748-5761`). The detail page would show "Dollars Outstanding". From the fixture it shows "Federal student loan balance".
  - **Filters.** The 28 band rows would carry `ledger_filter_age_upper_bound` = 25, `ledger_filter_federal_student_loan_balance_lower_bound` = 200000, and so on (`ledger_targets.py:5911-5919`, `:5928-5933`, `:5936-5966`). Those reach `chronicle.filters`. The fixture gives `filters: []`.
  - **Fact keys.** The detail's fact keys are null in the fixture.
  - **No hierarchy field is affected.** For schema 8 rows, `hierarchyIdentity.dimensions` wins over `metadataDimensions` (`latest-artifact.ts:1115-1119`), so the dropped filters don't change dimensions. `conceptKey` reads the full metadata only for congressional-district rows (`target-loss-attribution.ts:509-531`).
- **Effect today.** No test asserts the detail page, so no current assertion is wrong. But the fixture is presented as "what a release writes", and a later detail-page test built on it would bless output that a release doesn't produce.
- **Smallest fix.** Either restate `_ledger_metadata` in full in `row_metadata` (it is about 40 lines of field copies plus the two filter loops), or change the docstring and the claim to "the keys the tested readers read". Then list what is omitted.

### 3. Debt-size bands sort alphabetically on the targets page *and* the calibration map, and the cause is partly in this repo (low; follow-up)

`frontend/packages/calibration-tree/src/hierarchy-target-reader.ts:89-113` and `latest-artifact.ts:903-925`

- **What goes wrong.** The hierarchy reader stores each dimension's *position in the row's list* as `rank`. `computeDimensions` treats `rank` as a *value* rank. For structured rows, `rank` really is a value rank: the index in the dimension definition's `order` (`structured-dimension-reader.ts:103-125`). Every FSA row has at most one dimension, so every value gets rank 0. `everyValueRanked` is then true, so the sort skips `sortFacetValues` (`:844-851`) and falls to `localeCompare`.
- **Concrete case** (`logs/step5-probe.log`). The targets-page facet and the calibration map's United States node both list "100K to 200K", "10K to 20K", "200K+", "20K to 40K", "40K to 60K", "5K to 10K", "60K to 80K", "80K to 100K", "Less than 5K". The PR body notes this for the targets page only. Age bands come out right only because their labels happen to sort alphabetically.
- **Where a size order could come from.** The Chronicle facts carry the source order in `layout.groupby_ordinal`: 0 = "Less than 5K" … 8 = "200K+", and 0–4 for the age bands. Microcosm drops it: `HierarchyDimension` has only `id`, `label`, `value_id` and `value_label` (`hierarchy.py:67-73`), and `_inherited_dimensions` (`ledger_targets.py:1578-1610`) doesn't read it.
- **Which repository changes.** Both:
  - Microcosm: add a value order (for example `value_rank` from `groupby_ordinal`) to `HierarchyDimension` and `_inherited_dimensions`, and serialize it in diagnostics.
  - This repo: read that value rank in `hierarchy-target-reader.ts` instead of the dimension position.

  Fixing this repo alone would only reach `sortDimensionValues`, which can't parse "Less than 5K" or "200K+" (`numericRange`, `latest-artifact.ts:765`), so it doesn't give size order either.
- **Not a blocker for #276.**

### 4. The excluding-Parent-PLUS target names one of its five member facts as its Chronicle record (low; follow-up, release behaviour)

- **Concrete case** (`logs/step5-probe.log`). The target detail of `…excluding_parent_plus.dollars_outstanding` shows Chronicle `source_record_id` `…stafford_unsubsidized.dollars_outstanding` and `layout_groupby_value_id` `stafford_unsubsidized`. Also, `latestMicrocosmTargetInvestigation` (`latest-artifact.ts:3137-3166`) resolves a `target=` lookup of that member's record id to the aggregate.
- **Cause.** This is faithful to a release. `_ledger_metadata` is stamped from the representative fact (`ledger_targets.py:1086-1089`), which is the last operand (`:1232-1245`, `:3709-3751`).
- **Smallest fix (Microcosm).** For multi-fact references, omit the representative's single-fact identity keys (`ledger_source_record_id` and `ledger_layout_groupby_value_id`), keeping `ledger_member_fact_keys`. Or, in this repo, show "5 member facts" when `ledger_member_fact_count` > 1.

### 5. The PR body and hand-off misstate a few things (nit)

See step 6.

### 6. `source_period` is read from a different source than Microcosm uses (nit)

`build_fixture.py:259`. It reads `source_period` from the representative fact's `period.value`. Microcosm writes the plan's `reference_period` (`fsa_student_loan_targets.py:579`). Both are "2026-03" for all 132 rows (`logs/step2-release-metadata.log`), so the output is identical. Cite `:579` or read `receipt["fsa"]["reference_period"]`.

---

## Step 0: Preflight

- `gh api repos/PolicyEngine/calibration-diagnostics/pulls/276 --jq .head.sha` returned `6ffe94ce4cfe4937f39032bb0e7fbe0e78f25be3`. The branch is `claude/student-debt-dashboard-check-9bj125` and the PR is a draft. Its base is `8d41de4`, the current `main`.
- `curl -fsSL https://raw.githubusercontent.com/PolicyEngine/microcosm/0ff293b…/packages/microcosm-build/tests/engine_free/us/test_us_fsa_student_loan_targets.py` worked. Lines 139-149 give the 132 targets and the 51/51/5/5/9/9/1/1 role counts.
- I read the PR body, the hand-off (issue comment 6614720968), `CLAUDE.md` and `AGENTS.md`.
- I reviewed in a detached worktree of `6ffe94c` in the session scratchpad, and never touched the PR branch.

## Step 1: Reproduce the fixture

- **Sources.** I fetched the nine files at `0ff293b` through raw.githubusercontent.com into their own directory. All nine sha256s equal `build_fixture.py:64-89` and the hand-off table (`logs/step1-sources.log`).
- **Build.** I copied the script to a separate directory and ran `python3 -I build/build_fixture.py mc > out.json` (Python 3.13.18). It exited 0. `out.json` and the committed `ed-fsa-family-schema-8.json` both hash to `ee283be7a4138e0a486c3d1e495b2c57b9e5febc710252197e08914c80b4df23`, and `cmp` reports them byte-identical (`logs/step1-build.log`).

## Step 2: The derivation

I traced one row of each kind: Alabama balance, debt size "Less than 5K" / "200K+" balance, age "24 and Younger" borrowers, Parent PLUS, and excluding Parent PLUS.

| Field | Release code at `0ff293b` | Fixture | Verdict |
| --- | --- | --- | --- |
| `name` | `TargetDiagnostic.name` is the `"name@period"` row label (`solve.py:260`). `diagnostics.py:129-139` looks registry specs up by `f"{name}@{period}"` and raises on a miss (`:389-394`). | `<target_name>@2024` | Matches. This is judgment call 4, now traced. |
| `period` | `apply_fsa_student_loan_plan`: `period=target_period` (`fsa_student_loan_targets.py:367`, `:407`) | 2024 | Matches, if the build period is 2024 (the receipt's host is `populace-us-2024-…`). |
| `entity` | `entity="household"` (`fsa_student_loan_targets.py:592`, `:610`) | household | Matches. |
| `source` | `_source_citation(representative)` (`ledger_targets.py:1080`, `:5842-5852`) | The same restatement | Matches. |
| `target` | `diagnostic.target` = the compiled `b` = the plan value (`fsa_student_loan_targets.py:406`) | The receipt's `target` | Consistent. I didn't trace the receipt's generator. |
| `initial_estimate` | `row @ w0`, the input weights (`solve.py:263-264`, `:928-947`) | The receipt's `release` | Holds; see below. |
| `final_estimate` | `row @ w` | `b_with_fsa` | Matches. |
| `relative_error` | `(final − target)/target`, or `final − target` when the target is 0 (`solve.py:267-269`, `:936-939`) | `b_with_fsa_error` | Holds: equal to 0.0 on all 132 rows. |
| `registry` | `family=FSA_TARGET_FAMILY` = `"ed_fsa"` (`fsa_student_loan_targets.py:106`, `:596`, `:614`; `diagnostics.py:236-244`) | `{"family":"ed_fsa",…}` | Matches. |
| `hierarchy.provider` / `category` | `_hierarchy_seed` (`:875-888`), with labels from `provider_labels.py:35` and `variable_labels.py:77-84`; category map `:133-138` | The same | Matches. |
| `hierarchy.geography` | The constant (level, id) and name across members (`ledger_targets.py:1375-1418`) | The same, raising instead of falling back when the name is empty | Matches (every member has a name). |
| `hierarchy.dimensions` | `_inherited_dimensions` (`:1578-1610`), `_constant_text` (`:1649-1651`), `_dimension_value_id` (`:1707-1712`), `_dimensions` (`:5777-5784`) | A line-for-line restatement | Matches. |
| `hierarchy.target` | id = the spec name; label = `plan.labels` (`fsa_student_loan_targets.py:394`). Labels are built at `:693`, `:774-778` and `:853`. | The receipt's `label` | Matches. |
| `metadata` | All of `_ledger_metadata`, the multi-fact keys, `_reference_metadata`, the plan keys (`fsa_student_loan_targets.py:572-586`), `**compiled` and the reconciliation plus `fsa_published_value` (`fsa_student_loan_targets.py:408-413`) | A 20–21-key subset | **Departs** (finding 2). |
| `measure`, `filter`, `compiled_target`, `within_tolerance` | Written by `diagnostics.py:221-234` | Absent | Harmless: the readers treat absent like `null`, e.g. `within_tolerance === true` and `row.filter != null`. |

**The hand-off's five judgment calls:**

1. **Balance excluding Parent PLUS has no dimension. Holds.** The five members share `groupby_dimension` but not `groupby_value_id`, so the groupby dimension is dropped (`ledger_targets.py:1583-1586`). All five have `dimensions: {}`. The geography is the shared `0100000US`.
2. **The representative is the last member. Holds**, and for a reason the hand-off doesn't cite. The linear combination resolves facts in operand order (`ledger_targets.py:3709-3751`). The operands are the non-Parent-PLUS rows sorted by source record id (`fsa_student_loan_targets.py:819-824`, `:605-608`). `_value_representative_fact` takes the latest period, then the highest index (`ledger_targets.py:1232-1245`). That gives `stafford_unsubsidized`, which is the member the fixture uses.
3. **The metadata holds only the keys the dashboard reads. Does not hold** (finding 2).
4. **Row `name`. Holds** (see the table above).
5. **Estimates. Holds, with one caveat.**
   - *Sign:* the receipt's error is signed `(b_with_fsa − target)/target`, which is identical to `solve.py:936-939`; 71 of the 132 are negative.
   - *Base:* both use the target as the base.
   - *Units:* the error is a dimensionless fraction, and the estimates are in the target's own unit (usd or count).
   - *Within 10%:* `|b_with_fsa_error| ≤ 0.1` holds for 128 rows, which the test reads as 65 + 61 + 1 + 1.
   - *Initial estimate:* `release` is the estimate under the host release's weights. Those are the refit's input weights: the b_with_fsa arm's initial borrower-household share is 0.16413671, the same as the release's `households_with_federal_education_debt`.
   - *Caveat:* in a release built from scratch with #1357, `initial_estimate` would be that build's own pre-calibration weights, not the previous release's calibrated weights. That is fine for a fixture, but the comparison test's "before the refit" (`ed-fsa-family.test.ts:602-614`) models a refit, not a release.

## Step 3: The tests

**Setup.** I followed the README and CI (`.github/workflows/ci.yml:39-52`), with bun 1.4.4:

- `cd frontend && bun install --frozen-lockfile`: 358 packages (`logs/step3-install.log`).

**Runs:**

| Command | Result |
| --- | --- |
| `cd frontend/packages/calibration-tree && bun test` | **412 pass, 0 fail**, 8580 expects, 36 files. Two of the 412 are `test.failing`. |
| `cd frontend && bun test` | **863 pass, 0 fail**, 21902 expects, 99 files. The log shows a "403: forbidden" stack trace from `app/api/hf-webhook/route.test.ts`; that test exercises the error path and passes. |
| `cd frontend && bun run lint` (both `tsc` runs) | exit 0 |
| `cd frontend/packages/calibration-tree && bun run typecheck` | exit 0 |

CI at `6ffe94c` is green: frontend tests, typecheck/build, hosted Python and Vercel all pass. The counts match the hand-off.

**The 12 tests in `ed-fsa-family.test.ts`:**

| # | Lines | Asserts | Would it catch a reader that shows the family wrongly? |
| --- | --- | --- | --- |
| 1 | `236-259` | The fixture's provenance commit, the role counts 51/51/5/5/9/9/1/1, 132 rows and 51 states | No. It reads only the fixture JSON and calls no reader, so **it can't fail from any dashboard change**. It guards against hand edits of the fixture only. |
| 2 | `261-352` | The schema 8 identity, `diagnostics_status`, no label variants, 135 rows, and five rows' source, labels, `variable_key`, family, geography, level, breakdown, dimensions and target label. Schema 9 rows equal schema 8 rows. | Yes, the strongest test. It would catch a wrong provider or category label, a wrong level or geography, a missing or extra dimension, a measure fold, or schema 9 divergence. `included_target_count === rows.length` is weak but can fail. |
| 3 | `354-374` | All 102 state rows carry one Borrower location equal to the geography; no country row has a location | Yes. It would catch a reader that drops the location, or one that adds a location to national rows. |
| 4 | `376-395` | Summary totals, and each category's `n_targets` / `within_10pct` | Yes, for grouping and fit counting (it would catch an `initial`/`final` swap). It asserts no error means. |
| 5 | `397-443` | Sources, levels, geography order (United States first) and membership, each category's key, labels, measure, count and fit, the one-target level, and the source, level and geography filter counts | Yes. |
| F1 | `452-461` | `test.failing`: the category level holds for every row | **Can't fail** (finding 1). |
| 6 | `463-494` | Facet keys and labels, value membership (as sets), United States first, and single and combined facet filters | Partly. It catches a missing or extra facet and wrong filtering. By design, **no value order is asserted**, so it can't catch the alphabetical band order (finding 3) or any other order. |
| 7 | `496-505` | One-target categories: one row, no facets, at United States / country | Yes. |
| 8 | `507-556` | Map provider → 4 categories; United States first then the states; the band groups' ids and labels in order (age, then debt); band values as sets; band → one target; a state → target with no tier; one-target categories | Yes for structure and the order of the tiers. Not for band value order (sets). |
| 9 | `558-587` | Treemap by program (counts and fit) and by geography (United States 30, each state 2) | Yes. |
| 10 | `589-654` | Comparison: 3 common and 132 added; refit 135 common, per-category common counts, and Alabama's and excluding-PLUS's labels, level and breakdown | Yes for matching and labels. It asserts no per-row deltas. |
| F2 | `661-672` | `test.failing`: the comparison category level holds for every row | **Can't fail** (finding 1). |

**Not covered by any of the 12:** the target detail / investigation packet, the release highlights, value order, and per-row fit deltas.

## Step 4: The expected failures

**Running them.** I flipped both tests with `sed 's/test\.failing(/test(/'` into `src/ed-fsa-family-unfailed.scratch.test.ts` in the scratch worktree, ran it, and deleted it (`logs/step4-expected-failures.log`). Result: 10 pass, 2 fail:

```
459 |       expect(rows.filter((row) => row.level === variable.level)).toHaveLength(variable.n_targets);
error: expect(received).toHaveLength(expected)
Expected length: 65
Received length: 51
(fail) the ED Federal Student Aid target family > a category with state and country targets is not listed at one level

668 |       expect(rows.filter((row) => row.level === variable.level)).toHaveLength(
error: expect(received).toHaveLength(expected)
Expected length: 65
Received length: 14
(fail) the ED Federal Student Aid target family > a compared category with state and country targets is not at one level
```

**`latest-artifact.ts:1526`, `level: String(first.level ?? "")` in `microcosmVariableSummary`**

- **Where it goes.** The value is returned as `variables[].level` from the targets-diagnostics API (`:2648`).
- **Who reads it in `frontend/`.** Two places, and neither renders it:
  - `groupVariables` keys a statistic group on `[source, level, variable]` (`components/microcosm/microcosm-targets-view.tsx:259-266`). `VariableGroup.level` (`:293`) is set and then never rendered.
  - `CalibrationTargetNavigationCards` counts distinct `[source, level, variable]` for "N statistics" (`calibration-target-navigation-cards.tsx:94-100`).
- **Is it a defect?** The level is wrong as data. Nothing on screen shows it wrongly for this family: each FSA category has one measure, so no group splits and the count is right. It would show wrongly only for a variable whose measures start at different levels. It is a latent API defect, not a visible one.
- **Smallest fix.** Add `levels: [...new Set(group.map((r) => String(r.level ?? "")).filter(Boolean))].sort()`, and set `level: levels.length === 1 ? levels[0] : "mixed"`. Add `levels?: string[]` to `MicrocosmVariableRow` (`lib/api/hooks/use-microcosm.ts:190-197`).
- **Its test.** For each mixed category, `levels` equals `["country","state"]` and `level` equals `"mixed"`. For each one-target category, `levels` equals `["country"]` and `level` equals `"country"`.

**`latest-artifact.ts:3220`, `level: sample.level ?? null` in `comparisonVariableRows`**

- **Where it goes.** The value is returned as `variables[].level` from `buildComparison` (`:3344`) and spread into staging compare (`staging-artifact.ts:1388`).
- **Who reads it.** Nothing in `frontend/` reads `variables` from a comparison: `microcosm-staging-view.tsx` reads neither `variables` nor a level. So it is an API field only.
- **Is it a defect?** It is wrong as data, and also unstable. The input `common` is sorted by `|abs_rel_delta|` (`:3304-3308`), so the level is that of whichever row's fit changed most. In the test (`buildComparison(release, release)`), every delta is 0, so the order is the matcher's alphabetical key order (`target-surface-matcher.ts:229-230`). `…portfolio_by_age…` sorts before `…portfolio_by_location…`, which is why it reads `country`. It isn't "sorted by fit change" as the PR body says.
- **Smallest fix.** The same `levels` array, with `level: levels.length === 1 ? levels[0] : null`. `MicrocosmComparisonVariableRow.level` is already `string | null` (`use-microcosm.ts:517`).
- **Its test.** For mixed categories, `level` is `null` and `levels` equals `["country","state"]`. Also check that `level` doesn't change when one state row's fit is altered so that it sorts first.

**Land with `test.failing`, or fix the readers first?** Neither as written.

- The `test.failing` tests can't flip (finding 1), so landing them records a defect that CI can never re-raise.
- Neither defect is visible on any page for this family, so the reader fixes needn't block #276.
- Recommendation: remove the two `test.failing` tests from #276 and open an issue, or take the two fixes above with their real assertions (about 10 lines plus tests). If the hub wants the defect recorded in code, add a plain `test` that asserts today's value (`level === "state"` for the summary) with a comment pointing to the issue. That test does fail when the reader changes.

## Step 5: What the tests miss

All of these come from running the fixture through the real readers (`logs/step5-probe.log`):

- **Target detail and investigation** (`latestMicrocosmTargetInvestigation`, `latest-artifact.ts:3137-3166`; `microcosm-target-detail.tsx`). Untested. From the fixture:
  - The Measure is "Federal student loan balance" (a release would give "Dollars Outstanding").
  - The Chronicle filters are empty (a release gives the band edges).
  - The fact keys are null.
  - Excluding Parent PLUS shows the `stafford_unsubsidized` member as its record (findings 2 and 4).
  - The Period reads "2026-03 → 2024" (`:40-45`), from both the fixture and a release.
  - "Chronicle entry: Not available": `lib/microcosm/chronicle-entry-url.ts` has no FSA table, as the PR notes.
- **Facet and map value order** (`computeDimensions`, `latest-artifact.ts:859-929`; the calibration map). Untested, because test 6 and test 8 compare values as sets.
  - Debt size comes out alphabetical on both the targets page and the map.
  - Age comes out correct by coincidence.
  - Geography sorts United States first, then the states alphabetically.
  - For where the ranks come from and which repositories must change, see finding 3.
- **Source and level filter options** (`microcosm-targets-view.tsx:760-763`, `:775-778`). Untested. They show the raw values "ed_fsa", "country" and "state", as the PR body notes.
- **Release highlights** (`latestMicrocosmCalibrationHighlights`, `:3005-3020`). Untested.
  - FSA rows fill `largest_absolute_misses`: Louisiana balance, excluding Parent PLUS, age 35-49, and so on. These are dollar misses on targets of $10⁹–10¹², so the family will dominate that list beside other families.
  - The labels come through correctly.
- **`metadataDimensions` / `estimateScopeKey`** (`:514-560`, `:1230-1248`). They are not reached for hierarchy rows' dimensions. `estimateScopeKey` would run, but FSA rows don't share estimates, so it returns no warning.
- **Cross-dataset fact pages** (`lib/cross-dataset/fact-presentation.ts:309`, `:418`). The `369335f` tests cover them, and they get "ED · Federal Student Aid".
- **The calibration explorer view's fallbacks** (`components/microcosm/calibration-explorer-view.ts`). Hierarchy rows carry `source_label`, so the `SOURCE_LABELS` fallback isn't reached for this family.

## Step 6: The PR body

The body describes the code changes, the family table, the source and fixture method, and the counts correctly. It needs these corrections:

1. **"Its rows are sorted by fit change, so there the category reads `country`."** In the test, every delta is 0, and `country` comes from the matcher's alphabetical key order. In general the level is the row with the largest fit change.
2. **"The targets page lists each measure category at `state`."** The page never shows a category's level. It is an API field used only as a grouping key and in the "N statistics" count.
3. **"Both are `test.failing` in the new test."** That implies they flag a fix; they can't (finding 1).
4. **"with two exceptions (see "Not changed"): a category that holds both state and national targets…"** This names one exception.
5. **Debt-size order is described for the targets page only.** The calibration map has the same order, and the cause is the hierarchy reader's use of `rank` (finding 3), not only the absence of ranks in Microcosm.
6. **The hand-off's "only the keys the dashboard reads" is wrong** (finding 2). The PR body doesn't repeat it.

The body's test counts, its CI claims and the claim that `build_fixture.py` reproduces the fixture byte for byte all hold.

## Logs

- `logs/step1-sources.log`: the nine sha256s.
- `logs/step1-build.log`: the build command, the hashes and `cmp`.
- `logs/step2-release-metadata.log`: what a release would stamp versus the fixture, the receipt error check, and the script used.
- `logs/step3-install.log`, `logs/step3-calibration-tree-bun-test.log`, `logs/step3-frontend-bun-test.log`, `logs/step3-lint-typecheck.log`.
- `logs/step4-expected-failures.log`: both `test.failing` tests flipped to `test`.
- `logs/step4-test-failing-never-flip.log`: three reader patches, after which the `test.failing` tests still pass.
- `logs/step5-probe.log`: facet and map order, the investigation packets and the highlights.
