# Calibration tree publication checklist

## Before building

- [ ] Country, source kind, and source ID are explicit.
- [ ] Hugging Face revision resolves to an exact commit.
- [ ] Required private-repository access works without exposing `HF_TOKEN`.
- [ ] Source files and digests come from the same commit.

## Bundle validation

- [ ] Manifest, index, tiers, filter index, summary shards, and detail shards use schema 6.
- [ ] The 64-character build artifact ID matches the deterministic source identity.
- [ ] Target ordinals are complete, sorted, unique, and in range.
- [ ] Summary ranges are contiguous and cover every target exactly once.
- [ ] Source-build detail ranges are contiguous and cover every target exactly once.
- [ ] Comparison builds have no detail shards, and each summary identifies its source ordinal(s).
- [ ] Every summary shard is at most 8,000,000 raw UTF-8 bytes.
- [ ] Every detail shard is at most 4,000,000 raw UTF-8 bytes.
- [ ] Part names end in `.json.gz`; decompressed hashes, raw sizes, and gzip sizes match.
- [ ] Hierarchy levels and filter postings reference valid ordinals.
- [ ] Compact comparison records contain matching keys, hierarchy fields, and attribution inputs.
- [ ] Tests, type checking, and the production build pass.

## Publication

- [ ] `BLOB_READ_WRITE_TOKEN` is available only to GitHub publication and the server-side comparison route.
- [ ] Filter postings, summary shards, source detail shards, and tiers upload before `index.json.gz`.
- [ ] Every upload passes gzip decompression and read-back verification.
- [ ] The current upstream release still matches before manifest promotion.
- [ ] Finalized staging publication includes only successful final statuses.
- [ ] No historical backfill runs without an explicit request.

## Deletion

- [ ] The exact Blob paths have been listed and reviewed.
- [ ] The objects are confirmed to be pre-production.
- [ ] The user has authorized the exact destructive operation.
- [ ] No path outside `calibration-trees/` can be selected.
- [ ] The prior release inventory has been recorded.

## Deployed verification

- [ ] The root renders from `index.json.gz`.
- [ ] The filter index, every summary shard, and every tier request start together.
- [ ] No detail shard loads before target selection.
- [ ] Selecting a target downloads only the detail shard whose ordinal range contains it.
- [ ] Selecting a comparison target reads only the containing source detail shard on each existing side.
- [ ] Same-shard selections reuse cached data.
- [ ] Detail errors do not remove the map or release selector.
- [ ] Build switching cannot display another build's data.
- [ ] An uncached ordered pair persists both reported and shared comparison bundles without comparison detail shards.
- [ ] Comparison construction reads source indexes and summary shards, not filter or detail shards.
- [ ] Gzip-capable requests receive `Content-Encoding: gzip` and valid compressed bytes.
- [ ] Repeated exact-shard requests show CDN reuse.
