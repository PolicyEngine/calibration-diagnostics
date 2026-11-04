# Check 6, exports and CI audit

All inputs were read as data. No network, install, GitHub write, commit or push was used. Bun is the supplied `~/.bun/bin/bun`, version **1.3.12**, rather than the hand-off's 1.4.4. Every copy/script/log is under `work/tests/`.

## Commands and actual results

1. `python3 -I work/tests/import_graph.py`

   Copies of the package were made at `work/tests/base` and `work/tests/head`. The script conservatively selects test files whose static runtime import graph consists only of local files, `node:*`, and `bun:test`; type-only imports are ignored. Package-self references are conservatively excluded too. It invokes Bun separately in each package with `BUN_INSTALL_CACHE_DIR=work/tests/bun-cache` and no install.

   - Base: **166 pass, 0 fail**, 645 assertions, **18 files**, 12.00s.
   - Head: **166 pass, 0 fail**, 645 assertions, **18 files**, 11.23s.
   - Logs: `base-eligible.log`, `head-eligible.log`; selection/exclusions: `*-test-selection.json`.

   These are unchanged tests, useful as a local regression check. No exact changed behavioral test has an entirely available unchanged import graph: `latest-artifact.ts -> calibration-release-locator.ts -> calibration-tree-blob.ts` reaches the missing package `@vercel/blob`. The properties additionally need missing `fast-check`. The frontend tests need missing aliases/source files too.

2. `python3 -I work/tests/run_isolated.py`

   To exercise the changed pure data paths, the script copies each package to `isolated-base` / `isolated-head`, transplants the head versions of the three relevant test files onto both, and makes **one explicitly disclosed isolation change**: the `readCalibrationTreeManifest` import at `calibration-release-locator.ts:1` becomes a local function that throws if called. No tested case calls this unrelated Blob I/O boundary. A local Bun preload also replaces `fetch` with a throwing function, enforcing no network. No test assertions or tested shaping/lookup functions are edited.

   Commands under each isolated package:

   ```text
   bun test --preload <work/tests/deny-network.ts> src/multi-fact-identity.test.ts
   bun test --preload <work/tests/deny-network.ts> src/latest-artifact.test.ts -t 'a universe constraint count that is not a whole count reads null'
   bun test --preload <work/tests/deny-network.ts> src/ed-fsa-family.test.ts
   ```

   | Head test file | On base shaping code | On head shaping code |
   | --- | --- | --- |
   | `multi-fact-identity.test.ts` | **1 pass, 7 fail**, 13 assertions | **8 pass, 0 fail**, 55 assertions |
   | New invalid-count case | **1 pass, 0 fail**, 87 filtered, 1 assertion | **1 pass, 0 fail**, 87 filtered, 1 assertion |
   | `ed-fsa-family.test.ts` | **13 pass, 0 fail**, 329 assertions | **13 pass, 0 fail**, 329 assertions |

   Logs: `base-{identity,invalid-count,ed-fsa}-isolated.log` and `head-{identity,invalid-count,ed-fsa}-isolated.log`. These are isolated runs of the original assertions, not claims that the unmodified package or full CI ran offline.

3. `python3 -I work/tests/count_mutants.py`

   It reruns just the new invalid-count test after applying, one at a time, the earlier review's `accept-2.5`, `accept--1` and `accept-space` mutations to the isolated head, restoring the file finally. **Each exits 1: 0 pass, 1 fail**, at the new count assertion. Thus the hand-off's claim that all three old surviving mutants are now killed is reproducible. Logs: `count-mutant-accept-{fraction,negative,space}.log`; summary `count-mutants.json`.

4. `BUN_INSTALL_CACHE_DIR="$PWD/work/tests/bun-cache" ~/.bun/bin/bun run --no-install work/tests/export-delta.ts`

   Prints:

   ```json
   {"added":["categoryLevels","computeDimensions","countOrNull","repeatsGeography"]}
   ```

   Log: `export-delta.log`.

## Every new/changed test

The eight identity cases below were actually run with the isolation described above. Line numbers refer to the head's `frontend/packages/calibration-tree/src/multi-fact-identity.test.ts`.

