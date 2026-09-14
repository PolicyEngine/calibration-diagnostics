"""A scope switch must release native cycles before the next input load."""
import importlib
from pathlib import Path
import weakref


def test_scope_switch_releases_prior_simulation_before_build(monkeypatch):
    monkeypatch.syspath_prepend(str(Path(__file__).resolve().parents[1]))
    core = importlib.import_module("scripts.microcosm_variable_core")
    monkeypatch.setattr(core, "_SIM_CACHE", {})

    class NativeSimulation:
        def __init__(self):
            self.population = self

    previous = None
    built = []
    for scope in (None, "CA", "IN", None):
        def build():
            assert previous is None or previous() is None
            built.append(scope)
            return NativeSimulation()

        key = ("repo", "revision", "file", scope)
        sim = core._simulation_for(key, "input.h5", build)
        assert core._simulation_for(key, "input.h5", build) is sim
        assert len(core._SIM_CACHE) == 1
        previous = weakref.ref(sim)
        del sim
    assert built == [None, "CA", "IN", None]
