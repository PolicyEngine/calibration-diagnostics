# Claims, member lookups, and fresh-read audit

This report covers the complete supplied delta, every microcosm citation appearing in its comments, and the mechanism sentences in the PR body and hand-off. Identity/allocation and hierarchy/universe correctness are also being investigated independently by the other reviewers; where indicated below their counterexamples supersede the nominal-case agreement recorded here. No network, installation, GitHub write, commit, or input edit was performed.

## Possible findings and follow-ups

1. **P3 documentation: the PR body claims lookup keys the endpoint does not support.** `inputs/pr/pr-body-67e6d0b.md:35` says a one-fact identity shows its record id, fact keys, group-by value and universe constraint, “and a lookup by any of them finds it.” `latest-artifact.ts:3329-3337` accepts the target names, record id, and four fact keys only. Concrete input: an actual fixture youngest-age row, renamed `synthetic.age_scaled@2024` and supplied scaled_by_ratio metadata, resolves by its record id but not by its `age_24_and_younger` group-by value or its `ledger.universe_constraint_set.v2:73fc2ae5891d41ebcbba5761` set key (probe `work/claims/unsupported-lookups.log`: 1 pass, 0 fail, 5 assertions). Smallest prose fix: “a lookup by its record id or fact keys finds it.” This is a prose overclaim, not a request to add ambiguous group-by/constraint lookups.

2. **P3 API surface follow-up:** `latest-artifact.ts:222`, `:1010`, `:1021`, `:1647` newly export `countOrNull`, `repeatsGeography`, `computeDimensions`, and `categoryLevels` solely for property tests. `frontend/packages/calibration-tree/package.json` already exports the entire `./latest-artifact` module, so all four become consumer-visible package API. The hand-off explicitly admits this. There is no production behavior defect demonstrated by these exports. Prefer testing through existing public readers or consciously treating these helpers as public API. A new production module would also be public under the package-boundary rule, so simply moving them into another normal package module does not eliminate the issue.

3. Minor wording overreach, not a runtime finding: the hand-off's item 1 says “calendar_year_window_scaled_by_ratio and every other operation span several facts.” `identity`, `sum`, and other operations can have one fact. The dashboard's `memberFactCount <= 1` guard handles that correctly. Say “for the other operations, the identity is all the facts,” as the PR body correctly does.

4. The new lookup code/test comments say “A member fact is not the target.” A ratio base can both be a member and be its target's identity. The PR body's conditional statement (“A lookup that finds no target now lists...”) accurately describes the implementation. The workflow paragraph is likewise conditional on the error, so it does not change successful direct lookups.

## Exact citation/comment matrix

Command: `python3 -I work/claims/citation_excerpts.py`. Output: `Opened 24 cited ranges; wrote work/claims/citation-excerpts.log`. That raw log contains every cited microcosm range, at the supplied `0ff293b` snapshot. I additionally read enclosing resolvers, the full 1,120-line diff, both body documents, and the current/baseline dashboard implementations with `rg`, `nl -ba`, and `sed`.

