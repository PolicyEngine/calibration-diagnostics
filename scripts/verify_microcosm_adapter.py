"""Execute the Microcosm adapter's ten reviewed Chronicle verification facts."""

from __future__ import annotations

import argparse
import json
import math
from decimal import Decimal
from pathlib import Path

from evaluation_harness.adapters.microcosm import (
    MICROCOSM_RELEASE,
    MicrocosmPolicyEngineRunner,
    verify_release_dataset,
)
from evaluation_harness.execution import build_run_groups, execute_groups
from evaluation_harness.integration import load_integration_overview
from evaluation_harness.mappings import MappingRegistry
from evaluation_harness.planner import CapabilityPlanner


ROOT = Path(__file__).resolve().parents[1]
INTEGRATION = ROOT / "integrations" / "microcosm_policyengine_us"


def verify(dataset_path: Path) -> list[dict[str, str | float]]:
    dataset_path = verify_release_dataset(dataset_path, MICROCOSM_RELEASE)
    overview = load_integration_overview(INTEGRATION / "overview.yaml")
    mappings = MappingRegistry.from_yaml(INTEGRATION / "mappings.yaml")
    planner = CapabilityPlanner(mappings, snapshot_id=overview.chronicle_snapshot_id)
    capabilities = tuple(planner.classify(fact, overview.source) for fact in overview.verification_facts)
    unavailable = [cell for cell in capabilities if not cell.score_eligible or cell.query is None]
    if unavailable:
        raise RuntimeError(
            "verification facts must all be executable and score eligible: "
            + ", ".join(f"{cell.fact_key} ({cell.reason_code})" for cell in unavailable)
        )
    runner = MicrocosmPolicyEngineRunner(dataset_path=dataset_path)
    results = execute_groups(
        build_run_groups(capabilities),
        capabilities,
        {overview.source.source_id: runner},
    )
    facts = {fact.fact_key: fact for fact in overview.verification_facts}
    rows: list[dict[str, str | float]] = []
    for result in results:
        target = facts[result.fact_key].value
        if not math.isfinite(float(result.estimate)):
            raise RuntimeError(f"non-finite estimate for {result.fact_key}")
        relative_error = (
            abs(result.estimate - target) / abs(target)
            if target
            else Decimal(0) if result.estimate == 0 else Decimal("Infinity")
        )
        rows.append(
            {
                "fact_key": result.fact_key,
                "estimate": str(result.estimate),
                "chronicle_target": str(target),
                "relative_error": float(relative_error),
            }
        )
    if len(rows) != 10:
        raise RuntimeError(f"expected ten numerical results, found {len(rows)}")
    return rows


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("dataset", type=Path)
    arguments = parser.parse_args()
    print(json.dumps(verify(arguments.dataset), indent=2))


if __name__ == "__main__":
    main()
