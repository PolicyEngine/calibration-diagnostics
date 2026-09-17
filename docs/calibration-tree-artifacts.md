# Calibration tree artifacts

The published calibration explorer reads a precomputed, breadth-first tree
bundle from private Vercel Blob storage. The browser does not download source
diagnostics or reconstruct the hierarchy. It fetches the root level first,
then receives deeper levels in increasing depth order.

## Required Blob folder schema

Each country and immutable Hugging Face commit has one directory:

```text
calibration-trees/
  latest.json
  <country>/
    <commit>/
      index.json
      tier-1.json
      tier-2.json
      ...
      tier-N.json
      target-index.json
      target-details.json
```

There is deliberately no schema-version directory in these paths. Every JSON
file declares `schemaVersion: 2`, and publication refuses to overwrite an
existing country/commit/path with different bytes.

- `index.json` contains release provenance, filter options, the program and
  geography roots, and content descriptors for every other required file.
- `tier-N.json` contains all hierarchy levels exactly `N` selections from
  either root. Tier numbers are contiguous from 1 through the declared maximum
  depth.
- `target-index.json` contains compact target labels, metric inputs, and
  filter posting lists.
- `target-details.json` contains complete target records for the detail panel.
- `latest.json` maps each country to the release, exact commit, index digest,
  index byte count, and update time currently selected by the dashboard.

## Publication flow

```text
Hugging Face repository update
  -> POST <basePath>/api/hf-webhook
  -> GitHub workflow_dispatch
  -> resolve the release to an exact Hugging Face commit
  -> fetch and hash source release files at that commit
  -> compile and partition the complete level graph
  -> validate the complete bundle
  -> upload target details, target index, and tier files
  -> upload index.json
  -> verify every uploaded object's bytes
  -> conditionally update calibration-trees/latest.json
```

The publisher validates the following before the mutable manifest changes:

- The generated file set exactly matches the required folder schema.
- Tier files are contiguous, and every non-root level occurs exactly once.
- Every branch advances from depth `N` to depth `N + 1`.
- Every level is reachable from a root, and the graph contains no cycles.
- Target ordinals are sorted, unique, in range, and consistent across parent
  nodes, children, groups, and levels.
- Posting lists exactly match the target facets they index.
- File paths, SHA-256 digests, raw byte counts, and gzip byte counts match the
  serialized files described by `index.json`.

An interrupted upload can leave unreferenced immutable part files. A repeat
publication reuses matching bytes and continues. The dashboard manifest does
not change unless all files have uploaded and passed read-back verification.

## Browser loading flow

The browser uses the same-origin API; it never receives a Blob credential or a
private Blob URL.

```text
GET /api/microcosm/tree?country=us&release=latest&part=index
  -> 307 to the same route with revision=<exact commit>
  -> stream calibration-trees/us/<commit>/index.json
  -> render the selected root
  -> fetch target-index.json and tier-1.json
  -> fetch tier-2.json after tier-1.json completes
  -> continue through tier-N.json
  -> fetch target-details.json after the tiers, or immediately when selected
```

The API accepts only `index`, `target-index`, `target-details`, or a positive
`tier-N` name. It does not translate arbitrary client paths into Blob paths.

Responses for an exact commit are cached by Vercel's CDN for one year and use
`immutable`. Release aliases and the dashboard manifest are cached for 60
seconds. Each query and browser cache entry includes country, exact commit, and
part, so switching between releases cannot display a part from another build.
Vercel applies transfer compression; browser `response.json()` performs the
corresponding decompression before parsing.

## Filtering indices

Every target receives a stable ordinal from `0` through `targetCount - 1`.
Levels, groups, and nodes store sorted arrays of these ordinals. The compact
target index also stores one posting list for every value of:

- Geography level
- Geography
- Fit band
- Calibration status

For example, a California posting might contain `[0, 2, 5]`. A New York
posting might contain `[1, 3]`.

The browser applies filters as follows:

1. Union selected values within a category. California plus New York produces
   `[0, 1, 2, 3, 5]`.
2. Intersect results across categories. Intersecting that geography result
   with fit-band posting `[0, 1, 5]` produces `[0, 1, 5]`.
3. Store the result in a `Uint8Array` membership map indexed by target ordinal.
4. Intersect each displayed level, group, and node's target ordinals with that
   membership map and omit empty branches.
5. Recalculate visible metrics from the compact per-target metric inputs.

The complete target records are not required for navigation, filtering, or
metric aggregation. Filters remain disabled until `target-index.json` is
available. `target-details.json` is needed only to display an individual
target's full detail panel.

