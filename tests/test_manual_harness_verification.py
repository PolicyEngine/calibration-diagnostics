from pathlib import Path

from scripts.verify_evaluation_harness import build_commands


def test_default_manual_verification_matches_the_public_harness_checks() -> None:
    commands = build_commands()

    assert [label for label, _ in commands] == [
        "Install locked harness dependencies",
        "Run the Python harness suite",
        "Run the Public CPS + Tax-Calculator numerical gate",
    ]
    assert commands[0][1] == [
        "uv",
        "sync",
        "--frozen",
        "--extra",
        "taxcalc-cps",
    ]
    assert commands[-1][1][-1] == "scripts/verify_taxcalc_cps_adapter.py"


def test_local_inputs_enable_the_microcosm_and_acs_numerical_gates() -> None:
    commands = build_commands(
        microcosm_dataset=Path("/data/microcosm.h5"),
        acs_pums_aggregates=Path("/data/acs.parquet"),
    )

    assert commands[0][1][-2:] == ["--extra", "microcosm"]
    assert commands[-2][1][-2:] == [
        "scripts/verify_microcosm_adapter.py",
        "/data/microcosm.h5",
    ]
    assert commands[-1][1][-2:] == ["--aggregates", "/data/acs.parquet"]
