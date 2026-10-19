"""Check the hosted dependency assembly and imported APIs without a population.

The Modal image runs this while it is built. Run it from the repository root
with the hosted requirements installed separately from the root evaluation
environment:
    uv run --no-sync python frontend/scripts/verify_hosted_runtime.py
"""

import argparse
import inspect
import json
import math
import os
import sys
from importlib import metadata
from pathlib import Path
from typing import Any

from packaging.requirements import Requirement

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from scripts.hosted_release import (
    load_verified_native_input,
    recorded_household_count,
    reviewed_release,
    validate_manifests,
    validate_runtime,
)
from scripts.runtime_identity import runtime_identity

# spm-calculator installs these on the country system; the deployment checks
# calculate the first one.
SPM_MEASUREMENT_VARIABLES = (
    "spm_unit_spm_threshold",
    "spm_unit_reference_spm_threshold",
    "spm_unit_geographic_adjustment",
)


def verify_source_apis(data_year: int) -> dict[str, Any]:
    """Bind the country, data and SPM APIs the hosted code uses; load no population."""
    from huggingface_hub import hf_hub_download
    from policyengine_us import Microsimulation
    from policyengine_us.data import USMultiYearDataset, USSingleYearDataset
    from policyengine_us.spm import DATASET_SOURCE_INPUTS, create_spm_provider
    from policyengine_us.system import system

    # Bind supported signatures, without invoking a simulation or a download.
    inspect.signature(Microsimulation).bind(dataset="not-loaded.h5")
    inspect.signature(USSingleYearDataset).bind(file_path="not-loaded.h5")
    inspect.signature(USMultiYearDataset).bind(datasets=[])
    inspect.signature(hf_hub_download).bind(
        repo_id="policyengine/populace-us",
        filename="populace_us_2024.h5",
        revision="not-downloaded",
        repo_type="dataset",
    )
    for variable_name in (*SPM_MEASUREMENT_VARIABLES, *sorted(DATASET_SOURCE_INPUTS)):
        if system.get_variable(variable_name) is None:
            raise RuntimeError(f"The country system does not define {variable_name}")
    # Both the default county provider and an explicit national provider read
    # spm-calculator's bundled, hash-verified forecast; neither downloads data.
    create_spm_provider()
    national_provider = create_spm_provider({"geography_kind": "national"})
    reference_unit = national_provider.calculate_unit(
        year=data_year, adults=2, children=2, tenure="renter"
    )
    reference_threshold = reference_unit["reference_threshold"]
    if not isinstance(reference_threshold, float) or not math.isfinite(
        reference_threshold
    ):
        raise RuntimeError("The SPM forecast returned no reference threshold")
    if reference_threshold <= 0:
        raise RuntimeError("The SPM forecast returned a non-positive threshold")
    return {
        "data_year": data_year,
        "forecast_id": reference_unit["forecast_id"],
        "forecast_sha256": national_provider.forecast.content_sha256,
        "national_reference_threshold": reference_threshold,
        "reference_unit": "two adults, two children, renter",
        "dataset_source_inputs": sorted(DATASET_SOURCE_INPUTS),
    }


def verify_stored_input_renames() -> dict[str, Any]:
    """Bind .py's stored-input rename step that every hosted simulation applies.

    Reports the registered renames the pinned country model needs mapped, as
    .py computes them; it loads no population.
    """
    from policyengine.tax_benefit_models.us.legacy_inputs import (
        apply_legacy_input_renames_to_microsimulation,
        pending_legacy_input_renames,
    )
    from policyengine_us.system import system

    inspect.signature(apply_legacy_input_renames_to_microsimulation).bind(
        "not-a-simulation"
    )
    return {
        "source": (
            f"{apply_legacy_input_renames_to_microsimulation.__module__}."
            f"{apply_legacy_input_renames_to_microsimulation.__name__}"
        ),
        "pending_for_pinned_model": pending_legacy_input_renames(system.variables),
    }


def main() -> None:
    """Check installed requirements and the APIs the hosted code uses."""
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--dataset-file", type=Path)
    parser.add_argument("--release-manifest", type=Path)
    parser.add_argument("--build-manifest", type=Path)
    parser.add_argument("--receipt", type=Path)
    args = parser.parse_args()
    input_paths = (args.dataset_file, args.release_manifest, args.build_manifest)
    if any(input_paths) and not all(input_paths):
        parser.error("Native input verification requires the H5 and both manifests")
    config = reviewed_release()
    validate_runtime(config)
    requirements = Path(
        os.environ.get(
            "CALIBRATION_REQUIREMENTS",
            Path(__file__).resolve().parents[2] / "backend/requirements.txt",
        )
    )
    for line in requirements.read_text().splitlines():
        line = line.split("#", 1)[0].strip()
        if not line:
            continue
        requirement = Requirement(line)
        installed = metadata.version(requirement.name)
        if installed not in requirement.specifier:
            raise RuntimeError(f"{requirement} is required; found {installed}")

    spm_measurement = verify_source_apis(int(config["data_year"]))
    receipt = {
        "runtime": runtime_identity(),
        "source_api_imports": "passed",
        "spm_measurement": spm_measurement,
        "legacy_input_renames": verify_stored_input_renames(),
    }
    if args.dataset_file:
        release = json.loads(args.release_manifest.read_text())
        build = json.loads(args.build_manifest.read_text())
        validate_manifests(config, release, build)
        dataset = load_verified_native_input(args.dataset_file, config)
        arrays = dataset.load()
        household_rows = len(dataset.household)
        # validate_manifests has already required the pinned .py's certification;
        # only a .py-certified build may omit its exported household count.
        expected_households = recorded_household_count(build)
        if expected_households is not None and household_rows != expected_households:
            raise RuntimeError("Native input row count differs from the reviewed build")
        if (
            not dataset.person["person_household_id"]
            .isin(dataset.household["household_id"])
            .all()
        ):
            raise RuntimeError("Native input person/household links are incomplete")
        receipt["data_identity"] = {**config, "verified": True}
        receipt["native_input"] = {
            "class": f"{type(dataset).__module__}.{type(dataset).__name__}",
            "time_period": dataset.time_period,
            "data_format": dataset.data_format,
            "table_rows": dict(zip(dataset.table_names, map(len, dataset.tables))),
            "input_variable_count": len(arrays),
            "household_count_check": (
                "build manifest"
                if expected_households is not None
                else "not recorded by the .py-certified build manifest"
            ),
            "person_household_links": "passed",
            "microsimulation_constructed": False,
            "policy_variables_calculated": False,
        }
    output = json.dumps(receipt, indent=2) + "\n"
    if args.receipt:
        args.receipt.write_text(output)
    print(output, end="")


if __name__ == "__main__":
    main()
