"""Tests for /targets multi-value filters and /targets/facets."""

from __future__ import annotations

import numpy as np
import pandas as pd
import pytest
import scipy.sparse as sp

from backend.routes.targets import (
    ERROR_BUCKETS,
    _apply_target_filters,
    get_facets,
    list_targets,
)
from backend.state import AppState


def _state(rows: list[dict]) -> AppState:
    df = pd.DataFrame(rows)
    n = len(df)
    return AppState(
        X_csr=sp.csr_matrix((n, 1)),
        X_csc=sp.csc_matrix((n, 1)),
        targets_df=df,
        target_names=df.get("target_name", pd.Series(dtype=str)).tolist(),
        initial_weights=np.array([1.0]),
        cd_geoid=np.array([0]),
        targets_enriched=df,
        n_targets=n,
        n_households=1,
        dataset_id="us-cps",
        run_id="r",
    )


def _make_rows() -> list[dict]:
    return [
        {"target_name": "national/snap_enrollment/[]",  "variable": "snap_enrollment",  "geo_level": "national", "abs_rel_error": 0.02, "rel_error":  0.02, "loss_contribution": 0.10, "included": True,  "value": 100, "estimate": 102, "geographic_id": None, "domain_variable": None},
        {"target_name": "state/snap_enrollment/AL/[]", "variable": "snap_enrollment",  "geo_level": "state",    "abs_rel_error": 0.30, "rel_error": -0.30, "loss_contribution": 0.20, "included": True,  "value": 100, "estimate":  70, "geographic_id": "01", "domain_variable": None},
        {"target_name": "national/tax_unit_eitc/[]",  "variable": "tax_unit_eitc",    "geo_level": "national", "abs_rel_error": 0.60, "rel_error":  0.60, "loss_contribution": 0.50, "included": True,  "value": 100, "estimate": 160, "geographic_id": None, "domain_variable": None},
        {"target_name": "state/agi/CA/[]",            "variable": "agi",              "geo_level": "state",    "abs_rel_error": 0.07, "rel_error": -0.07, "loss_contribution": 0.05, "included": False, "value": 100, "estimate":  93, "geographic_id": "06", "domain_variable": None},
        {"target_name": "district/snap/CA-12/[]",     "variable": "snap_enrollment",  "geo_level": "district", "abs_rel_error": 0.04, "rel_error": -0.04, "loss_contribution": 0.02, "included": True,  "value": 100, "estimate":  96, "geographic_id": "0612", "domain_variable": None},
        {"target_name": "district/snap/TX-15/[]",     "variable": "snap_enrollment",  "geo_level": "district", "abs_rel_error": 0.45, "rel_error":  0.45, "loss_contribution": 0.30, "included": True,  "value": 100, "estimate": 145, "geographic_id": "4815", "domain_variable": None},
    ]


# ---------- _apply_target_filters ----------

def test_filter_by_single_variable():
    s = _state(_make_rows())
    out = _apply_target_filters(s.targets_enriched, variables=["snap_enrollment"])
    assert sorted(out["target_name"]) == [
        "district/snap/CA-12/[]",
        "district/snap/TX-15/[]",
        "national/snap_enrollment/[]",
        "state/snap_enrollment/AL/[]",
    ]


def test_filter_by_multiple_variables():
    s = _state(_make_rows())
    out = _apply_target_filters(s.targets_enriched, variables=["snap_enrollment", "agi"])
    assert len(out) == 5


def test_filter_by_geo_levels():
    s = _state(_make_rows())
    out = _apply_target_filters(s.targets_enriched, geo_levels=["state"])
    assert (out["geo_level"] == "state").all()
    assert len(out) == 2


def test_filter_by_error_bucket_excellent():
    s = _state(_make_rows())
    out = _apply_target_filters(s.targets_enriched, error_buckets=["excellent"])
    # national snap (0.02) + CA-12 district (0.04)
    assert sorted(out["target_name"].tolist()) == [
        "district/snap/CA-12/[]",
        "national/snap_enrollment/[]",
    ]


def test_filter_by_error_bucket_extreme():
    s = _state(_make_rows())
    out = _apply_target_filters(s.targets_enriched, error_buckets=["extreme"])
    assert len(out) == 1
    assert out.iloc[0]["variable"] == "tax_unit_eitc"


def test_filter_by_multiple_error_buckets():
    s = _state(_make_rows())
    out = _apply_target_filters(s.targets_enriched, error_buckets=["poor", "extreme"])
    # 0.30 (AL poor) + 0.45 (TX-15 poor) + 0.60 (eitc extreme)
    assert len(out) == 3


def test_filter_error_bucket_unknown_ignored():
    """Unknown bucket names should not crash; they just contribute no mask."""
    s = _state(_make_rows())
    out = _apply_target_filters(s.targets_enriched, error_buckets=["nonsense"])
    assert len(out) == 0  # no known masks → nothing matches


def test_filter_included_only():
    s = _state(_make_rows())
    incl = _apply_target_filters(s.targets_enriched, included_only=True)
    assert (incl["included"]).all()
    assert len(incl) == 5


def test_search_matches_target_name_and_variable():
    s = _state(_make_rows())
    out = _apply_target_filters(s.targets_enriched, search="eitc")
    assert len(out) == 1
    assert "eitc" in out.iloc[0]["target_name"].lower()


def test_search_is_case_insensitive():
    s = _state(_make_rows())
    out = _apply_target_filters(s.targets_enriched, search="SNAP")
    # national snap + AL snap + CA-12 snap + TX-15 snap
    assert len(out) == 4


def test_search_returns_empty_when_no_match():
    s = _state(_make_rows())
    out = _apply_target_filters(s.targets_enriched, search="zzzzz")
    assert len(out) == 0


