# Lane E2 report

## Outcome

The free-form `release_manifest.external_validations` surface is removed. The
Belgium overview now uses the same component, sections, and order as US/UK, with
only the already-shared country intro-copy table varying by country. Release
descriptions remain a generic, quiet provenance note.

Belgium source IDs now come from the first segment of
`metadata.chronicle_record_ids`, labels come from one shared publisher map, and
`cell_<region>_<sex>_<ageband>` facets are handled by a country-independent
filter-pattern spec. There are no Belgium branches left in the target adapter.

`README.md` contained no external-validation or EUROMOD-dashboard description,
so no README edit was needed for the removed feature. Cross-dataset comparison
remains confined to the evaluation-bundle path.

## File-by-file changes

- `frontend/components/layout/country-context.tsx`: exports the existing client
  country predicate so the conformance TODO can exercise the still-closed client
  country registry behavior.
- `frontend/components/microcosm/artifact-description-banner.tsx`: keeps release
  descriptions generic while replacing the warning pill and warning border with
  the ordinary provenance/notes visual weight.
- `frontend/components/microcosm/artifact-description-banner.test.ts`: verifies
  generic description rendering, quiet styling, and the no-description null case.
- `frontend/components/microcosm/external-validations-panel.tsx`: deleted.
- `frontend/components/microcosm/microcosm-overview-view.tsx`: removes the
  external-validations import and section; no country-specific section branch was
  added.
- `frontend/lib/microcosm/external-validations.ts`: deleted.
- `frontend/lib/microcosm/external-validations.test.ts`: deleted.
- `frontend/lib/microcosm/fixtures/be-release/release_manifest.json`: removes the
  complete `external_validations` payload.
- `frontend/lib/microcosm/fixtures/zz-release/calibration_diagnostics.json`: adds
  four synthetic targets, including filter-coded facets and an unknown Chronicle
  publisher prefix.
- `frontend/lib/microcosm/fixtures/zz-release/release_manifest.json`: adds the
  synthetic release identity and generic description fixture.
- `frontend/lib/microcosm/latest-artifact.ts`: makes `COUNTRY_REPO` the typed
  server registry (including national geography and synthetic `zz`); derives
  publishers from Chronicle IDs; replaces Belgium publisher/name parsers with a
  filter-pattern decomposition spec and artifact variable metadata; preserves
  legacy US/UK dotted family grouping.
- `frontend/lib/microcosm/latest-artifact.test.ts`: updates Belgium expectations
  to Chronicle-derived publishers and filter-derived facets, and adds a US dotted
  family regression test.
- `frontend/lib/microcosm/source-label.ts`: delegates to the single shared source
  authority labeler instead of maintaining a second map.
- `frontend/lib/microcosm/source-label.test.ts`: aligns the fallback-label test
  with the shared humanizer.
- `frontend/lib/microcosm/staging-artifact.ts`: reads country geography from the
  repository registry instead of another exhaustive country-name table.
- `frontend/lib/microcosm/third-country-conformance.test.ts`: adds four passing
  `zz` data-shape assertions and four behavioral TODO assertions for current
  schema/consumer gaps.
- `frontend/lib/slack.ts`: retains curated existing-country labels with a generic
  fallback, so adding a registry country does not require a Slack table entry.
- `frontend/lib/source-labels.ts`: adds Eurostat to the one shared authority map;
  the existing Statbel/ONSS/JRC/SFPD/NASA entries now serve every dashboard path.
- `frontend/lib/source-labels.test.ts`: verifies all required publisher labels and
  the readable unknown-prefix fallback.
- `docs/spec-driven-countries.md`: records the current contract, remaining tables,
  `zz` acceptance test, and schema additions that would eliminate those tables.
- `LANE_E2_REPORT.md`: this report.

## Third-country conformance

Passing assertions:

1. One `COUNTRY_REPO` registration supplies parsing, repository URL, revision,
   and national-geography behavior.
2. The fixture produces the common overview/highlights shape, including its
   artifact description and two family groups.
3. Chronicle prefixes become source keys; an unseen prefix gets a readable label
   and appears correctly in the treemap.
4. Filter-coded targets produce Region, Sex, and Age band facets and target
   dimensions without a `zz` parser or label table.

Behavioral TODOs (each callback contains an assertion verified to fail today):

1. Client country parsing is still closed to a TypeScript country table.
2. Overview shaping does not propagate a typed artifact `presentation` block for
   overview/target-browser copy.
3. Treemap shaping does not consume artifact `publisher_labels` overrides.
4. Target shaping does not consume top-level/target-level structured
   `dimensions`; it still needs the legacy filter-pattern adapter.

## Belgium special cases remaining from PR #163

- `country-context.tsx` and `nav-sidebar.tsx` still own the closed client country
  union, selector order, and dataset labels (`us`/`uk`/`be`).
- `microcosm-overview-view.tsx` and `microcosm-targets-view.tsx` retain Belgium
  entries in the same shared country-copy mechanisms already used for US/UK.
  These are allowed copy variations, not section variations.
- `microcosm-staging-view.tsx` retains the UK/Belgium unavailable-reason table and
  US-only staging behavior.
- `components/shared/format.ts` recognizes Belgium's Chronicle release-ID format
  with an explicit `-be-` regex.
- `latest-artifact.ts` retains Belgium environment-variable names, repository,
  revision, and national-geography registration. These are repository
  configuration, not target-shaping branches.
- `slack.ts` retains the curated Belgium flag/label; unknown registered countries
  now use the generic fallback.
- `README.md` still documents the supported `us|uk|be` query values and Belgium's
  private repository/environment variables.
- PR #163's Belgium-specific fixture and regression tests remain as contract
  coverage. Its source-attribution and staging API behavior is otherwise shared
  with UK/non-US countries, while staging hooks remain capability-gated by the
  existing US-only checks.

The removed external-validation implementation/manifest field and the former
Belgium publisher, population-facet, family, and geography shaping branches do
not remain.

## Gates

Run from `frontend/`.

### `bun test`

```text
bun test v1.3.11 (af24e281)

 205 pass
 4 todo
 0 fail
 800 expect() calls
Ran 209 tests across 27 files. [413.00ms]
```

### `bun run lint`

```text
$ tsc --noEmit
```

### `IS_WEBPACK_TEST=1 bun run build`

```text
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

The build used the unchanged `build` script with Next's webpack selector because
the literal Turbopack invocation attempted to fetch Google Fonts and the lane is
network-disabled. The green run compiled successfully, ran TypeScript, generated
all 20 static pages, and collected build traces. No workaround was committed and
`frontend/app/layout.tsx`, global CSS, and package scripts are untouched.

LANE E2 DONE
