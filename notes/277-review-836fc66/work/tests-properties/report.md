# Tests, exports and properties (checks 3 and 4)

No new production defect found in this slice. One minor hand-off count is wrong: `inputs/pr/handoff-6994-6639793646.md:33` says the count properties run `buildCalibration` 20,000 times **each**. The shape property does; the successful roundtrip property calls `shownCount` twice per generated `n` (`latest-artifact-invariants.test.ts:97`), hence 40,000 builds. Smallest fix: say 20,000 and 40,000, respectively. This is evidence-reporting accuracy, not a CI blocker.

## Environment and isolation

Bun is 1.3.12. No dependency installation, network, commit, push or publication occurred. `prepare.py` copies both supplied packages into this directory, copies final multi-fact tests and their added fixture into the old copy, and changes only `calibration-release-locator.ts`'s unrelated `readCalibrationTreeManifest` import to a local throw-if-called stub. The tested paths never call that boundary. A preload forbids fetch. These are isolated tests, not a CI reproduction.

The exact frontend formatter `components/shared/format.ts` is absent. `prepare_labels.py` resolves aliases locally and substitutes a clearly marked underscore-only formatter stand-in; source/tests otherwise match the inputs. The three changed/new neutral-wording assertions use no formatter on head. On old, the first two can never match the expected neutral phrase regardless of formatter output because the old code appends ` values`; the third simply returns `Female` because old reads the old flag. The unchanged fallback casing assertion uses the stand-in and does not independently verify the absent real formatter.

## Per-test old to new results

| Changed/new test at 836fc66 | 67e6d0b implementation | 836fc66 implementation | Evidence |
| --- | --- | --- | --- |
| target-row-labels:44, FSA excluded Parent PLUS neutral phrase | Fail | Pass | Isolated exact helper/test + formatter stand-in; old `Combines several loan type values`, new neutral phrase |
| target-row-labels:61, mixed-storage target neutral phrase (new) | Fail | Pass | Same isolation; old varying phrase, new neutral phrase |
| target-row-labels:76, listed dimensions + borrower-age group-by | Fail | Pass | Old `Female`, new `Female · Combines several source cells` |
| target-row-labels:90, all/none/fallback | Pass | Pass | Same branches; formatter caveat above |
| multi-fact-identity:314, renamed field's true/false/null/absent cases | Fail | Pass | Exact final test in isolated package: old new-field values are absent; head expected six cases |
| multi-fact-identity:389, three compiled probe targets (new) | Fail | Pass | Exact final test: old carries obsolete `layout_groupby_value_varies: true`, which is explicitly forbidden |
| latest-artifact-invariants:83, count shape via page | Expected pass | Expected pass | Fast-check unavailable; helper behavior unchanged; public deterministic witnesses pass both |
| latest-artifact-invariants:91, count roundtrip via page | Expected pass | Expected pass | Same; raw numeric and decimal-string values survive the public path |
| latest-artifact-invariants:143, category levels, none=`""` | Expected pass | Expected pass | Fast-check unavailable; unchanged helper reached by same summary reader; deterministic row-level equality witnesses pass both |
| same loop, none=`null` | Expected pass | Expected pass | Same; comparison with itself preserves distinct target identities and generated levels; deterministic witnesses pass both |
| latest-artifact-invariants:200, facet property via page | Expected pass | Expected pass | Fast-check unavailable; helper unchanged; public witness keeps real sex breakdown and hides geography repetition |
| statistic-groups:76, category key property via summary | Expected pass | Expected pass | Fast-check unavailable; summary groups nonempty generated rows under `v` and reaches unchanged category helper with none=`""`, preserving prior direct-helper semantics |

Other tests in those files are unchanged. No test-only production runtime code is needed to run the new properties.

The full four files contain 23 tests on head: 9 multi-fact + 4 labels + 5 invariants + 5 statistic. Before: 8 + 3 + 5 + 5 = 21. Thus the reported full-package +1 and full-frontend +2 are structurally consistent; frontend discovery includes package tests. The supplied snapshots have the same 38 package test files; no new test file accounts for the increases.

