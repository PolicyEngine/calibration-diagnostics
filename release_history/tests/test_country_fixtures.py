"""Each country's fixtures, and the schemas every stored document is checked against.

`tests/fixtures/<country>/` is what the producer writes for a synthetic series
of that country (`country_fixtures.py`); `timeline.json` there is what the
TypeScript side builds from them (`frontend/scripts/release-history.test.ts`).
Regenerate in order with UPDATE_FIXTURES=1: pytest, then bun, then pytest.
"""

import copy
import json
import os
from pathlib import Path

import pytest
from jsonschema import Draft202012Validator

from release_history.canonical import document_bytes

from .country_fixtures import FIXTURES, countries, fixture_files

SCHEMAS = Path(__file__).parents[1] / "schemas"
KINDS = ("point", "panel", "series", "timeline")


def schema(kind: str) -> Draft202012Validator:
    document = json.loads((SCHEMAS / f"{kind}.schema.json").read_text(encoding="utf-8"))
    Draft202012Validator.check_schema(document)
    return Draft202012Validator(document)


def committed(country: str) -> dict[str, dict]:
    folder = FIXTURES / country
    return {
        str(path.relative_to(folder)): json.loads(path.read_text(encoding="utf-8"))
        for path in sorted(folder.rglob("*.json"))
    }


def kind_of(name: str) -> str | None:
    if name.startswith("points/"):
        return "point"
    return {"panel.json": "panel", "series.json": "series", "timeline.json": "timeline"}.get(name)


def errors(kind: str, document: dict) -> list[str]:
    return [error.message for error in schema(kind).iter_errors(document)]


@pytest.mark.parametrize("country", countries())
def test_each_country_s_fixtures_are_what_the_producer_writes(country, tmp_path):
    produced = {
        name: document_bytes(document).decode("utf-8")
        for name, document in fixture_files(country, tmp_path).items()
    }
    folder = FIXTURES / country
    if os.environ.get("UPDATE_FIXTURES") or not (folder / "panel.json").exists():
        for stale in folder.glob("points/*.json"):
            stale.unlink()
        for name, text in produced.items():
            (folder / name).parent.mkdir(parents=True, exist_ok=True)
            (folder / name).write_text(text, encoding="utf-8")
    on_disk = {
        str(path.relative_to(folder)): path.read_text(encoding="utf-8")
        for path in folder.rglob("*.json")
        if path.name != "timeline.json"
    }
    assert on_disk == produced


@pytest.mark.parametrize("country", countries())
def test_every_stored_document_matches_its_schema(country):
    documents = committed(country)
    kinds = {kind_of(name) for name in documents} - {None}
    assert kinds == set(KINDS), "run bun with UPDATE_FIXTURES=1 to write the timeline"
    for name, document in documents.items():
        kind = kind_of(name)
        if kind:
            assert errors(kind, document) == [], name


@pytest.mark.parametrize("kind", KINDS)
def test_a_missing_key_fails_the_schema(kind):
    documents = committed("uk")
    # The fullest document of the kind: a measured point, not the gap.
    name, document = max(
        ((n, d) for n, d in documents.items() if kind_of(n) == kind),
        key=lambda item: len(json.dumps(item[1])),
    )
    for key in document:
        broken = {k: v for k, v in document.items() if k != key}
        assert errors(kind, broken), f"{name} still valid without {key}"
    # And one key down: an object inside a list.
    nested = copy.deepcopy(document)
    items = {"point": "cells", "series": "builds", "timeline": "builds"}.get(kind)
    if items:
        nested[items][0].pop(next(iter(nested[items][0])))
        assert errors(kind, nested)
    # An unknown key is refused too.
    assert errors(kind, {**document, "unexpected": 1})


def test_a_withheld_cell_in_a_timeline_carries_no_reason():
    timeline = committed("uk")["timeline.json"]
    withheld = [v for o in timeline["outputs"] for v in o["values"] if v["status"] == "withheld"]
    assert withheld and not any("reason" in value for value in withheld)
    broken = copy.deepcopy(timeline)
    for output in broken["outputs"]:
        for value in output["values"]:
            if value["status"] == "withheld":
                value["reason"] = "small_cell"
    assert errors("timeline", broken)


def test_the_uk_fixture_withholds_small_and_complementary_cells():
    reasons = {
        cell["reason"]
        for name, document in committed("uk").items()
        if name.startswith("points/")
        for cell in document["cells"]
        if cell["status"] == "withheld"
    }
    assert reasons == {"small_cell", "complementary"}


@pytest.mark.parametrize("country", countries())
def test_each_fixture_series_has_every_listing_case(country):
    documents = committed(country)
    builds = documents["series.json"]["builds"]
    digests = [b["digest"] for b in builds if b["digest"]]
    assert len(digests) > len(set(digests)), "one file under two builds"
    assert any(b["withdrawn"] for b in builds)
    assert any(b["current"] for b in builds)
    assert any(b["listing_status"] == "refused" for b in builds)
    timeline = documents["timeline.json"]
    states = {b["state"] for b in timeline["builds"]}
    assert {"measured", "missing"} <= states
    assert any(
        v["changeStatus"] == "ok" and v["change"] for o in timeline["outputs"] for v in o["values"]
    )
