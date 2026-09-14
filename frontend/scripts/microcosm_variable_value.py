#!/usr/bin/env python3
"""Calculate a weighted PolicyEngine variable aggregate for a Microcosm release."""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from scripts.microcosm_variable_core import (
    DEFAULT_FILENAME,
    DEFAULT_PERIOD,
    DEFAULT_RELEASE,
    DEFAULT_REPO,
    DEFAULT_REVISION,
    VariableCalculationError,
    calculate_variables,
)


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--variable", action="append", required=True)
    parser.add_argument("--period", default=DEFAULT_PERIOD)
    parser.add_argument("--repo", default=DEFAULT_REPO)
    parser.add_argument("--revision", default=DEFAULT_RELEASE)
    parser.add_argument("--hf-revision", default=DEFAULT_REVISION)
    parser.add_argument("--filename", default=DEFAULT_FILENAME)
    args = parser.parse_args()

    try:
        result = calculate_variables(
            variables=args.variable,
            period=args.period,
            repo=args.repo,
            revision=args.revision,
            hf_revision=args.hf_revision,
            filename=args.filename,
        )
        print(json.dumps(result, allow_nan=False))
        return 0
    except VariableCalculationError as exc:
        print(
            json.dumps({"detail": str(exc), "status_code": exc.status_code}),
            file=sys.stderr,
        )
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
