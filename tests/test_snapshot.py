import hashlib
import json
from copy import deepcopy
from pathlib import Path

import pytest

from evaluation_harness.snapshot import (
    SnapshotDiff,
    compile_snapshot,
    diff_snapshots,
    load_consumer_rows,
)


def consumer_row(
    fact_key: str,
    *,
    semantic_key: str = "ledger.semantic_fact.v2:111111111111111111111111",
    value: int | str = 100,
    period_type: str = "tax_year",
    period_value: int | str = 2023,
    geography_level: str = "country",
    geography_id: str = "0100000US",
    unit: str = "usd",
    source_name: str = "irs_soi",
    measure_id: str = "adjusted_gross_income",
) -> dict:
    return {
        "schema_version": "ledger.consumer_fact.v1",
        "aggregate_fact_key": fact_key,
        "semantic_fact_key": semantic_key,
        "legacy_fact_key": "ledger.fact.v1:222222222222222222222222",
        "source_release_key": "ledger.source_release.v2:333333333333333333333333",
        "source_series_key": "ledger.source_series.v2:444444444444444444444444",
        "observed_measure_key": "ledger.observed_measure.v2:555555555555555555555555",
        "dimension_set_key": "ledger.dimension_set.v2:666666666666666666666666",
        "universe_constraint_set_key": "ledger.universe_constraint_set.v2:777777777777777777777777",
        "value": value,
        "value_type": "integer",
        "assertion": "observation",
        "provenance_class": "administrative",
        "period": {"type": period_type, "value": period_value},
        "geography": {"level": geography_level, "id": geography_id},
        "entity": {"name": "tax_unit", "role": "filing_unit"},
        "aggregation": {"method": "sum"},
        "observed_measure": {
            "source_name": source_name,
            "source_table": "Table 1.1",
            "source_measure_id": measure_id,
            "source_concept": f"{source_name}.{measure_id}",
            "unit": unit,
        },
        "dimensions": {"filing_status": "all", "income_range": "all"},
        "universe_constraints": {
            "domain": "all_individual_income_tax_returns",
            "constraints": [{"variable": "is_filer", "operator": "eq", "value": True}],
        },
        "source": {
            "source_name": source_name,
            "source_table": "Table 1.1",
            "source_file": "source.xlsx",
            "vintage": "tax_year_2023",
            "extracted_at": "2026-08-01",
            "extraction_method": "fixture",
            "source_sha256": "a" * 64,
            "source_size_bytes": 10,
            "raw_r2_uri": "r2://ledger-raw/source.xlsx",
        },
        "lineage": {
            "source_record_id": "table.row.measure",
            "source_cell_keys": ["ledger.source_cell.v1:888888888888888888888888"],
            "source_row_keys": [],
        },
        "label": "Adjusted gross income",
    }


def write_bundle(path: Path, rows: list[dict], *, with_manifest: bool = True) -> Path:
    path.mkdir()
    facts = path / "consumer_facts.jsonl"
    facts.write_text("".join(json.dumps(row, sort_keys=True) + "\n" for row in rows))
    if with_manifest:
        (path / "manifest.json").write_text(
            json.dumps(
                {
                    "schema_version": "policyengine_ledger.consumer_artifact.v1",
                    "consumer_fact_schema_versions": ["ledger.consumer_fact.v1"],
                    "fact_row_count": len(rows),
                    "facts_sha256": hashlib.sha256(facts.read_bytes()).hexdigest(),
                    "ledger_commit": "ledger-commit-1",
                    "ledger_release": "ledger-release-1",
                }
            )
        )
    return path


def test_load_consumer_rows_supports_real_ledger_shape(tmp_path: Path) -> None:
    bundle = write_bundle(
        tmp_path / "bundle",
        [
            consumer_row("ledger.aggregate_fact.v2:aaaaaaaaaaaaaaaaaaaaaaaa"),
            consumer_row(
                "ledger.aggregate_fact.v2:bbbbbbbbbbbbbbbbbbbbbbbb",
                semantic_key="ledger.semantic_fact.v2:999999999999999999999999",
                value="-25.5",
                period_type="month",
                period_value="2024-12",
                geography_level="state",
                geography_id="0400000US06",
                unit="count",
                source_name="cms_medicaid",
                measure_id="enrollment",
            ),
        ],
    )
    facts, metadata = load_consumer_rows(bundle)
    assert len(facts) == 2
    assert facts[0].fact_key.startswith("ledger.aggregate_fact.v2:")
    assert facts[0].source == "irs_soi"
    assert facts[0].lineage["source_record_id"] == "table.row.measure"
    assert facts[1].period.canonical == "month:2024-12"
    assert facts[1].geography_level == "state"
    assert metadata["ledger_commit"] == "ledger-commit-1"


def test_load_rejects_unknown_consumer_schema(tmp_path: Path) -> None:
    row = consumer_row("ledger.aggregate_fact.v2:aaaaaaaaaaaaaaaaaaaaaaaa")
    row["schema_version"] = "ledger.consumer_fact.v2"
    bundle = write_bundle(tmp_path / "bundle", [row], with_manifest=False)
    with pytest.raises(ValueError, match="schema"):
        load_consumer_rows(bundle)


