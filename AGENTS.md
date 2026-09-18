# AI assistant guidance

- When an AI assistant launches the dashboard, it must pass the applicable Hugging Face staging read token into the development server process. This is required for every local preview, not an optional configuration step.
  - For US staging, pass `HF_TOKEN` or `HUGGINGFACE_TOKEN` with read access to `policyengine/populace-us-staging`.
  - For UK staging, pass `POPULACE_UK_STAGING_HF_TOKEN` with read access to `policyengine/populace-uk-staging`.
  - Load the credential from the approved secret source and pass it in the same command environment that starts `make dev` or `bun run dev`. Never print or commit its value.
  - Before providing a Staging preview URL, request `/api/microcosm/staging/runs` for the selected country and confirm that the JSON response reports the repository as available. Checking only the HTTP status is insufficient because the route can return HTTP 200 with `available: false`. Treat 401, 403, the 404 response Hugging Face may return for an unauthorized private repository, and any `available: false` response as a failed launch.
- When investigating a discrepant Microcosm calibration target, follow [the shared investigation workflow](docs/ai/workflows/investigate-microcosm-target.md) and its linked role-specific reviews.
- Before starting the application for Cross-dataset work, configure exactly one DIR or URL artifact location for each country you will use, as described in [the Cross-dataset application configuration](docs/cross-dataset-api.md#configure-the-application).
- Adding a Microcosm country is one entry in `frontend/lib/microcosm/countries.ts`; pages are gated by the registration's capabilities and the release artifact's `country` block, never by country code (see [the spec-driven countries note](docs/spec-driven-countries.md)).