| Delta location / claim | Cited source opened | Assessment |
| --- | --- | --- |
| `latest-artifact.ts:219-221` context: TargetSpec makes metadata strings | `registry.py:149-150` | Exactly true: dict comprehension applies `str` to every key/value. |
| `latest-artifact.test.ts:1258-1259`: count is number of constraint rows | `ledger_targets.py:5911-5913` | Exactly true. Count is emitted only when rows are nonempty; missing/zero-row metadata stays absent. |
| `latest-artifact.ts:509-511`: receipt `fact_keys.base` lists base keys | `ledger_targets.py:3069-3071`, `:3188-3189` | Exactly true about receipt content. These lines alone do **not** prove receipt base equals `identity_facts`, which filters all labelled facts; allocation reviewer is auditing that implication. |
| `latest-artifact.ts:540-543`: hierarchy uses inherited identity dimensions | `ledger_targets.py:1578-1611`, `:1096-1100`, `:1369`, `:1429` | Call chain and sources are exact. The claimed converse (“missing implies different”) needs the hierarchy review; common dimension entries and serialization also matter. |
| `latest-artifact.ts:574-577`: representative supplies fact fields; metadata lists all facts incl. ratio operands | `ledger_targets.py:1085-1090`, `:1318-1341` | True. `facts` is passed unchanged into multi-fact metadata; strings use fact key, falling back to record id. |
| `latest-artifact.ts:578-588`: identity operation cases | `ledger_targets.py:1018-1035`, `:1174`, `:4270-4272`, `:4331` | Scaled and rolled mapping exact. Allocation receipt equivalence is not established by these lines. Window mapping true; its two-year guarantee additionally uses `CALENDAR_YEAR_WINDOW_WEIGHTS` and complete-year check `:4362`. Default identity is every fact. |
| `latest-artifact.ts:589-590`: representative is first base cell | `ledger_targets.py:1232-1245` | True specifically for scaled, rolled, and allocated operations (`:1239-1244`). As a general statement it is overbroad: other multi-fact operations choose latest period, tie-last (`:1245`). The following one-fact-identity inference depends on the allocation issue. |
| `latest-artifact.ts:597-601`: varying dimensions compares only dimensions of all facts | `ledger_targets.py:1323`, `:1626-1646` | Exactly true. Layout group-by fields and constraints are not compared. |
| `latest-artifact.ts:3340-3343`, `multi-fact-identity.test.ts:344-350`: twelve-area CGT Table 5 cells restated by Table 1 share | `generate_uk_target_references.py:1117-1119` | Literal rationale says exactly this, through `scaled_by_ratio`. It supports one share reused across regional targets, rather than “one fact has only one target.” These cited lines are declarative rationale, not a full materialized-target roster. |
| `multi-fact-identity.test.ts:11-18`: representative fields, all members, identity cases | `ledger_targets.py:1318-1341`, `:1085-1090`, `:1018-1035` | Matches source for scaled/rolled/linear nominal cases. |
| `multi-fact-identity.test.ts:112-116`: scaled base representative; one rolled base representative/count | `ledger_targets.py:1018-1023`, `:1239-1244`, `:1030-1031`, `:1174-1178` | All exact; rolled count is number of facts before final two growth operands. |
| `multi-fact-identity.test.ts:189-191`: ratio operands enter varying dimensions | `ledger_targets.py:1323-1339` | Correct via `_varying_dimension_ids(facts)`; helper source confirms. |
| `multi-fact-identity.test.ts:201-207`: typed dimension roster can produce multiple rolled base cells; hierarchy built from those cells | `ledger_targets.py:3352-3408`, `:1578-1611`, `:1096-1100` | Correct. Validator also supports explicit geography rosters. Constraint-equality evidence is separately reviewed. |
| `multi-fact-identity.test.ts:251-253`: allocated selector cells equal receipt base, representative first | `ledger_targets.py:1024-1029`, `:3188-3189`, `:2993-3011`, `:1239-1244` | Cited lines prove selector filter for identity, atom subset for receipt base, and first base representative; they do **not** prove selector matches no total/growth facts. Allocation review must resolve. |
| `multi-fact-identity.test.ts:412-415`: linear identity all facts | `ledger_targets.py:1034` | True. Fixture metadata and member rows establish five loan types. |

The new frontend Chronicle type comment carries no microcosm citation itself. It matches nominal shownChronicle behavior, but inherits any allocation/hierarchy counterexamples. The moved `dimensionSummary` comment likewise states intended nominal behavior; it must not be treated as independent evidence that hierarchy absence proves differing group-by values.

## PR-body mechanism sentences (line-by-line groups)

“Verified” below means the supplied code supports the claim, not that I independently witnessed the historical session execute it. CI and historical test runs are supplied evidence; no network was used to recheck them.

