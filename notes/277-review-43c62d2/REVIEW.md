Reviewed PolicyEngine/calibration-diagnostics#277 at head `43c62d2f2ad2c17dc7215dfc5c0e5c564c6f5e90` (base `2306113fa8742260eb65f374cf460aa1339d3ffd`): **CHANGES NEEDED**

The preflight matched: the PR's head and base are the ones the brief names. Lines in this repo are cited at `43c62d2` unless marked `@2306113`. Lines in microcosm are at `0ff293b1a335a29d46f1598f2039beffa242e632`, read through raw.githubusercontent.com, with one code search through `gh api search/code`. Logs and scripts sit beside this file in `logs/` and `scripts/`.

**Why CHANGES NEEDED.** Finding 1 is the only blocker. For a multi-fact target, `shownChronicle` nulls the fields that belong to one member whatever the target's value operation. Microcosm writes the same member metadata on ratio-scaled and rolled-forward targets too, and for those it says the target keeps the base fact's identity. The fix is a few lines and a test. If the hub can show that no live release carries a multi-fact target whose operation is not `linear_combination`, `sum` or `difference`, finding 1 can drop to a follow-up and the verdict becomes APPROVE with follow-ups. I couldn't check that from here: the egress proxy refuses both the production dashboard and huggingface.co (step 4).

## Findings, most severe first

### 1. `shownChronicle` erases the identity of ratio-scaled and rolled-forward targets (blocker)

- **Where.** `frontend/packages/calibration-tree/src/latest-artifact.ts:519-536`. It is used by `targetResponseRow` (`:2783`), `investigationSearches` (`:2801`) and the investigation lookup (`:3234`).
- **What goes wrong.** The rule triggers on `ledger_member_fact_count > 1` alone (`:521-522`). Microcosm writes `ledger_member_fact_count`/`ledger_member_fact_keys` for *every* multi-fact reference: `target_spec_from_ledger_reference` (`ledger_targets.py:867`) adds `_multi_fact_reference_metadata(facts)` (`:1090`, defined `:1318-1340`). Those operations are `MULTI_FACT_VALUE_OPERATIONS` (`:96-108`): `sum`, `difference`, `linear_combination`, `calendar_year_average`, `calendar_year_window`, `latest_plateau`, `count_x_mean`, `scaled_by_ratio`, `rolled_forward_by_ratio`, `allocated_residual_by_ratio` and `calendar_year_window_scaled_by_ratio`.
  - For the ratio operations, the representative is the base cell (`_value_representative_fact`, `:1232-1245`: `facts[0]` for `scaled_by_ratio`, `rolled_forward_by_ratio` and `allocated_residual_by_ratio`).
  - Microcosm says that base *is* the target's identity: "A ratio-scaled cell keeps the base cell's identity: the national numerator and denominator translate its value, they do not relocate it" (`:1018-1035`, `identity_facts`).
  - So on such a target the PR nulls the target's own record id, fact keys, group-by value and universe constraint. It lists the ratio's numerator and denominator facts as "members" beside the base.
  - The PR chose the nulled fields by comparing the five members of one `linear_combination` (body, item 4). That comparison holds for that operation (step 5 confirms it), but the rule is applied to every operation.
- **Where it reaches.**
  - The UK target references use `scaled_by_ratio` for the HMRC CGT Table 5 country and region cells (microcosm `changelog.d/725-scaled-by-ratio-value-operation.added.md`, `changelog.d/467-cgt-band-targets.added.md`, `tools/generate_uk_target_references.py:1119`). They also use `rolled_forward_by_ratio` (`:807`) and `calendar_year_average` for UC (`:683`, `:801`).
  - `be/target_references.json` holds 22 `rolled_forward_by_ratio` references (`logs/step5-operations.txt`). The one I opened is marked `activation_status: requires_prerequisites`, so I can't say how many of the 22 are live.
  - `us/fiscal_target_references.json` holds only `identity`.
  - No fixture in this repo outside the FSA one carries `ledger_member_fact_count`, so step 4 can't show this.
