"""Score external tax microdata against PolicyEngine's national calibration targets.

The Cross-dataset comparison scores every dataset (populace + external tax
microdata) against the SAME surface: the model's own *national calibration
targets* (official IRS/SOI/etc. actuals the US microdata is built to match). The
benchmark set is therefore not hand-picked — it is exactly what the calibration
optimizes toward. populace covers ~all targets; a federal tax-unit engine
(Tax-Calculator public CPS, PSL TMD) covers the IRS-SOI tax concepts it can
express, and that coverage gap is part of the comparison.

Pipeline:
  1. `--build-spec` fetches the release's national targets (target-diagnostics,
     level=national) and writes a target-spec JSON: one row per target cell with
     its parsed AGI income-band edges, EITC qualifying-children group, filing
     status, official value and populace estimate.
  2. `--score` runs Tax-Calculator (CPS and/or TMD) once, reproduces each cell's
     breakdown (AGI band + EITC children + subpopulation filter), and emits a
     committed JSON keyed by target `name` -> value. The frontend joins those to
     the live target surface.

Run (a venv with taxcalc installed):
    python frontend/scripts/score_external_dataset.py --build-spec --spec /tmp/target_spec.json
    python frontend/scripts/score_external_dataset.py --score --spec /tmp/target_spec.json \
        --dataset cps --dataset tmd --tmd-dir /path/to/tmd/storage/output

Concept mapping (PolicyEngine variable -> taxcalc variable), verified against each
concept's grand total vs BOTH the official IRS value and populace; a concept whose
grand total lands >40% off both is dropped for that dataset rather than guessed.
Subpopulation filters mirror populace: SOI table 2.1 -> itemizers (c04470>0);
table 2.5 AGI -> EITC returns (c59660!=0). EITC children via taxcalc EIC
(EIC==n for 0/1/2, EIC>=3 for "3 or more").
"""

from __future__ import annotations

import argparse
import json
import math
import re
import urllib.request
from pathlib import Path

OUT_DIR = Path(__file__).resolve().parents[1] / "lib" / "populace" / "external-datasets"

# PolicyEngine variable name -> taxcalc variable (weighted sum for "total";
# weighted count of nonzero for "count"). Keyed by the target's `variable` label.
CONCEPT_TO_TAXCALC = {
    "adjusted gross income": lambda A: A("c00100"),
    "employment income": lambda A: A("e00200"),
    "business net profits": lambda A: A("e00900"),
    "taxable interest income": lambda A: A("e00300"),
    "tax exempt interest income": lambda A: A("e00400"),
    "ordinary dividend income": lambda A: A("e00600"),
    "qualified dividends": lambda A: A("e00650"),
    "ira distributions": lambda A: A("e01400"),
    "taxable pension income": lambda A: A("e01700"),
    "taxable social security": lambda A: A("c02500"),
    "unemployment compensation": lambda A: A("e02300"),
    "salt deduction": lambda A: A("c18300"),
    "real estate taxes": lambda A: A("e18500"),
    "interest deduction": lambda A: A("c19200"),
    "charitable deduction": lambda A: A("c19700"),
    "medical expense deduction": lambda A: A("c17000"),
    "qualified business income deduction": lambda A: A("qbided"),
    "taxable income": lambda A: A("c04800"),
    "income tax before credits": lambda A: A("c05800"),
    "income tax": lambda A: A("iitax"),
    "eitc": lambda A: A("c59660"),
    "refundable ctc": lambda A: A("c11070"),
    "ctc": lambda A: A("c07220") + A("c11070") + A("odc"),
    "capital gains gross": lambda A: A("c01000"),
    "itemized taxable income deductions": lambda A: A("c04470"),
    "partnership and s corp income": lambda A: A("e26270"),
}

