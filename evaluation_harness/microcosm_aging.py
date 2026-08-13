"""Microcosm-compatible period aging for Chronicle comparison facts.

This is a FactContract-facing implementation of the policy in
``microcosm.build.us_runtime.target_aging`` at the pinned Microcosm release
commit. Keep the constants, series maps, priority order, and failure behavior
in parity with that source; parity tests cover the public contract here.
"""

from __future__ import annotations

import json
import re
from dataclasses import dataclass
from decimal import Decimal
from enum import Enum
from pathlib import Path
from typing import Iterable

from .contracts import AlignedFact, AlignmentQuality, FactContract, TypedPeriod


AGING_MODEL_ID = "cbo_growth_factor_aging"
AGING_MODEL_VERSION = "1.2.0"
DEFAULT_MICROCOSM_COMMIT = "cae8640f9e65e274aea65c7916cb37b956978e32"

_CBO_AGI_INCOME_SOURCE = "adjusted_gross_income"
_SOI_MEASURE_TO_CBO_INCOME_SOURCE = {
    "adjusted_gross_income": "adjusted_gross_income",
    "wages_salaries_amount": "wages_and_salaries",
    "net_capital_gains_amount": "net_capital_gain",
    "qualified_dividends_amount": "qualified_dividend_income",
    "schedule_c_income_amount": "net_business_income",
    "partnership_scorp_income_amount": "net_business_income",
}
_CANONICAL_MEASURE_TO_CBO_INCOME_SOURCE = {
    "bea_nipa.wages_and_salaries": "wages_and_salaries",
    "bea_nipa.proprietors_income_with_inventory_valuation_and_capital_consumption_adjustments": (
        "net_business_income"
    ),
}
_TARGET_ROLE_TO_CBO_INCOME_SOURCE = {
    "cbo_adjusted_gross_income": "adjusted_gross_income",
    "cbo_wages_and_salaries": "wages_and_salaries",
    "cbo_qualified_dividend_income": "qualified_dividend_income",
    "cbo_net_capital_gain": "net_capital_gain",
    "cbo_net_business_income": "net_business_income",
    "nipa_wages_and_salaries": "wages_and_salaries",
    "bea_state_wages": "wages_and_salaries",
    "nipa_proprietors_income": "net_business_income",
    "w2_social_security_tips_total": "wages_and_salaries",
}
_SOI_CHAIN_RECORD_TOKENS = {
    "adjusted_gross_income": ("table_1_1", "adjusted_gross_income"),
    "wages_and_salaries": ("table_1_4", "wages_salaries_amount"),
    "net_capital_gain": ("table_1_4", "net_capital_gains_amount"),
}
_SAME_SERIES_UPRATING_INDEX = {
    "adjusted_gross_income": "total_adjusted_gross_income",
    "wages_and_salaries": "total_wages_salaries_amount",
    "net_capital_gain": "total_net_capital_gains_amount",
}
_CBO_RECORD = re.compile(
    r"^cbo\.revenue_projection\.ty(?P<year>\d{4})\.income_by_source\."
    r"(?P<series>[a-z0-9_]+)\.projected_amount$"
)


class AgingStatus(str, Enum):
    AGED = "aged"
    NOT_DOLLAR_AMOUNT = "not_dollar_amount"
    SOURCE_PROJECTION_LEVEL = "source_projection_level"
    SOURCE_EQUALS_BUILD = "source_equals_build"
    UNAVAILABLE = "unavailable"


