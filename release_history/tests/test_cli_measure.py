"""The measure command end to end, on the fake model world and a fake release repository.

Only results and the refusals a file itself causes are stored: a failure the run causes
writes no point, only the file's attempt report, so a later attempt can still measure it.
"""

import contextlib
import hashlib
import json
import re
from pathlib import Path

import pytest

from release_history import cli
from release_history.document import measurement_id
from release_history.releases import ReleaseRefusedError, TransientError
from release_history.spec import parse_spec

from .fakes import FAKE_COMMIT, FakeBackend, fake_spec_dict, release_repo
from .schema_check import errors

LINE = "zz-national"
BUILD = f"{LINE}/zz-build-1"
H5 = b"a fake national file"
H5_SHA = hashlib.sha256(H5).hexdigest()
ENGINE = {
    "policyengine": "6.16.1",
    "bundle_sha256": "b" * 64,
    "model": {"name": "policyengine-zz", "version": "1.0.0"},
    "core": {"name": "policyengine-core", "version": "3.33.3"},
}
POINT_NAME = re.compile(r"^[0-9a-f]{64}\.json$")


def repo(h5: bytes = H5, sha256: str = H5_SHA):
    hub = release_repo(
        {LINE: {"zz-build-1": {"published_at": "2026-11-01T00:00:00Z", "sha256": sha256}}}
    )
    hub.files[f"releases/{BUILD}/zz.h5"] = h5
    return hub


@pytest.fixture
def world(monkeypatch, tmp_path):
    """Patch the command's outside world; returns a function that runs `measure`."""
    state = {"spec": parse_spec(fake_spec_dict()), "hub": repo(), "backend": FakeBackend()}
    monkeypatch.setattr(cli, "load_spec", lambda country: state["spec"])
    monkeypatch.setattr(cli, "engine_identity", lambda spec: ENGINE)
    monkeypatch.setattr(cli, "environment", lambda lockfile: {"python": "3.12.0"})
    monkeypatch.setattr(cli, "_producer_commit", lambda: "0" * 40)
    monkeypatch.setattr(cli, "HubClient", lambda: state["hub"])
    monkeypatch.setattr(cli, "PolicyEngineBackend", lambda *args: state["backend"])
    monkeypatch.setattr(cli, "dataset_columns", lambda path: ["household_id"])
    monkeypatch.setattr(cli, "quiet", lambda path: contextlib.nullcontext())
    out = tmp_path / "out"
    state["out"] = out

    def run(capsys, **point):
        planned = {
            "build_id": BUILD,
            "release_directory": BUILD,
            "hf_repo": "policyengine/zz",
            "hf_commit": FAKE_COMMIT,
            "digest": H5_SHA,
            "attempt": 1,
            "last_attempt": False,
            **point,
        }
        code = cli.main(
            [
                "measure",
                "--country",
                "zz",
                "--point",
                json.dumps(planned),
                "--out",
                str(out),
                "--workdir",
                str(tmp_path / "work"),
            ]
        )
        printed = json.loads(capsys.readouterr().out.strip().splitlines()[-1])
        files = [p for p in out.rglob("*.json") if POINT_NAME.match(p.name)]
        stored = sorted(p for p in files if p.parent.name != "attempts")
        state["reports"] = {
            p.stem: json.loads(p.read_text()) for p in files if p.parent.name == "attempts"
        }
        for report in state["reports"].values():
            assert errors("attempt", report) == []
        return code, printed, stored

    state["run"] = run
    return state


def test_a_measured_file_is_one_immutable_point(world, capsys):
    code, printed, stored = world["run"](capsys)
    assert code == 0 and printed["status"] == "ok"
    assert len(stored) == 1
    # The interrupted report written before each stage is gone once the point is written.
    assert world["reports"] == {}
    document = json.loads(stored[0].read_text())
    assert document["measurement_id"] == stored[0].stem == printed["measurement_id"]
    assert document["measurement_id"] == measurement_id(document["panel_id"], H5_SHA)
    assert document["file"]["sha256"] == H5_SHA
    # Measuring the same file again, under any build name, finds the point.
    code, printed, _ = world["run"](capsys, build_id=f"{LINE}/zz-build-2")
    assert (code, printed["status"]) == (0, "exists")


