"""Scope variables using actual country metadata, without any calculation."""

import importlib
from pathlib import Path

import pytest


@pytest.fixture(scope="module")
def country_variables():
    from policyengine_us.system import system

    return system


@pytest.mark.parametrize(
    ("name", "expected"),
    [
        ("in_poverty", None),
        ("in_deep_poverty", None),
        ("in_income_tax", "IN"),
        ("ca_income_tax", "CA"),
    ],
)
def test_scope_comes_from_country_metadata(
    country_variables, monkeypatch, name, expected
):
    monkeypatch.syspath_prepend(str(Path(__file__).resolve().parents[1]))
    core = importlib.import_module("scripts.microcosm_variable_core")
    variable = country_variables.get_variable(name)
    assert variable is not None
    assert core.state_for_variable(variable) == expected