- **Concrete case** (`scripts/step7_ratio_target.ts`, `logs/step7-ratio-target.txt`). I took the FSA fixture's Alabama balance row and added what microcosm writes for a ratio-scaled cell: `ledger_value_operation: scaled_by_ratio`, `ledger_member_fact_count: "3"`, and member keys made of its own fact key plus a numerator and a denominator.

  | | base `2306113` | head `43c62d2` |
  | --- | --- | --- |
  | `chronicle.source_record_id` | `ed_fsa.portfolio_by_location.2026_03_31.al.dollars_outstanding` | `null` |
  | `chronicle.fact_key` | `ledger.aggregate_fact.v2:a0011046…` | `null` |
  | `chronicle.layout_groupby_value_id` | `al` | `null` |
  | `chronicle.universe_constraint_set_key` | `ledger.universe_constraint_set.v2:8b5d…` | `null` |
  | lookup by the target's own `fact_key` | found | **Target not found** |
  | investigation searches | Source record, Fact key, Semantic fact, Legacy fact, … | Member fact ×3, … (no record or key) |

  The lookup by record id still succeeds here only because this target's name equals its record id. A UK CGT cell's name doesn't.
- **Who sees it.**
  - The repo's own investigation workflow, which `CLAUDE.md` makes mandatory, accepts "a Chronicle `source_record_id`" or "a Chronicle `fact_key`" (`docs/ai/workflows/investigate-microcosm-target.md:7-12`). Its packet script stops on `available: false` (`scripts/microcosm-investigation-packet.mjs:85`). So the documented inputs dead-end for these targets.
  - On the targets page, a row with no `target_dimensions` shows its group-by value in the Dimensions column (`frontend/components/microcosm/microcosm-targets-view.tsx:109-115`). That value now reads "All".
- **Smallest fix.** In `shownChronicle`, read `metadata.ledger_value_operation`. For `scaled_by_ratio`, `rolled_forward_by_ratio`, `allocated_residual_by_ratio` and `calendar_year_window_scaled_by_ratio`, add `member_fact_count`/`member_fact_keys` but keep the representative's fields. Equivalently, null them only for the operations whose identity is every fact (`ledger_targets.py:1021-1035`). Add one test with a `scaled_by_ratio` row like the one above.
  - `calendar_year_average` and the window operations have every fact as their identity in microcosm (`:1034`), so nulling the record id and keys is defensible there.
  - But the group-by value and universe constraint are probably shared by the twelve months and would still be nulled. I didn't read a UK Chronicle fixture, so that part is unverified.

### 2. The PR body says users see the member facts; no page renders them (body correction)

- The body says: "The member facts reach users through the targets page rows and the target investigation API."
- No component reads `member_fact_count` or `member_fact_keys`. A grep of `frontend/{app,components,lib}` outside tests and the type finds none. Nothing in the UI calls `/api/microcosm/target-investigation`, which only the packet script and README describe.
- What users do see changes in two places, which the body doesn't mention:
  - The FSA aggregate's Dimensions column changes from "Stafford Unsubsidized" to "All" (`microcosm-targets-view.tsx:112`; `target_dimensions` is `[]` on that row).
  - The Source cell's tooltip changes from stafford's record id to the target's name (`:189`).
- Both are improvements for the FSA target. The body should say this is what changes on the page, and that the member facts reach only the APIs.

### 3. Nothing tests that `countOrNull` rejects non-counts (test gap)

- `latest-artifact.ts:222-226`. Three mutants survive every test (step 3): accepting `"2.5"`, accepting `"-1"`, and accepting `" "` (which would read 0).
- The step 6 property test holds for every generated input except `-0`: `countOrNull(-0)` returns `-0`. That is harmless, since JSON writes it as `0`.
- **Fix.** Add the three strings to the `chronicle-metadata` or `latest-artifact` test, expecting `null`, or add the step 6 property (`scripts/step6_invariants.test.ts`, fast-check is already a package dependency).

### 4. Item 4's test-first record is weaker than "each fix landed as a failing test" (process)

- At `6843fe0` the FSA detail test fails at `ed-fsa-family.test.ts:809@6843fe0`. That line asserts that a *single*-fact target carries `member_fact_count: null, member_fact_keys: []`, a premise that `a5e604e` then removed. It never reaches the member-fact assertions.
- `6843fe0`'s test still fails against `a5e604e`'s code (`logs/step2-item4-testcommit-tests-on-a5e604e.log`).
- I checked the other direction. `a5e604e`'s final test fails on the pre-fix code at the member-fact assertion (`:829`, the fact keys are not null; `logs/step2-item4-fixcommit-tests-on-6843fe0-code.log`). So the shipped test does test the change.
- The hand-off discloses the premise change. No code change is needed, but the body's sentence overstates the record.

### 5. Stale line citations (docs)

