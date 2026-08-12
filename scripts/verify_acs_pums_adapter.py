"""Execute raw ACS PUMS against ten reviewed, directly testable Chronicle facts."""

from __future__ import annotations

import argparse
import json
import math
from decimal import Decimal
from pathlib import Path

from evaluation_harness.adapters.acs_pums import ACSPUMSRunner, execute_acs_pums
from evaluation_harness.execution import build_run_groups
from evaluation_harness.integration import load_integration_overview
from evaluation_harness.mappings import MappingRegistry
from evaluation_harness.planner import CapabilityPlanner


ROOT = Path(__file__).resolve().parents[1]
INTEGRATION = ROOT / "integrations" / "census_acs_pums"


def verify(aggregate_path: Path) -> dict[str, object]:
    overview = load_integration_overview(INTEGRATION / "overview.yaml")
    mappings = MappingRegistry.from_yaml(INTEGRATION / "mappings.yaml")
    capabilities = tuple(
        CapabilityPlanner(
            mappings, snapshot_id=overview.chronicle_snapshot_id
        ).classify(fact, overview.source)
        for fact in overview.verification_facts
    )
    unavailable = [
        cell for cell in capabilities if not cell.score_eligible or cell.query is None
    ]
    if unavailable:
        raise RuntimeError(
            "verification facts must all be executable and score eligible: "
            + ", ".join(
                f"{cell.fact_key} ({cell.reason_code})" for cell in unavailable
            )
        )

    runner = ACSPUMSRunner(aggregate_path)
    results = execute_acs_pums(
        build_run_groups(capabilities), capabilities, runner
    )
    facts = {fact.fact_key: fact for fact in overview.verification_facts}
    rows: list[dict[str, str]] = []
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
                "relative_error": str(relative_error),
                "standard_error": str(result.standard_error),
                "margin_of_error_90": str(result.margin_of_error_90),
                "execution_method": result.execution_method,
                "period_treatment": result.period_treatment,
            }
        )
    if len(rows) != 10:
        raise RuntimeError(f"expected ten numerical results, found {len(rows)}")
    return {
        "schema_version": "evaluation_harness.verification_results.v1",
        "source_id": overview.source.source_id,
        "chronicle_snapshot_id": overview.chronicle_snapshot_id,
        "dataset_version": overview.source.dataset_version,
        "input_manifest": runner.input_manifest,
        "rows": rows,
    }


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--aggregates", required=True, type=Path)
    arguments = parser.parse_args()
    print(json.dumps(verify(arguments.aggregates), indent=2, sort_keys=True))


if __name__ == "__main__":
    main()
