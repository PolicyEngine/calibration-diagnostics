from dataclasses import replace
from pathlib import Path

from evaluation_harness.contracts import (
    CalibrationExposure,
    CapabilityStatus,
    TypedPeriod,
)
from evaluation_harness.integration import (
    load_integration_overview,
    validate_overview_against_snapshot,
)
from evaluation_harness.mappings import MappingRegistry
from evaluation_harness.planner import CapabilityPlanner


ROOT = Path(__file__).parents[1]
INTEGRATION = ROOT / "integrations" / "populace_policyengine_us"


def test_populace_overview_pins_current_dataset_and_model() -> None:
    overview = load_integration_overview(INTEGRATION / "overview.yaml")
    assert overview.source.source_id == "populace_us_policyengine_us_2024"
    assert overview.source.dataset_version.endswith("20260728T011454Z")
    assert overview.source.model_version == "policyengine-us==1.764.6"
    assert overview.ledger_snapshot_id == "ledger-7917ea815df710fb20db076b"
    assert overview.alignment_policy == {
        "model_id": "cbo_growth_factor_aging",
        "model_version": "1.2.0",
        "populace_commit": "cae8640f9e65e274aea65c7916cb37b956978e32",
        "source_module": (
            "packages/populace-build/src/populace/build/us_runtime/target_aging.py"
        ),
        "source_years": [2023],
        "build_year": 2024,
        "evaluate_transformed_facts": True,
        "display_observed_and_transformed_values": True,
    }


def test_populace_overview_has_ten_real_numeric_verification_facts() -> None:
    overview = load_integration_overview(INTEGRATION / "overview.yaml")
    assert len(overview.verification_facts) == 10
    assert len({fact.fact_key for fact in overview.verification_facts}) == 10
    assert len({fact.measure for fact in overview.verification_facts}) >= 3
    assert {fact.unit for fact in overview.verification_facts} >= {"count", "usd"}
    assert all(fact.value.is_finite() for fact in overview.verification_facts)


def test_all_ten_populace_facts_are_executable_not_na() -> None:
    overview = load_integration_overview(INTEGRATION / "overview.yaml")
    mappings = MappingRegistry.from_yaml(INTEGRATION / "mappings.yaml")
    results = CapabilityPlanner(
        mappings,
        snapshot_id=overview.ledger_snapshot_id,
    ).classify_all(overview.verification_facts, [overview.source])
    assert len(results) == 10
    assert all(
        result.status
        in {
            CapabilityStatus.DIRECT,
            CapabilityStatus.MODEL,
            CapabilityStatus.CALIBRATION_TARGET,
        }
        for result in results
    )
    assert all(result.query is not None for result in results)


def test_populace_overview_distinguishes_calibration_targets_from_holdouts() -> None:
    overview = load_integration_overview(INTEGRATION / "overview.yaml")
    mappings = MappingRegistry.from_yaml(INTEGRATION / "mappings.yaml")
    results = CapabilityPlanner(mappings).classify_all(
        overview.verification_facts, [overview.source]
    )
    assert sum(
        result.calibration_exposure
        is CalibrationExposure.DIRECT_CALIBRATION_TARGET
        for result in results
    ) == 6
    assert sum(
        result.calibration_exposure is CalibrationExposure.EXTERNAL_VALIDATION
        for result in results
    ) == 4


def test_populace_overview_does_not_claim_native_2023_population() -> None:
    overview = load_integration_overview(INTEGRATION / "overview.yaml")
    mappings = MappingRegistry.from_yaml(INTEGRATION / "mappings.yaml")
    old_fact = replace(
        overview.verification_facts[0],
        fact_key="ledger.aggregate_fact.v2:000000000000000000000000",
        period=TypedPeriod.parse("calendar_year:2023"),
    )
    result = CapabilityPlanner(mappings).classify(old_fact, overview.source)
    assert result.status is CapabilityStatus.UNSUPPORTED_PERIOD


def test_populace_verification_facts_match_committed_snapshot_fixture() -> None:
    overview = load_integration_overview(INTEGRATION / "overview.yaml")
    validate_overview_against_snapshot(
        overview,
        INTEGRATION / "ledger_snapshot_fixture",
    )
