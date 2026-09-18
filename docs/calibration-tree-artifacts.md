# Calibration build and comparison artifacts

The calibration explorer reads precomputed schema-4 JSON from private Vercel
Blob storage. The browser does not download calibration diagnostics or rebuild
the hierarchy. Schemas 1, 2, and 3 are unsupported.

## Required Blob folder schema

```text
calibration-trees/
  manifest.json
  <country>/
    <build-artifact-id>/
      index.json
      target-index.json
      target-details-0001.json
      target-details-0002.json
      ...
      tier-1.json
      tier-2.json
      ...
      tier-N.json
```

`<build-artifact-id>` is a 64-character SHA-256 content identity. It is derived
from the schema version, country, build kind, source ID, and source artifact
digests. A Hugging Face commit remains provenance in `index.json`; it is not the
Blob directory key.

Every JSON file declares `schemaVersion: 4`. Publication refuses to replace an
existing part with different bytes.

- `manifest.json` lists every published release build and finalized staging
  build, and points to the current release build for each country.
- `index.json` contains build provenance, filter options, both root hierarchy
  levels, and descriptors for all other parts.
- `tier-N.json` contains every hierarchy level exactly `N` selections from a
  root. Tier numbers are contiguous.
- `target-index.json` contains compact target identities, weighted-error
  inputs, comparison keys, hierarchy fields, filter postings, and direct detail
  locations.
- `target-details-NNNN.json` contains complete target records for one
  contiguous ordinal range.

Comparison bundles use the same directory and file schema. Their build IDs are
derived from the ordered source build IDs and comparison mode. They are not
listed as selectable source builds in `manifest.json`.

## Target ordinals and detail shards

Every target receives a zero-based ordinal within one build. The ordinal is not
stable across builds. Numeric ordinals keep hierarchy membership and filter
postings smaller than repeated string IDs and allow the browser to represent
membership with a `Uint8Array`.

Each indexed target has a direct detail location:

```json
{
  "id": "target-id",
  "detailLocation": { "shardIndex": 2, "offset": 17 }
}
```

`shardIndex` selects `index.parts.targetDetails[shardIndex]`; `offset` selects a
record in that shard. Descriptor ranges cover every target exactly once without
gaps or overlaps.

The publisher preserves ordinal order and limits each detail file to 4,000,000
raw UTF-8 bytes. It measures the complete canonical JSON file, including
metadata and punctuation. Publication fails when one target does not fit or
when a build would require more than 9,999 shards.

## Comparison-ready target index

Each target-index record publishes one compact comparison record containing:

- normalized base name;
- Chronicle fact key, when present;
- structured source, variable, measure, and dimension identity;
- target representation;
- program, geography, dimension, and display fields;
- benchmark, estimate, weight, weight share, scale, capped error, and final
  loss contribution.

Matching applies the existing priority order: normalized base name, unique
Chronicle fact key, then unique structured identity. Ambiguous keys remain
unmatched. Candidate hierarchy fields categorize shared and added targets;
current-build hierarchy fields categorize removed targets.

An uncached ordered build pair is calculated synchronously by the comparison
API. The server reads only `index.json` and `target-index.json` from each source,
calculates reported and shared-target rows, builds both hierarchy bundles,
validates them, and uploads them. Later requests address those immutable bundle
IDs directly. Full source detail shards are not inputs to this calculation.

## Publication flows

### Release builds

```text
release repository update
  -> POST <basePath>/api/hf-webhook
  -> GitHub workflow_dispatch
  -> resolve the release to an exact Hugging Face commit
  -> fetch and hash source files at that commit
  -> compile and validate schema-4 parts
  -> upload detail shards, target index, tiers, then index
  -> add the build to manifest.json
  -> update latestReleaseBuildArtifactId only if upstream latest is unchanged
```

### Finalized staging builds

```text
staging repository main-branch update
  -> POST <basePath>/api/hf-webhook
  -> GitHub workflow_dispatch with event_kind=staging
  -> scan successful final statuses: passed, published, completed
  -> fetch each run from the exact webhook commit
  -> compile, validate, upload, and add immutable staging builds to manifest.json
  -> verify the staging branch did not advance during publication
```

