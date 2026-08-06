from dataclasses import replace
from decimal import Decimal
from pathlib import Path

import pytest

from evaluation_harness.contracts import (
    AlignmentQuality,
    CalibrationExposure,
    CapabilityStatus,
    ExecutionMethod,
    FactContract,
    MappingQuality,
    PeriodTreatment,
    SourceType,
    TypedPeriod,
)
from evaluation_harness.mappings import MappingRegistry
from evaluation_harness.planner import (
    AlignmentDeclaration,
    CapabilityPlanner,
    EvaluationSourceManifest,
)


def fact(**changes) -> FactContract:
    base = FactContract(
        fact_key="ledger.aggregate_fact.v2:aaaaaaaaaaaaaaaaaaaaaaaa",
        semantic_fact_key="ledger.semantic_fact.v2:bbbbbbbbbbbbbbbbbbbbbbbb",
        source="irs_soi",
        jurisdiction="US",
        period=TypedPeriod.parse("tax_year:2024"),
        geography_level="country",
        geography_id="0100000US",
        entity="tax_unit",
        measure="irs_soi.adjusted_gross_income",
        unit="usd",
        value=Decimal("100"),
        dimensions={"filing_status": "all", "income_range": "all"},
        universe_constraints=({"domain": "all_individual_income_tax_returns"},),
        provenance_class="administrative",
        aggregation={"method": "sum"},
    )
    return replace(base, **changes)


def source(**changes) -> EvaluationSourceManifest:
    base = EvaluationSourceManifest(
        source_id="populace_us_policyengine_us_2024",
        source_type=SourceType.MODEL_DATASET_PAIR,
        dataset_version="populace_us_2024@test",
        model_version="policyengine-us@test",
        jurisdictions=frozenset({"US"}),
        population_period=TypedPeriod.parse("calendar_year:2024"),
        policy_period=TypedPeriod.parse("tax_year:2024"),
        native_fact_periods=frozenset({"tax_year:2024", "calendar_year:2024"}),
        advanced_fact_periods=frozenset(),
        geographies=frozenset({"country", "state"}),
        entities=frozenset({"person", "household", "tax_unit"}),
        weights={"tax_unit": "tax_unit_weight"},
        geography_methods={"country": "national", "state": "state_fips"},
        available=True,
    )
    return replace(base, **changes)


def registry(execution: str = "direct", quality: str = "exact") -> MappingRegistry:
    return MappingRegistry.from_data(
        {
            "mapping_release": "us-v1",
            "mappings": [
                {
                    "mapping_id": "us.soi.agi.v1",
                    "ledger_selector": {
                        "sources": ["irs_soi"],
                        "measures": ["irs_soi.adjusted_gross_income"],
                        "units": ["usd"],
                        "entities": ["tax_unit"],
                    },
                    "execution": execution,
                    "source_expression": "adjusted_gross_income",
                    "operation": "weighted_sum",
                    "required_variables": ["adjusted_gross_income"],
                    "mapping_quality": quality,
                    "supported_dimensions": ["filing_status", "income_range"],
                    "supported_constraint_domains": ["all_individual_income_tax_returns"],
                    "calibration_exposure": "holdout",
                }
            ],
        }
    )


def test_planner_compiles_an_exact_direct_query() -> None:
    result = CapabilityPlanner(registry()).classify(fact(), source())
    assert result.status is CapabilityStatus.DIRECT
    assert result.execution_method is ExecutionMethod.DIRECT
    assert result.period_treatment is PeriodTreatment.NATIVE
    assert result.query.value_expression == "adjusted_gross_income"
    assert result.query.weight == "tax_unit_weight"
    assert result.score_eligible
    assert {"dimension": "__geography__", "value": "0100000US"} in (
        result.query.constraints
    )


def test_planner_normalizes_ledger_comparison_operators() -> None:
    constrained = fact(
        universe_constraints=(
            {"domain": "all_individual_income_tax_returns"},
            {
                "variable": "adjusted_gross_income",
                "operator": ">=",
                "value": 10_000,
            },
            {
                "variable": "adjusted_gross_income",
                "operator": "<",
                "value": 15_000,
            },
        )
    )
    data = registry().to_data()
    data["mappings"][0]["supported_constraint_variables"] = [
        "adjusted_gross_income"
    ]
    result = CapabilityPlanner(MappingRegistry.from_data(data)).classify(
        constrained, source()
    )
    operators = {
        constraint.get("operator")
        for constraint in result.query.constraints
        if "operator" in constraint
    }
    assert operators == {"gte", "lt"}


def test_descriptive_dimensions_do_not_create_duplicate_row_filters() -> None:
    data = registry().to_data()
    data["mappings"][0]["descriptive_dimensions"] = ["income_range"]
    result = CapabilityPlanner(MappingRegistry.from_data(data)).classify(
        fact(), source()
    )
    assert {"dimension": "income_range", "value": "all"} not in (
        result.query.constraints
    )


def test_all_dimension_is_a_total_label_not_a_row_filter() -> None:
    data = registry().to_data()
    data["mappings"][0]["descriptive_dimensions"] = []
    result = CapabilityPlanner(MappingRegistry.from_data(data)).classify(
        fact(), source()
    )
    assert {"dimension": "income_range", "value": "all"} not in (
        result.query.constraints
    )


def test_planner_compiles_model_query_for_established_pair() -> None:
    result = CapabilityPlanner(registry(execution="model")).classify(fact(), source())
    assert result.status is CapabilityStatus.MODEL
    assert result.execution_method is ExecutionMethod.MODEL
    assert result.query.policy_variable == "adjusted_gross_income"


