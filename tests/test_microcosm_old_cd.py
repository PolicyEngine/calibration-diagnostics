import csv
import io
import zipfile
from pathlib import Path

from evaluation_harness.microcosm_old_cd import (
    extract_state_assignments,
    load_old_cd_assignments,
)


def test_extracts_only_requested_blocks_as_117th_district_geoids() -> None:
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w") as archive:
        archive.writestr(
            "BlockAssign_ST01_AL_CD.txt",
            "BLOCKID|DISTRICT\n"
            "010010201001000|02\n"
            "010010201001001|02\n"
            "010010201001002|07\n",
        )

    result = extract_state_assignments(
        buffer.getvalue(),
        state_fips="01",
        state_usps="AL",
        requested_blocks={"010010201001000", "010010201001002"},
    )

    assert result == {
        "010010201001000": "5001700US0102",
        "010010201001002": "5001700US0107",
    }


def test_assignment_artifact_loader_rejects_duplicate_blocks(tmp_path: Path) -> None:
    artifact = tmp_path / "assignments.csv"
    with artifact.open("w", newline="") as stream:
        writer = csv.writer(stream)
        writer.writerow(["block_geoid", "congressional_district_geoid_117th"])
        writer.writerow(["010010201001000", "5001700US0102"])
        writer.writerow(["010010201001000", "5001700US0107"])

    try:
        load_old_cd_assignments(artifact)
    except ValueError as error:
        assert "duplicate block" in str(error)
    else:  # pragma: no cover - assertion clarity
        raise AssertionError("expected duplicate block to be rejected")