| Body lines | Mechanism sentence(s) | Audit |
| --- | --- | --- |
| 3 | Fixture has 132 targets; PR fixes listed follow-ups and facet/doc | 132 is fixture-verifiable. Names of earlier follow-ups are historical assertions in provided brief/review. Facet/doc behavior exists already at 43, so the ten-commit delta does not newly implement them. |
| 11 | First-row level behavior at 230; FSA categories have 14 country/51 state; comparison follows worst row | Current tests and fixture confirm 14+51, and comparison sorts by absolute fit delta. Exact 230 line claims cannot be reread because no 230 code snapshot is supplied. |
| 12 | Both summaries return all levels, same ordering as filter; one/null/empty fallback | Verified `categoryLevels`, `microcosmTargetLevels`, summary callers. Levels are nonempty string conversions, sorted lexically, with caller-specific empty sentinel. |
| 14 | Two UI readers now use shared statistic key; single-level same as old | Call sites verified in targets view and cards. **Missing input:** `frontend/lib/microcosm/statistic-groups.ts` is absent from both snapshots, so actual key implementation cannot be independently opened here; diff includes only changed test hunk. |
| 15 | VariableGroup.level unused, now levels | Current interface and assignment use levels, with no read in supplied file. Prior full-repo unused claim cannot be proven from partial inputs. |
| 16 | Comparison variables level has no UI reader; API adds levels | API fields verified. Negative whole-repo claim limited by partial UI snapshot; no reader found in provided components. |
| 17 | FSA/census tests expect both/single levels | Verified source of tests. Test execution delegated to tests reviewer. |
| 21 | Old filter options were raw | Exact 230 code omitted. New helper preserves ids and uses label helper as claimed. |
| 22 | Source uses release label/fallback; Level labels from map; ids unchanged | Verified helper, view source label `:278`, explorer geography label helper and menu call. Fixture carries `ED · Federal Student Aid`. |
| 27 | numberOrNull ignored release strings; microcosm writes strings | Microcosm and registry exact. Historical pre-PR `numberOrNull` reader is not available at 230; baseline already has countOrNull. “Every release” assumes actual release metadata follows that documented string contract. |
| 28 | countOrNull reads whole nonnegative numbers/strings; APIs show count | Verified helper, Chronicle fields and response rows. “targets page rows” means API row fields; the supplied page does not display a count cell. |
| 29 | Tests string counts and FSA counts | Verified source and fixture. |
| 33 | Representative fields; linear representative last operand; FSA Stafford; old lookup | Representative source exact. Linear resolver enforces same latest period (`:3692-3768`), so tie-last representative is last member of last operand; an operand may contain several members. Fixture representative Stafford verified. Exact 230 UI response unavailable. |
| 34 | Every multi-fact target lists members; shown fields follow microcosm identity | Member-list source exact; claimed identity equivalence subject to allocation/hierarchy audit. |
| 35 | One-fact identity fields retained and any field lookup finds it; scaled/rolled/allocated single base | Fields retained according to dashboard operation logic. **False literally about supported lookup fields:** group-by/constraint are not lookup keys. Allocation equivalence unproven. |
| 36 | Several-fact identity nulls individual identity/universe; group-by kept iff hierarchy lists | Dashboard behavior verified. Strong source correctness claim depends hierarchy review. |
| 37 | Raw row preserves fields; comparison matches renamed target by fact key; test renamed copy | True: `shownChronicle` returns a new object; raw row untouched. `target-surface-matcher` sees raw Chronicle. Existing FSA test explicitly checks renamed comparison. |
| 38 | Single fact unchanged/no member fields; fifteen output snapshots changed in abandoned approach | Guard returns raw Chronicle exactly; snapshot-count historical claim cannot be rerun from committed final code alone. |
| 39 | Members reach APIs only; no component reads them/no investigation UI | Both API responses verified. No production component reader found in supplied snapshot. Negative full-repo claim limited by incomplete snapshot. |
| 40 | Dimensions before/after text and helper/callsite | 43 function returns All for aggregate; new varies branch requests the stated wording. **Missing input:** `components/shared/format.ts` is absent, so lowercasing through `humanizeName` and exact 230 rendering cannot be independently executed from unmodified sources. Do not flag a casing defect on speculation. |
| 41 | Source tooltip falls back to target name; ratio base record shown | Exact current callsite `:176` confirmed. Historical 230 output unavailable. Ratio behavior follows shownChronicle nominal cases. |
| 42 | Test covers each operation | Overbroad if read as every ledger operation; file covers scaled, rolled, allocated, and linear only, plus field state schema case. Review-follow-up list clarifies this smaller meaning. |
| 46 | Builder doc change, release gate skips/CD carveout, deterministic hash | Current docstring and fixture hash inspectable. **Missing sources:** `tools/build_us_fiscal_refresh_release.py`, matrix.py and fourteen of fifteen SOURCES files absent. Gate citations and full fixture rebuild cannot be verified under supplied no-network constraints. |
| 50 | Facets required >1 values; FSA location repeats state | Verified computeDimensions, fixture, existing facet tests. |
| 51 | Equal-to-geography dimension hidden; map suppresses one-value tiers; URL filter still works | Verified repeatsGeography, computeDimensions, map `calibration-tree.ts:601-610`; URL matching still uses rowFacetValue and target dimensions. It is an analogy to map's local tree rule, not identical algorithm. |
| 52-53 | Broader abandoned rule failed Belgium; current narrow facets | Current tests verify stated narrower behavior. Historical abandoned implementation/test execution cannot be independently witnessed. |
| 57 | Every behavior change test commit fails, fix touches no tests | Must be checked against test reviewer; only final/base inputs supplied to this reviewer, so not independently reconstructed commit by commit. |
| 59-64 | Operation identities and count metadata | Scaled, rolled and default exact. Window two years established in full resolver/constants. Allocation equality remains the central unproven implication. |
| 66 | Varying dimensions only dimensions, none in aggregate; hierarchy/universe strategy; operation tests/lookups/searches | Dimensions claim verified. Strategy is dashboard behavior; correctness depends other audits. Existing tests and investigationSearches match nominal statements. |
| 67 | varies true/false/null; UI wording/default/move | Implementation matches nominal intended state machine. “All” only applies absent displayed dimensions; dimensionSummary prefers actual dimensions. Move copies old helper exactly before its new branch. |
| 68 | Failed lookup names every member target, supports rep keys; CGT reuse | Verified and probed (details below). Conditional “finds no target” is essential: direct successful matches suppress member_of entirely. CGT citation literal rationale verified. |
| 69 | Packet prints unavailable detail without changes; cloud ran local server | `:85-86` throws exactly `payload.detail`; main prints errors. Local-server run is cloud-session assertion, not evidence rerun here. |
| 70 | Workflow exception reruns chosen target | Exact new paragraph, line 26. It applies only when membership error is emitted and leaves target selection to investigator with rationale. |
| 72 | Four invalid strings rejected; three mutants; scoped properties/exported helpers/no fix | Invalid strings rejected by helper. Property comments/test code inspected; mutation/run result belongs tests reviewer. Exports genuinely broaden package module API. |
| 73 | Source-label and moved-sort citations corrected | New sort comment accurately names buildComparison/file. Current source label :278, baseline :291; :176/:201 confirmed. |
| 74 | Previous test-first record distinction | Earlier independent review contains that premise. Historical commit replay cannot independently run from only two code snapshots; test reviewer evaluates available logs. |
| 85 | Test count arithmetic/new files | 8 multi-fact tests + 5 generated tests +1 invalid count test =14 package increase; +3 Dimensions tests +2 statistic properties =19 frontend increase. File/test count arithmetic consistent. Full frontend run unavailable without missing files/deps. |
| 89 | Microcosm must carry debt-size order first | Snapshot lacks plan/publisher facts beyond fixture; no order exposed by current fixture's age/balance dimensions, but general impossibility claim too broad to establish from supplied files. |
| 90 | No Chronicle FSA webpage | External live-state claim intentionally unverified under no-network instruction; not a code mechanism. |
| 91 | Detail component has no record/fact key | No such production reads found in supplied `microcosm-target-detail.tsx`. |
| 92 | Several identity universe always null / calendar-year example | Dashboard null verified. Source/availability correctness delegated to universe review. |
| 93 | filters/dimension_set_key remain representative | Verified shownChronicle spread plus four-key/record/null overrides only. Fixture empty/shared claim can be checked from member target metadata. |
| 94 | Schema6 uses representative metadata dimensions; varies null; no fixture | Metadata adapter logic confirms nominal statement; parent handles schema6/group-by details. General fixture absence cannot cover omitted files, only supplied fixture corpus. |
| 95 | Other member record ids unavailable; fact-key fallback | Exactly `_multi_fact_reference_metadata:1321`; another member record id can coincidentally equal an own target name or listed record-id fallback, so this is a limitation description, not universal impossibility. |
| 96 | targetNames uses representative id for calibration status | Verified function and callers; unchanged in ten-commit delta. |

