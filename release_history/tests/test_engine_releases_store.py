import json
from pathlib import Path

import pytest

from release_history import engine
from release_history.canonical import json_sha256
from release_history.engine import EngineMismatch, engine_identity, panel_document, panel_id
from release_history.export import POINT_COLUMNS, TIMELINE_COLUMNS, export_csv, timeline_rows
from release_history.local_store import ImmutableConflict, write_immutable, write_once
from release_history.releases import (
    NationalArtifact,
    OpenedRelease,
    Point,
    ReleaseRefused,
    compatibility,
    national_artifact,
    point_provenance,
    release_directory_for,
    release_role,
)
from release_history.spec import load_spec, measurement_definition, parse_spec

from .fakes import fake_spec_dict

BUNDLE = {
    "policyengine_version": "6.16.1",
    "packages": {
        "policyengine-core": {"version": "3.33.3"},
        "policyengine-uk": {"version": "2.174.1"},
        "policyengine-us": {"version": "2.2.1"},
    },
}
SHA = "a" * 64


@pytest.fixture
def installed(monkeypatch):
    versions = {
        "policyengine": "6.16.1",
        "policyengine-core": "3.33.3",
        "policyengine-uk": "2.174.1",
        "policyengine-us": "2.2.1",
    }
    monkeypatch.setattr(engine, "_installed", lambda name: versions[name])
    return versions


def test_each_country_panel_id_moves_only_with_its_own_inputs(installed):
    uk, us = load_spec("uk"), load_spec("us")
    uk_id, us_id = (panel_id(s, engine_identity(s, BUNDLE)) for s in (uk, us))
    # The UK's model moves (a UK-only bump): the US panel stays put.
    bumped = json.loads(json.dumps(BUNDLE))
    bumped["packages"]["policyengine-uk"]["version"] = "2.180.0"
    installed["policyengine-uk"] = "2.180.0"
    assert panel_id(uk, engine_identity(uk, bumped)) != uk_id
    assert panel_id(us, engine_identity(us, bumped)) == us_id
    # A UK spec edit moves only the UK.
    edited = parse_spec({**uk.raw, "periods": [2026, 2027]}, expected_country="uk")
    assert panel_id(edited, engine_identity(edited, bumped)) != panel_id(
        uk, engine_identity(uk, bumped)
    )


def test_edits_that_change_no_number_keep_the_panel(installed):
    uk = load_spec("uk")
    base = panel_id(uk, engine_identity(uk, BUNDLE))
    reforms = [
        {**reform, "label": "Renamed", "source": {"repo": "elsewhere"}}
        for reform in uk.raw["reforms"]
    ]
    kept = parse_spec(
        {
            **uk.raw,
            "release_repo": "policyengine/populace-uk-elsewhere",
            "series": {"releases": ["microcosm-uk-2024-25-national", "another-line"]},
            "runner": {"max_dataset_bytes": 1},
            "reforms": reforms,
        },
        expected_country="uk",
    )
    assert panel_id(kept, engine_identity(kept, BUNDLE)) == base
    # The spec's own format version is not hashed either (a spec of another version is refused).
    assert "schema_version" not in measurement_definition(uk.raw)
    assert "release_repo" not in measurement_definition(uk.raw)
    # A reform's delta does change numbers, so it moves the panel.
    first = dict(uk.raw["reforms"][0])
    first["add"] = {path: 2 * delta for path, delta in first["add"].items()}
    moved = parse_spec(
        {**uk.raw, "reforms": [first, *uk.raw["reforms"][1:]]}, expected_country="uk"
    )
    assert panel_id(moved, engine_identity(moved, BUNDLE)) != base


def test_panel_json_holds_only_what_the_id_hashes_and_the_engine_it_names(installed):
    uk = load_spec("uk")
    engine_ = engine_identity(uk, BUNDLE)
    panel = panel_document(uk, engine_)
    assert set(panel) == {
        "format_version",
        "kind",
        "panel_id",
        "panel_key",
        "digest_algorithm",
        "country",
        "engine",
        "producer_version",
        "point_format_version",
        "spec_sha256",
        "definition",
    }
    assert panel["panel_key"] == {
        "country": "uk",
        "policyengine": "6.16.1",
        "model": "policyengine-uk==2.174.1",
        "core": "policyengine-core==3.33.3",
        "producer_version": "1",
        "point_format_version": 1,
        "spec_sha256": uk.digest,
    }
    # Labels, sources, the series rule, the release repository, the runner and the
    # environment live elsewhere: none of them reaches panel.json.
    text = json.dumps(panel)
    for unhashed in ("release_repo", "series", "runner", "label", "source", "packages"):
        assert f'"{unhashed}"' not in text


# Each country's panel id on the bundle above. A new id gives the country a new panel, which
# re-measures every build of its series: change a pin only when that is the intent.
PINNED_PANEL_IDS = {
    "uk": "dd45f7b09bd8a635863008b05795d73b424ec1dba6d717e53621f17c83726c22",
    "us": "301652c0057f187d72bd25cbd121e848fe5e803eaac8b0819634f87e03293993",
}


