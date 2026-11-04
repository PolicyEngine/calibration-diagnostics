# Calibration map hierarchy

The calibration map displays one producer-authored hierarchy for every target
in Microcosm diagnostics schemas 8 and 9:

1. provider
2. category
3. geography
4. zero or more dimensions
5. target

The first three and final levels occur exactly once. `dimensions` is an ordered
array because different targets can have different numbers of categorical
coordinates. This normalized representation avoids recursive authoring data
while preserving the order in which the dashboard must traverse dimensions.

## Schema 8 row

```json
{
  "name": "obr.income_tax@2025",
  "target_name": "obr.income_tax",
  "hierarchy": {
    "provider": {
      "id": "obr",
      "label": "Office for Budget Responsibility"
    },
    "category": {
      "id": "obr.efo_receipts",
      "label": "Economic and fiscal outlook receipts",
      "provider_id": "obr"
    },
    "geography": {
      "id": "K02000001",
      "label": "United Kingdom",
      "level": "country"
    },
    "dimensions": [
      {
        "id": "obr.efo_line",
        "label": "Economic and fiscal outlook line",
        "value_id": "income_tax",
        "value_label": "Income tax (gross of tax credits)"
      }
    ],
    "target": {
      "id": "obr.income_tax",
      "label": "Income tax receipts"
    }
  }
}
```

## Schema 9 catalogs