## Hand-off mechanism sentences

| Hand-off location | Assessment |
| --- | --- |
| Item 1, line 7 | Same nominal operation/count/show/lookup/search claims as body, with the overbroad “every other operation span several” wording noted above. Test file genuinely renames row names and sets hierarchy target ids. 5-of-6 failure record is test-reviewer scope. |
| Item 2, line 8 | Same field/text/default claims as body 40/67; actual `humanizeName` source is missing, so casing remains unverified here. |
| Item 3, line 9 | Endpoint available:false/member_of shape/detail verified; script passes detail unchanged; doc paragraph exact. |
| Item 4, line 10 | Strings helper verified; property seed/runs present. Runtime/mutant assertions delegated to test reviewer. |
| Item 5, line 11 | Citation changes exact, except good citations alone do not establish the allocation/hierarchy equivalences. |
| Item 6, line 12 | Current line citations :278/:176/:201 verified and body closing footer literal verified; API/page negative-reader claim limited to supplied components. |
| Judgment “Group-by evidence,” line 31 | Raw facts dimension comparison and hierarchy call chain verified. Actual iff relation is parent hierarchy review. |
| Judgment “universe,” line 32 | `:5039-5063` does compare serialized constraint rows. `:877-886` really re-resolves only monthly windows/count-x-mean and allocations, so several other direct callers can bypass resolver guarantees; no common constraint metadata follows merely from operation name. |
| Judgment “calendar-year window,” line 33 | Resolver constants require two complete years per series; `ledger_calendar_year_window_members` lists members. |
| Judgment “unknown/missing,” line 34 | Accurate dashboard behavior for member_count>1. Known scaled operation returns true without separate metadata count. |
| Judgment “no key cross-check,” line 35 | Representative first-base source exact for rolled/scaled/allocated. Counting allocation receipt base assumes equality to identity, still under audit. |
| Judgment “new field,” line 37 | True only for multi-fact rows as recognized by valid member count >1; shownChronicle adds exactly three fields. |
| Judgment “wording,” line 38 | `titleFromIdentifier` use and ` · ` join verified. Its lower-case consequence cannot be independently proven without missing humanizeName source. |
| Judgment “type field,” line 39 | Type-only interface has no runtime output. Commit placement historical. |
| Judgment “member_of,” line 40 | Correct for normal not-found query: empty array if none, matching list keys or 5 representative identifiers. Missing-query response is a separate error and has no member_of. Names joined by commas. Other-member-record limitation as body 95. |
| Judgment “packet/README,” line 41 | Script unchanged and detail behavior correct. README not supplied at dashboard root, so route-table negative claim unverified. |
| Judgment “exports,” line 42 | Exact; becomes package API as noted above. |
| Judgment “properties,” line 43 | Seed/runs verified statically. Under-one-second runtime is cloud-machine-specific and cannot be repeated with missing fast-check. |
| Judgment “schema6,” line 44 | Representative metadata fallback exists; parent handles exact displayed values. |
| Judgment “body corrections,” line 45 | Exactly four fact fields +record are nulled. Capitalization historical claim depends absent old/shared formatter source. |

