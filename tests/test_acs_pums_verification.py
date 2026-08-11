import json
import math
from pathlib import Path

from evaluation_harness.integration import load_integration_overview


ROOT = Path(__file__).parents[1]
INTEGRATION = ROOT / "integrations" / "census_acs_pums"


def test_acs_pums_checkpoint_contains_ten_real_numerical_results() -> None:
    overview = load_integration_overview(INTEGRATION / "overview.yaml")
    payload = json.loads((INTEGRATION / "verification_results.json").read_text())
    rows = payload["rows"]

    assert payload["schema_version"] == "evaluation_harness.verification_results.v1"
    assert payload["source_id"] == overview.source.source_id
    assert payload["ledger_snapshot_id"] == overview.ledger_snapshot_id
    assert (
        payload["input_manifest"]["schema_version"]
        == "evaluation_harness.acs_pums_aggregate.v2"
    )
    assert "WAGP" in payload["input_manifest"]["additive_statistics"]
    assert {row["fact_key"] for row in rows} == {
        fact.fact_key for fact in overview.verification_facts
    }
    assert len(rows) == 10
    assert all(math.isfinite(float(row["estimate"])) for row in rows)
    assert all(math.isfinite(float(row["relative_error"])) for row in rows)
    assert all(float(row["standard_error"]) >= 0 for row in rows)
    assert all(float(row["margin_of_error_90"]) >= 0 for row in rows)
    assert all(row["execution_method"] == "direct" for row in rows)
    assert all(row["period_treatment"] == "native" for row in rows)
