from __future__ import annotations

import pandas as pd

from backend.services.analysis_readiness import (
    audit_target_config,
    build_bundle_health,
    build_dependency_trace,
    build_domain_breakdown,
    build_readiness,
    list_policyengine_variables,
)
from backend.state import AppState


class _Entity:
    def __init__(self, key: str):
        self.key = key


class _Variable:
    def __init__(
        self,
        *,
        entity: str = "tax_unit",
        label: str | None = None,
        formulas: bool = False,
        adds=None,
        subtracts=None,
    ):
        self.entity = _Entity(entity)
        self.label = label
        self.formulas = {"0001-01-01": object()} if formulas else {}
        self.adds = adds
        self.subtracts = subtracts


class _TBS:
    def __init__(self, variables):
        self.variables = variables


class _Tracer:
    def get_flat_trace(self):
        return {
            "snap<2024, (default)>": {
                "dependencies": [
                    "spm_unit_net_income<2024, (default)>",
                    "household_weight<2024, (default)>",
                ]
            },
            "spm_unit_net_income<2024, (default)>": {
                "dependencies": ["employment_income<2024, (default)>"]
            },
            "employment_income<2024, (default)>": {"dependencies": []},
            "household_weight<2024, (default)>": {"dependencies": []},
        }


class _Sim:
    def __init__(self):
        self.tax_benefit_system = _TBS(
            {
                "snap": _Variable(entity="spm_unit", formulas=True),
                "spm_unit_net_income": _Variable(entity="spm_unit", formulas=True),
                "employment_income": _Variable(entity="person"),
                "household_weight": _Variable(entity="household"),
                "income_tax": _Variable(entity="tax_unit", formulas=True),
                "refundable_ctc": _Variable(entity="tax_unit", formulas=True),
                "ctc": _Variable(entity="tax_unit", formulas=True),
                "non_refundable_ctc": _Variable(
                    entity="tax_unit",
                    adds=["ctc"],
                    subtracts=["refundable_ctc"],
                ),
                "ca_income_tax": _Variable(entity="tax_unit", formulas=True),
                "ca_income_tax_before_credits": _Variable(
                    entity="tax_unit",
                    formulas=True,
                ),
                "ca_income_tax_before_refundable_credits": _Variable(
                    entity="tax_unit",
                    formulas=True,
                ),
            }
        )
        self.input_variables = {"employment_income", "household_weight"}
        self.tracer = _Tracer()
        self.trace = False

    def calculate(self, variable, period=None):
        return [0]


def _state() -> AppState:
    targets = pd.DataFrame(
        [
            {
                "target_id": 1,
                "variable": "snap",
                "geo_level": "state",
                "geographic_id": "30",
                "domain_variable": "snap",
                "value": 100.0,
                "estimate": 106.0,
                "abs_rel_error": 0.06,
                "included": True,
            },
            {
                "target_id": 2,
                "variable": "household_count",
                "geo_level": "state",
                "geographic_id": "30",
                "domain_variable": "snap",
                "value": 10.0,
                "estimate": 10.0,
                "abs_rel_error": 0.0,
                "included": True,
            },
            {
                "target_id": 3,
                "variable": "refundable_ctc",
                "geo_level": "state",
                "geographic_id": "30",
                "domain_variable": "refundable_ctc",
                "value": 50.0,
                "estimate": 55.0,
                "abs_rel_error": 0.1,
                "included": True,
            },
            {
                "target_id": 4,
                "variable": "income_tax",
                "geo_level": "state",
                "geographic_id": "6",
                "domain_variable": "",
                "value": 200.0,
                "estimate": 210.0,
                "abs_rel_error": 0.05,
                "included": True,
            },
            {
                "target_id": 5,
                "variable": "nonexistent",
                "geo_level": "state",
                "geographic_id": "30",
                "domain_variable": "",
                "value": 1.0,
                "estimate": None,
                "abs_rel_error": None,
                "included": False,
            },
            {
                "target_id": 6,
                "target_name": (
                    "national/eitc/US/[adjusted_gross_income >= 0,"
                    "adjusted_gross_income < 10000]"
                ),
                "variable": "eitc",
                "geo_level": "national",
                "geographic_id": "US",
                "domain_variable": "adjusted_gross_income",
                "value": 20.0,
                "estimate": 22.0,
                "abs_rel_error": 0.1,
                "included": True,
            },
            {
                "target_id": 7,
                "target_name": (
                    "national/eitc/US/[adjusted_gross_income >= 10000,"
                    "adjusted_gross_income < 25000]"
                ),
                "variable": "eitc",
                "geo_level": "national",
                "geographic_id": "US",
                "domain_variable": "adjusted_gross_income",
                "value": 30.0,
                "estimate": 36.0,
                "abs_rel_error": 0.2,
                "included": True,
            },
        ]
    )
    households = pd.DataFrame(
        {
            "state": [30] * 20 + [6] * 10,
            "final_weight": [1.0] * 30,
        }
    )
    return AppState(
        targets_enriched=targets,
        households_df=households,
        sim_service=_Sim(),
        target_config={
            "include": [
                {"variable": "snap", "geo_level": "state"},
                {"domain_variable": "snap", "geo_level": "state"},
                {"variable": "missing_rule", "geo_level": "state"},
            ]
        },
        time_period=2024,
    )