def test_load_rejects_duplicate_aggregate_fact_keys(tmp_path: Path) -> None:
    row = consumer_row("ledger.aggregate_fact.v2:aaaaaaaaaaaaaaaaaaaaaaaa")
    bundle = write_bundle(tmp_path / "bundle", [row, deepcopy(row)], with_manifest=False)
    with pytest.raises(ValueError, match="duplicate"):
        load_consumer_rows(bundle)


def test_load_rejects_manifest_hash_mismatch(tmp_path: Path) -> None:
    bundle = write_bundle(
        tmp_path / "bundle",
        [consumer_row("ledger.aggregate_fact.v2:aaaaaaaaaaaaaaaaaaaaaaaa")],
    )
    manifest_path = bundle / "manifest.json"
    manifest = json.loads(manifest_path.read_text())
    manifest["facts_sha256"] = "0" * 64
    manifest_path.write_text(json.dumps(manifest))
    with pytest.raises(ValueError, match="hash"):
        load_consumer_rows(bundle)


def test_compile_snapshot_writes_immutable_catalog(tmp_path: Path) -> None:
    bundle = write_bundle(
        tmp_path / "bundle",
        [consumer_row("ledger.aggregate_fact.v2:aaaaaaaaaaaaaaaaaaaaaaaa")],
    )
    output = tmp_path / "snapshot"
    compiled = compile_snapshot(bundle, output)
    assert compiled.manifest["fact_count"] == 1
    assert compiled.manifest["snapshot_id"].startswith("ledger-")
    assert (output / "facts.jsonl").exists()
    assert json.loads((output / "catalog_summary.json").read_text())["by_source"] == {
        "irs_soi": 1
    }
    with pytest.raises(FileExistsError):
        compile_snapshot(bundle, output)


def test_snapshot_diff_reports_values_additions_removals_and_key_churn(tmp_path: Path) -> None:
    old_a = consumer_row("ledger.aggregate_fact.v2:aaaaaaaaaaaaaaaaaaaaaaaa", value=100)
    old_b = consumer_row(
        "ledger.aggregate_fact.v2:bbbbbbbbbbbbbbbbbbbbbbbb",
        semantic_key="ledger.semantic_fact.v2:bbbbbbbbbbbbbbbbbbbbbbbb",
        value=50,
    )
    new_a = deepcopy(old_a)
    new_a["value"] = 125
    churned_b = deepcopy(old_b)
    churned_b["aggregate_fact_key"] = "ledger.aggregate_fact.v2:cccccccccccccccccccccccc"
    added = consumer_row(
        "ledger.aggregate_fact.v2:dddddddddddddddddddddddd",
        semantic_key="ledger.semantic_fact.v2:dddddddddddddddddddddddd",
        value=10,
    )
    old = write_bundle(tmp_path / "old", [old_a, old_b], with_manifest=False)
    new = write_bundle(tmp_path / "new", [new_a, churned_b, added], with_manifest=False)
    old_snapshot = compile_snapshot(old, tmp_path / "old-snapshot")
    new_snapshot = compile_snapshot(new, tmp_path / "new-snapshot")
    result = diff_snapshots(old_snapshot.output_path, new_snapshot.output_path)
    assert result.changed_values == (old_a["aggregate_fact_key"],)
    assert result.changed_definitions == ()
    assert result.key_churn == (
        (
            old_b["semantic_fact_key"],
            old_b["aggregate_fact_key"],
            churned_b["aggregate_fact_key"],
        ),
    )
    assert added["aggregate_fact_key"] in result.added
    assert old_b["aggregate_fact_key"] not in result.removed


def test_snapshot_diff_disambiguates_repeated_semantic_keys_for_key_churn(
    tmp_path: Path,
) -> None:
    semantic = "ledger.semantic_fact.v2:aaaaaaaaaaaaaaaaaaaaaaaa"
    old_state = consumer_row(
        "ledger.aggregate_fact.v2:aaaaaaaaaaaaaaaaaaaaaaaa",
        semantic_key=semantic,
        geography_level="state",
        geography_id="0400000US06",
    )
    country = consumer_row(
        "ledger.aggregate_fact.v2:bbbbbbbbbbbbbbbbbbbbbbbb",
        semantic_key=semantic,
    )
    new_state = deepcopy(old_state)
    new_state["aggregate_fact_key"] = "ledger.aggregate_fact.v2:cccccccccccccccccccccccc"
    old = compile_snapshot(
        write_bundle(tmp_path / "old-duplicate", [old_state, country], with_manifest=False),
        tmp_path / "old-duplicate-snapshot",
    )
    new = compile_snapshot(
        write_bundle(tmp_path / "new-duplicate", [country, new_state], with_manifest=False),
        tmp_path / "new-duplicate-snapshot",
    )
    result = diff_snapshots(old.output_path, new.output_path)
    assert result.key_churn == (
        (
            semantic,
            old_state["aggregate_fact_key"],
            new_state["aggregate_fact_key"],
        ),
    )
