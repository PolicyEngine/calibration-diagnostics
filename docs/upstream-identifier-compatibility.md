# Upstream identifier compatibility

Microcosm and Chronicle are the product names used by this repository. Some
machine-readable interfaces owned by those upstream projects still use the
former `populace` and `ledger` names. Those literals are deprecated, but they
must remain exact until the producer publishes and documents a replacement.

Verified against the current upstream repositories and published artifacts on
2026-08-12:

| Owner | Current product name | Deprecated identifier retained here | Where it is consumed |
|---|---|---|---|
| Microcosm | `PolicyEngine/microcosm`, `microcosm.*` Python packages | `policyengine/populace-us`, `policyengine/populace-uk-private`, `policyengine/populace-us-staging` | Hugging Face dataset and staging reads |
| Microcosm | Microcosm releases | `populace-us-*`, `populace_us_2024.h5`, `populace_uk_2023.h5` | Release IDs and dataset filenames |
| Microcosm | Historical pinned release manifests | `PolicyEngine/populace`, `populace-build`, `populace-data` | Immutable build provenance recorded before the repository/package rename |
| Microcosm | Microcosm/dashboard configuration | `POPULACE_HF_*`, `POPULACE_STAGING_HF_*`, `POPULACE_STAGING_REPO_ID`, `SLACK_WEBHOOK_POPULACE_*` | Deployment and build environment variables |
| Microcosm | Chronicle-backed calibration metadata | `ledger_*` | `calibration_diagnostics.json` metadata fields |
| Microcosm | Historical pinned calibration provenance | `ledger_artifact`, `policyengine-ledger-data`, `arch.*` fact keys, `arch-us` authorities | Immutable values recorded in the current published US release |
| Chronicle | `PolicyEngine/chronicle`, `policyengine_chronicle`, `chronicle` CLI | `ledger.consumer_fact.v1`, `policyengine_ledger.*`, `ledger.*` fact-key namespaces | Consumer exports and resolved-target contracts |
| Chronicle | Chronicle object storage | `ledger-raw`, `ledger-derived` | Source lineage bucket names and URIs |
| Chronicle | Legacy Chronicle consumer manifests | `ledger_commit`, `ledger_release` | Optional backwards-compatible manifest fields; current exports omit them |
| Evaluation bundle v1 | Chronicle/Microcosm labels | `ledger_source`, `populace_calibration_sample`, `populace_us_policyengine_us_2024` | Immutable artifact fields consumed by the dashboard |

Internal modules, routes, types, labels, commands, and integration names remain
Microcosm/Chronicle. Remove a deprecated literal above only after its upstream
owner migrates the relevant contract and this repository has a compatibility
test for the replacement.
