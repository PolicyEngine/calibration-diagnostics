from pathlib import Path

from evaluation_harness.contracts import CapabilityStatus, PeriodTreatment
from evaluation_harness.integration import load_integration_overview, validate_overview_against_snapshot
from evaluation_harness.mappings import MappingRegistry
from evaluation_harness.planner import CapabilityPlanner


ROOT = Path(__file__).parents[1]
INTEGRATION = ROOT / "integrations" / "taxcalc_tmd"


def test_tmd_overview_pins_dataset_constructor_and_model() -> None:
    overview = load_integration_overview(INTEGRATION / "overview.yaml")
    assert overview.source.source_id == "taxcalc_tmd_2024"
    assert overview.source.dataset_version == "tax-microdata-benchmarking==2.1.3"
    assert overview.source.model_version == "taxcalc==6.7.1"
    assert overview.source.entities == frozenset({"tax_unit"})


def test_tmd_has_ten_directly_testable_ledger_facts() -> None:
    overview = load_integration_overview(INTEGRATION / "overview.yaml")
    assert len(overview.verification_facts) == 10
    assert len({fact.measure for fact in overview.verification_facts}) == 10
    assert {fact.unit for fact in overview.verification_facts} == {"count", "usd"}
    assert all(fact.value.is_finite() for fact in overview.verification_facts)


def test_all_ten_tmd_facts_are_executable_advanced_results() -> None:
    overview = load_integration_overview(INTEGRATION / "overview.yaml")
    mappings = MappingRegistry.from_yaml(INTEGRATION / "mappings.yaml")
    results = CapabilityPlanner(mappings, snapshot_id=overview.ledger_snapshot_id).classify_all(
        overview.verification_facts, [overview.source]
    )
    assert len(results) == 10
    assert all(result.status in {CapabilityStatus.MODEL, CapabilityStatus.DIRECT} for result in results)
    assert all(result.query is not None and result.score_eligible for result in results)
    assert all(result.period_treatment is PeriodTreatment.ADVANCED_POPULATION for result in results)


def test_tmd_facts_match_committed_snapshot_fixture() -> None:
    overview = load_integration_overview(INTEGRATION / "overview.yaml")
    validate_overview_against_snapshot(overview, INTEGRATION / "ledger_snapshot_fixture")
