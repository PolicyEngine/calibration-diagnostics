import json

import pytest

from release_history import engine
from release_history.engine import EngineMismatch, engine_identity, panel_id
from release_history.export import export_csv
from release_history.local_store import ImmutableConflict, write_immutable, write_once
from release_history.releases import (
    ReleaseRefused,
    compatibility,
    national_artifact,
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
