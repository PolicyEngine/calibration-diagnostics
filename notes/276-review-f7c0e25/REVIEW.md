Head reviewed: `f7c0e259e3e5a8533ad676f55d8d669ba90ebb7c` (PolicyEngine/calibration-diagnostics#276, unchanged since the brief). Verdict: **APPROVE with follow-ups**.

Microcosm is cited at `0ff293b1a335a29d46f1598f2039beffa242e632` (microcosm#1357), and this repo at `f7c0e25`. I read or ran everything stated here in this session. The logs are in `logs/`, and the three scripts I wrote are in `scripts/`.

**The four fixes landed.**

- **Finding 1.** The two pinned tests now fail under the last review's patch A, under its patch B, and under a blanked level.
- **Finding 2.** I checked the fixture's metadata against microcosm's own code rather than against a restatement. I ran microcosm's real `compile_ledger_target_references` → `apply_fsa_student_loan_plan` on the pinned facts, and it gives the fixture's metadata exactly on all 132 rows: every key, every value and the key order. Every non-metadata field matches too.
- **Findings 5 and 6.** The body's six corrections are made, and `source_period` now comes from the plan's reference period.
- **The runs.** The fixture rebuilds byte for byte, twice. All counts reproduce: 413/0, 864/0, lint and typecheck pass, and CI is green.

**What is still wrong.** One stage runs after the plan's apply step in a default release: `age_us_dollar_targets`. It adds four metadata keys to every FSA row, and the fixture has none of them. So "key for key" is still not true. No dashboard reader or test reads those keys, so nothing shown is wrong. The fix is a few lines, or a reworded claim (finding 1 below). It doesn't block the merge, but the claim is in the PR body and the builder's docstring, so I'd correct it in this PR.

## Findings, most severe first

### 1. A default release adds four aging keys to every FSA row, and the fixture omits them; "key for key" overstates (low)

`frontend/packages/calibration-tree/src/fixtures/ed-fsa-family/build_fixture.py:43-44`, `:66-69` and `:860-890` (`row_metadata`, whose docstring at `:861` says "key for key"), and the PR body's "Each row's `metadata` is what a release writes for that target, key for key".

- **The stage.** The hand-off left open whether anything runs between `apply_fsa_student_loan_plan` and `diagnostics.py:228`. Something does:
  - `compile_us_fiscal_target_registry` calls the apply step at `fiscal_targets.py:1101-1103`.
  - It then runs seven passes (`:1104-1140`). Six of them key on other families or on keys no FSA spec carries (see step 2).
  - The seventh, `age_us_dollar_targets`, runs `if age_targets:` (`:1126-1135`).
  - The release tool passes `age_targets=args.age_targets` (`tools/build_us_fiscal_refresh_release.py:13002-13013`), and `--age-targets` defaults to `True` (`:1868-1871`).
- **What it writes.** `_age_spec` (`target_aging.py:337-369`) sends every FSA spec through `_with_aging_metadata` (`:664-682`), which adds `basis`, `aged_to`, `aging_factor` and `aging_factor_source`, and re-sets `source_period` to its existing value. `_not_ageable_reason` (`:455-483`) gives:
  - **67 `sum` rows** (balance, Parent PLUS and excluding Parent PLUS): `aging_factor_source` = `stock_at_source_reference_date`, from `period_alignment` (`:472-474`).
  - **65 `indicator_sum` rows** (borrowers): `aging_factor_source` = `not_dollar_amount` (`:470-471`).
  - **All 132 rows:** `basis` = `fact`, `aged_to` = `2024`, and `aging_factor` = `1` (`_format_float` is `f"{value:.15g}"`, `:711-712`).
- **Concrete case** (`logs/step2-release-metadata.log`). I ran microcosm's own modules, and `age_us_dollar_targets` was one of them (`scripts/release_specs.py`). The release has those four keys on all 132 rows and the fixture lacks them. No other key is missing, extra or different. The test of microcosm's that pins this stage is `test_aged_compile_keeps_fsa_dollars_at_the_reference_date` (`test_us_fsa_student_loan_targets.py:248-256`, one of the nine pinned files).
- **What is shown wrong today.** Nothing:
  - No file in `frontend/` reads `basis`, `aged_to`, `aging_factor` or `aging_factor_source`.
  - The only aging-related key a reader takes is `source_period` (`latest-artifact.ts:462`, `:2871`), and aging leaves it at `2026-03`.
- **Smallest fix.** Pick one:
  - (a) Append the four keys in `row_metadata` after `target_period` (about 8 lines). Cite `target_aging.py:455-483` and `:664-682`, `fiscal_targets.py:1126-1135`, and the release default `build_us_fiscal_refresh_release.py:1868-1871`. Add `target_aging.py` (sha256 `b4dc33e1cabbebdec806325a24ca7d863068d517b39e2724ee6562164c1c9170`) and `fiscal_targets.py` (sha256 `19ec9db17110ef8d8db16c7c7d23cee8efdc4231d2d59fc1221cba7d7317df41`) to `SOURCES`.
  - (b) Change the docstring (`:43-44`, `:861`) and the PR body to say "up to `apply_fsa_student_loan_plan`". Name the four keys in the omitted list at `:57-69`, replacing its third bullet, which now has an answer.

### 2. `universe_constraint_count` is null for every release, and two existing tests feed it a shape no release writes (low; follow-up, not this PR)

This is the hand-off's observation, and it holds (step 6).

- **Where.** `latest-artifact.ts:482` reads `numberOrNull(metadata.ledger_universe_constraint_count)`, and `numberOrNull` (`:215-217`) accepts only numbers.
- **Why it is always null.** Microcosm writes the value as `str(len(constraint_rows))` (`ledger_targets.py:5913`). `TargetSpec.__post_init__` also turns every metadata value into a string (`registry.py:149-150`). So no release metadata value is ever a number, and `numberOrNull` of any release metadata key is always null.
- **Who reads it.** No page or component. It reaches clients only through the `chronicle` block of the API JSON (`app/api/microcosm/target-investigation/route.ts`, typed at `lib/api/hooks/use-microcosm.ts:166`). Nothing outside `frontend/` mentions it.
- **The two tests.** `latest-artifact.test.ts:1201` (expecting `2` at `:1247`) and `chronicle-metadata.test.ts:27` pass a number, so they pin a path that real releases never take.
- **Smallest fix.** Parse the string, for example `const n = Number(stringValue(metadata.ledger_universe_constraint_count)); universe_constraint_count: Number.isInteger(n) ? n : null`, and make those tests pass a string. With that reader change, the FSA test file still passes 13/0 (`logs/step3-detail-test-mutations.log`).

### 3. One detail-test assertion can't fail, and three check the fixture rather than a reader (nit)

`frontend/packages/calibration-tree/src/ed-fsa-family.test.ts`:

- **`:718`, `expect(detail.available).toBe(true)`.** This can't fail. `investigate` (`:711`) already throws when `detail.available` is false. Delete it.
- **`:736`, `expect(metadata.ledger_fact_key).toBe(metadata.ledger_aggregate_fact_key)`.** This reads the fixture JSON (`fsaRows`), not a reader's output, so no dashboard change can make it fail.
- **`:805-808` (`ledger_member_fact_count` and the length of `ledger_member_fact_keys`).** These read the row's raw `metadata`. They fail only if the fixture changes, or if `buildCalibration` stops passing metadata through.

These are harmless, and the fixture's values are right (finding 2 of the last round, now checked against microcosm's code). Just don't count them as reader coverage.

### Carried over (unchanged, already follow-ups in the body)

- The last review's findings 3 and 4 are still true and correctly listed as Follow-ups 1 and 2:
  - debt-size bands sort alphabetically;
  - the excluding-Parent-PLUS target names `stafford_unsubsidized` as its record.

  The new detail test pins finding 4 (`:788-809`).
- Neither is a blocker.

---

## Step 0: Preflight

- `gh api repos/PolicyEngine/calibration-diagnostics/pulls/276 --jq .head.sha` gave `f7c0e259e3e5a8533ad676f55d8d669ba90ebb7c` at the start and again before writing. The PR is open and a draft, on branch `claude/student-debt-dashboard-check-9bj125`, based on `main`.
- `curl -fsSL https://raw.githubusercontent.com/PolicyEngine/microcosm/0ff293b…/README.md` worked.
- I read:
  - the last review (`notes/276-review-6ffe94c/REVIEW.md` and its logs);
  - the hub's review 5759393693;
  - the hand-off (issue comment 6615679637);
  - the PR body;
  - `CLAUDE.md`.
- I reviewed in a detached worktree of `f7c0e25` in the session scratchpad. Each patch below was reverted, and `git status` was clean after every step.

## Step 1: Reproduce the fixture

- **Sources.** I fetched the nine `SOURCES` files at `0ff293b` into their own directory, at their repository paths. All nine sha256s equal `build_fixture.py:90-115` (`logs/step1-sources.log`).
- **Build.** I copied the script to a separate directory and ran `python3 -I build/build_fixture.py mc > outN.json` twice (Python 3.13.18). Both runs exited 0. `out1.json`, `out2.json` and the committed `ed-fsa-family-schema-8.json` all hash to `3f0c8454d2a0f4144b1e0a8b1d49ed5f89b3b9f6eca8bc8bc4415c9d872359ed`, and `cmp` finds both outputs byte-identical to the committed file (`logs/step1-build.log`).

## Step 2: Did each fix land?

### Finding 1 (pinned tests): landed

I ran each patch against `latest-artifact.ts` at `:1526` and `:3220`, ran `bun test src/ed-fsa-family.test.ts`, and restored the file (`logs/step2-finding1-pinned-tests.log`):

| Patch | Result | Which tests fail |
| --- | --- | --- |
| None | 13 pass, 0 fail | — |
| Last review's patch A (`"mixed"` / `null`) | **11 pass, 2 fail** | "a category at two levels is listed at its first row's level" (expected `"state"`, got `"mixed"`) and "a compared category at two levels takes the level of the row whose fit changed most" |
| Last review's patch B (`"country,state"`) | **11 pass, 2 fail** | The same two |
| Level blanked (`""` / `null`) | **10 pass, 3 fail** | The same two, plus "the targets page lists the family under its provider, at both levels" |

This matches the hand-off. The old `test.failing` problem is gone.

### Finding 2 (metadata): landed up to the apply step; one stage after it is still missing (finding 1 above)

**Method.** I checked the fixture against microcosm's own code instead of restating it again.

- `scripts/release_specs.py` imports microcosm's real files at `0ff293b`: `ledger_targets.py`, `fsa_student_loan_targets.py`, `target_aging.py`, and `calibrate/{hierarchy,registry,target,provider_labels,variable_labels,geography_constants}.py`.
- It stubs three things only: `LexicalFloat` (a float subclass that never gets created, because the facts load with `json.loads`), `microcosm.frame.Frame` (an annotation only), and a `microcosm.calibrate/__init__` that re-exports the real modules.
- It runs:
  1. `plan_fsa_student_loan_targets(facts, target_period=2024)`;
  2. `compile_ledger_target_references(facts, plan.references, country="us")`;
  3. `apply_fsa_student_loan_plan(...)`;
  4. `age_us_dollar_targets(...)`.

  The facts are the pinned `us_fsa_portfolio_chronicle_347_facts.jsonl.gz`. The hashes of every file are in `logs/step2-extra-sources.log`.
- `scripts/compare.py` diffs that output against the fixture for all 132 rows (`logs/step2-release-metadata.log`).

**Results:**

- **After `apply_fsa_student_loan_plan`:**
  - **Metadata.** No key is missing, none is extra, no value differs, and the key order is identical on all 132 rows.
  - **Every other field also equals microcosm's spec on every row:** the name and period, `source`, `entity`, the target value, `registry.family`, and `hierarchy.provider`, `.category`, `.geography`, `.dimensions` and `.target`.
- **After `age_us_dollar_targets`:** every row also carries `basis`, `aged_to`, `aging_factor` and `aging_factor_source` (finding 1). Their values by measure mode:

  | `measure_mode` | Rows | `aging_factor_source` |
  | --- | --- | --- |
  | `sum` | 67 | `stock_at_source_reference_date` |
  | `indicator_sum` | 65 | `not_dollar_amount` |

  Every row has `basis` `fact`, `aged_to` `2024` and `aging_factor` `1`.

**Five rows, one of each kind, key by key.** `logs/step2-release-metadata.log` lists every key, with microcosm's value and the fixture's. The rows are:

- Alabama balance;
- "24 and Younger" borrowers;
- debt size "10K to 20K" balance;
- Parent PLUS;
- balance excluding Parent PLUS.

After the apply step they have 52–59 keys (56–63 after aging). Where each key comes from in microcosm:

- **`_ledger_metadata` of the representative fact** (`ledger_targets.py:5855-5920`, merged at `:1086-1089`). These are the `ledger_*` keys:
  - empty values are dropped (`:5920`), so `ledger_legal_vintage` and `ledger_fact_period_label` never appear for FSA;
  - `ledger_universe_constraint_count` is set only when the fact has constraint rows (`:5911-5913`);
  - the `ledger_filter_*` band edges come from `_constraint_bound_filters` (`:5936-5967`). For example, the age band gives `ledger_filter_age_upper_bound` = `25`, and "10K to 20K" gives the balance `_lower_bound` = `10000` and `_upper_bound` = `20000`. Every bound in the facts is a JSON integer, so `str(value)` is the same whichever loader reads the facts.
- **`_multi_fact_reference_metadata`** (`:1318-1341`). These keys appear on the balance excluding Parent PLUS only:
  - `ledger_member_fact_count` = `5`;
  - the two member-key payloads and their digest;
  - no `ledger_aggregation_varying_dimensions`, because the members' `dimensions` are all `{}`.
- **`publication_metadata`** (`:1036-1056`). It adds nothing: identity takes the `else` at `:1010-1011` and `linear_combination` takes `:965-975`, so `value_metadata` stays `{}` (`:933`).
- **`ledger_resolved_assertion`** (`:1093`, via `_fact_assertion` at `:5004-5005`): `observation`.
- **`_reference_metadata`** (`:5388-5453`):
  - the plan's keys (`fsa_student_loan_targets.py:572-586`), then `ledger_value_operation`, `ledger_assertion_policy` (the default `observed_only`, `:277`) and `ledger_period_match_policy` (`exact`, `:595` and `:613`);
  - for the linear combination, `ledger_value_formula` (`+operand_0 … +operand_4`; the operands carry only `source_record_id` and `weight`, so `_linear_combination_operand_label` falls back to `operand_<i>`, `:3660-3676`) and `ledger_selector_source_name` = `ed_fsa` (`:5442-5446`).
- **The apply step** (`fsa_student_loan_targets.py:398-413`): it drops `diagnostic_target_label`, then adds the reconciliation keys, `fsa_published_value` and `target_period` (which is already present, so its position is kept).
- **Aging** (`target_aging.py:664-682`): `basis`, `aged_to`, `aging_factor` and `aging_factor_source`. These are the only keys the fixture lacks.

**The three omissions the hand-off lists:**

- **`diagnostic_target_label`. The omission is correct.**
  - `_diagnostic_target_label_metadata` (`ledger_targets.py:5998-6018`) stamps it at the compile on 131 of the 132 specs. The one exception is the linear combination, because `len(facts) != 1` (`:6005-6006`).
  - `apply_fsa_student_loan_plan` drops it (`fsa_student_loan_targets.py:398-402`). The run confirms both, and microcosm's own test asserts its absence (`test_us_fsa_student_loan_targets.py:241`).
- **The `publication_metadata` keys. The omission is correct**, as shown above: the dict is `{}` for both FSA operations.
- **The stage between the apply step and `diagnostics.py:228`. There is one, and it adds four keys.** The full chain, at `0ff293b`:
  1. `fiscal_targets.py:1101-1103`: apply.
  2. `:1104` `_uprate_cross_period_eitc_decompositions`: acts only where `requires_total_eitc_uprating == "true"` (`:1466`). No FSA spec has it.
  3. `:1105` `_with_derived_chip_enrollment_targets`: `cms_medicaid` keys only (`:1296-1298`).
  4. `:1106` `_without_m_chip_state_chip_enrollment_targets`: `family == "cms_medicaid"` only (`:1357-1360`).
  5. `:1107-1116`, the taxable-interest and capital-gains rebases: these key on `source_measure_id` in `{taxable_interest_amount, taxable_interest_returns}` (`:363-364`, `:1976-1987`) and `{net_capital_gains_amount, net_capital_gains_returns}` (`:1653-1664`). FSA's are `dollars_outstanding` and `borrowers`.
  6. `:1117` `_rebase_soi_state_agi_bands`: only specs flagged `_SOI_STATE_AGI_BAND_REBASE_FLAG == "true"` (`:2083-2084`, `:2110`).
  7. `:1118-1125` `apply_ledger_target_profile` (`ledger_targets.py:740-774`): the US profile's only rule is `congressional_district_children_scale_to_state_parent` (`us/fiscal_target_references.json`). It rewrites only congressional-district children, and FSA has none.
  8. **`:1126-1135` `age_us_dollar_targets`, on by default in a release: adds `basis`, `aged_to`, `aging_factor` and `aging_factor_source`** (finding 1).
  9. `:1136-1140` `enforce_period_contract` (`target_aging.py:300-334`): this adds `period_contract_waiver` only on a violation. Microcosm's test asserts that FSA has none (`test_us_fsa_student_loan_targets.py:240`, `:245`).
  10. In the release tool:
      - `_select_target_surface` (`:9118-9145`) and `_compile_materialized_target_registry` (`:6195-6213`) filter specs and don't rebuild them.
      - `TargetSpec.to_target` (`registry.py:242-255`) passes `metadata` through, and `diagnostics.py:228` copies `target.metadata`.
      - I didn't read `apply_us_medicaid_enrollment_substitutions` (`build_us_fiscal_refresh_release.py:13041-13043`) beyond its name and its comment, which describe CMS Medicaid enrollment substitutions. Nor did I read the solve path between `to_target` and `result.problem.targets`.

### Findings 5 and 6 (body and `source_period`): landed

- **The body's six corrections.**
  1. **The comparison level.** The body now says the level comes from the largest fit change in general (`latest-artifact.ts:3304-3308`, read) and from the matcher's order in the test. The pinned test asserts the first row is the "24 and Younger" age band (`ed-fsa-family.test.ts:686-689`), and it passes. **Correct.**
  2. **"No page shows that level."** The level is only part of the key in `groupVariables` (`microcosm-targets-view.tsx:259-266`) and in `variableGroupCount` (`calibration-target-navigation-cards.tsx:93-101`). `VariableGroup.level` is set (`:293`) and never rendered: the file's other `level` uses are the row facet (`:222`) and the level filter state (`:504`, `:593`, `:607`, `:769`). **Correct.**
  3. **The pinned tests replace the `test.failing` text.** The body says "Two plain tests pin today's values, so either one fails once someone changes its reader". Step 2 shows that. **Correct.**
  4. **The "two exceptions" sentence is gone. Correct.**
  5. **Debt-size order now names the calibration map too**, and Follow-up 1 names the hierarchy reader's `rank`. The cited `hierarchy.py:66-73` (the decorator through `value_label`) and `ledger_targets.py:1578-1610` match the code. **Correct.**
  6. **"The fixture writes the full metadata".** The body says "Each row's `metadata` is what a release writes for that target, key for key". **Still overstated by the four aging keys** (finding 1).
- **Body citations I checked:**
  - `ledger_targets.py:1085-1095` and `:1086-1089`;
  - `:1232-1245`;
  - `fsa_student_loan_targets.py:398-413`;
  - `microcosm-targets-view.tsx:760-763` and `:775-778` (the options use `label: value`);
  - `calibration-tree.ts:602-610`;
  - `chronicle-entry-url.ts:3` (`PACKAGE_BY_SOURCE_TABLE`).

  All match the code.
- **`source_period`.** `build_fixture.py:594` now writes `plan["reference_period"]`, as microcosm's `:579` does. The builder checks the restated `reference_period` against the receipt's `fsa.reference_period` (`:933-939`), and the run above gives the same value (`2026-03`). **Fixed.**

## Step 3: The new tests

| Test | Lines | Asserts | Would it catch a reader that shows the family wrongly? |
| --- | --- | --- | --- |
| Pinned summary level | `451-470` | Each mixed category's rows split into 14 `country` and 51 `state`; the summary's `n_targets` is 65; `level` is `"state"` and equals `rows[0].level` | **Yes.** It fails under patches A and B and under a blanked level (step 2). `:468` repeats `:466` for the fixture's order, but it can fail. |
| Pinned comparison level | `673-701` | In `buildComparison(release, release)` every FSA category reads `country`, and each mixed category's first row is the "24 and Younger" band; with Alabama's balance missing by 100%, it sorts first and the balance category reads `state` | **Yes.** It fails under A, B and a blank. It also pins the sort by `abs_rel_delta`, so a change to that sort fails `:699`. |
| Target detail | `706-810` | For Alabama balance, "24 and Younger" borrowers, "10K to 20K" balance, Parent PLUS and excluding Parent PLUS: `measure_concept`, `source_concept`, the `ledger_filter_*` band edges, the four fact keys, the record id and `value_operation`; for excluding Parent PLUS, the representative `stafford_unsubsidized` record and the lookup of that record finding the aggregate | **Yes**, for the fields it lists. I mutated `chronicleFactFields` four ways (measure concept read from the source concept, filters dropped, fact key read from the legacy key, value operation dropped), and each mutation failed it: 12 pass, 1 fail each (`logs/step3-detail-test-mutations.log`). |

**Assertions that can't fail, or don't test a reader:** see finding 3 (`:718`, `:736` and `:805-808`).

**Not covered:**

- The detail page's rendered output (`microcosm-target-detail.tsx`). The test stops at the API object.
- `universe_constraint_count`, `period_type`, the geography and entity fields, and the layout fields other than the record id. The first is the defect in finding 2.

**Against the old fixture** (`logs/step3-detail-test-old-fixture.log`). I swapped in the fixture from `6ffe94c` (sha256 `ee283be7…`) and ran the `f7c0e25` test file: **12 pass, 1 fail**. The failure is "a target's detail shows its Chronicle fact": `measure_concept` comes back null where `"ed_fsa.dollars_outstanding"` is expected, and the fact keys come back null where the fixture's values are expected. This matches the hand-off. I restored the fixture, and its hash was `3f0c8454…` again.

## Step 4: A fresh read of the diff against `main`

The diff touches six files: the `ed_fsa` label, its two tests, the fixture, the builder, and `ed-fsa-family.test.ts`.

- **The builder.** I ran microcosm's own code and compared its output with the builder's on every field the fixture carries (step 2). They agree everywhere except the four aging keys. So I found no field the builder derives differently from microcosm, up to the apply step. Its checks:
  - **Restated plan against the receipt** (`:933-946`): the reference period, the label, the controls, the target names and every value, with exact float equality. These can fail; the receipt and the run agree.
  - **Source hashes** (`:917-920`): these can fail.
  - **`len(rows) != 132`** (`:976`): this can fail.
  - **`member_facts` for excluding Parent PLUS** (`:899-910`): this selects by record set, not by the plan's `others` list (`:543-547`), and nothing checks that the two sets agree. They do agree, because the run's `ledger_member_fact_keys` and value equal the fixture's. A check that `members == planned others` would make that explicit.
  - **`fsa_plan`'s `parent_plus[0]`** (`:543-550`): this assumes exactly one Parent PLUS row and doesn't check it. That is harmless at the pinned facts.
- **The tests.** Covered in step 3 and finding 3.
- **The body.** Covered in step 2, findings 5 and 6. The only unsupported claim left is "key for key" (finding 1). Its counts are reproduced in step 5.
- **Label commit `369335f`.** It is unchanged since the last review (`source-labels.ts:16`, `source-labels.test.ts:18-22`, `fact-presentation.test.ts:185-193`). It is fine.

## Step 5: The runs

- **Setup.** I followed the README and CI (`.github/workflows/ci.yml:30-53`): `cd frontend && bun install --frozen-lockfile` with bun 1.4.4 installed 358 packages and exited 0 (`logs/step5-install.log`).
- **CI at `f7c0e25`.** It is green: frontend · tests, frontend · typecheck · build, hosted Python · dependencies · source APIs, Vercel Preview Comments, and Vercel.

| Command | Result | Log |
| --- | --- | --- |
| `cd frontend/packages/calibration-tree && bun test` | **413 pass, 0 fail**, 8607 expects, 36 files | `logs/step5-calibration-tree-bun-test.log` |
| `cd frontend && bun test` | **864 pass, 0 fail**, 21935 expects, 99 files | `logs/step5-frontend-bun-test.log` |
| `cd frontend && bun run lint` (both `tsc --noEmit` runs) | exit 0 | `logs/step5-lint-typecheck.log` |
| `cd frontend/packages/calibration-tree && bun run typecheck` | exit 0 | `logs/step5-lint-typecheck.log` |

The pass and fail counts match the hand-off and the body.

## Step 6: The hand-off's observation

**It holds.** See `logs/step6-universe-constraint-count.log`.

- **The reader.** `chronicleFactFields` reads the field with `numberOrNull` (`latest-artifact.ts:482`), which returns non-null only for a finite `number` (`:215-217`).
- **What microcosm writes.**
  - `ledger_targets.py:5913` writes `str(len(constraint_rows))`.
  - `TargetSpec.__post_init__` coerces every metadata value with `str(value)` (`registry.py:149-150`), so no release can carry a number there.
  - In the fixture, all 30 values are strings.
- **So it is null for every release**, not just for FSA.
- **Who reads it:**
  - No component reads `chronicle.universe_constraint_count`. The `chronicle` fields components read are `domain`, `geography_id`, `geography_level`, `layout_groupby_value_id`, `layout_measure_id`, `layout_record_set_id`, `measure_concept`, `measure_unit`, `source_period`, `source_record_id` and `target_period`.
  - It ships in the API JSON only, through `app/api/microcosm/target-investigation/route.ts` (`latestMicrocosmTargetInvestigation`), typed at `lib/api/hooks/use-microcosm.ts:166`.
  - Nothing outside `frontend/` mentions it.
- **The two tests that pass a number** are in finding 2, with the fix.

## Logs and scripts

- `logs/step1-sources.log`, `logs/step1-build.log`: the source hashes, two builds and `cmp`.
- `logs/step2-extra-sources.log`: the microcosm files fetched beyond the nine, and the review harness's file hashes and stubs.
- `logs/step2-release-metadata.log`: microcosm's real output against the fixture, all 132 rows, then five rows key by key.
- `logs/step2-finding1-pinned-tests.log`: patches A, B and the blank against the pinned tests.
- `logs/step3-detail-test-old-fixture.log`: the detail test against the `6ffe94c` fixture.
- `logs/step3-detail-test-mutations.log`: the four reader mutations, plus the `universe_constraint_count` fix.
- `logs/step5-*.log`: install, both test runs, lint and typecheck.
- `logs/step6-universe-constraint-count.log`.
- `scripts/release_specs.py`, `scripts/compare.py` and `scripts/five_rows.py`. Run them as `python3 -I scripts/release_specs.py <pkg> <microcosm-files> out.json`, where `<pkg>` is assembled as `logs/step2-extra-sources.log` describes.
