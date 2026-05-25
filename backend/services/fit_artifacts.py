"""Local mirror of `policyengine_us_data.fit_weights.artifacts`.

Mirrored from upstream policyengine-us-data PRs #1043 / #1046 (merged
2026-05-21), which centralized Stage 3 artifact filenames into a typed
catalog. Those changes aren't in PyPI 1.115.4 yet; the moment the team
cuts a release that includes the `fit_weights` module, drop this file and
swap callers to:

    from policyengine_us_data.fit_weights.artifacts import (
        fit_artifacts_for_scope,
    )

Two scopes are published per Stage 3 fit:

- **regional** — district / state-level fits. Filenames have no prefix.
- **national** — single national-scope fit. Filenames are `national_*`.

Previously our loader only knew the regional names; a national run would
silently miss its diagnostics. The catalog makes the scope explicit.
"""

from __future__ import annotations

from dataclasses import dataclass

REGIONAL_SCOPE = "regional"
NATIONAL_SCOPE = "national"
SCOPES = (REGIONAL_SCOPE, NATIONAL_SCOPE)


@dataclass(frozen=True)
class ScopedArtifacts:
    scope: str
    weights: str
    geography: str
    run_config: str
    diagnostics: str
    epoch_log: str

    def as_dict(self) -> dict[str, str]:
        return {
            "weights": self.weights,
            "geography": self.geography,
            "run_config": self.run_config,
            "diagnostics": self.diagnostics,
            "epoch_log": self.epoch_log,
        }


REGIONAL_ARTIFACTS = ScopedArtifacts(
    scope=REGIONAL_SCOPE,
    weights="calibration_weights.npy",
    geography="geography_assignment.npz",
    run_config="unified_run_config.json",
    diagnostics="unified_diagnostics.csv",
    epoch_log="calibration_log.csv",
)

NATIONAL_ARTIFACTS = ScopedArtifacts(
    scope=NATIONAL_SCOPE,
    weights="national_calibration_weights.npy",
    geography="national_geography_assignment.npz",
    run_config="national_unified_run_config.json",
    diagnostics="national_unified_diagnostics.csv",
    epoch_log="national_calibration_log.csv",
)


def artifacts_for_scope(scope: str) -> ScopedArtifacts:
    if scope == REGIONAL_SCOPE:
        return REGIONAL_ARTIFACTS
    if scope == NATIONAL_SCOPE:
        return NATIONAL_ARTIFACTS
    raise ValueError(f"Unknown fit scope: {scope!r}")
