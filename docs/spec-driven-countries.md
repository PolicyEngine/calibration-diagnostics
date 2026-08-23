# Make Microcosm countries spec-driven

## Contract today

The dashboard resolves a country's `latest.json`, then reads
`releases/<id>/calibration_diagnostics.json`. `build_manifest.json`,
`release_manifest.json`, and `demographics.json` are optional enrichments. The
diagnostics artifact owns fit values and target metadata; the build manifest owns
gates and compilation/loss metadata; the release manifest owns release identity,
role/default status, and the optional provenance `description`; demographics owns
geography coverage. A description may fill the existing provenance note, but an
artifact cannot add sections or choose components.

Target sources are derived generically from the first dotted segment of
`metadata.chronicle_record_ids`, with one shared publisher-label map and a
humanized fallback for unknown prefixes. Filter-coded target facets may be
decoded by a country-agnostic pattern spec. Cross-dataset comparisons are not
part of this release contract: they are served only by `/microcosm/datasets`
from `cross_dataset.frontend_bundle.v1`.

## Code-owned metadata that remains

`COUNTRY_REGISTRY` in `frontend/lib/microcosm/countries.ts` is the only required
registration point: country unions and parsers, selector lists, dataset and
national-geography labels, public/private link behavior, and page gating read
the registration or the artifact `country` block. Overview and target-browser
copy still sit in legacy per-country tables with a generic fallback. Publisher
display names remain in a shared TypeScript map. Target decomposition still has a
generic filter-pattern table plus legacy US name grammar (FIPS/state, filing
status, return type, income band, and qualifying-child rules).

These tables are presentation or parsing metadata, not calibration logic. They
should not grow another country branch.

## Acceptance test

`frontend/lib/microcosm/third-country-conformance.test.ts` defines a synthetic
fourth country, `zz`, with four targets, filter-coded facets, a release
description, and Chronicle record IDs whose publisher prefix is unknown to the
label map. Registering its repository in `COUNTRY_REGISTRY` must be the only
country specific code change. The same builders used by US/UK/BE must then
produce:

- the normal overview and targets response shapes and section order;
- the artifact description in the existing provenance-note slot;
- publisher/source values derived from Chronicle IDs, including a readable
  unknown-prefix fallback; and
- filter-derived geography and target dimensions with stable labels and values.

Assertions that expose a current contract gap are `test.todo` with a one-line
reason. The todos are the migration backlog; conformance is complete when all can
be enabled without adding `zz` conditionals or tables.

## Schema additions that remove the tables

| Current code-owned table or rule | Artifact addition |
| --- | --- |
| Country display name, national geography, repository visibility, and supported pages | A typed `country` block in `release_manifest` with `code`, `label`, national `geography_id`/`geography_label`, `repository_visibility`, and enumerated `capabilities`. Selector options should come from registered repositories; capabilities, not country codes, gate pages. |
| Overview authorities/examples and target-browser prompt | A narrowly typed `presentation` block in `release_manifest` for those existing text slots. It must not define arbitrary sections, component names, or payload renderers. |
| Shared publisher-label map | `release_manifest.publisher_labels`, keyed by the first Chronicle record-ID segment. Artifact labels override the generic humanizer; unknown prefixes remain valid. |
| Filter-pattern decomposition, region/sex/age value maps, and legacy US target-name parsing | A `dimensions` dictionary in `calibration_diagnostics` (label, semantic role, value labels, ordering) plus `targets[].dimensions` values. Geography dimensions also declare their level/id so no country geography fallback is needed. |
| Source/variable guesses from flat target names | Structured `targets[].source` and `targets[].variable` identifiers, with the publisher still traceable to `metadata.chronicle_record_ids`. |

### Implemented: the `country` block

`release_manifest.country` is read by `releaseCountry` in
`frontend/lib/microcosm/latest-artifact.ts` and served as `country` on the
overview summary and the target-diagnostics page (client type
`MicrocosmArtifactCountry`). Registration lives in
`frontend/lib/microcosm/countries.ts`; adding a country is one entry there.

```json
{
  "country": {
    "code": "be",
    "label": "Belgium",
    "geography_id": null,
    "geography_label": "Belgium",
    "repository_visibility": "private",
    "capabilities": ["calibration", "targets", "compare", "cross_dataset"]
  }
}
```

Merge rule: every field defaults to the registration; a well-typed string
field in the block overrides it (`label`, `geography_id`, `geography_label`,
and `repository_visibility` as `"public"` or `"private"`). `code`, when
present, must equal the selected country after lower-casing, otherwise the whole
block is ignored: the dashboard is selected by registry and an artifact cannot
re-route it. `capabilities` is filtered to the enumerated set and intersected
with the registration, so an artifact can narrow what a deployment serves but
never widen it. Unknown keys are ignored. The resolved `geography_label` is the
national geography for rows that carry none.

Capabilities: `calibration`, `targets`, `compare`, `cross_dataset`, `staging`,
`model_coverage`, `pipeline`, `variables`, `external_checks`. Navigation, the
staging loaders and hooks, and the staging page gate on capability membership.

A registration with `fixture: true` (the conformance country `zz`) is a valid
country for parsers and builders but is never listed in selectors or the
release-alert allowlist.

Schema readers must remain backward-compatible while published releases migrate.
After migration, name/filter parsing is a legacy adapter selected by artifact
schema version, never by country.
