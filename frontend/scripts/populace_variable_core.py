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


class VariableCalculationError(RuntimeError):
    """User-facing calculation failure."""


_SIM_CACHE: dict[tuple[str, str, str, str | None], tuple[str, Any]] = {}


# revision -> (memfd, symlink path). The fd must stay open: the symlink
# resolves through /proc/self/fd and the memory frees when the fd closes.
_MEMFD_DATASETS: dict[str, tuple[int, str]] = {}


def _download_dataset(hf_hub_download: Any, repo: str, filename: str, revision: str) -> str:
    """Fetch the release H5 to somewhere it actually fits.

    Vercel's ephemeral disk is 550MB with ~150MB of function bundle, so a
    ~340MB H5 can never land on disk, and /dev/shm mounts are container-tiny.
    A memfd is an anonymous RAM-backed file charged to the function's memory
    (3GB), exposed through a zero-byte /tmp symlink so pytables gets a real
    .h5 path. One release resident at a time; local dev (no memfd on macOS)
    keeps the normal HF cache download.
    """
    if not hasattr(os, "memfd_create"):
        return hf_hub_download(
            repo_id=repo, filename=filename, revision=revision, repo_type="dataset"
        )
    cached = _MEMFD_DATASETS.get(revision)
    if cached and os.path.exists(cached[1]):
        return cached[1]
    for rev, (fd, link) in list(_MEMFD_DATASETS.items()):
        if rev != revision:
            for key in [k for k in _SIM_CACHE if k[1] == rev]:
                _SIM_CACHE.pop(key, None)
            try:
                os.close(fd)
            except OSError:
                pass
            try:
                os.unlink(link)
            except OSError:
                pass
            _MEMFD_DATASETS.pop(rev, None)

    from urllib.request import Request

    url = f"https://huggingface.co/datasets/{repo}/resolve/{revision}/{filename}"
    request = Request(url)
    token = os.environ.get("HF_TOKEN") or os.environ.get("HUGGING_FACE_HUB_TOKEN")
    if token:
        request.add_header("Authorization", f"Bearer {token}")
    fd = os.memfd_create(f"populace-{revision}")
    try:
        with urlopen(request, timeout=600) as response:
            while True:
                chunk = response.read(16 * 1024 * 1024)
                if not chunk:
                    break
                os.write(fd, chunk)
        link = f"/tmp/populace-{revision}.h5"
        try:
            os.unlink(link)
        except FileNotFoundError:
            pass
        os.symlink(f"/proc/self/fd/{fd}", link)
    except BaseException:
        os.close(fd)
        raise
    _MEMFD_DATASETS[revision] = (fd, link)
    return link


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
                for dirpath, _dirnames, filenames in os.walk(path, onerror=lambda e: None):
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
    except Exception:  # pragma: no cover - depends on host Python env.
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


def state_prefix_for_variable(variable_name: str) -> str | None:
    prefix = variable_name.split("_", 1)[0].upper()
    return prefix if prefix in STATE_FIPS else None


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

    try:
        _evict_other_releases(repo, filename, revision)
        dataset_path = _download_dataset(hf_hub_download, repo, filename, revision)

        def get_sim(state: str | None = None) -> Any:
            cache_key = (repo, revision, filename, state)
            cached = _SIM_CACHE.get(cache_key)
            if cached is not None:
                return cached[1]
            sim_dataset = (
                state_filtered_dataset(dataset_path, state) if state else dataset_path
            )
            sim = Microsimulation(dataset=sim_dataset)
            _SIM_CACHE[cache_key] = (dataset_path, sim)
            return sim

        results = []
        for variable_name in unique_variables:
            variable_started = time.time()
            sim = get_sim(state_prefix_for_variable(variable_name))
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
        "release_id": revision,
        "dataset": dataset,
        "variables": results,
        "elapsed_seconds": finite_float(time.time() - started),
    }
    if len(results) == 1:
        result.update(results[0])
    return result