Remaining hand-off sentences concern branch/push/commit/session actions, tests/CI, or document editing history rather than code mechanisms. They cannot be independently witnessed from the final committed snapshots; no external requests were made.

## Member lookup experiment and commands

Initial command on a copied package: `BUN_INSTALL_CACHE_DIR="$PWD/work/claims/bun-cache" ~/.bun/bin/bun test ./work/claims/lookup.test.ts > work/claims/lookup.log 2>&1` stopped before tests because `@vercel/blob` was unavailable. Output: `0 pass, 1 fail, 1 error; Cannot find module '@vercel/blob' ... calibration-tree-blob.ts`. No packages were installed or fetched. The final test file subsequently changed to import only dependency-free exact function extracts.

Commands then run:

```
python3 -I work/claims/extract_lookup.py
BUN_INSTALL_CACHE_DIR="$PWD/work/claims/bun-cache" ~/.bun/bin/bun test ./work/claims/lookup.test.ts > work/claims/extracted-lookup.log 2>&1
```

Output: `Extracted lookup functions unchanged; successful packet generation stubbed to target name.` Then `2 pass, 0 fail, 34 expect() calls`, including `Checked 10 member/representative identifiers and both target names.` Exact source helpers/lookup implementations are extracted from both commits; only successful investigation packet generation is stubbed, as it does not affect resolution. Minimal fixture rows are assembled with the actual aggregate metadata and hierarchy. This is a behavior probe, **not** an unmodified package-suite run.

