# Lane E4 report

## Outcome

Cross-dataset artifacts are now selected independently for US, UK, and Belgium.
The unsuffixed configuration remains the US contract, UK and Belgium use
country-suffixed variables, and each country has an independent cached reader.
Every configured reader validates that its manifest contains the selected
jurisdiction before any view is served.

`country` now reaches every Cross-dataset API and client query. Cross-dataset is
visible in every selectable country's navigation, while an unconfigured country
fails closed into the page's existing unavailable state with a message naming
the country and applicable environment variables. The overview and fact views
use bundle-provided source labels and group metadata instead of US-specific
presentation assumptions. Country switches also discard bundle-specific fact,
source, and filter URL state rather than applying it to the next country.

## File-by-file changes

- `AGENTS.md`: clarifies that each country used by Cross-dataset work must have
  exactly one configured directory or URL.
- `CLAUDE.md`: mirrors the per-country application-start configuration rule.
- `docs/cross-dataset-api.md`: documents all country-specific variables, the
  per-country exclusivity rule, the live Belgium URL, jurisdiction validation,
  and the `country=us|uk|be` API parameter.
- `frontend/app/api/microcosm/cross-dataset/route.ts`: parses `country` with the
  shared country parser and selects that country's reader before dispatching any
  Cross-dataset view.
- `frontend/app/api/microcosm/cross-dataset/route.test.ts`: proves a BE-only
  configuration serves Belgium and leaves default/explicit US requests in the
  existing 503-style unconfigured state.
- `frontend/components/layout/country-context.tsx`: clears Cross-dataset's
  bundle-specific view and filters when the global country selector changes,
  while preserving query state on other pages.
- `frontend/components/layout/country-context.test.ts`: covers both sides of
  that country-switch URL behavior.
- `frontend/components/layout/nav-items.ts`: removes the `usOnly` gate from the
  Cross-dataset item.
- `frontend/components/layout/nav-items.test.ts`: verifies the unchanged label
  and route and visibility for US, UK, and Belgium.
- `frontend/components/microcosm/cross-dataset-view.tsx`: scopes overview query
  keys and API requests by country; derives geography, sample, and grouping
  controls from the bundle; validates filter selections against the active
  bundle; preserves the capped-relative-error definition; and removes
  US-specific page copy.
- `frontend/components/microcosm/cross-dataset-facts-view.tsx`: threads country
  through summary, catalog, and detail requests, query keys, and links, and does
  not reuse one country's placeholder data for another.
- `frontend/lib/cross-dataset/artifact.ts`: validates and retains manifest
  `jurisdictions`, then fails closed when none of the selected country's accepted
  codes appears in the manifest.
- `frontend/lib/cross-dataset/artifact.test.ts`: covers exact jurisdiction
  matches, the UK/GB alias, missing/mismatched jurisdictions, and malformed
  jurisdiction arrays.
- `frontend/lib/cross-dataset/fact-presentation.ts`: includes country in catalog
  parameters and generated catalog/detail URLs, with the current selector state
  taking precedence over stale URL country state.
- `frontend/lib/cross-dataset/fact-presentation.test.ts`: covers country parsing,
  overrides, and URL preservation.
- `frontend/lib/cross-dataset/presentation.ts`: uses bundle source/group labels,
  preserves bundle source order, derives available controls from group
  dimensions, and places country in group-to-fact links.
- `frontend/lib/cross-dataset/presentation.test.ts`: replaces US-ordering and
  hard-coded-label expectations with bundle-driven presentation and
  country-aware link coverage.
- `frontend/lib/cross-dataset/source.ts`: resolves independent US/UK/BE
  directory, URL, and expected-run settings; enforces directory/URL exclusivity
  per country; supplies the jurisdiction check; and caches one reader per
  country/configuration.
- `frontend/lib/cross-dataset/source.test.ts`: covers each environment-variable
  family, per-country conflicts and missing configuration, simultaneous-country
  configuration, expected run IDs, jurisdiction rejection, cache isolation, and
  the trimmed Belgium bundle.
- `frontend/lib/cross-dataset/fixtures/be-frontend-bundle/manifest.json`: trimmed
  manifest fixture based on `.lane-fixtures/be-frontend-bundle`, retaining the
  real bundle shape, hashes, 726-fact count, three source IDs, and
  `jurisdictions: ["BE"]`.
- `frontend/lib/cross-dataset/fixtures/be-frontend-bundle/summary.json`: matching
  real-shape summary fixture with the three Belgium source labels. The source
  `.lane-fixtures` directory is not included.
- `LANE_E4_REPORT.md`: this report.

## Environment and jurisdiction contract

| Country | Directory | Base URL | Optional expected run ID | Accepted manifest code |
| --- | --- | --- | --- | --- |
| US | `CROSS_DATASET_ARTIFACT_DIR` | `CROSS_DATASET_ARTIFACT_BASE_URL` | `CROSS_DATASET_EXPECTED_RUN_ID` | `US` |
| UK | `CROSS_DATASET_ARTIFACT_DIR_UK` | `CROSS_DATASET_ARTIFACT_BASE_URL_UK` | `CROSS_DATASET_EXPECTED_RUN_ID_UK` | `UK` or `GB` |
| Belgium | `CROSS_DATASET_ARTIFACT_DIR_BE` | `CROSS_DATASET_ARTIFACT_BASE_URL_BE` | `CROSS_DATASET_EXPECTED_RUN_ID_BE` | `BE` |

For each country, configuring both its directory and base URL is invalid.
Different countries may be configured simultaneously. The expected-run variable
for the selected country retains the prior exact run-ID match semantics. A
missing jurisdiction list also fails closed. A mismatch raises the same
503-rendered `ArtifactError` family, with `stale_artifact` and text of the form:

```text
Cross-dataset bundle is for jurisdictions BE, not US.
```

An unconfigured Belgium request, for example, names both applicable location
variables:

```text
Cross-dataset artifacts are not configured for BE. Set CROSS_DATASET_ARTIFACT_DIR_BE or CROSS_DATASET_ARTIFACT_BASE_URL_BE.
```

## Verification

Two independent read-only reviews covered the server/API path and the
UI/navigation/country-switch path. Both completed with no remaining findings.
The protected `frontend/app/layout.tsx`, `frontend/app/globals.css`, and package
scripts are unchanged. `git diff --check` produced no output.

All gates ran from `frontend/`.

### `bun test`

```text
bun test v1.3.11 (af24e281)

 219 pass
 4 todo
 0 fail
 855 expect() calls
Ran 223 tests across 30 files. [407.00ms]
```

### `bun run lint`

```text
$ tsc --noEmit
```

### `IS_WEBPACK_TEST=1 CROSS_DATASET_ARTIFACT_DIR_BE=/Users/maxghenis/PolicyEngine/_worktrees/caldiag-e4/frontend/lib/cross-dataset/fixtures/be-frontend-bundle bun run build`

```text
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

The successful production build configured exactly one artifact location: the
local Belgium fixture via `CROSS_DATASET_ARTIFACT_DIR_BE`. It used the unchanged
`build` script with Next's webpack selector because the literal Turbopack path
attempts prohibited network/worker-port operations in this lane sandbox. The
green run compiled successfully, ran TypeScript, generated all 20 static pages,
and collected build traces. No build workaround or package-script change is
committed.

LANE E4 DONE
