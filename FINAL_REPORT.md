# PR B `spec-artifact-contract` final report

## Status

PR B is complete.

- Branch: `spec-artifact-contract`
- Required starting commit: `9bf2fd40affc0fa7e8a148d4eb50a11a06f7d1ae`
- Current PR A base: `43925618ab13b6e97e4fcb5eeacce160701d7564`
- Last code/integration commit before this report:
  `dd640d996d7b22a5ab3b2946f6208e4cd23cb870`
- Final repository head: the `docs: finalize PR B report` commit containing
  this file (`HEAD`). The exact immutable hash is also reported in the final
  handoff message after Git creates the commit.
- Final ancestry: 0 commits behind and 10 commits ahead of
  `spec-countries-registry`; every ahead commit belongs to this branch.

The local `spec-countries-registry` ref advanced from the required starting
commit to `4392561` while this work was in progress. The new PR A review commit
was merged as `dd640d9`, without rebasing, amending, or otherwise rewriting PR A.

## Commits

1. `89472d9` — `docs: start PR B progress log`
2. `8e73e9c` — `docs: record PR B baseline and impact review`
3. `b73c6eb` — `feat: read artifact presentation metadata`
4. `b496b97` — `feat: honor artifact publisher labels`
5. `6144061` — `feat: support structured target dimensions`
6. `7a17f8c` — `feat: read structured target identifiers`
7. `b26c4a6` — `feat: render artifact presentation and labels`
8. `3e00c8e` — `docs: document artifact contract`
9. `dd640d9` — `Merge updated country registry base`
10. `HEAD` — `docs: finalize PR B report` (this report-only commit)

## Contract delivered

- B1: validated, length-capped `release_manifest.presentation` with artifact →
  marked legacy → generic view fallback.
- B2: validated `release_manifest.publisher_labels`, propagated through rows,
  variables, target responses, treemaps, trees, and row-aware views.
- B3: defensive diagnostics dimension dictionaries, structured row dimensions,
  rank-aware facets, per-row `dimension_adapter`, and calibration
  `target_schema`, with legacy filter/name adapters preserved.
- B4: structured source and variable objects, precedence rules, source URL and
  citation, variable label and measure, and artifact-family selection.
- B5: all original conformance todos enabled unchanged, the fifth structured
  source/variable conformance test added, and an exact schema-5 live-US-shaped
  BEA NIPA regression row added.
- B6: the implemented producer contract, migration order, validation rules,
  adapter rules, and compatibility guarantees are documented.

## Files changed

Relative to the current `spec-countries-registry` base:

- `FINAL_REPORT.md`
- `PROGRESS.md`
- `docs/spec-driven-countries.md`
- `frontend/components/microcosm/microcosm-overview-view.tsx`
- `frontend/components/microcosm/microcosm-target-detail.test.ts`
- `frontend/components/microcosm/microcosm-target-detail.tsx`
- `frontend/components/microcosm/microcosm-targets-view.tsx`
- `frontend/lib/api/hooks/use-microcosm.ts`
- `frontend/lib/microcosm/calibration-tree.test.ts`
- `frontend/lib/microcosm/calibration-tree.ts`
- `frontend/lib/microcosm/latest-artifact.test.ts`
- `frontend/lib/microcosm/latest-artifact.ts`
- `frontend/lib/microcosm/presentation.test.ts`
- `frontend/lib/microcosm/presentation.ts`
- `frontend/lib/microcosm/third-country-conformance.test.ts`
- `frontend/lib/source-labels.test.ts`
- `frontend/lib/source-labels.ts`

The merged base also contains PR A's review changes in
`frontend/app/api/hf-webhook/route.ts`; that file is not a PR B change relative
to the current base.

## Required gate tails

All commands ran from `frontend` after the updated PR A base was merged.

### `bun test`

Exit code: 0

```text
bun test v1.3.11 (af24e281)

 263 pass
 0 fail
 1040 expect() calls
Ran 263 tests across 32 files. [270.00ms]
```

The dedicated conformance run confirms every former todo is enabled:

```text
bun test v1.3.11 (af24e281)

 9 pass
 0 fail
 29 expect() calls
Ran 9 tests across 1 file. [89.00ms]
```

