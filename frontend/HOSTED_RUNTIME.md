# Hosted variable runtime

The Next.js dashboard proxies variable requests to a private Modal service. The service
executes `scripts/microcosm_variable_core.py`, also used by the local command-line tool,
and verifies the installed .py version and the model versions it pins, both release
manifests, the data certification and the H5 bytes before constructing a native
PolicyEngine microsimulation. Weighted results use MicroSeries. The root evaluation
environment and its recorded outputs remain separate.

The runtime uses Python 3.12 and the hashed `../backend/requirements.lock`. Regenerate
that lock with `uv pip compile backend/requirements.txt --python-version 3.12
--generate-hashes --output-file backend/requirements.lock` from the repository root.

## Model and data identity

.py (the PyPI package `policyengine`) is the model identity, and
`backend/requirements.txt` declares only `policyengine[us]==VERSION`. **Upgrade by
bumping .py; the dataset must be one that version of .py certifies.** Never pin
`policyengine-us`, `policyengine-core` or `spm-calculator` directly; a test fails if a
bare pin reappears. `scripts/hosted_release.json` records the certifying .py version
in `certifying_package` and the reviewed data identity: repository, immutable commit
`hf_revision`, release ID, H5 filename and SHA-256, data year, and the canonical
digests of both release manifests.

`scripts/hosted_release.py` enforces the identity in two places:

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
count is checked by `verify_hosted_runtime.py --dataset-file` only when the
.py-certified build records one.

The reviewed release is `populace-us-2024-spm-20260915`, the US dataset .py 6.4.1
certifies. It is a source-enrichment release of
`populace-us-2024-buildp-sparse-rmloss100-cae8640-20260728T011454Z`: the same tables
and calibration plus `is_spm_independent_minor_role`, which `policyengine-us` 2.x
requires to calculate SPM thresholds. Its parent manifests are the Build P manifests
previously reviewed here.

To upgrade:

1. Bump `policyengine[us]` in `backend/requirements.txt` and regenerate the lock.
2. Read the new .py's `data_releases.us` bundle entry, and set `hosted_release.json`'s
   data identity and `packages` to what that .py certifies and pins.
3. Refresh the manifest fixtures under `tests/fixtures/`.
4. Regenerate `public/variable-catalog.json` in the hosted environment with
   `python frontend/scripts/generate_variable_catalog.py`. It builds the catalog from a
   simulation over the reviewed H5, verified by SHA-256 (`--dataset-file` reuses a
   local copy), never from the country package's default dataset, and records the
   release and package versions it used.
5. Qualify the deployment with the checks below.

## Automated production deployment

`.github/workflows/deploy.yml` runs after the `CI` workflow succeeds for a push to
`main`. It checks out the exact commit tested by CI and performs these operations in
order:

1. Deploy a commit-specific Modal application in the `main` Modal environment.
2. Resolve the deployed `web_app` URL and verify its authenticated metadata.
3. Build a production-targeted Vercel deployment with `--skip-domain`, using that Modal
   URL and the same source commit.
4. Verify the unaliased frontend metadata, then execute a real 2024 national threshold
   calculation followed by a California income-tax calculation. Promotion requires the
   reviewed package and data identities, verified H5 bytes, numeric results, and the
   expected national-to-state cache transition. If the connection closes, resets or
   times out before a response arrives, the check waits until the backend answers a
   metadata request (at most 860 seconds after the first request), then sends the
   calculation once more; the retried response must meet the same requirements. An HTTP
   error or a response that fails them is never retried, so a slow calculation still
   fails: the proxy answers HTTP 504 after waiting 780 seconds.
5. Promote the Vercel deployment and execute a California calculation through both
   `calibration-diagnostics.vercel.app` and the mounted `microcosm.institute` route.

The workflow names each backend `calibration-diagnostics-<12-character-commit>` so an
older frontend continues to reference its matching backend during rollback. Retain these
applications for the rollback window; remove them separately after they are no longer
referenced by a deployable frontend.

The workflow is fixed to Vercel project `calibration-diagnostics`
(`prj_pL7dIJJ3M4hGcKr5pttWaOACVFtu`) in the PolicyEngine team
(`team_xsyTmFLMLGbHH7Qxu70R5G4r`). `vercel.json` disables automatic Git deployment for
`main` only, so pull-request previews remain enabled. Do not relink the workflow to a
different project or remove `--skip-domain`; the frontend must not receive production
traffic before its paired backend passes the deployment checks.
Run the Vercel CLI from the repository root. The Vercel project already configures
`frontend` as its root directory, so setting the CLI working directory to `frontend`
would make Vercel look for a nonexistent `frontend/frontend` directory.

