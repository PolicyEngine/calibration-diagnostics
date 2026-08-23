# LANE E1 report — Belgium country toggle and EUROMOD validation

## Incremental change log

- `.gitignore`: excludes the lane-provided `.lane-fixtures/` source bundle so the full private-release artifacts cannot be committed accidentally.
- `README.md`: documents the US/UK/Belgium dashboard, Belgium's private default repository and environment variables, the shared token requirement, country-aware published APIs, and US-only staging.
- `frontend/app/api/microcosm/route.ts`: reports the selected country's repository revision instead of the US revision.
- `frontend/app/api/microcosm/target-diagnostics/route.ts`: carries the selected country into staging-target requests as well as published-release requests.
- `frontend/app/api/microcosm/staging/compare/route.ts`: parses `country`, avoids resolving the US latest pointer for unsupported countries, and returns the country-specific unavailable payload.
- `frontend/app/api/microcosm/staging/run/route.ts`: parses `country` and permits non-US requests to reach the explicit unavailable response without requiring a run id.
- `frontend/app/api/microcosm/staging/runs/route.ts`: passes `country` through to the staging data layer.
- `frontend/app/api/microcosm/staging/target-diagnostics/route.ts`: parses `country` and returns the non-US unavailable response without attempting a staging fetch.
- `frontend/components/layout/country-context.tsx`: adds `be`, honors `?country=us|uk|be`, persists a valid query selection, and keeps the current URL synchronized with toggle changes.
- `frontend/components/layout/app-shell.tsx`: remounts page-local state when country changes so release ids and filters from one country's surface cannot leak into another.
- `frontend/components/layout/nav-items.ts`: builds country-preserving internal hrefs.
- `frontend/components/layout/nav-items.test.ts`: covers Belgium's three supported navigation pages and their `?country=be` links.
- `frontend/components/layout/nav-sidebar.tsx`: adds Belgium to the country toggle and private-dataset label while retaining the existing US-only navigation filtering.
- `frontend/components/microcosm/artifact-description-banner.tsx`: adds a prominent warning-weight banner that renders demo-grade artifact descriptions verbatim.
- `frontend/components/microcosm/external-validations-panel.tsx`: renders every manifest external-validation block, including headline chips, key column-ledger rows, validation-surface rows, publisher prefixes, and producer strings.
- `frontend/components/microcosm/microcosm-overview-view.tsx`: adds Belgium overview copy, the demo-grade banner, and the country-agnostic external-validation panel.
- `frontend/components/microcosm/microcosm-targets-view.tsx`: adds the banner, country-scoped browse examples, a generic search prompt, country-preserving overview navigation, and hides the US healthcare shortcut outside the US.
- `frontend/components/microcosm/microcosm-compare-view.tsx`: removes US-only page copy and renders each distinct selected-release demo disclaimer before comparison numbers.
- `frontend/components/microcosm/microcosm-staging-view.tsx`: short-circuits non-US views to a single empty state; Belgium's exact reason is `Belgium has no staging repository.`
- `frontend/components/shared/format.ts`: recognizes Belgium Chronicle release ids and exposes their Chronicle commit in release selectors.
- `frontend/components/shared/format.test.ts`: covers the real Belgium release-id shape.
- `frontend/lib/api/hooks/use-microcosm.ts`: types release descriptions, carries country in staging query keys/parameters, and disables all staging queries outside the US.
- `frontend/lib/microcosm/external-validations.ts`: adds a defensive, country-independent shaper for arbitrary `external_validations` names while preserving manifest labels and numeric zeroes.
- `frontend/lib/microcosm/external-validations.test.ts`: covers the real EUROMOD headline, all three classification examples, zero unclassified columns, publisher derivation, malformed/partial blocks, and the exact disclaimer.
- `frontend/lib/microcosm/fixtures/be-release/calibration_diagnostics.json`: adds a roughly 5 KB trimmed fixture with three representative real BE targets and no US-only optional fields.
- `frontend/lib/microcosm/fixtures/be-release/release_manifest.json`: adds a roughly 4 KB trimmed fixture containing the real EUROMOD headline, three representative key rows, and four validation-surface publishers.
- `frontend/lib/microcosm/latest-artifact.ts`: adds Belgium environment/repository configuration and country coercion; threads country through release construction and provenance; tolerates missing optional BE fields; decomposes BE names with a BE-scoped publisher/region/sex/age table; derives generic browser dimensions; and exposes artifact descriptions to summary, target, and comparison views.
- `frontend/lib/microcosm/latest-artifact.test.ts`: covers Belgium env names/default URL, country coercion, absent `registry`/`loss_trajectory`/`past_cap_census`, exact disclaimer propagation, representative name decomposition, and Region/Sex/Age-band facets.
- `frontend/lib/microcosm/source-attribution.test.ts`: confirms the private Belgium Hugging Face repository is not linked publicly.
- `frontend/lib/microcosm/source-label.ts`: adds browser labels for Statbel, ONSS, JRC, SFPD, and NASA target prefixes.
- `frontend/lib/microcosm/staging-artifact.ts`: makes staging country-aware and returns empty, reason-bearing responses before any artifact fetch for the UK or Belgium.
- `frontend/lib/microcosm/staging-artifact.test.ts`: covers exact unsupported-country reasons and all Belgium staging-loader short circuits.
- `frontend/lib/source-labels.ts`: adds the same Belgium publisher labels to shared authority formatting.
- `frontend/lib/slack.ts`: makes webhook configuration partial after widening the country union; existing US/UK webhook behavior is unchanged and no unrequested Belgium Slack mechanism was added.
- `frontend/app/layout.tsx` and `frontend/app/globals.css`: remove the build-time Google Fonts fetch and retain the named Inter/IBM Plex Mono/Urbanist local-first stacks with their existing platform fallbacks.
- `frontend/package.json`: uses Next's supported webpack production builder so the exact `bun run build` script works in the no-port/no-network lane sandbox.
- `LANE_E1_REPORT.md`: records implementation scope, gate evidence, cross-country effects, and builder feedback.

