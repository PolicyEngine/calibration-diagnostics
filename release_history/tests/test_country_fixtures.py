"""Each country's fixtures, and the schemas every stored document is checked against.

`tests/fixtures/<country>/` is what the producer writes for a synthetic series
of that country (`country_fixtures.py`); `timeline.json` there is what the
TypeScript side builds from them (`frontend/scripts/release-history.test.ts`).
Regenerate in order with UPDATE_FIXTURES=1: pytest, then bun, then pytest.
"""

import copy
import json
import os

import pytest

from release_history.canonical import document_bytes

from .country_fixtures import FIXTURES, countries, fixture_files
from .schema_check import errors

KINDS = ("point", "panel", "series", "labels", "timeline")


def committed(country: str) -> dict[str, dict]:
    folder = FIXTURES / country
    return {
        str(path.relative_to(folder)): json.loads(path.read_text(encoding="utf-8"))
        for path in sorted(folder.rglob("*.json"))
    }


def kind_of(name: str) -> str | None:
    if name.startswith("points/"):
        return "point"
    return {
        "panel.json": "panel",
        "series.json": "series",
        "labels.json": "labels",
        "timeline.json": "timeline",
    }.get(name)


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
        (
            (entry_name, entry)
            for entry_name, entry in documents.items()
            if kind_of(entry_name) == kind
        ),
        key=lambda item: len(json.dumps(item[1])),
    )
    for key in document:
        broken = {other: value for other, value in document.items() if other != key}
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
    withheld = [
        value
        for output in timeline["outputs"]
        for value in output["values"]
        if value["status"] == "withheld"
    ]
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
    digests = [build["digest"] for build in builds if build["digest"]]
    assert len(digests) > len(set(digests)), "one file under two builds"
    assert any(build["withdrawn"] for build in builds)
    assert any(build["current"] for build in builds)
    assert any(build["listing_status"] == "refused" for build in builds)
    timeline = documents["timeline.json"]
    states = {build["state"] for build in timeline["builds"]}
    assert {"measured", "missing"} <= states
    assert any(
        value["changeStatus"] == "ok" and value["change"]
        for output in timeline["outputs"]
        for value in output["values"]
    )