| Case | Base | Head | What a plausible wrong implementation can still get through |
| --- | --- | --- | --- |
| `scaled_by_ratio` record/keys, member listing, row/detail equality, lookup and searches (`:146`) | Fail | Pass | No alternative ratio selector or ambiguity with another target is exercised. |
| `rolled_forward_by_ratio`, one base (`:146`, second generated case) | Fail | Pass | Trusting count 1 without verifying representative membership passes; only coherent handcrafted metadata is supplied. |
| Ratio operand dimension varies (`:196`) | Fail | Pass | Ignoring aggregation dimensions for all operations passes this case; it only protects the base identity of one scaled operation. |
| Rolled-forward two bases (`:214`) | Fail | Pass | Uses only counts 2 and complete schema-8 hierarchies. Unknown/missing/zero/invalid counts, schema 6 display, and actual Microcosm base validation are not independently modeled. |
| Allocated residual, one/two base (`:268`) | Fail | Pass | **Assumes the disputed identity rule:** changes receipt `fact_keys.base`, never constructs labelled facts/selectors, and asserts that receipt length defines identity size. It cannot catch selector-matching partition/total/growth facts outside the receipt base. |
| `layout_groupby_value_varies` (`:313`) | Fail | Pass | Only fixtures sharing or omitting an exact clean dimension/value; no whitespace, missing-vs-differing dimension or subgroup key inconsistency. Schema 6 asserts the flag only, not the misleading Dimensions cell. |
| Member lookup (`:366`) | Fail | Pass | Distinct keys for actual targets vs unresolvable member keys; does not cover the same key being a real target's identity and another target's member. No malformed/absent member list. |
| FSA linear combination (`:415`) | Pass | Pass | Protects the existing result for this fixture; does not establish every linear-combination cardinality. |

All eight can fail: seven fail against the old implementation, and the final FSA case would fail if shownChronicle simply returned raw Chronicle fields. None proves the operation set/cardinality rule universally. The suite does not construct `calendar_year_window_scaled_by_ratio`, the other default operations, or a zero/one-fact identity for any default operation.

Other changed tests:

- `latest-artifact.test.ts:1259`: actually **passes on both** versions, by design. The three invalid-count mutations above actually fail it. It does not test unsupported textual forms such as exponent or hexadecimal notation through the release reader, although the count property samples such strings.
- `ed-fsa-family.test.ts:686`: **comment-only change**, replacing a stale line citation with function/file. Its affected compared-category test and all 13 tests pass on both versions in the isolated run. It is not new coverage in this delta.
- `target-row-labels.test.ts:40`, “combines several”: cannot run unchanged because the shared formatter, frontend alias resolution, workspace package linkage and external package are unavailable. Static result using the base function after the hand-off's claimed move: **fails** (`All` vs the expected combined-values sentence). Head contains the explicit branch that returns the expectation. A fix hardcoded solely for loan type would also pass this case.
- `target-row-labels.test.ts:52`, “shared dimensions come first”: likewise **fails** against the moved base function (`Female`), and head returns the joined sentence. A fix checking only truthy `layout_groupby_value_varies` without establishing the flag correctly passes.
- `target-row-labels.test.ts:67`, “all or none”: **already passes on base** insofar as the unchanged shared formatter behaves as the test expects; the shown function branches are otherwise identical. It does not test a contradictory true flag paired with `groupby_value_id: all`, or a dimension-only row where dimensions are incomplete.
- `latest-artifact-invariants.test.ts`: **not run** because `fast-check` is unavailable. Before transplanting head's four export modifiers, importing these names from base would fail; after exposing the same helpers for testing, all five properties should pass both versions because their runtime implementations are unchanged. These are coverage additions, not evidence of a new fix.
- `frontend/lib/microcosm/statistic-groups.test.ts`: the **file and its implementation are not in the snapshots**; two added properties are readable in the diff. Cannot run unchanged: needs `fast-check`, omitted source file and package linkage. The diff does not change statisticGroupKey, and the supplied earlier scoped property source/logs cover equivalent predicates on base. Thus both are expected to pass before and after; this conclusion is source reasoning, not a fresh execution.

## Fast-check scope and non-vacuity

All seven properties have real failing predicates; none is rendered automatically true by `fc.pre`. The two statistic properties deliberately restrict themselves to at most one level, so they cannot detect a broken multi-level encoding. This is a documented scope, not proof of a unique collision-free key.

