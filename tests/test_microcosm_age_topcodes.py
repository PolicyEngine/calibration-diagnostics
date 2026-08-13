from decimal import Decimal

import pytest

from evaluation_harness.contracts import FactContract, TypedPeriod
from evaluation_harness.integration import load_integration_overview
from evaluation_harness.mappings import MappingRegistry
from evaluation_harness.planner import CapabilityPlanner
from evaluation_harness.microcosm_age_topcodes import (
    CPS_ASEC_AGE_80_84_ANCHOR_FACT_KEY,
    CPS_ASEC_AGE_80_84_FACT_KEYS,
    CPS_ASEC_AGE_85_PLUS_FACT_KEY,
    build_cps_asec_age_topcode_comparisons,
)


PERIOD = TypedPeriod.parse("calendar_year:2024")
VALUES = {
    80: Decimal("1766983"),
    81: Decimal("1750256"),
    82: Decimal("1467026"),
    83: Decimal("1285760"),
    84: Decimal("1146539"),
}


def fact(key: str, value: Decimal, lower: int, upper: int | None) -> FactContract:
    constraints = [{"domain": "population_projection"}]
    if upper is None:
        constraints.append(
            {
                "variable": "age",
                "operator": ">=",
                "value": lower,
                "unit": "years",
                "role": "filter",
            }
        )
    else:
        constraints.extend(
            [
                {
                    "variable": "age",
                    "operator": ">=",
                    "value": lower,
                    "unit": "years",
                    "role": "filter",
                },
                {
                    "variable": "age",
                    "operator": "<",
                    "value": upper,
                    "unit": "years",
                    "role": "filter",
                },
            ]
        )
    return FactContract(
        fact_key=key,
        source="census_population_projections",
        jurisdiction="US",
        period=PERIOD,
        geography_level="country",
        geography_id="0100000US",
        entity="person",
        measure="census.population_projection",
        unit="count",
        value=value,
        dimensions={},
        universe_constraints=tuple(constraints),
        provenance_class="model_output",
    )


def age_facts() -> tuple[FactContract, ...]:
    keys = dict(zip(range(80, 85), CPS_ASEC_AGE_80_84_FACT_KEYS, strict=True))
    rows = [
        fact(keys[age], VALUES[age], age, age + 1)
        for age in range(80, 85)
    ]
    rows.append(
        fact(
            CPS_ASEC_AGE_85_PLUS_FACT_KEY,
            Decimal("6858824"),
            85,
            None,
        )
    )
    return tuple(rows)


def test_cps_age_80_code_compares_once_to_sum_of_five_chronicle_facts() -> None:
    result = build_cps_asec_age_topcode_comparisons(
        age_facts(),
        source_id="populace_us_policyengine_us_2024",
    )

    assert result.age_80_84_benchmark == Decimal("7416564")
    assert result.age_85_plus_fact_key == CPS_ASEC_AGE_85_PLUS_FACT_KEY
    assert len(result.aligned_facts) == 5
    assert {row.aligned_value for row in result.aligned_facts} == {
        Decimal("7416564")
    }
    declarations = {row.fact_key: row for row in result.declarations}
    assert declarations[CPS_ASEC_AGE_80_84_ANCHOR_FACT_KEY].score_eligible
    assert sum(row.score_eligible for row in result.declarations) == 1
    assert all(row.semantic for row in result.declarations)

    anchor = next(
        row
        for row in result.aligned_facts
        if row.source_fact_key == CPS_ASEC_AGE_80_84_ANCHOR_FACT_KEY
    )
    assert anchor.metadata["cps_asec_age_code"] == 80
    assert anchor.metadata["represented_age_range"] == "80-84"
    assert anchor.metadata["input_fact_keys"] == list(
        CPS_ASEC_AGE_80_84_FACT_KEYS
    )
    assert anchor.metadata["benchmark_basis"] == (
        "chronicle_population_projection_age_80_84_sum"
    )


def test_cps_age_topcode_comparison_refuses_an_incomplete_age_group() -> None:
    with pytest.raises(ValueError, match="requires exactly the five"):
        build_cps_asec_age_topcode_comparisons(
            age_facts()[:-2],
            source_id="populace_us_policyengine_us_2024",
        )


def test_cps_age_topcode_comparison_refuses_a_wrong_85_plus_fact() -> None:
    rows = list(age_facts())
    rows[-1] = fact(
        CPS_ASEC_AGE_85_PLUS_FACT_KEY,
        Decimal("6858824"),
        85,
        86,
    )

    with pytest.raises(ValueError, match="85-plus"):
        build_cps_asec_age_topcode_comparisons(
            rows,
            source_id="populace_us_policyengine_us_2024",
        )


def test_reviewed_mappings_execute_one_age_80_84_score_and_age_85_plus() -> None:
    source = load_integration_overview(
        "integrations/microcosm_policyengine_us/overview.yaml"
    ).source
    comparisons = build_cps_asec_age_topcode_comparisons(
        age_facts(), source_id=source.source_id
    )
    planner = CapabilityPlanner(
        MappingRegistry.from_yaml(
            "integrations/microcosm_policyengine_us/mappings.yaml"
        ),
        alignments=comparisons.declarations,
    )

    grouped = [
        planner.classify(row, source)
        for row in age_facts()
        if row.fact_key in CPS_ASEC_AGE_80_84_FACT_KEYS
    ]
    assert {row.mapping_id for row in grouped} == {
        "census-population-projection-cps-age-80-84"
    }
    assert {row.query.value_expression for row in grouped if row.query} == {
        "cps_asec_age_80_84_population"
    }
    assert sum(row.score_eligible for row in grouped) == 1
    assert all(
        not any(
            constraint.get("variable") == "age"
            for constraint in row.query.constraints
        )
        for row in grouped
        if row.query
    )

    age_85 = planner.classify(age_facts()[-1], source)
    assert age_85.mapping_id == "census-population-projection-cps-age-85-plus"
    assert age_85.query is not None
    assert age_85.query.value_expression == "cps_asec_age_85_plus_population"
    assert age_85.score_eligible
