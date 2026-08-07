from __future__ import annotations

import csv
import json
import zipfile
from decimal import Decimal
from pathlib import Path

import pyarrow.parquet as pq
import pytest

from evaluation_harness.adapters.acs_pums import (
    ACSPUMSRunner,
    DATASET_VERSION,
    REPLICATE_WEIGHT_NAMES,
    build_person_age_aggregates,
    estimate_with_sdr,
    execute_acs_pums,
)
from evaluation_harness.contracts import AggregateQuery
from evaluation_harness.execution import RunGroup, build_run_groups
from evaluation_harness.integration import load_integration_overview
from evaluation_harness.mappings import MappingRegistry
from evaluation_harness.planner import CapabilityPlanner


def _write_person_zip(
    path: Path, rows: list[dict[str, int]], *, split_members: bool = False
) -> None:
    columns = ["STATE", "AGEP", "PWGTP", *REPLICATE_WEIGHT_NAMES]
    with zipfile.ZipFile(path, "w", compression=zipfile.ZIP_DEFLATED) as archive:
        chunks = [rows]
        if split_members:
            midpoint = max(1, len(rows) // 2)
            chunks = [rows[:midpoint], rows[midpoint:]]
        for index, chunk in enumerate(chunks):
            csv_path = path.with_name(f"{path.stem}-{index}.csv")
            with csv_path.open("w", newline="") as stream:
                writer = csv.DictWriter(stream, fieldnames=columns)
                writer.writeheader()
                writer.writerows(chunk)
            archive.write(csv_path, arcname=f"psam_test_{index}.csv")


def _row(state: int, age: int, weight: int, replicate: int) -> dict[str, int]:
    return {
        "STATE": state,
        "AGEP": age,
        "PWGTP": weight,
        **{name: replicate for name in REPLICATE_WEIGHT_NAMES},
    }


@pytest.fixture
def aggregate_path(tmp_path: Path) -> Path:
    us = tmp_path / "csv_pus.zip"
    pr = tmp_path / "csv_ppr.zip"
    output = tmp_path / "acs_pums_person_age.parquet"
    _write_person_zip(
        us,
        [
            _row(1, 2, 10, 11),
            _row(6, 2, 20, 22),
            _row(6, 87, 3, 4),
        ],
        split_members=True,
    )
    _write_person_zip(pr, [_row(72, 2, 7, 8)])

    manifest = build_person_age_aggregates(us, pr, output)

    assert manifest["schema_version"] == "evaluation_harness.acs_pums_aggregate.v1"
    assert manifest["dataset_version"] == DATASET_VERSION
    assert manifest["row_count"] == 6
    assert len(manifest["inputs"]["us"]["sha256"]) == 64
    assert len(manifest["inputs"]["puerto_rico"]["sha256"]) == 64
    assert len(manifest["output_sha256"]) == 64
    assert json.loads(output.with_suffix(".manifest.json").read_text()) == manifest
    return output


def test_preprocessor_builds_lossless_state_and_us_age_cells(
    aggregate_path: Path,
) -> None:
    rows = pq.read_table(aggregate_path).to_pylist()
    values = {
        (row["__geography__"], row["age"]): row["PWGTP"] for row in rows
    }

    assert values == {
        ("0100000US", 2): 30,
        ("0100000US", 87): 3,
        ("0400000US01", 2): 10,
        ("0400000US06", 2): 20,
        ("0400000US06", 87): 3,
        ("0400000US72", 2): 7,
    }


def test_runner_exposes_direct_arrays_and_no_model(aggregate_path: Path) -> None:
    runner = ACSPUMSRunner(aggregate_path)
    bundle = runner.prepare(
        RunGroup(
            source_id="census_acs_pums_2024",
            population_period="calendar_year:2024",
            policy_period=None,
            geography_method="pums_state_or_country",
            entity="person",
            fact_keys=("fact",),
            required_variables=("PWGTP", "age"),
        )
    )

    assert bundle.dataset_version == DATASET_VERSION
    assert bundle.model_version is None
    assert set(bundle.domain_masks) == {"total_population"}
    assert {"__geography__", "age", "PWGTP", *REPLICATE_WEIGHT_NAMES} <= set(
        bundle.arrays
    )


def test_sdr_estimate_uses_all_eighty_replicate_weights(
    aggregate_path: Path,
) -> None:
    bundle = ACSPUMSRunner(aggregate_path).prepare(
        RunGroup(
            source_id="census_acs_pums_2024",
            population_period="calendar_year:2024",
            policy_period=None,
            geography_method="pums_state_or_country",
            entity="person",
            fact_keys=("fact",),
            required_variables=("PWGTP", "age"),
        )
    )
    query = AggregateQuery(
        operation="weighted_sum",
        value_expression="__ones__",
        weight="PWGTP",
        constraints=(
            {"dimension": "__geography__", "value": "0400000US06"},
            {"domain": "total_population"},
            {"variable": "age", "operator": "gte", "value": 0},
            {"variable": "age", "operator": "lt", "value": 5},
        ),
    )

    estimate = estimate_with_sdr(query, bundle)

    assert estimate.estimate == Decimal("20")
    assert estimate.standard_error == Decimal("4")
    assert estimate.margin_of_error_90 == Decimal("6.580")


def test_acs_execution_carries_uncertainty_into_the_shared_result_artifact(
    aggregate_path: Path,
) -> None:
    integration = Path(__file__).parents[1] / "integrations" / "census_acs_pums"
    overview = load_integration_overview(integration / "overview.yaml")
    california = next(
        fact
        for fact in overview.verification_facts
        if fact.geography_id == "0400000US06"
    )
    capability = CapabilityPlanner(
        MappingRegistry.from_yaml(integration / "mappings.yaml"),
        snapshot_id=overview.ledger_snapshot_id,
    ).classify(california, overview.source)

    result = execute_acs_pums(
        build_run_groups([capability]),
        [capability],
        ACSPUMSRunner(aggregate_path),
    )[0]

    assert result.estimate == Decimal("20")
    assert result.standard_error == Decimal("4")
    assert result.margin_of_error_90 == Decimal("6.580")
    assert result.model_version is None


@pytest.mark.parametrize(
    ("field", "value", "message"),
    [
        ("source_id", "another_source", "cannot execute"),
        ("population_period", "calendar_year:2023", "native 2024"),
        ("geography_method", "crosswalk", "state or country"),
        ("entity", "household", "person entity"),
    ],
)
def test_runner_rejects_undeclared_execution_surfaces(
    aggregate_path: Path, field: str, value: str, message: str
) -> None:
    arguments = {
        "source_id": "census_acs_pums_2024",
        "population_period": "calendar_year:2024",
        "policy_period": None,
        "geography_method": "pums_state_or_country",
        "entity": "person",
        "fact_keys": ("fact",),
        "required_variables": ("PWGTP", "age"),
    }
    arguments[field] = value

    with pytest.raises(ValueError, match=message):
        ACSPUMSRunner(aggregate_path).prepare(RunGroup(**arguments))