@dataclass(frozen=True)
class MicrocosmAgingResult:
    source_fact: FactContract
    target_period: TypedPeriod
    status: AgingStatus
    transformed_value: Decimal | None
    factor: Decimal | None
    factor_source: str
    factor_basis: str
    alignment_model_id: str
    alignment_model_version: str
    microcosm_commit: str
    note: str

    @property
    def comparable(self) -> bool:
        return self.transformed_value is not None

    @property
    def alignment_id(self) -> str:
        return (
            f"{self.alignment_model_id}@{self.alignment_model_version}:"
            f"{self.source_fact.fact_key}:{self.source_fact.period.canonical}-"
            f"{self.target_period.canonical}"
        )

    def to_aligned_fact(self) -> AlignedFact:
        if not self.comparable or self.transformed_value is None:
            raise ValueError(
                f"fact {self.source_fact.fact_key} is not comparable: {self.status.value}"
            )
        return AlignedFact(
            alignment_id=self.alignment_id,
            source_fact_key=self.source_fact.fact_key,
            observed_period=self.source_fact.period,
            observed_value=self.source_fact.value,
            target_period=self.target_period,
            aligned_value=self.transformed_value,
            alignment_model=self.alignment_model_id,
            alignment_version=self.alignment_model_version,
            factor_sources=(
                self.factor_source,
                f"microcosm-target-aging@{self.microcosm_commit[:13]}",
            ),
            method_quality=AlignmentQuality.VALIDATED,
            backtest_error=None,
            metadata={
                "status": self.status.value,
                "aging_factor": (
                    format(float(self.factor), ".15g")
                    if self.factor is not None
                    else None
                ),
                "aging_factor_source": self.factor_source,
                "factor_basis": self.factor_basis,
                "source_period": self.source_fact.period.canonical,
                "aged_to": self.target_period.canonical,
                "microcosm_commit": self.microcosm_commit,
                "note": self.note,
            },
        )

    def to_alignment_declaration(self, source_id: str):
        if not self.comparable:
            raise ValueError(
                f"fact {self.source_fact.fact_key} is not comparable: {self.status.value}"
            )
        from .planner import AlignmentDeclaration

        return AlignmentDeclaration(
            alignment_id=self.alignment_id,
            source_id=source_id,
            measure=self.source_fact.measure,
            source_period=self.source_fact.period,
            target_period=self.target_period,
            quality=AlignmentQuality.VALIDATED,
            fact_key=self.source_fact.fact_key,
            score_eligible=True,
        )