Configure these GitHub Actions secrets before merging the workflow:

- `MODAL_TOKEN_ID` and `MODAL_TOKEN_SECRET`: deployment credentials for the PolicyEngine
  Modal workspace and its `main` environment.
- `MICROCOSM_MODAL_KEY` and `MICROCOSM_MODAL_SECRET`: credentials accepted by the
  proxy-authenticated Modal function and passed to the Vercel server runtime.
- `VERCEL_TOKEN`: permission to deploy and promote the fixed PolicyEngine Vercel project.
- `VERCEL_AUTOMATION_BYPASS_SECRET`: permission for the workflow to call the protected,
  unaliased Vercel deployment during verification.
- `HF_RELEASE_READ_TOKEN`: a dedicated fine-grained Hugging Face read-only token scoped
  to the registered private release repositories and `policyengine/populace-us-staging`.
  Keep the publisher's separate `HF_TOKEN` secret unchanged.

Missing credentials stop the workflow before it creates a Modal application. The Vercel
project's existing production environment variables, including Blob credentials, remain
managed by Vercel; the workflow supplies the backend URL, proxy credentials, release read
token, and source commit for the candidate deployment.

## Preview deployment

Install the runtime lock into a separate environment, run the hosted Python tests and
`verify_hosted_runtime.py`, then run the frontend tests, typecheck and build. Commit the
reviewed source before building the Modal image: its deployment definition rejects dirty
backend/shared-runtime files and records the actual Git commit and tree digest.

Use the PolicyEngine Modal workspace and an explicit task-owned application name:

```bash
CALIBRATION_MODAL_APP_NAME=calibration-diagnostics-preview-REVIEW_ID \
  uv run --no-sync modal deploy backend/modal_app.py --env testing
```

The service reserves 16 GiB and sets the same hard limit, requests two CPU cores, and
serializes requests (`max_inputs=1`, one container). It scales to zero. Its working disk
holds the normal HF download; there is no Vercel RAM-backed HDF5 workaround. Observe the
actual deployed allocation and response resource measurements rather than assuming the
requested allocation is sufficient.
Under policyengine-us 1.764.6 the local SPM reference peaked at approximately 12 GB, and
an 8 GiB hosted allocation did not complete the calculation. Under .py 6.4.1
(policyengine-us 2.2.1, spm-calculator 1.0.0), a local national `spm_unit_spm_threshold`
calculation, then `ca_income_tax`, then the national threshold again, peaked at about
1 GB resident memory (macOS, 2026-10-16). Keep the 16 GiB allocation until a hosted
measurement under the new tuple is recorded. The required checks below must still pass.
The service loads only the reviewed 2024 input. It validates the native dataset year and
wraps that `USSingleYearDataset` in a one-entry `USMultiYearDataset` before constructing
the simulation. This compatibility step prevents the pinned country package from
automatically allocating copies for later economic-assumption years: policyengine-us
2.2.1's `Microsimulation` still extends a single-year dataset through every
economic-assumption year and does not let the caller set the end year. Remove the
wrapper only after upgrading to a country-package version that does, and qualify that
upgrade with the same calculation checks.
Only one native simulation stays resident: changing between national and state scopes
evicts the preceding simulation before loading the next input tables. Same-scope requests
can reuse it; mixed variable lists may rebuild when their scopes change.

Create a dedicated Modal proxy token using `modal workspace proxy-tokens` (Modal 1.5.5
or later). Store its ID and secret through `agent-secret`; do not print or put them in
source. Where the workspace supports RBAC, allow only the intended Modal environment.
Otherwise the token has workspace-wide proxy scope: keep it server-only and delete the
task token after qualification. Set these **server-only** Vercel preview variables:

- `MICROCOSM_CALCULATION_URL`: the actual returned Modal app URL.
- `MICROCOSM_MODAL_KEY` and `MICROCOSM_MODAL_SECRET`: proxy credentials.

The Next deployment's `VERCEL_GIT_COMMIT_SHA` must match the backend's packaged commit.
For local development against a remote backend, set `MICROCOSM_BACKEND_SOURCE_COMMIT`
explicitly. Without a remote URL, local calculations still use the shared Python CLI.

## Required calculation checks

