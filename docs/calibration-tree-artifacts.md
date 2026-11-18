# Calibration build and comparison artifacts

The calibration explorer reads precomputed schema-6 JSON from private Vercel
Blob storage. The browser does not download calibration diagnostics or rebuild
the hierarchy. Schemas 1 through 5 are unsupported.

## Code

The builder, the schema-6 types, parsers and serializers, the Blob I/O and the
release and staging readers are the npm package
`@policyengine/calibration-tree`. Its source is `packages/calibration-tree` in
[PolicyEngine/microcosm-collector](https://github.com/PolicyEngine/microcosm-collector),
which publishes a new version whenever a merged change raises the package's
version. The dashboard pins one published version in `frontend/package.json` and
imports it through its subpath exports, such as
`@policyengine/calibration-tree/calibration-tree-bundle`. The package ships
TypeScript source, which Next.js compiles through `transpilePackages`. It imports
only its own modules, Node built-ins and `@vercel/blob`, and its boundary test
enforces that.

The package's `src/fixtures/calibration-tree-golden.json` records the exact
bytes the builder writes for representative inputs: US, UK and Belgium
releases, US and UK staging runs, a US and a UK release-to-staging comparison,
and the manifest holding every recorded build. The golden tests require every
change to reproduce it. Regenerate it only for an intended output change, as
the package's `src/test-support/calibration-tree-golden-cases.ts` describes.

To change the builder or the readers, change the package in the
collector and raise its version, then raise the pinned version here. The
dashboard's `bun run lint` typechecks the package modules it imports with the
dashboard's own `tsconfig.json` (`target` ES2017), which can refuse syntax the
collector's typecheck (`target` ES2022) accepts, such as regular-expression
features from ES2018 or later, so run it on the raised version before merging.

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

The builder preserves ordinal order and limits each summary file to 8,000,000
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

The telemetry collector ([PolicyEngine/microcosm-collector](https://github.com/PolicyEngine/microcosm-collector))
builds the calibration trees and writes their files and `manifest.json` to the
Blob store the dashboard reads. The dashboard writes only the comparison bundles
its own API creates. Two things start a build:

- **A build submission.** A submission builds the tree of one
  `releases/<release>/<build>` or `staged/<run_id>` folder.
- **The Hugging Face webhook.** A delivery from a registered repository asks the
  collector to queue one run for that country and kind. The run reads the
  repository at its head and builds what the collector's store lacks.

The webhook's request is the only automatic trigger for what no submission
builds: staging runs whose diagnostics are only in a staging repository's
`runs/<id>/`, and release builds whose submission was never made, failed or was
rejected. Each release run also ends by pointing the country's latest release at
the current build of `releases.json`'s default release. There is no scheduled
run, so a build that a lost request would have covered waits for the next
delivery for that country and kind, or for someone to run the collector's
`reconcile-calibration-trees` command by hand. A release repository without
`releases.json` gets no new tree from a run, which reports `no_releases_record`.

A run treats a build its store holds as finished. It does not check that the
stored tree's files are all present and does not restore missing ones, and
nothing else does so automatically.

The collector's README describes both paths, in "Building trees from
submissions" and "Queuing calibration tree builds".

`.github/workflows/publish-calibration-tree.yml` and the
`publish:calibration-tree` script remain only for deployments from before the
webhook stopped dispatching that workflow: such a deployment, whether it is being
replaced or was restored by a rollback, answers Hugging Face with an error if the
workflow is missing. Current code does not start it, and its job does nothing
while the GitHub repository variable `CALIBRATION_TREE_BUILD_ENABLED` is `FALSE`.
Both are removed once no deployment production could return to dispatches it.

### Release builds

```text
release repository update
  -> POST <basePath>/api/hf-webhook
  -> one POST /v1/calibration-tree-builds to the telemetry collector, kind
     release (see "Calibration-tree builds in the collector" below)
  -> one collector run, when the request's 10-minute window ends
  -> read releases.json at the head of main and list the builds it names
  -> skip builds the store holds and builds a submission is processing
  -> build and store the others, the current default build first
  -> point the country's latest release at releases.json's current build
```

#### Slack release alerts

The webhook posts release alerts to the country's Slack channel: the webhook in
`SLACK_WEBHOOK_MICROCOSM_US` or `SLACK_WEBHOOK_MICROCOSM_UK` or, when the
environment lacks that name, in the former `SLACK_WEBHOOK_POPULACE_US` or
`SLACK_WEBHOOK_POPULACE_UK`, which the Vercel project's Production environment
held on 2026-10-26 (`frontend/HOSTED_RUNTIME.md`). <!-- compat: populace alias, remove after 0.2.0 -->
A country with neither gets none. A Slack failure is logged and never fails the
delivery.

- **New tags:** one "New Microcosm … release" message per new tag, as before,
  after the collector request.
- **`releases.json`:** for an update to the `main` of a release repository
  whose country has a Slack channel, the webhook first reads `releases.json`
  at the commits before and after the update (only after, for a new `main`),
  with `HF_TOKEN`, or `HUGGINGFACE_TOKEN` when `HF_TOKEN` is unset. A country
  without a channel (Belgium today) reads none. Both the token and which
  countries have a channel are read when the server starts, so a change to
  `HF_TOKEN` or to either Slack webhook variable takes effect only with the
  next `Deploy production` run.
  After the collector request, it posts one message for each change:
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
    before the collector request and before anything is posted. Hugging Face
    retries the delivery, so the collector request, the tag alerts and the
    record alerts each happen once, when a retry succeeds. A retry that comes
    late can post after newer messages, so its "current stays `<build>`" may
    already be out of date.
  - Any other failure, such as a token that cannot read the repository, a
    missing revision or a record the release writer's rules refuse, on
    either side, is logged and named in the answer as
    `release_record_problem`. The collector request and the tag alerts go
    ahead, and no record alert is posted for that update.
- **When the collector request fails in a way that may pass,** the delivery is
  also answered 503 before anything is posted, with the same effect (see
  "Calibration-tree builds in the collector" below). A lasting failure does not
  stop the alerts.
- One Hugging Face webhook serves all five watched datasets. If a long run of
  503 answers makes Hugging Face suspend it, deliveries stop for every
  repository, release and staging alike. To recover, see "Hugging Face webhook"
  below.
- **Changes with no alert:** a deleted `releases.json` (the release picker then
  lists the repository's folders), a change of default release and a build that is
  no longer withdrawn are logged as warnings, and nothing is posted.

#### Microcosm release lines

Microcosm publishes a release line (microcosm#823) under a constant release id:
its files stay in one folder, `releases/<release id>/`, and each cut is an
immutable tag named `<release id>-<YYYYMMDDTHHMMSSZ>-<attempt>`. The folder on
`main` is a mutable copy of whichever cut was published last; a line published
for inspection only, such as the UK dense local-area line, has no copy on
`main` at all. The collector builds no tree from this layout. The rules below
are how the dashboard reads the manifest entries already published from it.

- A cut tag is a release build of its own. Its manifest entry has the tag as
  `releaseId` (and source ID) and records the folder as `releaseDirectory`.
  Readers fetch `releases/<releaseDirectory>/` at the entry's commit. Entries
  without `releaseDirectory` read `releases/<releaseId>/` as before.
- The release picker adds every published cut beside the folders on `main` and
  hides a line folder unless the dashboard's latest release still points at it.

These rules apply to entries from a dataset repository with no `releases.json`
(next section).

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
Hugging Face for `releases.json` (the collector's run at the repository's head,
the release picker and the Staging page at the configured
revision). No country registration names the layout.

- Only Hugging Face's 404 for the file means the repository has no
  `releases.json`. The release picker then lists the repository's folders under
  `releases/` on `main` beside the builds the manifest records, and a collector
  run reports `no_releases_record`. A 404 whose
  error code (`X-Error-Code`) is `RepoNotFound` or `RevisionNotFound`, any
  other failure, and a record the writer's rules refuse are errors: the
  release picker answers 502 for that country, the collector's run stores
  nothing for that repository and leaves the latest release as it was, and a
  local-area Staging candidate has no comparison baseline. No reader falls back
  to the folder listing.

- A build's release id is its folder, `<release>/<build>`. Its manifest entry
  records no separate `releaseDirectory`, and readers fetch
  `releases/<release>/<build>/` at the entry's commit.
- The collector's run reads `releases.json` at the head of `main` and builds
  every listed build the store lacks, whose folder holds
  `calibration_diagnostics.json` and whose `release_manifest.json` names the
  same `release` and `build`. The build is pinned to the newest commit behind
  its folder's files and dated by its `published_at`, so a build copied into
  its folder later keeps its original date.
- The latest release is the current build of the record's default release.
  While the record names none, or the store has no tree for that build, the
  latest release stays as it was.
- Entries published from tags or release folders stay in the manifest and
  stay readable by their ids. The collector does not rebuild them, and the
  picker no longer lists them. The one exception is the dashboard's latest
  release: until the collector makes the record's current build the latest
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

### Finalized staging builds

```text
staging repository main-branch update
  -> POST <basePath>/api/hf-webhook
  -> one POST /v1/calibration-tree-builds to the telemetry collector, kind
     staging (see "Calibration-tree builds in the collector" below)
  -> one collector run, when the request's 10-minute window ends
  -> list the runs in the staging repository's runs/<id>/ folders at its head
  -> skip runs the store holds and runs a submission is processing
  -> build and store the passed, published and completed runs, newest first
```

Active or failed staging runs remain on the live 30-second API path.

A staged dataset's diagnostics are the `calibration_diagnostics.json` its
receipt records or, failing that, the one `<dataset>.diagnostics.json` it
records: Microcosm's UK local lane stages its outputs under the dataset's own
stem. A receipt recording several stem files has no target view.

The dashboard's own staging reads take the repository and credential name from
the country's registration. UK staging reads use
`POPULACE_UK_STAGING_HF_TOKEN`; if a UK run points to a staged dataset in the UK
release repository, that second read uses `HF_TOKEN`.

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
one merged label for both areas.

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
each row's own spelling, so it still validates. The collector does not rebuild
a tree its store already holds.

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
in `X-Webhook-Secret`; the browser does not receive it. When
rotating the value, keep the webhook disabled, update Vercel, deploy and promote
the application, then update the Hugging Face setting before re-enabling the
webhook.

After enabling the webhook, replay a release-repository `main` update from the
Hugging Face Activity page. Prefer a branch update that did not change
`releases.json`, rather than a release tag or an update that published,
promoted or withdrew a build, so the verification does not repeat a Slack
release alert. Require an HTTP 200 delivery whose answer has no
`release_record_problem`: for a US or UK release repository, that shows the
token can read its `releases.json` (a 404 for a repository without one counts as
readable). Also require its `tree_build.status` to be `queued` or
`already_queued`. If the webhook has no prior delivery to replay, send an
authenticated release `main`-update payload containing the repository's current
commit SHA. Then send one authenticated staging `main`-update payload and require
the same `tree_build` statuses. Both requests are safe to repeat: a run builds
only what the collector's store lacks.

Failure meanings and recovery:

- `401` from the application means the Hugging Face and Vercel secrets differ.
- A Vercel authentication response means the webhook targets a protected URL
  instead of the public production domain.
- A `tree_build` with `status: "failed"` in a 200 answer (see "Calibration-tree
  builds in the collector" below) means the collector did not queue the build,
  for a reason a retry cannot change, and the delivery's Slack alerts were
  posted. The function log names the cause. A 401 or 403 from the collector means
  it refused the deployment's Vercel OIDC token or does not list the deployment
  as a tree-build caller; a 404 means its tree-build endpoint is not enabled; a
  422 `repo_not_registered` means the dashboard's configured repository differs
  from the collector's. Don't replay a delivery answered 200 to retry its
  collector request: a replay posts its Slack alerts again, the alert for each
  new tag and, for a US or UK release repository's `main` update, its
  `releases.json` record alerts. Once the cause is corrected, any of these queues
  a build of everything the collector's store lacks for that country and kind,
  without a repeated alert:
  1. Wait for the next delivery for that country and kind.
  2. For a staging repository, replay one of its `main`-update deliveries. A
     staging delivery posts no Slack alert.
  3. For a release repository, send one authenticated release payload whose
     only entry is a `refs/heads/main` update with the repository's current
     head commit as both `oldSha` and `newSha`. It queues a release build and
     posts no alert: it has no new tag, and `releases.json` is the same before
     and after the update.
- `503` from the application means a failure that may pass, and its `detail`
  says which: "Unable to read releases.json; retry the delivery." (a Hugging Face
  5xx or 429, or a failed or timed-out request or body) or "Unable to queue the
  calibration tree build; retry the delivery." (the collector answered 5xx or
  429, could not be reached, did not answer in time, or its 202 answer's body
  could not be read). No Slack alert was posted, and Hugging Face retries the
  delivery. Hugging Face documents no limit on those retries and no guarantee
  that the Activity page shows an event's last answer, so follow these steps
  whenever deliveries were answered 503, whether or not the webhook was
  suspended. The function logs are the record of each answer: every delivery
  that starts a build logs "Answered 503 to" or "Answered 200 to", followed by
  its `Webhook-Id`, repository, ref and commit. A retry or replay keeps the
  delivery's `Webhook-Id`, so the latest entry for an ID is its latest answer.
  1. Correct the cause, and if the webhook is suspended, re-enable it.
  2. Find the deliveries whose latest entry is "Answered 503 to". For a release
     repository whose country has a Slack channel, replay every one of them,
     oldest first, from the Activity page. Each covers its own pair of
     commits, so replaying only the latest would lose the earlier updates'
     alerts. Don't replay a delivery once it has been answered 200: its
     alerts were posted. A staging repository, or a release repository whose
     country has no Slack channel (Belgium today), has no alerts to lose, and
     one request covers everything the store lacks: if no later delivery from
     that repository was answered 200, replay only its newest such delivery.
  3. The repository's last delivered commit is now the `newSha` of its
     latest delivery answered 200, counting step 2's replays. For updates
     made after that commit (while the webhook was suspended, so never
     delivered), send one authenticated release payload per affected
     repository. Its `main` entry has that commit as `oldSha` and the
     repository's current head as `newSha`; it announces their net change
     once and queues one build. Add one `refs/tags/<tag>` entry, with
     `oldSha` null and the tag's commit as `newSha`, for each tag created in
     that time, or those tags get no tag alert. Send one staging `main`-update
     payload per staging repository to queue its build.
- An answer with `release_record_problem` means `releases.json` could not be
  read for a lasting reason, such as a token without access or a record the
  release writer's rules refuse. The collector request and the tag alerts went
  ahead, but no record alert was posted. Once the cause is corrected, replay
  that delivery to post its record alerts. A replay also repeats any tag alert
  the delivery carried, and asks the collector for the build again, which is
  safe to repeat.
- A queued build that fails is reported by the collector, not by the webhook:
  see the worker job's logs and the `calibration_tree_build_requests` table, which
  the collector's README describes under "Queuing calibration tree builds".
- Hugging Face retries non-2xx deliveries and can suspend a repeatedly failing
  webhook. Correct the failure, re-enable the webhook, and replay the delivery;
  see the [Hugging Face delivery and retry documentation](https://huggingface.co/docs/hub/webhooks#delivery-and-retries).

There is no scheduled run. A later delivery for the same country and kind queues
a run that builds everything the collector's store lacks. The collector's own
settings decide whether it accepts these requests.

#### Calibration-tree builds in the collector

For each delivery that starts a build (a staging repository's last `main`
update; a release repository's newest new tag, else its last `main` update), the
webhook asks the telemetry collector to queue a calibration-tree build of that
country and kind:

```text
POST <MICROCOSM_TELEMETRY_COLLECTOR_URL>/v1/calibration-tree-builds
Authorization: Bearer <the deployment's Vercel OIDC token>
Content-Type: application/json

{"country": "uk", "kind": "staging", "hf_repo": "policyengine/populace-uk-staging",
 "hf_ref": "refs/heads/main", "hf_commit": "<40 lower-case hex>"}
```

- `country` is the dashboard's country code (`us`, `uk` or `be`), and `kind`
  is the repository's registration, `release` or `staging`.
- `hf_repo` is the repository's name as the dashboard is configured with it
  (the registration's name, or its `repo_env` override), not the delivery's
  spelling, whose letter case may differ. The collector accepts only its own
  repository for the country and kind and refuses any other name with 422
  `repo_not_registered`.
- `hf_ref` is the triggering ref (`refs/heads/main` or `refs/tags/<tag>`) and
  `hf_commit` its new commit. The collector only records them, and refuses the
  whole request for a malformed one, so each is left out when it breaks the
  collector's pattern.
- The token is read with `getVercelOidcToken()` (`@vercel/oidc`) for each
  request, never when the server starts. It is sent whatever
  `MICROCOSM_TELEMETRY_VERCEL_OIDC` says: that setting chooses only how the
  build monitor reads the collector.
- The request runs after the `releases.json` reads, so a delivery they answer
  503 sends none, and before the Slack alerts. One 15-second deadline covers the
  token read, the request and its answer.
- The collector queues one build of everything its store lacks for the country
  and kind, and answers 202 with `queued`, or with `already_queued` when the
  build of that country and kind for the current 10-minute window is already
  queued.

The address is `MICROCOSM_TELEMETRY_COLLECTOR_URL`, the build monitor's
setting, read when the server starts, with the build monitor's rules: HTTPS,
except on `localhost` or `127.0.0.1`, no credentials, query or fragment, and
any trailing slash removed. The webhook needs no read credential. Unset, the
webhook sends no request. An invalid value does not stop the webhook: each
delivery reports it as a failed request, and its Slack alerts still post.

The answer's `tree_build` reports the request:

- `{"status": "queued" | "already_queued", "task_id", "not_before"}`, copied
  from the collector's 202 answer;
- `{"status": "failed", "detail"}` for any other answer, a timeout, a network
  failure, a token that could not be read, or an invalid address. `detail` is
  a fixed sentence naming the collector's HTTP status or the kind of failure;
  it never holds the collector's answer, the address or the token. The cause
  is logged as "Calibration tree build request to the collector failed", with
  the collector's status and at most 200 characters of its answer or, when
  the request or its answer's body failed, the error and its cause (such as
  a failed DNS lookup, connection or TLS handshake), never the request's
  headers;
- `{"status": "not_configured"}` when `MICROCOSM_TELEMETRY_COLLECTOR_URL` is
  unset.

A delivery that starts no build has no `tree_build`. Otherwise the request's
result decides the webhook's status:

- **503, before any Slack alert,** when the failure may pass: the collector
  answered 5xx or 429, could not be reached or did not answer within the
  deadline, or the body of its 202 answer could not be read. The answer is
  `{"detail": "Unable to queue the calibration tree build; retry the delivery.", "tree_build":
  {...}}`, and the log entry says "answering 503". Hugging Face retries the
  delivery, which requests the build again and then posts each alert once.
- **200** otherwise: the build was queued, no address is configured, or the
  failure is lasting (any other collector status, a 202 that is not a queued
  build, an invalid address or a token that could not be read). A lasting failure
  is logged and does not stop the alerts.

Repeating the request is safe. Within one 10-minute window the collector answers
`already_queued`, and a later request queues one more run, which builds only what
its store still lacks.

The collector accepts the request only with a valid Vercel OIDC token of the
team its `TELEMETRY_VERCEL_OIDC_TEAM_SLUG` and `TELEMETRY_VERCEL_OIDC_TEAM_ID`
name, from a project and environment its
`TELEMETRY_VERCEL_OIDC_TREE_BUILD_CALLERS` lists. That list is separate from
the build monitor's readers, `TELEMETRY_VERCEL_OIDC_READERS`. While that list
is unset, or while the collector's artifact intake is off, the collector
answers 404. Those settings belong to the collector's deployment
([PolicyEngine/microcosm-collector](https://github.com/PolicyEngine/microcosm-collector)),
not to this repository.

## Checking what a run would build

The collector's `reconcile-calibration-trees` operations command takes
`--country <cc>`, optionally `--kind release|staging`, and `--dry-run`, which
reports each build's outcome without writing to the store. The collector's README
gives the command and how to run it, under "Queuing calibration tree builds".

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
