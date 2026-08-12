from dataclasses import replace
from pathlib import Path

from evaluation_harness.contracts import CapabilityStatus, PeriodTreatment
from evaluation_harness.integration import load_integration_overview, validate_overview_against_snapshot
from evaluation_harness.mappings import MappingRegistry
from evaluation_harness.planner import CapabilityPlanner


ROOT = Path(__file__).parents[1]
INTEGRATION = ROOT / "integrations" / "taxcalc_cps"


def test_taxcalc_cps_overview_pins_public_dataset_and_model() -> None:
    overview = load_integration_overview(INTEGRATION / "overview.yaml")
    assert overview.source.source_id == "taxcalc_public_cps_2024"
    assert overview.source.dataset_version == "taxcalc-cps-2014@6.7.1"
    assert overview.source.model_version == "taxcalc==6.7.1"
    assert overview.source.geographies == frozenset({"country", "state"})
    assert overview.source.geography_methods["state"] == "state_fips"
    assert overview.source.entities == frozenset({"tax_unit"})
    assert overview.source.execution_year_from_fact
    assert overview.source.advanced_fact_periods >= {
        "calendar_year:2018",
        "calendar_year:2023",
        "calendar_year:2024",
        "tax_year:2022",
        "tax_year:2023",
        "tax_year:2024",
    }


def test_taxcalc_cps_has_ten_real_numeric_verification_facts() -> None:
    overview = load_integration_overview(INTEGRATION / "overview.yaml")
    assert len(overview.verification_facts) == 10
    assert len({fact.fact_key for fact in overview.verification_facts}) == 10
    assert len({fact.measure for fact in overview.verification_facts}) == 10
    assert {fact.unit for fact in overview.verification_facts} == {"count", "usd"}
    assert all(fact.value.is_finite() for fact in overview.verification_facts)


def test_all_ten_taxcalc_cps_facts_are_executable_advanced_results() -> None:
    overview = load_integration_overview(INTEGRATION / "overview.yaml")
    mappings = MappingRegistry.from_yaml(INTEGRATION / "mappings.yaml")
    results = CapabilityPlanner(mappings, snapshot_id=overview.chronicle_snapshot_id).classify_all(
        overview.verification_facts, [overview.source]
    )
    assert len(results) == 10
    assert all(result.status in {CapabilityStatus.MODEL, CapabilityStatus.DIRECT} for result in results)
    assert all(result.query is not None and result.score_eligible for result in results)
    assert all(result.period_treatment is PeriodTreatment.ADVANCED_POPULATION for result in results)


def test_taxcalc_cps_facts_match_committed_snapshot_fixture() -> None:
    overview = load_integration_overview(INTEGRATION / "overview.yaml")
    validate_overview_against_snapshot(overview, INTEGRATION / "chronicle_snapshot_fixture")


def test_taxcalc_cps_plans_income_band_and_eitc_child_breakdowns() -> None:
    overview = load_integration_overview(INTEGRATION / "overview.yaml")
    mappings = MappingRegistry.from_yaml(INTEGRATION / "mappings.yaml")
    planner = CapabilityPlanner(mappings, snapshot_id=overview.chronicle_snapshot_id)
    eitc = next(
        fact
        for fact in overview.verification_facts
        if fact.measure == "irs_soi.total_earned_income_credit"
    )
    income_band = replace(
        eitc,
        fact_key="chronicle.aggregate_fact.v2:000000000000000000000001",
        dimensions={"income_range": "10k_to_15k"},
        universe_constraints=(
            {"domain": "all_individual_income_tax_returns"},
            {
                "variable": "us:statutes/26/62#adjusted_gross_income",
                "operator": ">=",
                "value": 10_000,
            },
            {
                "variable": "us:statutes/26/62#adjusted_gross_income",
                "operator": "<",
                "value": 15_000,
            },
        ),
    )
    band_result = planner.classify(income_band, overview.source)
    assert band_result.query is not None and band_result.score_eligible
    assert {
        constraint["operator"]
        for constraint in band_result.query.constraints
        if "operator" in constraint
    } == {"gte", "lt"}

    child = replace(
        eitc,
        fact_key="chronicle.aggregate_fact.v2:000000000000000000000002",
        measure="irs_soi.earned_income_credit",
        dimensions={"eitc_child_count": 2, "filing_status": "all", "income_range": "all"},
        universe_constraints=(
            {"domain": "all_individual_income_tax_returns"},
            {
                "variable": "us.tax.earned_income_credit_qualifying_children",
                "operator": "==",
                "value": 2,
            },
        ),
    )
    child_result = planner.classify(child, overview.source)
    assert child_result.query is not None and child_result.score_eligible
    assert any(
        constraint.get("variable")
        == "us.tax.earned_income_credit_qualifying_children"
        for constraint in child_result.query.constraints
    )
