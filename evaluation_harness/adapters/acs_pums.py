from __future__ import annotations

import hashlib
import json
import zipfile
from dataclasses import dataclass
from decimal import Decimal
from pathlib import Path
from typing import Iterable

import numpy as np
import pyarrow as pa
import pyarrow.csv as pacsv
import pyarrow.parquet as pq

from ..contracts import AggregateQuery, CapabilityResult
from ..execution import (
    ArrayBundle,
    EvaluationResult,
    RunGroup,
    _array,
    _mask,
    validate_results,
)


DATASET_VERSION = "census-acs-pums-2024-1y-person@2025-09-17"
AGGREGATE_SCHEMA = "evaluation_harness.acs_pums_aggregate.v2"
SOURCE_ID = "census_acs_pums_2024"
REPLICATE_WEIGHT_NAMES = tuple(f"PWGTP{index}" for index in range(1, 81))
WEIGHT_NAMES = ("PWGTP", *REPLICATE_WEIGHT_NAMES)
WAGE_VARIABLE = "WAGP"
WAGE_STATISTIC_NAMES = (
    WAGE_VARIABLE,
    *(f"{WAGE_VARIABLE}{index}" for index in range(1, 81)),
)
INPUT_COLUMNS = ("STATE", "AGEP", "ADJINC", WAGE_VARIABLE, *WEIGHT_NAMES)
MAX_STATE_CODE = 72
AGE_COUNT = 100
US_GEOID = "0100000US"
SUPPORTED_DOMAINS = frozenset(
    {
        "compensation_of_employees",
        "personal_income",
        "population_projection",
        "resident_population",
        "total_population",
    }
)


def _sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def _person_members(archive: zipfile.ZipFile, path: Path) -> tuple[str, ...]:
    members = sorted(
        name
        for name in archive.namelist()
        if name.lower().endswith(".csv") and Path(name).name.lower().startswith("psam_")
    )
    if not members:
        raise ValueError(
            f"PUMS archive {path} does not contain any psam_*.csv files"
        )
    return tuple(members)


def _record_batches(path: Path) -> Iterable[pa.RecordBatch]:
    column_types = {
        "STATE": pa.int16(),
        "AGEP": pa.int16(),
        "ADJINC": pa.int64(),
        WAGE_VARIABLE: pa.float64(),
        **{name: pa.int64() for name in WEIGHT_NAMES},
    }
    with zipfile.ZipFile(path) as archive:
        for member in _person_members(archive, path):
            with archive.open(member) as compressed_stream:
                reader = pacsv.open_csv(
                    pa.input_stream(compressed_stream),
                    read_options=pacsv.ReadOptions(
                        block_size=16 * 1024 * 1024,
                        use_threads=False,
                    ),
                    convert_options=pacsv.ConvertOptions(
                        include_columns=list(INPUT_COLUMNS),
                        column_types=column_types,
                    ),
                )
                for batch in reader:
                    yield batch


def _numpy(batch: pa.RecordBatch, name: str) -> np.ndarray:
    return batch.column(batch.schema.get_field_index(name)).to_numpy(
        zero_copy_only=False
    )