# Concepts with no clean taxcalc equivalent, or whose grand total is verified
# >40% off both the official and populace value, are dropped (not guessed).
COMMON_DROP = {"rent and royalty net income", "assigned aca ptc", "count"}
# Public CPS structurally mis-represents these (capital gains / partnership are
# ~zero; several deductions are heavily over-imputed).
CPS_DROP = COMMON_DROP | {
    "capital gains gross", "partnership and s corp income", "real estate taxes", "ctc",
    "interest deduction", "ira distributions", "itemized taxable income deductions",
    "ordinary dividend income", "qualified business income deduction", "salt deduction",
    "tax exempt interest income",
}
TMD_DROP = COMMON_DROP | {"real estate taxes", "ctc"}


# --- 1. build the target spec from the national target surface ----------------
def _parse_band(label):
    """Parse an SOI income-band label ('10k to 11k', '1m plus', 'under 1') to
    [lo, hi] AGI dollar edges. 'All'/'Total' -> None (aggregate over bands)."""
    if label in ("All", "Total", None):
        return None
    s = label.lower().strip()

    def num(tok):
        tok = tok.strip()
        m = re.match(r"([\d.]+)\s*([km]?)", tok)
        if not m:
            return None
        return float(m.group(1)) * {"k": 1e3, "m": 1e6, "": 1}[m.group(2)]

    if s == "under 1":
        return [None, 1.0]
    if s.endswith("plus"):
        return [num(s.replace("plus", "")), None]
    if " to " in s:
        a, b = s.split(" to ")
        return [num(a), num(b)]
    raise ValueError(f"unparsed income band: {label!r}")


_CHILD = {
    "no qualifying children": 0, "one qualifying child": 1, "two qualifying children": 2,
    "three or more qualifying children": 3, "all qualifying children": "all", "All": "all",
}


def build_spec(base_url: str, spec_path: Path) -> None:
    url = f"{base_url}/api/populace/target-diagnostics?level=national&limit=500"
    data = json.load(urllib.request.urlopen(url))
    rows = []
    for t in data["targets"]:
        dims = {d["key"]: d for d in (t.get("target_dimensions") or [])}
        rows.append({
            "name": t["name"], "source": t["source"], "base_name": t.get("base_name"),
            "variable": t["variable"], "measure": t["measure"],
            "band": _parse_band(dims.get("bd_income_band", {}).get("value")),
            "children": _CHILD.get(dims.get("bd_qualifying_children", {}).get("value"),
                                   dims.get("bd_qualifying_children", {}).get("value")),
            "target": t.get("target"), "populace": t.get("final_estimate"),
            "expressible_source": t["source"] == "irs_soi",
        })
    spec_path.write_text(json.dumps(rows, indent=1))
    print(f"wrote {len(rows)} target specs -> {spec_path}")


# --- 2. score a dataset against the spec --------------------------------------
def _subpop_mask(x, calc):
    """Mirror the subpopulation populace filters on (base_name)."""
    bn = x["base_name"] or ""
    if "table_2_1" in bn:  # itemized_all_returns -> itemizers
        return calc.array("c04470") > 0
    if "table_2_5" in bn and x["variable"] == "adjusted gross income":  # AGI of EITC returns
        return calc.array("c59660") != 0
    return None


def _cell(x, arr, calc, s, agi, eic):
    import numpy as np

    m = np.ones(len(s), bool)
    band = x["band"]
    if band is not None:
        lo = -math.inf if band[0] is None else band[0]
        hi = math.inf if band[1] is None else band[1]
        m &= (agi >= lo) & (agi < hi)
    ch = x["children"]
    if isinstance(ch, int):
        m &= (eic >= 3) if ch >= 3 else (eic == ch)
    sp = _subpop_mask(x, calc)
    if sp is not None:
        m &= sp
    if x["measure"] == "total":
        return float((s[m] * arr[m]).sum())
    return float(s[m & (arr != 0)].sum())


def _build_calc(kind: str, tmd_dir: str | None):
    import taxcalc as tc

    if kind == "cps":
        rec, pol = tc.Records.cps_constructor(), tc.Policy()
    else:
        b = Path(tmd_dir)
        rec = tc.Records.tmd_constructor(
            data_path=b / "tmd.csv.gz", weights_path=b / "tmd_weights.csv.gz",
            growfactors=b / "tmd_growfactors.csv", exact_calculations=True,
        )
        pol = tc.Policy()
        pol.implement_reform({"soi_iitax": {2013: True}})  # PSL's SOI-replication policy
    calc = tc.Calculator(policy=pol, records=rec)
    calc.advance_to_year(2024)
    calc.calc_all()
    return calc