@pytest.mark.parametrize(
    "case, stage, reason",
    [
        ("planned_file_changed", "open", "planned_file_changed"),
        ("unreadable_commit", "open", "repository_or_revision_unreadable"),
        ("manifest_missing", "open", "release_manifest_missing"),
        ("over_budget", "open", "exceeds_runner_budget"),
        ("corrupt_download", "download", "sha256_mismatch"),
        ("baseline_crash", "load", "load_failed"),
        ("reform_crash", "reform", "reform_failed"),
    ],
)
def test_a_failure_the_run_causes_stores_nothing(world, capsys, case, stage, reason):
    point = {}
    if case == "planned_file_changed":
        point = {"digest": "9" * 64}
    elif case == "unreadable_commit":
        point = {"hf_commit": "d" * 40}
    elif case == "manifest_missing":
        del world["hub"].files[f"releases/{BUILD}/release_manifest.json"]
    elif case == "over_budget":
        world["spec"] = parse_spec(fake_spec_dict(runner={"max_dataset_bytes": 1}))
    elif case == "corrupt_download":
        world["hub"] = repo(h5=b"another file's bytes")
    elif case == "baseline_crash":
        world["backend"] = FakeBackend(fail_on=lambda reform: True)
    elif case == "reform_crash":
        world["backend"] = FakeBackend(fail_on=lambda reform: bool(reform))
    code, printed, stored = world["run"](capsys, **point, attempt=2)
    assert code == cli.EXIT_RUN_FAILED
    assert (printed["status"], printed["stage"], printed["reason"]) == ("run_failed", stage, reason)
    assert stored == []
    # The attempt report names the planned file, the attempt, the stage and the reason.
    planned = point.get("digest", H5_SHA)
    report = world["reports"][planned]
    assert report["kind"] == "release_history.attempt"
    assert (report["status"], report["stage"], report["reason"]) == ("failed", stage, reason)
    assert (report["attempt"], report["last_attempt"], report["build_id"]) == (2, False, BUILD)


def test_an_unexpected_error_prints_its_class_only_and_stores_nothing(world, capsys, monkeypatch):
    def broken(path):
        raise KeyError("a message that could hold a figure: 123456.78")

    monkeypatch.setattr(cli, "dataset_columns", broken)
    code, printed, stored = world["run"](capsys)
    assert code == cli.EXIT_RUN_FAILED
    assert (printed["reason"], printed["error_class"]) == ("unexpected_error", "KeyError")
    assert "123456" not in json.dumps(printed)
    assert stored == []


def test_a_refusal_no_file_causes_is_never_stored(world, capsys, monkeypatch):
    world["spec"] = parse_spec(
        fake_spec_dict(
            disclosure={
                "policy": "source_household_small_cells",
                "min_source_households": 3,
                "source_id_columns": ["household_source_id"],
            }
        )
    )

    def odd(spec, path, household_ids):
        raise ReleaseRefusedError("error", "some_other_reason")

    monkeypatch.setattr(cli, "source_ids_for", odd)
    code, printed, stored = world["run"](capsys)
    assert (code, printed["reason"]) == (cli.EXIT_RUN_FAILED, "some_other_reason")
    assert stored == []


def test_a_run_near_a_runner_limit_is_flagged(world, capsys):
    # The fake file is 20 bytes: a 24-byte budget is 83% used, so it is flagged but measured.
    world["spec"] = parse_spec(fake_spec_dict(runner={"max_dataset_bytes": 24}))
    code, printed, stored = world["run"](capsys)
    assert (code, printed["status"]) == (0, "ok")
    assert printed["near_limits"] == [{"limit": "dataset", "share": 0.833}]
    document = json.loads(stored[0].read_text())
    assert document["runtime"]["near_limits"] == printed["near_limits"]
    assert document["runtime"]["limits"] == {
        "seconds": None,
        "memory_bytes": None,
        "dataset_bytes": 24,
        "warn_at": 0.8,
    }


def test_the_warning_reaches_the_run_page(world, capsys, monkeypatch, tmp_path):
    world["spec"] = parse_spec(fake_spec_dict(runner={"max_dataset_bytes": 24}))
    planned = {
        "build_id": BUILD,
        "release_directory": BUILD,
        "hf_repo": "policyengine/zz",
        "hf_commit": FAKE_COMMIT,
        "digest": H5_SHA,
    }
    out = tmp_path / "flagged"
    assert (
        cli.main(["measure", "--country", "zz", "--point", json.dumps(planned), "--out", str(out)])
        == 0
    )
    lines = capsys.readouterr().out.splitlines()
    assert lines[0] == (
        "::warning title=Release history near a runner limit::"
        f"zz {BUILD}: dataset at 83% of its limit"
    )