def _accumulate_archive(
    path: Path,
    state_totals: np.ndarray,
    state_wage_totals: np.ndarray,
    *,
    national_totals: np.ndarray | None,
    national_wage_totals: np.ndarray | None,
) -> int:
    record_count = 0
    state_cell_count = (MAX_STATE_CODE + 1) * AGE_COUNT
    for batch in _record_batches(path):
        states = _numpy(batch, "STATE").astype(np.int64, copy=False)
        ages = _numpy(batch, "AGEP").astype(np.int64, copy=False)
        adjustments = _numpy(batch, "ADJINC").astype(np.float64, copy=False)
        wages = np.nan_to_num(
            _numpy(batch, WAGE_VARIABLE).astype(np.float64, copy=False)
        ) * (adjustments / 1_000_000)
        if np.any(states < 0) or np.any(states > MAX_STATE_CODE):
            raise ValueError(f"PUMS archive {path} contains an invalid STATE code")
        if np.any(ages < 0) or np.any(ages >= AGE_COUNT):
            raise ValueError(f"PUMS archive {path} contains an invalid AGEP value")
        state_age = states * AGE_COUNT + ages
        for column_index, name in enumerate(WEIGHT_NAMES):
            weights = _numpy(batch, name).astype(np.float64, copy=False)
            state_totals[:, column_index] += np.bincount(
                state_age,
                weights=weights,
                minlength=state_cell_count,
            )
            state_wage_totals[:, column_index] += np.bincount(
                state_age,
                weights=weights * wages,
                minlength=state_cell_count,
            )
            if national_totals is not None:
                national_totals[:, column_index] += np.bincount(
                    ages,
                    weights=weights,
                    minlength=AGE_COUNT,
                )
            if national_wage_totals is not None:
                national_wage_totals[:, column_index] += np.bincount(
                    ages,
                    weights=weights * wages,
                    minlength=AGE_COUNT,
                )
        record_count += batch.num_rows
    return record_count


def _aggregate_rows(
    state_totals: np.ndarray,
    national_totals: np.ndarray,
    state_wage_totals: np.ndarray,
    national_wage_totals: np.ndarray,
) -> list[dict[str, int | str]]:
    rows: list[dict[str, int | str]] = []
    for age in range(AGE_COUNT):
        values = national_totals[age]
        wage_values = national_wage_totals[age]
        if np.any(values):
            rows.append(
                {
                    "__geography__": US_GEOID,
                    "age": age,
                    **{
                        name: int(round(values[index]))
                        for index, name in enumerate(WEIGHT_NAMES)
                    },
                    **{
                        name: int(round(wage_values[index]))
                        for index, name in enumerate(WAGE_STATISTIC_NAMES)
                    },
                }
            )
    for state in range(MAX_STATE_CODE + 1):
        for age in range(AGE_COUNT):
            values = state_totals[state * AGE_COUNT + age]
            wage_values = state_wage_totals[state * AGE_COUNT + age]
            if np.any(values):
                rows.append(
                    {
                        "__geography__": f"0400000US{state:02d}",
                        "age": age,
                        **{
                            name: int(round(values[index]))
                            for index, name in enumerate(WEIGHT_NAMES)
                        },
                        **{
                            name: int(round(wage_values[index]))
                            for index, name in enumerate(WAGE_STATISTIC_NAMES)
                        },
                    }
                )
    return rows


def build_person_age_aggregates(
    us_archive: str | Path,
    puerto_rico_archive: str | Path,
    output_path: str | Path,
) -> dict[str, object]:
    """Reduce raw PUMS person files to exact geography-by-single-age totals."""

    us_path = Path(us_archive)
    pr_path = Path(puerto_rico_archive)
    output = Path(output_path)
    for path in (us_path, pr_path):
        if not path.is_file():
            raise FileNotFoundError(f"PUMS input archive does not exist: {path}")
    if output.exists() or output.with_suffix(".manifest.json").exists():
        raise FileExistsError(f"PUMS aggregate output already exists: {output}")

    state_totals = np.zeros(
        ((MAX_STATE_CODE + 1) * AGE_COUNT, len(WEIGHT_NAMES)), dtype=np.float64
    )
    national_totals = np.zeros((AGE_COUNT, len(WEIGHT_NAMES)), dtype=np.float64)
    state_wage_totals = np.zeros_like(state_totals)
    national_wage_totals = np.zeros_like(national_totals)
    us_records = _accumulate_archive(
        us_path,
        state_totals,
        state_wage_totals,
        national_totals=national_totals,
        national_wage_totals=national_wage_totals,
    )
    pr_records = _accumulate_archive(
        pr_path,
        state_totals,
        state_wage_totals,
        national_totals=None,
        national_wage_totals=None,
    )
    rows = _aggregate_rows(
        state_totals,
        national_totals,
        state_wage_totals,
        national_wage_totals,
    )
    output.parent.mkdir(parents=True, exist_ok=True)
    pq.write_table(
        pa.Table.from_pylist(rows),
        output,
        compression="zstd",
        use_dictionary=["__geography__"],
    )
    manifest: dict[str, object] = {
        "schema_version": AGGREGATE_SCHEMA,
        "dataset_version": DATASET_VERSION,
        "inputs": {
            "us": {
                "filename": us_path.name,
                "sha256": _sha256(us_path),
                "record_count": us_records,
            },
            "puerto_rico": {
                "filename": pr_path.name,
                "sha256": _sha256(pr_path),
                "record_count": pr_records,
            },
        },
        "row_count": len(rows),
        "output_filename": output.name,
        "output_sha256": _sha256(output),
        "geography_grain": "country_or_state",
        "age_grain": "single_year",
        "weight_columns": list(WEIGHT_NAMES),
        "additive_statistics": {
            WAGE_VARIABLE: {
                "input_variable": WAGE_VARIABLE,
                "inflation_adjustment": "ADJINC / 1000000",
                "columns": list(WAGE_STATISTIC_NAMES),
                "replicate_method": "successive_difference_replication",
            }
        },
    }
    output.with_suffix(".manifest.json").write_text(
        json.dumps(manifest, indent=2, sort_keys=True) + "\n"
    )
    return manifest


