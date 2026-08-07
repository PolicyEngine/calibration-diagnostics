"""Build checksum-pinned, single-age aggregates from raw 2024 ACS PUMS."""

from __future__ import annotations

import argparse
import json
from pathlib import Path

from evaluation_harness.adapters.acs_pums import build_person_age_aggregates


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--us-person-zip", required=True, type=Path)
    parser.add_argument("--puerto-rico-person-zip", required=True, type=Path)
    parser.add_argument("--output", required=True, type=Path)
    arguments = parser.parse_args()
    manifest = build_person_age_aggregates(
        arguments.us_person_zip,
        arguments.puerto_rico_person_zip,
        arguments.output,
    )
    print(json.dumps(manifest, indent=2, sort_keys=True))


if __name__ == "__main__":
    main()
