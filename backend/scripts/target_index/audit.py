"""Audit orchestrator: run every registered parser, match against the DB,
emit backend/data/target_index.json + a human-readable summary on stdout.

Usage:
    python -m backend.scripts.target_index.audit \\
        --calibration-targets ".artifacts/.../storage/calibration_targets" \\
        --db ".artifacts/.../policy_data.db" \\
        --out backend/data/target_index.json

Both --calibration-targets and --db default to the installed-package locations.
"""

from __future__ import annotations

import argparse
import json
import logging
import sys
from pathlib import Path

from backend.scripts.target_index.matcher import (
    cross_tier_audit,
    load_db_targets,
)
from backend.scripts.target_index.parsers import PARSER_REGISTRY
from backend.scripts.target_index.schema import TargetRecord

logging.basicConfig(level=logging.INFO, format="%(levelname)-5s %(message)s")
logger = logging.getLogger("audit")


def _default_calibration_targets() -> Path:
    """The installed policyengine_us_data ships these CSVs under storage/."""
    try:
        import policyengine_us_data
        root = Path(policyengine_us_data.__file__).parent
        return root / "storage" / "calibration_targets"
    except ImportError:
        return Path()


def _default_db_path() -> Path:
    """Use the cached HF artifact if available."""
    candidates = [
        Path(".artifacts/PolicyEngine__policyengine-us-data-pipeline/test/policy_data.db"),
        Path(".artifacts/PolicyEngine__policyengine-us-data/staging/usdata-gha25719239158-a1-889ab438/policy_data.db"),
    ]
    for p in candidates:
        if p.exists():
            return p
    return Path()


def run_audit(csv_dir: Path, db_path: Path, out_path: Path) -> dict:
    if not csv_dir.exists():
        logger.error("calibration_targets dir not found: %s", csv_dir)
        sys.exit(1)
    if not db_path.exists():
        logger.error("policy_data.db not found: %s", db_path)
        sys.exit(1)

    # 1. Discover every CSV in the directory
    all_csvs = sorted(p.name for p in csv_dir.glob("*.csv"))
    logger.info("Found %d CSV files in %s", len(all_csvs), csv_dir)

    # 2. Run each registered parser
    tier_records: dict[str, list[TargetRecord]] = {}
    parsed_total = 0
    for fname in all_csvs:
        parser = PARSER_REGISTRY.get(fname)
        if parser is None:
            logger.warning("  ⚠  no parser for %s (skipping)", fname)
            continue
        records = parser(csv_dir / fname)
        tier_records[f"csv/{fname}"] = records
        parsed_total += len(records)
        logger.info("  ✓ %s → %d records", fname, len(records))

    # 3. Load the DB tier
    logger.info("Loading policy_data.db: %s", db_path)
    db_records = load_db_targets(db_path)
    logger.info("  → %d DB targets", len(db_records))

    # 4. Match
    audit = cross_tier_audit(tier_records, db_records)

    # 5. Persist outputs:
    #    - <out_path>          → audit summary only (small, committed)
    #    - <out_path>.union.jsonl → full per-record dump (large, gitignored)
    out_path.parent.mkdir(parents=True, exist_ok=True)
    summary = {
        "db_total": audit["db_total"],
        "tiers": audit["tiers"],
        "parsers_covered": sorted(PARSER_REGISTRY.keys()),
        "parsers_missing": sorted(set(all_csvs) - set(PARSER_REGISTRY.keys())),
    }
    out_path.write_text(json.dumps(summary, indent=2, default=str))
    logger.info("Wrote audit summary → %s", out_path)

    # Full per-record dump as JSONL (one record per line) — large, gitignored.
    union_path = out_path.with_suffix(out_path.suffix + ".union.jsonl")
    with union_path.open("w") as f:
        for rs in tier_records.values():
            for r in rs:
                f.write(json.dumps(r.to_dict(), default=str) + "\n")
        for r in db_records:
            f.write(json.dumps(r.to_dict(), default=str) + "\n")
    logger.info("Wrote full union → %s (gitignored)", union_path)

    return audit


def _print_summary(audit: dict) -> None:
    print()
    print("=" * 60)
    print("TARGET-INDEX AUDIT")
    print("=" * 60)
    print(f"DB total active targets: {audit['db_total']:,}")
    print()
    print(f"{'Tier':40} {'records':>8}  {'matched':>8}  {'%':>6}")
    print("-" * 70)
    for t in audit["tiers"]:
        rate = (t["match_rate"] or 0) * 100
        print(f"{t['tier']:40} {t['total_records']:>8,}  "
              f"{t['matched_to_db']:>8,}  {rate:>5.1f}%")

    print()
    for t in audit["tiers"]:
        if t["unmatched"] == 0: continue
        print(f"--- {t['tier']}: {t['unmatched']} unmatched (showing up to 5) ---")
        for ex in t["unmatched_examples"][:5]:
            print(f"  variable={ex['variable']!r} period={ex.get('period')} "
                  f"geo={ex.get('geo_level')}/{ex.get('geographic_id')} "
                  f"cons={ex.get('constraints')}")
        print()


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--calibration-targets", type=Path,
                    default=_default_calibration_targets())
    ap.add_argument("--db", type=Path, default=_default_db_path())
    ap.add_argument("--out", type=Path,
                    default=Path("backend/data/target_index.json"))
    args = ap.parse_args()
    audit = run_audit(args.calibration_targets, args.db, args.out)
    _print_summary(audit)


if __name__ == "__main__":
    main()