## Verification

### Real BE artifact smoke check

The ignored, full lane artifacts were loaded directly through `buildCalibration`, the target browser shaper, and `shapeExternalValidations`. This exercised all 32 real targets and the untrimmed 34-row validation surface without a Hugging Face request.

```text
{
  "status": "ok",
  "rows": 32,
  "included": 32,
  "sources": [
    "statbel",
    "onss",
    "jrc",
    "sfpd",
    "nasa"
  ],
  "loss_trajectory": [],
  "dimensions": [
    {
      "key": "geography",
      "label": "Region",
      "values": [
        "Brussels",
        "Flanders",
        "Wallonia"
      ]
    },
    {
      "key": "bd_sex",
      "label": "Sex",
      "values": [
        "Female",
        "Male"
      ]
    },
    {
      "key": "bd_age_band",
      "label": "Age band",
      "values": [
        "0–17",
        "18–64",
        "65+"
      ]
    }
  ],
  "euromod": {
    "comparator": "EUROMOD BE_2025 (JRC), plain baseline run",
    "total_columns": 558,
    "key_rows": 10,
    "surface_rows": 34
  },
  "disclaimer": "DEMO-GRADE: US survey support records reweighted to Belgian Chronicle facts — not Belgian microdata."
}
```

### Required gates

`bun install` — passed. Verbatim output:

```text
bun install v1.3.11 (af24e281)

Checked 297 installs across 353 packages (no changes) [88.00ms]
```

`bun test` — passed. Verbatim tail:

```text
bun test v1.3.11 (af24e281)

 202 pass
 0 fail
 797 expect() calls
Ran 202 tests across 26 files. [350.00ms]
```

