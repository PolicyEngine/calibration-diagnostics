from dataclasses import replace
from decimal import Decimal
from pathlib import Path

import pytest

from evaluation_harness.contracts import (
    CalibrationExposure,
    CapabilityStatus,
    TypedPeriod,
)
from evaluation_harness.integration import load_integration_overview
from evaluation_harness.mappings import MappingRegistry
from evaluation_harness.planner import CapabilityPlanner


INTEGRATION = Path("integrations/census_acs_pums")


@pytest.mark.parametrize(
    (
        "source",
        "measure",
        "unit",
        "domain",
        "dimensions",
        "expression",
        "exposure",
    ),
    [
        (
            "census_pep",
            "census_pep.resident_population",
            "count",
            "resident_population",
            {},
            "__ones__",
            CalibrationExposure.USED_IN_IMPUTATION_OR_REWEIGHTING,
        ),
        (
            "census_population_projections",
            "census.population_projection",
            "count",
            "population_projection",
            {},
            "__ones__",
            CalibrationExposure.EXTERNAL_VALIDATION,
        ),
        (
            "bea",
            "bea_regional.wages_and_salaries",
            "usd",
            "personal_income",
            {
                "bea_regional.geo_name": "United States",
                "bea_regional.line_code": 50,
                "bea_regional.table_name": "SAINC5N",
            },
            "WAGP",
            CalibrationExposure.EXTERNAL_VALIDATION,
        ),
        (
            "bea",
            "bea_nipa.wages_and_salaries",
            "usd",
            "compensation_of_employees",
            {"bea_nipa.series_code": "A034RC"},
            "WAGP",
            CalibrationExposure.EXTERNAL_VALIDATION,
        ),
    ],
)
def test_reviewed_raw_acs_expansions_are_exact_native_2024_aggregates(
    source: str,
    measure: str,
    unit: str,
    domain: str,
    dimensions: dict,
    expression: str,
    exposure: CalibrationExposure,
) -> None:
    overview = load_integration_overview(INTEGRATION / "overview.yaml")
    registry = MappingRegistry.from_yaml(INTEGRATION / "mappings.yaml")
    template = overview.verification_facts[0]
    constraints = [{"domain": domain}]
    constraints.extend(
        {
            "variable": dimension,
            "operator": "==",
            "value": value,
        }
        for dimension, value in dimensions.items()
    )
    if expression == "__ones__":
        constraints.extend(
            (
                {"variable": "age", "operator": ">=", "value": 20},
                {"variable": "age", "operator": "<", "value": 25},
            )
        )
    candidate = replace(
        template,
        fact_key=f"test:{source}:{measure}",
        source=source,
        measure=measure,
        unit=unit,
        value=Decimal("1"),
        period=TypedPeriod("calendar_year", "2024"),
        dimensions=dimensions,
        universe_constraints=tuple(constraints),
    )

    capability = CapabilityPlanner(
        registry,
        snapshot_id=overview.chronicle_snapshot_id,
    ).classify(candidate, overview.source)

    assert capability.status is CapabilityStatus.DIRECT
    assert capability.score_eligible
    assert capability.query is not None
    assert capability.query.value_expression == expression
    assert capability.calibration_exposure is exposure


def test_raw_acs_keeps_ssa_income_fields_unmapped() -> None:
    overview = load_integration_overview(INTEGRATION / "overview.yaml")
    registry = MappingRegistry.from_yaml(INTEGRATION / "mappings.yaml")
    candidate = replace(
        overview.verification_facts[0],
        fact_key="test:ssa:ssi_payment_amount",
        source="ssa",
        measure="ssa.ssi_payment_amount",
        unit="usd",
        dimensions={},
        universe_constraints=(
            {"domain": "social_security_and_ssi_payments"},
        ),
    )

    assert registry.match(candidate) is None