class MicrocosmAgingPolicy:
    """The named Microcosm v1.2.0 aging policy over normalized Chronicle facts."""

    def __init__(
        self,
        projections: dict[str, dict[int, tuple[Decimal, str]]],
        chain_series: dict[str, dict[int, tuple[Decimal, str]]],
        release_factors: dict[
            tuple[str, int, int], tuple[Decimal, str]
        ] | None = None,
        *,
        microcosm_commit: str = DEFAULT_MICROCOSM_COMMIT,
    ) -> None:
        self.projections = projections
        self.chain_series = chain_series
        self.release_factors = release_factors or {}
        self.microcosm_commit = microcosm_commit

    @classmethod
    def from_facts(
        cls,
        facts: Iterable[FactContract],
        *,
        microcosm_commit: str = DEFAULT_MICROCOSM_COMMIT,
        release_diagnostics_path: str | Path | None = None,
    ) -> "MicrocosmAgingPolicy":
        projections: dict[str, dict[int, tuple[Decimal, str]]] = {}
        chains: dict[str, dict[int, tuple[Decimal, str]]] = {}
        for fact in facts:
            projection_key = _projection_key(fact)
            if projection_key is not None:
                series, year = projection_key
                _insert_unique(
                    projections,
                    series,
                    year,
                    fact,
                    label="CBO projection",
                )
            chain_key = _chain_key(fact)
            if chain_key is not None:
                series, year = chain_key
                _insert_unique(chains, series, year, fact, label="national SOI chain")
        release_factors = (
            _load_release_factors(release_diagnostics_path)
            if release_diagnostics_path is not None
            else {}
        )
        return cls(
            projections,
            chains,
            release_factors,
            microcosm_commit=microcosm_commit,
        )

    def transform(
        self,
        fact: FactContract,
        target_period: TypedPeriod,
    ) -> MicrocosmAgingResult:
        if fact.period == target_period:
            return self._result(
                fact,
                target_period,
                AgingStatus.SOURCE_EQUALS_BUILD,
                fact.value,
                Decimal(1),
                "source_equals_build",
                "The Chronicle fact already refers to the Microcosm build year.",
            )
        if fact.aggregation.get("method") != "sum" or fact.unit != "usd":
            return self._result(
                fact,
                target_period,
                AgingStatus.NOT_DOLLAR_AMOUNT,
                fact.value,
                Decimal(1),
                "not_dollar_amount",
                "Microcosm leaves counts and non-USD targets raw.",
            )
        if fact.assertion == "source_projection":
            return self._result(
                fact,
                target_period,
                AgingStatus.SOURCE_PROJECTION_LEVEL,
                fact.value,
                Decimal(1),
                "source_projection_level",
                "Microcosm does not compound its aging model onto a publisher projection.",
            )

        source_year = _period_year(fact.period)
        build_year = _period_year(target_period)
        if source_year is None or build_year is None:
            return self._unavailable(fact, target_period)
        income_source = _income_source(fact)
        factor = self._factor(income_source, source_year, build_year)
        if factor is None and income_source != _CBO_AGI_INCOME_SOURCE:
            factor = self._factor(
                _CBO_AGI_INCOME_SOURCE, source_year, build_year
            )
        if factor is None:
            return self._unavailable(fact, target_period)
        value, source, basis = factor
        return self._result(
            fact,
            target_period,
            AgingStatus.AGED,
            # Microcosm's TargetSpec values and growth ratios are Python
            # floats. Preserve those arithmetic semantics so our transformed
            # benchmark is byte-for-byte equal to release diagnostics.
            Decimal(str(float(fact.value) * float(value))),
            value,
            source,
            "Microcosm projected this USD sum to the build year."
            + (
                " The factor was recovered from the pinned release diagnostics."
                if basis == "pinned_release_diagnostics"
                else ""
            ),
            factor_basis=basis,
        )

    def _factor(
        self,
        income_source: str,
        source_year: int,
        build_year: int,
    ) -> tuple[Decimal, str, str] | None:
        local = self._projection_factor(income_source, source_year, build_year)
        if local is not None:
            value, source = local
            return value, source, "chronicle_projection_facts"
        released = self.release_factors.get(
            (income_source, source_year, build_year)
        )
        if released is None:
            return None
        value, source = released
        return value, source, "pinned_release_diagnostics"

    def _projection_factor(
        self,
        income_source: str,
        source_year: int,
        build_year: int,
    ) -> tuple[Decimal, str] | None:
        series = self.projections.get(income_source)
        if not series or build_year not in series:
            return None
        build_value, build_record_id = series[build_year]
        if build_value <= 0:
            return None
        source = series.get(source_year)
        if source is not None:
            source_value, _ = source
            if source_value <= 0:
                return None
            return build_value / source_value, build_record_id

        observed = self.chain_series.get(income_source)
        if not observed:
            return None
        pivot_year = min(series)
        if not (source_year < pivot_year <= build_year):
            return None
        pivot_projection = series.get(pivot_year)
        soi_source = observed.get(source_year)
        soi_pivot = observed.get(pivot_year)
        if pivot_projection is None or soi_source is None or soi_pivot is None:
            return None
        pivot_value, _ = pivot_projection
        soi_source_value, _ = soi_source
        soi_pivot_value, soi_pivot_record_id = soi_pivot
        if min(pivot_value, soi_source_value, soi_pivot_value) <= 0:
            return None
        factor = (soi_pivot_value / soi_source_value) * (build_value / pivot_value)
        return factor, f"chained:{soi_pivot_record_id}+{build_record_id}"

    def _unavailable(
        self, fact: FactContract, target_period: TypedPeriod
    ) -> MicrocosmAgingResult:
        return self._result(
            fact,
            target_period,
            AgingStatus.UNAVAILABLE,
            None,
            None,
            "unavailable",
            "Microcosm has no usable CBO/SOI factor chain for this dollar fact.",
        )

    def _result(
        self,
        fact: FactContract,
        target_period: TypedPeriod,
        status: AgingStatus,
        transformed_value: Decimal | None,
        factor: Decimal | None,
        factor_source: str,
        note: str,
        factor_basis: str = "not_applicable",
    ) -> MicrocosmAgingResult:
        return MicrocosmAgingResult(
            source_fact=fact,
            target_period=target_period,
            status=status,
            transformed_value=transformed_value,
            factor=factor,
            factor_source=factor_source,
            factor_basis=factor_basis,
            alignment_model_id=AGING_MODEL_ID,
            alignment_model_version=AGING_MODEL_VERSION,
            microcosm_commit=self.microcosm_commit,
            note=note,
        )


