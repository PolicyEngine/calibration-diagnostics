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

    score = payload["score_vs_enhanced_cps"]
    assert set(score["per_target_wins"]) == {"populace", "enhanced_cps", "ties"}
    assert score["full_loss"]["populace"] < score["full_loss"]["enhanced_cps"]

    comparison = payload["comparison"]
    assert comparison["available"] is True
    assert comparison["family_breakdown"]
    assert comparison["top_regressions"]
    assert comparison["top_improvements"]

    diagnostics = payload["target_diagnostics"]
    assert diagnostics["available"] is True
    assert diagnostics["total_targets"] > 3000
    assert len(diagnostics["targets"]) == 100
    assert diagnostics["baseline_label"] == "enhanced_cps"
    assert diagnostics["candidate_label"] == "populace"


def test_populace_overview_prefers_live_release(monkeypatch):
    live_build = {
        "build_id": "populace-us-2024-fffffff-20990101",
        "builder": "populace",
        "gates": {"parity_gaps": 0},
        "score_vs_enhanced_cps": {"per_target_wins": {}},
    }
    live_release = {"schema_version": 1, "build": {"build_id": live_build["build_id"]}}

    def _fake_fetch(url):
        if "/tree/" in url:
            return [
                {
                    "type": "file",
                    "path": "releases/populace-us-2024-ffffffff-20990101/x",
                },
                {
                    "type": "file",
                    "path": (
                        "releases/populace-us-2024-fffffff-20990101/"
                        "build_manifest.json"
                    ),
                },
                {
                    "type": "file",
                    "path": (
                        "releases/populace-us-2024-fffffff-20990101/"
                        "release_manifest.json"
                    ),
                },
            ]
        if url.endswith("build_manifest.json"):
            return live_build
        if url.endswith("release_manifest.json"):
            return live_release
        raise AssertionError(f"unexpected fetch {url}")

    monkeypatch.setattr(populace, "_fetch_json", _fake_fetch)
    payload = populace.populace_overview()

    assert payload["source"] == "huggingface_live"
    assert payload["release_id"] == "populace-us-2024-fffffff-20990101"
    assert payload["build_manifest"]["build_id"] == live_build["build_id"]
    # The committed per-target snapshot is from an older release.
    assert payload["comparison_snapshot_stale"] is True


def test_populace_target_diagnostics_filters_and_sorts():
    payload = populace.populace_target_diagnostics(
        limit=10,
        offset=0,
        family=None,
        split="holdout",
        winner="candidate",
        search=None,
        sort_by="candidate_loss_term",
        sort_dir="desc",
    )

    assert payload["available"] is True
    assert payload["returned"] == len(payload["targets"]) <= 10
    assert payload["filtered_total"] <= payload["total_targets"]
    assert payload["families"]
    for row in payload["targets"]:
        assert row["split"] == "holdout"
        assert row["winner"] == "candidate"
    loss_terms = [
        row["candidate_loss_term"]
        for row in payload["targets"]
        if row.get("candidate_loss_term") is not None
    ]
    assert loss_terms == sorted(loss_terms, reverse=True)


def test_populace_target_diagnostics_pagination():
    first = populace.populace_target_diagnostics(
        limit=5, offset=0, family=None, split=None, winner=None,
        search=None, sort_by="target_index", sort_dir="asc",
    )
    second = populace.populace_target_diagnostics(
        limit=5, offset=5, family=None, split=None, winner=None,
        search=None, sort_by="target_index", sort_dir="asc",
    )
    assert first["has_next"] is True
    first_ids = {row["target_index"] for row in first["targets"]}
    second_ids = {row["target_index"] for row in second["targets"]}
    assert not first_ids & second_ids


def test_populace_target_diagnostics_search():
    payload = populace.populace_target_diagnostics(
        limit=50, offset=0, family=None, split=None, winner=None,
        search="snap", sort_by=None, sort_dir="asc",
    )
    assert payload["filtered_total"] >= 1
    for row in payload["targets"]:
        haystack = " ".join(
            str(row.get(key, ""))
            for key in ("target_name", "family", "split", "winner")
        ).lower()
        assert "snap" in haystack