def score(kind: str, spec, tmd_dir=None):
    calc = _build_calc(kind, tmd_dir)
    A = calc.array
    concept_arr = {v: fn(A) for v, fn in CONCEPT_TO_TAXCALC.items()}
    s, agi, eic = A("s006"), A("c00100"), A("EIC")
    drop = CPS_DROP if kind == "cps" else TMD_DROP
    rows = {}
    for x in spec:
        v = x["variable"]
        if not x["expressible_source"] or v in drop or v not in concept_arr:
            continue
        rows[x["name"]] = _cell(x, concept_arr[v], calc, s, agi, eic)
    return rows


METADATA = {
    "cps": {
        "file": "taxcalc-cps-national-2024.json", "dataset": "taxcalc_cps_national",
        "label": "Tax-Calculator public CPS", "engine": "taxcalc 6.7.1", "year": 2024,
        "source": "Tax-Calculator public CPS (Census CPS-derived)",
        "source_url": "https://github.com/PSLmodels/Tax-Calculator",
        "notes": (
            "Public CPS reliably covers wages, AGI, taxable income, income tax "
            "(before/after credits), EITC, refundable CTC, pensions, taxable Social "
            "Security, unemployment, qualified dividends, charitable and medical "
            "deductions, and taxable interest. Dropped concepts: capital gains and "
            "partnership/S-corp income (structurally absent from the public CPS, i.e. "
            "zero); SALT, interest, tax-exempt-interest, ordinary-dividend, "
            "IRA-distribution, QBI and total-itemized deductions and combined CTC "
            "(grand total >40% off BOTH the official IRS value and populace); real "
            "estate taxes (taxcalc e18500 is an all-filer input while SOI counts only "
            "itemizers' Schedule A). Itemizer subpopulation (SOI table 2.1) reproduced "
            "via c04470>0; EITC-return AGI via c59660!=0."
        ),
    },
    "tmd": {
        "file": "tmd-national-2024.json", "dataset": "tmd_national",
        "label": "PSL TMD", "engine": "taxcalc 6.7.1", "year": 2024,
        "source": "PSL tax-microdata-benchmarking TMD (PUF+CPS, 2022 base extrapolated to 2024)",
        "source_url": "https://github.com/PSLmodels/tax-microdata-benchmarking",
        "notes": (
            "TMD (PUF-derived) covers nearly all IRS SOI concepts including capital "
            "gains, partnership/S-corp income, QBI deduction and itemized deductions, "
            "all within ~30% of official grand totals. Dropped: combined CTC "
            "(c07220+c11070+odc overshoots SOI ~59%) and real estate taxes (taxcalc "
            "e18500 all-filer input vs SOI itemizer-only Schedule A). Built via "
            "tmd_constructor with the soi_iitax reform, advanced to 2024. Itemizer "
            "subpopulation (table 2.1) via c04470>0; EITC-return AGI via c59660!=0."
        ),
    },
}


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--build-spec", action="store_true")
    ap.add_argument("--score", action="store_true")
    ap.add_argument("--spec", type=Path, required=True)
    ap.add_argument("--base-url", default="http://localhost:3000")
    ap.add_argument("--dataset", action="append", choices=["cps", "tmd"], default=[])
    ap.add_argument("--tmd-dir", default=None)
    args = ap.parse_args()

    if args.build_spec:
        build_spec(args.base_url, args.spec)
    if args.score:
        spec = json.loads(args.spec.read_text())
        for kind in args.dataset:
            meta = METADATA[kind]
            rows = score(kind, spec, args.tmd_dir)
            keys = ("dataset", "label", "engine", "year", "source", "source_url", "notes")
            out = {k: meta[k] for k in keys}
            out["rows"] = rows
            (OUT_DIR / meta["file"]).write_text(json.dumps(out, indent=2))
            print(f"{kind}: wrote {len(rows)} rows -> {meta['file']}")


if __name__ == "__main__":
    main()
