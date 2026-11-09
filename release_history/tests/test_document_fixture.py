"""The measurement document both languages read, made from the fake world.

`tests/fixtures/measurement.json` is read by
`frontend/scripts/release-history.test.ts`, so a change to the document's
shape fails one suite or the other. Regenerate it with `UPDATE_FIXTURES=1`.
"""

import json
import os
from pathlib import Path

import numpy as np

from release_history.canonical import document_bytes
from release_history.disclosure import apply_policy
from release_history.document import measurement_document, measurement_id
from release_history.measure import measure
from release_history.spec import parse_spec

from .fakes import FakeBackend, fake_spec_dict

FIXTURE = Path(__file__).parent / "fixtures" / "measurement.json"
PANEL = "f" * 64


def fixture_document() -> dict:
    spec = parse_spec(
        fake_spec_dict(
            disclosure={
                "policy": "source_household_small_cells",
                "min_source_households": 3,
                "source_id_columns": ["household_source_id"],
            }
        )
    )
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
    provenance = {
        "release_id": "zz-national-20261101T000000Z-00000000",
        "release_directory": "zz-national",
        "hf_repo": "policyengine/zz",
        "hf_commit": "1234567890abcdef1234567890abcdef12345678",
        "published_at": "2026-11-01T00:00:00Z",
        "current": True,
    }
    return measurement_document(
        spec=spec,
        panel_id=PANEL,
        measurement=measurement_id(PANEL, provenance, "e" * 64),
        provenance=provenance,
        result=result,
        columns=["household_id", "earnings"],
        withheld=withheld,
        runtime={"started_at": "2026-11-09T00:00:00Z", "finished_at": "2026-11-09T00:00:01Z"},
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
