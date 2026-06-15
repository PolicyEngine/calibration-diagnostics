from __future__ import annotations

from backend.routes import populace


def _offline(monkeypatch):
    """Force the live Hugging Face path to fail so routes use the snapshot."""

    def _raise(url):
        raise RuntimeError("offline test fixture")

    monkeypatch.setattr(populace, "_fetch_json", _raise)


def test_populace_overview_serves_snapshot_when_offline(monkeypatch):
    _offline(monkeypatch)
    payload = populace.populace_overview()

    assert payload["source"] == "deployed_static_snapshot"
    assert payload["live_unavailable_reason"]
    assert payload["release_id"] == payload["snapshot_release_id"]
    assert payload["release_id"].startswith("populace-us-")

    build = payload["build_manifest"]
    assert build["builder"] == "populace"
    assert build["dataset"]["filename"] == "populace_us_2024.h5"

    gates = payload["gates"]
    assert gates["calibration"]["within_10pct_share"] is not None
    assert "smoke" in gates

    cal = payload["calibration"]
    assert cal["available"] is True
    assert cal["total_targets"] > 3000
    assert cal["final_loss"] < cal["initial_loss"]
    assert cal["n_nonzero"] is not None and cal["n_records"] is not None
    assert cal["family_fit"]
    # Family fit rows are consistent: within-10% never exceeds the count.
    for row in cal["family_fit"]:
        assert 0 <= row["within_10pct"] <= row["n_targets"]
        assert 0 <= row["within_tolerance"] <= row["n_targets"]

    highlights = payload["highlights"]
    assert len(highlights["worst_fit"]) == 15
    assert len(highlights["biggest_improvements"]) == 15
    # Worst-fit is sorted by descending absolute relative error.
    worst = [r["abs_relative_error"] for r in highlights["worst_fit"]]
    assert worst == sorted(worst, reverse=True)


def test_populace_overview_prefers_live_release(monkeypatch):
    live_build = {
        "build_id": "populace-us-2024-fffffff-20990101",
        "builder": "populace",
        "dataset": {"filename": "populace_us_2024.h5"},
        "gates": {"parity_gaps": 0, "smoke": {}},
    }
    live_release = {"schema_version": 1, "build": {"build_id": live_build["build_id"]}}

    def _fake_fetch(url):
        if url.endswith("latest.json"):
            return {
                "schema_version": 1,
                "release_id": "populace-us-2024-fffffff-20990101",
                "updated_at": "2099-01-01T00:00:00+00:00",
                "paths": {
                    "build_manifest": (
                        "releases/populace-us-2024-fffffff-20990101/build_manifest.json"
                    ),
                    "release_manifest": (
                        "releases/populace-us-2024-fffffff-20990101/"
                        "release_manifest.json"
                    ),
                    "calibration_diagnostics": (
                        "releases/populace-us-2024-fffffff-20990101/"
                        "calibration_diagnostics.json"
                    ),
                },
            }
        if url.endswith("build_manifest.json"):
            return live_build
        if url.endswith("release_manifest.json"):
            return live_release
        raise AssertionError(f"unexpected fetch {url}")

    monkeypatch.setattr(populace, "_fetch_json", _fake_fetch)
    payload = populace.populace_overview()

    assert payload["source"] == "huggingface_live"
    assert payload["release_id"] == "populace-us-2024-fffffff-20990101"
    assert payload["updated_at"] == "2099-01-01T00:00:00+00:00"
    assert payload["build_manifest"]["build_id"] == live_build["build_id"]
    # The committed per-target snapshot is from an older release.
    assert payload["calibration_snapshot_stale"] is True


def test_populace_target_diagnostics_filters_and_sorts():
    payload = populace.populace_target_diagnostics(
        limit=10,
        offset=0,
        family=None,
        state=None,
        direction="over",
        within_tolerance="false",
        search=None,
        sort_by="abs_relative_error",
        sort_dir="desc",
    )

    assert payload["available"] is True
    assert payload["returned"] == len(payload["targets"]) <= 10
    assert payload["filtered_total"] <= payload["total_targets"]
    assert payload["families"]
    for row in payload["targets"]:
        assert row["direction"] == "over"
        assert row["within_tolerance"] is False
    errors = [
        r["abs_relative_error"]
        for r in payload["targets"]
        if r.get("abs_relative_error") is not None
    ]
    assert errors == sorted(errors, reverse=True)


def test_populace_target_diagnostics_default_sort_is_worst_fit():
    payload = populace.populace_target_diagnostics(
        limit=20, offset=0, family=None, state=None, direction=None,
        within_tolerance=None, search=None, sort_by=None, sort_dir="desc",
    )
    errors = [r["abs_relative_error"] for r in payload["targets"]]
    assert errors == sorted(errors, reverse=True)


def test_populace_target_diagnostics_pagination():
    first = populace.populace_target_diagnostics(
        limit=5, offset=0, family=None, state=None, direction=None,
        within_tolerance=None, search=None, sort_by="name", sort_dir="asc",
    )
    second = populace.populace_target_diagnostics(
        limit=5, offset=5, family=None, state=None, direction=None,
        within_tolerance=None, search=None, sort_by="name", sort_dir="asc",
    )
    assert first["has_next"] is True
    first_names = {r["name"] for r in first["targets"]}
    second_names = {r["name"] for r in second["targets"]}
    assert not first_names & second_names


def test_populace_target_diagnostics_family_filter():
    payload = populace.populace_target_diagnostics(
        limit=50, offset=0, family="nation/irs", state=None, direction=None,
        within_tolerance=None, search=None, sort_by=None, sort_dir="desc",
    )
    assert payload["filtered_total"] >= 1
    for row in payload["targets"]:
        assert row["family"] == "nation/irs"


def test_populace_target_diagnostics_search():
    payload = populace.populace_target_diagnostics(
        limit=50, offset=0, family=None, state=None, direction=None,
        within_tolerance=None, search="snap", sort_by=None, sort_dir="desc",
    )
    assert payload["filtered_total"] >= 1
    for row in payload["targets"]:
        haystack = " ".join(
            str(row.get(key, "")) for key in ("name", "family", "state")
        ).lower()
        assert "snap" in haystack


def test_enrich_derives_state_distribution_family():
    row = populace._enrich(
        {
            "name": "state/AL/adjusted_gross_income/count/1_1",
            "target": 100.0,
            "initial_estimate": 80.0,
            "final_estimate": 95.0,
            "relative_error": -0.05,
            "within_tolerance": True,
        }
    )
    assert row["family"] == "state_distribution"
    assert row["state"] == "AL"
    # Calibration moved the estimate closer to the target → positive improvement.
    assert row["improvement"] > 0
    assert row["direction"] == "under"