| Property | Actual scope / exceptions | Concrete mutation or witness that can fail | Plausible wrong implementation it misses |
| --- | --- | --- | --- |
| Count output shape | Anything from the stated arbitrary union; null or safe nonnegative integer is accepted. `-0` is accepted by the predicate (`>=0`), as the comment explains. | Accept numeric `-1` or fractional `2.5`. | Always return null; rejected by the companion round-trip property. |
| Count round-trip | All generated safe nonnegative integers and their decimal `String(n)` form. No whitespace or alternate textual-form guarantee. | Return null for input 0 / `'0'`. | Accept invalid textual forms too. |
| Category shape, `none=''` | Up to eight rows; levels are null/undefined, short strings, or integers -2..2; checks sorted/unique/nonempty *returned* levels and whether returned scalar is null. | Unsorted output for `state,country`, duplicate output, or scalar null for one level. | **Always return `{levels: [], level: none}`** satisfies every assertion; no correspondence between input levels and returned levels is asserted. |
| Category shape, `none=null` | Same generated rows, but scalar-null equivalence is deliberately skipped when no returned levels exist. Comment states this exception accurately. | As above with a nonempty returned list. | Same always-empty result passes. |
| Facet / repeated geography | Up to ten rows from five named geographies, three levels, and unique dim keys `loc/sex/age`; at most three raw dims per row collapsed to one per key. Facets required only for >1 nonempty value, as implementation does. | Suppress the geography candidate for two distinct states; or hide Sex merely because each state has one different sex. | Always include varying dimensions, including duplicates of geography, can satisfy the `computeDimensions` assertions. The property does not assert duplicate-dimension suppression; existing fixture tests do. |
| Statistic single-level compatibility | Coherent `levels=[level]` or `[]`; source/level/variable are generated strings, including delimiter tokens. | Omit source, reorder fields, or change delimiter. | Always use scalar `row.level`; passes every generated case. |
| Statistic one-category compatibility | 1..6 rows, at most one distinct nonempty normalized level, and first row carries it unless all rows lack level. Both `fc.pre` conditions admit ordinary one-row cases. Comment names the excluded empty-first-row counterexample. | Change key delimiters or mismatch its scalar representation. | Always use scalar level; no multi-level cases admitted. |

The category/facet properties are partial invariants, not completeness proofs. Their captions are mostly accurate about those invariants; the file-level statement should not be read as validating behavior beyond its actual finite input domains. A small improvement is to assert category output `levels` equals the sorted unique normalized input levels, so always-empty output fails.

## Hand-off test-first record

- `8da55a3`: its stated initial six cases are the two one-identity cases, ratio varying dimension, rolled-forward two bases, allocation, and FSA. Current head tests transplanted to base produce exactly the claimed **five fail / FSA passes** on that subset. The later layout and member tests add the two other failures in the complete eight-case base run.
- `fddf4de`: “3 fail” is consistent with **one new layout flag test + two new dimensionSummary cases**. The third Dimensions test covers preserved All behavior and need not fail. Treating “3 fail” as all three frontend label tests would be wrong, but the hand-off does not explicitly say that.
- `0a50940`: the member lookup case fails on base and passes on head, matching “1 fails.”
- `4e2c7a2`: count negatives pass already, as actually reproduced; helper implementations do not change beyond exports, so property tests are correctly claimed as coverage-only with no red commit.
- The earlier item-4 explanation is backed by supplied review logs: `step2-item4-6843fe0.log` and `step2-item4-testcommit-tests-on-a5e604e.log` both fail at `ed-fsa-family.test.ts:809`, expecting `[null, []]` but receiving `[undefined, undefined]`; `step2-item4-fixcommit-tests-on-6843fe0-code.log` fails at `:829`, the aggregate Chronicle assertion; `step2-item4-a5e604e.log` passes 13 tests. The hand-off corrects this accurately.
- **Limit:** only the two snapshots and cumulative diff are supplied; this repository's sole initial commit is the input bundle. Exact intermediate commit trees/test-only/fix-only diffs cannot be replayed, so “each fix touches no tests” and their chronological replay cannot be independently established here. The old/head behavior and supplied earlier logs corroborate the meaningful failure claims.
- Count arithmetic is correct: package **+14** tests = 8 identity + 5 package properties + 1 count; frontend **+19** = those 14 + 3 label tests + 2 statistic properties. The asserted complete 413/427 and 869/888 suites were not rerun under offline restrictions.

## Exports and CI

`latest-artifact.ts` newly exports four implementation helpers solely for tests (`countOrNull:222`, `repeatsGeography:1010`, `computeDimensions:1021`, `categoryLevels:1647`). Existing package.json exports `./latest-artifact` as that source file, so they are now importable by any package consumer. The runtime export-delta probe confirms all four names. The package is private; this is a **P3 maintainability/API follow-up**, not itself a production correctness blocker. Smallest clean fix: move the helpers into an internal local module, import them into latest-artifact and tests, and do not add that internal module to the package export map (or test through existing public readers).

No workflow, package manifest or lockfile appears among the cumulative diff's eleven changed paths, so this delta does not weaken CI. The supplied head `.github/workflows/ci.yml` installs frozen dependencies and runs **unfiltered `bun test` from frontend/**, which includes nested package tests. Its build job runs `bun run lint` (the frontend manifest makes this both TypeScript projects) and `bun run build`; the separate hosted Python job also remains. Those full jobs, `fast-check`, typechecking, lint and Next build cannot be rerun with the explicitly forbidden installs. The supplied user reports passing CI; this audit does not independently verify remote CI.