- `ed-fsa-family.test.ts:686` cites the comparison's sort as `:3304-3308`. That was right `@2306113`; at the head it is `latest-artifact.ts:3391-3395`, since the PR's own additions moved it. Naming the file and function would keep it stable.
- The body's `microcosm-targets-view.tsx:287` should be `:291`, as the hub found.
- Every other citation I checked holds (step 7).

### 6. A lookup by a member fact finds nothing and says nothing (judgment call, follow-up)

See step 5, call 1. I recommend a not-found answer that names the targets listing the key among their `member_fact_keys`, rather than making the lookup find the aggregate.

### 7. Smaller notes (no change needed)

- **`level` reads null for two cases.** In the comparison, `categoryLevels(group, null)` gives `level: null` both for a category at two levels and for one with no level (`levels: []`; step 6 counterexample `[]`). The body documents this. A reader has to look at `levels` to tell the two apart.
- **The grouping key can collide in principle.** `statisticGroupKey` joins levels with `+` (`frontend/lib/microcosm/statistic-groups.ts:16-17`), so `levels: ["a+b"]` and `["a","b"]` give one key. No level id contains `+`.
- **A category whose first row has no level.** For such a category the new key differs from base's: `[{level: null}, {level: "country"}]` keys on `country` at head and on `""` at base (step 6). No fixture has such a category: the grouping is unchanged on every fixture (step 4).
- **The skip match on the record id is latent.** `targetNames` (`:1037-1046`) still matches a skip entry by the representative's record id (`:1043`). A skip entry naming a *different* target whose name equals that record id marks the aggregate "Skipped". That happens at base and at head (`logs/step5-skipped.txt`). No FSA target has that name, and the release gate fails any release with a skipped target (`_release_gate_failures`, `tools/build_us_fiscal_refresh_release.py:9398-9399`), so only staging runs could show it.

## Steps

### 0. Preflight

`gh api repos/PolicyEngine/calibration-diagnostics/pulls/277 --jq '.head.sha, .base.sha'` returned `43c62d2f…` and `2306113f…`, as briefed. The PR is open and a draft, with 11 commits.

### 1. The runs (bun 1.4.4, `bun install --frozen-lockfile` in `frontend`, as CI does)

| Command | `2306113` | `43c62d2` |
| --- | --- | --- |
| `frontend/packages/calibration-tree`: `bun test` | 413 pass, 0 fail (36 files) | 413 pass, 0 fail (36 files) |
| `frontend`: `bun test` | 864 pass, 0 fail (99 files) | 869 pass, 0 fail (101 files) |
| `frontend`: `bun run lint` (both `tsc`) | exit 0 | exit 0 |
| package: `bun run typecheck` | exit 0 | exit 0 |

These match the PR body. Logs: `logs/step1-*.log`. The `frontend` suite also runs the package's tests (its failures in step 3 name package tests).

### 2. Test first (`scripts/step2.sh`, logs `logs/step2-*.log`)

| Item | At the test commit | At the fix |
| --- | --- | --- |
| 1: `4ea7712` → `8771c0a` | 3 fail, 1 error. Two FSA tests fail for the reason their names give: `variable.levels` is `undefined` where `["country","state"]` is expected (`:464`), and the compared levels are missing. `statistic-groups.test.ts` errors with "Cannot find module './statistic-groups'". | 16 pass, 0 fail |
| 2: `567274f` → `1da6cc0` | 1 fail, 1 error: "Cannot find module './target-filter-options'" | 2 pass, 0 fail |
| 3: `49f397e` → `f4e1ef5` | 2 fail. The FSA detail reads `universe_constraint_count: null`, expected `1`, and the legacy Ledger test reads `null`, expected `2`. Both are the reason the commit names. | 103 pass, 0 fail |
| 4: `6843fe0` → `a5e604e` | 1 fail at `:809`, a single-fact premise, not the member facts (finding 4) | 13 pass, 0 fail |
| 6: `45b72e0` → `43c62d2` | 1 fail: the facets include `ed_fsa.borrower_location` with the 51 states | 13 pass, 0 fail |

- Items 1 and 2 add new modules, so their unit tests can only fail on the missing module. Step 3 shows those tests do catch the bugs they name.
- The fix commits of items 4 and 6 also edit tests. `45b72e0`'s test passes unchanged on `43c62d2` (the fix rewords a comment only). `6843fe0`'s doesn't pass on `a5e604e` (finding 4).

### 3. Mutations (`scripts/step3_mutations.py`, a scratch worktree at the head; logs `logs/step3-*`)

