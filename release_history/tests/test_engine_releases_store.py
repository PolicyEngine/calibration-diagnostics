import json
from pathlib import Path

import pytest

from release_history import engine
from release_history.engine import EngineMismatch, engine_identity, panel_id
from release_history.export import TIMELINE_COLUMNS, export_csv, timeline_rows
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
from release_history.spec import load_spec, parse_spec

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
            "series": {**uk.raw["series"], "exclude": ["-0000000a$"]},
            "schedule": "manual",
            "runner": {"max_dataset_bytes": 1},
            "reforms": reforms,
        },
        expected_country="uk",
    )
    assert panel_id(kept, engine_identity(kept, BUNDLE)) == base
    # A reform's delta does change numbers, so it moves the panel.
    first = dict(uk.raw["reforms"][0])
    first["add"] = {path: 2 * delta for path, delta in first["add"].items()}
    moved = parse_spec(
        {**uk.raw, "reforms": [first, *uk.raw["reforms"][1:]]}, expected_country="uk"
    )
    assert panel_id(moved, engine_identity(moved, BUNDLE)) != base


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
        release_id=directory, release_directory=directory, hf_repo="org/repo", hf_commit="c" * 40
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
    old = point_provenance(_opened(tagged, None, "line"), "policyengine-uk", "2.174.1")
    new = point_provenance(
        _opened(folder, build_manifest, "line/attempt-20261107T020434Z-eeb6093e"),
        "policyengine-uk",
        "2.174.1",
    )
    assert (old["build_id"], old["cut_tag"], old["migrated_from"]) == (
        "line",
        "line-20261107T020434Z-eeb6093e",
        None,
    )
    assert new["build_id"] == "attempt-20261107T020434Z-eeb6093e"
    assert new["cut_tag"] == "line-20261107T020434Z-eeb6093e"
    assert new["migrated_from"]["commit"] == "d" * 40
    for provenance in (old, new):
        assert provenance["built_with_model"] == model
        assert provenance["built_at"] == "2026-11-07T03:22:40+00:00"
        assert provenance["reference_model_compatibility"] == "inside"
    assert new["build"]["attempt_id"] == "attempt-20261107T020434Z-eeb6093e"
    assert new["build"]["n_targets"] == 1214


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


def test_export_flattens_stored_points(tmp_path):
    spec = parse_spec(fake_spec_dict())
    folder = tmp_path / "release-history" / spec.country / "p1"
    write_once(folder / "panel.json", {"panel_id": "p1"})
    write_immutable(
        folder / f"{'b' * 64}.json",
        {
            "measurement_id": "b" * 64,
            "status": "ok",
            "point": {"release_id": "zz-national-1", "published_at": "2026-11-01T00:00:00Z"},
            "cells": [
                {
                    "output": "baseline/income_tax",
                    "period": 2026,
                    "unit": "currency",
                    "value": 1.5,
                    "status": "ok",
                }
            ],
        },
    )
    text = export_csv(tmp_path, spec.country)
    assert text.splitlines()[0].startswith("release_id,published_at,measurement_id")
    assert "zz-national-1" in text and "baseline/income_tax" in text


def test_export_reads_the_timeline_the_typescript_side_writes(tmp_path):
    # Written by frontend/scripts/release-history.test.ts from the measurement fixture.
    timeline = json.loads((Path(__file__).parent / "fixtures" / "timeline.json").read_text())
    rows = timeline_rows(timeline)
    points = timeline["points"]
    assert len(rows) == len(timeline["series"]) * len(points)
    by_id = {p["measurementId"]: p["releaseId"] for p in points}
    assert all(row["measurement_id"] in by_id for row in rows)
    assert all(row["release_id"] == by_id[row["measurement_id"]] for row in rows)
    later = [row for row in rows if row["measurement_id"] == points[1]["measurementId"]]
    assert {row["change_status"] for row in later} <= {"ok", "withheld", "none"}
    assert any(row["change"] is not None for row in later)
    assert all(row["value"] is None for row in rows if row["status"] == "withheld")
    # The CLI's export reads the same document from a panel folder.
    folder = tmp_path / "release-history" / "zz" / "p1"
    write_once(folder / "panel.json", {"panel_id": "p1"})
    (folder / "timeline.json").write_text(json.dumps(timeline))
    header = export_csv(tmp_path, "zz").splitlines()[0]
    assert header == ",".join(TIMELINE_COLUMNS)
