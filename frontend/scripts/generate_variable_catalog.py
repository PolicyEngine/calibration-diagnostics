"""Generate a static catalog of PolicyEngine-US variables for the lookup page.

Writes frontend/public/variable-catalog.json: the model and data identity it was
built from, plus {name, label, entity, unit} for every variable in the model, so
the variable lookup page can offer search/select without a per-keystroke API
round-trip.

The catalog is built from a simulation over the reviewed hosted dataset under the
pinned .py, never from the country package's default dataset. Run it from the
repository root in the hosted runtime environment:
    python frontend/scripts/generate_variable_catalog.py [--dataset-file H5]
Without --dataset-file, the reviewed manifests and H5 are downloaded at the
pinned revision. Either way, the H5 bytes must match the reviewed SHA-256.
Regenerate it whenever .py is upgraded.
"""

import argparse
import json
import sys
from pathlib import Path
from typing import Any

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from scripts.hosted_release import (
    download_certification,
    reviewed_release,
    validate_runtime,
    verify_h5,
)
from scripts.microcosm_variable_core import single_year_simulation_dataset

FRONTEND = Path(__file__).resolve().parents[1]
DEFAULT_OUTPUT = FRONTEND / "public" / "variable-catalog.json"


def reviewed_dataset_path(config: dict[str, Any], dataset_file: Path | None) -> str:
    """Return a local copy of the reviewed H5, downloading it only when needed."""
    if dataset_file is not None:
        return str(dataset_file)
    from huggingface_hub import hf_hub_download

    download_certification(config, hf_hub_download)
    return hf_hub_download(
        repo_id=config["repo"],
        filename=config["filename"],
        revision=config["hf_revision"],
        repo_type="dataset",
    )


def build_catalog(config: dict[str, Any], dataset_path: str) -> dict[str, Any]:
    """Describe every variable of a simulation over the verified reviewed H5."""
    verify_h5(dataset_path, config)
    from policyengine_us import Microsimulation

    simulation = Microsimulation(dataset=single_year_simulation_dataset(dataset_path))
    variables = simulation.tax_benefit_system.variables
    catalog = [
        {
            "name": name,
            "label": getattr(variable, "label", None) or None,
            "entity": getattr(getattr(variable, "entity", None), "key", None),
            "unit": getattr(variable, "unit", None),
        }
        for name, variable in sorted(variables.items())
    ]
    return {
        "count": len(catalog),
        "release_id": config["release_id"],
        "packages": config["packages"],
        "variables": catalog,
    }


def main(arguments: list[str] | None = None) -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--dataset-file", type=Path)
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT)
    options = parser.parse_args(arguments)
    config = reviewed_release()
    validate_runtime(config)
    dataset_path = reviewed_dataset_path(config, options.dataset_file)
    catalog = build_catalog(config, dataset_path)
    options.output.parent.mkdir(parents=True, exist_ok=True)
    options.output.write_text(json.dumps(catalog, separators=(",", ":")))
    print(f"Wrote {catalog['count']} variables to {options.output}")


if __name__ == "__main__":
    main()
