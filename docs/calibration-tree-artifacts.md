# Calibration tree artifacts

The calibration explorer reads precomputed schema-3 JSON files from private
Vercel Blob storage. The browser does not download calibration diagnostics or
reconstruct the hierarchy.

Calibration-tree schema versions 1 and 2 are unsupported. Other Microcosm
artifacts have independent schema contracts and may use those version numbers.

## Required Blob folder schema

Each country and immutable Hugging Face commit has one directory:

```text
calibration-trees/
  latest.json
  <country>/
    <commit>/
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

There is no schema-version directory. Every JSON file, including
`latest.json`, declares `schemaVersion: 3`. Publication refuses to overwrite an
existing country, commit, and part path with different bytes.

- `index.json` contains provenance, filter options, both root levels, and a
  descriptor for every other file.
- `tier-N.json` contains every hierarchy level exactly `N` selections from a
  root. Tier numbers are contiguous.
- `target-index.json` contains compact target identities, metric inputs,
  filter postings, and a direct detail location for every target.
- `target-details-NNNN.json` contains complete target records for one
  contiguous ordinal range.
- `latest.json` maps each country to the current release and exact commit.

## Target ordinals and detail locations

Every target receives a zero-based ordinal within one compiled release. The
ordinal is not stable across releases. Numeric ordinals keep hierarchy
membership and filter postings smaller than repeated string target IDs and let
the browser represent filter membership with a `Uint8Array`.

The array position in `target-index.json` is the target ordinal. Each indexed
target includes a direct location:

```json
{
  "id": "target-id",
  "label": "Target label",
  "detailLocation": {
    "shardIndex": 2,
    "offset": 17
  }
}
```

`shardIndex` selects `index.parts.targetDetails[shardIndex]`. `offset` selects
one record from that shard's `targets` array. For target ordinal `N`, the
publisher verifies:

```text
descriptor.startTargetOrdinal + detailLocation.offset == N
```

Descriptors also declare `endTargetOrdinalExclusive`. Their ranges must cover
every target exactly once without gaps or overlaps.

## Deterministic detail sharding

The publisher preserves target ordinal order and limits each target-detail file
to 4,000,000 raw UTF-8 bytes. This limit is part of schema 3 and is not
configurable through an environment variable.

The builder serializes each target canonically, then adds consecutive records
to a shard while the complete serialized file remains at or below the limit.
The measurement includes metadata, JSON punctuation, and the trailing newline.
The next target starts a new shard when adding it would exceed the limit.

Publication fails if one target cannot fit in an empty shard or if a release
would require more than 9,999 shards.

## Publication flow

```text
Hugging Face repository update
  -> POST <basePath>/api/hf-webhook
  -> GitHub workflow_dispatch
  -> resolve the release to an exact Hugging Face commit
  -> fetch and hash source files at that commit
  -> compile the complete hierarchy and target ordinals
  -> assign target details to size-bounded shards
  -> validate the complete bundle
  -> upload detail shards, target index, and tier files
  -> upload index.json
  -> verify every uploaded object's bytes
  -> conditionally update calibration-trees/latest.json
```

The publisher verifies file paths, identities, ranges, direct detail locations,
posting lists, hierarchy reachability, SHA-256 digests, raw byte counts, and
gzip byte counts before it changes the manifest. An interrupted publication can
leave unreferenced immutable files. A retry reuses files whose bytes match.

## Browser loading flow

The browser uses the same-origin API and never receives a Blob credential or a
private Blob URL.

```text
GET /api/microcosm/tree?country=us&release=latest&part=index
  -> 307 to the same route with revision=<exact commit>
  -> stream calibration-trees/us/<commit>/index.json
  -> render the selected root
  -> start target-index.json and every tier-N.json request together
  -> resolve a selected target through its detailLocation
  -> fetch only that target's target-details-NNNN.json shard
