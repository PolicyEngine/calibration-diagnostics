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

Target source IDs are derived generically from the first dotted segment of
`metadata.chronicle_record_ids`, with structured source IDs and legacy name
parsing as fallbacks. Artifact publisher labels take precedence over the shared
publisher-label map and humanized unknown prefixes. Filter-coded target facets
may be decoded by a country-agnostic pattern spec when a row does not publish
structured dimensions. Cross-dataset comparisons are not part of this release
contract: they are served only by `/microcosm/datasets` from
`cross_dataset.frontend_bundle.v1`.

## Code-owned metadata that remains

`COUNTRY_REGISTRY` in `frontend/lib/microcosm/countries.ts` is the only required
registration point: country unions and parsers, selector lists, dataset and
national-geography labels, public/private link behavior, and page gating read
the registration or the artifact `country` block. Overview and target-browser
copy retains marked per-country tables only as fallbacks for releases without
artifact `presentation`. Publisher display names retain a shared TypeScript map
as the fallback for publisher keys absent from artifact `publisher_labels`.
Target decomposition retains a generic filter-pattern table plus legacy US name
grammar (FIPS/state, filing status, return type, income band, and
qualifying-child rules) for rows without structured dimensions.

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

The conformance suite includes passing assertions for artifact presentation,
publisher labels, structured dimensions, and structured source and variable
identifiers. It has no remaining todos and requires no `zz` conditionals or
production tables.

## Schema additions that remove the tables

| Current code-owned table or rule | Artifact addition |
| --- | --- |
| Country display name, national geography, repository visibility, and supported pages | A typed `country` block in `release_manifest` with `code`, `label`, national `geography_id`/`geography_label`, `repository_visibility`, and enumerated `capabilities`. Selector options should come from registered repositories; capabilities, not country codes, gate pages. |
| Overview authorities/examples and target-browser prompt | A narrowly typed `presentation` block in `release_manifest` for those existing text slots. It must not define arbitrary sections, component names, or payload renderers. |
| Shared publisher-label map | `release_manifest.publisher_labels`, keyed by the first Chronicle record-ID segment. Artifact labels override the generic humanizer; unknown prefixes remain valid. |
| Filter-pattern decomposition, region/sex/age value maps, and legacy US target-name parsing | A `dimensions` dictionary in `calibration_diagnostics` (label, semantic role, value labels, ordering) plus `targets[].dimensions` values. Geography dimensions also declare their level/id so no country geography fallback is needed. |
| Source/variable guesses from flat target names | Structured `targets[].source` and `targets[].variable` identifiers, with the publisher still traceable to `metadata.chronicle_record_ids`. |

## Contract as implemented

### Country

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
Name/filter parsing is a legacy adapter selected from each row's artifact shape,
never by country.

### Presentation

`release_manifest.presentation` fills only the two existing overview and
target-browser introduction slots:

```json
{
  "presentation": {
    "overview_intro": "Release-owned overview introduction.",
    "targets_intro": "Release-owned target-browser prompt."
  }
}
```

`releasePresentation` accepts only these keys when their values are non-empty
strings. Values are trimmed and capped at 600 characters; unknown keys and
malformed values are dropped. The reader returns `null` when neither slot is
valid. The typed block is returned as `presentation` on the calibration summary
and target-diagnostics page.

Each view resolves copy in this order: the artifact slot, the marked legacy
US/UK/BE copy, then generic copy. The overview's live-source attribution
sentence remains code-owned. The legacy tables can be deleted after all three
existing producers publish `presentation`.

### Publisher labels

`release_manifest.publisher_labels` maps the first Chronicle record-ID segment
to its display name:

```json
{
  "publisher_labels": {
    "novastat_agency": "Nova Statistics Agency"
  }
}
```

The block must be a plain object. Keys must match
`^[a-z][a-z0-9_]*$` case-insensitively, and values must be non-empty strings;
values are trimmed and invalid entries are dropped. An absent or malformed
block becomes `{}`. Every enriched target row carries `source_label`, and the
field also appears on target responses and variable summaries. Treemap,
calibration-tree, target-browser, and target-detail presentations use the row
label when available. Label precedence is the manifest map, then a structured
row's `source.label`, then the shared authority humanizer.

### Structured dimensions

`calibration_diagnostics.json` may publish a dimension dictionary and a
dimension-value object on each target:

