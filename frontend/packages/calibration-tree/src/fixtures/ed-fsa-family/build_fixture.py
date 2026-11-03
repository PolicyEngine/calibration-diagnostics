"""Build ed-fsa-family-schema-8.json from PolicyEngine/microcosm#1357's own data.

The fixture is the ED Federal Student Aid target family that microcosm#1357
compiles, written as schema 8 diagnostics rows: all 132 targets of the fit
receipt, each with the hierarchy Microcosm derives from its Chronicle member
facts. Nothing here imports Microcosm; the derivation below restates the
rules of the files it cites, at SOURCE_COMMIT, so that a reviewer can check
each step against them.

Usage (the source files are fetched from raw.githubusercontent.com into a
directory of their own, at their repository paths):

    python3 -I build_fixture.py <microcosm-checkout-dir> > ed-fsa-family-schema-8.json

The script refuses any source file whose sha256 differs from SOURCES.

Where each field comes from, at SOURCE_COMMIT:

- target name and value: the receipt's ``fsa_targets[].name`` and ``target``;
  ``final_estimate`` is ``b_with_fsa`` (the fit with the FSA targets) and
  ``initial_estimate`` is ``release`` (the host release's weights, before
  the refit). ``relative_error`` is ``b_with_fsa_error``.
- provider and category: ``fsa_student_loan_targets.py:133-138`` (measure to
  category) and ``:875-888`` (the seed), with labels from
  ``provider_labels.py`` and ``variable_labels.py``.
- member facts: a state or band target is one fact whose source record id is
  the target's name (``:685``, ``:758``); Parent PLUS is the loan-type fact
  whose groupby value is ``parent_plus`` (``:812-816``, ``:837``); the balance
  excluding Parent PLUS is every other ``dollars_outstanding`` detail row of
  the same loan-type record set (``:797-824``, ``:841-842``).
- geography: the member facts' one ``geography`` level, id and name
  (``ledger_targets.py:1375-1418``); no FSA reference declares a composed or
  aliased geography (``:1355-1373``).
- dimensions: the layout groupby dimension and value when every member fact
  shares both, then every other dimension they all share
  (``ledger_targets.py:1580-1610``, ``_constant_text`` at ``:1649-1651``).
- target label: the plan's label (``fsa_student_loan_targets.py:394``).
- source: the representative fact's citation (``ledger_targets.py:5842-5852``,
  ``_source_name`` at ``:5771-5774``). The representative of a single-fact
  target is its fact; of the linear combination, the last member (all share
  one period, ``:1232-1245``), in the operand order of
  ``fsa_student_loan_targets.py:819-824``.
- metadata: only the keys this dashboard reads. The plan's own keys
  (``fsa_student_loan_targets.py:572-586``) override the representative fact's
  ledger keys (``ledger_targets.py:5855-5915``), as ``_reference_metadata``
  (``:5388-5391``) is merged last (``:1087-1095``). ``ledger_measure_unit`` is
  the fact's ``observed_measure.unit``. A single-fact reference keeps the
  default ``value_operation`` of ``identity`` (``ledger_targets.py:262``).
- row shape: ``diagnostics.py:212-245`` and ``:159-164``.
"""

from __future__ import annotations

import gzip
import hashlib
import json
import sys
from pathlib import Path

