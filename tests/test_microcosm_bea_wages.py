from decimal import Decimal

import pytest

from evaluation_harness.contracts import (
    CalibrationExposure,
    FactContract,
    TypedPeriod,
)
from evaluation_harness.microcosm_bea_wages import (
    transform_chronicle_bea_wage_facts,
)


PERIOD = TypedPeriod.parse("calendar_year:2024")


def fact(
    key: str,
    measure: str,
    value: str,
    geography_id: str,
) -> FactContract:
    geography_level = "country" if geography_id == "0100000US" else "state"
    return FactContract(
        fact_key=f"ledger.aggregate_fact.v2:{key:0<24}",
        source="bea",
        jurisdiction="US",
        period=PERIOD,
        geography_level=geography_level,
        geography_id=geography_id,
        entity="person",
        measure=measure,
        unit="usd",
        value=Decimal(value),
        dimensions={
            "bea_regional.geo_name": geography_id,
            "bea_regional.line_code": {
                "bea_regional.wages_and_salaries": 50,
                "bea_regional.supplements_to_wages_and_salaries": 60,
                "bea_regional.contributions_for_government_social_insurance": 36,
                "bea_regional.residence_adjustment": 42,
            }[measure],
            "bea_regional.table_name": "SAINC5N",
        },
        universe_constraints=({"domain": "personal_income"},),
        provenance_class="administrative",
    )


def wage_fixture() -> tuple[FactContract, ...]:
    values = {
        "0400000US01": ("100", "20", "30", "10"),
        "0400000US02": ("200", "40", "60", "-10"),
    }
    rows = []
    for index, (geography, components) in enumerate(values.items()):
        for offset, (measure, value) in enumerate(
            zip(
                (
                    "bea_regional.wages_and_salaries",
                    "bea_regional.supplements_to_wages_and_salaries",
                    "bea_regional.contributions_for_government_social_insurance",
                    "bea_regional.residence_adjustment",
                ),
                components,
                strict=True,
            )
        ):
            rows.append(fact(f"state-{index}-{offset}", measure, value, geography))
    rows.append(
        fact(
            "country-wages",
            "bea_regional.wages_and_salaries",
            "300",
            "0100000US",
        )
    )
    return tuple(rows)


def test_bea_wage_transformation_reproduces_archived_residence_adjustment() -> None:
    result = transform_chronicle_bea_wage_facts(
        wage_fixture(),
        source_id="microcosm_us_policyengine_us_2024",
        national_total=Decimal("600"),
        expected_state_count=2,
    )
    aligned = {
        row.source_fact_key: row for row in result.aligned_facts
    }
    source_facts = {
        row.fact_key: row for row in wage_fixture()
    }
    state_values = {
        source_facts[key].geography_id: row.aligned_value
        for key, row in aligned.items()
        if source_facts[key].geography_level == "state"
    }

    assert result.state_count == 2
    assert result.scale_factor == Decimal("2")
    assert state_values["0400000US01"] == Decimal("213.3333333333333333333333334")
    assert state_values["0400000US02"] == Decimal("386.6666666666666666666666666")
    assert sum(state_values.values()) == Decimal("600.0000000000000000000000000")
    country = next(
        row
        for key, row in aligned.items()
        if source_facts[key].geography_level == "country"
    )
    assert country.aligned_value == Decimal("600")
    assert country.metadata["alignment_kind"] == "semantic"
    assert country.metadata["archived_policyengine_us_data_pr"] == 1034


def test_bea_wage_declarations_distinguish_national_target_from_state_holdouts() -> None:
    result = transform_chronicle_bea_wage_facts(
        wage_fixture(),
        source_id="microcosm_us_policyengine_us_2024",
        national_total=Decimal("600"),
        expected_state_count=2,
    )

    national = next(
        row
        for row in result.declarations
        if row.calibration_exposure
        is CalibrationExposure.DIRECT_CALIBRATION_TARGET
    )
    states = [
        row
        for row in result.declarations
        if row.calibration_exposure is CalibrationExposure.EXTERNAL_VALIDATION
    ]
    assert national.semantic
    assert national.source_period == national.target_period == PERIOD
    assert len(states) == 2
    assert all(row.semantic and row.score_eligible for row in states)


def test_bea_wage_alignment_ids_are_unique_to_each_evaluation_source() -> None:
    microcosm = transform_chronicle_bea_wage_facts(
        wage_fixture(),
        source_id="microcosm_us_policyengine_us_2024",
        national_total=Decimal("600"),
        expected_state_count=2,
    )
    taxcalc = transform_chronicle_bea_wage_facts(
        wage_fixture(),
        source_id="taxcalc_public_cps_2024",
        national_total=Decimal("600"),
        expected_state_count=2,
    )

    assert {row.source_fact_key for row in microcosm.aligned_facts} == {
        row.source_fact_key for row in taxcalc.aligned_facts
    }
    assert not (
        {row.alignment_id for row in microcosm.aligned_facts}
        & {row.alignment_id for row in taxcalc.aligned_facts}
    )
    assert all(
        row.alignment_id.startswith("taxcalc_public_cps_2024:")
        for row in taxcalc.aligned_facts
    )


def test_bea_wage_transformation_can_treat_national_row_as_a_holdout() -> None:
    result = transform_chronicle_bea_wage_facts(
        wage_fixture(),
        source_id="taxcalc_public_cps_2024",
        national_total=Decimal("600"),
        expected_state_count=2,
        national_calibration_exposure=CalibrationExposure.EXTERNAL_VALIDATION,
    )

    assert all(
        row.calibration_exposure is CalibrationExposure.EXTERNAL_VALIDATION
        for row in result.declarations
    )


def test_bea_wage_transformation_rejects_incomplete_component_surfaces() -> None:
    facts = tuple(
        row
        for row in wage_fixture()
        if not (
            row.geography_id == "0400000US02"
            and row.measure == "bea_regional.residence_adjustment"
        )
    )

    with pytest.raises(ValueError, match="missing BEA regional component"):
        transform_chronicle_bea_wage_facts(
            facts,
            source_id="microcosm_us_policyengine_us_2024",
            national_total=Decimal("600"),
            expected_state_count=2,
        )
