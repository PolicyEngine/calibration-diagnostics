"""The measurement document both languages read, made from the fake world.

`tests/fixtures/measurement.json` is the point of the first file in
`tests/fixtures/series.json`; `frontend/scripts/release-history.test.ts` builds
`tests/fixtures/timeline.json` from the two, so a change to either shape fails
one suite or the other. Regenerate them with `UPDATE_FIXTURES=1`.
"""

import json
import os
from pathlib import Path

import numpy as np

from release_history.canonical import document_bytes, json_sha256
from release_history.disclosure import apply_policy
from release_history.document import measurement_document, measurement_id, refused_document
from release_history.measure import measure
from release_history.releases import NationalArtifact, OpenedRelease, Point, point_provenance
from release_history.spec import parse_spec

from .fakes import (
    FAKE_COMMIT,
    FIXTURE_FILES,
    FIXTURE_LINE,
    FakeBackend,
    fixture_series_spec_dict,
    release_manifest,
)

FIXTURE = Path(__file__).parent / "fixtures" / "measurement.json"
PANEL = "f" * 64
BUILD = f"{FIXTURE_LINE}/zz-build-20261101"
PACKAGES = ["policyengine-core==3.33.3", "policyengine-zz==1.0.0"]
ENV = {
    "python": "3.12.0",
    "platform": "fixture",
    "packages": PACKAGES,
    "packages_sha256": json_sha256(PACKAGES),
    "uv_lock_sha256": "0" * 64,
}
RUNTIME = {
    "started_at": "2026-11-09T00:00:00Z",
    "finished_at": "2026-11-09T00:00:01Z",
    "seconds": 1.0,
    "runner": "fixture",
}


def fixture_spec():
    return parse_spec(
        fixture_series_spec_dict(
            disclosure={
                "policy": "source_household_small_cells",
                "min_source_households": 3,
                "source_id_columns": ["household_source_id"],
            }
        )
    )


def fixture_provenance(sha256: str = FIXTURE_FILES[0]) -> dict:
    point = Point(
        build_id=BUILD,
        release_directory=BUILD,
        hf_repo="policyengine/zz",
        hf_commit=FAKE_COMMIT,
        digest=sha256,
    )
    manifest = release_manifest(sha256)
    opened = OpenedRelease(
        point,
        manifest,
        f"releases/{BUILD}/release_manifest.json",
        "a" * 64,
        None,
        None,
        None,
        NationalArtifact(key="national", path=f"releases/{BUILD}/zz.h5", sha256=sha256),
        1024,
    )
    return point_provenance(opened, "policyengine-zz", "1.0.0")


def fixture_document() -> dict:
    spec = fixture_spec()
    result = measure(spec, FakeBackend())
    withheld = apply_policy(
        spec.disclosure_policy,
        result.cells,
        result.tables,
        source_ids=np.array([1, 2, 3, 4]),
        floor=spec.min_source_households,
    )
    for simulation in result.simulations:  # timings vary run to run
        simulation.update(seconds=0.0, peak_rss_bytes=0)
    return measurement_document(
        spec=spec,
        panel_id=PANEL,
        provenance=fixture_provenance(),
        result=result,
        columns=["household_id", "earnings"],
        withheld=withheld,
        env=ENV,
        producer_commit="0" * 40,
        runtime=RUNTIME,
    )


def test_the_shared_fixture_is_what_the_producer_writes():
    produced = document_bytes(fixture_document())
    if os.environ.get("UPDATE_FIXTURES") or not FIXTURE.exists():
        FIXTURE.parent.mkdir(parents=True, exist_ok=True)
        FIXTURE.write_bytes(produced)
    assert FIXTURE.read_bytes() == produced


def test_the_fixture_withholds_without_storing_support():
    document = json.loads(FIXTURE.read_text())
    withheld = [cell for cell in document["cells"] if cell["status"] == "withheld"]
    assert withheld and all(cell["value"] is None and cell["reason"] for cell in withheld)
    assert document["disclosure"]["withheld_cells"] == len(withheld)
    assert not any("support" in key for cell in document["cells"] for key in cell)


def test_a_point_is_one_file_on_one_panel():
    document = fixture_document()
    assert document["measurement_id"] == measurement_id(PANEL, FIXTURE_FILES[0])
    # The same file under another build name is the same point; another file is another.
    assert measurement_id(PANEL, FIXTURE_FILES[0]) != measurement_id(PANEL, FIXTURE_FILES[1])
    assert measurement_id(PANEL, FIXTURE_FILES[0]) != measurement_id("e" * 64, FIXTURE_FILES[0])


def test_a_point_holds_no_listing_fact_and_records_its_lock():
    document = fixture_document()
    text = json.dumps(document)
    for listing in ("published_at", '"current"', "withdrawn", "release_id"):
        assert listing not in text
    assert document["environment"]["uv_lock_sha256"] == "0" * 64
    assert document["producer"] == {"version": "1", "commit": "0" * 40}
    assert document["fetched_from"]["hf_commit"] == FAKE_COMMIT
    assert document["file"] == {"sha256": FIXTURE_FILES[0], "bytes": 1024}
    assert document["fetched_from"]["build_id"] == BUILD


def test_every_cell_holds_every_key():
    document = fixture_document()
    assert {frozenset(cell) for cell in document["cells"]} == {
        frozenset({"output", "period", "unit", "value", "status", "reason"})
    }


def test_a_refusal_has_the_result_s_keys():
    spec = fixture_spec()
    refused = refused_document(
        spec=spec,
        panel_id=PANEL,
        provenance=fixture_provenance(),
        reason="disclosure_source_ids_missing",
        env=ENV,
        producer_commit=None,
        runtime=RUNTIME,
    )
    assert set(refused) == set(fixture_document())
    assert refused["status"] == "refused" and refused["cells"] == []
    assert refused["measurement_id"] == measurement_id(PANEL, FIXTURE_FILES[0])
