"""Shared PolicyEngine variable calculation for Microcosm releases."""

from __future__ import annotations

import math
import os
import time
import uuid
from pathlib import PurePosixPath
from typing import Any

import numpy as np

from scripts.hosted_release import (
    VariableCalculationError,
    download_certification,
    reviewed_release,
    validate_runtime,
    validate_selection,
    verify_h5,
)
from scripts.runtime_identity import host_resources

# Deprecated upstream identifiers: Microcosm's current HF repository and H5
# filename still use the former Populace names.
_REVIEWED = reviewed_release()
DEFAULT_REPO = _REVIEWED["repo"]
DEFAULT_REVISION = _REVIEWED["hf_revision"]
DEFAULT_FILENAME = _REVIEWED["filename"]
DEFAULT_RELEASE = _REVIEWED["release_id"]
DEFAULT_PERIOD = str(_REVIEWED["data_year"])

os.environ.setdefault("HF_HOME", "/tmp/huggingface")
os.environ.setdefault("HF_HUB_CACHE", "/tmp/huggingface/hub")
os.environ.setdefault("XDG_CACHE_HOME", "/tmp/.cache")
# The Xet download backend keeps a content-chunk cache (HF_HOME/xet) that
# grows across every release ever fetched and fails mid-download with
# 'File reconstruction error: No space left on device' once the ephemeral
# disk fills. Plain HTTP streams straight to the blob instead.
os.environ.setdefault("HF_HUB_DISABLE_XET", "1")

STATE_FIPS = {
    "AL": 1,
    "AK": 2,
    "AZ": 4,
    "AR": 5,
    "CA": 6,
    "CO": 8,
    "CT": 9,
    "DE": 10,
    "DC": 11,
    "FL": 12,
    "GA": 13,
    "HI": 15,
    "ID": 16,
    "IL": 17,
    "IN": 18,
    "IA": 19,
    "KS": 20,
    "KY": 21,
    "LA": 22,
    "ME": 23,
    "MD": 24,
    "MA": 25,
    "MI": 26,
    "MN": 27,
    "MS": 28,
    "MO": 29,
    "MT": 30,
    "NE": 31,
    "NV": 32,
    "NH": 33,
    "NJ": 34,
    "NM": 35,
    "NY": 36,
    "NC": 37,
    "ND": 38,
    "OH": 39,
    "OK": 40,
    "OR": 41,
    "PA": 42,
    "RI": 44,
    "SC": 45,
    "SD": 46,
    "TN": 47,
    "TX": 48,
    "UT": 49,
    "VT": 50,
    "VA": 51,
    "WA": 53,
    "WV": 54,
    "WI": 55,
    "WY": 56,
}


_SIM_CACHE: dict[tuple[str, str, str, str | None], tuple[str, Any]] = {}
# Max state-filtered sims kept resident (plus the national sim); each pins a
# full Microsimulation, so this caps warm-instance memory.
_MAX_STATE_SIMS = 3


def _download_dataset(
    hf_hub_download: Any, repo: str, filename: str, revision: str
) -> str:
    """Download immutable bytes to the backend's disk before verification."""
    return hf_hub_download(
        repo_id=repo, filename=filename, revision=revision, repo_type="dataset"
    )


def _disk_usage_report(root: str = "/tmp") -> str:
    """Top disk consumers under /tmp plus free space — inlined into ENOSPC
    errors so a full serverless instance tells us what filled it."""
    import shutil

    entries = []
    try:
        for name in os.listdir(root):
            path = os.path.join(root, name)
            total = 0
            if os.path.isfile(path):
                total = os.path.getsize(path)
            elif os.path.isdir(path):
                for dirpath, _dirnames, filenames in os.walk(
                    path, onerror=lambda e: None
                ):
                    for f in filenames:
                        try:
                            total += os.path.getsize(os.path.join(dirpath, f))
                        except OSError:
                            pass
            entries.append((total, name))
    except OSError as exc:
        return f"(could not scan {root}: {exc})"
    entries.sort(reverse=True)
    top = ", ".join(f"{name}={size / 1e6:.0f}MB" for size, name in entries[:6])
    try:
        usage = shutil.disk_usage(root)
        free = f"free={usage.free / 1e6:.0f}MB of {usage.total / 1e6:.0f}MB"
    except OSError:
        free = "free=?"
    return f"{free}; {top}"


