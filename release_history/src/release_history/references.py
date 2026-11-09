"""Official references for baseline items and reforms.

`countries/<code>/references.yaml` gives each baseline item and reform one of:

- `chronicle_records`: Chronicle source-record ids (a list is summed), resolved
  from a pinned Chronicle consumer artifact;
- `citation`: a publication, row and period, for a source Chronicle does not
  hold yet (HMRC's ready reckoner, JCT and CBO documents). It gains a value
  once Chronicle ingests the source;
- `none`: a reason there is no official figure (2026-27 poverty, say).

The UK consumer artifact is millions of rows and built locally, so references
are resolved once, by `release-history resolve-references`, into a committed
`references.lock.json`. Publisher figures are never typed by hand: every value
in the lock comes from the artifact, with its record id, semantic fact key and
the artifact's digests. Runs only read the lock. References are not part of
the panel id, so updating them never forces a re-measurement.
"""

from __future__ import annotations

import json
from collections.abc import Iterable, Mapping
from pathlib import Path
from typing import Any

import yaml

from release_history import SCHEMA_VERSION
from release_history.canonical import file_sha256, json_sha256
from release_history.spec import Spec, countries_dir, jsonable

BASES = ("outturn", "forecast", "post_behavioural", "partial", "approximation", "mechanical")


class ReferenceError_(ValueError):
    """A references file that does not cover or match its spec."""


def load_references(country: str, root: Path | None = None) -> dict[str, Any]:
    path = (root or countries_dir()) / country / "references.yaml"
    if not path.is_file():
        raise ReferenceError_(f"No references at {path}.")
    with path.open(encoding="utf-8") as stream:
        return jsonable(yaml.safe_load(stream))


def references_digest(references: Mapping[str, Any]) -> str:
    return json_sha256(references)


def _entry_kind(entry: Mapping[str, Any], where: str) -> str:
    kinds = [k for k in ("chronicle_records", "citation", "none") if k in entry]
    if len(kinds) != 1:
        raise ReferenceError_(f"{where}: needs exactly one of chronicle_records, citation, none.")
    if entry.get("basis") is not None and entry["basis"] not in BASES:
        raise ReferenceError_(f"{where}: basis '{entry['basis']}' must be one of {BASES}.")
    return kinds[0]


def validate_references(spec: Spec, references: Mapping[str, Any]) -> list[str]:
    """Every baseline item and reform has exactly one entry, and nothing else does."""
    problems: list[str] = []
    if references.get("schema_version") != SCHEMA_VERSION:
        problems.append(f"references schema_version must be {SCHEMA_VERSION}")
    if references.get("country") != spec.country:
        problems.append("references country differs from the spec's")
    for section, ids in (
        ("baseline", [item.id for item in spec.baseline]),
        ("reforms", [reform.id for reform in spec.reforms]),
    ):
        entries = references.get(section) or {}
        for missing in sorted(set(ids) - set(entries)):
            problems.append(f"{section}.{missing}: no reference entry")
        for extra in sorted(set(entries) - set(ids)):
            problems.append(f"{section}.{extra}: not in the spec")
        for key, entry in entries.items():
            try:
                kind = _entry_kind(entry or {}, f"{section}.{key}")
            except ReferenceError_ as error:
                problems.append(str(error))
                continue
            if kind == "chronicle_records" and not references.get("chronicle"):
                problems.append(f"{section}.{key}: chronicle_records need a chronicle pin")
    return problems


def _wanted(references: Mapping[str, Any]) -> set[str]:
    wanted = set()
    for section in ("baseline", "reforms"):
        for entry in (references.get(section) or {}).values():
            wanted.update(entry.get("chronicle_records") or [])
    return wanted


