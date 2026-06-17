"""Shared PolicyEngine variable calculation for Populace releases."""

from __future__ import annotations

import json
import math
import os
import time
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.request import urlopen

import numpy as np


DEFAULT_REPO = "policyengine/populace-us"
DEFAULT_REVISION = "main"
DEFAULT_FILENAME = "populace_us_2024.h5"

os.environ.setdefault("HF_HOME", "/tmp/huggingface")
os.environ.setdefault("HF_HUB_CACHE", "/tmp/huggingface/hub")
os.environ.setdefault("XDG_CACHE_HOME", "/tmp/.cache")


class VariableCalculationError(RuntimeError):
    """User-facing calculation failure."""


_SIM_CACHE: dict[tuple[str, str, str], tuple[str, Any]] = {}


def finite_float(value: Any) -> float | None:
    try:
        number = float(value)
    except (TypeError, ValueError):
        return None
    return number if math.isfinite(number) else None


def resolve_release_id(repo: str, revision: str, requested_release: str) -> str:
    if requested_release != "latest":
        return requested_release
    url = f"https://huggingface.co/datasets/{repo}/resolve/{revision}/latest.json"
    try:
        with urlopen(url, timeout=20) as response:
            pointer = json.loads(response.read().decode("utf-8"))
    except (HTTPError, URLError, TimeoutError, json.JSONDecodeError) as exc:
        raise VariableCalculationError(f"Could not resolve latest Populace release: {exc}") from exc
    release_id = str(pointer.get("release_id") or "").strip()
    if not release_id:
        raise VariableCalculationError("Could not resolve latest Populace release.")
    return release_id


def calculate_variables(
    *,
    variables: list[str],
    period: str,
    repo: str = DEFAULT_REPO,
    revision: str,
    filename: str = DEFAULT_FILENAME,
) -> dict[str, Any]:
    started = time.time()
    try:
        from huggingface_hub import hf_hub_download
        from policyengine_us import Microsimulation
    except Exception as exc:  # pragma: no cover - depends on host Python env.
        raise VariableCalculationError(
            "Python package policyengine_us or huggingface_hub is not installed "
            f"in the server environment: {exc}"
        ) from exc

    unique_variables = list(dict.fromkeys(v.strip() for v in variables if v.strip()))
    dataset = f"hf://{repo}/{filename}@{revision}"
    cache_key = (repo, revision, filename)

    try:
        cached = _SIM_CACHE.get(cache_key)
        if cached is None:
            dataset_path = hf_hub_download(
                repo_id=repo,
                filename=filename,
                revision=revision,
                repo_type="dataset",
            )
            sim = Microsimulation(dataset=dataset_path)
            _SIM_CACHE[cache_key] = (dataset_path, sim)
        else:
            dataset_path, sim = cached
        results = []
        for variable_name in unique_variables:
            variable_started = time.time()
            variable = sim.tax_benefit_system.get_variable(variable_name)
            values = sim.calculate(variable_name, period)
            raw_values = np.asarray(sim.calculate(variable_name, period, use_weights=False))
            weights = np.asarray(getattr(values, "weights", []))
            weighted_sum = finite_float(values.sum())
            raw_sum = finite_float(raw_values.sum())
            weight_sum = finite_float(weights.sum()) if weights.size else None
            nonzero_weight_count = int(np.count_nonzero(weights)) if weights.size else None
            results.append(
                {
                    "variable": variable_name,
                    "period": period,
                    "release_id": revision,
                    "dataset": dataset,
                    "entity": variable.entity.key,
                    "definition_period": str(variable.definition_period),
                    "label": getattr(variable, "label", None),
                    "documentation": getattr(variable, "documentation", None),
                    "value": weighted_sum,
                    "weighted_sum": weighted_sum,
                    "raw_sum": raw_sum,
                    "weight_sum": weight_sum,
                    "record_count": int(raw_values.size),
                    "nonzero_weight_count": nonzero_weight_count,
                    "elapsed_seconds": finite_float(time.time() - variable_started),
                }
            )
    except VariableCalculationError:
        raise
    except Exception as exc:
        raise VariableCalculationError(str(exc)) from exc

    result: dict[str, Any] = {
        "period": period,
        "release_id": revision,
        "dataset": dataset,
        "variables": results,
        "elapsed_seconds": finite_float(time.time() - started),
    }
    if len(results) == 1:
        result.update(results[0])
    return result
