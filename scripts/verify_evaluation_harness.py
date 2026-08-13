"""Run the Chronicle evaluation harness checks as an explicit maintenance task."""

from __future__ import annotations

import argparse
import shutil
import subprocess
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]


def build_commands(
    *,
    microcosm_dataset: Path | None = None,
    acs_pums_aggregates: Path | None = None,
) -> list[tuple[str, list[str]]]:
    sync = ["uv", "sync", "--frozen", "--extra", "taxcalc-cps"]
    if microcosm_dataset is not None:
        sync.extend(["--extra", "microcosm"])

    commands: list[tuple[str, list[str]]] = [
        ("Install locked harness dependencies", sync),
        ("Run the Python harness suite", ["uv", "run", "pytest"]),
        (
            "Run the Public CPS + Tax-Calculator numerical gate",
            [
                "uv",
                "run",
                "--extra",
                "taxcalc-cps",
                "python",
                "scripts/verify_taxcalc_cps_adapter.py",
            ],
        ),
    ]
    if microcosm_dataset is not None:
        commands.append(
            (
                "Run the Microcosm + PolicyEngine-US numerical gate",
                [
                    "uv",
                    "run",
                    "--extra",
                    "microcosm",
                    "python",
                    "scripts/verify_microcosm_adapter.py",
                    str(microcosm_dataset),
                ],
            )
        )
    if acs_pums_aggregates is not None:
        commands.append(
            (
                "Run the Raw ACS PUMS numerical gate",
                [
                    "uv",
                    "run",
                    "python",
                    "scripts/verify_acs_pums_adapter.py",
                    "--aggregates",
                    str(acs_pums_aggregates),
                ],
            )
        )
    return commands


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description=(
            "Run the locked Chronicle evaluation harness suite and its public "
            "numerical adapter gate. Local model/data gates are optional."
        )
    )
    parser.add_argument(
        "--microcosm-dataset",
        type=Path,
        help="Pinned Microcosm H5 used for the optional ten-fact numerical gate.",
    )
    parser.add_argument(
        "--acs-pums-aggregates",
        type=Path,
        help="Pinned ACS aggregate parquet used for the optional ten-fact numerical gate.",
    )
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    if shutil.which("uv") is None:
        raise SystemExit("uv is required: https://docs.astral.sh/uv/")

    for label, command in build_commands(
        microcosm_dataset=args.microcosm_dataset,
        acs_pums_aggregates=args.acs_pums_aggregates,
    ):
        print(f"\n==> {label}", flush=True)
        subprocess.run(command, cwd=ROOT, check=True)

    print("\nChronicle evaluation harness verification passed.")


if __name__ == "__main__":
    main()
