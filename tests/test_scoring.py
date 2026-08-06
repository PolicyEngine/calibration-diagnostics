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


def test_zero_benchmark_has_no_relative_error() -> None:
    assert absolute_relative_error(Decimal("4"), Decimal("0")) is None


def test_group_score_reports_zero_targets_without_inventing_percent_error() -> None:
    score = build_group_score([observation("zero", "0", "4", "income")])
    assert score.covered == 1
    assert score.relative_error_count == 0
    assert score.loss is None
    assert score.display_score is None


def test_group_score_macro_averages_families_instead_of_rows() -> None:
    rows = [
        observation("a1", "100", "100", "family_a"),
        observation("a2", "100", "100", "family_a"),
        observation("a3", "100", "100", "family_a"),
        observation("b1", "100", "200", "family_b"),
    ]
    score = build_group_score(rows)
    assert score.loss == Decimal("0.5")
    assert score.display_score == Decimal("75.0")


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