@dataclass(frozen=True)
class SDREstimate:
    estimate: Decimal
    standard_error: Decimal
    margin_of_error_90: Decimal


def _decimal(value: np.generic | int | float) -> Decimal:
    if isinstance(value, np.generic):
        value = value.item()
    return Decimal(str(value))


def estimate_with_sdr(
    query: AggregateQuery,
    bundle: ArrayBundle,
) -> SDREstimate:
    """Evaluate one additive query and its 80 successive-difference replicates."""

    if query.operation != "weighted_sum":
        raise ValueError("ACS PUMS SDR execution currently supports weighted sums only")
    if query.weight != "PWGTP":
        raise ValueError("ACS PUMS SDR execution requires the PWGTP full-sample weight")
    required_names = (
        WAGE_STATISTIC_NAMES
        if query.value_expression == WAGE_VARIABLE
        else WEIGHT_NAMES
    )
    missing = [name for name in required_names if name not in bundle.arrays]
    if missing:
        raise ValueError(
            "ACS PUMS bundle is missing SDR columns: " + ", ".join(missing)
        )

    full_weights = np.asarray(bundle.arrays["PWGTP"])
    length = len(full_weights)
    mask = _mask(query, bundle, length)
    if query.value_expression == WAGE_VARIABLE:
        estimates = np.asarray(
            [
                np.sum(np.asarray(bundle.arrays[name])[mask])
                for name in WAGE_STATISTIC_NAMES
            ]
        )
    elif query.value_expression == "__ones__":
        values = np.ones(length, dtype=np.int64)
        weights = np.column_stack(
            [np.asarray(bundle.arrays[name]) for name in WEIGHT_NAMES]
        )
        estimates = np.sum(weights[mask] * values[mask, np.newaxis], axis=0)
    else:
        values = _array(bundle, query.value_expression, length)
        weights = np.column_stack(
            [np.asarray(bundle.arrays[name]) for name in WEIGHT_NAMES]
        )
        estimates = np.sum(weights[mask] * values[mask, np.newaxis], axis=0)
    point = _decimal(estimates[0])
    replicates = tuple(_decimal(value) for value in estimates[1:])
    variance = (Decimal(4) / Decimal(80)) * sum(
        ((replicate - point) ** 2 for replicate in replicates),
        start=Decimal(0),
    )
    standard_error = variance.sqrt()
    return SDREstimate(
        estimate=point,
        standard_error=standard_error,
        margin_of_error_90=standard_error * Decimal("1.645"),
    )