The five listed aggregate member keys and all five representative identifiers correctly return available:false/member_of:[aggregate], with target name in detail. Both aggregate own name and base_name return available:true. New test also covers a shared ratio numerator mapping to both scaled targets; scaled base keys continue direct success. An unknown key gives `member_of: []`. If a listed member key also resolves directly to a singleton target, the endpoint returns that target and omits membership advice; that behavior is intentional in PR-body 68 and covered by the final test's base-cell assertion. A nonrepresentative member's record id generally cannot be linked because release metadata does not expose its record-id-to-fact-key map.

Additional targeted command after adding a one-fact ratio-identity probe: `BUN_INSTALL_CACHE_DIR="$PWD/work/claims/bun-cache" ~/.bun/bin/bun test ./work/claims/lookup.test.ts --test-name-pattern 'group-by' > work/claims/unsupported-lookups.log 2>&1`. Output: `1 pass, 2 filtered out, 0 fail, 5 expect() calls`. It proves that a valid group-by value and universe set key do not resolve, although the ratio target's record id does; this tests the PR-body wording issue above.

Lookup remains a full scan. Previously a failed query scanned rows once; now it scans again to collect all memberships, parsing member JSON and, for allocated targets, allocation receipts. There is no new asymptotic O(N²) lookup. Synthetic 100,000 all-aggregate rows showed ~0.84 seconds head vs ~0.13 seconds base in the final timing run, but much larger/contradictory JIT timing variation at 1,000/10,000 rows makes these informational only. This intentionally extreme fixture establishes extra work, not a demonstrated production/FSA performance defect. FSA has only one aggregate and 132 rows. Avoid a performance finding without an actual release-size/allocation mix benchmark.

## Fresh whole-delta read

Read all diff hunks including the moved UI functions, Chronicle type changes, test-only exports, generated properties, count test, operation test fixtures, member_of/doc exception and citation edits. No unrelated runtime change or hidden modification found. The Dimensions label prefers `target_dimensions` values unless varies=true, then appends the new phrase after those values. For a representative group-by id `ed_fsa.loan_type`, titleFromIdentifier takes leaf `loan_type` before humanizing. No evidence-backed casing bug established because the formatter implementation is omitted from inputs. The tests request lower-case, but tests are not source evidence that the real helper returns lower-case.

No dependency was installed, no full frontend suite/typecheck/build was possible from these inputs, and no claims about their passing are inferred from the lightweight extracted probe.
