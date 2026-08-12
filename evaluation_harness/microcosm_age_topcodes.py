"""Compare Chronicle single-year older ages to CPS ASEC public-use codes.

The CPS ASEC public-use ``A_AGE`` field stores ages 80--84 as code 80 and
ages 85+ as code 85. The pinned Microcosm release copies ``A_AGE`` into the
PolicyEngine ``age`` input without recovering the suppressed single years.
Consequently the five Chronicle single-year facts must form one benchmark and
one score; they must never be scored as five independent comparisons.
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


CPS_ASEC_AGE_80_84_FACT_KEYS = (
    "chronicle.aggregate_fact.v2:60be3a49582e5eb0681b1cbc",  # age 80
    "chronicle.aggregate_fact.v2:24ef01329f771565b927bd3d",  # age 81
    "chronicle.aggregate_fact.v2:2d017e244d58edc8d99bcc0c",  # age 82
    "chronicle.aggregate_fact.v2:ba9cae909127ad2764caec51",  # age 83
    "chronicle.aggregate_fact.v2:7d34a92d4a5309888bf1e975",  # age 84
)
CPS_ASEC_AGE_80_84_ANCHOR_FACT_KEY = CPS_ASEC_AGE_80_84_FACT_KEYS[0]
CPS_ASEC_AGE_85_PLUS_FACT_KEY = (
    "chronicle.aggregate_fact.v2:4270254d5042b64d0d41e551"
)
CPS_ASEC_AGE_ALIGNMENT_MODEL = "cps_asec_public_use_age_topcode"
CPS_ASEC_AGE_ALIGNMENT_VERSION = "census-asec-2023:A_AGE"
CPS_ASEC_AGE_80_84_BENCHMARK_BASIS = (
    "chronicle_population_projection_age_80_84_sum"
)
CPS_ASEC_AGE_DICTIONARY_URL = (
    "https://www2.census.gov/programs-surveys/cps/datasets/2023/march/"
    "asec2023_ddl_pub_full.pdf"
)


@dataclass(frozen=True)
class CpsAsecAgeTopcodeComparisons:
    aligned_facts: tuple[AlignedFact, ...]
    declarations: tuple[AlignmentDeclaration, ...]
    age_80_84_benchmark: Decimal
    age_85_plus_fact_key: str


def _age_bounds(fact: FactContract) -> tuple[int | None, int | None]:
    lower: int | None = None
    upper: int | None = None
    for constraint in fact.universe_constraints:
        if constraint.get("variable") != "age":
            continue
        operator = constraint.get("operator")
        value = int(constraint["value"])
        if operator in {">=", "gte"}:
            lower = value
        elif operator in {"<", "lt"}:
            upper = value
    return lower, upper


def _eligible_fact(fact: FactContract) -> bool:
    return (
        fact.source == "census_population_projections"
        and fact.measure == "census.population_projection"
        and fact.period.canonical == "calendar_year:2024"
        and fact.geography_id == "0100000US"
        and fact.entity == "person"
        and fact.unit == "count"
    )


def build_cps_asec_age_topcode_comparisons(
    facts: Iterable[FactContract],
    *,
    source_id: str,
) -> CpsAsecAgeTopcodeComparisons:
    """Compile one age-80--84 score and validate the native age-85+ row."""

    by_key = {fact.fact_key: fact for fact in facts}
    grouped = tuple(
        by_key[key]
        for key in CPS_ASEC_AGE_80_84_FACT_KEYS
        if key in by_key
    )
    if len(grouped) != len(CPS_ASEC_AGE_80_84_FACT_KEYS):
        raise ValueError(
            "CPS ASEC age-code comparison requires exactly the five "
            "Chronicle age-80-through-84 facts"
        )
    for expected_age, fact in zip(range(80, 85), grouped, strict=True):
        if not _eligible_fact(fact) or _age_bounds(fact) != (
            expected_age,
            expected_age + 1,
        ):
            raise ValueError(
                "CPS ASEC age-code comparison received an invalid "
                f"age-{expected_age} Chronicle fact"
            )

    age_85_plus = by_key.get(CPS_ASEC_AGE_85_PLUS_FACT_KEY)
    if (
        age_85_plus is None
        or not _eligible_fact(age_85_plus)
        or _age_bounds(age_85_plus) != (85, None)
    ):
        raise ValueError(
            "CPS ASEC age-code comparison requires the national age-85-plus "
            "Chronicle fact"
        )

    benchmark = sum((fact.value for fact in grouped), Decimal(0))
    aligned: list[AlignedFact] = []
    declarations: list[AlignmentDeclaration] = []
    for fact in grouped:
        is_anchor = fact.fact_key == CPS_ASEC_AGE_80_84_ANCHOR_FACT_KEY
        alignment_id = f"{CPS_ASEC_AGE_ALIGNMENT_MODEL}:{fact.fact_key}"
        aligned.append(
            AlignedFact(
                alignment_id=alignment_id,
                source_fact_key=fact.fact_key,
                observed_period=fact.period,
                observed_value=fact.value,
                target_period=fact.period,
                aligned_value=benchmark,
                alignment_model=CPS_ASEC_AGE_ALIGNMENT_MODEL,
                alignment_version=CPS_ASEC_AGE_ALIGNMENT_VERSION,
                factor_sources=tuple(
                    [*CPS_ASEC_AGE_80_84_FACT_KEYS, CPS_ASEC_AGE_DICTIONARY_URL]
                ),
                method_quality=AlignmentQuality.VALIDATED,
                backtest_error=None,
                metadata={
                    "alignment_kind": "semantic",
                    "benchmark_basis": CPS_ASEC_AGE_80_84_BENCHMARK_BASIS,
                    "cps_asec_source_variable": "A_AGE",
                    "cps_asec_age_code": 80,
                    "represented_age_range": "80-84",
                    "input_fact_keys": list(CPS_ASEC_AGE_80_84_FACT_KEYS),
                    "independent_group_score": is_anchor,
                    "calibration_exposure": (
                        CalibrationExposure.EXTERNAL_VALIDATION.value
                    ),
                },
            )
        )
        declarations.append(
            AlignmentDeclaration(
                alignment_id=alignment_id,
                source_id=source_id,
                measure=fact.measure,
                source_period=fact.period,
                target_period=fact.period,
                quality=AlignmentQuality.VALIDATED,
                fact_key=fact.fact_key,
                score_eligible=is_anchor,
                calibration_exposure=CalibrationExposure.EXTERNAL_VALIDATION,
                semantic=True,
            )
        )

    return CpsAsecAgeTopcodeComparisons(
        aligned_facts=tuple(aligned),
        declarations=tuple(declarations),
        age_80_84_benchmark=benchmark,
        age_85_plus_fact_key=age_85_plus.fact_key,
    )
