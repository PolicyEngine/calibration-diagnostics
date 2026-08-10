"""Microcosm-compatible BEA regional wage benchmark transformation.

The retired ``policyengine-us-data`` pipeline did not calibrate household
residence-state wages directly to BEA's place-of-work line 50. PR #1034 first
allocated BEA residence adjustment line 42 to wages, then scaled the resulting
state surface to the national NIPA wage target. This module applies that exact
reviewed definition to Chronicle facts before comparing them with Microcosm's
``employment_income_before_lsr`` values.
"""

from __future__ import annotations

from dataclasses import dataclass
from decimal import Decimal
from typing import Iterable

from .contracts import (
    AlignedFact,
    AlignmentQuality,
    CalibrationExposure,
    FactContract,
)
from .planner import AlignmentDeclaration


BEA_NIPA_WAGES_AND_SALARIES_2024 = Decimal("12387929000000")
BEA_WAGE_TRANSFORMATION_ID = "bea_state_wages_residence_adjusted_to_nipa"
BEA_WAGE_TRANSFORMATION_VERSION = (
    "policyengine-us-data@af806026d0885e15275593f5ea42aa74937ff9af"
)
BEA_WAGE_TRANSFORMATION_PR = 1034
BEA_WAGE_BENCHMARK_BASIS = "microcosm_bea_residence_adjusted_wage_target"

WAGES = "bea_regional.wages_and_salaries"
SUPPLEMENTS = "bea_regional.supplements_to_wages_and_salaries"
CONTRIBUTIONS = "bea_regional.contributions_for_government_social_insurance"
RESIDENCE_ADJUSTMENT = "bea_regional.residence_adjustment"
COMPONENTS = (WAGES, SUPPLEMENTS, CONTRIBUTIONS, RESIDENCE_ADJUSTMENT)


@dataclass(frozen=True)
class BeaWageTransformations:
    aligned_facts: tuple[AlignedFact, ...]
    declarations: tuple[AlignmentDeclaration, ...]
    input_fact_keys: tuple[str, ...]
    state_count: int
    scale_factor: Decimal
    national_total: Decimal


def _component_index(
    facts: Iterable[FactContract],
) -> dict[tuple[str, str, str], FactContract]:
    result: dict[tuple[str, str, str], FactContract] = {}
    for fact in facts:
        if fact.source != "bea" or fact.measure not in COMPONENTS:
            continue
        key = (fact.period.canonical, fact.geography_id, fact.measure)
        if key in result:
            raise ValueError(
                "duplicate BEA regional component for "
                f"{fact.period.canonical}:{fact.geography_id}:{fact.measure}"
            )
        result[key] = fact
    return result


def _component(
    index: dict[tuple[str, str, str], FactContract],
    wage_fact: FactContract,
    measure: str,
) -> FactContract:
    key = (wage_fact.period.canonical, wage_fact.geography_id, measure)
    try:
        return index[key]
    except KeyError as error:
        raise ValueError(
            "missing BEA regional component "
            f"{measure} for {wage_fact.period.canonical}:"
            f"{wage_fact.geography_id}"
        ) from error


def _alignment_id(fact: FactContract) -> str:
    return f"{BEA_WAGE_TRANSFORMATION_ID}:{fact.fact_key}"


