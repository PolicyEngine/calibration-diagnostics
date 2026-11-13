"""The simulation boundary: the only module that touches PolicyEngine.

`Backend.build(reform)` returns a `SimulationView`, which answers
`values(variable, period, map_to=...)` with plain numpy arrays. Measurement
code sees nothing else, so tests run on a fake backend and no other module
imports a country model.

The real backend uses policyengine.py's lazy path,
`policyengine.<module>.managed_microsimulation(dataset=<path>,
allow_unmanaged=True, reform=...)`: the same construction policyengine.py
uses, computing only the variables a measurement asks for. The dataset's
sha256 is verified by `releases.download_verified` before it gets here,
because `allow_unmanaged` skips policyengine.py's own check.
"""

from __future__ import annotations

import gc
import importlib
import threading
import time
import warnings
from collections.abc import Mapping
from dataclasses import dataclass, field
from typing import Any, Protocol

import numpy as np


class SimulationView(Protocol):
    def values(self, variable: str, period: int, map_to: str | None = None) -> np.ndarray: ...

    def entity_of(self, variable: str) -> str: ...

    def variable_names(self) -> set[str]: ...

    @property
    def parameters(self) -> Any: ...

    def close(self) -> None: ...


class Backend(Protocol):
    def build(self, reform: Mapping[str, Mapping[str, Any]] | None) -> SimulationView: ...


@dataclass
class PolicyEngineSimulation:
    """A country Microsimulation seen as arrays."""

    microsimulation: Any

    def values(self, variable: str, period: int, map_to: str | None = None) -> np.ndarray:
        result = self.microsimulation.calculate(variable, period, map_to=map_to)
        return np.asarray(getattr(result, "values", result))

    def entity_of(self, variable: str) -> str:
        return self.microsimulation.tax_benefit_system.variables[variable].entity.key

    def variable_names(self) -> set[str]:
        return set(self.microsimulation.tax_benefit_system.variables)

    @property
    def parameters(self) -> Any:
        return self.microsimulation.tax_benefit_system.parameters

    @property
    def bundle(self) -> dict[str, Any]:
        """The engine facts worth keeping: the bundle id and the capital gains
        response assumption policyengine.py applied. Runtime paths are left out."""
        bundle = dict(getattr(self.microsimulation, "policyengine_bundle", {}) or {})
        return {k: bundle[k] for k in ("bundle_id", "capital_gains_responses") if k in bundle}

    def close(self) -> None:
        self.microsimulation = None
        gc.collect()


@dataclass
class PolicyEngineBackend:
    """Builds simulations of one verified local H5 on the installed engine."""

    module: str
    dataset_path: str
    options: Mapping[str, Any] = field(default_factory=dict)

    def build(self, reform: Mapping[str, Mapping[str, Any]] | None) -> PolicyEngineSimulation:
        policyengine = importlib.import_module("policyengine")
        country = getattr(policyengine, self.module)
        kwargs = dict(self.options)
        if reform:
            kwargs["reform"] = {path: dict(values) for path, values in reform.items()}
        microsimulation = country.managed_microsimulation(
            dataset=self.dataset_path, allow_unmanaged=True, **kwargs
        )
        return PolicyEngineSimulation(microsimulation)


class PeakMemory:
    """Sample this process's resident memory while a block runs."""

    def __init__(self, interval: float = 0.2) -> None:
        self.interval = interval
        self.peak_bytes = 0
        self.seconds = 0.0
        self._stop = threading.Event()
        self._thread: threading.Thread | None = None

    def _sample(self) -> None:
        try:
            import psutil
        except ImportError:  # pragma: no cover - psutil is a dependency
            return
        process = psutil.Process()
        while not self._stop.is_set():
            self.peak_bytes = max(self.peak_bytes, process.memory_info().rss)
            self._stop.wait(self.interval)

    def __enter__(self) -> PeakMemory:
        self._started = time.monotonic()
        self._thread = threading.Thread(target=self._sample, daemon=True)
        self._thread.start()
        return self

    def __exit__(self, *exc: object) -> None:
        self._stop.set()
        if self._thread is not None:
            self._thread.join()
        self.seconds = time.monotonic() - self._started


class WarningLog:
    """Collect the classes of warnings a block raises, never their text."""

    def __init__(self) -> None:
        self.classes: set[str] = set()
        self._context: Any = None

    def __enter__(self) -> WarningLog:
        self._context = warnings.catch_warnings(record=True)
        self._records = self._context.__enter__()
        warnings.simplefilter("always")
        return self

    def __exit__(self, *exc: object) -> None:
        self.classes.update(record.category.__name__ for record in self._records)
        self._context.__exit__(*exc)
