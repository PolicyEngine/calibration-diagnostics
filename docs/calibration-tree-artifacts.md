# Calibration build and comparison artifacts

The calibration explorer reads precomputed schema-6 JSON from private Vercel
Blob storage. The browser does not download calibration diagnostics or rebuild
the hierarchy. Schemas 1 through 5 are unsupported.

## Required Blob folder schema

```text
calibration-trees/
  manifest.json
  <country>/
    <build-artifact-id>/
      index.json.gz
      filter-index.json.gz
      target-summary-0001.json.gz
      target-summary-0002.json.gz
      ...
      target-details-0001.json.gz
      target-details-0002.json.gz
      ...
      tier-1.json.gz
      tier-2.json.gz
      ...
      tier-N.json.gz
```

`<build-artifact-id>` is a 64-character SHA-256 content identity. It is derived
from the schema version, country, build kind, source ID, and source artifact
digests. A Hugging Face commit remains provenance in `index.json.gz`; it is not the
Blob directory key.

Every decompressed JSON document declares `schemaVersion: 6`. Except for the
mutable `manifest.json`, Blob stores the canonical JSON as gzip bytes and the
path ends in `.json.gz`. Publication refuses to replace an existing part with
different decompressed JSON.

- `manifest.json` lists every published release build and finalized staging
  build, and points to the current release build for each country.
- `index.json.gz` contains build provenance, filter options, both root hierarchy
  levels, comparison metadata, and descriptors for all other parts.
- `tier-N.json.gz` contains every hierarchy level exactly `N` selections from a
  root. Tier numbers are contiguous.
- `filter-index.json.gz` contains only filter-value posting lists keyed by target
  ordinal.
- `target-summary-NNNN.json.gz` contains compact target identities, weighted-error
  inputs, comparison keys, and the hierarchy fields needed to compare builds.
- `target-details-NNNN.json.gz` contains complete target records for one
  contiguous ordinal range.

Comparison bundles use the same directory but deliberately omit
`target-details-NNNN.json.gz`. Their build IDs are derived from the ordered
source build IDs and comparison mode. They are not listed as selectable source
builds in `manifest.json`.

## Target ordinals and target shards

Every target receives a zero-based ordinal within one build. The ordinal is not
stable across builds. Numeric ordinals keep hierarchy membership and filter
postings smaller than repeated string IDs and allow the browser to represent
membership with a `Uint8Array`.

For release and staging builds, `index.json.gz` maps ordinal ranges to both
summary and detail files:

```json
{
  "part": "target-details-0003",
  "startTargetOrdinal": 8000,
  "endTargetOrdinalExclusive": 12000
}
```

To locate ordinal 8017, the reader selects the descriptor whose half-open range
contains 8017 and reads offset 17. Summary and detail descriptor ranges each
cover every target exactly once without gaps or overlaps. No per-target shard
pointer is stored.

The publisher preserves ordinal order and limits each summary file to 8,000,000
raw UTF-8 bytes and each detail file to 4,000,000 raw UTF-8 bytes. It measures
the complete canonical JSON file, including metadata and punctuation.
Publication fails when one target does not fit or when either file class would
require more than 9,999 shards.

## Comparison-ready target summaries

Each target-summary record publishes one compact comparison record containing:

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
API. The server reads `index.json.gz` and all `target-summary-NNNN.json.gz` files from
each source, calculates reported and shared-target rows, builds both hierarchy
bundles without comparison detail shards, validates them, and uploads them.
Later requests address those immutable bundle IDs directly. Filter postings
and full source detail shards are not inputs to this calculation.

Each comparison summary records the current-build and candidate-build target
ordinals. After a user selects one comparison target, the target-detail API
uses those ordinals to read the two source indexes and only the source detail
shard containing each target. It combines those source records with the compact
comparison row and returns one target. This response is immutable and can be
cached by the CDN using the comparison build ID and target ordinal. Added or
removed targets read only the source side that exists.

## Publication flows

### Release builds

```text
release repository update
  -> POST <basePath>/api/hf-webhook
  -> one GitHub workflow_dispatch per webhook delivery
  -> enumerate the union of release directories and immutable repository tags
  -> resolve every eligible release to an exact Hugging Face commit
  -> audit the existing Blob build for each release
  -> skip complete builds without downloading their diagnostics
  -> build and upload only missing builds or missing files
  -> update latestReleaseBuildArtifactId from upstream latest.json
```