Active or failed staging runs remain on the live 30-second API path. Historical
release backfill is never started by a webhook.

Set the GitHub repository variable `CALIBRATION_TREE_BUILD_ENABLED=FALSE` to
disable both automated release and finalized-staging publication.

GitHub serializes publication jobs across countries because all publishers
update the same manifest pathname. Manifest writes first use the current ETag;
after an ETag conflict, the publisher reads the manifest again, merges the
entry, replaces the manifest, and verifies the stored entry.

## Browser loading

For a release map:

```text
GET /api/microcosm/tree?country=us&release=<release>&part=index
  -> resolve release through calibration-trees/manifest.json
  -> 307 to build=<exact-build-artifact-id>
  -> stream index.json
  -> render the root
  -> start target-index.json and every tier request concurrently
  -> fetch one target-details-NNNN.json only after target selection
```

For an immutable comparison:

```text
GET /api/microcosm/comparison-tree
    ?country=us&a=<build-a>&b=<build-b>&mode=<reported|shared>&part=index
  -> build and persist both modes if absent
  -> 307 to build=<exact-comparison-build-id>
  -> use the same concurrent tier and on-demand detail loading behavior
```

Query keys include country, ordered source build IDs, comparison mode, exact
output build ID, and part. Switching builds therefore cannot display a cached
part from another build.

## Filtering indices

Hierarchy levels, groups, and nodes store sorted target ordinals. The target
index stores postings for geography level, geography, fit band, comparison fit,
and calibration status.

The browser unions selected values within one category, intersects categories,
filters hierarchy memberships, and recalculates visible metrics from compact
per-target inputs. Target detail shards are not required for navigation,
filtering, aggregation, or comparison construction.

## Authentication

The browser never receives a Blob or Hugging Face credential.

### Vercel reads and lazy comparison writes

1. Connect the private Blob store to Production and Preview deployments.
2. Confirm the deployment has `BLOB_STORE_ID`.
3. Set server-only `BLOB_READ_WRITE_TOKEN`; lazy comparison creation requires
   write access.
4. Redeploy after changing credentials.
5. Confirm direct private Blob access fails while the same-origin dashboard API
   succeeds.

Never use a `NEXT_PUBLIC_` prefix for these values.

### GitHub publication

1. Store the Blob read-write token as the Actions secret
   `BLOB_READ_WRITE_TOKEN`.
2. Store the Hugging Face credential as `HF_TOKEN` when any source repository
   is private.
3. Store `GITHUB_ACTIONS_DISPATCH_TOKEN` and `HF_WEBHOOK_SECRET` only in Vercel.
4. Configure the same webhook secret on every release and staging Hugging Face
   repository.

## Historical regeneration

Regeneration reads existing immutable Hugging Face artifacts; it does not rerun
calibration:

```sh
cd frontend
bun run publish:calibration-tree -- --country us --backfill
bun run publish:calibration-tree -- --country uk --backfill
bun run publish:calibration-tree -- --country be --backfill
bun run publish:calibration-tree -- --country us --staging-finalized
bun run publish:calibration-tree -- --country uk --staging-finalized
```

`CALIBRATION_TREE_MAX_RAW_BYTES` defaults to 100,000,000 bytes per file, in
addition to the fixed detail-shard limit. `CALIBRATION_TREE_MAX_GZIP_BYTES` can
add a compressed-size limit. Either violation fails publication and therefore
fails the GitHub Actions job.

## Verification

Run from `frontend/`:

```sh
bun test
bun run lint
bun run build
```

Then verify that:

1. The manifest and all parts declare schema 4.
2. Every descriptor returns matching bytes and an ETag.
3. Root rendering does not wait for deeper tiers.
4. Target index and tier requests start concurrently.
5. No detail shard downloads before target selection.
6. An uncached comparison persists both modes and a repeated request reuses
   them.
7. Repeated exact-part requests report CDN reuse or a positive cache age.

Do not use browser automation or screenshots for visual verification. Provide
the local preview URL and ask a person to inspect build selection and map
behavior.
