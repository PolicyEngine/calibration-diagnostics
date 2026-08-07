"""Build the exact old-congressional-district lookup for a Microcosm HDF5."""

from __future__ import annotations

import argparse
import json
from pathlib import Path

import pandas as pd

from evaluation_harness.populace_old_cd import build_old_cd_assignment_artifact


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--populace-dataset", required=True, type=Path)
    parser.add_argument("--output", required=True, type=Path)
    arguments = parser.parse_args()

    households = pd.read_hdf(
        arguments.populace_dataset, "household", columns=["block_geoid"]
    )
    manifest = build_old_cd_assignment_artifact(
        households["block_geoid"].astype(str).unique(), arguments.output
    )
    print(json.dumps(manifest, indent=2, sort_keys=True))


if __name__ == "__main__":
    main()
