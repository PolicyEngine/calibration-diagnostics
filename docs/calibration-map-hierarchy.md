# Calibration map hierarchy

The calibration map displays one producer-authored hierarchy for every target
in Microcosm diagnostics schema 8:

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

Microcosm owns the provider/category relationship. Chronicle supplies
geography, categorical dimensions, categorical value labels, and the preferred
target label when its selected fact can describe the resulting target exactly.
Microcosm supplies an explicitly declared, reviewed target label when a target
combines facts, transforms their value, or assigns a different target period.
Missing or conflicting Chronicle-owned labels stop target compilation. The
dashboard does not construct labels for schema 8.

## Dashboard parsing

The top-level `schema_version` selects one reader for the entire diagnostics
file. Target row structure is not used to choose a reader.

| Diagnostics schema | Reader |
| --- | --- |
| 2–6 | Legacy name/filter reader |
| 7 | Structured source/variable/dimensions reader |
| 8 | Normalized hierarchy reader |

An absent version, version 1, and unsupported future versions produce an
explicit compatibility error. A schema 7 file containing a legacy-shaped row
also produces an error instead of switching readers for that row.

The schema 8 reader requires every identifier and label, verifies that the
category references the row's provider, rejects duplicate dimension IDs, and
verifies that `hierarchy.target.id` agrees with the diagnostic target ID.

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
