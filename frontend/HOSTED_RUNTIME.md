# Hosted variable runtime

The Next.js dashboard proxies variable requests to a private Modal service. The service
executes `scripts/microcosm_variable_core.py`, also used by the local command-line tool,
and verifies the reviewed model tuple, both release manifests, and the H5 bytes before
constructing a native PolicyEngine microsimulation. Weighted results use MicroSeries.
The root evaluation environment and its recorded outputs remain separate.

The runtime uses Python 3.12 and the hashed `../backend/requirements.lock`. Regenerate
that lock with `uv pip compile backend/requirements.txt --python-version 3.12
--generate-hashes --output-file backend/requirements.lock` from the repository root.
Upgrade the country model, Core, SPM and `scripts/hosted_release.json` together.

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

The service reserves 8 GiB and sets the same hard limit, requests two CPU cores, and
serializes requests (`max_inputs=1`, one container). It scales to zero. Its working disk
holds the normal HF download; there is no Vercel RAM-backed HDF5 workaround. Observe the
actual deployed allocation and response resource measurements rather than assuming the
requested allocation is sufficient.

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

## Required calculation gate

1. Verify direct authenticated backend metadata and both native-compatible and mounted
   Next metadata routes return JSON 200 with the expected source, model and configuration.
   With a nonempty base path, the former root `/api/microcosm_variable` URL first returns
   a same-origin 307 to the mounted Next route; preserve that redirect in the receipt.
   Metadata is not proof that data loaded or a calculation succeeded.
2. On a fresh backend deployment, run a genuine `spm_unit_spm_threshold` lookup for 2024
   on the pinned BuildP release through the exact Next preview. Require JSON 200, verified
   H5 SHA-256, exact model/source identity, `execution.simulation_cache_hits.national=false`
   and a non-null weighted result. Compare with an independently qualified identical
   runtime when available; state explicitly if no exact-tuple oracle exists.
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

## Promotion and rollback

Obtain independent review, Fable agreement and passing CI on the exact candidate. Before
merging main, disable automatic domain assignment for the real Vercel production branch
(the supported project setting is `autoAssignCustomDomains=false`) and read it back.
Record all current production alias targets. This hold must precede main's automatic Git
build; setting it after the merge is too late.

Build/deploy the matching private production backend, then stage the exact frontend
with production server-only URL/credentials. Use `vercel deploy --prod --skip-domain`
for a CLI production build; do not omit the hold for the automatic Git build. Confirm
that every production alias still targets its recorded prior deployment. Verify the
staged deployment's metadata and a genuine calculation before `vercel promote DEPLOYMENT`.
After promotion, repeat both through `calibration-diagnostics.vercel.app` and the
`microcosm.institute/calibration/dashboard` mount. Retain manual promotion for future
paired model/backend/frontend releases, or replace it with an equivalent tested gate.

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
