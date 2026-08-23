# Claude Code guidance

- When investigating a discrepant Microcosm calibration target, follow [the shared investigation workflow](docs/ai/workflows/investigate-microcosm-target.md) and its linked role-specific reviews.
- Before starting the application for Cross-dataset work, configure exactly one DIR or URL artifact location for each country you will use, as described in [the Cross-dataset application configuration](docs/cross-dataset-api.md#configure-the-application).
- Adding a Microcosm country is one entry in `frontend/lib/microcosm/countries.ts`; pages are gated by the registration's capabilities and the release artifact's `country` block, never by country code (see [the spec-driven countries note](docs/spec-driven-countries.md)).
