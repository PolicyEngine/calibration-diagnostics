"""The series record: the builds `releases.json` lists, each mapped to its data file."""

import json
import os
from pathlib import Path

import pytest

from release_history import cli
from release_history.canonical import document_bytes
from release_history.releases import ReleaseRefused
from release_history.series import MAX_RECORD_BYTES, SeriesError, build_series, parse_record
from release_history.spec import parse_spec

from .fakes import (
    FIXTURE_FILES,
    FIXTURE_LINE,
    FakeHub,
    fixture_repo,
    fixture_series_spec_dict,
    release_manifest,
    release_repo,
)

FIXTURE = Path(__file__).parent / "fixtures" / "series.json"
LISTED_AT = "2026-11-12T00:00:00Z"


def holds(document: dict, **expected) -> bool:
    return {key: document[key] for key in expected} == expected


def fixture_series(tmp_path: Path) -> dict:
    spec = parse_spec(fixture_series_spec_dict())
    return build_series(spec, fixture_repo(), listed_at=LISTED_AT, workdir=tmp_path)


def test_the_series_is_the_named_lines_from_since(tmp_path):
    series = fixture_series(tmp_path)
    first, second, third = FIXTURE_FILES
    builds = {b["build"]: b for b in series["builds"]}
    # The other line and the build before `since` are not in the series.
    assert list(builds) == [
        "zz-build-20261101",
        "zz-build-20261103",
        "zz-build-20261105",
        "zz-build-20261107",
        "zz-build-20261109",
    ]
    assert builds["zz-build-20261101"]["build_id"] == f"{FIXTURE_LINE}/zz-build-20261101"
    # One file under two build names: one digest, so one point.
    assert builds["zz-build-20261101"]["digest"] == builds["zz-build-20261103"]["digest"] == first
    assert holds(
        builds["zz-build-20261105"],
        digest=second,
        current=True,
        in_default_release=True,
        withdrawn=False,
        listing_status="ok",
        dataset_path=f"releases/{FIXTURE_LINE}/zz-build-20261105/zz.h5",
    )
    assert builds["zz-build-20261107"]["withdrawn"] is True
    assert builds["zz-build-20261107"]["digest"] == third
    assert holds(
        builds["zz-build-20261109"],
        digest=None,
        listing_status="refused",
        listing_reason="release_manifest_missing",
    )
    assert series["rule"] == {"releases": [FIXTURE_LINE], "since": "2026-10-25"}
    assert series["commit"] == "c" * 40
    assert series["record"]["present"] is True and series["record"]["default"] == FIXTURE_LINE
    assert series["lines"] == [{"release": FIXTURE_LINE, "present": True, "role": "national"}]


def test_every_build_holds_every_key(tmp_path):
    series = fixture_series(tmp_path)
    keys = {frozenset(build) for build in series["builds"]}
    assert len(keys) == 1


def test_builds_without_a_file_to_measure_carry_their_reason(tmp_path):
    hub = release_repo(
        {
            FIXTURE_LINE: {
                "local": {
                    "published_at": "2026-11-01T00:00:00Z",
                    "manifest": release_manifest("", national=False),
                },
                "unpinned": {"published_at": "2026-11-02T00:00:00Z", "sha256": "not-a-digest"},
                "missing": {"published_at": "2026-11-03T00:00:00Z", "manifest": None},
            }
        },
        default=FIXTURE_LINE,
    )
    spec = parse_spec(fixture_series_spec_dict(series={"releases": [FIXTURE_LINE]}))
    series = build_series(spec, hub, listed_at=LISTED_AT, workdir=tmp_path)
    assert [(b["build"], b["listing_status"], b["listing_reason"]) for b in series["builds"]] == [
        ("local", "refused", "not_default_national"),
        ("unpinned", "refused", "national_artifact_unpinned"),
        ("missing", "refused", "release_manifest_missing"),
    ]
    assert all(b["digest"] is None for b in series["builds"])


def test_since_compares_utc_dates(tmp_path):
    hub = release_repo(
        {
            FIXTURE_LINE: {
                # 00:30 in UTC+1 on the 25th is still the 24th in UTC.
                "early": {"published_at": "2026-10-25T00:30:00+01:00", "sha256": "4" * 64},
                "on_time": {"published_at": "2026-10-25T00:00:00Z", "sha256": "5" * 64},
            }
        }
    )
    series = build_series(
        parse_spec(fixture_series_spec_dict()), hub, listed_at=LISTED_AT, workdir=tmp_path
    )
    assert [b["build"] for b in series["builds"]] == ["on_time"]