A release directory or tag without calibration diagnostics is reported as
ineligible and is not treated as an error. The next repository webhook repeats
the inventory check, so it also finds a historical release missed by an older
webhook. There is no scheduled reconciliation.

### Finalized staging builds

```text
staging repository main-branch update
  -> POST <basePath>/api/hf-webhook
  -> GitHub workflow_dispatch with event_kind=staging
  -> scan the exact webhook commit for passed, published, and completed runs
  -> audit the existing Blob build for each finalized run
  -> skip complete builds before reading their diagnostics
  -> resolve either direct staging diagnostics or a staged-dataset receipt
  -> build and upload only missing builds or missing files
```

Active or failed staging runs remain on the live 30-second API path. Historical
staging runs with no calibration diagnostics are reported as ineligible. A
declared diagnostics file that is missing or has the wrong digest fails the
workflow.

US and UK staging use the same inventory, source-normalization, build,
validation, and Blob publication functions. Country registration supplies the
repository and credential name. UK staging reads use
`POPULACE_UK_STAGING_HF_TOKEN`; if a UK run points to a staged dataset in the UK
release repository, that second read uses `HF_TOKEN`.

For an existing manifest entry, the audit decompresses `index.json.gz`, checks
its raw byte count and SHA-256 digest against the manifest, parses its country
and build ID, and confirms that every file referenced by the index exists with
the recorded compressed byte count. A missing index or referenced file is
repairable. A changed index, malformed index, wrong identity, or compressed-size
mismatch fails without overwriting immutable data.

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
  -> stream index.json.gz with Content-Encoding: gzip
  -> render the root
  -> start filter-index, every target-summary shard, and every tier request concurrently
  -> fetch one target-details-NNNN part only after target selection
```

For an immutable comparison:

```text
GET /api/microcosm/comparison-tree
    ?country=us&a=<build-a>&b=<build-b>&mode=<reported|shared>&part=index
  -> build and persist both modes if absent
  -> 307 to build=<exact-comparison-build-id>
  -> use the same concurrent tier loading behavior
  -> fetch /comparison-tree/target-detail only after target selection
  -> read only the source detail shard(s) containing that target
