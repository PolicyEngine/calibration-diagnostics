#!/usr/bin/env python3
"""Calculate a weighted PolicyEngine variable aggregate for a Populace release."""

from __future__ import annotations

import argparse
import json
import math
import sys
import time
from typing import Any

import numpy as np


def finite_float(value: Any) -> float | None:
    try:
        number = float(value)
    except (TypeError, ValueError):
        return None
    return number if math.isfinite(number) else None


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--variable", action="append", required=True)
    parser.add_argument("--period", default="2024")
    parser.add_argument("--repo", default="policyengine/populace-us")
    parser.add_argument("--revision", required=True)
    parser.add_argument("--filename", default="populace_us_2024.h5")
    args = parser.parse_args()

    started = time.time()
    try:
        from policyengine_us import Microsimulation
        from huggingface_hub import hf_hub_download
    except Exception as exc:  # pragma: no cover - depends on host Python env.
        print(
            json.dumps(
                {
                    "detail": (
                        "Python package policyengine_us or huggingface_hub is not installed in the "
                        f"server environment: {exc}"
                    )
                }
            ),
            file=sys.stderr,
        )
        return 2

    variables = list(dict.fromkeys(v.strip() for v in args.variable if v.strip()))
    dataset = f"hf://{args.repo}/{args.filename}@{args.revision}"

    try:
        dataset_path = hf_hub_download(
            repo_id=args.repo,
            filename=args.filename,
            revision=args.revision,
            repo_type="dataset",
        )
        sim = Microsimulation(dataset=dataset_path)
        results = []
        for variable_name in variables:
            variable_started = time.time()
            variable = sim.tax_benefit_system.get_variable(variable_name)
            values = sim.calculate(variable_name, args.period)
            raw_values = np.asarray(
                sim.calculate(variable_name, args.period, use_weights=False)
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
                    "period": args.period,
                    "release_id": args.revision,
                    "dataset": dataset,
                    "dataset_path": dataset_path,
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
        result = {
            "period": args.period,
            "release_id": args.revision,
            "dataset": dataset,
            "dataset_path": dataset_path,
            "variables": results,
            "elapsed_seconds": finite_float(time.time() - started),
        }
        if len(results) == 1:
            result.update(results[0])
        print(json.dumps(result, allow_nan=False))
        return 0
    except Exception as exc:
        print(json.dumps({"detail": str(exc)}), file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
