from dataclasses import replace
from pathlib import Path

from evaluation_harness.contracts import (
    CalibrationExposure,
    CapabilityStatus,
    ExecutionMethod,
    PeriodTreatment,
    SourceType,
    TypedPeriod,
)
from evaluation_harness.integration import (
    load_integration_overview,
    validate_overview_against_snapshot,
)
from evaluation_harness.frontend_bundle import DEFAULT_SOURCE_LABELS
from evaluation_harness.mappings import MappingRegistry
from evaluation_harness.planner import CapabilityPlanner


ROOT = Path(__file__).parents[1]
INTEGRATION = ROOT / "integrations" / "census_acs_pums"


def test_acs_pums_overview_pins_a_standalone_native_2024_dataset() -> None:
    overview = load_integration_overview(INTEGRATION / "overview.yaml")

    assert overview.source.source_id == "census_acs_pums_2024"
    assert overview.source.source_type is SourceType.AGGREGATE_DATASET
    assert overview.source.dataset_version == "census-acs-pums-2024-1y-person@2025-09-17"
    assert overview.source.model_version is None
    assert overview.source.population_period == TypedPeriod("calendar_year", "2024")
    assert overview.source.policy_period is None
    assert overview.source.native_fact_periods == frozenset({"calendar_year:2024"})
    assert overview.source.advanced_fact_periods == frozenset()
    assert overview.source.geographies == frozenset({"country", "state"})
    assert overview.source.entities == frozenset({"person"})
    assert overview.source.weights == {"person": "PWGTP"}
    assert DEFAULT_SOURCE_LABELS[overview.source.source_id] == "Raw ACS PUMS"


def test_acs_pums_has_ten_real_national_and_state_verification_facts() -> None:
    overview = load_integration_overview(INTEGRATION / "overview.yaml")

    assert len(overview.verification_facts) == 10
    assert len({fact.fact_key for fact in overview.verification_facts}) == 10
    assert {fact.source for fact in overview.verification_facts} == {"census_acs"}
    assert {fact.measure for fact in overview.verification_facts} == {
        "census_acs.person_count"
    }
    assert {fact.entity for fact in overview.verification_facts} == {"person"}
    assert {fact.unit for fact in overview.verification_facts} == {"count"}
    assert {fact.geography_level for fact in overview.verification_facts} == {
        "country",
        "state",
    }
    assert sum(fact.geography_level == "country" for fact in overview.verification_facts) == 5
    assert sum(fact.geography_level == "state" for fact in overview.verification_facts) == 5
    assert all(fact.value.is_finite() and fact.value > 0 for fact in overview.verification_facts)


def test_all_ten_acs_pums_facts_plan_as_native_direct_aggregates() -> None:
    overview = load_integration_overview(INTEGRATION / "overview.yaml")
    mappings = MappingRegistry.from_yaml(INTEGRATION / "mappings.yaml")
    results = CapabilityPlanner(
        mappings, snapshot_id=overview.chronicle_snapshot_id
    ).classify_all(overview.verification_facts, [overview.source])

    assert len(results) == 10
    assert all(result.status is CapabilityStatus.DIRECT for result in results)
    assert all(result.execution_method is ExecutionMethod.DIRECT for result in results)
    assert all(result.period_treatment is PeriodTreatment.NATIVE for result in results)
    assert all(result.query is not None and result.score_eligible for result in results)
    assert all(result.weight_variable == "PWGTP" for result in results)
    assert all(result.policy_period is None for result in results)
    assert all(
        result.calibration_exposure
        is CalibrationExposure.USED_IN_IMPUTATION_OR_REWEIGHTING
        for result in results
    )


def test_acs_pums_checkpoint_matches_the_pinned_chronicle_snapshot() -> None:
    overview = load_integration_overview(INTEGRATION / "overview.yaml")
    validate_overview_against_snapshot(
        overview, INTEGRATION / "chronicle_snapshot_fixture"
    )


def test_acs_pums_refuses_district_geography_and_non_native_years() -> None:
    overview = load_integration_overview(INTEGRATION / "overview.yaml")
    mappings = MappingRegistry.from_yaml(INTEGRATION / "mappings.yaml")
    planner = CapabilityPlanner(mappings, snapshot_id=overview.chronicle_snapshot_id)
    fact = overview.verification_facts[0]

    district = replace(
        fact,
        fact_key="chronicle.aggregate_fact.v2:000000000000000000000001",
        geography_level="congressional_district",
        geography_id="5001800US0101",
    )
    district_result = planner.classify(district, overview.source)
    assert district_result.status is CapabilityStatus.UNSUPPORTED_GEOGRAPHY
    assert district_result.reason_code == "geography_not_supported"
    assert district_result.query is None

    old_period = replace(
        fact,
        fact_key="chronicle.aggregate_fact.v2:000000000000000000000002",
        period=TypedPeriod("calendar_year", "2023"),
    )
    old_period_result = planner.classify(old_period, overview.source)
    assert old_period_result.status is CapabilityStatus.UNSUPPORTED_PERIOD
    assert old_period_result.reason_code == "period_not_supported"
    assert old_period_result.query is None