## Private Blob authentication

### Vercel runtime reads

1. In the Vercel project, open **Storage**, create a Blob store, and select
   **Private** access.
2. Connect the store to the calibration dashboard project for Production and
   Preview.
3. Confirm the project has `BLOB_STORE_ID`. Do not create
   `VERCEL_OIDC_TOKEN`; Vercel supplies it to builds and server functions.
4. Redeploy. The API calls `get()` without an explicit token, so the Blob SDK
   uses Vercel OIDC. Local development can use `BLOB_READ_WRITE_TOKEN`.
5. Confirm a direct private Blob URL rejects an unauthenticated request while
   the dashboard's same-origin API succeeds.

Do not prefix Blob credentials with `NEXT_PUBLIC_`.

### GitHub Actions writes

1. Create or copy a read-write token from the private Blob store settings.
2. Add it as the repository Actions secret `BLOB_READ_WRITE_TOKEN`.
3. Add `HF_TOKEN` as an Actions secret when any source dataset is private.
4. Do not expose either value as a workflow input, repository variable, log
   message, or client environment variable.

The publisher passes the static Blob token explicitly because GitHub-hosted
workers do not receive Vercel OIDC credentials.

### Hugging Face webhook dispatch

1. Store a fine-grained GitHub token with Actions write permission as the
   server-only Vercel variable `GITHUB_ACTIONS_DISPATCH_TOKEN`.
2. If using a fork, set
   `CALIBRATION_TREE_GITHUB_REPOSITORY=<owner>/<repository>` in Vercel.
3. Set `HF_WEBHOOK_SECRET` in Vercel to a new random value.
4. Configure each dataset webhook to call the deployed
   `/calibration/dashboard/api/hf-webhook` route and send the value in
   `X-Webhook-Secret`.
5. Send a test event and confirm it starts the `Publish calibration tree`
   workflow for the affected country and commit.

The workflow builds only the affected release. It does not automatically
republish historical releases. Setting the repository variable
`CALIBRATION_TREE_BUILD_ENABLED=FALSE` disables both webhook-triggered and
manually dispatched publication runs.

## Delete the obsolete single-file objects

The cleanup command recognizes only `calibration-trees/v1/**` and
`calibration-trees/latest.v1.json`. Its default behavior is a dry run:

```sh
cd frontend
bun run cleanup:calibration-tree-v1
```

Review every listed path, then explicitly delete them:

```sh
bun run cleanup:calibration-tree-v1 -- --execute
```

This deletion is not recoverable through the application. Because the agreed
rollout deletes the old objects before publishing replacements, the published
dashboard will temporarily be unable to load calibration maps.

## One-time historical publication

After deleting the old objects, publish compatible historical releases once:

```sh
cd frontend
bun run publish:calibration-tree -- --country us --backfill
bun run publish:calibration-tree -- --country uk --backfill
bun run publish:calibration-tree -- --country be --backfill
```

The equivalent GitHub workflow input is `backfill: true`. Historical releases
normally resolve through an immutable Hugging Face tag. If a repository did not
create per-release tags, backfill reads the expanded release-directory metadata
and uses the newest commit that changed one of that release's source files. The
publisher then fetches and validates every required artifact at that immutable
commit; it never builds a historical bundle from a mutable branch name.
Releases with unsupported diagnostics, unavailable commit metadata, or an
oversized part are reported and skipped. The current release must build
successfully; otherwise the publication workflow fails without updating
`latest.json`.

`CALIBRATION_TREE_MAX_RAW_BYTES` defaults to 100,000,000 bytes and now applies
to each file independently. `CALIBRATION_TREE_MAX_GZIP_BYTES` is optional and
also applies per file. A failure identifies the exact offending Blob path and
measured size.

## Verification

Run locally:

```sh
cd frontend
bun test
bun run lint
bun run build
```

After publication, verify for every country:

1. `tree-manifest` returns schema version 2, an exact commit, and a valid index
   digest and byte count.
2. The release alias preserves `part=index` in its redirect.
3. Every descriptor in `index.json` has a corresponding successful API
   response with matching bytes and an ETag.
4. A repeated exact-commit request from the same Vercel region reports a CDN
   cache hit or a positive cache age.
5. The browser renders the root before later depth requests finish, requests
   tiers in increasing order, and never requests an old `v1` path.

References: [Vercel Blob authentication](https://vercel.com/docs/vercel-blob/using-blob-sdk#authentication),
[private Blob delivery](https://vercel.com/docs/vercel-blob/private-storage), and
[Vercel OIDC](https://vercel.com/docs/oidc).