def transform_chronicle_facts_to_microcosm_year(
    facts: Iterable[FactContract],
    policy: MicrocosmAgingPolicy,
    *,
    source_year: int = 2023,
    build_year: int = 2024,
) -> tuple[MicrocosmAgingResult, ...]:
    """Apply Microcosm's policy to every US fact from one source year.

    The period kind is retained (TY to TY, CY to CY, FY to FY, and month to
    the same month in the build year). Jurisdiction filtering happens here so
    a US Microcosm runner never manufactures alignments for other countries.
    """

    results: list[MicrocosmAgingResult] = []
    for fact in facts:
        if fact.jurisdiction != "US" or _period_year(fact.period) != source_year:
            continue
        target_value = str(build_year)
        if fact.period.kind == "month" and "-" in fact.period.value:
            target_value = f"{build_year}-{fact.period.value.split('-', 1)[1]}"
        results.append(
            policy.transform(
                fact,
                TypedPeriod(kind=fact.period.kind, value=target_value),
            )
        )
    return tuple(sorted(results, key=lambda result: result.source_fact.fact_key))


def transform_chronicle_facts_to_microcosm_years(
    facts: Iterable[FactContract],
    policy: MicrocosmAgingPolicy,
    *,
    source_years: Iterable[int],
    build_year: int = 2024,
) -> tuple[MicrocosmAgingResult, ...]:
    """Apply the same Microcosm aging policy to each declared source year."""

    years = tuple(source_years)
    if len(years) != len(set(years)):
        raise ValueError("Microcosm aging source years must be unique")
    results = tuple(
        result
        for source_year in years
        for result in transform_chronicle_facts_to_microcosm_year(
            facts,
            policy,
            source_year=source_year,
            build_year=build_year,
        )
    )
    return tuple(sorted(results, key=lambda result: result.source_fact.fact_key))


def _period_year(period: TypedPeriod) -> int | None:
    head = period.value.split("-", 1)[0]
    return int(head) if len(head) == 4 and head.isdigit() else None


def _source_record_id(fact: FactContract) -> str:
    return str(fact.lineage.get("source_record_id", ""))


def _projection_key(fact: FactContract) -> tuple[str, int] | None:
    if (
        fact.source != "cbo"
        or fact.observed_measure.get("source_measure_id") != "projected_amount"
        or fact.assertion != "source_projection"
        or fact.geography_level != "country"
    ):
        return None
    match = _CBO_RECORD.fullmatch(_source_record_id(fact))
    if match is None:
        return None
    return match.group("series"), int(match.group("year"))


def _chain_key(fact: FactContract) -> tuple[str, int] | None:
    if fact.source != "irs_soi" or fact.geography_level != "country":
        return None
    for dimension in ("income_range", "filing_status"):
        if dimension in fact.dimensions and fact.dimensions[dimension] not in {
            "all",
            "total",
        }:
            return None
    record = _source_record_id(fact)
    measure_id = str(fact.observed_measure.get("source_measure_id", ""))
    for series, (table, measure) in _SOI_CHAIN_RECORD_TOKENS.items():
        if f".{table}." in record and measure_id == measure:
            year = _period_year(fact.period)
            if year is not None:
                return series, year
    return None


def _insert_unique(
    index: dict[str, dict[int, tuple[Decimal, str]]],
    series: str,
    year: int,
    fact: FactContract,
    *,
    label: str,
) -> None:
    value = (fact.value, _source_record_id(fact))
    existing = index.setdefault(series, {}).get(year)
    if existing is not None and existing != value:
        raise ValueError(
            f"Conflicting {label} facts for {series!r} year {year}: "
            f"{existing[1]!r} vs {value[1]!r}"
        )
    index[series][year] = value