def scan_facts(lines: Iterable[bytes], wanted: set[str]) -> dict[str, list[dict[str, Any]]]:
    """Facts whose source record id is wanted, or begins with a wanted record-set id."""
    found: dict[str, list[dict[str, Any]]] = {key: [] for key in wanted}
    needles = [key.encode("utf-8") for key in wanted]
    for line in lines:
        if not any(needle in line for needle in needles):
            continue
        fact = json.loads(line)
        record = (fact.get("lineage") or {}).get("source_record_id") or ""
        for key in wanted:
            if record == key or record.startswith(f"{key}."):
                found[key].append(fact)
    return found


def _fact_summary(fact: Mapping[str, Any]) -> dict[str, Any]:
    return {
        "source_record_id": (fact.get("lineage") or {}).get("source_record_id"),
        "semantic_fact_key": fact.get("semantic_fact_key"),
        "label": fact.get("label"),
        "period": fact.get("period"),
        "assertion": fact.get("assertion"),
        "value": fact.get("value"),
    }


def resolve(
    spec: Spec,
    references: Mapping[str, Any],
    facts_path: Path | None,
    manifest_path: Path | None,
    *,
    resolved_at: str,
    check_digests: bool = True,
) -> dict[str, Any]:
    """Build the references lock from a Chronicle consumer artifact."""
    problems = validate_references(spec, references)
    if problems:
        raise ReferenceError_("; ".join(problems))
    pin = references.get("chronicle") or {}
    wanted = _wanted(references)
    if wanted and facts_path is None:
        raise ReferenceError_("chronicle_records need --facts, a Chronicle consumer_facts.jsonl")
    if check_digests and pin and facts_path is not None:
        if pin.get("facts_sha256") and file_sha256(facts_path) != pin["facts_sha256"]:
            raise ReferenceError_("the facts file is not the pinned Chronicle artifact")
        if (
            manifest_path
            and pin.get("manifest_sha256")
            and (file_sha256(manifest_path) != pin["manifest_sha256"])
        ):
            raise ReferenceError_("the artifact manifest is not the pinned one")
    found: dict[str, list[dict[str, Any]]] = {}
    if wanted:
        with facts_path.open("rb") as stream:
            found = scan_facts(stream, wanted)
    lock: dict[str, Any] = {
        "schema_version": SCHEMA_VERSION,
        "kind": "release_history.references_lock",
        "country": spec.country,
        "references_sha256": references_digest(references),
        "chronicle": dict(pin),
        "resolved_at": resolved_at,
        "baseline": {},
        "reforms": {},
    }
    for section in ("baseline", "reforms"):
        for key, entry in (references.get(section) or {}).items():
            out: dict[str, Any] = {
                "basis": entry.get("basis"),
                "output": entry.get("output", "budgetary_impact" if section == "reforms" else None),
                "sign": entry.get("sign", 1),
            }
            if "none" in entry:
                out.update(status="none", reason=entry["none"])
            elif "citation" in entry:
                out.update(
                    status="citation", citation=entry["citation"], registry=entry.get("registry")
                )
            else:
                records = entry["chronicle_records"]
                facts = []
                for record in records:
                    matches = found.get(record, [])
                    if len(matches) != 1:
                        raise ReferenceError_(
                            f"{section}.{key}: {record} matches {len(matches)} facts, not one"
                        )
                    facts.append(_fact_summary(matches[0]))
                values = [fact["value"] for fact in facts]
                if not all(isinstance(v, int | float) and not isinstance(v, bool) for v in values):
                    raise ReferenceError_(f"{section}.{key}: a referenced fact is not numeric")
                out.update(
                    status="resolved", value=float(sum(values)), facts=facts, note=entry.get("note")
                )
            lock[section][key] = out
    return lock


def lock_is_current(references: Mapping[str, Any], lock: Mapping[str, Any]) -> bool:
    return lock.get("references_sha256") == references_digest(references)


def load_lock(country: str, root: Path | None = None) -> dict[str, Any] | None:
    path = (root or countries_dir()) / country / "references.lock.json"
    if not path.is_file():
        return None
    return json.loads(path.read_text(encoding="utf-8"))
