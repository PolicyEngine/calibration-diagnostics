from __future__ import annotations

import hashlib
import json
from collections import Counter
from dataclasses import dataclass
from decimal import Decimal
from pathlib import Path
from typing import Any, Iterable

from .contracts import FactContract, TypedPeriod


# Deprecated upstream identifiers: Chronicle's current consumer export keeps
# the former Ledger schema names until that producer contract is migrated.
CONSUMER_SCHEMA = "ledger.consumer_fact.v1"
CONSUMER_ARTIFACT_SCHEMA = "policyengine_ledger.consumer_artifact.v1"
SNAPSHOT_SCHEMA = "evaluation_harness.chronicle_snapshot.v1"

REQUIRED_ROW_KEYS = {
    "schema_version",
    "aggregate_fact_key",
    "semantic_fact_key",
    "value",
    "value_type",
    "assertion",
    "provenance_class",
    "period",
    "geography",
    "entity",
    "aggregation",
    "observed_measure",
    "dimensions",
    "universe_constraints",
    "source",
    "lineage",
}

UK_SOURCES = {
    "dwp",
    "hmrc",
    "obr",
    "ons",
}


@dataclass(frozen=True)
class CompiledSnapshot:
    output_path: Path
    manifest: dict[str, Any]


@dataclass(frozen=True)
class SnapshotDiff:
    from_snapshot: str
    to_snapshot: str
    added: tuple[str, ...]
    removed: tuple[str, ...]
    changed_values: tuple[str, ...]
    changed_definitions: tuple[str, ...]
    key_churn: tuple[tuple[str, str, str], ...]

    def to_dict(self) -> dict[str, Any]:
        return {
            "from_snapshot": self.from_snapshot,
            "to_snapshot": self.to_snapshot,
            "added": list(self.added),
            "removed": list(self.removed),
            "changed_values": list(self.changed_values),
            "changed_definitions": list(self.changed_definitions),
            "key_churn": [
                {"semantic_fact_key": semantic, "from": old, "to": new}
                for semantic, old, new in self.key_churn
            ],
        }


def _sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def _canonical_json(payload: Any) -> str:
    return json.dumps(payload, sort_keys=True, separators=(",", ":"))


def _source_package_id(source: dict[str, Any]) -> str | None:
    """Return Chronicle's source id from consumer-export source metadata.

    Newer producer rows may expose ``source_id`` directly.  The current
    consumer export omits it, but retains the same value as the namespace in
    its canonical ``raw/{source_id}/...`` artifact key.
    """

    source_id = source.get("source_id")
    if isinstance(source_id, str) and source_id:
        return source_id
    raw_key = source.get("raw_r2_key")
    if not isinstance(raw_key, str):
        return None
    parts = raw_key.split("/")
    if len(parts) >= 2 and parts[0] == "raw" and parts[1]:
        return parts[1]
    return None


def _jurisdiction(
    source_name: str,
    source: dict[str, Any],
    geography: dict[str, Any],
    dimensions: dict[str, Any],
) -> str:
    geography_id = str(geography["id"])
    source_root = source_name.split(".", 1)[0]
    if source_root in UK_SOURCES or geography_id.startswith(("K0", "E0", "W0", "S0", "N0")):
        return "UK"
    # Belgium is inferred only from evidence carried by Chronicle's producer
    # contracts: the package source id, Eurostat's geo dimension, or a Belgian
    # NIS geography vintage.  In particular, neither a source-name guess nor a
    # bare geography-id prefix is sufficient.
    source_package_id = _source_package_id(source)
    geography_vintage = str(geography.get("vintage", ""))
    if (
        source_package_id == "belgium"
        or (source_root == "eurostat" and dimensions.get("geo") == "BE")
        or geography_vintage.casefold().startswith("nis_")
    ):
        return "BE"
    if "US" in geography_id:
        return "US"
    return "unknown"


def _constraints(payload: dict[str, Any]) -> tuple[Any, ...]:
    values: list[Any] = []
    domain = payload.get("domain")
    if domain is not None:
        values.append({"domain": domain})
    values.extend(payload.get("constraints", []))
    return tuple(values)


