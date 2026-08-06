"""Execute the public-CPS adapter's ten reviewed Ledger verification facts."""

from __future__ import annotations

import json
import math
from decimal import Decimal
from pathlib import Path

from evaluation_harness.adapters.taxcalc_cps import TaxCalcCPSRunner
from evaluation_harness.execution import build_run_groups, execute_groups
from evaluation_harness.integration import load_integration_overview
from evaluation_harness.mappings import MappingRegistry
from evaluation_harness.planner import CapabilityPlanner


ROOT = Path(__file__).resolve().parents[1]
INTEGRATION = ROOT / "integrations" / "taxcalc_cps"


def verify() -> list[dict[str, str | float]]:
    overview = load_integration_overview(INTEGRATION / "overview.yaml")
    mappings = MappingRegistry.from_yaml(INTEGRATION / "mappings.yaml")
    capabilities = tuple(
        CapabilityPlanner(mappings, snapshot_id=overview.ledger_snapshot_id).classify(
            fact, overview.source
        )
        for fact in overview.verification_facts
    )
    unavailable = [cell for cell in capabilities if not cell.score_eligible or cell.query is None]
    if unavailable:
        raise RuntimeError(
            "verification facts must all be executable and score eligible: "
            + ", ".join(f"{cell.fact_key} ({cell.reason_code})" for cell in unavailable)
        )
    results = execute_groups(
        build_run_groups(capabilities),
        capabilities,
        {overview.source.source_id: TaxCalcCPSRunner()},
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
                "ledger_target": str(target),
                "relative_error": float(relative_error),
            }
        )
    if len(rows) != 10:
        raise RuntimeError(f"expected ten numerical results, found {len(rows)}")
    return rows


if __name__ == "__main__":
    print(json.dumps(verify(), indent=2))
