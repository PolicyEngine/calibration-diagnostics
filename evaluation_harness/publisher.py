from __future__ import annotations

import hashlib
import json
from dataclasses import asdict
from decimal import Decimal
from enum import Enum
from pathlib import Path
from typing import Any, Iterable

import pyarrow as pa
import pyarrow.parquet as pq

from .contracts import AlignedFact, CapabilityResult, PeriodTreatment, TypedPeriod
from .execution import EvaluationResult, validate_results


RUN_SCHEMA = "evaluation_harness.run.v2"


def _json_value(value: Any) -> Any:
    if isinstance(value, Enum):
        return value.value
    if isinstance(value, TypedPeriod):
        return value.canonical
    if isinstance(value, Decimal):
        return str(value)
    if isinstance(value, dict):
        return {key: _json_value(item) for key, item in value.items()}
    if isinstance(value, (list, tuple)):
        return [_json_value(item) for item in value]
    return value


def _rows(values: Iterable[Any]) -> list[dict[str, Any]]:
    return [_json_value(asdict(value)) for value in values]


def _jsonl(rows: list[dict[str, Any]]) -> str:
    return "".join(json.dumps(row, sort_keys=True, separators=(",", ":")) + "\n" for row in rows)


def _parquet_rows(rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
    output: list[dict[str, Any]] = []
    for row in rows:
        output.append(
            {
                key: (
                    json.dumps(value, sort_keys=True, separators=(",", ":"))
                    if isinstance(value, (dict, list))
                    else value
                )
                for key, value in row.items()
            }
        )
    return output


def publish_run(
    output_path: str | Path,
    capabilities: Iterable[CapabilityResult],
    results: Iterable[EvaluationResult],
    aligned_facts: Iterable[AlignedFact] = (),
    *,
    scores: Iterable[Any] = (),
    summary: dict[str, Any] | None = None,
) -> dict[str, Any]:
    output = Path(output_path)
    if output.exists():
        raise FileExistsError(f"run output already exists: {output}")
    capability_values = tuple(capabilities)
    result_values = tuple(results)
    alignment_values = tuple(aligned_facts)
    score_values = tuple(scores)
    validate_results(capability_values, result_values)
    alignment_ids = [alignment.alignment_id for alignment in alignment_values]
    if len(alignment_ids) != len(set(alignment_ids)):
        raise ValueError("duplicate aligned fact IDs")
    declared_ids = set(alignment_ids)
    for capability in capability_values:
        if (
            capability.period_treatment is PeriodTreatment.ALIGNED_FACT
            and capability.alignment_id not in declared_ids
        ):
            raise ValueError(
                f"aligned capability has no published aligned fact: {capability.fact_key}"
            )
    capability_rows = _rows(capability_values)
    result_rows = _rows(result_values)
    alignment_rows = _rows(alignment_values)
    score_rows = _rows(score_values)
    capability_jsonl = _jsonl(capability_rows)
    result_jsonl = _jsonl(result_rows)
    alignment_jsonl = _jsonl(alignment_rows)
    score_jsonl = _jsonl(score_rows)
    summary_value = _json_value(summary or {})
    summary_json = json.dumps(summary_value, indent=2, sort_keys=True) + "\n"
    capability_sha = hashlib.sha256(capability_jsonl.encode()).hexdigest()
    result_sha = hashlib.sha256(result_jsonl.encode()).hexdigest()
    alignment_sha = hashlib.sha256(alignment_jsonl.encode()).hexdigest()
    score_sha = hashlib.sha256(score_jsonl.encode()).hexdigest()
    summary_sha = hashlib.sha256(summary_json.encode()).hexdigest()
    run_id = "evaluation-" + hashlib.sha256(
        f"{capability_sha}:{result_sha}:{alignment_sha}:{score_sha}:{summary_sha}".encode()
    ).hexdigest()[:24]
    manifest = {
        "schema_version": RUN_SCHEMA,
        "run_id": run_id,
        "snapshot_ids": sorted({row.snapshot_id for row in capability_values}),
        "mapping_releases": sorted({row.mapping_release for row in capability_values}),
        "capability_count": len(capability_rows),
        "result_count": len(result_rows),
        "alignment_count": len(alignment_rows),
        "score_count": len(score_rows),
        "capabilities_sha256": capability_sha,
        "estimates_sha256": result_sha,
        "alignments_sha256": alignment_sha,
        "scores_sha256": score_sha,
        "summary_sha256": summary_sha,
    }
    output.mkdir(parents=True)
    (output / "capabilities.jsonl").write_text(capability_jsonl)
    (output / "estimates.jsonl").write_text(result_jsonl)
    (output / "alignments.jsonl").write_text(alignment_jsonl)
    (output / "scores.jsonl").write_text(score_jsonl)
    (output / "summary.json").write_text(summary_json)
    pq.write_table(pa.Table.from_pylist(_parquet_rows(capability_rows)), output / "capabilities.parquet")
    pq.write_table(pa.Table.from_pylist(_parquet_rows(result_rows)), output / "estimates.parquet")
    if alignment_rows:
        pq.write_table(
            pa.Table.from_pylist(_parquet_rows(alignment_rows)),
            output / "alignments.parquet",
        )
    if score_rows:
        pq.write_table(
            pa.Table.from_pylist(_parquet_rows(score_rows)),
            output / "scores.parquet",
        )
    (output / "run_manifest.json").write_text(
        json.dumps(manifest, indent=2, sort_keys=True) + "\n"
    )
    return manifest
