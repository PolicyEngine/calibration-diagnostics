"""Match TargetRecords from tiers 1-4 against policy_data.db (tier 5)."""

from __future__ import annotations

import logging
import sqlite3
from collections import defaultdict
from pathlib import Path

from backend.scripts.target_index.schema import TargetRecord

logger = logging.getLogger(__name__)


def load_db_targets(db_path: Path) -> list[TargetRecord]:
    """Read every active target from policy_data.db into TargetRecord form,
    so the matcher can compare apples-to-apples by signature."""
    conn = sqlite3.connect(str(db_path))
    conn.row_factory = sqlite3.Row

    # Pull all targets + their stratum constraints in two passes.
    targets = list(conn.execute(
        "SELECT target_id, variable, period, stratum_id, value, active, "
        "source, notes FROM targets WHERE active = 1"
    ))
    constraints = defaultdict(list)
    for c in conn.execute(
        "SELECT stratum_id, constraint_variable, operation, value "
        "FROM stratum_constraints"
    ):
        constraints[c["stratum_id"]].append((
            c["constraint_variable"], c["operation"], c["value"],
        ))
    conn.close()

    geo_vars = {"state_fips", "congressional_district_geoid", "ucgid_str"}
    out: list[TargetRecord] = []
    for t in targets:
        cons_for_stratum = constraints.get(t["stratum_id"], [])
        geo_level: str | None = None
        gid: str | None = None
        non_geo: list[tuple[str, str, str]] = []
        for cvar, op, cval in cons_for_stratum:
            if cvar in geo_vars and op == "==":
                if cvar == "state_fips":
                    geo_level = "state"
                elif cvar == "congressional_district_geoid":
                    geo_level = "district"
                else:
                    geo_level = cvar
                gid = str(cval)
            else:
                non_geo.append((cvar, op, str(cval)))

        if geo_level is None:
            geo_level = "national"

        out.append(TargetRecord(
            variable=t["variable"],
            geo_level=geo_level,
            geographic_id=gid,
            period=t["period"],
            constraints=tuple(sorted(non_geo)),
            value=t["value"],
            is_count=False,  # the DB doesn't flag count vs amount
            storage_tier="db",
            source_path="policy_data.db",
            source_row=f"target_id={t['target_id']}/stratum_id={t['stratum_id']}",
            notes=(t["notes"] or ""),
        ))
    return out


def index_by_signature(records: list[TargetRecord]) -> dict[tuple, list[TargetRecord]]:
    by_sig: dict[tuple, list[TargetRecord]] = defaultdict(list)
    for r in records:
        by_sig[r.signature()].append(r)
    return by_sig


def cross_tier_audit(
    tier_records: dict[str, list[TargetRecord]],
    db_records: list[TargetRecord],
) -> dict:
    """For each non-DB tier, report: how many of its records signature-match
    a DB target. Returns a structured audit.

    tier_records: {tier_label: [records]} from tiers 1-4.
    db_records: tier 5 (loaded via load_db_targets).
    """
    db_by_sig = index_by_signature(db_records)
    audit = {
        "db_total": len(db_records),
        "tiers": [],
    }
    for tier_label, records in tier_records.items():
        # Aggregate the rare case of duplicate signatures within a source
        per_sig: dict[tuple, list[TargetRecord]] = defaultdict(list)
        for r in records:
            per_sig[r.signature()].append(r)
        matched, unmatched = [], []
        for sig, rs in per_sig.items():
            if sig in db_by_sig:
                matched.extend(rs)
            else:
                unmatched.extend(rs)
        audit["tiers"].append({
            "tier": tier_label,
            "total_records": len(records),
            "unique_signatures": len(per_sig),
            "matched_to_db": len(matched),
            "unmatched": len(unmatched),
            "match_rate": (len(matched) / len(records)) if records else None,
            "unmatched_examples": [r.to_dict() for r in unmatched[:5]],
        })
    return audit