Each mutation is one exact replacement in a scratch worktree at `43c62d2`, reverted after its run. The first seven ran both the package suite and the `frontend` suite (`logs/step3-summary-part1.txt`). The rest ran only the `frontend` suite, which includes the package tests (`logs/step3-summary-part2.txt`). "FSA:" names a test in `ed-fsa-family.test.ts`.

| Mutation | Failing tests (frontend suite) |
| --- | --- |
| `categoryLevels` (`:1553`) gives the first row's level | 2. FSA: "a category at two levels is listed at both"; FSA: "a compared category at two levels reports both, whichever row's fit changed most" |
| `categoryLevels` gives a single-level category `null` | 3. The two above, plus FSA: "the targets page lists the family under its provider, at both levels" |
| `statisticGroupKey` keys on `level` alone | 1. "statistic groups > a category at two levels keys on both" (no package test) |
| `statisticGroupKey` joins `levels` with `""` | 1. Same test |
| `sourceFilterOptions` labels each option with its value | 1. "a source reads as the page names it, its value the raw id" |
| `levelFilterOptions` labels each option with its value | 1. "a level reads as the calibration map's filter names it" |
| `countOrNull` (`:222`) uses `numberOrNull` | 2. "legacy Ledger metadata populates the complete Chronicle contract"; FSA: "a target's detail shows its Chronicle fact" |
| `countOrNull` accepts `"2.5"` | **none** (survives) |
| `countOrNull` accepts `"-1"` | **none** (survives) |
| `countOrNull` accepts `" "` (reads 0) | **none** (survives) |
| `shownChronicle` (`:519`) returns `row.chronicle` | 1. FSA: "a target's detail shows its Chronicle fact" |
| `shownChronicle` keeps `source_record_id` | 1. Same test |
| … keeps `fact_key` | 1. Same test |
| … keeps `semantic_fact_key` | 1. Same test |
| … keeps `aggregate_fact_key` | 1. Same test |
| … keeps `legacy_fact_key` | 1. Same test |
| … keeps `layout_groupby_value_id` | 1. Same test |
| … keeps `universe_constraint_set_key` | 1. Same test |
| … keeps `universe_constraint_count` | 1. Same test |
| `targetResponseRow` (`:2783`) returns `row.chronicle` | 1. Same test |
| The investigation lookup (`:3234`) searches `candidate.chronicle` | 1. Same test |
| `investigationSearches` (`:2800`) drops the member-fact searches | 1. Same test |
| `investigationSearches` reads the raw `row.chronicle` | 1. Same test |
| `repeatsGeography` (`:916`) returns false | 1. FSA: "a mixed category's facets are its geographies and both bands" |
| `repeatsGeography` hides any dimension with one value per geography (the brief's first rule) | 1. "derives Belgium population region, sex, and age-band browser facets" (`latest-artifact.test.ts:251`), as the hand-off says |

Every part of each fix is caught by some test, except the three `countOrNull` mutants (finding 3). The whole of item 4 hangs on one test, so it is caught, but each field is checked only on the FSA aggregate (`linear_combination`). No test covers another multi-fact operation (finding 1).

### 4. Every other release the dashboard shows (`scripts/step4_readers.ts`, `scripts/step4_diff.py`, `scripts/step4_groups.py`)

- **Fixtures.** I ran the readers at `2306113` and at `43c62d2` on every calibration diagnostics fixture in the repo:
  - the four golden release inputs (US legacy, UK hierarchy, UK loss attribution, BE);
  - the four `target-loss-attribution` documents;
  - BE as schema 2;
  - `zz-release`;
  - `us-legacy-target-identities.json.gz`;
  - the FSA fixture as schema 8 and schema 9.

  `us-766b7c7-maine-targets.json` holds tree rows, not diagnostics, and the staging fixtures hold progress files, so neither applies.
- **Readers.**
  - `buildCalibration` (every row);
  - `latestMicrocosmCalibrationSummary`;
  - the targets page with no query (every page). With `variable`, `source`, `level` and `geography` alone, with `variable`+`level` and `variable`+`geography`, and with `scope=healthcare`, `include_families=1` and `within_tolerance=false`: 3,430 queries on the US release, 174 on FSA;
  - the calibration map drilled breadth-first from the root, up to 80 states per release;
  - `microcosmTargetTreemap` by program and by geography;
  - `latestMicrocosmTargetInvestigation` by every row's name, base name and each raw Chronicle key: 11,318 lookups on the US release;
  - `buildComparison(release, release)`.
- **Differences outside the FSA family** (`logs/step4-diff.txt`). Only two fields change:
  - **`variables[].levels` is added** on the targets page and in the comparison of every release. This is intended.
  - **`variables[].level` turns `null`** on 58 of the US release's 83 categories (`"national"` → `null`, `levels: ["national","state"]`), in the page's and the comparison's `variables`. This is intended (item 1). The statistic picker's groups and the "N statistics" count are unchanged on every fixture: 53 groups for US, with identical members (`logs/step4-groups.txt`).
  - **Nothing else changes.** No facet is hidden on any non-FSA release, BE regions and UK countries included. No Chronicle field changes on any non-FSA target, and no summary, map, treemap or investigation answer changes.
- **Differences in the FSA family**, all intended:
  - `universe_constraint_count` reads `1` or `2` instead of `null` on 30 rows, including `cal.rows[].chronicle`;
  - the excluding-Parent-PLUS row's shown Chronicle fields change;
  - the four lookups by the representative's record id and keys now find no target;
  - the four `level=state` or `variable`-filtered pages drop the Borrower location facet;
  - `level` is `null` on the two measure categories.
- **Production.** I couldn't compare against it. `curl https://calibration-diagnostics.vercel.app/...` and `https://huggingface.co/api/...` both fail with `CONNECT tunnel failed, response 403` (the agent proxy reports `connect_rejected`). So finding 1's reach into live UK and BE releases is unverified.

### 5. The judgment calls

**The hand-off's calls.**

- **Branch.** Fine.
- **`level: null` for a category at several levels, not a joined string.** I agree. No consumer outside the UI reads `variables[].level` (see call 4 below).
- **Grouping key** (`+` join, falling back to `level`). Fine. The fallback can't fire in production: both routes compute the answer in the same deployment (`app/api/microcosm/target-diagnostics/route.ts:22`; compare → `loadComparison`, `latest-artifact.ts:3436-3447`).
- **Fields nulled on a multi-fact target.** Right for `linear_combination` (call 2 below). Wrong for the ratio operations (finding 1).
- **Where the member facts appear.** I agree to keep them off single-fact rows. But they appear only in the APIs (finding 2).
- **The detail page has nothing to swap.** True. The targets list did have something: `dimensionSummary`'s group-by fallback (finding 2).
- **Facet rule.** I agree with the narrower rule.
  - Step 3 confirms that the brief's rule ("one value per geography") fails `derives Belgium population region, sex, and age-band browser facets` (`latest-artifact.test.ts:251`).
  - Step 4 finds no other release losing a facet. Step 6 finds no case where the rule hides Geography or a differing dimension.
- **Fix commits that touch tests.** Disclosed. See finding 4.
- **Docstring.** Fine. The `matrix.py` cites hold (`:301-306`, `:326-334`, `:327-332`).

**The brief's four.**

1. **Should a lookup by a member's id find the aggregate?** Not as a plain match.
   - One fact can be a member of many targets. For example, one CGT Table 1 share is the numerator of all twelve Table 5 region cells. So "find the aggregate" picks an arbitrary one.
   - At base the lookup did that silently, and showed the aggregate as if it were that member.
   - Better: keep `available: false`, but say which targets list the key among their `member_fact_keys`, with their names, so the workflow can continue. This is a follow-up, except for the ratio targets in finding 1, whose own keys must keep resolving.
2. **The fields kept from the representative, checked against the five members** (`scripts/step5_members.py`, `logs/step5-members.txt`). All five members are in microcosm's Chronicle fixture.
   - The same on all five: `dimension_set_key` (`…44136fa3…`), `dimensions` (`{}`, so `filters` are empty), `layout.record_set_id`, `layout.groupby_dimension` (`ed_fsa.loan_type`), `layout.measure_id`, `canonical_concept`, `source_concept`, period, geography, unit, `observed_measure_key`, entity and aggregation.
   - Different: `lineage.source_record_id`, `universe_constraints`, `universe_constraint_set_key` and `layout.groupby_value_id`, all of which the PR nulls. Also `dimension_value_labels`, which the dashboard doesn't show.
   - The members carry no `value_operation`. The shown `linear_combination` comes from the target's own `ledger_value_operation`, so it is correct to keep.
3. **What the dashboard shows when calibration skips a multi-fact target** (`scripts/step5_skipped.ts`, `logs/step5-skipped.txt`). A skip entry naming the aggregate, with or without `@2024`, marks its row "Skipped" with the entry's reason, at both base and head. A skip entry naming the representative's record id also marks the aggregate "Skipped" (finding 7). Published releases can't carry a skipped target because the gate fails them (`tools/build_us_fiscal_refresh_release.py:9398-9399`).
4. **Consumers of `variables[].level` outside the UI.** None.
   - `frontend/scripts/score_external_dataset.py:120-` calls `/api/microcosm/target-diagnostics` but reads only `targets[]`.
   - README and docs describe the routes but not that field.
   - No Python, script, workflow or telemetry code reads the comparison's `variables`.

### 6. Invariants (`scripts/step6_invariants.test.ts`, `scripts/step6.sh`; fast-check 4.10.2, seed 277, 20,000 runs each; logs `logs/step6-run*.log`)

**Strict run: 4 pass, 3 fail.** The minimal counterexamples:

- **`countOrNull(-0)` returns `-0`.** It is a safe integer and `>= 0`, so harmless.
- **`categoryLevels([], null)` gives `level: null` with `levels: []`.** That is the comparison's documented no-level case. With `none = ""` (the targets API) the property holds.
- **The base key and the new key differ for `[{level: null}, {level: "country"}]`.** See finding 7.

**What holds.** `countOrNull` reads `n` and `String(n)` as `n` for every safe non-negative integer. `categoryLevels` gives sorted, unique, non-empty levels. `statisticGroupKey` equals `[source, level, variable].join("::")` for every single-level row, including adversarial `a::b` and `x+y` tokens. `repeatsGeography` never hides Geography, nor a dimension that differs from some row's geography.

**Scoped run: 7 pass, 0 fail.** With each property limited to its documented scope, nothing else fails.

**Should the PR add it?** Yes for `countOrNull`, which closes finding 3. The others are cheap (a second or two in total) and pin the facet rule; I'd add the `repeatsGeography` one too.

### 7. A fresh read of the diff and body

- **The brief's example (`MicrocosmVariableRow.levels` required while `statisticGroupKey` tolerates its absence).** No runtime path produces a variable row without `levels`. Both routes compute their answer per request in the same deployment, and the staging path calls the same `microcosmVariableSummary`. So the type is accurate and the fallback is defensive, unreachable code. `VariableGroup.levels` (`microcosm-targets-view.tsx:62`, `:294`) is set but never read.
- **Claims not supported by the code.** Finding 2 (member facts reach users through the page). The body's "the fields that belong to one member" is true for the FSA operation only (finding 1).
- **Citations.** Finding 5. These hold:
  - `latest-artifact.ts:1526@2306113` and `:3220@2306113`;
  - `microcosm-targets-view.tsx:259-266@2306113`, `:760-763@2306113` and `:775-778@2306113`;
  - `calibration-target-navigation-cards.tsx:94-100@2306113`;
  - `calibration-explorer-filter-menu.tsx:96`;
  - `calibration-tree.ts:601-610`;
  - `latest-artifact.test.ts:251`;
  - microcosm `registry.py:149-150` (`packages/microcosm-calibrate/src/microcosm/calibrate/registry.py`), `ledger_targets.py:5913` and `:1321-1327`, and `matrix.py:301-306`, `:326-334` and `:327-332`.
- **Checks that can't fire.**
  - The `statisticGroupKey` fallback (above).
  - `stringListOrEmpty`'s non-string branch only matters if a release writes `ledger_member_fact_keys` as a JSON array. Microcosm writes a string (`ledger_targets.py:1322-1327`), and `TargetSpec` stringifies every value anyway.
- **Tests that can't fail.** None found. Every mutation of a fix's core logic fails some test, except the three `countOrNull` mutants (finding 3); see step 3.
- **Other.**
  - `ledger_member_fact_keys` can hold a source record id where a member has no fact key (`_fact_key(fact) or _source_record_id(fact)`, `ledger_targets.py:1321`). The investigation labels each one "Member fact", which is fine. A UI would need to label it as either.
  - `sourceFilterOptions` takes the first non-empty `source_label` among a source's categories. If categories of one source carry different labels, the option shows whichever comes first. That's harmless, and it is how the statistic picker reads it too.

## Files

- `logs/`: steps 1–4 and 6, plus the step 5 and 7 outputs. Step 4's raw reader outputs (1.5 GB per side) aren't committed. `scripts/step4_readers.ts <worktree> <outdir>` regenerates them at either commit, and `logs/step4-diff.txt` and `logs/step4-groups.txt` are their diffs.
- `scripts/`: every script this review ran.
- What wasn't run: the production comparison and the live UK and BE releases (both blocked by the egress proxy, step 4), and `bun run build` (CI's build passed at the head; I didn't rerun it).