SOURCE_REPOSITORY = "PolicyEngine/microcosm"
SOURCE_COMMIT = "0ff293b1a335a29d46f1598f2039beffa242e632"
RECEIPT = "experiments/receipts/1074-fsa-calibration-fit.json"
FACTS = "packages/microcosm-build/tests/fixtures/us_fsa_portfolio_chronicle_347_facts.jsonl.gz"
SOURCES = {
    RECEIPT: "7298c3a858e2bccd514605bbf9d4f35041b4a25b7fcdc9ab916e3cdb51a73046",
    FACTS: "9faed0e397ed20c5b2ccddebfbe58ea83a81f1d4ed896b1bee9569c6f98ecdaa",
    # Read for the rules restated here, not parsed.
    "packages/microcosm-build/src/microcosm/build/us_runtime/fsa_student_loan_targets.py": (
        "574203e5588ff1e44cd46bd4b42a6a63abece94ba4235659ef842adf5f3c824b"
    ),
    "packages/microcosm-build/src/microcosm/build/ledger_targets.py": (
        "b8bd1fb6e06747b80e6096f13e6599341c42c45f9b93bb6dd89ea744abbc2cf0"
    ),
    "packages/microcosm-calibrate/src/microcosm/calibrate/diagnostics.py": (
        "c4c418f18f0577fceaeca0ffdba4ae555469d25e973f7dde672ce36c4cf4e153"
    ),
    "packages/microcosm-calibrate/src/microcosm/calibrate/hierarchy.py": (
        "d9a79463f954b42af2e89014cc681ab7a27085581a9ed5d0a0db70adeeaa0112"
    ),
    "packages/microcosm-calibrate/src/microcosm/calibrate/provider_labels.py": (
        "65ed20e0c1a53652320820c922563a47e50a0ca64ee91c319188e7a3d255dff3"
    ),
    "packages/microcosm-calibrate/src/microcosm/calibrate/variable_labels.py": (
        "a336ce350ced1843b6b16d89aae154de42560d3a471d33529cc094cc73c86475"
    ),
    "packages/microcosm-build/tests/engine_free/us/test_us_fsa_student_loan_targets.py": (
        "56a94d46388a4bf666f3ab4d4130c969a10b75593042217ac8d714d121549968"
    ),
}

PROVIDER = {"id": "ed_fsa", "label": "ED · Federal Student Aid"}  # provider_labels.py:35
CATEGORY_LABELS = {  # variable_labels.py:77-84
    "federal_student_loan_balance": "Federal student loan balance",
    "federal_student_loan_borrowers": "Federal student loan borrowers",
    "loan_balance_excluding_parent_plus": "Federal student loan balance excluding Parent PLUS",
    "parent_plus_loan_balance": "Parent PLUS loan balance",
}
# fsa_student_loan_targets.py:133-138, keyed by the receipt's target_role
# (built at :690, :768-771 and :850).
CATEGORY_BY_ROLE = {
    "fsa_state_balance": "federal_student_loan_balance",
    "fsa_age_band_balance": "federal_student_loan_balance",
    "fsa_debt_size_band_balance": "federal_student_loan_balance",
    "fsa_state_borrowers": "federal_student_loan_borrowers",
    "fsa_age_band_borrowers": "federal_student_loan_borrowers",
    "fsa_debt_size_band_borrowers": "federal_student_loan_borrowers",
    "fsa_parent_plus_balance": "parent_plus_loan_balance",
    "fsa_balance_excluding_parent_plus": "loan_balance_excluding_parent_plus",
}
EXCLUDING_PARENT_PLUS_SUFFIX = ".excluding_parent_plus.dollars_outstanding"
# The build period the plan restamps every spec to (receipt host release).
TARGET_PERIOD = 2024


def _at(obj, *path):
    for key in path:
        if not isinstance(obj, dict):
            return None
        obj = obj.get(key)
    return obj


def _text(obj, *path) -> str:
    value = _at(obj, *path)
    return "" if value is None else str(value)


def _constant_text(facts, *path) -> str:
    values = {_text(fact, *path).strip() for fact in facts}
    return next(iter(values)) if len(values) == 1 else ""


def _dimensions(fact) -> dict:
    filters = fact.get("filters")
    if isinstance(filters, dict):
        return filters
    dimensions = fact.get("dimensions")
    return dimensions if isinstance(dimensions, dict) else {}


def _value_id(value) -> str:
    if isinstance(value, bool):
        return str(value).lower()
    if isinstance(value, (dict, list, tuple)):
        return json.dumps(value, sort_keys=True, separators=(",", ":"))
    return str(value)


def _single_label(labels: set[str], what: str) -> str:
    labels = {label.strip() for label in labels if label and label.strip()}
    if len(labels) != 1:
        raise ValueError(f"{what} needs exactly one label, got {sorted(labels)!r}.")
    return next(iter(labels))