def test_mapping_registry_rejects_model_execution_for_raw_dataset() -> None:
    raw = source(source_type=SourceType.AGGREGATE_DATASET, model_version=None)
    with pytest.raises(ValueError, match="raw dataset"):
        CapabilityPlanner(registry(execution="model")).classify(fact(), raw)


@pytest.mark.parametrize(
    ("changed_fact", "changed_source", "status"),
    [
        ({"jurisdiction": "UK"}, {}, CapabilityStatus.NOT_APPLICABLE),
        ({"geography_level": "congressional_district"}, {}, CapabilityStatus.UNSUPPORTED_GEOGRAPHY),
        ({"entity": "firm"}, {}, CapabilityStatus.UNSUPPORTED_ENTITY),
        ({"measure": "irs_soi.unknown"}, {}, CapabilityStatus.UNSUPPORTED_CONCEPT),
        (
            {"dimensions": {"filing_status": "all", "age": "65_plus"}},
            {},
            CapabilityStatus.UNSUPPORTED_CONSTRAINT,
        ),
        ({}, {"available": False}, CapabilityStatus.PRIVATE_INPUT),
    ],
)
def test_planner_returns_specific_unsupported_statuses(
    changed_fact: dict,
    changed_source: dict,
    status: CapabilityStatus,
) -> None:
    result = CapabilityPlanner(registry()).classify(
        fact(**changed_fact), source(**changed_source)
    )
    assert result.status is status
    assert result.execution_method is ExecutionMethod.NONE
    assert result.reason_code


def test_cross_period_fact_is_unsupported_without_alignment() -> None:
    result = CapabilityPlanner(registry()).classify(
        fact(period=TypedPeriod.parse("tax_year:2023")), source()
    )
    assert result.status is CapabilityStatus.UNSUPPORTED_PERIOD


def test_reviewed_alignment_produces_projected_non_headline_capability() -> None:
    old_fact = fact(period=TypedPeriod.parse("tax_year:2023"))
    alignment = AlignmentDeclaration(
        alignment_id="cbo_growth_factor_aging@1.2.0:agi:2023-2024",
        source_id=source().source_id,
        measure=old_fact.measure,
        source_period=old_fact.period,
        target_period=TypedPeriod.parse("tax_year:2024"),
        quality=AlignmentQuality.VALIDATED,
    )
    result = CapabilityPlanner(registry(), alignments=[alignment]).classify(
        old_fact, source()
    )
    assert result.status is CapabilityStatus.PROJECTED
    assert result.period_treatment is PeriodTreatment.ALIGNED_FACT
    assert result.alignment_id == alignment.alignment_id
    assert not result.score_eligible


def test_approximate_mapping_is_visible_and_not_headline_eligible() -> None:
    result = CapabilityPlanner(registry(quality="approximate")).classify(fact(), source())
    assert result.status is CapabilityStatus.APPROXIMATE
    assert result.mapping_quality is MappingQuality.APPROXIMATE
    assert not result.score_eligible


def test_direct_calibration_target_is_not_reported_as_holdout() -> None:
    data = registry().to_data()
    data["mappings"][0]["calibration_exposure"] = "direct_calibration_target"
    result = CapabilityPlanner(MappingRegistry.from_data(data)).classify(fact(), source())
    assert result.status is CapabilityStatus.CALIBRATION_TARGET
    assert result.calibration_exposure is CalibrationExposure.DIRECT_CALIBRATION_TARGET


def test_capability_matrix_has_exactly_one_cell_per_fact_source_pair() -> None:
    facts = [fact(), replace(fact(), fact_key="ledger.aggregate_fact.v2:cccccccccccccccccccccccc")]
    sources = [source(), replace(source(), source_id="second-source")]
    results = CapabilityPlanner(registry()).classify_all(facts, sources)
    assert len(results) == 4
    assert len({(result.fact_key, result.source_id) for result in results}) == 4


def test_mapping_registry_loads_versioned_yaml(tmp_path: Path) -> None:
    path = tmp_path / "mappings.yaml"
    path.write_text(
        """\
mapping_release: us-v1
mappings:
  - mapping_id: us.soi.agi.v1
    ledger_selector:
      sources: [irs_soi]
      measures: [irs_soi.adjusted_gross_income]
      units: [usd]
      entities: [tax_unit]
    execution: direct
    source_expression: adjusted_gross_income
    operation: weighted_sum
    required_variables: [adjusted_gross_income]
    mapping_quality: exact
    supported_dimensions: [filing_status, income_range]
    supported_constraint_domains: [all_individual_income_tax_returns]
    calibration_exposure: holdout
"""
    )
    loaded = MappingRegistry.from_yaml(path)
    assert loaded.mapping_release == "us-v1"
    assert loaded.mappings[0].mapping_id == "us.soi.agi.v1"


def test_mapping_registry_can_scope_a_mapping_to_reviewed_fact_keys() -> None:
    data = registry().to_data()
    data["mappings"][0]["ledger_selector"]["fact_keys"] = [fact().fact_key]
    scoped = MappingRegistry.from_data(data)
    assert scoped.match(fact()) is not None
    assert scoped.match(
        fact(fact_key="ledger.aggregate_fact.v2:cccccccccccccccccccccccc")
    ) is None


def test_capability_classification_has_no_estimate_input() -> None:
    parameters = CapabilityPlanner.classify.__annotations__
    assert "estimate" not in parameters
    assert "observed_error" not in parameters