`frontend/lib/microcosm/third-country-conformance.test.ts` contains no
`test.todo` call.

### `bun run lint`

Exit code: 0

```text
$ tsc --noEmit
```

### `bun run build`

Exit code: 0

```text
$ next build
▲ Next.js 16.2.6 (webpack)

  Creating an optimized production build ...
✓ Compiled successfully in 1106ms
  Running TypeScript ...
  Finished TypeScript in 2.1s ...
  Collecting page data using 17 workers ...
  Generating static pages using 17 workers (0/20) ...
  Generating static pages using 17 workers (5/20)
  Generating static pages using 17 workers (10/20)
  Generating static pages using 17 workers (15/20)
✓ Generating static pages using 17 workers (20/20) in 142ms
  Finalizing page optimization ...
  Collecting build traces ...

Route (app)
┌ ○ /
├ ○ /_not-found
├ ƒ /api/hf-webhook
├ ƒ /api/microcosm
├ ƒ /api/microcosm/compare
├ ƒ /api/microcosm/cross-dataset
├ ƒ /api/microcosm/releases
├ ƒ /api/microcosm/staging/compare
├ ƒ /api/microcosm/staging/run
├ ƒ /api/microcosm/staging/runs
├ ƒ /api/microcosm/staging/target-diagnostics
├ ƒ /api/microcosm/target-diagnostics
├ ƒ /api/microcosm/target-investigation
├ ƒ /api/microcosm/target-tree
├ ƒ /api/microcosm/target-treemap
├ ƒ /api/microcosm/variable
├ ○ /icon.svg
├ ○ /microcosm
├ ○ /microcosm/compare
├ ○ /microcosm/datasets
├ ƒ /microcosm/model-coverage
├ ○ /microcosm/pipeline
├ ○ /microcosm/staging
├ ƒ /microcosm/targets
└ ○ /microcosm/variables


○  (Static)   prerendered as static content
ƒ  (Dynamic)  server-rendered on demand
```

## Deliberately left out

- No producer release artifact was changed; this PR defines and consumes the
  contract, while the documentation gives producers their migration checklist.
- The marked US/UK/BE presentation fallbacks and both legacy dimension adapters
  remain until those producers publish the new blocks.
- No arbitrary presentation sections, Markdown renderers, component selection,
  per-country adapter selection, `zz` production conditional, or new
  country-copy table entry was added.
- The source-ID-only explorer breadcrumb retains the shared humanizer because
  its state has no enriched row label. Every row-aware source display uses the
  artifact label.
- No production font asset, build-script change, push, or pull request was
  added. The temporary offline-build mock was removed after verification.
- The attempted GitNexus index could not register in the sandboxed home
  directory; repository-wide symbol and import searches supplied the read-only
  impact analysis, and the generated local index was removed.

## Deviation — build environment only

There is no deviation from design-brief sections B1-B6.

The default-environment build could not use the sandbox's prohibited network to
fetch IBM Plex Mono, Inter, and Urbanist from Google Fonts. Supplying Next's
offline font-response hook exposed a second sandbox restriction: default
Turbopack attempted to create a helper process that binds a local port and
failed with `Operation not permitted`. The successful required command was run
as literal `bun run build` with:

```text
IS_WEBPACK_TEST=1
NEXT_FONT_GOOGLE_MOCKED_RESPONSES=<temporary local response module>
```

`IS_WEBPACK_TEST` makes Next select its webpack production builder; the mock
mapped the three exact Google CSS requests to valid WOFF2 payloads bundled with
Next solely for offline compilation. The temporary module was untracked and was
deleted after the exit-0 build. No forbidden source or package-script file was
changed. A normal network-enabled build remains the production-font validation.

## Repository integrity

- `git diff --check`: passed with no output.
- Forbidden-file diff (`frontend/app/layout.tsx`,
  `frontend/app/globals.css`, `frontend/package.json`): empty.
- Production files changed by PR B contain no `zz` branch or conditional.
- PR A commits were not amended or rebased.
- No stash command was used.
- No push or pull request was performed.