The exact isolated multi-fact suite prints **7 pass, 2 fail, 60 assertions** on old, **9 pass, 0 fail, 72 assertions** on head. The isolated label suite prints **1 pass, 3 fail, 8 assertions** on old, **4 pass, 0 fail, 10 assertions** on head. This reproduces the core 3 frontend + 2 package failures. Adding the ten unchanged-semantics generated tests would yield 18 pass/5 fail, then23 pass/0fail. The local git history contains only the bundle commit `fa524d0`; `5db3130`/`4046000` trees are unavailable. Consequently the hand-off's historical test-first execution and all full-suite exact counts are internally consistent, not independently authenticated executions of those intermediate commits. No claim is made to have rerun the full 427/428 or888/890 suites.

## Wrong implementations and test sensitivity

- A phrase hard-coded to `loan type values` fails all three changed/new wording assertions. Borrower age at :81 also prevents a loan-specific fallback from looking generic when listed dimensions exist.
- A page helper still looking up `layout_groupby_value_varies` while the reader emits the new name returns `All` for the two fixture rows and `Female` for the listed-dimension row, failing those three assertions.
- Keeping the **old** field true for an omitted pair is rejected by the explicit `not.toHaveProperty` assertions in both package tests, including the mixed-storage case. A true **new** field for an omitted pair deliberately passes: it means unlisted, not differing. The boolean decision is intentionally unchanged by the production delta; the semantic field name and page wording are the fix. The tests do not establish that omitted pairs actually differ, nor should they.
- A no-level helper is no longer vacuous: `rows=[{level:"state"}]` makes each category property expect `["state"]` and level `"state"`. Returning no levels fails :157 for both readers. The old category properties inspected only returned levels, so the empty result could pass.

The fixture checker confirms exact JSON equality for **all five retained fields** (`case`, `facts`, `hierarchy_dimensions`, `representative`, `dashboard_target`) against the first three lines of `hierarchy_probe.log`. The fixture drops `layout_pair` and `member_keys` too, as well as `dashboard_layout_groupby_value_varies`; its retained content matches the hand-off's stated fields exactly.

## Public paths and remaining scope

- Count properties: every generated value reaches `countOrNull` through `buildCalibration` -> Chronicle metadata shaping -> the page's returned count. The chosen FSA row has no multi-fact count, so shownChronicle does not hide the generated universe count. Shape still admits any null/safe nonnegative output; roundtrip forces exact values for valid numbers/decimal strings.
- Category properties: every **nonempty** generated array reaches `categoryLevels`, once via `microcosmVariableSummary`, or once per variable after `buildComparison`. Empty arrays return `[]` without calling the helper; they test the public empty-category result. This does not weaken nonempty level equality.
- Facets: variable `v` makes `latestMicrocosmTargetDiagnosticsPage` call `computeDimensions` for every array, empty included (:3254). `repeatsGeography` is called only for non-geography candidates carrying at least two distinct nonempty values (:1056-1057). Empty/single-valued/uncarried dimensions skip it. The page has no direct Geography-key path to repeatsGeography, so removing that internal-only assertion is justified. The new converse assertion tests hiding dimensions equal to their own row geography. Assertions intentionally say nothing about differing dimensions with <=1 unique nonempty value, which are not useful facets.
- Statistic property: minLength1, variable `v` guarantees the summary reaches categoryLevels; its original preconditions still discard multiple-level and first-empty/some-other-nonempty categories. This remains scoped, rather than establishing all multi-level key behavior by itself (the example tests cover that).

The shape property kills accept-fraction with numeric `2.5`, and accept-negative with numeric `-1`. Accept-space returns0 for `" "`, so shape and roundtrip still pass, as before. The existing `latest-artifact.test.ts:1259` example checks `"2.5"`, `"-1"`, `" "`, `""` against null and catches accept-space. No mutation sensitivity was lost by going through readers.

Dependency-free deterministic witnesses (not fast-check reruns) print6 pass/0 fail/54 assertions on both old and head. Against isolated count mutants: accept-fraction5pass1fail (shape), accept-negative5pass1fail (shape), accept-space5pass1fail (blank example; shape passes). Against no-levels mutant:4pass2fail, precisely the two category assertions.

## Exports and CI cost

`rg` across the whole head input finds the four names only in latest-artifact's declarations/internal calls and comments in the invariants file. No consumer, including package-boundary.test.ts, imports them. Runtime namespace comparison prints each name `before=true, after=false` and passes8 assertions.

