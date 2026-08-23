import hashlib
import json
from decimal import Decimal
from pathlib import Path

from evaluation_harness.contracts import FactContract, TypedPeriod
from evaluation_harness.frontend_bundle import FRONTEND_BUNDLE_SCHEMA
from evaluation_harness.snapshot import SNAPSHOT_SCHEMA
from scripts.run_full_chronicle_evaluation import BE_SOURCE_IDS, run


def fact(key: str, record_id: str, value: str) -> FactContract:
    return FactContract(
        fact_key=f"ledger.aggregate_fact.v2:{key:0<24}",
        source="statbel_population_structure",
        jurisdiction="BE",
        period=TypedPeriod.parse("calendar_year:2026"),
        geography_level="country",
        geography_id="BE",
        entity="person",
        measure="statbel.population",
        unit="count",
        value=Decimal(value),
        dimensions={},
        universe_constraints=(),
        provenance_class="administrative",
        lineage={"source_record_id": record_id},
    )


def write_snapshot(path: Path, facts: tuple[FactContract, ...]) -> None:
    path.mkdir()
    content = "".join(f"{row.to_json()}\n" for row in facts)
    (path / "facts.jsonl").write_text(content)
    (path / "snapshot_manifest.json").write_text(
        json.dumps(
            {
                "schema_version": SNAPSHOT_SCHEMA,
                "snapshot_id": "chronicle-be-fixture",
                "fact_count": len(facts),
                "normalized_facts_sha256": hashlib.sha256(
                    content.encode()
                ).hexdigest(),
            }
        )
    )


def write_release(path: Path) -> None:
    release_id = "microcosm-be-fixture"
    release_path = path / "releases" / release_id
    release_path.mkdir(parents=True)
    documents = {
        "build_manifest.json": {
            "build_id": release_id,
            "chronicle": {"commit": "fixture-chronicle"},
        },
        "release_manifest.json": {"build": {"build_id": release_id}},
        "calibration_diagnostics.json": {
            "targets": [
                {
                    "metadata": {
                        "chronicle_record_ids": ["record-a", "record-b"]
                    }
                }
            ]
        },
    }
    for filename, payload in documents.items():
        (release_path / filename).write_text(json.dumps(payload))
    (path / "latest.json").write_text(
        json.dumps(
            {
                "schema_version": 1,
                "release_id": release_id,
                "paths": {
                    "build_manifest": (
                        f"releases/{release_id}/build_manifest.json"
                    ),
                    "release_manifest": (
                        f"releases/{release_id}/release_manifest.json"
                    ),
                    "calibration_diagnostics": (
                        f"releases/{release_id}/calibration_diagnostics.json"
                    ),
                },
            }
        )
    )


def checkpoint_payload(source_id: str, supported_second_row: bool) -> dict:
    labels = {
        "microcosm_be_v04_axiom": "Microcosm-BE v0.4 × Axiom rules engine",
        "microcosm_be_v04_euromod": "Microcosm-BE v0.4 × EUROMOD BE_2025",
        "euromod_be2025_jrc_silc": (
            "EUROMOD BE_2025 on EU-SILC (JRC country report 2025)"
        ),
    }
    first_basis = {
        "microcosm_be_v04_axiom": "dataset_weights",
        "microcosm_be_v04_euromod": "calibration_measure",
        "euromod_be2025_jrc_silc": "engine_simulated",
    }[source_id]
    second_basis = "engine_simulated" if supported_second_row else "unsupported"
    return {
        "schema_version": "microcosm_be.evaluation_source_checkpoint.v1",
        "source_id": source_id,
        "label": labels[source_id],
        "engine": f"{source_id}-engine",
        "dataset": f"{source_id}-dataset",
        "jurisdiction": "BE",
        "population_year": 2026,
        "provenance": "Fixture source provenance.",
        "inputs": {"chronicle_commit": "fixture-chronicle"},
        "rows": [
            {
                "row_key": "population_sum",
                "role": "target",
                "concept": "population sum",
                "period": 2026,
                "chronicle_record_ids": ["record-a", "record-b"],
                "benchmark_value": 30,
                "estimate": 31,
                "estimate_basis": first_basis,
                "unit": "persons",
                "note": "reviewed fixture estimate",
            },
            {
                "row_key": "population_validation",
                "role": "validation",
                "concept": "population validation",
                "period": 2026,
                "chronicle_record_ids": ["record-c"],
                "benchmark_value": 40,
                "estimate": 39 if supported_second_row else None,
                "estimate_basis": second_basis,
                "unit": "persons",
                "note": "reviewed fixture support decision",
            },
        ],
    }


def test_be_end_to_end_publishes_three_source_frontend_bundle(
    tmp_path: Path,
) -> None:
    snapshot = tmp_path / "snapshot"
    write_snapshot(
        snapshot,
        (
            fact("a", "record-a", "10"),
            fact("b", "record-b", "20"),
            fact("c", "record-c", "40"),
        ),
    )
    release = tmp_path / "release"
    write_release(release)
    checkpoints: list[Path] = []
    for source_id in BE_SOURCE_IDS:
        path = tmp_path / f"{source_id}.json"
        path.write_text(
            json.dumps(
                checkpoint_payload(
                    source_id,
                    supported_second_row=(
                        source_id != "euromod_be2025_jrc_silc"
                    ),
                )
            )
        )
        checkpoints.append(path)

    output = tmp_path / "run"
    run(
        snapshot,
        None,
        None,
        output,
        jurisdictions=["BE"],
        precomputed_checkpoints=checkpoints,
        microcosm_release_dir=release,
    )

    bundle = output / "frontend"
    manifest = json.loads((bundle / "manifest.json").read_text())
    assert manifest["schema_version"] == FRONTEND_BUNDLE_SCHEMA
    assert manifest["jurisdictions"] == ["BE"]
    assert manifest["source_ids"] == sorted(BE_SOURCE_IDS)
    assert manifest["fact_count"] == 3
    assert set(manifest["partitions"]) == {
        "summary",
        "groups",
        "fact_index",
        "facts",
    }
    summary = json.loads((bundle / "summary.json").read_text())
    assert [row["source_id"] for row in summary["sources"]] == sorted(
        BE_SOURCE_IDS
    )
    assert {row["result_count"] for row in summary["sources"]} == {1, 2}
    assert all("score" in row and "performance_buckets" in row for row in summary["sources"])
    for partition in (
        manifest["partitions"]["summary"],
        manifest["partitions"]["groups"],
        manifest["partitions"]["fact_index"],
        *manifest["partitions"]["facts"],
    ):
        assert hashlib.sha256((bundle / partition["path"]).read_bytes()).hexdigest() == partition["sha256"]