def _normalize_row(row: dict[str, Any], line_number: int) -> FactContract:
    missing = sorted(REQUIRED_ROW_KEYS - set(row))
    if missing:
        raise ValueError(f"consumer fact row {line_number} is missing required keys: {missing}")
    if row["schema_version"] != CONSUMER_SCHEMA:
        raise ValueError(
            f"unsupported consumer fact schema on row {line_number}: "
            f"{row['schema_version']!r}"
        )
    period = row["period"]
    geography = row["geography"]
    observed = row["observed_measure"]
    source = row["source"]
    source_name = observed["source_name"]
    concept = row.get("concept_alignment", {}).get("canonical_concept")
    measure = concept or observed["source_concept"]
    return FactContract(
        fact_key=row["aggregate_fact_key"],
        semantic_fact_key=row["semantic_fact_key"],
        source=source_name,
        jurisdiction=_jurisdiction(source_name, source, geography, row["dimensions"]),
        period=TypedPeriod(kind=period["type"], value=str(period["value"])),
        geography_level=geography["level"],
        geography_id=geography["id"],
        entity=row["entity"]["name"],
        measure=measure,
        unit=observed["unit"],
        value=Decimal(str(row["value"])),
        dimensions=dict(row["dimensions"]),
        universe_constraints=_constraints(row["universe_constraints"]),
        provenance_class=row["provenance_class"],
        assertion=row["assertion"],
        aggregation=dict(row["aggregation"]),
        observed_measure=dict(observed),
        source_metadata=dict(source),
        lineage=dict(row["lineage"]),
        label=row.get("label"),
    )


def _facts_path(path: Path) -> Path:
    if path.is_dir():
        candidate = path / "consumer_facts.jsonl"
        if not candidate.exists():
            raise FileNotFoundError(f"no consumer_facts.jsonl in Chronicle bundle {path}")
        return candidate
    return path


def _load_input_manifest(bundle_or_file: Path, facts_path: Path) -> dict[str, Any]:
    manifest_path = bundle_or_file / "manifest.json" if bundle_or_file.is_dir() else None
    if manifest_path is None or not manifest_path.exists():
        return {
            "chronicle_commit": None,
            "chronicle_release": None,
            "input_manifest_sha256": None,
        }
    manifest = json.loads(manifest_path.read_text())
    if manifest.get("schema_version") != CONSUMER_ARTIFACT_SCHEMA:
        raise ValueError(f"unsupported Chronicle artifact schema: {manifest.get('schema_version')!r}")
    actual_hash = _sha256(facts_path)
    if manifest.get("facts_sha256") != actual_hash:
        raise ValueError(
            "Chronicle consumer facts hash does not match manifest: "
            f"{actual_hash} != {manifest.get('facts_sha256')}"
        )
    return {
        # Deprecated upstream identifiers: older Chronicle manifests may carry
        # the former Ledger field names; normalize them at this boundary.
        "chronicle_commit": manifest.get("ledger_commit"),
        "chronicle_release": manifest.get("ledger_release"),
        "input_manifest_sha256": _sha256(manifest_path),
        "declared_fact_count": manifest.get("fact_row_count"),
    }


def load_consumer_rows(path: str | Path) -> tuple[list[FactContract], dict[str, Any]]:
    input_path = Path(path)
    facts_path = _facts_path(input_path)
    metadata = _load_input_manifest(input_path, facts_path)
    facts: list[FactContract] = []
    keys: set[str] = set()
    with facts_path.open() as stream:
        for line_number, line in enumerate(stream, start=1):
            if not line.strip():
                continue
            fact = _normalize_row(json.loads(line), line_number)
            if fact.fact_key in keys:
                raise ValueError(
                    f"duplicate aggregate_fact_key on row {line_number}: {fact.fact_key}"
                )
            keys.add(fact.fact_key)
            facts.append(fact)
    declared = metadata.get("declared_fact_count")
    if declared is not None and declared != len(facts):
        raise ValueError(
            f"Chronicle manifest declares {declared} rows but consumer file contains {len(facts)}"
        )
    metadata["facts_sha256"] = _sha256(facts_path)
    metadata["fact_count"] = len(facts)
    return facts, metadata


def _count(facts: Iterable[FactContract], attribute: str) -> dict[str, int]:
    return dict(sorted(Counter(str(getattr(fact, attribute)) for fact in facts).items()))