def inherited_dimensions(facts) -> list[dict]:
    """ledger_targets.py:1580-1610."""

    first = _dimensions(facts[0])
    common = {
        key: value
        for key, value in first.items()
        if all(key in _dimensions(f) and _dimensions(f)[key] == value for f in facts[1:])
    }
    out = []
    groupby_id = _constant_text(facts, "layout", "groupby_dimension")
    groupby_value_id = _constant_text(facts, "layout", "groupby_value_id")
    if groupby_id and groupby_value_id:
        raw_value = common.pop(groupby_id, groupby_value_id)
        out.append(
            {
                "id": groupby_id,
                "label": _constant_text(facts, "layout", "groupby_dimension_label")
                or _single_label(
                    {_text(f, "dimension_labels", groupby_id) for f in facts}, groupby_id
                ),
                "value_id": _value_id(groupby_value_id),
                "value_label": _constant_text(facts, "layout", "groupby_value_label")
                or _single_label(
                    {
                        _text(f, "dimension_value_labels", groupby_id, _value_id(raw_value))
                        for f in facts
                    },
                    f"{groupby_id}={raw_value}",
                ),
            }
        )
    for dimension_id in sorted(common):
        value = common[dimension_id]
        out.append(
            {
                "id": dimension_id,
                "label": _single_label(
                    {_text(f, "dimension_labels", dimension_id) for f in facts}, dimension_id
                ),
                "value_id": _value_id(value),
                "value_label": _single_label(
                    {
                        _text(f, "dimension_value_labels", dimension_id, _value_id(value))
                        for f in facts
                    },
                    f"{dimension_id}={value}",
                ),
            }
        )
    return out


def geography(facts) -> dict:
    """ledger_targets.py:1375-1418 (no composed or aliased geography)."""

    pairs = {(_text(f, "geography", "level"), _text(f, "geography", "id")) for f in facts}
    if len(pairs) != 1:
        raise ValueError(f"Member facts span geographies {sorted(pairs)!r}.")
    level, geography_id = next(iter(pairs))
    names = {_text(f, "geography", "name").strip() for f in facts} - {""}
    if len(names) != 1:
        raise ValueError(f"Member facts name {geography_id} {sorted(names)!r}.")
    return {"id": geography_id, "label": next(iter(names)), "level": level}


def source_citation(fact) -> str:
    """ledger_targets.py:5842-5852."""

    parts = [
        _text(fact, "source", "source_name") or _text(fact, "observed_measure", "source_name"),
        _text(fact, "source", "source_table") or _text(fact, "observed_measure", "source_table"),
        _text(fact, "source", "source_file"),
        _text(fact, "source", "vintage"),
        _text(fact, "source", "url"),
    ]
    return " | ".join(part for part in parts if part) or "PolicyEngine Ledger source-backed fact"


def row_metadata(target: dict, members: list, representative: dict) -> dict:
    """The keys of a compiled FSA spec's metadata that the dashboard reads."""

    measure_id = _text(representative, "observed_measure", "source_measure_id")
    ledger = {
        "ledger_source_record_id": _text(representative, "lineage", "source_record_id"),
        "ledger_measure_unit": _text(representative, "observed_measure", "unit"),
        "ledger_source_concept": _text(representative, "observed_measure", "source_concept"),
        "ledger_period_type": _text(representative, "period", "type"),
        "ledger_geography_level": _text(representative, "geography", "level"),
        "ledger_geography_id": _text(representative, "geography", "id"),
        "ledger_entity_name": _text(representative, "entity", "name"),
        "ledger_entity_role": _text(representative, "entity", "role"),
        "ledger_domain": _text(representative, "universe_constraints", "domain"),
        "ledger_layout_record_set_id": _text(representative, "layout", "record_set_id"),
        "ledger_layout_groupby_dimension": _text(representative, "layout", "groupby_dimension"),
        "ledger_layout_groupby_value_id": _text(representative, "layout", "groupby_value_id"),
        "ledger_layout_measure_id": _text(representative, "layout", "measure_id"),
    }
    plan = {
        "materializer": "fsa_stored_student_loan_balances",
        "measure_mode": "indicator_sum" if target["target_role"].endswith("borrowers") else "sum",
        "target_role": target["target_role"],
        "source_measure_id": measure_id,
        "source_period": _text(representative, "period", "value"),
        "target_period": str(TARGET_PERIOD),
        "ledger_value_operation": "linear_combination" if len(members) > 1 else "identity",
    }
    if len(members) > 1:
        plan["ledger_member_fact_count"] = str(len(members))
    return {key: value for key, value in {**ledger, **plan}.items() if value}


