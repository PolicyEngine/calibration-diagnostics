from __future__ import annotations

from collections import defaultdict
from dataclasses import dataclass
from decimal import Decimal
from typing import Iterable

from .contracts import CalibrationExposure, PeriodTreatment


LOSS_CAP = Decimal("2")


@dataclass(frozen=True)
class ScoreObservation:
    fact_key: str
    benchmark: Decimal
    estimate: Decimal
    family: str
    period_treatment: PeriodTreatment
    calibration_exposure: CalibrationExposure
    score_eligible: bool


@dataclass(frozen=True)
class GroupScore:
    covered: int
    scored: int
    relative_error_count: int
    loss: Decimal | None
    display_score: Decimal | None


def absolute_relative_error(estimate: Decimal, benchmark: Decimal) -> Decimal | None:
    if benchmark == 0:
        return None
    return abs(estimate - benchmark) / abs(benchmark)


def _mean(values: list[Decimal]) -> Decimal:
    return sum(values, Decimal(0)) / Decimal(len(values))


def build_group_score(
    observations: Iterable[ScoreObservation],
    *,
    exposure: CalibrationExposure | None = None,
    period_treatment: PeriodTreatment | None = None,
) -> GroupScore:
    selected = [
        row
        for row in observations
        if (exposure is None or row.calibration_exposure is exposure)
        and (period_treatment is None or row.period_treatment is period_treatment)
    ]
    eligible = [row for row in selected if row.score_eligible]
    family_errors: dict[str, list[Decimal]] = defaultdict(list)
    for row in eligible:
        error = absolute_relative_error(row.estimate, row.benchmark)
        if error is not None:
            family_errors[row.family].append(min(error, LOSS_CAP))

    if not family_errors:
        return GroupScore(
            covered=len(selected),
            scored=len(eligible),
            relative_error_count=0,
            loss=None,
            display_score=None,
        )

    family_losses = [_mean(errors) for errors in family_errors.values()]
    loss = _mean(family_losses)
    display_score = max(Decimal(0), Decimal(100) * (Decimal(1) - loss / LOSS_CAP))
    return GroupScore(
        covered=len(selected),
        scored=len(eligible),
        relative_error_count=sum(len(errors) for errors in family_errors.values()),
        loss=loss,
        display_score=display_score,
    )

