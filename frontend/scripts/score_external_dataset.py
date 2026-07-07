"""Score an external microdata file against the dashboard's benchmark surface.

Currently supports the Tax-Calculator public CPS file (ships in `pip install
taxcalc`). Emits a committed JSON keyed by the same benchmark ids the
reform-validation suites use, so the Cross-dataset comparison view can join it
to official actuals with no server-side work.

Run (any venv with taxcalc installed):
    python frontend/scripts/score_external_dataset.py --dataset taxcalc-cps --year 2024

Concept mappings (taxcalc -> benchmark id), with the deliberate deltas:
- soi_income_tax_net  <- iitax - setax. taxcalc's iitax includes othertaxes
  (SE tax, NIIT, penalty taxes) net of refundable credits; SOI's "total income
  tax minus refundable credits" includes NIIT but books SE tax outside income
  tax, so SE tax is subtracted. Penalty taxes (~0.3%) remain inside, same
  small scope wedge the populace row documents.
- soi_ctc_nonrefundable <- c07220 + odc (SOI line is CTC+ODC combined).
- soi_ctc_refundable    <- c11070 (refundable CTC/ACTC).
- soi_cdcc <- c07180, soi_education_credits <- c07230, soi_savers_credit <- c07240,
  soi_amt <- c09600, soi_niit <- niit, soi_se_tax <- setax.
- fed_eitc_{state} <- eitc summed over records with the state's FIPS code.
  CPS state samples are small and taxcalc does not calibrate geography; the
  comparison view exists to make exactly that visible.

Not mappable from taxcalc (no state tax model, no benefit programs): all
State-program rows, state reform rows, OBBBA rows (engine-reform phase 2).
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path

FIPS_TO_STATE = {
    36: "NY", 34: "NJ", 17: "IL", 26: "MI", 8: "CO", 9: "CT", 35: "NM",
    20: "KS", 22: "LA", 19: "IA", 50: "VT", 40: "OK", 31: "NE", 44: "RI",
    30: "MT", 18: "IN", 15: "HI", 23: "ME",
}

OUT_DIR = Path(__file__).resolve().parents[1] / "lib" / "populace" / "external-datasets"


def score_taxcalc_cps(year: int) -> dict:
    import numpy as np
    import taxcalc as tc

    rec = tc.Records.cps_constructor()
    calc = tc.Calculator(policy=tc.Policy(), records=rec)
    calc.advance_to_year(year)
    calc.calc_all()

    def total(expr):
        return float((expr * calc.array("s006")).sum())

    v = calc.array  # noqa: E731 shorthand

    rows: dict[str, float] = {
        "soi_income_tax_net": total(v("iitax") - v("setax")),
        "soi_amt": total(v("c09600")),
        "soi_cdcc": total(v("c07180")),
        "soi_education_credits": total(v("c07230")),
        "soi_savers_credit": total(v("c07240")),
        "soi_ctc_nonrefundable": total(v("c07220") + v("odc")),
        "soi_ctc_refundable": total(v("c11070")),
        "soi_niit": total(v("niit")),
        "soi_se_tax": total(v("setax")),
    }
    fips = v("fips")
    eitc = v("eitc")
    s006 = v("s006")
    for code, state in FIPS_TO_STATE.items():
        mask = fips == code
        rows[f"fed_eitc_{state.lower()}"] = float((eitc[mask] * s006[mask]).sum())

    return {
        "dataset": "taxcalc-cps",
        "label": "Tax-Calculator public CPS",
        "engine": f"taxcalc {tc.__version__}",
        "source": "cps.csv.gz shipped in the taxcalc package (2014-base CPS, weights extrapolated)",
        "source_url": "https://github.com/PSLmodels/Tax-Calculator",
        "year": year,
        "notes": (
            "Public, fully reproducible, zero-license comparison dataset. taxcalc's own "
            "documentation notes the CPS file's data accuracy is not unit-tested (PUF/TMD "
            "are more accurate). iitax includes SE tax, subtracted for the SOI net "
            "income-tax concept; penalty taxes remain inside (small scope wedge). Zero "
            "rows (education credits, saver's credit) reflect input bases absent from "
            "the CPS file itself — the same absent-base failure mode populace#340 "
            "documents for the sparse release."
        ),
        "rows": rows,
    }


def score_tmd(year: int, tmd_dir: Path) -> dict:
    """Score a locally built PSL TMD file (PUF-derived — aggregates only leave
    this machine; the microdata itself must never be committed or uploaded)."""
    import taxcalc as tc

    rec = tc.Records.tmd_constructor(
        data_path=tmd_dir / "tmd.csv.gz",
        weights_path=tmd_dir / "tmd_weights.csv.gz",
        growfactors=tmd_dir / "tmd_growfactors.csv",
    )
    calc = tc.Calculator(policy=tc.Policy(), records=rec)
    calc.advance_to_year(year)
    calc.calc_all()

    def total(expr):
        return float((expr * calc.array("s006")).sum())

    v = calc.array

    rows: dict[str, float] = {
        "soi_income_tax_net": total(v("iitax") - v("setax")),
        "soi_amt": total(v("c09600")),
        "soi_cdcc": total(v("c07180")),
        "soi_education_credits": total(v("c07230")),
        "soi_savers_credit": total(v("c07240")),
        "soi_ctc_nonrefundable": total(v("c07220") + v("odc")),
        "soi_ctc_refundable": total(v("c11070")),
        "soi_niit": total(v("niit")),
        "soi_se_tax": total(v("setax")),
    }
    # TMD carries national weights only — no geographic identifiers — so the
    # federal-EITC-by-state rows are out of coverage by construction (the
    # project publishes separate per-area weight files for sub-national work).

    return {
        "dataset": "tmd",
        "label": "PSL TMD",
        "engine": f"taxcalc {tc.__version__}",
        "source": "TMD 2.1.3 built in-house from the licensed 2015 IRS PUF + 2022 CPS (make tmd_files)",
        "source_url": "https://github.com/PSLmodels/tax-microdata-benchmarking",
        "year": year,
        "notes": (
            "PUF-derived: only these aggregate totals leave the build machine; the "
            "microdata is never committed or uploaded. Weights are national-only, so "
            "state EITC rows are out of coverage. taxcalc 6.7.1 models EITC/ACTC "
            "claiming probabilities in current law, so its credit totals embed a "
            "take-up model (populace pays all eligibles - see populace#341). Local "
            "build skipped the tips/overtime/auto-loan imputation stage (raw SIPP/CEX "
            "downloads not present) - irrelevant to these rows."
        ),
        "rows": rows,
    }


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--dataset", required=True, choices=["taxcalc-cps", "tmd"])
    parser.add_argument("--year", type=int, default=2024)
    parser.add_argument("--tmd-dir", type=Path, help="dir with tmd.csv.gz/weights/growfactors")
    args = parser.parse_args()

    if args.dataset == "tmd":
        if not args.tmd_dir:
            parser.error("--tmd-dir is required for --dataset tmd")
        payload = score_tmd(args.year, args.tmd_dir)
    else:
        payload = score_taxcalc_cps(args.year)
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    out = OUT_DIR / f"{args.dataset}-{args.year}.json"
    out.write_text(json.dumps(payload, indent=1))
    print(f"wrote {out}")
    for k, val in payload["rows"].items():
        print(f"  {k:26s} {val / 1e6:12.1f}M")


if __name__ == "__main__":
    main()
