from dataclasses import replace
from decimal import Decimal

import pytest

from evaluation_harness.contracts import AlignmentQuality, FactContract, TypedPeriod
from evaluation_harness.populace_aging import (
    AGING_MODEL_ID,
    AGING_MODEL_VERSION,
    AgingStatus,
    PopulaceAgingPolicy,
    transform_ledger_facts_to_populace_year,
    transform_ledger_facts_to_populace_years,
)
from evaluation_harness.mappings import MappingRegistry
from evaluation_harness.planner import CapabilityPlanner
from evaluation_harness.integration import load_integration_overview
from evaluation_harness.contracts import CapabilityStatus, PeriodTreatment
from pathlib import Path


def fact(**changes) -> FactContract:
    base = FactContract(
        fact_key="ledger.aggregate_fact.v2:aaaaaaaaaaaaaaaaaaaaaaaa",
        semantic_fact_key="ledger.semantic_fact.v2:bbbbbbbbbbbbbbbbbbbbbbbb",
        source="irs_soi",
        jurisdiction="US",
        period=TypedPeriod.parse("tax_year:2023"),
        geography_level="country",
        geography_id="0100000US",
        entity="tax_unit",
        measure="us:statutes/26/62#adjusted_gross_income",
        unit="usd",
        value=Decimal("100"),
        dimensions={"income_range": "all"},
        universe_constraints=({"domain": "all_individual_income_tax_returns"},),
        provenance_class="administrative",
        assertion="observation",
        aggregation={"method": "sum"},
        observed_measure={"source_measure_id": "adjusted_gross_income"},
        lineage={"source_record_id": "irs_soi.ty2023.table_1_1.all.adjusted_gross_income"},
    )
    return replace(base, **changes)


def cbo(year: int, series: str, value: str) -> FactContract:
    return fact(
        fact_key=f"ledger.aggregate_fact.v2:cbo{year}{series}",
        semantic_fact_key=f"ledger.semantic_fact.v2:cbo{year}{series}",
        source="cbo",
        period=TypedPeriod.parse(f"tax_year:{year}"),
        measure=f"cbo.{series}_projection",
        value=Decimal(value),
        assertion="source_projection",
        provenance_class="model_output",
        observed_measure={"source_measure_id": "projected_amount"},
        lineage={
            "source_record_id": (
                f"cbo.revenue_projection.ty{year}.income_by_source."
                f"{series}.projected_amount"
            )
        },
        universe_constraints=({"domain": "individual_income_tax_returns"},),
    )


def test_matching_cbo_series_uses_populace_ratio_and_provenance() -> None:
    target = fact(
        measure="irs_soi.wages_and_salaries",
        observed_measure={"source_measure_id": "wages_salaries_amount"},
    )
    policy = PopulaceAgingPolicy.from_facts(
        [
            cbo(2023, "wages_and_salaries", "1000"),
            cbo(2024, "wages_and_salaries", "1200"),
            cbo(2023, "adjusted_gross_income", "1000"),
            cbo(2024, "adjusted_gross_income", "1500"),
        ]
    )
    result = policy.transform(target, TypedPeriod.parse("tax_year:2024"))
    assert result.status is AgingStatus.AGED
    assert result.factor == Decimal("1.2")
    assert result.transformed_value == Decimal("120.0")
    assert result.factor_source.endswith("wages_and_salaries.projected_amount")
    assert result.alignment_model_id == AGING_MODEL_ID
    assert result.alignment_model_version == AGING_MODEL_VERSION


def test_unmapped_dollar_concept_falls_back_to_cbo_agi() -> None:
    target = fact(
        measure="irs_soi.income_tax_liability_after_credits",
        observed_measure={"source_measure_id": "income_tax_liability_amount"},
    )
    policy = PopulaceAgingPolicy.from_facts(
        [
            cbo(2023, "adjusted_gross_income", "200"),
            cbo(2024, "adjusted_gross_income", "220"),
        ]
    )
    result = policy.transform(target, TypedPeriod.parse("tax_year:2024"))
    assert result.status is AgingStatus.AGED
    assert result.factor == Decimal("1.1")
    assert float(result.transformed_value) == pytest.approx(110.0)