Schema 8 copies every label onto every row, so one geography or one dimension
value can be labelled differently on different rows (for example "Maine" and
"ME", or "No adjusted gross income" and "No adjusted gross income and
deficit"). Schema 9 declares provider, category, geography and dimension labels
once, in a top-level `hierarchy_catalogs` object, and each row refers to them by
ID. A schema 9 file therefore cannot give one ID two labels. Every other
top-level field and every other row field is the same as in schema 8, and the
target's own label stays on the row.

```json
{
  "schema_version": 9,
  "hierarchy_catalogs": {
    "providers": [
      {"id": "obr", "label": "Office for Budget Responsibility"}
    ],
    "categories": [
      {
        "id": "obr.efo_receipts",
        "label": "Economic and fiscal outlook receipts",
        "provider_id": "obr"
      }
    ],
    "geographies": [
      {"id": "K02000001", "label": "United Kingdom", "level": "country"}
    ],
    "dimensions": [
      {
        "id": "obr.efo_line",
        "label": "Economic and fiscal outlook line",
        "values": [
          {"id": "income_tax", "label": "Income tax (gross of tax credits)"}
        ]
      }
    ]
  },
  "targets": [
    {
      "name": "obr.income_tax@2025",
      "target_name": "obr.income_tax",
      "hierarchy": {
        "category_id": "obr.efo_receipts",
        "geography_id": "K02000001",
        "dimensions": [{"id": "obr.efo_line", "value_id": "income_tax"}],
        "target": {"id": "obr.income_tax", "label": "Income tax receipts"}
      }
    }
  ]
}
```

- A row names its category only; the provider is the category's.
- A row's `dimensions` keep producer order. Each `value_id` is looked up among
  its own dimension's `values`, so two dimensions can both have a value `all`.
- Catalogs are arrays, so a repeated ID stays visible to a reader.
- A geography ID has one level as well as one label.

The dashboard expands each schema 9 row into the schema 8 row above
(`expandHierarchyCatalogs` in `@policyengine/calibration-tree`) before any
other code reads it, so the schema 8 reader, the tree builder, published trees
and every page treat both versions the same way. A schema 9 file builds the same
tree files as the equivalent schema 8 file without label variants, apart from
the build ID and the recorded source digest, which come from the file's bytes.
The Calibration summary reports `diagnostics_schema_version` 9 and the
`hierarchy` representation.

Microcosm owns the provider/category relationship. Chronicle supplies
geography, categorical dimensions, categorical value labels, and the preferred
target label when its selected fact can describe the resulting target exactly.
Microcosm supplies an explicitly declared, reviewed target label when a target
combines facts, transforms their value, or assigns a different target period.
Missing or conflicting Chronicle-owned labels stop target compilation. The
dashboard shows these labels as published, with one exception: a geography
label that more than one geography level uses in the same build is qualified by
its level, as described in
[Geography labels shared by several levels](#geography-labels-shared-by-several-levels).

## Dashboard parsing

The top-level `schema_version` selects one reader for the entire diagnostics
file. Target row structure is not used to choose a reader.

| Diagnostics schema | Reader |
| --- | --- |
| 2–6 | Legacy name/filter reader |
| 7 | Structured source/variable/dimensions reader |
| 8 | Normalized hierarchy reader |
| 9 | Normalized hierarchy reader, after expanding `hierarchy_catalogs` |

An absent version, version 1, and unsupported future versions produce an
explicit compatibility error. A schema 7 file containing a legacy-shaped row
also produces an error instead of switching readers for that row.

The schema 8 reader requires every identifier and label, verifies that the
category references the row's provider, rejects duplicate dimension IDs, and
verifies that `hierarchy.target.id` agrees with the diagnostic target ID.

Before that, a schema 9 file is refused, with a message naming the row or
catalog entry, when:

- `hierarchy_catalogs` or one of its four arrays is missing, or an entry lacks
  an ID or label (or a category its `provider_id`, a geography its `level`);
- a catalog lists one ID twice, or one dimension lists one value ID twice;
- a category's `provider_id` is not in `providers`;
- a row refers to a category, geography or dimension the catalogs do not list,
  or to a value its own dimension does not list (including a value listed only
  under another dimension);
- a row lists one dimension twice, or is still in the schema 8 layout;
- a row's `hierarchy`, or one of its `dimensions` references, has a field
  schema 9 does not define (such as an inline schema 8 `geography` or
  `value_label`); or
- a row's `hierarchy.target.id` differs from its `target_name`.

IDs are compared after trimming whitespace, as the schema 8 reader trims them.

## Tree construction

The map first groups targets by provider and category, then by geography. It
traverses each target's `dimensions` array in producer order. The traversal
supports:

- targets with no dimensions;
- targets with one or many dimensions;
- different dimension sequences within the same category and geography; and
- target leaves alongside deeper dimension paths.

A dimension with only one categorical value in the current branch is omitted
as an interactive choice. Its complete identifier and label remain on the
target row for details, comparisons, and diagnostics. Navigation uses
`value_id`; map text and breadcrumbs use the corresponding `value_label`.

Schema 2–7 behavior remains isolated in its historical reader and tree adapter.
Humanization and country-specific parsing in those adapters must not be added
to the schema 8 path.

## Geography labels shared by several levels

The map's geography breakdown, its Geography filter, `/microcosm/targets` and
the Staging comparison maps group and select targets by geography label. In one
build, geographies at different levels can share a label. UK local-area builds
calibrate parliamentary constituencies and local authorities side by side, and
many of them have the same name, such as Ashfield, Colchester and Midlothian.
Without a distinguishing label, the two areas would be shown and selected as
one geography.

`buildCalibration` therefore applies this rule to the target rows of each
diagnostics file it reads, whatever the diagnostics schema:

- A label that rows at more than one geography level use gets its level in
  parentheses, with underscores and hyphens in the level shown as spaces:
  "Ashfield (constituency)" and "Ashfield (local authority)".
- A label that rows at only one level use is left exactly as published.
- The country's national geography label is never qualified. It is the release
  manifest's `country.geography_label`, or else the registration's
  `geography`, such as "United Kingdom". A target whose geography cannot be
  resolved falls back to that label at the national level, and it still means
  the whole country.
- A row with no level keeps its label.
- Labels and levels are compared after surrounding whitespace is removed.

The rule is `levelQualifiedGeographyLabels` in
`@policyengine/calibration-tree/geography-labels`. Every view reads its rows
from `buildCalibration`, so they all show the same labels. Matching targets
between two builds uses target names and identities, not geography labels, so
comparisons pair the same targets as before.

Published calibration trees keep the labels they were built with; see
[Filtering indices](calibration-tree-artifacts.md#filtering-indices).

## Geographies spelled more than one way

Rows name a geography by its level and `geography_id`, and each row carries its
own spelling of the geography's label. Rows from different publishers can spell
one geography differently. Release
`populace-us-2024-buildo-acs-local-766b7c7-20261017T030317Z`, for example,
spells state `0400000US23` "Maine" on its SNAP, Medicaid and IRS SOI targets
and "ME" on its state population target. The schema 8 reader reports such
spellings as label variants and does not rewrite the rows.

The calibration tree groups geography by geography ID:

- Every row of one level and geography ID takes the first spelling of that ID
  in row order, which is the spelling the reader keeps. A geography that its
  rows spell one way keeps that spelling, so trees built from rows without
  variants are unchanged.
- That spelling carries its level when rows at another geography level use it
  too (see [Geography labels shared by several levels](#geography-labels-shared-by-several-levels)).
  In a UK local-area candidate, for example, local authority `W06000006` is
  spelled "Wrexham" and then "Wrexham / Wrecsam", and a constituency is also
  "Wrexham", so the tree lists the local authority as "Wrexham (local
  authority)" while the reader reports "Wrexham" as the kept spelling.
- The label is read from every row the tree is built from, before filters. It
  is also the geography's selection value, so it is the same in the program
  and geography breakdowns, under any filter, and in published trees.
- Geographies with different IDs that share a label still form one node. A
  label that two geography levels share carries its level, so those
  geographies stay separate nodes.
- Rows without a geography ID, such as the rows of a comparison tree, keep
  their own spelling.
- The Geography filter uses the same labels. It offers one option per
  geography node, and an option selects every row of that node, whichever way
  the row spells the geography: "Maine" selects all 85 of the state's targets,
  including the population target, and "ME" is not an option. The published
  filter index stores one geography posting per node label, so live and
  published trees offer the same options and select the same targets, and
  the filter separates and merges geographies exactly as the nodes do.
- The calibration map keeps its filter selection in page state, not in the
  page URL or browser storage, so no saved link names a spelling. A request
  that names a spelling that is not an option, such as `geography=ME` in a
  hand-written API URL, selects no target in a live or a published tree, as
  any unknown value does.

The rule is `geographyLabeller` in `calibration-tree.ts` of
`@policyengine/calibration-tree`. Published trees built before geographies
were grouped by ID keep one node and one option per spelling; see
[Filtering indices](calibration-tree-artifacts.md#filtering-indices).

## Required verification

For a producer change, verify these representations in order:

1. country target declaration;
2. generated scalar reference;
3. Chronicle fact selection;
4. compiled `TargetSpec`;
5. target-registry serialization and reload;
6. compiled calibration `Target`;
7. schema 8 diagnostics row;
8. dashboard hierarchy reader; and
9. calibration-map tree traversal.

Microcosm unit tests perform this check with small Chronicle-shaped fixtures.
Do not add a committed generator that builds a complete synthetic UK target
artifact: that duplicates the production compilation path and creates a large
maintenance surface. A focused sample can instead compile selected committed
UK reference rows against the committed Chronicle-shaped fixture, serialize a
registry round trip, compile solver targets, and pass its schema 8 diagnostics
to the dashboard tests.

For local inspection, point the dashboard at the generated directory before
starting the frontend:

```bash
export MICROCOSM_UK_LOCAL_CALIBRATION_DIR=/path/to/generated/artifact
cd frontend
bun run dev
```

The override applies only to the UK selection. The loader reads
`calibration_diagnostics.json` and optionally reads `build_manifest.json`,
`release_manifest.json`, and `demographics.json` from the same directory.
Without this variable, the normal repository-backed loader is unchanged.