def _bundle_state() -> AppState:
    state = _state()
    state.dataset_id = "local"
    state.run_id = "test"
    state.targets_enriched = pd.DataFrame(
        [
            {
                "target_id": 1,
                "target_name": "state/snap/8/[]",
                "variable": "snap",
                "geo_level": "state",
                "geographic_id": "8",
                "value": 100.0,
                "estimate": 110.0,
                "rel_error": 0.10,
                "abs_rel_error": 0.10,
                "included": True,
                "source": "test",
            },
            {
                "target_id": 2,
                "target_name": "state/income_tax/8/[]",
                "variable": "income_tax",
                "geo_level": "state",
                "geographic_id": "8",
                "value": 200.0,
                "estimate": 260.0,
                "rel_error": 0.30,
                "abs_rel_error": 0.30,
                "included": False,
                "source": "test",
            },
            {
                "target_id": 3,
                "target_name": "state/snap/6/[]",
                "variable": "snap",
                "geo_level": "state",
                "geographic_id": "6",
                "value": 300.0,
                "estimate": 300.0,
                "rel_error": 0.0,
                "abs_rel_error": 0.0,
                "included": True,
                "source": "test",
            },
        ]
    )
    return state


def test_federal_snap_readiness_is_ready_with_targets_and_model_node():
    result = build_readiness("federal_snap", _state())

    assert result["status"] == "ready"
    assert result["target_summary"]["included_targets"] == 2
    assert result["target_summary"]["evaluated"] == 2
    assert "snap" in result["modeled_variables"]["present_dependency_variables"]


def test_montana_ctc_readiness_blocks_without_state_specific_model_node():
    result = build_readiness("montana_ctc", _state())

    assert result["status"] == "blocked"
    assert result["target_summary"]["included_targets"] == 1
    assert result["modeled_variables"]["state_specific_matches"] == []
    assert any("state-specific reform" in b for b in result["blockers"])


def test_california_income_tax_readiness_uses_ca_model_node():
    result = build_readiness("california_income_tax", _state())

    assert result["status"] == "ready"
    assert result["target_summary"]["included_targets"] == 1
    assert "ca_income_tax" in result["modeled_variables"]["state_specific_matches"]


def test_policyengine_variable_catalog_lists_all_variables_with_target_flags():
    items = list_policyengine_variables(_state())

    by_name = {item["name"]: item for item in items}
    assert "ca_income_tax" in by_name
    assert "employment_income" in by_name
    assert by_name["income_tax"]["is_target_variable"] is True
    assert by_name["snap"]["is_domain_variable"] is True


def test_target_config_audit_flags_zero_match_rules():
    result = audit_target_config(_state())

    assert result["rule_count"] == 3
    assert result["zero_match_count"] == 1
    assert result["rules"][2]["status"] == "zero_match"


def test_target_config_audit_scopes_to_selected_variable():
    state = _state()
    state.targets_enriched["included"] = False

    result = audit_target_config(state, variable="snap")

    assert result["selected_variable"] == "snap"
    assert result["target_count"] == 2
    assert result["included_target_count"] == 2
    assert result["matched_rule_count"] == 2
    assert result["zero_match_count"] == 0
    assert [rule["rule"].get("variable") for rule in result["rules"]] == [
        "snap",
        None,
    ]


def test_dependency_trace_classifies_stored_and_targeted_leaf_nodes():
    result = build_dependency_trace("snap", _state(), max_nodes=25)

    assert result["summary"]["leaf_nodes"] == 2
    assert result["summary"]["stored_leaf_nodes"] == 2
    snap = next(n for n in result["nodes"] if n["variable"] == "snap")
    assert snap["depth"] == 0
    assert snap["direct_target_count"] == 1
    assert snap["domain_target_count"] == 2
    assert snap["included_target_count"] == 2
    assert snap["evaluated_target_count"] == 2
    assert snap["median_abs_rel_error"] == 0.03
    employment = next(
        n for n in result["nodes"] if n["variable"] == "employment_income"
    )
    assert employment["depth"] == 2
    assert employment["is_stored_input"] is True
    assert employment["is_target_variable"] is False


def test_domain_breakdown_groups_targets_by_agi_bucket():
    result = build_domain_breakdown(
        _state(),
        variable="eitc",
        domain_variable="adjusted_gross_income",
    )

    assert result["summary"]["target_count"] == 2
    assert result["summary"]["included_target_count"] == 2
    assert [row["bucket"] for row in result["rows"]] == [
        "0 to 10,000",
        "10,000 to 25,000",
    ]
    assert result["rows"][0]["median_abs_rel_error"] == 0.1


def test_bundle_health_summarizes_one_dataset_file():
    result = build_bundle_health(
        _bundle_state(),
        dataset_file="states/CO.h5",
        limit=1,
    )

    assert result["dataset_file"] == "states/CO.h5"
    assert result["summary"]["target_count"] == 2
    assert result["summary"]["included_target_count"] == 1
    assert result["summary"]["evaluated_target_count"] == 2
    assert result["summary"]["median_abs_rel_error"] == 0.2
    assert result["worst_targets"][0]["variable"] == "income_tax"
    assert {row["variable"] for row in result["by_variable"]} == {
        "income_tax",
        "snap",
    }
