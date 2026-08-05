"""Score the Yale Budget Lab reconstruction against PolicyEngine's national
calibration targets — the SAME surface and cell breakdown used for Tax-Calculator
CPS and PSL TMD in score_external_dataset.py.

Yale's federal tax model (Budget-Lab-Yale/Tax-Data + Tax-Simulator) is run,
unmodified, on the 2015 SOI PUF reweighted to 2017 SOI and projected to 2024. Its
Tax-Simulator writes per-record 2024 microdata (static/detail/2024.csv). This
script reproduces each national IRS-SOI target cell (AGI income band + EITC
qualifying-children group + subpopulation filter) from that detail and emits a
committed JSON keyed by target `name` -> value, exactly like the taxcalc/TMD
outputs the frontend already joins.

Fairness (no over/underfit): identical target spec, identical per-cell logic
(_cell/_subpop/_parse_band mirror score_external_dataset.py), identical raw units
(weighted dollars for totals, weighted return counts for counts). A concept is
dropped only when its grand total is verifiably far off BOTH the official IRS
value and populace (a mapping/coverage failure), documented below — never tuned
to lower Yale's loss.

Run:
    python frontend/scripts/score_yale_dataset.py \
        --spec /path/to/target_spec.json \
        --detail /path/to/Tax-Simulator/.../static/detail/2024.csv
"""

from __future__ import annotations

import argparse
import csv
import json
import math
import re
from pathlib import Path

OUT_DIR = Path(__file__).resolve().parents[1] / "lib" / "populace" / "external-datasets"

# PolicyEngine target `variable` label -> Yale detail column(s). A record's value
# for the concept is the (weighted) sum of these columns. Yale is PUF-derived, so
# it expresses nearly every IRS-SOI concept (like TMD).
CONCEPT_TO_YALE = {
    "adjusted gross income": ["agi"],
    "employment income": ["wages"],
    "business net profits": ["sole_prop"],
    "taxable interest income": ["txbl_int"],
    "tax exempt interest income": ["exempt_int"],
    "ordinary dividend income": ["div_ord"],
    "qualified dividends": ["div_pref"],
    "ira distributions": ["txbl_ira_dist"],
    "taxable pension income": ["txbl_pens_dist"],
    "taxable social security": ["txbl_ss"],
    "unemployment compensation": ["ui"],
    "salt deduction": ["salt_item_ded"],
    "interest deduction": ["int_item_ded"],
    "charitable deduction": ["char_item_ded"],
    "medical expense deduction": ["med_item_ded"],
    "qualified business income deduction": ["qbi_ded"],
    "itemized taxable income deductions": ["item_ded"],
    "taxable income": ["txbl_inc"],
    "income tax before credits": ["liab_bc"],
    "income tax": ["liab_iit"],
    "eitc": ["eitc"],
    "refundable ctc": ["ctc_ref"],
    "ctc": ["ctc_ref", "ctc_nonref"],
    "capital gains gross": ["txbl_kg"],
    "partnership and s corp income": ["part_scorp"],
    "rent and royalty net income": ["net_rent"],
    # "count" (number of returns) is handled specially via the `filer` flag.
}

# Dropped concepts. Kept IDENTICAL to PSL TMD's drop set so the two PUF-based
# datasets are scored on exactly the same concept surface (apples-to-apples).
# TMD_DROP = COMMON_DROP {rent, assigned aca ptc, count} | {real estate taxes, ctc}.
# This cuts both ways for Yale — it drops `ctc` (where Yale runs high) but also
# `rent` (where Yale is actually accurate) — so it is a consistency choice, not
# one tuned to lower Yale's loss. Rationale per concept:
#   - rent and royalty net income / assigned aca ptc / count: COMMON_DROP (TMD+CPS)
#   - real estate taxes: Yale reports only combined SALT (salt_item_ded), no
#     separate SOI Schedule A real-estate-tax split
#   - ctc: combined refundable+nonrefundable CTC overshoots the SOI line for both
#     TMD and Yale (definitional mismatch), so both drop it
# Per-concept detail for the dropped/kept concepts is still visible in the
# cross-dataset breakdown table, so nothing is hidden.
YALE_DROP = {
    "rent and royalty net income",
    "assigned aca ptc",
    "count",
    "real estate taxes",
    "ctc",
}