def test_a_build_folder_is_measured_before_it_is_published(world, capsys, tmp_path, monkeypatch):
    # A Microcosm post-build step: the folder Microcosm writes before it publishes. No Hub call.
    folder = tmp_path / "build"
    folder.mkdir()
    for path, data in world["hub"].files.items():
        if path.startswith(f"releases/{BUILD}/"):
            (folder / path.removeprefix(f"releases/{BUILD}/")).write_bytes(data)

    def no_hub():
        raise AssertionError("the Hub is not used for a build folder")

    monkeypatch.setattr(cli, "HubClient", no_hub)
    out = tmp_path / "out-local"
    code = cli.main(
        [
            "measure",
            "--country",
            "zz",
            "--build-dir",
            str(folder),
            "--build-id",
            BUILD,
            "--out",
            str(out),
            "--workdir",
            str(tmp_path / "work-local"),
        ]
    )
    printed = json.loads(capsys.readouterr().out.strip().splitlines()[-1])
    assert (code, printed["status"]) == (0, "ok")
    points = [p for p in out.rglob("*.json") if POINT_NAME.match(p.name)]
    document = json.loads(points[0].read_text())
    assert document["fetched_from"]["hf_commit"] is None
    assert document["fetched_from"]["build_id"] == BUILD
    assert document["file"]["sha256"] == H5_SHA
    # The build's own file is never deleted.
    assert (folder / "zz.h5").read_bytes() == H5


def test_a_reform_failure_is_stored_as_partial_on_the_last_attempt(world, capsys):
    world["backend"] = FakeBackend(fail_on=lambda reform: bool(reform) and "gov.tax.rate" in reform)
    code, printed, stored = world["run"](capsys, attempt=3, last_attempt=True)
    assert (code, printed["status"]) == (0, "partial")
    assert json.loads(stored[0].read_text())["reforms"]["tax_up"]["status"] == "error"


def test_a_refusal_the_file_causes_is_stored_as_a_gap(world, capsys, monkeypatch):
    world["spec"] = parse_spec(
        fake_spec_dict(
            disclosure={
                "policy": "source_household_small_cells",
                "min_source_households": 3,
                "source_id_columns": ["household_source_id"],
            }
        )
    )

    def missing(spec, path, household_ids):
        raise ReleaseRefusedError("error", "disclosure_source_ids_missing")

    monkeypatch.setattr(cli, "source_ids_for", missing)
    code, printed, stored = world["run"](capsys)
    assert (code, printed["status"], printed["reason"]) == (
        0,
        "refused",
        "disclosure_source_ids_missing",
    )
    document = json.loads(stored[0].read_text())
    assert (document["status"], document["reason"], document["cells"]) == (
        "refused",
        "disclosure_source_ids_missing",
        [],
    )


def test_a_transient_failure_stores_nothing_and_says_so(world, capsys, monkeypatch):
    def flaky(*args, **kwargs):
        raise TransientError("ConnectionError")

    monkeypatch.setattr(world["hub"], "download", flaky)
    code, printed, stored = world["run"](capsys)
    assert (code, printed["status"]) == (cli.EXIT_TRANSIENT, "transient")
    assert stored == []
    assert world["reports"][H5_SHA]["reason"] == "transient"


def test_a_run_killed_mid_simulation_leaves_an_interrupted_report(world, capsys):
    # A kill (out of memory, a step timeout) runs no handler: the report written before the
    # simulation is what reaches the store. Read it while each simulation runs.
    seen = []
    report_path = []

    class Watching(FakeBackend):
        def build(self, reform):
            path = next(Path(report_path[0]).rglob("attempts/*.json"))
            report = json.loads(path.read_text())
            seen.append((report["status"], report["stage"]))
            return super().build(reform)

    world["backend"] = Watching()
    report_path.append(world["out"])
    code, _, _ = world["run"](capsys)
    assert code == 0
    assert seen == [
        ("interrupted", "baseline"),
        ("interrupted", "reform:tax_up"),
        ("interrupted", "reform:benefit_up"),
    ]


def test_stdout_carries_no_figure(world, capsys):
    _, printed, stored = world["run"](capsys)
    values = {cell["value"] for cell in json.loads(stored[0].read_text())["cells"]}
    flat = json.dumps(printed)
    assert not any(str(value) in flat for value in values if value not in (None, 0, 0.0, 1, 1.0))
    assert set(printed) <= {
        "command",
        "status",
        "measurement_id",
        "panel_id",
        "build_id",
        "cells",
        "withheld",
        "seconds",
        "peak_rss_gb",
        "reforms",
        "near_limits",
    }


def test_points_never_land_outside_the_panel_folder(world, capsys, tmp_path):
    world["run"](capsys)
    root = tmp_path / "out"
    stored = [p.relative_to(root) for p in root.rglob("*") if p.is_file()]
    stored = [p for p in stored if p.parts[0] != ".logs"]
    assert {p.parts[:2] for p in stored} == {("release-history", "zz")}
    assert sorted(p.name for p in stored if len(p.parts) == 4)[-1] == "panel.json"
