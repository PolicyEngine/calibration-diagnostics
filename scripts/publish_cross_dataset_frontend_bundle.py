"""Build immutable frontend/API partitions from a completed evaluation run."""

from __future__ import annotations

import argparse
import json
from pathlib import Path

from evaluation_harness.frontend_bundle import publish_frontend_bundle


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--snapshot", required=True, type=Path)
    parser.add_argument("--run", required=True, type=Path)
    parser.add_argument("--output", required=True, type=Path)
    parser.add_argument("--page-size", type=int, default=100)
    arguments = parser.parse_args()
    manifest = publish_frontend_bundle(
        arguments.snapshot,
        arguments.run,
        arguments.output,
        page_size=arguments.page_size,
    )
    print(json.dumps(manifest, indent=2, sort_keys=True))


if __name__ == "__main__":
    main()
