from dataclasses import replace
from decimal import Decimal

import pytest

from evaluation_harness.contracts import (
    AggregateQuery,
    AlignmentQuality,
    CalibrationExposure,
    CapabilityResult,
    CapabilityStatus,
    ExecutionMethod,
    FactContract,
    MappingQuality,
    PeriodTreatment,
    SourceType,
    TypedPeriod,
)


def national_income_fact() -> FactContract:
    return FactContract(
        fact_key="irs_soi.ty2023.wages.amount",
        source="irs_soi",
        jurisdiction="US",
        period=TypedPeriod.parse("tax_year:2023"),
        geography_level="country",
        geography_id="US",
        entity="tax_unit",
        measure="wages_salaries_amount",
        unit="USD",
        value=Decimal("1000.25"),
        dimensions={"filing_status": "all"},
        universe_constraints=("filers",),
        provenance_class="administrative_observation",
    )


def test_typed_period_parses_supported_periods() -> None:
    assert TypedPeriod.parse("tax_year:2023").value == "2023"
    assert TypedPeriod.parse("calendar_year:2024").kind == "calendar_year"
    assert TypedPeriod.parse("fiscal_year:2024").canonical == "fiscal_year:2024"
    assert TypedPeriod.parse("month:2024-12").value == "2024-12"


@pytest.mark.parametrize(
    "value",
    ["2023", "tax_year", "month:2024-13", "quarter:2024-Q1"],
)
def test_typed_period_rejects_malformed_or_unsupported_periods(value: str) -> None:
    with pytest.raises(ValueError):
        TypedPeriod.parse(value)


def test_fact_contract_round_trips_deterministically() -> None:
    fact = national_income_fact()
    payload = fact.to_dict()
    assert FactContract.from_dict(payload) == fact
    assert FactContract.from_dict(payload).to_json() == fact.to_json()


def test_fact_contract_rejects_blank_unit() -> None:
    with pytest.raises(ValueError, match="unit"):
        replace(national_income_fact(), unit="")


def test_raw_dataset_capability_cannot_run_a_model() -> None:
    with pytest.raises(ValueError, match="raw dataset"):
        CapabilityResult(
            snapshot_id="ledger-1",
            fact_key=national_income_fact().fact_key,
            source_id="acs_pums_2023",
            source_type=SourceType.AGGREGATE_DATASET,
            mapping_release="us-v1",
            status=CapabilityStatus.MODEL,
            reason_code=None,
            reason_detail=None,
            execution_method=ExecutionMethod.MODEL,
            mapping_id="acs.wages.v1",
            mapping_quality=MappingQuality.EXACT,
            fact_period=TypedPeriod.parse("calendar_year:2023"),
            population_period=TypedPeriod.parse("calendar_year:2023"),
            policy_period=None,
            period_treatment=PeriodTreatment.NATIVE,
            alignment_id=None,
            alignment_quality=AlignmentQuality.NONE,
            entity="person",
            weight_variable="PWGTP",
            required_variables=("WAGP",),
            geography_method="recorded_state",
            query=AggregateQuery(
                operation="weighted_sum",
                value_expression="WAGP",
                weight="PWGTP",
            ),
            calibration_exposure=CalibrationExposure.EXTERNAL_VALIDATION,
            score_eligible=True,
        )


def test_unsupported_capability_has_no_executable_query() -> None:
    capability = CapabilityResult.unsupported(
        snapshot_id="ledger-1",
        fact=national_income_fact(),
        source_id="acs_pums_2023",
        source_type=SourceType.AGGREGATE_DATASET,
        mapping_release="us-v1",
        status=CapabilityStatus.UNSUPPORTED_CONCEPT,
        reason_code="recorded_variable_unavailable",
        reason_detail="ACS does not record federal income tax liability",
    )
    assert capability.execution_method is ExecutionMethod.NONE
    assert capability.query is None
    assert not capability.score_eligible


def test_cross_period_capability_requires_alignment() -> None:
    with pytest.raises(ValueError, match="alignment"):
        CapabilityResult.direct(
            snapshot_id="ledger-1",
            fact=national_income_fact(),
            source_id="microcosm_2024",
            source_type=SourceType.MODEL_DATASET_PAIR,
            mapping_release="us-v1",
            mapping_id="microcosm.wages.v1",
            mapping_quality=MappingQuality.EXACT,
            population_period=TypedPeriod.parse("tax_year:2024"),
            period_treatment=PeriodTreatment.ALIGNED_FACT,
            alignment_id=None,
            alignment_quality=AlignmentQuality.NONE,
            weight_variable="tax_unit_weight",
            required_variables=("employment_income",),
            geography_method="national",
            query=AggregateQuery(
                operation="weighted_sum",
                value_expression="employment_income",
                weight="tax_unit_weight",
            ),
            calibration_exposure=CalibrationExposure.DIRECT_CALIBRATION_TARGET,
            score_eligible=False,
        )