1. Verify direct authenticated backend metadata and both native-compatible and mounted
   Next metadata routes return JSON 200 with the expected source, model and configuration.
   With a nonempty base path, the former root `/api/microcosm_variable` URL first returns
   a same-origin 307 to the mounted Next route; preserve that redirect in the receipt.
   Metadata is not proof that data loaded or a calculation succeeded. It does now refuse a
   conflicting deployment data selection: the backend validates its resolved
   `POPULACE_HF_REPO`/`POPULACE_HF_REVISION` against the reviewed release and answers 503,
   and the proxy compares the response's `environment_configuration` with the reviewed
   selection and answers 409. A 200 metadata receipt therefore also records that this
   deployment is not carrying a stale override.
2. On a fresh backend deployment, run a genuine `spm_unit_spm_threshold` lookup for 2024
   on the pinned release through the exact Next preview. Require JSON 200, verified
   H5 SHA-256, exact model/source identity, `execution.simulation_cache_hits.national=false`
   and a non-null weighted result. Require comparison with a separately executed reference
   using the identical source, package tuple and immutable H5. An older Core version's
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
   and comparison with the same-tuple local reference. Exercise the reverse transition
   or a mixed-scope request as well; national-only success does not qualify state lookup.

## Promotion and rollback

Obtain independent review and passing CI on the exact candidate.
`frontend/vercel.json` prevents Vercel's Git integration from deploying `main`; the
backend-first GitHub workflow is the only production deployment path. Keep the project
setting `autoAssignCustomDomains=false` as an additional protection against unintended
domain assignment, and read it back when changing deployment configuration.
Inspect the production-scoped environment entries before the build and require
`POPULACE_HF_REPO` and `POPULACE_HF_REVISION` to be absent for the variable-calculation
service. Its US data selection is compiled from the reviewed release, and a conflicting
runtime override is refused by that service. Dashboard release discovery is independent:
it follows the registered repository's `main` branch through the dashboard manifest.
If either variable is present, record and remove only those two conflicting calculation
overrides, with their prior settings retained for rollback. This specific check also
applies to preview qualification. Do not print or change unrelated environment entries.

The production workflow deploys the matching private backend, stages the exact frontend
with production server-only URL and credentials, verifies metadata and a genuine
calculation, and only then runs `vercel promote`. After promotion, it checks a genuine
calculation through `calibration-diagnostics.vercel.app` and the
`microcosm.institute/calibration/dashboard` mount. A failure before promotion leaves the
existing production aliases unchanged. A failure after promotion must be handled with
the rollback procedure below.

The workflow requires the dedicated Actions `HF_RELEASE_READ_TOKEN` secret and passes it
to the candidate as server-only runtime `HF_TOKEN`. Use a fine-grained read-only credential
scoped to every registered private release repository and US staging; never reuse the
publisher's write credential for the dashboard. UK staging retains its
separate `POPULACE_UK_STAGING_HF_TOKEN` deployment configuration. Before
promotion, `frontend/scripts/calibration-deployment-smoke.ts` checks each
registered country's calibration summary and release inventory, and every
supported staging inventory. It requires available calibration targets, a
consistent selected release, and staging `available: true`; an HTTP 200 alone
does not qualify staging. The same check runs against the public dashboard
after promotion. Public US calculations alone do not qualify private release
access. The script imports the `@policyengine/calibration-tree` workspace
package, so the workflow runs `bun install --frozen-lockfile --ignore-scripts`
in `frontend` before the first check. It installs after the Vercel upload,
which sends the repository root, so the uploaded files never include
`node_modules`. Lifecycle scripts are skipped because the job holds Google
Cloud credentials and can request GitHub OIDC tokens. Both checks run
`bun run --no-install`, so Bun never installs a missing package from npm by
itself; without the workspace install, a check fails.

Calibration qualification retries network failures and HTTP 5xx twice, with short
increasing backoff and a 60-second timeout per attempt. HTTP 4xx, malformed successful
responses, and unavailable or inconsistent data fail immediately. If the post-promotion
check fails, the workflow reports failure while production aliases already point at the
candidate. The release owner must follow the rollback procedure below and run
`vercel rollback PREVIOUS_DEPLOYMENT`; the workflow does not roll back automatically.

The public `calibration-diagnostics.vercel.app` domain is also the stable Hugging Face
webhook origin. Do not point the webhook at a staged deployment URL or the protected
`calibration-diagnostics-policy-engine.vercel.app` alias.

Vercel now hosts only Next.js; the previous large-Python-function flag and Performance
memory change are not prerequisites. Remove the obsolete preview-only large-function
exception once the migration is qualified. Do not change other project environment
entries. Production settings and aliases are release-owner actions, never implied by a
successful preview build.

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