def transform_chronicle_bea_wage_facts(
    facts: Iterable[FactContract],
    *,
    source_id: str,
    national_total: Decimal = BEA_NIPA_WAGES_AND_SALARIES_2024,
    expected_state_count: int = 51,
) -> BeaWageTransformations:
    """Build residence-basis, national-total-scaled wage benchmarks.

    State formula (archived PolicyEngine PR #1034)::

        adjusted = wages + residence_adjustment * (
            wages / (wages + supplements + social_insurance_contributions)
        )
        benchmark = adjusted * national_total / sum(state_adjusted)

    The national Chronicle regional-wage row is aligned directly to the same
    NIPA total. State rows remain external-validation holdouts because the
    pinned Microcosm release did not activate the retired state controls.
    """

    fact_values = tuple(facts)
    index = _component_index(fact_values)
    wage_facts = tuple(
        sorted(
            (
                fact
                for fact in fact_values
                if fact.source == "bea" and fact.measure == WAGES
            ),
            key=lambda row: row.fact_key,
        )
    )
    state_wages = tuple(
        fact for fact in wage_facts if fact.geography_level == "state"
    )
    national_wages = tuple(
        fact for fact in wage_facts if fact.geography_level == "country"
    )
    if len(state_wages) != expected_state_count:
        raise ValueError(
            "BEA regional wage transformation expected "
            f"{expected_state_count} state rows, found {len(state_wages)}"
        )
    if len(national_wages) != 1:
        raise ValueError(
            "BEA regional wage transformation requires exactly one national "
            f"wage row, found {len(national_wages)}"
        )
    if national_total <= 0:
        raise ValueError("BEA national wage total must be positive")

    adjusted_by_key: dict[str, Decimal] = {}
    inputs_by_key: dict[str, tuple[FactContract, ...]] = {}
    for wage_fact in state_wages:
        inputs = tuple(_component(index, wage_fact, measure) for measure in COMPONENTS)
        wages, supplements, contributions, residence = (
            row.value for row in inputs
        )
        denominator = wages + supplements + contributions
        if denominator == 0:
            raise ValueError(
                "BEA regional wage adjustment has a zero compensation denominator "
                f"for {wage_fact.geography_id}"
            )
        adjusted_by_key[wage_fact.fact_key] = (
            wages + residence * wages / denominator
        )
        inputs_by_key[wage_fact.fact_key] = inputs

    adjusted_total = sum(adjusted_by_key.values(), Decimal(0))
    if adjusted_total <= 0:
        raise ValueError("BEA residence-adjusted state wage total must be positive")
    scale_factor = national_total / adjusted_total

    aligned: list[AlignedFact] = []
    declarations: list[AlignmentDeclaration] = []
    input_fact_keys: set[str] = set()
    for wage_fact in (*state_wages, *national_wages):
        is_national = wage_fact.geography_level == "country"
        inputs = (
            (wage_fact,)
            if is_national
            else inputs_by_key[wage_fact.fact_key]
        )
        input_fact_keys.update(row.fact_key for row in inputs)
        adjusted_value = (
            national_total
            if is_national
            else adjusted_by_key[wage_fact.fact_key]
        )
        benchmark = (
            national_total if is_national else adjusted_value * scale_factor
        )
        alignment_id = _alignment_id(wage_fact)
        exposure = (
            CalibrationExposure.DIRECT_CALIBRATION_TARGET
            if is_national
            else CalibrationExposure.EXTERNAL_VALIDATION
        )
        aligned.append(
            AlignedFact(
                alignment_id=alignment_id,
                source_fact_key=wage_fact.fact_key,
                observed_period=wage_fact.period,
                observed_value=wage_fact.value,
                target_period=wage_fact.period,
                aligned_value=benchmark,
                alignment_model=BEA_WAGE_TRANSFORMATION_ID,
                alignment_version=BEA_WAGE_TRANSFORMATION_VERSION,
                factor_sources=tuple(
                    [
                        *(row.fact_key for row in inputs),
                        "policyengine-us-data-pr-1034",
                        "BEA NIPA Table 2.1 2024 national wage target",
                    ]
                ),
                method_quality=AlignmentQuality.VALIDATED,
                backtest_error=None,
                metadata={
                    "alignment_kind": "semantic",
                    "benchmark_basis": BEA_WAGE_BENCHMARK_BASIS,
                    "target_role": (
                        "nipa_wages_and_salaries"
                        if is_national
                        else "bea_state_wages_external_validation"
                    ),
                    "archived_policyengine_us_data_pr": BEA_WAGE_TRANSFORMATION_PR,
                    "archived_policyengine_us_data_commit": (
                        "af806026d0885e15275593f5ea42aa74937ff9af"
                    ),
                    "source_measure": WAGES,
                    "source_basis": "place_of_work",
                    "comparison_basis": "place_of_residence",
                    "raw_observed_wages": str(wage_fact.value),
                    "residence_adjusted_wages": str(adjusted_value),
                    "national_wage_total": str(national_total),
                    "national_scaling_factor": str(scale_factor),
                    "input_fact_keys": [row.fact_key for row in inputs],
                    "calibration_exposure": exposure.value,
                },
            )
        )
        declarations.append(
            AlignmentDeclaration(
                alignment_id=alignment_id,
                source_id=source_id,
                measure=wage_fact.measure,
                source_period=wage_fact.period,
                target_period=wage_fact.period,
                quality=AlignmentQuality.VALIDATED,
                fact_key=wage_fact.fact_key,
                score_eligible=True,
                calibration_exposure=exposure,
                semantic=True,
            )
        )

    return BeaWageTransformations(
        aligned_facts=tuple(aligned),
        declarations=tuple(declarations),
        input_fact_keys=tuple(sorted(input_fact_keys)),
        state_count=len(state_wages),
        scale_factor=scale_factor,
        national_total=national_total,
    )