class ACSPUMSRunner:
    """Expose checksum-verified raw ACS PUMS aggregates to the shared harness."""

    def __init__(self, aggregate_path: str | Path) -> None:
        self.aggregate_path = Path(aggregate_path)
        self.manifest_path = self.aggregate_path.with_suffix(".manifest.json")
        self._table: pa.Table | None = None
        self._manifest = self._load_manifest()

    def _load_manifest(self) -> dict[str, object]:
        if not self.aggregate_path.is_file():
            raise FileNotFoundError(
                f"ACS PUMS aggregate file does not exist: {self.aggregate_path}"
            )
        if not self.manifest_path.is_file():
            raise FileNotFoundError(
                f"ACS PUMS aggregate manifest does not exist: {self.manifest_path}"
            )
        manifest = json.loads(self.manifest_path.read_text())
        if manifest.get("schema_version") != AGGREGATE_SCHEMA:
            raise ValueError("unsupported ACS PUMS aggregate manifest schema")
        if manifest.get("dataset_version") != DATASET_VERSION:
            raise ValueError("ACS PUMS aggregate dataset version is not pinned release")
        if manifest.get("output_sha256") != _sha256(self.aggregate_path):
            raise ValueError("ACS PUMS aggregate hash does not match its manifest")
        return manifest

    @property
    def input_manifest(self) -> dict[str, object]:
        return dict(self._manifest)

    def _load_table(self) -> pa.Table:
        if self._table is None:
            self._table = pq.read_table(self.aggregate_path)
            if self._table.num_rows != self._manifest.get("row_count"):
                raise ValueError("ACS PUMS aggregate row count does not match manifest")
        return self._table

    def prepare(self, group: RunGroup) -> ArrayBundle:
        if group.source_id != SOURCE_ID:
            raise ValueError(f"ACS PUMS runner cannot execute {group.source_id!r}")
        if group.population_period != "calendar_year:2024" or group.policy_period is not None:
            raise ValueError("ACS PUMS runner is pinned to native 2024 data")
        if group.geography_method != "pums_state_or_country":
            raise ValueError("ACS PUMS runner supports only PUMS state or country geography")
        if group.entity != "person":
            raise ValueError("ACS PUMS runner exposes only the person entity")

        table = self._load_table()
        required = {
            "__geography__",
            "age",
            "PWGTP",
            *group.required_variables,
            *REPLICATE_WEIGHT_NAMES,
        }
        if WAGE_VARIABLE in group.required_variables:
            required.update(WAGE_STATISTIC_NAMES)
        missing = sorted(required - set(table.column_names))
        if missing:
            raise ValueError(
                "ACS PUMS aggregate is missing required columns: "
                + ", ".join(missing)
            )
        arrays = {
            name: table[name].combine_chunks().to_numpy(zero_copy_only=False)
            for name in sorted(required)
        }
        length = table.num_rows
        return ArrayBundle(
            arrays=arrays,
            dataset_version=DATASET_VERSION,
            model_version=None,
            domain_masks={
                domain: np.ones(length, dtype=bool)
                for domain in SUPPORTED_DOMAINS
            },
        )


def execute_acs_pums(
    groups: Iterable[RunGroup],
    capabilities: Iterable[CapabilityResult],
    runner: ACSPUMSRunner,
) -> tuple[EvaluationResult, ...]:
    """Execute PUMS cells while retaining replicate-weight diagnostics."""

    capability_values = tuple(capabilities)
    by_cell = {
        (capability.source_id, capability.fact_key): capability
        for capability in capability_values
    }
    results: list[EvaluationResult] = []
    for group in groups:
        bundle = runner.prepare(group)
        for fact_key in group.fact_keys:
            capability = by_cell[(group.source_id, fact_key)]
            if capability.query is None:
                raise ValueError(
                    f"ACS PUMS execution received an unsupported fact {fact_key}"
                )
            diagnostic = estimate_with_sdr(capability.query, bundle)
            results.append(
                EvaluationResult.from_capability(
                    capability,
                    estimate=diagnostic.estimate,
                    dataset_version=bundle.dataset_version,
                    model_version=bundle.model_version,
                    standard_error=diagnostic.standard_error,
                    margin_of_error_90=diagnostic.margin_of_error_90,
                )
            )
    validate_results(capability_values, results)
    return tuple(results)
