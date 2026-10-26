# Hosted dashboard and variable runtime

The calibration dashboard is a Next.js application hosted on Vercel. Its variable
lookup, `/api/microcosm_variable`, forwards each request to a private FastAPI service on
Modal (`backend/modal_app.py`, `backend/app.py`). That service runs
`frontend/scripts/microcosm_variable_core.py`, which the local command-line tool also
uses. Before it constructs a native PolicyEngine microsimulation, it verifies the
installed .py version and the model versions that .py pins, both release manifests,
.py's data certification and the H5's SHA-256. Weighted results use MicroSeries. The
root evaluation environment (`pyproject.toml`, `uv.lock`) and its recorded outputs are
separate from this runtime.

The dashboard server also reads:

- Hugging Face, for calibration releases and staging runs
  ([Hugging Face reads](#hugging-face-reads));
- the hosted Microcosm telemetry collector, for build progress
  ([Reading the telemetry collector](#reading-the-telemetry-collector));
- Vercel Blob, for comparison artifacts (`BLOB_READ_WRITE_TOKEN`).

The Modal runtime uses Python 3.12 and the hashed `backend/requirements.lock`.
Regenerate that lock from the repository root with `uv pip compile
backend/requirements.txt --python-version 3.12 --generate-hashes --output-file
backend/requirements.lock`. The Modal image also installs Debian's current
`ca-certificates` package, and the Next.js server removes two compromised certificate
authorities from Node's default list when it starts (`frontend/instrumentation.ts`).

## Model and data identity

.py (the PyPI package `policyengine`) is the model identity. `backend/requirements.txt`
pins it as `policyengine[us]==6.7.5` and pins no model package itself. **Upgrade by
bumping .py; the dataset must be one that version of .py certifies.** Never pin
`policyengine-us`, `policyengine-core` or `spm-calculator` directly;
`frontend/tests/test_model_dependency_pins.py` fails if a bare pin reappears.
`frontend/scripts/hosted_release.json` records the certifying .py version in
`certifying_package`, the versions that .py's `us` extra pins in `packages`
(policyengine-us 2.2.1, policyengine-core 3.33.0, spm-calculator 1.0.0), and the
reviewed data identity: repository, immutable commit `hf_revision`, release ID, H5
filename and SHA-256, data year, and the canonical digests of both release manifests.
The Next.js proxy reads the same file (`frontend/lib/microcosm/production-release.ts`).

`frontend/scripts/hosted_release.py` enforces the identity in two places:

- `validate_runtime` requires the installed .py to be the reviewed version, derives
  the exact `policyengine-us`, `policyengine-core` and `spm-calculator` versions from
  that .py's `us` extra, requires the `packages` block to equal them, and requires the
  installed versions to equal them exactly. It runs before any manifest or H5 download.
- `validate_manifests` checks both manifest digests and the release's own identity
  fields, then requires the installed .py's bundle manifest
  (`policyengine/data/bundle/manifest.json`) to certify this release: its release ID,
  revision, dataset URI and SHA-256, manifest paths, model version, and the digest of
  every release file it records, including the parent release and build manifests.

The release's own built-with Core version and its build manifest's `runtime` block are
not the identity: .py is. For the same reason the build manifest's exported-household
count is checked by `frontend/scripts/verify_hosted_runtime.py --dataset-file` only when
the .py-certified build records one.

The reviewed release is `populace-us-2024-spm-20260915`, the US dataset that .py 6.7.5
certifies. .py 6.4.1 certified the same release, and 6.7.5's `us` extra pins the same
three package versions. It is a source-enrichment release of
`populace-us-2024-buildp-sparse-rmloss100-cae8640-20260728T011454Z`: the same tables
and calibration plus `is_spm_independent_minor_role`, which `policyengine-us` 2.x
requires to calculate SPM thresholds. Its parent manifests are the Build P manifests
previously reviewed here.

### Stored-input renames

The reviewed H5 stores WIC take-up as `would_claim_wic`. policyengine-us 2.2.1 renamed
that input `takes_up_wic_if_eligible` (default `True`), and it sets a stored column as
an input only when it defines a variable of that name, so without a mapping every
WIC-eligible person takes WIC up. After building each simulation, the hosted runtime
(`native_simulation` in `microcosm_variable_core.py`) and the evaluation harness
(`evaluation_harness/adapters/microcosm.py`) call .py's
`policyengine.tax_benefit_models.us.legacy_inputs.apply_legacy_input_renames_to_microsimulation`,
which sets each renamed input from its stored column. Every calculation response
records the renames applied, per geographic scope, in `execution.legacy_input_renames`.
`verify_hosted_runtime.py`, which the Modal image runs while it is built, records the
function it binds and the renames .py reports for the pinned model.

The hosted runtime calls that function directly instead of .py's
`managed_microsimulation`, which accepts only a dataset path, builds every
economic-assumption year, and cannot take the in-memory state subset.

### Upgrading .py

1. Bump `policyengine[us]` in `backend/requirements.txt` and regenerate the lock.
2. Read the new .py's `data_releases.us` bundle entry, and set `hosted_release.json`'s
   data identity and `packages` to what that .py certifies and pins.
3. Refresh the manifest fixtures under `frontend/tests/fixtures/`.
4. Check the stored-input renames the new .py reports for the pinned model.
   `frontend/tests/test_hosted_runtime_verification.py` expects exactly
   `would_claim_wic` to `takes_up_wic_if_eligible`.
5. Regenerate `frontend/public/variable-catalog.json` in the hosted-runtime environment
   with `python frontend/scripts/generate_variable_catalog.py`. It builds the catalog
   from a simulation over the reviewed H5, verified by SHA-256 (`--dataset-file` reuses
   a local copy), never from the country package's default dataset, and records the
   release and package versions it used.
6. Qualify the deployment with the [required calculation checks](#required-calculation-checks).

## Automated production deployment

`.github/workflows/deploy.yml` ("Deploy production") is the only production deployment
path. It starts on `workflow_run` for the `CI` workflow, filtered to CI runs whose head
branch is `main`. Its one job runs only when that CI run concluded `success`, was a
`push` and had head branch `main`, so pull-request CI runs never deploy, including one
from a fork whose branch is named `main`. CI runs for every pull request and every push
to `main`, and a newer run for the same pull request or branch cancels an unfinished
one. When two
merges arrive close together, the earlier commit's CI run can therefore be cancelled,
and only the later commit deploys.

The deploy job, not the workflow, holds the `calibration-diagnostics-production`
concurrency group: one deploy runs, at most one waits, and a newer `main` deploy
replaces a waiting one. A run whose job is skipped never replaces a waiting deploy
(#260). The job runs in the GitHub `Production` environment, which had no required
reviewers or branch policy when read on 2026-10-26, with a 45-minute limit and
permission to request a GitHub OIDC token. It checks out the exact commit CI tested and
performs these steps in order:

1. Require the Modal, Vercel and Hugging Face credentials and the collector address
   (`.github/scripts/deploy-dashboard.sh require-configuration`). A missing one stops
   the job before anything is deployed.
2. Authenticate to Google Cloud through GitHub OIDC and Workload Identity Federation,
   then confirm that the collector's read secret exists with a metadata-only
   `gcloud secrets describe` call. The step never reads the secret's value, and it does
   not show that the dashboard's Vercel identity can read the secret.
3. Install Modal 1.5.5 into `.deploy-venv` and Vercel CLI 58.8.0.
4. Deploy the Modal application `calibration-diagnostics-<first 12 characters of the
   commit>` in the `main` Modal environment.
5. Resolve that application's `web_app` URL, which must be an `https://…modal.run`
   address and is masked in the log, and verify its authenticated metadata.
6. Build a production-targeted Vercel deployment from the repository root with
   `--skip-domain`, passing the Modal URL, the Modal proxy credentials, the Hugging Face
   read token, the collector address and the source commit as `--env` values.
7. Verify the unaliased deployment's metadata through the mounted route
   `/calibration/dashboard/api/microcosm_variable`, then send one calculation request
   for the national `spm_unit_spm_threshold` and the California `ca_income_tax` in 2024.
   Promotion requires the reviewed package and data identities, verified H5 bytes,
   finite weighted results, California input for the state result, and both scopes
   built fresh, with the national simulation evicted before the state one. If the
   connection is refused, closes, resets or times out before a complete response
   arrives, the check waits until the backend answers a metadata request (at most 860
   seconds after the first request), then sends the calculation once more; the retried
   response must meet the same requirements. A DNS or TLS-certificate failure, an HTTP
   error, or a response that fails them is never retried, so a slow calculation still
   fails: the proxy answers HTTP 504 after waiting 780 seconds. The metadata checks and
   the post-promotion California checks instead make up to six attempts, pausing 5, 10,
   15, 20 and 25 seconds between them, and retry any failure.
8. Install the frontend workspace (`bun install --frozen-lockfile --ignore-scripts`)
   and run the calibration release check against the candidate
   ([Promotion and rollback](#promotion-and-rollback)).
9. Promote the Vercel deployment with `vercel promote`.
10. Send a California calculation through `calibration-diagnostics.vercel.app` and
    through the `microcosm.institute/calibration/dashboard` mount, then run the
    calibration release check against `calibration-diagnostics.vercel.app`.

The workflow names each backend after its commit so an older frontend continues to
reference its matching backend during rollback. Retain these applications for the
rollback window, and remove them separately once no deployable frontend references
them. Nothing removes them automatically: the `main` Modal environment held 31
`calibration-diagnostics-*` applications on 2026-10-26.

The workflow is fixed to Vercel project `calibration-diagnostics`
(`prj_pL7dIJJ3M4hGcKr5pttWaOACVFtu`) in the PolicyEngine team
(`team_xsyTmFLMLGbHH7Qxu70R5G4r`) through `VERCEL_PROJECT_ID`, `VERCEL_ORG_ID` and
`--scope policy-engine`. `frontend/vercel.json` turns off Vercel's Git deployment for
`main` only, so pull-request previews remain enabled. Do not relink the workflow to a
different project or remove `--skip-domain`; the frontend must not receive production
traffic before its paired backend passes the deployment checks.

Run the Vercel CLI from the repository root. The Vercel project sets `frontend` as its
root directory (read 2026-10-26), so a CLI working directory of `frontend` would make
Vercel look for a nonexistent `frontend/frontend` directory.

### Deployment settings

The workflow reads these settings. Every name was present when listed on 2026-10-26;
no value was read.

| Setting | Provider | Where it is read |
| --- | --- | --- |
| `MODAL_TOKEN_ID`, `MODAL_TOKEN_SECRET` | PolicyEngine organization Actions secrets | The Modal deploy and URL-resolution steps. They let the Modal client deploy to the PolicyEngine workspace's `main` environment. |
| `MICROCOSM_MODAL_KEY`, `MICROCOSM_MODAL_SECRET` | `Production` environment secrets | The backend metadata check, and `vercel deploy --env` for the candidate, whose variable route sends them as the `Modal-Key` and `Modal-Secret` headers. They are a Modal proxy token, which the `requires_proxy_auth` web function requires. |
| `VERCEL_TOKEN` | `Production` environment secret | `deploy-dashboard.sh deploy-frontend` and `vercel promote`. |
| `VERCEL_AUTOMATION_BYPASS_SECRET` | `Production` environment secret | The checks of the unaliased candidate, which send it as `x-vercel-protection-bypass` because Vercel protects generated deployment URLs. |
| `HF_RELEASE_READ_TOKEN` | Repository Actions secret | `vercel deploy --env`, as the candidate's runtime `HF_TOKEN` ([Hugging Face reads](#hugging-face-reads)). |
| `MICROCOSM_TELEMETRY_COLLECTOR_URL` | `Production` environment variable | `vercel deploy --env`, for the candidate's collector client. |
| `TELEMETRY_GCP_WIF_PROVIDER`, `TELEMETRY_GCP_DEPLOY_SERVICE_ACCOUNT` | `Production` environment secrets | `google-github-actions/auth`, used only by the read-secret existence check. The service account is the collector's deploy service account. |
| `TELEMETRY_GCP_PROJECT_ID`, `TELEMETRY_READ_SECRET_NAME` | `Production` environment variables | The read-secret existence check, as `PROJECT_ID` and `READ_SECRET_NAME`. |
| `MICROCOSM_CALCULATION_URL` | Output of the URL-resolution step | `vercel deploy --env`, for the candidate's variable route. |
| `MICROCOSM_BACKEND_SOURCE_COMMIT` | The commit CI tested | `vercel deploy --env`. The variable route compares the backend's packaged commit with `VERCEL_GIT_COMMIT_SHA` when Vercel sets it, and with this value otherwise, and answers 409 when they differ. |

The candidate also uses settings stored in the Vercel project's Production
environment, which the workflow neither supplies nor changes:
`MICROCOSM_TELEMETRY_READ_SECRET_VERSION` and
`MICROCOSM_TELEMETRY_GOOGLE_IDENTITY_PROVIDER` (the collector),
`POPULACE_UK_STAGING_HF_TOKEN` (UK staging), `BLOB_READ_WRITE_TOKEN` (Vercel Blob),
`HF_WEBHOOK_SECRET` and `GITHUB_ACTIONS_DISPATCH_TOKEN` (the Hugging Face webhook),
`SLACK_WEBHOOK_POPULACE_US` and `SLACK_WEBHOOK_POPULACE_UK`, and
`CROSS_DATASET_ARTIFACT_BASE_URL` and `CROSS_DATASET_ARTIFACT_BASE_URL_BE`. Each name
was listed on 2026-10-26. The project also stores its own Production `HF_TOKEN`; which
of that value and the `--env` value a deployment uses was not verified. Vercel provides
`VERCEL=1` and the deployment's OIDC token itself.

## Reading the telemetry collector

The Microcosm telemetry collector runs on Google Cloud Run. Its source, tests and
deployment are in
[PolicyEngine/microcosm-collector](https://github.com/PolicyEngine/microcosm-collector),
which has deployed it since 2026-10-21. A merge to this repository's `main` deploys only
the dashboard and its Modal backend, never the collector. The dashboard only reads the
collector, from server code (`frontend/lib/server/microcosm/telemetry-collector-client.ts`),
with three server-only settings:

- `MICROCOSM_TELEMETRY_COLLECTOR_URL`: the collector address. It must use HTTPS, except
  on `localhost` or `127.0.0.1`. Production deployments get it from the GitHub
  `Production` environment variable through `vercel deploy --env`; previews get it from
  the Vercel project's Preview settings.
- `MICROCOSM_TELEMETRY_READ_SECRET_VERSION`: the full Google Secret Manager version
  resource that holds the collector's read credential,
  `projects/<project>/secrets/<secret>/versions/<number or latest>`. It is a Vercel
  project setting, present in both the Production and the Preview environment.
- `MICROCOSM_TELEMETRY_GOOGLE_IDENTITY_PROVIDER`: the full Google Workload Identity
  provider resource that trusts this Vercel project. It is a Vercel project setting,
  present in both environments, and is read only on Vercel.

Production should name the production collector and its read secret, and Preview the
staging collector and its read secret. Only the names were listed (2026-10-26), so
which collector each environment's values name is not verified here.

On Vercel (`VERCEL=1`), `frontend/lib/server/secret-manager.ts` exchanges the
deployment's Vercel OIDC token (`@vercel/oidc`) for a Google access token through that
provider, reads the secret version from the Secret Manager API, and keeps the value in
memory for up to one minute. Locally it uses Google Application Default Credentials and
does not read the provider setting. The server sends the credential only to the
collector, as the `X-Telemetry-Read-Token` header; it never reaches the browser and
never passes through GitHub Actions. Without the address and the secret version, the
build monitor shows only the Hugging Face staging history. If a collector request fails,
the build monitor still shows the Hugging Face runs and reports `collector` among the
runs that could not be read.

The Vercel project has OIDC turned on with the team issuer (read 2026-10-26). The
Google side, the provider's trust in that issuer and audience and each identity's
access to its own read secret, was provisioned outside this repository and is not
verified here. [docs/build-monitor.md](../docs/build-monitor.md) describes the build
monitor that shows these runs.

## Hugging Face reads

- **The Modal backend** downloads the reviewed release's manifests and H5 from the
  public dataset repository `policyengine/populace-us` at the commit pinned in
  `hosted_release.json`, without a token: the Modal function has no Modal secret
  attached. The repository answered an unauthenticated request on 2026-10-26. If it
  became private, the backend would need a token, which this code does not provide.
- **The dashboard server** reads calibration releases and staging runs with `HF_TOKEN`,
  or `HUGGINGFACE_TOKEN` when `HF_TOKEN` is unset. UK staging is the exception: it reads
  only `POPULACE_UK_STAGING_HF_TOKEN`, a Vercel project setting. For production
  deployments the workflow sets `HF_TOKEN` from the repository secret
  `HF_RELEASE_READ_TOKEN`. That must be a dedicated fine-grained read-only token for the
  registered private release repositories (`policyengine/populace-uk-private`,
  `policyengine/populace-be-private`) and the private US staging repository
  `policyengine/populace-us-staging`. Never reuse the publisher's `HF_TOKEN` Actions
  secret, which `.github/workflows/publish-calibration-tree.yml` uses, for the
  dashboard. Previews use the Vercel project's Preview `HF_TOKEN`. The tokens' scopes
  cannot be read from GitHub or Vercel, so they are not verified here.

Each registered country's release and staging repositories can be overridden on the
dashboard server by the settings its registration names (`repo_env` and `revision_env`
in `frontend/packages/calibration-tree/src/countries.ts`, such as `POPULACE_HF_REPO`
for the US). None of these overrides was set in the Vercel project on 2026-10-26.

## Preview deployment

Vercel's Git integration builds a preview of every pull request. A preview reads its
settings from the Vercel project's Preview environment, which on 2026-10-26 held
`MICROCOSM_CALCULATION_URL`, `MICROCOSM_MODAL_KEY`, `MICROCOSM_MODAL_SECRET`, `HF_TOKEN`,
`POPULACE_UK_STAGING_HF_TOKEN`, `BLOB_READ_WRITE_TOKEN`, the three collector settings
and `VERCEL_SUPPORT_LARGE_FUNCTIONS`. A Git preview's `VERCEL_GIT_COMMIT_SHA` is its own
commit, so its variable lookups succeed only when the configured backend was deployed
from that same commit; otherwise the proxy answers 409. The other dashboard pages do
not use the backend.

To qualify a change to the hosted runtime on a preview, install the runtime lock into a
separate environment, run the hosted Python tests and `verify_hosted_runtime.py`, then
run the frontend tests, typecheck and build. Commit the reviewed source before building
the Modal image: `backend/modal_app.py` refuses uncommitted or untracked files under
`backend/` and `frontend/scripts/`, and records the actual Git commit and a digest of
those directories' Git tree.

Use the PolicyEngine Modal workspace and an explicit task-owned application name.
`backend/modal_app.py` fails without `CALIBRATION_MODAL_APP_NAME`:

```bash
CALIBRATION_MODAL_APP_NAME=calibration-diagnostics-preview-REVIEW_ID \
  uv run --no-sync modal deploy backend/modal_app.py --env testing
```

The service requests two CPU cores and reserves 16 GiB with the same hard limit. It
runs at most one container, which serves one request at a time (`max_containers=1`,
`max_inputs=1`), stops a call after 800 seconds, and scales to zero after 60 idle
seconds. Its working disk holds the normal Hugging Face download. Observe the actual
deployed allocation and response resource measurements rather than assuming the
requested allocation is sufficient.
Under policyengine-us 1.764.6 the local SPM reference peaked at approximately 12 GB, and
an 8 GiB hosted allocation did not complete the calculation. Under .py 6.4.1, whose
`us` extra pins the same policyengine-us 2.2.1, policyengine-core 3.33.0 and
spm-calculator 1.0.0 as 6.7.5, a local national `spm_unit_spm_threshold` calculation,
then `ca_income_tax`, then the national threshold again, peaked at about 1 GB resident
memory (macOS, 2026-10-16). This document records no hosted measurement for that
package set, so keep the 16 GiB allocation until one is recorded. The required checks
below must still pass.
The service loads only the reviewed 2024 input. It validates the native dataset year and
wraps that `USSingleYearDataset` in a one-entry `USMultiYearDataset` before constructing
the simulation. This prevents the pinned country package from automatically allocating
copies for later economic-assumption years: policyengine-us 2.2.1's `Microsimulation`
still extends a single-year dataset through every economic-assumption year and does not
let the caller set the end year. Remove the wrapper only after upgrading to a
country-package version that does, and qualify that upgrade with the same calculation
checks.
Only one native simulation stays resident: changing between national and state scopes
evicts the preceding simulation before loading the next input tables. Same-scope requests
can reuse it; mixed variable lists may rebuild when their scopes change.

Create a dedicated Modal proxy token with `modal workspace proxy-tokens` (Modal 1.5.5
or later). Keep its ID and secret out of source and logs. Where the workspace supports
RBAC, allow only the intended Modal environment. Otherwise the token has workspace-wide
proxy scope: keep it server-only and delete the task token after qualification. Set
these **server-only** Vercel Preview settings:

- `MICROCOSM_CALCULATION_URL`: the actual returned Modal app URL.
- `MICROCOSM_MODAL_KEY` and `MICROCOSM_MODAL_SECRET`: the proxy credentials.

For local development against a remote backend, set `MICROCOSM_BACKEND_SOURCE_COMMIT`
explicitly. Without a remote URL, and outside Vercel, local calculations run
`frontend/scripts/microcosm_variable_value.py` with the local Python.

## Required calculation checks

1. Verify direct authenticated backend metadata and both native-compatible and mounted
   Next metadata routes return JSON 200 with the expected source, model and configuration.
   With a nonempty base path, the former root `/api/microcosm_variable` URL first returns
   a same-origin 307 to the mounted Next route; preserve that redirect in the receipt.
   Metadata is not proof that data loaded or a calculation succeeded. It does refuse a
   conflicting deployment data selection: the backend validates its resolved
   `POPULACE_HF_REPO`/`POPULACE_HF_REVISION` against the reviewed release and answers 503,
   and the proxy compares the response's `environment_configuration` with the reviewed
   selection and answers 409. A 200 metadata receipt therefore also records that this
   deployment is not carrying a stale override.
2. On a fresh backend deployment, run a genuine `spm_unit_spm_threshold` lookup for 2024
   on the pinned release through the exact Next preview. Require JSON 200, verified
   H5 SHA-256, exact model/source identity, `execution.simulation_cache_hits.national=false`
   and a non-null weighted result. Require comparison with a separately executed reference
   using the identical source, package versions and immutable H5. An older Core version's
   results are not a substitute, and an unavailable reference leaves this check incomplete.
3. Preserve the request, response hash, execution ID, source/deployment identities,
   allocation, peak memory and elapsed time. Exercise a warm request separately and label
   its cache reuse. Test explicit blank fields (400), unsupported year/release (409),
   missing backend configuration (503), invalid JSON and foreign redirects (502).
4. Require the observed cold and queued request latency to fit the actual browser/Next
   response budget. Modal's documented 303 result redirect continues the same invocation;
   the proxy confines it to the original origin/path and never forwards a caller's result
   token. The 800-second function setting is not proof of an 800-second browser budget.
   If measured requests exceed the usable budget, add an explicit asynchronous client
   flow before promotion; do not hide timeouts with retries or stale outputs.
5. After a national request, execute a real state variable such as `ca_income_tax`.
   Require recorded national-cache eviction, numeric output with the correct state scope,
   and comparison with the same-package local reference. Exercise the reverse transition
   or a mixed-scope request as well; national-only success does not qualify state lookup.

## Promotion and rollback

Obtain independent review and passing CI on the exact candidate.
`frontend/vercel.json` prevents Vercel's Git integration from deploying `main`; the
backend-first GitHub workflow is the only production deployment path. Keep the project
setting `autoAssignCustomDomains=false` (it was `false` when read on 2026-10-26) as an
additional protection against unintended domain assignment, and read it back when
changing deployment configuration.

The backend reads `POPULACE_HF_REPO` and `POPULACE_HF_REVISION` from its own Modal
environment. The Modal function has no Modal secret attached and its image sets neither,
so both are unset and the backend uses the reviewed values; its 503 refusal guards
against a later change that sets them. The variable proxy on Vercel uses the checked-in
identity and never forwards either setting to the backend. On Vercel, `POPULACE_HF_REPO`
changes only which repository the dashboard's US release discovery reads, and that
discovery follows the repository's `main` branch through the dashboard manifest. Neither
setting was present in the Vercel project's Production or Preview environment on
2026-10-26. If either appears, record and remove only that entry, retaining its prior
setting for rollback. Do not print or change unrelated environment entries.

The production workflow deploys the matching private backend, stages the exact frontend
with production server-only URL and credentials, verifies metadata, a genuine
calculation and the calibration releases, and only then runs `vercel promote`. After
promotion, it checks a genuine calculation through `calibration-diagnostics.vercel.app`
and the `microcosm.institute/calibration/dashboard` mount, and the calibration releases
through `calibration-diagnostics.vercel.app`. A failure before promotion leaves the
existing production aliases unchanged. A failure after promotion must be handled with
the rollback procedure below.

`frontend/scripts/calibration-deployment-smoke.ts` is the calibration release check.
For each registered country with the `calibration` capability (the US, the UK and
Belgium), it requires an available calibration summary with a positive target count and
the expected country, and a release inventory whose default and latest release are that
summary's release, with calibration. For each country with the `staging` capability
(the US and the UK), it requires the staging inventory to report `available: true` with
a list of runs; an HTTP 200 alone does not qualify staging. It then requires an
unregistered two-letter country code to be refused as not configured (HTTP 404), never
answered with another country's release. Public US calculations alone do not qualify
private release access.

The script imports the `@policyengine/calibration-tree` workspace package, so the
workflow runs `bun install --frozen-lockfile --ignore-scripts` in `frontend` before the
first check. It installs after the Vercel upload, which sends the repository root, so the
uploaded files never include `node_modules`. Lifecycle scripts are skipped because the
job holds Google Cloud credentials and can request GitHub OIDC tokens. Both checks run
`bun run --no-install`, so Bun never installs a missing package from npm by itself;
without the workspace install, a check fails.

The calibration release check retries network failures and HTTP 5xx twice, after one
and then two seconds, with a 60-second timeout per attempt. It never follows a
redirect, so the bypass header cannot reach another address. Any other status than the
expected one (200, or 404 for the unregistered code), a malformed successful response,
and unavailable or inconsistent data fail immediately. If the post-promotion check fails, the workflow reports failure while
production aliases already point at the candidate. The release owner must follow the
rollback procedure below and run `vercel rollback PREVIOUS_DEPLOYMENT`; the workflow
does not roll back automatically.

The public `calibration-diagnostics.vercel.app` domain is also the stable Hugging Face
webhook origin. Do not point the webhook at a staged deployment URL or the protected
`calibration-diagnostics-policy-engine.vercel.app` alias.

Vercel hosts only Next.js; the Python calculation runs on Modal. The Vercel project's
Preview environment still held `VERCEL_SUPPORT_LARGE_FUNCTIONS` on 2026-10-26, from
when the calculation ran on Vercel. Nothing in this repository reads it, and removing it
is a release-owner action. Production settings and aliases are release-owner actions,
never implied by a successful preview build.

Rollback uses `vercel rollback PREVIOUS_DEPLOYMENT` and the backend URL/credentials baked
into that deployment. Retain that backend and token through the rollback window. Restore
only the recorded task-related settings. Do not claim an older deployment with a known
broken variable endpoint is a functioning calculation rollback. Remove only task-owned
preview apps, deployments and proxy tokens after saving qualification evidence.

References: [Modal timeouts](https://modal.com/docs/guide/webhook-timeouts),
[Modal resources](https://modal.com/docs/guide/resources),
[Vercel staged promotion](https://vercel.com/docs/cli/deploying-from-cli), and
[Vercel automatic domain assignment](https://vercel.com/changelog/stage-and-manually-promote-deployments-to-production).

### Private serving-process audit

An operator can request `GET /api/microcosm_variable?runtime_audit=<nonce>` on
this existing backend through its required Modal proxy authentication. Use one
16–128 character nonce containing only letters, digits, `_` or `-`, with no
calculation parameters. The response is uncached and the branch precedes the
calculation code. It reports the actual handling PID, `sys.executable`, prefixes,
sanitized `pyvenv.cfg` fields/hash, loaded module paths, public Modal call/input
IDs, and a real lightweight child launched through `sys.executable`.

This is metadata from the actual serving process. It neither runs a population nor
establishes full package closure. Bind the actual authenticated response and nonce
to `FunctionCall.from_id(call_id).get_call_graph()`, the task/container ID and the
reviewed app/function/image/source receipts. Missing call-graph correlation leaves
the serving identity pending. A separate container-exec process is useful for
package/RECORD/source-byte capture but does not replace this serving witness. The
lightweight child demonstrates interpreter inheritance; it is not a scientific
calculation receipt. Require the existing staged functional and deployment checks before
production promotion.

The witness reports whether both public Modal context IDs are present; this is
an observation, not identity approval. Null parent module origins mean the module
has not been loaded in that process. The lightweight child separately reports
installed package versions through metadata and its import paths, without
importing any model. Audit capture failures return generic uncached 502 JSON and
log the captured traceback to the backend logger `backend.variable_endpoint`, so
read those logs for the cause rather than the response body.