```

The browser does not prefetch target-detail shards. Selecting another target in
the same shard uses the React Query cache. Selecting a target in another shard
downloads that shard. Query keys include country, exact commit, and part, so a
release switch cannot display data from another build.

A detail request has its own loading and error state. It does not replace the
map or release selector. Vercel applies HTTP transfer compression; Blob stores
ordinary JSON.

## Filtering indices

Hierarchy levels, groups, and nodes store sorted target ordinals. The target
index stores one posting for every geography level, geography, fit band, and
calibration status.

The browser unions selected values within one category, intersects results
across categories, writes the result to a `Uint8Array`, removes empty branches,
and recalculates visible metrics from compact per-target inputs. Complete target
records are not required for navigation, filtering, or aggregation.

## Private Blob authentication

### Vercel runtime reads

1. Connect a private Blob store to the Vercel project for Production and
   Preview.
2. Confirm the project has `BLOB_STORE_ID`.
3. Redeploy so server functions receive Vercel OIDC credentials.
4. Use `BLOB_READ_WRITE_TOKEN` only for local server-side development.
5. Confirm direct private Blob access fails while the dashboard API succeeds.

Never prefix Blob credentials with `NEXT_PUBLIC_`.

### GitHub Actions writes

1. Store the private Blob read-write token as `BLOB_READ_WRITE_TOKEN`.
2. Store a Hugging Face token as `HF_TOKEN` when a source repository is
   private.
3. Do not expose either value through inputs, repository variables, logs, or
   browser environment variables.

### Hugging Face webhook dispatch

1. Store the fine-grained GitHub token as
   `GITHUB_ACTIONS_DISPATCH_TOKEN` in Vercel.
2. Set `CALIBRATION_TREE_GITHUB_REPOSITORY` only when dispatching to a fork.
3. Set `HF_WEBHOOK_SECRET` in Vercel and use the same value in the Hugging Face
   webhook's `X-Webhook-Secret` header.
4. Set `CALIBRATION_TREE_BUILD_ENABLED=FALSE` in GitHub to disable publication.

Webhook publication builds only the affected release. It does not republish
historical releases.

## One-time pre-production replacement

Schema 3 does not include a compatibility reader or a committed cleanup tool.
Before publishing schema 3:

1. List every object under `calibration-trees/`.
2. Confirm the objects belong only to the pre-production dashboard.
3. Record the existing country, release, and commit inventory.
4. Obtain explicit approval for the exact deletion.
5. Delete the existing `calibration-trees/` objects with a one-off operation.
6. Confirm the prefix is empty.
7. Run one manual backfill for US, UK, and Belgium.
8. Confirm every previously published release is present and `latest.json`
   declares schema 3.

This deletion is not recoverable through the application. The dashboard cannot
load release trees between deletion and successful republication.

## One-time historical publication

```sh
cd frontend
bun run publish:calibration-tree -- --country us --backfill
bun run publish:calibration-tree -- --country uk --backfill
bun run publish:calibration-tree -- --country be --backfill
```

Backfill reads existing immutable Hugging Face release artifacts. It does not
rerun Microcosm calibration. The current release must publish successfully
before the workflow updates that country's manifest entry.

`CALIBRATION_TREE_MAX_RAW_BYTES` defaults to 100,000,000 bytes per file, in
addition to the fixed 4,000,000-byte target-detail limit.
`CALIBRATION_TREE_MAX_GZIP_BYTES` optionally adds a per-file compressed-size
check.

## Verification

Run locally:

```sh
cd frontend
bun test
bun run lint
bun run build
```

After publication, verify that:

1. The manifest and every part declare schema 3.
2. Every descriptor returns matching bytes and an ETag through the API.
3. The root renders before tier requests complete.
4. The browser starts all tier requests after the index arrives.
5. No detail shard downloads before target selection.
6. Selecting targets in the same shard does not repeat the application query.
7. A repeated exact-commit shard request reports a CDN cache hit or positive
   cache age after the first request.

References: [Vercel Blob authentication](https://vercel.com/docs/vercel-blob/using-blob-sdk#authentication),
[private Blob delivery](https://vercel.com/docs/vercel-blob/private-storage), and
[Vercel OIDC](https://vercel.com/docs/oidc).