@pytest.mark.parametrize("country", sorted(PINNED_PANEL_IDS))
def test_each_country_s_panel_id_is_pinned(installed, country):
    spec = load_spec(country)
    panel = panel_document(spec, engine_identity(spec, BUNDLE))
    assert panel["panel_id"] == PINNED_PANEL_IDS[country], (
        "Intended? A new panel id re-measures every build of the series."
    )
    assert json_sha256(panel["definition"]) == panel["panel_key"]["spec_sha256"]
    assert json_sha256(panel["panel_key"]) == panel["panel_id"]


def test_the_engine_must_be_the_bundle_s_own_pins(installed):
    installed["policyengine-core"] = "3.34.0"
    with pytest.raises(EngineMismatch):
        engine_identity(load_spec("uk"), BUNDLE)


@pytest.mark.parametrize(
    "manifest, default, local",
    [
        ({"default_datasets": {"national": "x"}}, True, False),
        ({"default_datasets": {"national": "x"}, "dataset_role": "national_default"}, False, False),
        (
            {
                "default_datasets": {"national": "x"},
                "is_default": True,
                "dataset_role": "national_default",
            },
            True,
            False,
        ),
        ({"default_datasets": {}, "dataset_role": "non_default_local_area"}, False, True),
        ({"default_datasets": {"national": "x"}, "is_default": False}, False, False),
    ],
)
def test_release_role_is_the_dashboard_s_rule(manifest, default, local):
    assert release_role(manifest) == {"is_default": default, "is_local_area": local}


def test_national_artifact_resolves_both_layouts():
    tagged = {
        "default_datasets": {"national": "n"},
        "artifacts": {"n": {"kind": "microdata", "path": "n.h5", "sha256": SHA, "revision": "tag"}},
    }
    folder = {
        "default_datasets": {"national": "n"},
        "artifacts": {"n": {"kind": "microdata", "path": "n.h5", "sha256": SHA}},
    }
    assert national_artifact(tagged, "line").path == "n.h5"
    assert national_artifact(folder, "line/build").path == "releases/line/build/n.h5"
    with pytest.raises(ReleaseRefused) as refused:
        national_artifact({"default_datasets": {}, "dataset_role": "non_default_local_area"}, "x")
    assert refused.value.reason == "not_default_national"


def _opened(manifest: dict, build_manifest: dict | None, directory: str) -> OpenedRelease:
    point = Point(
        build_id=directory, release_directory=directory, hf_repo="org/repo", hf_commit="c" * 40
    )
    return OpenedRelease(
        point,
        manifest,
        f"releases/{directory}/release_manifest.json",
        SHA,
        build_manifest,
        f"releases/{directory}/build_manifest.json" if build_manifest else None,
        SHA if build_manifest else None,
        NationalArtifact(key="n", path=f"releases/{directory}/n.h5", sha256=SHA),
        100,
    )


def test_provenance_reads_both_manifest_layouts():
    model = {"name": "policyengine-uk", "version": "2.174.1"}
    common = {
        "default_datasets": {"national": "n"},
        "compatible_model_packages": [{"name": "policyengine-uk", "specifier": "==2.174.1"}],
    }
    tagged = {
        **common,
        "build": {
            "build_id": "line",
            "cut_tag": "line-20261107T020434Z-eeb6093e",
            "built_at": "2026-11-07T03:22:40+00:00",
            "built_with_model_package": model,
        },
    }
    # A build folder (microcosm#1534) names its build as a string and keeps the facts on top.
    folder = {
        **common,
        "release": "line",
        "build": "attempt-20261107T020434Z-eeb6093e",
        "built_at": "2026-11-07T03:22:40+00:00",
        "built_with_model_package": model,
        "migrated_from": {"tag": "line-20261107T020434Z-eeb6093e", "commit": "d" * 40},
    }
    build_manifest = {
        "release": "line",
        "build": "attempt-20261107T020434Z-eeb6093e",
        "code": {"repository": "PolicyEngine/microcosm", "git_commit": "e" * 40},
        "calibration": {"target_surface": {"sha256": SHA, "n_targets": 1214}},
    }
    old_point = point_provenance(_opened(tagged, None, "line"), "policyengine-uk", "2.174.1")
    new_point = point_provenance(
        _opened(folder, build_manifest, "line/attempt-20261107T020434Z-eeb6093e"),
        "policyengine-uk",
        "2.174.1",
    )
    # The file alone is the file's fact; what a build declares belongs to the build it was
    # fetched through, so a file published twice keeps one set of file facts.
    for point in (old_point, new_point):
        assert point["file"] == {"sha256": SHA, "bytes": 100}
    old, new = old_point["fetched_from"]["declared"], new_point["fetched_from"]["declared"]
    assert new_point["fetched_from"]["build_id"] == "line/attempt-20261107T020434Z-eeb6093e"
    assert new_point["fetched_from"]["build_manifest"]["path"] == (
        "releases/line/attempt-20261107T020434Z-eeb6093e/build_manifest.json"
    )
    assert new_point["fetched_from"]["dataset"] == {
        "key": "n",
        "path": "releases/line/attempt-20261107T020434Z-eeb6093e/n.h5",
    }
    assert old_point["fetched_from"]["build_manifest"] is None
    assert (old["build"], old["cut_tag"], old["migrated_from"]) == (
        "line",
        "line-20261107T020434Z-eeb6093e",
        None,
    )
    assert new["build"] == "attempt-20261107T020434Z-eeb6093e"
    assert new["cut_tag"] == "line-20261107T020434Z-eeb6093e"
    assert new["migrated_from"]["commit"] == "d" * 40
    for declared in (old, new):
        assert declared["built_with_model"] == model
        assert declared["built_at"] == "2026-11-07T03:22:40+00:00"
        assert declared["reference_model_compatibility"] == "inside"
    assert old["build_provenance"] is None
    assert new["build_provenance"]["attempt_id"] == "attempt-20261107T020434Z-eeb6093e"
    assert new["build_provenance"]["n_targets"] == 1214
    assert "published_at" not in json.dumps(new_point)