def test_counts_receive_populaces_explicit_identity_treatment() -> None:
    target = fact(
        measure="irs_soi.individual_income_tax_returns",
        unit="count",
        value=Decimal("160000000"),
        observed_measure={"source_measure_id": "return_count"},
    )
    result = PopulaceAgingPolicy.from_facts([]).transform(
        target, TypedPeriod.parse("tax_year:2024")
    )
    assert result.status is AgingStatus.NOT_DOLLAR_AMOUNT
    assert result.factor == Decimal("1")
    assert result.transformed_value == target.value
    assert result.comparable
    assert result.note == "Populace leaves counts and non-USD targets raw."


def test_source_projection_is_not_projected_again() -> None:
    target = fact(assertion="source_projection")
    result = PopulaceAgingPolicy.from_facts(
        [
            cbo(2023, "adjusted_gross_income", "200"),
            cbo(2024, "adjusted_gross_income", "220"),
        ]
    ).transform(target, TypedPeriod.parse("tax_year:2024"))
    assert result.status is AgingStatus.SOURCE_PROJECTION_LEVEL
    assert result.factor == Decimal("1")
    assert result.transformed_value == target.value
    assert result.comparable


def test_missing_projection_pair_is_explicitly_not_comparable() -> None:
    result = PopulaceAgingPolicy.from_facts([]).transform(
        fact(), TypedPeriod.parse("tax_year:2024")
    )
    assert result.status is AgingStatus.UNAVAILABLE
    assert not result.comparable
    assert result.transformed_value is None
    with pytest.raises(ValueError, match="not comparable"):
        result.to_aligned_fact()


def test_chained_aging_uses_observed_soi_then_cbo_projection() -> None:
    source = fact(
        period=TypedPeriod.parse("tax_year:2022"),
        value=Decimal("500"),
        lineage={"source_record_id": "irs_soi.ty2022.table_1_1.all.adjusted_gross_income"},
    )
    soi_2022 = replace(source, value=Decimal("14000"))
    soi_2023 = replace(
        source,
        fact_key="ledger.aggregate_fact.v2:cccccccccccccccccccccccc",
        period=TypedPeriod.parse("tax_year:2023"),
        value=Decimal("14700"),
        lineage={"source_record_id": "irs_soi.ty2023.table_1_1.all.adjusted_gross_income"},
    )
    policy = PopulaceAgingPolicy.from_facts(
        [
            cbo(2023, "adjusted_gross_income", "15000"),
            cbo(2024, "adjusted_gross_income", "16500"),
            soi_2022,
            soi_2023,
        ]
    )
    result = policy.transform(source, TypedPeriod.parse("tax_year:2024"))
    assert result.factor == Decimal("1.155")
    assert float(result.transformed_value) == pytest.approx(577.5)
    assert result.factor_source.startswith(
        "chained:irs_soi.ty2023.table_1_1.all.adjusted_gross_income+"
    )


def test_comparable_result_converts_to_auditable_aligned_fact() -> None:
    policy = PopulaceAgingPolicy.from_facts(
        [
            cbo(2023, "adjusted_gross_income", "15350"),
            cbo(2024, "adjusted_gross_income", "16685.9"),
        ],
        populace_commit="cae8640f9e65e274aea65c7916cb37b956978e32",
    )
    result = policy.transform(fact(), TypedPeriod.parse("tax_year:2024"))
    aligned = result.to_aligned_fact()
    assert aligned.source_fact_key == fact().fact_key
    assert aligned.observed_period == TypedPeriod.parse("tax_year:2023")
    assert aligned.target_period == TypedPeriod.parse("tax_year:2024")
    assert aligned.observed_value == Decimal("100")
    assert aligned.aligned_value == result.transformed_value
    assert aligned.alignment_model == AGING_MODEL_ID
    assert aligned.alignment_version == AGING_MODEL_VERSION
    assert aligned.method_quality is AlignmentQuality.VALIDATED
    assert aligned.factor_sources[-1].endswith("@cae8640f9e65e")


