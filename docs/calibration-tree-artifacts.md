# Calibration build and comparison artifacts

The calibration explorer reads precomputed schema-6 JSON from private Vercel
Blob storage. The browser does not download calibration diagnostics or rebuild
the hierarchy. Schemas 1 through 5 are unsupported.

## Code

The builder, the schema-6 types, parsers and serializers, the Blob I/O, the
release and staging readers the builder reads from, and the publisher
(`src/publish-calibration-tree.ts`) are the npm package
`@policyengine/calibration-tree`. Its source is `packages/calibration-tree` in
[PolicyEngine/microcosm-collector](https://github.com/PolicyEngine/microcosm-collector),
which publishes a new version whenever a merged change raises the package's
version. The dashboard pins one published version in `frontend/package.json`,
imports it through its subpath exports, such as
`@policyengine/calibration-tree/calibration-tree-bundle`, and runs the
installed publisher, `node_modules/@policyengine/calibration-tree/src/publish-calibration-tree.ts`,
with `bun run publish:calibration-tree`. The package ships TypeScript source,
which Next.js compiles through `transpilePackages`. It imports only its own
modules, Node built-ins and `@vercel/blob`, and its boundary test enforces that.

The package's `src/fixtures/calibration-tree-golden.json` records the exact
bytes the builder writes for representative inputs: US, UK and Belgium
releases, US and UK staging runs, a US and a UK release-to-staging comparison,
and the manifest holding every recorded build. The golden tests require every
change to reproduce it. Regenerate it only for an intended output change, as
the package's `src/test-support/calibration-tree-golden-cases.ts` describes.

To change the builder, the readers or the publisher, change the package in the
collector and raise its version, then raise the pinned version here.

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
  -> read releases.json at the head of main; with it, enumerate the builds it
     lists; without it, the union of release directories and immutable
     repository tags
  -> resolve every eligible release to an exact Hugging Face commit
  -> audit the existing Blob build for each release
  -> skip complete builds without downloading their diagnostics
  -> build and upload only missing builds or missing files
  -> update latestReleaseBuildArtifactId from releases.json's current build
     of its default release, or, without releases.json, the upstream pointer
```

A release directory or tag without calibration diagnostics is reported as
ineligible and is not treated as an error. A tag named `latest` is never a
release and is left out of the report. The next repository webhook repeats
the inventory check, so it also finds a historical release missed by an older
webhook. There is no scheduled reconciliation.

A release whose build cannot be published or repaired, for example because the
schema 8 reader refuses its diagnostics, its tag moved to another commit, its
commit cannot be read from Hugging Face (its tag's commit, or for a release
folder without a tag, the newest commit behind the folder), or a repair's
rebuilt index differs from the recorded digest, is reported as
`failed` with the error. The remaining releases are still reconciled and the
latest-release selection is still updated, unless the release the upstream
pointer names is the one that failed; the workflow then fails. A failed release
gets no new manifest entry (an entry it already had is left unchanged), unless
the manifest write was stored and only its read-back check failed ("Calibration
tree manifest verification failed."). The latest-release selection is never
moved to a failed release.

#### Slack release alerts

The webhook posts release alerts to the country's Slack channel
(`SLACK_WEBHOOK_POPULACE_US` or `SLACK_WEBHOOK_POPULACE_UK`; a country without
one gets none). A Slack failure is logged and never fails the delivery.

- **New tags:** one "New Microcosm … release" message per new tag, as before,
  after the reconciliation is dispatched.
- **`releases.json`:** for an update to the `main` of a release repository
  whose country has a Slack channel, the webhook first reads `releases.json`
  at the commits before and after the update (only after, for a new `main`),
  with `HF_TOKEN`, or `HUGGINGFACE_TOKEN` when `HF_TOKEN` is unset. A country
  without a channel (Belgium today) reads none. Both the token and which
  countries have a channel are read when the server starts, so a change to
  `HF_TOKEN` or to a `SLACK_WEBHOOK_POPULACE_*` variable takes effect only
  with the next `Deploy production` run.
  After dispatching, it posts one message for each change:
  - a newly published build: "New Microcosm UK build `<release>/<build>`: now
    current", or "...: published, not current (current stays `<build>`)";
  - a change of current build: "Microcosm UK `<release>`: current build
    changed from `<old>` to `<new>`";
  - a withdrawal: "Microcosm UK build `<release>/<build>` withdrawn".

  Each message carries the repository and the dashboard link; new-build
  messages also carry the build's `published_at`. Values the dashboard does
  not check, such as `published_at` and tag names, are escaped for Slack's
  formatted text. The update that first creates `releases.json` gets one
  summary message ("Microcosm UK now records its releases in `releases.json`:
  N builds in M releases", with each release's current build, split to stay
  within Slack's block limits) instead of one per listed build. A repository
  without `releases.json` on both sides gets none of these.
- **When `releases.json` cannot be read:**
  - A transient failure (Hugging Face answers 5xx or 429, or the request or
    its body fails or times out) is logged and the delivery is answered 503
    before anything is dispatched or posted. Hugging Face retries the
    delivery, so the dispatch, the tag alerts and the record alerts each
    happen once, when a retry succeeds. A retry that comes late can post
    after newer messages, so its "current stays `<build>`" may already be
    out of date.
  - Any other failure, such as a token that cannot read the repository, a
    missing revision or a record the release writer's rules refuse, on
    either side, is logged and named in the answer as
    `release_record_problem`. The dispatch and the tag alerts go ahead, and
    no record alert is posted for that update.
  - One Hugging Face webhook serves all five watched datasets. If a long run
    of 503 answers makes Hugging Face suspend it, deliveries stop for every
    repository, release and staging alike. To recover, see "Hugging Face
    webhook" below.
- **Changes with no alert:** a deleted `releases.json` (its readers then read
  tags and pointer files), a change of default release and a build that is
  no longer withdrawn are logged as warnings, and nothing is posted.

#### Microcosm release lines

Microcosm publishes a release line (microcosm#823) under a constant release id:
its files stay in one folder, `releases/<release id>/`, and each cut is an
immutable tag named `<release id>-<YYYYMMDDTHHMMSSZ>-<attempt>`. The folder on
`main` is a mutable copy of whichever cut was published last; a line published
for inspection only, such as the UK dense local-area line, has no copy on
`main` at all.

- A cut tag is a release build of its own. Its manifest entry has the tag as
  `releaseId` (and source ID) and records the folder as `releaseDirectory`.
  Readers fetch `releases/<releaseDirectory>/` at the entry's commit. Entries
  without `releaseDirectory` read `releases/<releaseId>/` as before.
- A tag counts as a cut only when `releases/<release id>/release_manifest.json`
  at the tag names it as `build.cut_tag`. Any other cut-shaped tag is
  ineligible.
- A line folder on `main` is not published again once its cuts are. A build
  already published from the folder stays pinned at its own commit. Nor is the
  folder published while the commit of a tag named
  `<release id>-<YYYYMMDDTHHMMSSZ>-<attempt>` for it cannot be read. If the
  folder has no build yet, it is then reported as `ineligible`, with a reason
  naming that tag; the next run looks the tag up again.
- A country registration may name a per-line pointer (`pointer_path`, for the
  UK `latest-national.json`). Its `revision` names the current cut, which
  becomes the country's latest release. Other countries keep `latest.json`.
- The release picker adds every published cut beside the folders on `main` and
  hides a line folder unless the dashboard's latest release still points at it.

These readers apply to a dataset repository with no `releases.json` (next
section). The UK repository stays this way until Microcosm's switch commit
writes `releases.json` and deletes its pointer files; the dashboard then reads
it from `releases.json` with no change of its own.

#### Build folders and `releases.json`

A dataset repository with a root `releases.json` publishes every build in its
own folder, never changed after publishing, and that record names every build
and each release's current build:

```text
releases.json
releases/<release>/<build>/release_manifest.json
releases/<release>/<build>/calibration_diagnostics.json
releases/<release>/<build>/...
```

`releases.json` follows microcosm-emitter's
`microcosm_emitter_interface.releases` (microcosm-emitter#24), whose release
writer is the only program that changes it. `release-record.ts` reads it with
the same rules: at most 4 MiB, exact keys, `schema_version` 1, safe release
and build names, each `current` listed and not withdrawn, and `default`
listed. (JavaScript reads a `schema_version` of `1.0` as 1, which the writer
refuses; the writer itself writes `1`.) For such a repository the dashboard
reads `releases.json` and nothing else: no tags, no `latest*.json` pointer
files and no listing of `releases/`.

Every reader finds the layout the same way, whatever the country: it asks
Hugging Face for `releases.json` (the tree publisher at the commit it
publishes, the release picker and the Staging page at the configured
revision). No country registration names the layout.

- Only Hugging Face's 404 for the file means the repository has no
  `releases.json`, and then the tags and pointer files are read. A 404 whose
  error code (`X-Error-Code`) is `RepoNotFound` or `RevisionNotFound`, any
  other failure, and a record the writer's rules refuse are errors: the
  release picker answers 502 for that country, reconciliation publishes
  nothing and leaves the latest release as it was, and a local-area Staging
  candidate has no comparison baseline. No reader falls back to tags or
  pointer files.

- A build's release id is its folder, `<release>/<build>`. Its manifest entry
  records no separate `releaseDirectory`, and readers fetch
  `releases/<release>/<build>/` at the entry's commit.
- Reconciliation reads `releases.json` at the head of `main` and publishes
  every listed build whose folder holds `calibration_diagnostics.json` and
  whose `release_manifest.json` names the same `release` and `build` in its
  top-level fields. The build is pinned to the newest commit behind its
  folder's files (the commit that wrote the folder) and dated by its
  `published_at`, so a build copied into its folder later keeps its
  original date. A build whose folder or release manifest cannot be read is
  reported as `failed`, and the other builds are still reconciled.
  A build the manifest already holds is not looked up again.
- The latest release is the current build of the record's default release.
  While the record names none, or that build cannot be published,
  reconciliation publishes the other listed builds and fails without moving
  the latest release, naming the reason.
- `--latest` and `--release <release>/<build>` publish one listed build. The
  promotion check that follows compares the build with the record's current
  build by name, and reads that build's folder only when they match; if the
  folder cannot be read then, the build stays published and the next
  reconciliation moves the latest release.
- Entries published from tags or release folders stay in the manifest and
  stay readable by their ids; reconciliation no longer repairs them, and the
  picker no longer lists them. The one exception is the dashboard's latest
  release: until reconciliation makes the record's current build the latest
  release, the latest release is still such an entry, and the picker keeps
  it listed as the default dataset. The deployment's pre-promotion check
  requires the latest release to be listed.
- The release picker lists every build `releases.json` names, dated by
  `published_at`, with its release's role (the default release is the
  default dataset; Microcosm's roles are `national` and `local_area`) and its
  `withdrawn` flag. A build is selectable for comparison once its tree is
  published. A withdrawn build stays listed and selectable, labelled
  "Withdrawn".
- The Staging page compares a local-area candidate with the newest published
  build of a `local_area` release that is not withdrawn.
- Every release id the dashboard accepts may be a build folder,
  `<release>/<build>`, including the Staging target-change view's; the
  "View on Hugging Face" link opens the folder at the build's pinned commit,
  since a build folder has no tag.
- The timestamp migration leaves build-folder entries alone.

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
staging runs with no calibration diagnostics are reported as ineligible. A run
whose build cannot be published or repaired, for example because a declared
diagnostics file is missing or has the wrong digest, is reported as `failed`
with the error. The remaining runs are still reconciled, and the workflow then
fails.

A staged dataset's diagnostics are the `calibration_diagnostics.json` its
receipt records or, failing that, the one `<dataset>.diagnostics.json` it
records: Microcosm's UK local lane stages its outputs under the dataset's own
stem. A receipt recording several stem files has no target view.

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

Geography values are the labels `buildCalibration` produces, so a label that
more than one geography level uses in a build carries its level, such as
"Ashfield (constituency)" and "Ashfield (local authority)" (see
[Geography labels shared by several levels](calibration-map-hierarchy.md#geography-labels-shared-by-several-levels)).
A tree keeps the labels it was published with. Its build ID derives from its
inputs, not from the builder's code, so a tree published before that rule keeps
one merged label for both areas, and a repair of it is refused because the
rebuilt index differs from the recorded digest. For a staging build, the refusal
is reported as that run's `failed` outcome.

Geography nodes group rows by geography ID, and a geography that rows spell
more than one way is listed once (see
[Geographies spelled more than one way](calibration-map-hierarchy.md#geographies-spelled-more-than-one-way)).
Geography postings and the index's geography filter options use the node
labels: one posting per geography node, holding every target of that node, so
the Geography filter offers one option per geography and selects all of its
targets. Bundle validation compares each geography posting with the geography
root node of the same label. It cannot recompute them from the target
summaries alone, whose compact rows carry each row's own spelling and no
geography ID. Because the nodes and the postings come from the same labels,
validation also checks the postings against the target rows: they must be the
postings that `geographyLabeller` gives the target detail rows, which carry
the geography IDs, or the postings by each row's own spelling, as trees built
before geographies were grouped by ID have them. A comparison tree has no
detail rows and its compact rows carry no geography ID, so both rules give
each row's own spelling there. For rows that spell every geography one way,
labels, postings and files are unchanged.

A tree published before geographies were grouped by ID has one node and one
posting per spelling. Its nodes and postings agree with each other and with
each row's own spelling, so it still validates, and reconciliation finds it
complete and leaves its files as they are. Rebuilding
one whose rows spell a geography ID two ways would give a different index and
filter index, so a repair of it is refused, like the trees above.

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

To correct legacy release timestamps after PR #200, dispatch **Publish
calibration tree** with country `uk`, event kind `migrate-timestamps`, and
`dry_run: true`. Review the planned changes, then repeat with `dry_run: false`.
The migration uses each manifest entry's recorded repository and immutable
commit, and preserves build identity and the current latest-release selection.
Use event kind `manual` separately to reconcile releases and align the
dashboard's latest selection with the upstream pointer. Both operations use
the existing Actions credentials and require no local secret download.

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
Hugging Face Activity page. Prefer a branch update that did not change
`releases.json`, rather than a release tag or an update that published,
promoted or withdrew a build, so the verification does not repeat a Slack
release alert. Require an HTTP 200
delivery whose answer has no `release_record_problem`: for a US or UK release
repository, that shows the token can read its `releases.json` (a 404 for a
repository without one counts as readable). If the webhook has no prior
delivery to replay, send an authenticated
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
- `503` from the application means a release repository's `releases.json`
  could not be read for a reason that may pass (a Hugging Face 5xx or 429, or
  a failed or timed-out request or body). Nothing was dispatched or posted,
  and Hugging Face retries the delivery. Hugging Face documents no limit on
  those retries and no guarantee that the Activity page shows an event's
  last answer, so follow these steps whenever deliveries were answered 503,
  whether or not the webhook was suspended. The function logs are the
  record of each delivery's answer: each 503 logs "could not be read;
  answering 503", and each delivery answered 200 logs nothing of the kind.
  1. If the webhook is suspended, re-enable it.
  2. For each repository, find the deliveries whose latest answer was 503
     and that were never later answered 200. Replay every one of them,
     oldest first, from the Activity page. Each covers its own pair of
     commits, so replaying only the latest would lose the earlier updates'
     alerts. Don't replay a delivery once it has been answered 200: its
     alerts were posted.
  3. The repository's last delivered commit is now the `newSha` of its
     latest delivery answered 200, counting step 2's replays. For updates
     made after that commit (while the webhook was suspended, so never
     delivered), send one authenticated release payload per affected
     repository. Its `main` entry has that commit as `oldSha` and the
     repository's current head as `newSha`; it announces their net change
     once and dispatches one reconciliation. Add one `refs/tags/<tag>` entry,
     with `oldSha` null and the tag's commit as `newSha`, for each tag created
     in that time, or those tags get no tag alert. Send one staging
     `main`-update payload per staging repository to redo the staging
     dispatch.
- An answer with `release_record_problem` means `releases.json` could not be
  read for a lasting reason, such as a token without access or a record the
  release writer's rules refuse. The dispatch and the tag alerts went ahead,
  but no record alert was posted. Once the cause is corrected, replay that
  delivery to post its record alerts. A replay also repeats any tag alert the
  delivery carried, and runs the reconciliation again, which is idempotent.
- A failed release workflow either stopped before reconciling any release (for
  example, the manifest, the release listing or the repository's tags could
  not be read, or one tag's folder or one folder's commit could not be
  resolved), or printed a report in which at least one release is `failed`
  or `latestReleaseFailure` says why the latest-release selection was not
  updated. In the second case every release with another outcome was
  reconciled, and the error names the failed releases. Every later release
  workflow for that country retries them and fails again until their errors
  are corrected. Rerunning does not correct a refused repair of a published
  tree ("Rebuilt calibration index differs from immutable manifest entry") or
  a release whose tag moved ("Released dataset … changed from … to …").
- A failed staging workflow either stopped before reconciling any run (for
  example, the staging repository was unavailable or listed incompatible
  runs), or printed a report in which at least one run is `failed`. In the
  second case every run with another outcome was reconciled, and the error
  names the failed runs. Every later staging workflow for that country retries
  them and fails again until their errors are corrected. Rerunning does not
  correct a refused repair of a published tree ("Rebuilt staging index differs
  from immutable manifest entry"): the same rebuild differs from the recorded
  digest again, so that run keeps failing until the tree's missing files are
  restored.
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

Each outcome is `complete`, `published`, `repaired`, `ineligible`, or
`failed`.
`complete` means no bundle construction or source-diagnostics download occurred.
`repaired` means the publisher deterministically rebuilt an existing identity
and restored only missing files. Any reconstructed index must match the digest
already recorded in the manifest.

Release and staging reconciliation both record a source they cannot publish or
repair as `failed`, with the error as its `reason`, and continue with the
remaining sources; after printing the report the command exits with an error
naming every failed source. One release or run that cannot be published
therefore no longer leaves the sources after it unpublished on every later
invocation. Errors before the per-source loop still stop reconciliation before
any source and print no report: reading the manifest, listing releases, tags or
staging runs, the first Blob listing, and, for releases, the Hugging Face
lookups that build the release list (the folder probe and
`release_manifest.json` of each tag the manifest does not already pin at its
commit).
An error in one of those lookups therefore stops every release, as one failed
release did before.

For a release, the steps that write run in this order: upload the bundle's
files (the index last), list the stored files and audit the build against its
own index, then add the manifest entry. An error at any step before the
manifest write leaves a new release without a manifest entry, and leaves a
release that already had an entry with that entry unchanged. Files a new
release uploaded before the error stay under the build's ID, which is a digest
of the country, the release ID and the source files' digests; no manifest entry
refers to them, and the next reconciliation rebuilds the same ID and checks
each existing file byte for byte before reusing it. Each manifest write reads
the stored manifest, adds one entry, and writes it back on the condition that
the stored manifest has not changed since that read (after a conflict it reads
once more and writes without the condition). A failed release makes no
manifest write, so the writes for the releases after it are the same as
without it.

After the releases, release reconciliation points `latestReleaseBuildArtifactId`
at the release the upstream pointer names. It leaves the selection unchanged,
and records why in the report's `latestReleaseFailure`, when that release
failed in the same run, is not completely published, or the pointer cannot be
read; the command then exits with an error. A dry run reads the pointer and
reports the same `latestReleaseFailure` when the pointer cannot be read or names
a release that failed in the same run; it does not check whether the named
release is completely published, because it writes no manifest entries.

`CALIBRATION_TREE_MAX_RAW_BYTES` defaults to 100,000,000 bytes per file, in
addition to the fixed summary- and detail-shard limits.
`CALIBRATION_TREE_MAX_GZIP_BYTES` can add a compressed-size limit. Any violation
fails publication and therefore fails the GitHub Actions job.

## Verification

Run from `frontend/`; `bun run lint` typechecks the dashboard, including the
package modules it imports:

```sh
bun test
bun run lint
bun run build
```

The package's own tests and typecheck run in the collector, from
`packages/calibration-tree/` (`bun test`, `bun run typecheck`).

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
