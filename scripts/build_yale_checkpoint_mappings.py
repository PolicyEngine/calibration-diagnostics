"""Build the explicit Yale reconstruction-to-Chronicle checkpoint manifest."""

from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path

import yaml

from evaluation_harness.yale_reconstruction_checkpoint import CHECKPOINT_SCHEMA


ROOT = Path(__file__).resolve().parents[1]
INTEGRATION = ROOT / "integrations" / "yale_reconstruction"
RECONSTRUCTION = (
    ROOT
    / "frontend"
    / "lib"
    / "populace"
    / "external-datasets"
    / "yale-national-2024.json"
)


def _facts(frontend_bundle: Path) -> list[dict]:
    facts: list[dict] = []
    for path in sorted((frontend_bundle / "facts").glob("*.json")):
        facts.extend(json.loads(path.read_text())["rows"])
    return facts


def _manual_exposures() -> dict[str, str]:
    payload = yaml.safe_load((INTEGRATION / "mappings.yaml").read_text())
    exposures: dict[str, str] = {}
    for mapping in payload["mappings"]:
        for fact_key in mapping["ledger_selector"].get("fact_keys", ()):
            exposures[fact_key] = mapping["calibration_exposure"]
    return exposures


def _inferred_exposure(fact: dict) -> str:
    measure = str(fact["measure"])
    if "earned_income_credit" in measure or "income_tax_liability" in measure:
        return "external_validation"
    return "related_calibration_family"


def build(frontend_bundle: Path) -> dict:
    reconstruction_bytes = RECONSTRUCTION.read_bytes()
    reconstruction = json.loads(reconstruction_bytes)
    rows = reconstruction["rows"]
    facts = _facts(frontend_bundle)
    fact_by_key = {fact["fact_key"]: fact for fact in facts}
    if len(fact_by_key) != len(facts):
        raise ValueError("frontend bundle contains duplicate fact keys")

    verification = json.loads(
        (INTEGRATION / "verification_results.json").read_text()
    )
    manual_exposures = _manual_exposures()
    mappings: list[dict] = []
    used_facts: set[str] = set()
    used_rows: set[str] = set()

    def add(
        fact: dict,
        row_key: str,
        match_basis: str,
        calibration_exposure: str,
    ) -> None:
        fact_key = str(fact["fact_key"])
        if fact_key in used_facts or row_key in used_rows:
            return
        if row_key not in rows:
            raise ValueError(f"reconstruction row is missing: {row_key}")
        if fact["geography_level"] != "country" or fact["entity"] != "tax_unit":
            raise ValueError(f"Yale mapping is not a national tax-unit fact: {fact_key}")
        mappings.append(
            {
                "fact_key": fact_key,
                "reconstruction_row_key": row_key,
                "observed_period": fact["observed_period"],
                "match_basis": match_basis,
                "calibration_exposure": calibration_exposure,
            }
        )
        used_facts.add(fact_key)
        used_rows.add(row_key)

    verification_fact_keys: list[str] = []
    for row in verification["results"]:
        fact_key = str(row["fact_key"])
        verification_fact_keys.append(fact_key)
        add(
            fact_by_key[fact_key],
            str(row["reconstruction_row_key"]),
            "reviewed_checkpoint",
            manual_exposures[fact_key],
        )

    for fact in sorted(facts, key=lambda item: item["fact_key"]):
        if fact["fact_key"] in used_facts:
            continue
        if fact["geography_level"] != "country" or fact["entity"] != "tax_unit":
            continue
        if fact["observed_period"] not in {"tax_year:2023", "tax_year:2024"}:
            continue
        source_record_id = str(fact.get("provenance", {}).get("source_record_id", ""))
        if not source_record_id:
            continue
        row_key = f"{source_record_id}@2024"
        match_basis = "exact_source_record_id"
        if row_key not in rows and fact["observed_period"] == "tax_year:2024":
            legacy_record_id = source_record_id.replace(".ty2024.", ".ty2023.", 1)
            legacy_row_key = f"{legacy_record_id}@2024"
            if legacy_row_key in rows:
                row_key = legacy_row_key
                match_basis = "legacy_ty2023_to_current_ty2024_record_id"
        if row_key not in rows:
            continue
        add(fact, row_key, match_basis, _inferred_exposure(fact))

    held_out_rows: set[str] = set()
    for fact in facts:
        if fact["observed_period"] != "tax_year:2022":
            continue
        source_record_id = str(fact.get("provenance", {}).get("source_record_id", ""))
        row_key = f"{source_record_id}@2024"
        if row_key in rows and row_key not in used_rows:
            held_out_rows.add(row_key)
    unmatched_rows = set(rows) - used_rows - held_out_rows

    mappings.sort(key=lambda item: item["fact_key"])
    result = {
        "schema_version": CHECKPOINT_SCHEMA,
        "source_id": verification["source_id"],
        "ledger_snapshot_id": verification["ledger_snapshot_id"],
        "official_yale_output": False,
        "reconstruction_sha256": hashlib.sha256(reconstruction_bytes).hexdigest(),
        "reconstruction_row_count": len(rows),
        "evaluated_mapping_count": len(mappings),
        "held_out_2022_row_count": len(held_out_rows),
        "unmatched_row_count": len(unmatched_rows),
        "verification_fact_keys": verification_fact_keys,
        "mappings": mappings,
    }
    if (len(mappings), len(held_out_rows), len(unmatched_rows)) != (318, 58, 44):
        raise ValueError(
            "unexpected Yale checkpoint audit counts: "
            f"{len(mappings)} evaluated, {len(held_out_rows)} held out, "
            f"{len(unmatched_rows)} unmatched"
        )
    return result


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--frontend-bundle", required=True, type=Path)
    parser.add_argument(
        "--output",
        type=Path,
        default=INTEGRATION / "checkpoint_mappings.json",
    )
    arguments = parser.parse_args()
    payload = build(arguments.frontend_bundle)
    arguments.output.write_text(json.dumps(payload, indent=2, sort_keys=True) + "\n")
    print(
        f"Wrote {payload['evaluated_mapping_count']} Yale mappings to "
        f"{arguments.output}"
    )


if __name__ == "__main__":
    main()
