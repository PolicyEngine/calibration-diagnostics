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


def test_enrich_collapses_state_fips_snap_family():
    row = populace._enrich(
        {
            "name": "US06/snap-cost",
            "target": 100.0,
            "initial_estimate": 90.0,
            "final_estimate": 99.0,
            "relative_error": -0.01,
            "within_tolerance": True,
        }
    )
    assert row["family"] == "snap-cost"
    assert row["state"] is None


_LIVE_SCORECARD = {
    "schema_version": 1,
    "candidate_release_id": "populace-us-2024-f32c2e5-20260614",
    "status": "archived",
    "period": 2024,
    "summary": {
        "candidate_loss": 0.2,
        "baseline_loss": 1.4,
        "loss_delta": -1.2,
        "candidate_holdout_loss": 0.04,
        "baseline_holdout_loss": 0.3,
        "candidate_unweighted_msre": 0.23,
        "baseline_unweighted_msre": 1.3,
        "candidate_wins": 1100,
        "baseline_wins": 2550,
        "ties": 54,
        "n_targets": 3704,
        "candidate_beats_baseline": True,
        "matched_household_count": 41314,
    },
    "family_breakdown": [{"family": "x", "n_targets": 1}],
    "top_improvements": [],
    "top_regressions": [],
}


def _offline_benchmarks(monkeypatch):
    """No pointer override, no direct URL, and the network raises."""
    monkeypatch.setattr(populace, "_BENCHMARKS_SCORECARD_URL", None)

    def _raise(url):
        raise RuntimeError("benchmarks unreachable")

    monkeypatch.setattr(populace, "_fetch_json", _raise)


def test_populace_comparison_serves_archived_snapshot(monkeypatch):
    _offline_benchmarks(monkeypatch)
    payload = populace.populace_comparison()

    assert payload["available"] is True
    assert payload["archived"] is True
    assert payload["source"] == "deployed_static_snapshot"
    assert payload["scorecard_status"] == "archived"
    assert payload["live_scorecard_error"] == "benchmarks unreachable"
    assert payload["candidate_label"] == "populace"
    assert payload["baseline_label"] == "enhanced_cps"

    s = payload["summary"]
    # The 9f1260b scorecard: populace beats eCPS on loss but loses the win count.
    assert s["candidate_loss"] < s["baseline_loss"]
    assert s["candidate_beats_baseline"] is True
    assert s["candidate_wins"] + s["baseline_wins"] + s["ties"] == s["n_targets"]
    assert s["matched_household_count"] > 0

    assert payload["family_breakdown"]
    assert payload["top_regressions"]
    assert payload["top_improvements"]
    assert any("populace-benchmarks#3" in note for note in payload["notes"])


def test_populace_comparison_resolves_benchmarks_pointer(monkeypatch):
    monkeypatch.setattr(populace, "_BENCHMARKS_SCORECARD_URL", None)
    seen = {}

    def _fake_fetch(url):
        seen["last"] = url
        if url.endswith("latest.json"):
            return {
                "schema_version": 1,
                "candidate_release_id": "populace-us-2024-f32c2e5-20260614",
                "scorecard_path": "archive/us/populace-us-2024-f32c2e5-20260614/scorecard.json",
                "status": "archived",
            }
        assert url.endswith(
            "archive/us/populace-us-2024-f32c2e5-20260614/scorecard.json"
        ), url
        return _LIVE_SCORECARD

    monkeypatch.setattr(populace, "_fetch_json", _fake_fetch)
    payload = populace.populace_comparison()

    assert payload["archived"] is False
    assert payload["source"] == "populace_benchmarks_live"
    assert payload["scorecard_status"] == "archived"
    assert payload["release_id"] == "populace-us-2024-f32c2e5-20260614"
    assert payload["summary"]["candidate_wins"] == 1100
    # The scorecard URL was resolved against the pointer's repo base.
    assert seen["last"].startswith(
        "https://raw.githubusercontent.com/PolicyEngine/populace-benchmarks/main/"
    )


def test_populace_comparison_direct_url_overrides_pointer(monkeypatch):
    monkeypatch.setattr(
        populace, "_BENCHMARKS_SCORECARD_URL", "https://example.test/scorecard.json"
    )
    calls = []

    def _fake_fetch(url):
        calls.append(url)
        return _LIVE_SCORECARD

    monkeypatch.setattr(populace, "_fetch_json", _fake_fetch)
    payload = populace.populace_comparison()

    assert payload["source"] == "populace_benchmarks_live"
    assert payload["summary"]["candidate_wins"] == 1100
    # Direct URL skips the pointer: exactly one fetch, to the direct URL.
    assert calls == ["https://example.test/scorecard.json"]


def test_populace_comparison_falls_back_when_pointer_unreachable(monkeypatch):
    _offline_benchmarks(monkeypatch)
    payload = populace.populace_comparison()

    assert payload["archived"] is True
    assert payload["source"] == "deployed_static_snapshot"
    assert payload["live_scorecard_error"] == "benchmarks unreachable"
