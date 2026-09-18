# Publish calibration tree artifacts

Use this workflow when changing, publishing, or diagnosing the dashboard's
precomputed calibration-tree files. Read
[`docs/calibration-tree-artifacts.md`](../../calibration-tree-artifacts.md)
before modifying code or external storage.

## Establish scope and authorization

1. Confirm the requested country, source kind, source ID, and exact Hugging Face commit.
2. Distinguish tree schema 5 from unrelated Microcosm artifact schemas.
3. Treat Blob deletion, manifest updates, workflow dispatch, and publication as
   external state changes. Obtain explicit user authorization when the request
   does not already cover them.
4. Never print Blob, Hugging Face, GitHub, or webhook secret values.

## Inspect the source and current publication

1. Resolve the release or finalized staging run to an immutable Hugging Face commit.
2. Verify that the source directory contains calibration diagnostics and any
   referenced manifests.
3. Read `calibration-trees/manifest.json` and the selected `index.json` when they
   exist.
4. Confirm that the country, source ID, build artifact ID, commit, source digests, and schema version
   agree before drawing conclusions.

## Build and validate

1. Run the publisher for an exact release or use its test helpers without
   changing Blob storage.
2. Confirm target ordinals cover `0` through `targetCount - 1`.
3. Confirm summary and detail descriptors each cover all target ordinals with
   contiguous, non-overlapping ranges.
4. Confirm summary files remain at or below 8,000,000 raw UTF-8 bytes and
   detail files remain at or below 4,000,000 raw UTF-8 bytes.
5. Confirm every file's path, hash, raw size, and gzip size matches `index.json`.
6. Confirm each target-summary record contains the three comparison keys,
   hierarchy metadata, and weighted-error inputs.
7. Run `bun test`, `bun run lint`, and `bun run build` from `frontend/`.

Do not change the shard size through an environment variable. A different size
would assign different immutable paths to the same release.

## Publish

1. Confirm `BLOB_READ_WRITE_TOKEN` and any required `HF_TOKEN` are available
   without displaying them.
   For a country whose staging registration declares `token_env`, confirm that
   country-specific secret is also present in GitHub Actions.
2. Publish non-index files first, then `index.json`.
3. Verify uploaded bytes through a consistent Blob read.
4. Add every immutable source build to `manifest.json`; change
   `latestReleaseBuildArtifactId` only when upstream `latest.json` still names
   the same release and commit.
5. For staging publication, include only `passed`, `published`, or `completed`
   runs and verify the staging branch remains at the webhook commit.
6. Report the source ID, build artifact ID, commit, part count, and measured sizes without reporting
   credentials.

Release webhooks publish the affected release. Staging webhooks scan finalized
successful runs. Run historical release backfill only when the user explicitly
requests it.

## Replace pre-production artifacts

Schema 5 has no compatibility reader for schemas 1 through 4. If replacement
requires deletion:

1. List every object under the exact `calibration-trees/` prefix.
2. Stop if any path is outside the documented folder structure or may serve a
   production consumer.
3. Present the exact scope and obtain approval before deletion.
4. Delete with a one-off operation outside the repository.
5. Confirm the prefix is empty, then publish US, UK, and Belgium.
6. Compare the resulting release inventory with the inventory recorded before
   deletion.

Do not add a legacy parser or cleanup utility to the repository to perform this
one-time replacement.

## Verify the deployed reader

1. Confirm the release alias redirects to an exact build artifact ID.
2. Confirm `index.json` renders the root before later requests finish.
3. Confirm `filter-index.json`, all target-summary files, and all tier files
   start concurrently.
4. Confirm no target-detail shard loads before target selection.
5. Select targets in the first, middle, and last shards.
6. Confirm a target-detail failure remains confined to its detail panel.
7. Switch between builds and confirm country, build ID, comparison mode, and part query keys
   prevent stale display.
8. Request an uncached comparison and confirm both modes persist after reading
   only each source's index and target-summary files.
9. Request one exact shard twice and inspect Vercel cache headers.

Do not use browser automation or screenshots for visual verification. Provide
the preview URL and ask the user to inspect the rendered behavior.
