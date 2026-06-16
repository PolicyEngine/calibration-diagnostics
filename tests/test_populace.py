from __future__ import annotations

import pytest

from backend.routes import populace


@pytest.fixture(autouse=True)
def _offline_by_default(monkeypatch):
    """Default every test to the committed snapshot: any live HF fetch raises
    unless a test installs its own ``_fetch_json``. Keeps the suite network-free
    and deterministic against the pinned snapshot."""

    def _raise(url):
        raise RuntimeError("offline (no _fetch_json override in this test)")

    monkeypatch.setattr(populace, "_fetch_json", _raise)


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

def test_parse_target_decomposes_conventions():
    # National IRS AGI bracket.
    p = populace._parse_target(
        "nation/irs/adjusted gross income/total/AGI in 50k-75k/taxable/All"
    )
    assert p["level"] == "national"
    assert p["geography"] == "United States"
    assert p["source"] == "irs"
    assert p["variable"] == "adjusted gross income"
    assert "AGI in 50k-75k" in p["breakdown"]

    # Source-keyed state target with trailing state code.
    p = populace._parse_target("state/census/acs/rent/AK")
    assert p["geography"] == "AK"
    assert p["source"] == "census"
    assert p["variable"] == "acs"

    # State-keyed distribution: slot 2 is the state, grouped under "state".
    p = populace._parse_target("state/AL/adjusted_gross_income/count/1_1")
    assert p["geography"] == "AL"
    assert p["source"] == "state"
    assert p["variable"] == "adjusted_gross_income"

    # Per-state-FIPS admin metric.
    p = populace._parse_target("US06/snap-cost")
    assert p["geography"] == "CA"
    assert p["source"] == "admin"
    assert p["variable"] == "snap-cost"


def test_target_diagnostics_exposes_variables_and_sources():
    payload = populace.populace_target_diagnostics(
        limit=1, offset=0, family=None, variable=None, source=None, level=None,
        state=None, direction=None, within_tolerance=None, search=None,
        sort_by=None, sort_dir="desc",
    )
    variables = payload["variables"]
    assert len(variables) > 50
    # The state-keyed AGI distribution collapses to ONE variable, not 50.
    keys = {v["variable_key"] for v in variables}
    assert "irs / adjusted gross income" in keys
    assert "state / adjusted_gross_income" in keys
    assert not any(v["source"] in {"AL", "AK", "CA"} for v in variables)
    # variables are sorted by target count descending.
    counts = [v["n_targets"] for v in variables]
    assert counts == sorted(counts, reverse=True)
    # sources are the real source families, not state codes.
    assert "irs" in payload["sources"] and "census" in payload["sources"]
    assert "CA" not in payload["sources"]


def test_target_diagnostics_variable_filter_isolates_breakdowns():
    payload = populace.populace_target_diagnostics(
        limit=200, offset=0, family=None, variable="irs / adjusted gross income",
        source=None, level=None, state=None, direction=None, within_tolerance=None,
        search=None, sort_by=None, sort_dir="desc",
    )
    assert payload["filtered_total"] == 70
    for row in payload["targets"]:
        assert row["variable_key"] == "irs / adjusted gross income"
        assert row["variable"] == "adjusted gross income"
        assert row["breakdown"]  # each row is a distinct breakdown


def test_target_diagnostics_source_and_level_filters():
    payload = populace.populace_target_diagnostics(
        limit=10, offset=0, family=None, variable=None, source="irs", level="national",
        state=None, direction=None, within_tolerance=None, search=None,
        sort_by=None, sort_dir="desc",
    )
    assert payload["filtered_total"] >= 1
    for row in payload["targets"]:
        assert row["source"] == "irs"
        assert row["level"] == "national"


def test_target_diagnostics_dimensions_and_facet_filter():
    # Selecting AGI yields typed facets; the constant measure drops, and
    # geography/level are constant here (all national, US) so they drop too.
    payload = populace.populace_target_diagnostics(
        limit=200, offset=0, family=None, variable="irs / adjusted gross income",
        source=None, level=None, state=None, direction=None, within_tolerance=None,
        search=None, facet=None, sort_by=None, sort_dir="desc",
    )
    labels = {d["label"] for d in payload["dimensions"]}
    assert "Income band" in labels
    assert "Return type" in labels
    assert "Filing status" in labels
    assert "Measure" not in labels  # "total" is constant -> dropped
    assert "Geography" not in labels  # all United States -> dropped
    income = next(d for d in payload["dimensions"] if d["label"] == "Income band")
    assert "key" in income and income["key"].startswith("dim")
    # Income bands sorted by lower bound (negatives first, not lexically).
    assert income["values"][0].startswith("AGI in -inf")

    # Filtering by two facets narrows to the matching breakdown.
    filing = next(d for d in payload["dimensions"] if d["label"] == "Filing status")
    filtered = populace.populace_target_diagnostics(
        limit=10, offset=0, family=None, variable="irs / adjusted gross income",
        source=None, level=None, state=None, direction=None, within_tolerance=None,
        search=None,
        facet=[f"{income['key']}:AGI in 200k-500k", f"{filing['key']}:All"],
        sort_by=None, sort_dir="desc",
    )
    assert filtered["filtered_total"] == 1
    row = filtered["targets"][0]
    assert "AGI in 200k-500k" in row["dims"]
    assert "All" in row["dims"]


def test_state_conditioned_variable_exposes_geography_facet():
    # real_estate_taxes is conditioned on state, not AGI: geography + level vary.
    payload = populace.populace_target_diagnostics(
        limit=5, offset=0, family=None, variable="irs / real_estate_taxes",
        source=None, level=None, state=None, direction=None, within_tolerance=None,
        search=None, facet=None, sort_by=None, sort_dir="desc",
    )
    by_key = {d["key"]: d for d in payload["dimensions"]}
    assert "geography" in by_key
    geo = by_key["geography"]
    assert "United States" in geo["values"]
    assert geo["values"][0] == "United States"  # national first
    assert len(geo["values"]) > 10  # the states

    # Facet by a state narrows to that geography.
    one = populace.populace_target_diagnostics(
        limit=5, offset=0, family=None, variable="irs / real_estate_taxes",
        source=None, level=None, state=None, direction=None, within_tolerance=None,
        search=None, facet=["geography:CA"], sort_by=None, sort_dir="desc",
    )
    assert one["filtered_total"] >= 1
    for row in one["targets"]:
        assert row["geography"] == "CA"


def test_dimensions_absent_without_variable():
    payload = populace.populace_target_diagnostics(
        limit=1, offset=0, family=None, variable=None, source=None, level=None,
        state=None, direction=None, within_tolerance=None, search=None, facet=None,
        sort_by=None, sort_dir="desc",
    )
    assert payload["dimensions"] == []
