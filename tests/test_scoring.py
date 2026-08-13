from decimal import Decimal

from evaluation_harness.contracts import CalibrationExposure, PeriodTreatment
from evaluation_harness.scoring import (
    ScoreObservation,
    absolute_relative_error,
    build_group_score,
)


def observation(
    fact_key: str,
    benchmark: str,
    estimate: str,
    family: str,
    *,
    treatment: PeriodTreatment = PeriodTreatment.NATIVE,
    exposure: CalibrationExposure = CalibrationExposure.HOLDOUT,
    eligible: bool = True,
) -> ScoreObservation:
    return ScoreObservation(
        fact_key=fact_key,
        benchmark=Decimal(benchmark),
        estimate=Decimal(estimate),
        family=family,
        period_treatment=treatment,
        calibration_exposure=exposure,
        score_eligible=eligible,
    )


def test_absolute_relative_error_handles_signed_benchmarks() -> None:
    assert absolute_relative_error(Decimal("-90"), Decimal("-100")) == Decimal("0.1")


def test_zero_benchmark_is_scored_as_a_structural_zero() -> None:
    assert absolute_relative_error(Decimal("0"), Decimal("0")) == Decimal("0")
    assert absolute_relative_error(Decimal("0.0001"), Decimal("0")) == Decimal("0")
    assert absolute_relative_error(Decimal("-0.0001"), Decimal("0")) == Decimal("0")
    assert absolute_relative_error(Decimal("0.00010001"), Decimal("0")) == Decimal(
        "1"
    )
    assert absolute_relative_error(Decimal("4"), Decimal("0")) == Decimal("1")
    assert absolute_relative_error(Decimal("-4"), Decimal("0")) == Decimal("1")


def test_group_score_includes_structural_zero_results() -> None:
    score = build_group_score(
        [
            observation("matched-zero", "0", "0", "income"),
            observation("missed-zero", "0", "4", "income"),
        ]
    )
    assert score.covered == 2
    assert score.relative_error_count == 2
    assert score.loss == Decimal("0.5")
    assert score.display_score == Decimal("50.0")


def test_group_score_means_errors_across_facts_instead_of_families() -> None:
    rows = [
        observation("a1", "100", "100", "family_a"),
        observation("a2", "100", "100", "family_a"),
        observation("a3", "100", "100", "family_a"),
        observation("b1", "100", "200", "family_b"),
    ]
    score = build_group_score(rows)
    assert score.relative_error_count == 4
    assert score.loss == Decimal("0.25")
    assert score.display_score == Decimal("75.0")


def test_group_score_caps_each_fact_error_at_one_hundred_percent() -> None:
    rows = [
        observation("exact", "100", "100", "family_a"),
        observation("one-hundred-percent", "100", "200", "family_a"),
        observation("three-hundred-percent", "100", "400", "family_b"),
    ]

    score = build_group_score(rows)

    assert score.loss == Decimal("0.6666666666666666666666666667")
    assert score.display_score == Decimal("33.33333333333333333333333333")


def test_ineligible_rows_count_as_coverage_but_not_score() -> None:
    rows = [
        observation("native", "100", "110", "income"),
        observation(
            "projected",
            "100",
            "300",
            "income",
            treatment=PeriodTreatment.ALIGNED_FACT,
            eligible=False,
        ),
    ]
    score = build_group_score(rows)
    assert score.covered == 2
    assert score.scored == 1
    assert score.loss == Decimal("0.1")


def test_calibration_fit_and_holdout_are_separate_surfaces() -> None:
    rows = [
        observation(
            "calibration",
            "100",
            "100",
            "income",
            exposure=CalibrationExposure.DIRECT_CALIBRATION_TARGET,
        ),
        observation("holdout", "100", "150", "income"),
    ]
    holdout = build_group_score(rows, exposure=CalibrationExposure.HOLDOUT)
    calibration = build_group_score(
        rows,
        exposure=CalibrationExposure.DIRECT_CALIBRATION_TARGET,
    )
    assert holdout.loss == Decimal("0.5")
    assert calibration.loss == Decimal("0")


def test_microcosm_aligned_facts_can_be_scored_as_a_separate_group() -> None:
    rows = [
        observation("native", "100", "100", "income"),
        observation(
            "aged-2023",
            "110",
            "121",
            "income",
            treatment=PeriodTreatment.ALIGNED_FACT,
            eligible=True,
        ),
    ]
    projected = build_group_score(
        rows, period_treatment=PeriodTreatment.ALIGNED_FACT
    )
    native = build_group_score(rows, period_treatment=PeriodTreatment.NATIVE)
    assert projected.loss == Decimal("0.1")
    assert native.loss == Decimal("0")