def test_filters_compose():
    """variable + error_bucket should AND together."""
    s = _state(_make_rows())
    out = _apply_target_filters(
        s.targets_enriched,
        variables=["snap_enrollment"],
        error_buckets=["poor"],
    )
    # AL (0.30) and TX-15 (0.45) both match poor + snap_enrollment
    assert sorted(out["target_name"].tolist()) == [
        "district/snap/TX-15/[]",
        "state/snap_enrollment/AL/[]",
    ]


# ---------- list_targets (endpoint function) ----------

def test_filter_by_state_fips_single():
    """state_fips=[6] should match CA state row + CA-12 district row."""
    s = _state(_make_rows())
    out = _apply_target_filters(s.targets_enriched, state_fips=[6])
    names = sorted(out["target_name"].tolist())
    assert names == ["district/snap/CA-12/[]", "state/agi/CA/[]"]


def test_filter_by_state_fips_multi():
    """state_fips=[1, 48] matches AL state + TX-15 district."""
    s = _state(_make_rows())
    out = _apply_target_filters(s.targets_enriched, state_fips=[1, 48])
    names = sorted(out["target_name"].tolist())
    assert names == ["district/snap/TX-15/[]", "state/snap_enrollment/AL/[]"]


def test_filter_state_fips_with_geo_level():
    """state_fips + geo_level=state should narrow to CA state only (not CA-12)."""
    s = _state(_make_rows())
    out = _apply_target_filters(
        s.targets_enriched, state_fips=[6], geo_levels=["state"],
    )
    assert out["target_name"].tolist() == ["state/agi/CA/[]"]


def test_filter_state_fips_empty_list_is_no_op():
    s = _state(_make_rows())
    out = _apply_target_filters(s.targets_enriched, state_fips=[])
    assert len(out) == len(_make_rows())


def test_list_targets_no_filters_returns_total():
    s = _state(_make_rows())
    resp = list_targets(state=s)
    assert resp.total == 6
    assert len(resp.items) == 6


def test_list_targets_paging():
    s = _state(_make_rows())
    resp1 = list_targets(limit=2, offset=0, state=s)
    resp2 = list_targets(limit=2, offset=2, state=s)
    assert resp1.total == 6
    assert len(resp1.items) == 2
    assert len(resp2.items) == 2
    # No overlap
    seen1 = {i.target_idx for i in resp1.items}
    seen2 = {i.target_idx for i in resp2.items}
    assert not (seen1 & seen2)


def test_list_targets_sort_by_loss_desc():
    s = _state(_make_rows())
    resp = list_targets(sort_by="loss_contribution", sort_order="desc", state=s)
    losses = [i.loss_contribution for i in resp.items]
    assert losses == sorted(losses, reverse=True)


def test_list_targets_variable_multi():
    s = _state(_make_rows())
    resp = list_targets(variable=["snap_enrollment", "agi"], state=s)
    assert resp.total == 5  # 3 snap (national/state/district CA) + 1 TX + 1 agi


# ---------- facets endpoint ----------

def test_facets_returns_expected_shape():
    s = _state(_make_rows())
    out = get_facets(state=s)
    for key in ("by_variable", "by_geo_level", "by_error_bucket", "by_status",
                "buckets_definition"):
        assert key in out


def test_facets_by_variable_ordered_by_total_loss():
    s = _state(_make_rows())
    out = get_facets(state=s)
    losses = [v["total_loss"] for v in out["by_variable"]]
    assert losses == sorted(losses, reverse=True)


def test_facets_error_bucket_counts():
    s = _state(_make_rows())
    out = get_facets(state=s)
    counts = {b["value"]: b["count"] for b in out["by_error_bucket"]}
    assert counts["excellent"] == 2  # 0.02, 0.04
    assert counts["good"] == 1       # 0.07
    assert counts["poor"] == 2       # 0.30, 0.45
    assert counts["extreme"] == 1    # 0.60


def test_facets_by_variable_unaffected_by_variable_filter():
    """Selecting a variable shouldn't suppress other variables from the facet —
    so the user can pivot. Counts on other facets reflect the variable selection."""
    s = _state(_make_rows())
    out = get_facets(variable=["snap_enrollment"], state=s)
    variables_shown = {v["value"] for v in out["by_variable"]}
    assert "tax_unit_eitc" in variables_shown
    assert "agi" in variables_shown


def test_facets_geo_level_counts_reflect_variable_filter():
    """Picking variable=snap_enrollment narrows the geo_level facet counts
    to only rows matching snap_enrollment."""
    s = _state(_make_rows())
    out = get_facets(variable=["snap_enrollment"], state=s)
    geo_counts = {g["value"]: g["count"] for g in out["by_geo_level"]}
    # snap_enrollment has one national + one state row → both 1, no agi/eitc geos
    assert geo_counts.get("national") == 1
    assert geo_counts.get("state") == 1


def test_facets_status_counts():
    s = _state(_make_rows())
    out = get_facets(state=s)
    counts = {v["value"]: v["count"] for v in out["by_status"]}
    assert counts == {"included": 5, "skipped": 1}


def test_error_buckets_cover_full_range():
    """Buckets should partition [0, inf) so any abs_rel_error lands in exactly one."""
    boundaries = sorted([(lo, hi) for lo, hi in ERROR_BUCKETS.values()])
    # Boundaries should chain
    for (_, hi_prev), (lo_next, _) in zip(boundaries, boundaries[1:]):
        assert hi_prev == lo_next, f"gap or overlap at {hi_prev}/{lo_next}"
    assert boundaries[0][0] == 0.0
    assert boundaries[-1][1] == float("inf")