def _evict_other_releases(repo: str, filename: str, revision: str) -> None:
    """Keep at most one dataset in the ephemeral HF cache.

    Each release id is a git revision on the HF repo, so a warm serverless
    instance accumulates one multi-hundred-MB H5 (plus partial downloads) per
    release it has served — until a download dies mid-write with 'No space
    left on device'. Before downloading a revision we don't already have,
    wipe the repo's cache directory and drop cached simulations for other
    revisions (they also hold the instance's memory).
    """
    try:
        from huggingface_hub import try_to_load_from_cache
    except ImportError:  # pragma: no cover - depends on host Python env.
        return
    cached = try_to_load_from_cache(
        repo_id=repo, filename=filename, revision=revision, repo_type="dataset"
    )
    if isinstance(cached, str) and os.path.exists(cached):
        return
    import shutil

    for key in [k for k in _SIM_CACHE if k[1] != revision]:
        _SIM_CACHE.pop(key, None)
    cache_root = os.environ.get("HF_HUB_CACHE", "/tmp/huggingface/hub")
    repo_dir = os.path.join(cache_root, f"datasets--{repo.replace('/', '--')}")
    shutil.rmtree(repo_dir, ignore_errors=True)
    # Xet chunk cache from any request that ran before it was disabled.
    hf_home = os.environ.get("HF_HOME", "/tmp/huggingface")
    shutil.rmtree(os.path.join(hf_home, "xet"), ignore_errors=True)


def finite_float(value: Any) -> float | None:
    try:
        number = float(value)
    except (TypeError, ValueError):
        return None
    return number if math.isfinite(number) else None


def state_for_variable(variable: Any) -> str | None:
    """Use declared country metadata; national ``in_*`` names are not Indiana."""
    defined_for = getattr(variable, "defined_for", None)
    if isinstance(defined_for, str) and defined_for in STATE_FIPS:
        return defined_for
    parts = PurePosixPath(str(getattr(variable, "module_name", ""))).parts
    for index in range(len(parts) - 2):
        if parts[index : index + 2] == ("gov", "states"):
            state = parts[index + 2].upper()
            return state if state in STATE_FIPS else None
    return None


def state_filtered_dataset(dataset_path: str, state: str) -> Any:
    try:
        import pandas as pd
        from policyengine_us.data import USSingleYearDataset
    except Exception as exc:  # pragma: no cover - depends on host Python env.
        raise VariableCalculationError(
            f"Could not load state-filtered dataset dependencies: {exc}"
        ) from exc

    state_fips = STATE_FIPS[state]
    with pd.HDFStore(dataset_path, mode="r") as store:
        household = store["household"]
        person = store["person"]
        tax_unit = store["tax_unit"]
        family = store["family"]
        spm_unit = store["spm_unit"]
        marital_unit = store["marital_unit"]
        time_period = (
            int(store["_time_period"].iloc[0])
            if "_time_period" in store
            else int(DEFAULT_FILENAME.split("_")[-1].split(".")[0])
        )

    state_household = household.loc[household["state_fips"] == state_fips].copy()
    household_ids = set(state_household["household_id"])
    state_person = person.loc[person["person_household_id"].isin(household_ids)].copy()

    def subset_entity(df: Any, id_column: str, person_column: str) -> Any:
        ids = set(state_person[person_column])
        return df.loc[df[id_column].isin(ids)].copy()

    return USSingleYearDataset(
        person=state_person,
        household=state_household,
        tax_unit=subset_entity(tax_unit, "tax_unit_id", "person_tax_unit_id"),
        spm_unit=subset_entity(spm_unit, "spm_unit_id", "person_spm_unit_id"),
        family=subset_entity(family, "family_id", "person_family_id"),
        marital_unit=subset_entity(
            marital_unit, "marital_unit_id", "person_marital_unit_id"
        ),
        time_period=time_period,
    )