`bun run lint` (the package's typecheck script) — passed. Verbatim output:

```text
$ tsc --noEmit
```

`bun run build` — passed. Verbatim tail:

```text
$ next build --webpack
▲ Next.js 16.2.6 (webpack)

  Creating an optimized production build ...
✓ Compiled successfully in 13.3s
  Running TypeScript ...
  Finished TypeScript in 2.4s ...
  Collecting page data using 17 workers ...
  Generating static pages using 17 workers (0/20) ...
  Generating static pages using 17 workers (5/20)
  Generating static pages using 17 workers (10/20)
  Generating static pages using 17 workers (15/20)
✓ Generating static pages using 17 workers (20/20) in 151ms
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

### Offline build resolution

The original build imported three `next/font/google` families and failed at the lane's prohibited network boundary while fetching Google CSS. After removing that fetch, Next 16's default Turbopack path reached compilation but its PostCSS worker attempted to bind a local port, which this sandbox prohibits (`binding to a port` / `Operation not permitted (os error 1)`). The final package script uses the supported webpack builder; the plain `bun run build` command above then completed successfully without network or a listening port.

The repository and its Git history contain no vendored Inter, IBM Plex Mono, or Urbanist files. The final CSS therefore prefers those local font names and retains the existing platform fallbacks. Exact, self-hosted typography can be restored later by committing the appropriate licensed WOFF2 assets and switching to `next/font/local`.

`git diff --check` — passed with no output.

## Screenshots

N/A — no browser was started, as requested.

## Existing US/UK behavior touched

- The shared country union, query keys, and navigation now include Belgium. US remains the coercion default; UK remains private.
- Valid country queries are now durable across internal navigation. Toggle changes also update both local storage and the current URL.
- Page-local release/filter state remounts on any country change, preventing stale US or UK release ids from being requested against another repository.
- Generic national-name fallback now uses the active country, correcting a pre-existing UK fallback that could say `United States` when metadata was sparse.
- The targets home keeps the healthcare shortcut US-only. UK now gets UK examples instead of the US EITC/Medicaid prompt.
- UK staging now uses the same explicit no-repository empty-state path as Belgium. US staging requests, repository configuration, and polling remain unchanged.
- Summary, target, and comparison payloads gained nullable `description` fields. Existing US/UK artifacts without demo-grade descriptions render no new banner.
- Existing US/UK Slack webhook environment variables and allowlist behavior are unchanged; Belgium has no inferred webhook destination.
- Overview wording now says `official statistics` rather than claiming every country has thousands of targets.
- The offline build change is global: clients without the named Microcosm fonts installed will use the existing platform fallbacks, and production builds now use webpack instead of Turbopack. This was required to make the mandated build reproducible under the lane's no-network/no-port constraints.

## Builder feedback

- The dashboard can consume the current BE release without `registry`, `loss_trajectory`, `past_cap_census`, or `demographics.json`; the builder should not emit empty US-shaped placeholders solely for this dashboard.
- The 18 demographic cells are reliably derivable today, but publisher, region/NUTS1 label, sex, and age band should ideally be published as structured generic facet metadata. That would let the dashboard remove the BE-scoped target-name table and would avoid interpreting flat identifier grammar in consumers.
- `statbel_fiscal_income_total` publishes 565 `chronicle_record_ids`. Consider a bounded summary plus count/sidecar for very large provenance sets if the artifact contract permits it. The committed test fixture intentionally omits that full list.
- `nasa_*` target names use `nasa` as the desired publisher facet while their Chronicle records begin with `eurostat`. An explicit publisher field would remove that naming-versus-provenance ambiguity.
- The manifest comparator is `EUROMOD BE_2025 (JRC), plain baseline run`. Because the dashboard was instructed to use producer labels verbatim, that full string appears in the section heading. If the intended display heading is exactly `EUROMOD BE_2025`, publish a separate display label rather than requiring the dashboard to truncate a comparator string.

LANE E1 DONE