def _parse_band(label):
    if label in ("All", "Total", None):
        return None
    s = str(label).lower().strip()

    def num(tok):
        tok = tok.strip()
        m = re.match(r"([\d.]+)\s*([km]?)", tok)
        return None if not m else float(m.group(1)) * {"k": 1e3, "m": 1e6, "": 1}[m.group(2)]

    if s == "under 1":
        return [None, 1.0]
    if s.endswith("plus"):
        return [num(s.replace("plus", "")), None]
    if " to " in s:
        a, b = s.split(" to ")
        return [num(a), num(b)]
    raise ValueError(f"unparsed band: {label!r}")


def load_detail(path):
    """Load the Yale detail into column arrays (weight, agi, eitc-children, and
    every mapped concept)."""
    need = {"weight", "agi", "filer", "eitc", "itemizing", "n_dep_eitc"}
    for cols in CONCEPT_TO_YALE.values():
        need.update(cols)
    rows = {k: [] for k in need}
    with open(path) as f:
        r = csv.DictReader(f)
        missing = need - set(r.fieldnames)
        if missing:
            raise SystemExit(f"detail missing columns: {sorted(missing)}")
        for row in r:
            for k in need:
                v = row[k]
                if v in ("NA", "", "NaN"):
                    rows[k].append(math.nan)
                elif v in ("TRUE", "T", "True"):
                    rows[k].append(1.0)
                elif v in ("FALSE", "F", "False"):
                    rows[k].append(0.0)
                else:
                    rows[k].append(float(v))
    return {k: v for k, v in rows.items()}


def _mask(spec_row, cols):
    """Row-level mask reproducing the target cell: AGI band ∧ EITC children ∧
    subpopulation. Returns a python list of bools plus the concept array name."""
    n = len(cols["weight"])
    agi = cols["agi"]
    m = [True] * n

    band = spec_row["band"]
    if band is not None:
        lo = -math.inf if band[0] is None else band[0]
        hi = math.inf if band[1] is None else band[1]
        m = [mi and (lo <= a < hi) for mi, a in zip(m, agi)]

    ch = spec_row["children"]
    if isinstance(ch, int):
        nde = cols["n_dep_eitc"]
        if ch >= 3:
            m = [mi and (k >= 3) for mi, k in zip(m, nde)]
        else:
            m = [mi and (k == ch) for mi, k in zip(m, nde)]

    bn = spec_row["base_name"] or ""
    if "table_2_1" in bn:  # itemizers subpopulation
        it = cols["itemizing"]
        m = [mi and (v == 1) for mi, v in zip(m, it)]
    if "table_2_5" in bn and spec_row["variable"] == "adjusted gross income":
        e = cols["eitc"]
        m = [mi and (v != 0) for mi, v in zip(m, e)]
    return m


def score(spec, cols):
    w = cols["weight"]
    filer = cols["filer"]
    out = {}
    for x in spec:
        if not x.get("expressible_source"):
            continue
        v = x["variable"]
        if v in YALE_DROP:
            continue
        m = _mask(x, cols)
        if v == "count":
            # number of returns in the cell (weighted filers)
            out[x["name"]] = sum(wi for wi, mi, fl in zip(w, m, filer) if mi and fl != 0)
            continue
        if v not in CONCEPT_TO_YALE:
            continue
        srccols = CONCEPT_TO_YALE[v]
        arr = [sum(cols[c][i] for c in srccols) for i in range(len(w))]
        if x["measure"] == "total":
            out[x["name"]] = sum(
                wi * a for wi, a, mi in zip(w, arr, m) if mi and not math.isnan(a)
            )
        else:  # count of returns reporting a nonzero amount
            out[x["name"]] = sum(
                wi for wi, a, mi in zip(w, arr, m) if mi and not math.isnan(a) and a != 0
            )
    return out