def compile_snapshot(
    bundle_or_file: str | Path,
    output_path: str | Path,
) -> CompiledSnapshot:
    output = Path(output_path)
    if output.exists():
        raise FileExistsError(f"snapshot output already exists: {output}")
    facts, input_metadata = load_consumer_rows(bundle_or_file)
    facts = sorted(facts, key=lambda fact: fact.fact_key)
    normalized_lines = "".join(fact.to_json() + "\n" for fact in facts)
    normalized_sha = hashlib.sha256(normalized_lines.encode()).hexdigest()
    identity = {
        "consumer_schema": CONSUMER_SCHEMA,
        "input_facts_sha256": input_metadata["facts_sha256"],
        "normalized_facts_sha256": normalized_sha,
        "chronicle_commit": input_metadata.get("chronicle_commit"),
        "chronicle_release": input_metadata.get("chronicle_release"),
    }
    snapshot_id = "chronicle-" + hashlib.sha256(_canonical_json(identity).encode()).hexdigest()[:24]
    manifest = {
        "schema_version": SNAPSHOT_SCHEMA,
        "snapshot_id": snapshot_id,
        "consumer_schema_version": CONSUMER_SCHEMA,
        "fact_count": len(facts),
        "facts_sha256": input_metadata["facts_sha256"],
        "normalized_facts_sha256": normalized_sha,
        "chronicle_commit": input_metadata.get("chronicle_commit"),
        "chronicle_release": input_metadata.get("chronicle_release"),
        "input_manifest_sha256": input_metadata.get("input_manifest_sha256"),
    }
    summary = {
        "snapshot_id": snapshot_id,
        "fact_count": len(facts),
        "by_jurisdiction": _count(facts, "jurisdiction"),
        "by_source": _count(facts, "source"),
        "by_period": dict(sorted(Counter(fact.period.canonical for fact in facts).items())),
        "by_geography": _count(facts, "geography_level"),
        "by_entity": _count(facts, "entity"),
        "by_unit": _count(facts, "unit"),
    }
    output.mkdir(parents=True)
    (output / "facts.jsonl").write_text(normalized_lines)
    (output / "catalog_summary.json").write_text(json.dumps(summary, indent=2, sort_keys=True) + "\n")
    (output / "snapshot_manifest.json").write_text(
        json.dumps(manifest, indent=2, sort_keys=True) + "\n"
    )
    return CompiledSnapshot(output_path=output, manifest=manifest)


def _load_snapshot(path: Path) -> tuple[dict[str, Any], dict[str, FactContract]]:
    manifest = json.loads((path / "snapshot_manifest.json").read_text())
    if manifest.get("schema_version") != SNAPSHOT_SCHEMA:
        raise ValueError(f"unsupported evaluation snapshot schema: {manifest.get('schema_version')!r}")
    facts_path = path / "facts.jsonl"
    if _sha256(facts_path) != manifest["normalized_facts_sha256"]:
        raise ValueError("normalized snapshot fact hash does not match manifest")
    facts = {
        fact.fact_key: fact
        for fact in (
            FactContract.from_dict(json.loads(line))
            for line in facts_path.read_text().splitlines()
            if line.strip()
        )
    }
    return manifest, facts


def diff_snapshots(from_path: str | Path, to_path: str | Path) -> SnapshotDiff:
    old_manifest, old = _load_snapshot(Path(from_path))
    new_manifest, new = _load_snapshot(Path(to_path))
    removed_candidates = old.keys() - new.keys()
    added_candidates = new.keys() - old.keys()

    def churn_fingerprint(fact: FactContract) -> str:
        return _canonical_json(
            {
                "semantic_fact_key": fact.semantic_fact_key,
                "source": fact.source,
                "jurisdiction": fact.jurisdiction,
                "period": fact.period.canonical,
                "geography_level": fact.geography_level,
                "geography_id": fact.geography_id,
                "entity": fact.entity,
                "measure": fact.measure,
                "unit": fact.unit,
                "dimensions": fact.dimensions,
                "universe_constraints": list(fact.universe_constraints),
                "aggregation": fact.aggregation,
            }
        )

    old_fingerprints: dict[str, list[str]] = {}
    new_fingerprints: dict[str, list[str]] = {}
    for key in removed_candidates:
        old_fingerprints.setdefault(churn_fingerprint(old[key]), []).append(key)
    for key in added_candidates:
        new_fingerprints.setdefault(churn_fingerprint(new[key]), []).append(key)
    churn_values: list[tuple[str, str, str]] = []
    for fingerprint in old_fingerprints.keys() & new_fingerprints.keys():
        old_keys = old_fingerprints[fingerprint]
        new_keys = new_fingerprints[fingerprint]
        if len(old_keys) == 1 and len(new_keys) == 1:
            old_key = old_keys[0]
            new_key = new_keys[0]
            semantic = old[old_key].semantic_fact_key or fingerprint
            churn_values.append((semantic, old_key, new_key))
    churn = tuple(sorted(churn_values))
    churn_old = {old_key for _, old_key, _ in churn}
    churn_new = {new_key for _, _, new_key in churn}
    common = old.keys() & new.keys()

    def definition(fact: FactContract) -> dict[str, Any]:
        value = fact.to_dict()
        value.pop("value", None)
        return value

    return SnapshotDiff(
        from_snapshot=old_manifest["snapshot_id"],
        to_snapshot=new_manifest["snapshot_id"],
        added=tuple(sorted((new.keys() - old.keys()) - churn_new)),
        removed=tuple(sorted((old.keys() - new.keys()) - churn_old)),
        changed_values=tuple(sorted(key for key in common if old[key].value != new[key].value)),
        changed_definitions=tuple(
            sorted(key for key in common if definition(old[key]) != definition(new[key]))
        ),
        key_churn=churn,
    )