def test_conflicting_projection_facts_fail_loudly() -> None:
    duplicate = replace(
        cbo(2024, "adjusted_gross_income", "220"),
        fact_key="ledger.aggregate_fact.v2:dddddddddddddddddddddddd",
        value=Decimal("221"),
    )
    with pytest.raises(ValueError, match="Conflicting CBO projection facts"):
        PopulaceAgingPolicy.from_facts(
            [
                cbo(2024, "adjusted_gross_income", "220"),
                duplicate,
            ]
        )


def test_aged_2023_fact_executes_as_a_labeled_2024_projection() -> None:
    integration = Path(__file__).parents[1] / "integrations/populace_policyengine_us"
    overview = load_integration_overview(integration / "overview.yaml")
    mappings = MappingRegistry.from_yaml(integration / "mappings.yaml")
    population = next(
        fact
        for fact in overview.verification_facts
        if fact.fact_key == "ledger.aggregate_fact.v2:13157ca7aa5f8cbb37c8ad52"
    )
    source_fact = replace(population, period=TypedPeriod.parse("calendar_year:2023"))
    aging = PopulaceAgingPolicy.from_facts([]).transform(
        source_fact, TypedPeriod.parse("calendar_year:2024")
    )
    result = CapabilityPlanner(
        mappings,
        alignments=[aging.to_alignment_declaration(overview.source.source_id)],
    ).classify(source_fact, overview.source)
    assert result.status is CapabilityStatus.PROJECTED
    assert result.period_treatment is PeriodTreatment.ALIGNED_FACT
    assert result.alignment_id == aging.alignment_id
    assert result.query is not None
    assert result.score_eligible


def test_bulk_alignment_transforms_only_us_2023_and_preserves_period_kind() -> None:
    us_2023 = fact(unit="count", aggregation={"method": "sum"})
    us_2024 = replace(us_2023, period=TypedPeriod.parse("tax_year:2024"))
    uk_2023 = replace(us_2023, jurisdiction="UK", geography_id="K02000001")
    results = transform_ledger_facts_to_populace_year(
        [us_2024, uk_2023, us_2023], PopulaceAgingPolicy.from_facts([])
    )
    assert len(results) == 1
    assert results[0].target_period == TypedPeriod.parse("tax_year:2024")
    assert results[0].status is AgingStatus.NOT_DOLLAR_AMOUNT


def test_bulk_alignment_can_apply_the_populace_policy_to_2022_and_2023() -> None:
    us_2023 = fact(unit="count", aggregation={"method": "sum"})
    us_2022 = replace(
        us_2023,
        fact_key="ledger.aggregate_fact.v2:cccccccccccccccccccccccc",
        period=TypedPeriod.parse("tax_year:2022"),
    )
    us_2024 = replace(us_2023, period=TypedPeriod.parse("tax_year:2024"))
    results = transform_ledger_facts_to_populace_years(
        [us_2024, us_2023, us_2022],
        PopulaceAgingPolicy.from_facts([]),
        source_years=(2022, 2023),
    )
    assert [row.source_fact.period.value for row in results] == ["2023", "2022"]
    assert all(row.target_period == TypedPeriod.parse("tax_year:2024") for row in results)


def test_real_release_target_matches_populace_diagnostics_byte_for_byte() -> None:
    net_worth = fact(
        source="federal_reserve",
        period=TypedPeriod.parse("calendar_year:2023"),
        measure="federal_reserve.z1.households_nonprofits_net_worth",
        value=Decimal("156080700000000"),
        observed_measure={"source_measure_id": "amount_outstanding"},
    )
    policy = PopulaceAgingPolicy.from_facts(
        [
            cbo(2023, "adjusted_gross_income", "15347400000000"),
            cbo(2024, "adjusted_gross_income", "16685900000000"),
        ]
    )
    result = policy.transform(net_worth, TypedPeriod.parse("calendar_year:2024"))
    assert result.transformed_value == Decimal("169693039350639.2")
    assert format(float(result.factor), ".15g") == "1.08721346938244"
    aligned = result.to_aligned_fact()
    assert aligned.metadata["aging_factor"] == "1.08721346938244"
    assert aligned.alignment_version == "1.2.0"