def test_a_repository_without_releases_json_has_no_record(tmp_path):
    series = build_series(
        parse_spec(fixture_series_spec_dict()), FakeHub(), listed_at=LISTED_AT, workdir=tmp_path
    )
    assert series["record"] == {"present": False, "sha256": None, "default": None}
    assert series["builds"] == []
    assert series["lines"] == [{"release": FIXTURE_LINE, "present": False, "role": None}]


def valid_record() -> dict:
    return {
        "schema_version": 1,
        "default": "line",
        "releases": {
            "line": {
                "role": "national",
                "current": "b",
                "builds": {"b": {"published_at": "2026-11-01T00:00:00Z", "withdrawn": False}},
            }
        },
    }


def test_a_record_the_release_writer_writes_is_read():
    parsed = parse_record(valid_record())
    assert parsed["releases"]["line"]["builds"]["b"]["withdrawn"] is False


@pytest.mark.parametrize(
    "change",
    [
        lambda r: r.update(schema_version=2),
        lambda r: r.update(schema_version=True),
        lambda r: r.pop("default"),
        lambda r: r.update(extra=1),
        lambda r: r.update(default="elsewhere"),
        lambda r: r["releases"].update({"../up": r["releases"]["line"]}),
        lambda r: r["releases"]["line"].update(role="Not A Role"),
        lambda r: r["releases"]["line"].update(current="missing"),
        lambda r: r["releases"]["line"]["builds"]["b"].update(withdrawn=True),
        lambda r: r["releases"]["line"]["builds"]["b"].update(withdrawn="no"),
        lambda r: r["releases"]["line"]["builds"]["b"].update(published_at="soon"),
        lambda r: r["releases"]["line"]["builds"]["b"].pop("withdrawn"),
        lambda r: r["releases"]["line"]["builds"].update({"bad name": {}}),
    ],
)
def test_a_record_the_release_writer_would_not_write_is_refused(change):
    record = valid_record()
    change(record)
    with pytest.raises(SeriesError):
        parse_record(record)


def test_an_unreadable_or_oversized_record_fails_the_listing(tmp_path):
    spec = parse_spec(fixture_series_spec_dict())
    hub = fixture_repo()
    hub.files["releases.json"] = b"{not json"
    with pytest.raises(SeriesError, match="readable JSON"):
        build_series(spec, hub, listed_at=LISTED_AT, workdir=tmp_path)
    hub.files["releases.json"] = b" " * (MAX_RECORD_BYTES + 1)
    with pytest.raises(SeriesError, match="larger"):
        build_series(spec, hub, listed_at=LISTED_AT, workdir=tmp_path)


def test_a_repository_fault_fails_the_listing_rather_than_refusing_every_build(tmp_path):
    # A bad token or a missing revision is the run's fault: no record is written, and the
    # plan job fails, so no build is listed as refused because of it.
    spec = parse_spec(fixture_series_spec_dict())
    hub = fixture_repo()
    hub.commit = "d" * 40
    hub.resolve_revision = lambda repo, revision: "e" * 40
    with pytest.raises(ReleaseRefused):
        build_series(spec, hub, listed_at=LISTED_AT, workdir=tmp_path)


def test_the_shared_series_fixture_is_what_the_producer_writes(tmp_path):
    # frontend/scripts/release-history.test.ts builds tests/fixtures/timeline.json from this
    # record and tests/fixtures/measurement.json. Regenerate with UPDATE_FIXTURES=1.
    produced = document_bytes(fixture_series(tmp_path))
    if os.environ.get("UPDATE_FIXTURES") or not FIXTURE.exists():
        FIXTURE.parent.mkdir(parents=True, exist_ok=True)
        FIXTURE.write_bytes(produced)
    assert FIXTURE.read_bytes() == produced


def test_the_series_command_writes_the_record_and_prints_only_counts(tmp_path, monkeypatch, capsys):
    spec = parse_spec(fixture_series_spec_dict())
    monkeypatch.setattr(cli, "load_spec", lambda country: spec)
    monkeypatch.setattr(cli, "HubClient", fixture_repo)
    assert cli.main(["series", "--country", "zz", "--out", str(tmp_path)]) == 0
    written = json.loads((tmp_path / "release-history" / "zz" / "series.json").read_text())
    assert len(written["builds"]) == 5
    printed = json.loads(capsys.readouterr().out)
    assert printed == {
        "command": "series",
        "country": "zz",
        "record": True,
        "commit": "c" * 40,
        "builds": 5,
        "listed": 3,
        "files": 2,
        "refused": ["release_manifest_missing"],
    }