```

Query keys include country, ordered source build IDs, comparison mode, exact
output build ID, and part. Switching builds therefore cannot display a cached
part from another build.

## Filtering indices

Hierarchy levels, groups, and nodes store sorted target ordinals.
`filter-index.json.gz` stores postings for geography level, geography, fit band,
comparison fit, and calibration status. Target-summary shards store the compact
metric inputs used to recalculate visible aggregates after filtering.

The browser unions selected values within one category, intersects categories,
filters hierarchy memberships, and recalculates visible metrics from compact
per-target inputs. Target detail shards are not required for navigation,
filtering, aggregation, or comparison construction.

## Authentication

The browser never receives a Blob or Hugging Face credential. A browser that
sends `Accept-Encoding: gzip` receives the stored compressed bytes through the
same-origin API with `Content-Encoding: gzip`; the browser decompresses them
before `Response.json()` parses the document. A client that does not accept
gzip receives server-decompressed JSON.

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
3. Store any country-specific staging credential under the registration's
   `token_env` name in both GitHub Actions and Vercel. The UK registration uses
   `POPULACE_UK_STAGING_HF_TOKEN`.
4. Store `GITHUB_ACTIONS_DISPATCH_TOKEN` and `HF_WEBHOOK_SECRET` only in Vercel.

### Hugging Face webhook

Use one Hugging Face webhook for every registered production dataset. The
webhook URL is the stable, public production domain:

```text
https://calibration-diagnostics.vercel.app/calibration/dashboard/api/hf-webhook
```

Do not use a generated deployment URL or
`calibration-diagnostics-policy-engine.vercel.app`. Those URLs can require
Vercel authentication and are not stable webhook targets. The production
domain moves to new code only after the staged deployment is qualified and
promoted as described in
[Hosted variable runtime](../frontend/HOSTED_RUNTIME.md#promotion-and-rollback).

Configure the webhook for repository events and watch these datasets:

```text
policyengine/populace-us
policyengine/populace-us-staging
policyengine/populace-uk-private
policyengine/populace-uk-staging
policyengine/populace-be-private
```

Update this watched list whenever a non-fixture release or staging repository
is added to the country registry.

The webhook secret must be the same high-entropy ASCII value stored as the
sensitive Vercel Production variable `HF_WEBHOOK_SECRET`. Hugging Face sends it
in `X-Webhook-Secret`; the browser and GitHub Actions do not receive it. When
rotating the value, keep the webhook disabled, update Vercel, deploy and promote
the application, then update the Hugging Face setting before re-enabling the
webhook.

After enabling the webhook, replay a release-repository `main` update from the
Hugging Face Activity page. Prefer a branch update rather than a release tag so
the verification does not repeat a Slack release alert. Require an HTTP 200
delivery. If the webhook has no prior delivery to replay, send an authenticated
release `main`-update payload containing the repository's current commit SHA.
Require one `Publish calibration tree` workflow dispatch for the expected
country and a successful workflow. Then send one authenticated staging
`main`-update payload and require a successful `event_kind=staging` workflow.
Both reconciliations are idempotent: complete Blob builds are audited and
skipped.

Failure meanings and recovery:

- `401` from the application means the Hugging Face and Vercel secrets differ.
- A Vercel authentication response means the webhook targets a protected URL
  instead of the public production domain.
- `502` from the application means GitHub rejected or did not receive the
  workflow dispatch; check `GITHUB_ACTIONS_DISPATCH_TOKEN` and its Actions
  permission.
- A failed GitHub workflow means publication started but did not complete.
  Rerun that workflow after correcting the reported error.
- Hugging Face retries non-2xx deliveries and can suspend a repeatedly failing
  webhook. Correct the failure, re-enable the webhook, and replay the delivery;
  see the [Hugging Face delivery and retry documentation](https://huggingface.co/docs/hub/webhooks#delivery-and-retries).

There is no scheduled reconciliation. A later webhook delivery inventories all
eligible versions and repairs a missed publication. Set the GitHub repository
variable `CALIBRATION_TREE_BUILD_ENABLED=FALSE` to leave the webhook active but
skip publication jobs intentionally.

## Historical reconciliation

Reconciliation reads existing immutable Hugging Face artifacts; it does not
rerun calibration. Use `--dry-run` to perform the inventory, audits, and any
required in-memory builds without writing Blob data:

```sh
cd frontend
bun run publish:calibration-tree -- --country us --reconcile-releases --dry-run
bun run publish:calibration-tree -- --country uk --reconcile-releases --dry-run
bun run publish:calibration-tree -- --country be --reconcile-releases --dry-run
bun run publish:calibration-tree -- --country us --reconcile-staging --dry-run
bun run publish:calibration-tree -- --country uk --reconcile-staging --dry-run
```

Remove `--dry-run` to publish. For staging, an automated invocation also passes
`--sha <webhook-commit>` so inventory and source files come from one immutable
repository state. The GitHub workflow exposes the same `dry_run` option for an
authenticated verification using Actions secrets.

Each outcome is `complete`, `published`, `repaired`, or `ineligible`.
`complete` means no bundle construction or source-diagnostics download occurred.
`repaired` means the publisher deterministically rebuilt an existing identity
and restored only missing files. Any reconstructed index must match the digest
already recorded in the manifest.

`CALIBRATION_TREE_MAX_RAW_BYTES` defaults to 100,000,000 bytes per file, in
addition to the fixed summary- and detail-shard limits.
`CALIBRATION_TREE_MAX_GZIP_BYTES` can add a compressed-size limit. Any violation
fails publication and therefore fails the GitHub Actions job.

## Verification

Run from `frontend/`:

```sh
bun test
bun run lint
bun run build
```

Then verify that:

1. The manifest and all parts declare schema 6.
2. Every descriptor returns matching decompressed JSON, gzip size, and an ETag.
3. Root rendering does not wait for deeper tiers.
4. Filter, target-summary, and tier requests start concurrently.
5. No detail shard downloads before target selection.
6. Comparison bundles contain no target-detail shards.
7. Selecting a comparison target reads only its source detail shard(s).
8. An uncached comparison persists both modes and a repeated request reuses
   them.
9. Repeated exact-part requests report CDN reuse or a positive cache age.

Do not use browser automation or screenshots for visual verification. Provide
the local preview URL and ask a person to inspect build selection and map
behavior.