def member_facts(target: dict, facts_by_id: dict, facts: list) -> list:
    name = target["name"]
    if target["target_role"] == "fsa_balance_excluding_parent_plus":
        if not name.endswith(EXCLUDING_PARENT_PLUS_SUFFIX):
            raise ValueError(f"Unexpected excluding-Parent-PLUS name {name!r}.")
        record_set = name[: -len(EXCLUDING_PARENT_PLUS_SUFFIX)]
        members = [
            f
            for f in facts
            if _text(f, "layout", "record_set_id") == record_set
            and (_text(f, "observed_measure", "source_measure_id") or _text(f, "layout", "measure_id"))
            == "dollars_outstanding"
            and _text(f, "layout", "table_record_kind") in {"detail", ""}
            and _text(f, "layout", "groupby_value_id") != "parent_plus"
        ]
        if len(members) < 2:
            raise ValueError(f"{name!r} has {len(members)} member facts.")
        return sorted(members, key=lambda f: _text(f, "lineage", "source_record_id"))
    if name not in facts_by_id:
        raise ValueError(f"No Chronicle fact has source record id {name!r}.")
    return [facts_by_id[name]]


def main(root: Path) -> dict:
    for path, expected in SOURCES.items():
        actual = hashlib.sha256((root / path).read_bytes()).hexdigest()
        if actual != expected:
            raise SystemExit(f"{path}: sha256 {actual}, expected {expected}.")
    receipt = json.loads((root / RECEIPT).read_text())
    with gzip.open(root / FACTS, "rt", encoding="utf-8") as handle:
        facts = [json.loads(line) for line in handle if line.strip()]
    facts_by_id: dict[str, dict] = {}
    for fact in facts:
        record_id = _text(fact, "lineage", "source_record_id")
        if record_id in facts_by_id:
            raise ValueError(f"Two facts share source record id {record_id!r}.")
        facts_by_id[record_id] = fact

    rows = []
    for target in receipt["fsa_targets"]:
        members = member_facts(target, facts_by_id, facts)
        category_id = CATEGORY_BY_ROLE[target["target_role"]]
        representative = members[-1]
        rows.append(
            {
                "name": f"{target['name']}@{TARGET_PERIOD}",
                "target_name": target["name"],
                "period": TARGET_PERIOD,
                "entity": "household",
                "source": source_citation(representative),
                "metadata": row_metadata(target, members, representative),
                "target": target["target"],
                "initial_estimate": target["release"],
                "final_estimate": target["b_with_fsa"],
                "relative_error": target["b_with_fsa_error"],
                "registry": {"family": "ed_fsa", "se": None, "signed": False, "notes": ""},
                "hierarchy": {
                    "provider": dict(PROVIDER),
                    "category": {
                        "id": f"{PROVIDER['id']}.{category_id}",
                        "label": CATEGORY_LABELS[category_id],
                        "provider_id": PROVIDER["id"],
                    },
                    "geography": geography(members),
                    "dimensions": inherited_dimensions(members),
                    "target": {"id": target["name"], "label": target["label"]},
                },
            }
        )
    if len(rows) != 132:
        raise ValueError(f"Expected 132 FSA targets, got {len(rows)}.")
    return {
        "fixture_provenance": {
            "repository": SOURCE_REPOSITORY,
            "commit": SOURCE_COMMIT,
            "sha256": SOURCES,
            "script": "build_fixture.py",
        },
        "schema_version": 8,
        "targets": rows,
    }


if __name__ == "__main__":
    if len(sys.argv) != 2:
        raise SystemExit(__doc__)
    json.dump(main(Path(sys.argv[1])), sys.stdout, ensure_ascii=False, indent=1)
    sys.stdout.write("\n")
