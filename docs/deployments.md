# Deployments

The Deployments page (`/microcosm/deployments`) answers one question for each
country: which model and which Microcosm data build does each PolicyEngine
surface use?

## How a surface maps to a data build

1. The surface's dependency lock pins `policyengine` (.py).
2. That .py tag carries a bundle manifest,
   `src/policyengine/data/bundle/manifest.json`. Its `data_releases.<country>`
   entry names one certified data build and the country-model version it is
   certified for.
3. The data build ID is a release ID on this dashboard, so the page links to
   its calibration fit.

The latest .py version comes from PyPI. Its bundle manifest is the reference
for the status column.

## Surfaces

The registry is `DEPLOYMENT_SURFACES` in
`frontend/lib/microcosm/deployments.ts`. Each entry names a repository, its
default branch and its lock file (`uv.lock`, or a pip-compile lock). A surface
that pins no Python packages names the surface it calls with `via`: app v3
(`policyengine-app-v2`) calls `api.policyengine.org`. A surface that installs
only some country extras lists them in `countries`. To add a surface, add one
entry.

## Status

| Status | Meaning |
|---|---|
| Latest data | The surface's .py certifies the same data build as the latest .py. |
| Older data | The surface's .py certifies an older data build. |
| Model mismatch | The lock pins a country-model version that differs from the one the bundle certifies the data for. |
| No certified data | The pinned .py is older than bundle manifests, so it certifies no data build. |
| No .py | The lock pins the country model without .py. The data comes from the country package's own default. |
| No dataset | The surface calculates single households and loads no microdata (the household API), so no data build applies. |
| Country not in bundle | The pinned .py certifies no build for this country. |
| Lock unavailable | The lock file or the bundle manifest could not be read. |

## Limits

- The page shows **declared** versions: the lock on the default branch. A
  service can run an older deploy. To show the served version, each service
  must report its .py version and data build ID at runtime (for example in
  `/metadata`), and this page must read that report.
- The route caches results for 15 minutes. It reads public files from
  `raw.githubusercontent.com` and PyPI and needs no credentials.
