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


# Sentinel .h5 path -> the release H5 bytes held in RAM. Populated only when
# the dataset can't fit on the ephemeral disk (see _download_dataset).
_CORE_IMAGES: dict[str, bytes] = {}
_CORE_LABEL_SEQ = [0]
_CORE_PATCH_INSTALLED = [False]


def _install_core_hdfstore_patch() -> None:
    """Route pd.HDFStore(sentinel) reads through HDF5's in-memory core driver.

    policyengine-us opens datasets with a hardcoded ``pd.HDFStore(path,
    mode="r")`` in several places (schema validation, format sniffing, our own
    state filter). When ``path`` is one of our sentinels we inject the core
    driver with the release bytes as an in-memory image — HDF5 reads the exact
    same file content from RAM (verified byte-identical), so no dataset ever
    has to touch the too-small disk. The core driver refuses an existing file,
    so it opens under a throwaway label; the sentinel itself stays a 0-byte
    file purely so the loaders' ``Path.exists()`` checks pass.
    """
    if _CORE_PATCH_INSTALLED[0]:
        return
    import pandas as pd

    real_hdfstore = pd.HDFStore

    class _CoreImageHDFStore(real_hdfstore):  # type: ignore[misc, valid-type]
        def __init__(self, path: Any, *args: Any, **kwargs: Any) -> None:
            image = _CORE_IMAGES.get(str(path))
            if image is not None and "driver" not in kwargs:
                _CORE_LABEL_SEQ[0] += 1
                label = f"/tmp/.populace-core-{os.getpid()}-{_CORE_LABEL_SEQ[0]}.h5"
                kwargs.update(
                    driver="H5FD_CORE",
                    driver_core_image=image,
                    driver_core_backing_store=0,
                )
                super().__init__(label, *args, **kwargs)
                return
            super().__init__(path, *args, **kwargs)

    pd.HDFStore = _CoreImageHDFStore
    _CORE_PATCH_INSTALLED[0] = True


def _download_dataset(hf_hub_download: Any, repo: str, filename: str, revision: str) -> str:
    """Fetch the release H5 to wherever it fits.

    The normal HF cache download is used everywhere it works (local dev, and
    any host whose disk holds the file). Vercel's ephemeral disk is only
    ~550MB with ~150MB of function bundle, so a ~340MB H5 cannot land on disk
    at all — hf_hub_download fails there with ENOSPC. In that case the H5 is
    streamed into RAM and served through HDF5's in-memory core driver instead,
    charged to the function's much larger memory allocation.
    """
    try:
        return hf_hub_download(
            repo_id=repo, filename=filename, revision=revision, repo_type="dataset"
        )
    except OSError as exc:
        if getattr(exc, "errno", None) != 28:
            raise
        return _load_release_into_ram(repo, filename, revision)


def _cgroup_memory_limit_bytes() -> int | None:
    """The function's hard memory limit, from the cgroup (v2 then v1)."""
    for path in ("/sys/fs/cgroup/memory.max", "/sys/fs/cgroup/memory/memory.limit_in_bytes"):
        try:
            with open(path) as handle:
                raw = handle.read().strip()
        except OSError:
            continue
        if raw and raw != "max":
            try:
                value = int(raw)
            except ValueError:
                continue
            # cgroup v1 reports a huge sentinel when unlimited.
            if 0 < value < (1 << 62):
                return value
    return None


def _url_content_length(url: str, headers: dict[str, str]) -> int | None:
    from urllib.request import Request

    request = Request(url, method="HEAD")
    for key, value in headers.items():
        request.add_header(key, value)
    try:
        with urlopen(request, timeout=60) as response:
            length = response.headers.get("Content-Length")
            return int(length) if length else None
    except (OSError, ValueError):
        return None


def _load_release_into_ram(repo: str, filename: str, revision: str) -> str:
    import shutil
    from urllib.request import Request

    sentinel = f"/tmp/populace-{revision}.h5"
    if sentinel in _CORE_IMAGES and os.path.exists(sentinel):
        return sentinel

    url = f"https://huggingface.co/datasets/{repo}/resolve/{revision}/{filename}"
    token = os.environ.get("HF_TOKEN") or os.environ.get("HUGGING_FACE_HUB_TOKEN")
    auth = {"Authorization": f"Bearer {token}"} if token else {}

    # A full Microsimulation over a populace release needs base runtime + two
    # copies of the H5 (our retained image + HDF5's transient core copy) +
    # entity arrays — empirically >3GB, which OOM-kills a 3GB serverless
    # function. When the cgroup limit is that tight, refuse up front with a
    # clear message instead of being OOM-killed mid-load. A host with more
    # memory (the Modal backend, or local dev with no cgroup limit) proceeds.
    # Reaching here means the H5 didn't fit on disk (ENOSPC) — which only
    # happens on the tiny-disk Vercel function; Modal and local dev have disk
    # and never take this branch. Unless we can positively confirm a generous
    # memory limit (>=4GB, e.g. a big-RAM/small-disk host), refuse with a clear
    # message rather than be OOM-killed loading a >3GB microsimulation. The
    # cgroup file is often unreadable on serverless, so unknown == refuse.
    limit = _cgroup_memory_limit_bytes()
    if limit is None or limit < 4_000_000_000:
        size = _url_content_length(url, auth)
        size_note = f" ({size / 1e6:.0f}MB)" if size else ""
        limit_note = f"memory limit {limit / 1e9:.1f}GB" if limit else "limited memory"
        raise VariableCalculationError(
            f"This release's dataset{size_note} is too large to compute in the "
            f"hosted environment ({limit_note}; a full microsimulation needs "
            "over 3GB). Run the variable lookup locally, or point the endpoint "
            "at a higher-memory backend."
        )

    # Drop other releases held in RAM (image + any cached simulation) so only
    # one dataset is resident at a time.
    for other in [k for k in _CORE_IMAGES if k != sentinel]:
        _CORE_IMAGES.pop(other, None)
        try:
            os.unlink(other)
        except OSError:
            pass
    for key in [k for k in _SIM_CACHE if k[1] != revision]:
        _SIM_CACHE.pop(key, None)

    # Remove any partial hf_hub_download left by the ENOSPC attempt.
    cache_root = os.environ.get("HF_HUB_CACHE", "/tmp/huggingface/hub")
    shutil.rmtree(
        os.path.join(cache_root, f"datasets--{repo.replace('/', '--')}"),
        ignore_errors=True,
    )

    request = Request(url)
    for key, value in auth.items():
        request.add_header(key, value)
    with urlopen(request, timeout=600) as response:
        image = response.read()  # single bytes object; no bytearray double-copy

    _install_core_hdfstore_patch()
    _CORE_IMAGES[sentinel] = image
    with open(sentinel, "wb"):  # 0-byte marker so Path.exists() checks pass
        pass
    return sentinel


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