```json
{
  "schema_version": 7,
  "dimensions": {
    "region": {
      "label": "Region",
      "role": "geography",
      "level": "region",
      "values": {
        "north": "North",
        "south": "South"
      },
      "order": ["north", "south"]
    },
    "sex": {
      "label": "Sex",
      "values": {
        "female": "Female",
        "male": "Male"
      }
    },
    "age_band": {
      "label": "Age band"
    }
  },
  "targets": [
    {
      "dimensions": {
        "region": "north",
        "sex": "female",
        "age_band": "0_17"
      }
    }
  ]
}
```

`diagnosticsDimensions` requires a plain-object dictionary and a non-empty
string `label` on each retained entry. It recognizes only `"geography"` as a
semantic `role` today. Optional `level` and string value labels are trimmed;
malformed optional entries are dropped without throwing. An explicit `order`
array overrides `values` key order. Unknown target dimension IDs remain valid:
their IDs and raw values are humanized. When an age-band value lacks an
artifact label, range values such as `0_17` and `65_plus` become `0–17` and
`65+`.

A geography-role dimension sets `row.geography` and uses its declared `level`
or `"region"`. Other dimensions become `target_dimensions` with `key`,
`label`, `value`, `source_key`, `raw_value`, and an optional zero-based `rank`.
The published dimension ID, not its display label, determines `key`. Simple
lowercase IDs retain keys such as `bd_age_band`; IDs containing other
characters receive a lossless query-safe encoding. Consequently, two distinct
dimensions may share a display label without merging into one facet.
Facet values use rank order only when every displayed value has a rank;
otherwise the legacy facet sorter remains in force. Structured rows are also
excluded from whole-population estimate-scope inference.

### Target representation classification

The dashboard classifies the complete `targets` array once before normalizing
any row. Diagnostics schema versions do not identify the target representation:
published schema 5 and schema 6 files can both contain legacy string fields.
The structural classification is:

1. `structured` when every row has a plain-object `source` with a non-empty
   `id`, a plain-object `variable` with a non-empty `id`, and a plain-object
   `dimensions` field. Use `{}` when a target has no dimensions.
2. `legacy` when no row has object-valued `source`, `variable`, or `dimensions`
   fields.
3. `mixed` when complete structured rows, legacy rows, or partially structured
   rows occur together.
4. `unknown` when there are no target rows.

Calibration summary and target-diagnostics responses report the classification:

```json
{
  "target_schema": {
    "diagnostics_schema_version": 7,
    "structured_dimensions": true,
    "target_representation": "structured"
  }
}
```

`structured_dimensions` reports whether the diagnostics published a plain
dimension dictionary. `target_representation` selects the normalization reader.
The existing per-row `dimension_adapter` response field remains for compatibility
and describes only whether that row's dimensions came from a structured object,
a known legacy filter, or legacy name and metadata parsing.

### Structured source and variable identifiers

Fully structured targets use the following objects together. The `dimensions`
object is required and may be empty:

```json
{
  "targets": [
    {
      "source": {
        "id": "novastat_agency",
        "citation": "ZZ official population table",
        "label": "Nova Statistics Agency",
        "url": "https://stats.example/zz/pop"
      },
      "variable": {
        "id": "population",
        "label": "Resident population",
        "measure": "count"
      },
      "dimensions": {}
    }
  ]
}
```

For a `structured` file, navigation identity comes only from `source`,
`variable`, and `dimensions`. Legacy names, filters, registry families, and
Chronicle metadata cannot change its source, statistic, geography, or
breakdown dimensions. The source and variable IDs remain stable selection
keys; their labels are returned separately for display.

For a `legacy` file, the isolated legacy reader handles the established dotted,
slash, Chronicle metadata, and known filter encodings. It does not interpret an
arbitrary underscore as a structural separator.

For a `mixed` file, fully legacy rows retain legacy behavior. Partially
structured rows use the compatibility precedence: Chronicle publisher ID,
then `source.id`, then legacy source parsing; `variable.id`, then legacy
variable parsing; structured dimensions, then known filter dimensions, then
legacy metadata and name dimensions. This prevents one partially migrated row
from changing unrelated legacy rows in the same file.

### Producer follow-up

Microcosm release producers must publish all of the following before the legacy
presentation and normalization readers can be retired:

- `release_manifest.country`;
- `release_manifest.presentation`;
- `release_manifest.publisher_labels`;
- `calibration_diagnostics.dimensions`;
- a `targets[].dimensions` object on every row, including `{}` where empty; and
- structured `targets[].source` and `targets[].variable` objects on every row.
