# Hosted variable runtime

The variable endpoint uses the reviewed legacy tuple in `requirements.txt` and
`scripts/hosted_release.json`. Upgrade the country model, Core, SPM, and data
certificate together. The root evaluation lock is a separate frozen environment.

Vercel must install these requirements at build time. `pyproject.toml` defines a
Python install hook that verifies the installed dependencies and imported APIs
without downloading or opening population data. The exact install removes packages
left over from a restored build cache. A custom install prevents the
Python builder from deferring country-wheel installation until cold start. The
ordinary optimized bundle exhausted `/tmp` before the handler could start.

Enable `VERCEL_SUPPORT_LARGE_FUNCTIONS=1` for the deployment build. Test with a
preview-only build environment first, for example `vercel deploy --build-env
VERCEL_SUPPORT_LARGE_FUNCTIONS=1`; do not use `--prod` for qualification. This
requires the existing Fluid compute setting. Keep the full reviewed dependencies
in the function; do not remove model files or loosen package pins to reduce size.

Before promoting this source:

1. Verify the build ran the install hook and packaged the dependencies, rather
   than enabling runtime dependency installation.
2. Request `/api/microcosm_variable?metadata=1` and
   `/calibration/dashboard/api/microcosm_variable?metadata=1` on the exact preview.
   Require JSON HTTP 200, the deployed source commit, the reviewed package tuple,
   and matching data/environment configuration. Metadata alone does not certify
   that population data loaded or that calculation results are correct.
3. Require unsupported years/releases to return HTTP 409 on the mounted
   `/api/microcosm/variable` route before any calculation starts.
4. Obtain source review and passing CI. Carry the large-function build setting
   into the reviewed production deployment, then repeat both metadata readbacks
   through the calibration and Microcosm production aliases.

Keep the previous deployment ID and its build settings in the release receipt.
For rollback, restore that exact deployment and its settings; removing the
large-function setting alone does not rebuild an existing function. A preview
created with `--build-env` does not change production project settings. Do not
claim rollback restores a working variable endpoint if the previous deployment
already failed its startup check.