def calculate_variables(
    *,
    variables: list[str],
    period: str,
    repo: str = DEFAULT_REPO,
    revision: str | None = None,
    hf_revision: str = DEFAULT_REVISION,
    filename: str = DEFAULT_FILENAME,
) -> dict[str, Any]:
    started = time.time()
    config = validate_selection(
        requested_release=revision,
        repo=repo,
        hf_revision=hf_revision,
        filename=filename,
        period=period,
    )
    runtime = validate_runtime(config)
    release_id = config["release_id"]
    revision = config["hf_revision"]
    try:
        from huggingface_hub import hf_hub_download
    except Exception as exc:  # pragma: no cover - depends on host Python env.
        raise VariableCalculationError(
            f"Could not import huggingface_hub in the server environment: {exc}"
        ) from exc

    unique_variables = list(dict.fromkeys(v.strip() for v in variables if v.strip()))
    dataset = f"hf://{repo}/{filename}@{revision}"

    try:
        download_certification(config, hf_hub_download)
        _evict_other_releases(repo, filename, revision)
        dataset_path = _download_dataset(hf_hub_download, repo, filename, revision)
        actual_sha256 = verify_h5(dataset_path, config)

        # Country initialization and H5 input loading happen only after the
        # installed package tuple, release certificate, and bytes are verified.
        from policyengine_us import Microsimulation
        from policyengine_us.system import system

        simulation_cache_hits: dict[str, bool] = {}

        def get_sim(state: str | None = None) -> Any:
            cache_key = (repo, revision, filename, state)
            cached = _SIM_CACHE.get(cache_key)
            simulation_cache_hits.setdefault(state or "national", cached is not None)
            if cached is not None:
                return cached[1]
            sim_dataset = (
                state_filtered_dataset(dataset_path, state) if state else dataset_path
            )
            sim = Microsimulation(dataset=sim_dataset)
            _SIM_CACHE[cache_key] = (dataset_path, sim)
            # Bound the cache: each state-filtered sim pins another full
            # Microsimulation, so an unbounded cache OOMs a warm host serving
            # lookups across many states. Keep the national sim plus the few
            # most-recent state sims (dict preserves insertion order).
            state_keys = [k for k in _SIM_CACHE if k[3] is not None]
            while len(state_keys) > _MAX_STATE_SIMS:
                _SIM_CACHE.pop(state_keys.pop(0), None)
            return sim

        results = []
        for variable_name in unique_variables:
            variable_started = time.time()
            variable = system.get_variable(variable_name)
            if variable is None:
                raise VariableCalculationError(
                    f"Unknown variable: {variable_name}", status_code=400
                )
            state = state_for_variable(variable)
            sim = get_sim(state)
            values = sim.calculate(variable_name, period)
            raw_values = np.asarray(
                sim.calculate(variable_name, period, use_weights=False)
            )
            weights = np.asarray(getattr(values, "weights", []))
            weighted_sum = finite_float(values.sum())
            raw_sum = finite_float(raw_values.sum())
            weight_sum = finite_float(weights.sum()) if weights.size else None
            nonzero_weight_count = (
                int(np.count_nonzero(weights)) if weights.size else None
            )
            results.append(
                {
                    "variable": variable_name,
                    "period": period,
                    "release_id": release_id,
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
                    "state_filter": state,
                    "elapsed_seconds": finite_float(time.time() - variable_started),
                }
            )
    except VariableCalculationError:
        raise
    except OSError as exc:
        if getattr(exc, "errno", None) == 28:
            raise VariableCalculationError(
                f"{exc} — disk usage: {_disk_usage_report()}"
            ) from exc
        raise VariableCalculationError(str(exc)) from exc
    except Exception as exc:
        raise VariableCalculationError(str(exc)) from exc

    result: dict[str, Any] = {
        "period": period,
        "release_id": release_id,
        "dataset": dataset,
        "variables": results,
        "runtime": runtime,
        "data_identity": {**config, "sha256": actual_sha256, "verified": True},
        "execution": {
            "id": str(uuid.uuid4()),
            "simulation_cache_hits": simulation_cache_hits,
            "host_resources_after_calculation": host_resources(),
        },
        "elapsed_seconds": finite_float(time.time() - started),
    }
    if len(results) == 1:
        result.update(results[0])
    return result