def test_compatibility_reads_the_declared_range():
    manifest = {
        "compatible_model_packages": [{"name": "policyengine-uk", "specifier": "==2.174.1"}]
    }
    assert compatibility(manifest, "policyengine-uk", "2.174.1") == "inside"
    assert compatibility(manifest, "policyengine-uk", "2.180.0") == "outside"
    assert compatibility({}, "policyengine-uk", "2.174.1") == "undeclared"


def test_cut_tags_read_from_their_line_folder():
    releases = ("microcosm-uk-2024-25-national",)
    tag = "microcosm-uk-2024-25-national-20261107T020434Z-eeb6093e"
    assert release_directory_for(tag, releases) == "microcosm-uk-2024-25-national"
    assert release_directory_for("populace-us-2024-spm-20260915", releases) == (
        "populace-us-2024-spm-20260915"
    )


def test_immutable_points_refuse_different_bytes(tmp_path):
    path = tmp_path / "point.json"
    assert write_immutable(path, {"a": 1})
    assert not write_immutable(path, {"a": 1})
    with pytest.raises(ImmutableConflict):
        write_immutable(path, {"a": 2})
    assert not write_once(path, {"b": 3})
    assert json.loads(path.read_text()) == {"a": 1}


def test_export_flattens_stored_points_onto_the_series_builds(tmp_path):
    spec = parse_spec(fake_spec_dict())
    country = tmp_path / "release-history" / spec.country
    folder = country / ("p" * 64)
    write_once(folder / "panel.json", {"panel_id": "p" * 64})
    write_immutable(
        folder / f"{'b' * 64}.json",
        {
            "measurement_id": "b" * 64,
            "status": "ok",
            "file": {"sha256": "1" * 64, "bytes": 1},
            "cells": [
                {
                    "output": "baseline/income_tax",
                    "period": 2026,
                    "unit": "currency",
                    "value": 1.5,
                    "status": "ok",
                    "reason": None,
                }
            ],
        },
    )
    without = export_csv(tmp_path, spec.country).splitlines()
    assert without[0] == ",".join(POINT_COLUMNS)
    assert without[1].startswith(f",,{'b' * 64},{'1' * 64},ok,2026,baseline/income_tax")
    # With the series record, the file's rows go to every build that publishes it.
    builds = [
        {
            "build_id": f"zz-national/{name}",
            "published_at": published,
            "digest": "1" * 64,
            "listing_status": "ok",
        }
        for name, published in (("b2", "2026-11-02T00:00:00Z"), ("b1", "2026-11-01T00:00:00Z"))
    ]
    write_once(country / "series.json", {"builds": builds})
    rows = export_csv(tmp_path, spec.country).splitlines()[1:]
    assert [row.split(",")[0] for row in rows] == ["zz-national/b1", "zz-national/b2"]


@pytest.mark.parametrize("country", ["uk", "us"])
def test_export_reads_the_timeline_the_typescript_side_writes(tmp_path, country):
    # Written by frontend/scripts/release-history.test.ts from each country's fixtures.
    timeline = json.loads(
        (Path(__file__).parent / "fixtures" / country / "timeline.json").read_text()
    )
    rows = timeline_rows(timeline)
    builds = timeline["builds"]
    assert len(rows) == len(timeline["outputs"]) * len(builds)
    assert {row["build_id"] for row in rows} == {b["buildId"] for b in builds}
    current = [row for row in rows if row["current"]]
    assert current and {row["change_status"] for row in current} <= {"ok", "withheld", "none"}
    assert any(row["change"] not in (None, 0) for row in current)
    assert all(row["value"] is None for row in rows if row["status"] == "withheld")
    # No step reaches a withdrawn build.
    assert all(row["compared_with"] is None for row in rows if row["withdrawn"])
    # The CLI's export reads the same document from a panel folder.
    folder = tmp_path / "release-history" / country / ("p" * 64)
    write_once(folder / "panel.json", {"panel_id": "p" * 64})
    (folder / "timeline.json").write_text(json.dumps(timeline))
    header = export_csv(tmp_path, country).splitlines()[0]
    assert header == ",".join(TIMELINE_COLUMNS)
