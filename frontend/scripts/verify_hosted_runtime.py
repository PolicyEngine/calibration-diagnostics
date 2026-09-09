"""Check the hosted dependency assembly and imported APIs without a population.

Run from the repository root with the hosted requirements installed separately
from the frozen scientific checkpoint:
    uv run --no-sync python frontend/scripts/verify_hosted_runtime.py
"""

import argparse
import inspect
import json
import sys
from importlib import import_module, metadata
from pathlib import Path

from packaging.requirements import Requirement

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from scripts.runtime_identity import runtime_identity
from scripts.hosted_release import (
    load_verified_native_input,
    reviewed_release,
    validate_manifests,
    validate_runtime,
)


def main() -> None:
    """Check installed requirements and the legacy APIs the hosted code uses."""
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
    requirements = Path(__file__).resolve().parents[1] / "requirements.txt"
    for line in requirements.read_text().splitlines():
        line = line.split("#", 1)[0].strip()
        if not line:
            continue
        requirement = Requirement(line)
        installed = metadata.version(requirement.name)
        if installed not in requirement.specifier:
            raise RuntimeError(f"{requirement} is required; found {installed}")

    from huggingface_hub import hf_hub_download
    from policyengine_us import Microsimulation
    from policyengine_us.data import USSingleYearDataset
    from spm_calculator.forecast import (
        HISTORICAL_THRESHOLDS,
        get_latest_published_year,
    )
    from spm_calculator.geoadj import get_cd_geoadj

    # Bind supported signatures, without invoking a simulation or a download.
    inspect.signature(Microsimulation).bind(dataset="not-loaded.h5")
    inspect.signature(USSingleYearDataset).bind(file_path="not-loaded.h5")
    inspect.signature(hf_hub_download).bind(
        repo_id="policyengine/populace-us",
        filename="populace_us_2024.h5",
        revision="not-downloaded",
        repo_type="dataset",
    )
    if get_latest_published_year() not in HISTORICAL_THRESHOLDS:
        raise RuntimeError("The installed legacy SPM threshold table is incomplete")
    inspect.signature(get_cd_geoadj).bind(6001, year=2023, tenure="renter")
    for module in (
        "spm_unit_reference_spm_threshold",
        "spm_unit_geographic_adjustment",
    ):
        import_module(f"policyengine_us.variables.household.income.spm_unit.{module}")
    receipt = {"runtime": runtime_identity(), "source_api_imports": "passed"}
    if args.dataset_file:
        release = json.loads(args.release_manifest.read_text())
        build = json.loads(args.build_manifest.read_text())
        validate_manifests(config, release, build)
        dataset = load_verified_native_input(args.dataset_file, config)
        arrays = dataset.load()
        household_rows = len(dataset.household)
        if household_rows != build["dataset"]["default"]["n_exported_households"]:
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