def _load_release_factors(
    diagnostics_path: str | Path,
) -> dict[tuple[str, int, int], tuple[Decimal, str]]:
    """Recover factors emitted by the exact pinned Microcosm aging pass.

    A newer Chronicle snapshot need not retain the CBO and SOI records that
    fed an older Microcosm release. The release diagnostics preserve the
    resulting factor and its lineage. Only factors produced by the same named
    aging model are accepted here. Surface-specific uprating is ignored unless
    it is exactly the same-series SOI bridge used by the aging model.
    """

    payload = json.loads(Path(diagnostics_path).read_text())
    factors: dict[tuple[str, int, int], tuple[Decimal, str]] = {}
    for target in payload.get("targets", ()):
        metadata = target.get("metadata", {})
        if (
            metadata.get("basis") != "projection"
            or metadata.get("alignment_model_id") != AGING_MODEL_ID
            or metadata.get("alignment_model_version") != AGING_MODEL_VERSION
        ):
            continue
        # Deprecated upstream identifier: Microcosm release diagnostics still
        # emit Chronicle metadata under the former Ledger field prefix.
        source_year = _metadata_year(metadata.get("ledger_fact_period"))
        effective_source_year = _metadata_year(
            metadata.get("source_period", metadata.get("ledger_fact_period"))
        )
        build_year = _metadata_year(
            metadata.get("aged_to", target.get("period"))
        )
        if (
            source_year is None
            or effective_source_year is None
            or build_year is None
            or source_year == build_year
        ):
            continue
        try:
            factor = Decimal(str(metadata["aging_factor"]))
        except (KeyError, ValueError):
            continue
        factor_source = str(metadata.get("aging_factor_source", ""))
        if not factor.is_finite() or factor <= 0 or not factor_source:
            continue

        income_source = _metadata_income_source(metadata)
        if effective_source_year != source_year:
            expected_index = _SAME_SERIES_UPRATING_INDEX.get(income_source)
            if (
                metadata.get("uprating_index") != expected_index
                or _metadata_year(metadata.get("uprating_from_period"))
                != source_year
                or _metadata_year(metadata.get("uprating_to_period"))
                != effective_source_year
            ):
                # For example, taxable-interest distributions are rebased to
                # an active total and return-universe before aging. That is a
                # calibration-surface transformation, not a time-growth factor
                # suitable for an arbitrary external-validation fact.
                continue
            try:
                uprating_factor = Decimal(str(metadata["uprating_factor"]))
            except (KeyError, ValueError):
                continue
            if not uprating_factor.is_finite() or uprating_factor <= 0:
                continue
            factor *= uprating_factor
            chain_record = str(
                metadata.get("uprating_index_source_record_id", "")
            )
            if not chain_record:
                continue
            factor_source = f"chained:{chain_record}+{factor_source}"

        key = (income_source, source_year, build_year)
        value = (factor, factor_source)
        existing = factors.get(key)
        if existing is not None and existing != value:
            raise ValueError(
                "Conflicting pinned Microcosm release factors for "
                f"{income_source!r} {source_year}->{build_year}: "
                f"{existing!r} vs {value!r}"
            )
        factors[key] = value
    return factors


def _metadata_year(value: object) -> int | None:
    if value is None:
        return None
    head = str(value).split("-", 1)[0]
    return int(head) if len(head) == 4 and head.isdigit() else None


def _metadata_income_source(metadata: dict) -> str:
    target_role = str(metadata.get("target_role", ""))
    direct = _TARGET_ROLE_TO_CBO_INCOME_SOURCE.get(target_role)
    if direct is not None:
        return direct
    measure_id = str(metadata.get("source_measure_id", ""))
    return _SOI_MEASURE_TO_CBO_INCOME_SOURCE.get(
        measure_id, _CBO_AGI_INCOME_SOURCE
    )


def _income_source(fact: FactContract) -> str:
    measure_id = str(fact.observed_measure.get("source_measure_id", ""))
    return _SOI_MEASURE_TO_CBO_INCOME_SOURCE.get(
        measure_id,
        _CANONICAL_MEASURE_TO_CBO_INCOME_SOURCE.get(
            fact.measure, _CBO_AGI_INCOME_SOURCE
        ),
    )
