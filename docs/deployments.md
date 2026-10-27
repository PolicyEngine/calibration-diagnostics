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

## Served versions

A merged change that is not deployed does not serve anyone. The Served column
compares the lock with what the running service reports:

| Service | Report | What it gives |
|---|---|---|
| PolicyEngine API (and app v3, which calls it) | `GET https://api.policyengine.org/v2/tax-benefit-models/by-country/{country}` | The served .py. The data build is the one that .py's bundle certifies, shown as "via served .py". |
| Simulation API | `GET https://policyengine--policyengine-simulation-gateway-web-app.modal.run/versions` | The `latest` .py route, and the model and data build of that route's bundle. |

The API's `/{country}/metadata` also reports `data_version`, but the US
response is about 75 MB and the server does not support range requests, so
the page does not read it.

| Served status | Meaning |
|---|---|
| Deployed | The served .py, model and data build equal the declared ones. |
| Not deployed | At least one served value differs from the lock. The page header counts these rows. |
| Report unavailable | The service report could not be read. |
| Not reported | The service reports no versions at runtime (household API, API v2 alpha, this dashboard's runtime). Only the lock is known. |

The simulation gateway also keeps older .py versions routable for callers that
ask for them by version. The page compares only its `latest` route.

## Limits

- For services that report no versions, the page shows only the declared
  versions, and a service can run an older deploy.
- The route caches results for 15 minutes. It reads public files from
  `raw.githubusercontent.com`, PyPI and the two service reports, and needs no
  credentials.