def verify(spec, out):
    """Print each concept's grand total (summed over its 'All'-band cells, else
    all cells) vs official target and populace — the audit that catches mapping /
    unit errors before they masquerade as over/underfit."""
    from collections import defaultdict

    agg = defaultdict(lambda: [0.0, 0.0, 0.0])  # yale, target, populace
    for x in spec:
        if x["name"] not in out:
            continue
        a = agg[x["variable"]]
        a[0] += out[x["name"]]
        a[1] += x.get("target") or 0
        a[2] += x.get("populace") or 0
    print(f"\n{'concept':38s}{'yale':>14s}{'official':>14s}{'populace':>14s}  flag")
    for v in sorted(agg):
        y, t, p = agg[v]
        offt = abs(y - t) / t if t else 0
        offp = abs(y - p) / p if p else 0
        flag = "  <-- >40% off BOTH" if offt > 0.4 and offp > 0.4 else ""
        sc = 1e9  # display in billions
        print(f"{v:38s}{y/sc:>14.1f}{t/sc:>14.1f}{p/sc:>14.1f}{flag}")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--spec", type=Path, required=True)
    ap.add_argument("--detail", type=Path, required=True)
    ap.add_argument("--dry-run", action="store_true", help="print verification, don't write")
    args = ap.parse_args()

    spec = json.loads(args.spec.read_text())
    cols = load_detail(args.detail)
    out = score(spec, cols)
    verify(spec, out)

    meta = {
        "dataset": "yale_national",
        "label": "Yale Budget Lab (reconstruction)",
        "engine": "Budget-Lab-Yale/Tax-Data + Tax-Simulator (R)",
        "year": 2024,
        "source": (
            "Yale Budget Lab federal tax model, reconstructed: their unmodified "
            "Tax-Data + Tax-Simulator run on the 2015 SOI PUF reweighted to 2017 "
            "SOI (LP) and projected to 2024."
        ),
        "source_url": "https://github.com/Budget-Lab-Yale/Tax-Simulator",
        "notes": (
            "RECONSTRUCTION, not Yale's published output. Yale's unmodified code is "
            "run, but its two main input datasets — Compiled-SOI-Tables (reweighting "
            "targets) and Macro-Projections — are not published, so they were rebuilt "
            "from the same public sources (IRS SOI, CBO, BEA, SSA), not Yale's actual "
            "files. Against CBO's Feb-2026 baseline (Yale's own validation benchmark) "
            "this reconstruction matches most lines within ~5% (wages -0.6%, AGI "
            "+5.4%, EITC amount -1.8%, returns -3.1%) but runs high on income-elastic "
            "lines (income tax +10.6%, capital gains +30%, business income +20%), "
            "because the reconstructed macro/SOI inputs are not byte-identical to "
            "Yale's. So the loss here LIKELY OVERSTATES Yale's true divergence; Yale's "
            "actual model would probably score somewhat better. "
            "Methodology: PUF-derived tax-unit microdata scored against the identical "
            "national target surface and per-cell breakdown (AGI band + EITC "
            "qualifying children + subpopulation) as Tax-Calculator CPS and TMD. EITC "
            "children via n_dep_eitc; itemizer subpopulation (table 2.1) via "
            "itemizing==1; EITC-return AGI (table 2.5) via eitc!=0. Drop set kept "
            "identical to TMD (both PUF-based). Tax-law parameters indexed to 2024 via "
            "Yale's chained-CPI indexation."
        ),
        "rows": out,
    }
    if args.dry_run:
        print(f"\n[dry-run] {len(out)} cells scored; not written")
        return
    (OUT_DIR / "yale-national-2024.json").write_text(json.dumps(meta, indent=2))
    print(f"\nwrote {len(out)} rows -> yale-national-2024.json")


if __name__ == "__main__":
    main()