The two count properties build20,000 and40,000 one-row releases, respectively. Other `releaseOf` uses here only replace the already-built FSA rows; they do not call buildCalibration20,000 times. My deterministic equivalent loops measured **2,038ms for20,000** public build+page calls and **3,629ms for40,000**. The complete fast-check9s claim cannot be timed without fast-check, but these measurements and the60s **per property** timeout leave substantial margin. CI still uses ubuntu-latest, frozen installation, and unfiltered frontend `bun test` (.github/workflows/ci.yml:29-40). No material CI-timeout risk is demonstrated. The loop cost is real (~60k builds), but no reason to block solely on this measured few-second cost.

## Commands and raw output

All commands ran from workspace root. Python was run with `python3 -I`.

```sh
python3 -I work/tests-properties/prepare.py
BUN_INSTALL_CACHE_DIR="$PWD/work/tests-properties/bun-cache" ~/.bun/bin/bun test --preload ./work/tests-properties/deny-network.ts ./work/tests-properties/old-package/src/multi-fact-identity.test.ts
BUN_INSTALL_CACHE_DIR="$PWD/work/tests-properties/bun-cache" ~/.bun/bin/bun test --preload ./work/tests-properties/deny-network.ts ./work/tests-properties/new-package/src/multi-fact-identity.test.ts
python3 -I work/tests-properties/prepare_labels.py
BUN_INSTALL_CACHE_DIR="$PWD/work/tests-properties/bun-cache" ~/.bun/bin/bun test --preload ./work/tests-properties/deny-network.ts ./work/tests-properties/old-front/target-row-labels.test.ts
BUN_INSTALL_CACHE_DIR="$PWD/work/tests-properties/bun-cache" ~/.bun/bin/bun test --preload ./work/tests-properties/deny-network.ts ./work/tests-properties/new-front/target-row-labels.test.ts
python3 -I work/tests-properties/fixture_check.py
BUN_INSTALL_CACHE_DIR="$PWD/work/tests-properties/bun-cache" ~/.bun/bin/bun test --preload ./work/tests-properties/deny-network.ts ./work/tests-properties/public-readers.test.ts
PROPERTY_PACKAGE=./old-package BUN_INSTALL_CACHE_DIR="$PWD/work/tests-properties/bun-cache" ~/.bun/bin/bun test --preload ./work/tests-properties/deny-network.ts ./work/tests-properties/public-readers.test.ts
python3 -I work/tests-properties/mutants.py
PROPERTY_PACKAGE=./mutant-accept-fraction BUN_INSTALL_CACHE_DIR="$PWD/work/tests-properties/bun-cache" ~/.bun/bin/bun test --preload ./work/tests-properties/deny-network.ts ./work/tests-properties/public-readers.test.ts
PROPERTY_PACKAGE=./mutant-accept-negative BUN_INSTALL_CACHE_DIR="$PWD/work/tests-properties/bun-cache" ~/.bun/bin/bun test --preload ./work/tests-properties/deny-network.ts ./work/tests-properties/public-readers.test.ts
PROPERTY_PACKAGE=./mutant-accept-space BUN_INSTALL_CACHE_DIR="$PWD/work/tests-properties/bun-cache" ~/.bun/bin/bun test --preload ./work/tests-properties/deny-network.ts ./work/tests-properties/public-readers.test.ts
PROPERTY_PACKAGE=./mutant-no-levels BUN_INSTALL_CACHE_DIR="$PWD/work/tests-properties/bun-cache" ~/.bun/bin/bun test --preload ./work/tests-properties/deny-network.ts ./work/tests-properties/public-readers.test.ts
BUN_INSTALL_CACHE_DIR="$PWD/work/tests-properties/bun-cache" ~/.bun/bin/bun test --preload ./work/tests-properties/deny-network.ts ./work/tests-properties/exports.test.ts
rg -n 'countOrNull|repeatsGeography|computeDimensions|categoryLevels' inputs/dashboard-836fc66
```

Logs: `old-multi-fact.log`, `new-multi-fact.log`, `old-labels.log`, `new-labels.log`, `fixture_check.log`, `public-readers.log`, `old-public-readers.log`, `mutant-*.log`, `exports.log`.

An attempted isolated package-boundary test stops before useful assertions because test-support/package-boundary.ts imports missing `typescript` (0pass/1fail/1error), captured in `package-boundary.log`; no install/fetch followed. It cannot be rerun under the no-install condition. The two exact fast-check files also cannot be run because fast-check is absent; no attempted installation. Full frontend/package suites, lint/typecheck/build, hosted Python and Vercel were not independently rerun.
