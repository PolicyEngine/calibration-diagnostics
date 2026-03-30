"""Wrapper around Microsimulation.calculate() with result caching."""

from typing import Any

import numpy as np


class SimService:
    """Caches sim.calculate() results so repeated calls are free."""

    def __init__(self, sim: Any, time_period: int) -> None:
        self._sim = sim
        self._time_period = time_period
        self._cache: dict[str, np.ndarray] = {}

    def calculate(
        self,
        variable: str,
        map_to: str = "household",
    ) -> np.ndarray:
        key = f"{variable}:{map_to}"
        if key not in self._cache:
            self._cache[key] = (
                self._sim.calculate(variable, self._time_period, map_to=map_to)
                .values.astype(np.float64)
            )
        return self._cache[key]

    def get_variable_entity(self, variable: str) -> str:
        """Return the native entity key for a variable."""
        var_def = self._sim.tax_benefit_system.variables.get(variable)
        if var_def is None:
            raise ValueError(f"Unknown variable: {variable}")
        return var_def.entity.key

    def get_formula_dependencies(self, variable: str) -> list[str]:
        """Return the variable's adds/subtracts dependencies."""
        var_def = self._sim.tax_benefit_system.variables.get(variable)
        if var_def is None:
            return []
        deps: list[str] = []
        adds = getattr(var_def, "adds", None)
        subtracts = getattr(var_def, "subtracts", None)
        if isinstance(adds, list):
            deps.extend(adds)
        if isinstance(subtracts, list):
            deps.extend(subtracts)
        return deps

    def variable_exists(self, variable: str) -> bool:
        return variable in self._sim.tax_benefit_system.variables
