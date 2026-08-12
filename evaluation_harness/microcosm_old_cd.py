"""Exact 117th-Congress geography for a Microcosm household artifact."""

from __future__ import annotations

import csv
import hashlib
import io
import json
import urllib.request
import zipfile
from pathlib import Path
from typing import Callable, Iterable


STATE_USPS = {
    "01": "AL", "02": "AK", "04": "AZ", "05": "AR", "06": "CA",
    "08": "CO", "09": "CT", "10": "DE", "11": "DC", "12": "FL",
    "13": "GA", "15": "HI", "16": "ID", "17": "IL", "18": "IN",
    "19": "IA", "20": "KS", "21": "KY", "22": "LA", "23": "ME",
    "24": "MD", "25": "MA", "26": "MI", "27": "MN", "28": "MS",
    "29": "MO", "30": "MT", "31": "NE", "32": "NV", "33": "NH",
    "34": "NJ", "35": "NM", "36": "NY", "37": "NC", "38": "ND",
    "39": "OH", "40": "OK", "41": "OR", "42": "PA", "44": "RI",
    "45": "SC", "46": "SD", "47": "TN", "48": "TX", "49": "UT",
    "50": "VT", "51": "VA", "53": "WA", "54": "WV", "55": "WI",
    "56": "WY",
}

BAF2020_URL = (
    "https://www2.census.gov/geo/docs/maps-data/data/baf2020/"
    "BlockAssign_ST{state_fips}_{state_usps}.zip"
)


def _sha256_bytes(payload: bytes) -> str:
    return hashlib.sha256(payload).hexdigest()


def extract_state_assignments(
    archive_payload: bytes,
    *,
    state_fips: str,
    state_usps: str,
    requested_blocks: set[str],
) -> dict[str, str]:
    """Extract 2020-block assignments; the 116th and 117th share boundaries."""

    member = f"BlockAssign_ST{state_fips}_{state_usps}_CD.txt"
    result: dict[str, str] = {}
    with zipfile.ZipFile(io.BytesIO(archive_payload)) as archive:
        with archive.open(member) as raw:
            rows = csv.DictReader(io.TextIOWrapper(raw), delimiter="|")
            for row in rows:
                block = str(row["BLOCKID"])
                if block not in requested_blocks:
                    continue
                district = str(row["DISTRICT"]).zfill(2)
                result[block] = f"5001700US{state_fips}{district}"
    return result


def load_old_cd_assignments(path: str | Path) -> dict[str, str]:
    assignments: dict[str, str] = {}
    with Path(path).open(newline="") as stream:
        rows = csv.DictReader(stream)
        required = {"block_geoid", "congressional_district_geoid_117th"}
        if not rows.fieldnames or not required.issubset(rows.fieldnames):
            raise ValueError("old district assignment artifact has invalid columns")
        for row in rows:
            block = str(row["block_geoid"])
            if block in assignments:
                raise ValueError(f"old district assignment has duplicate block {block}")
            assignments[block] = str(row["congressional_district_geoid_117th"])
    return assignments


def build_old_cd_assignment_artifact(
    blocks: Iterable[str],
    output_path: str | Path,
    *,
    downloader: Callable[[str], bytes] | None = None,
) -> dict:
    """Build a compact, release-specific old-CD lookup from official Census BAFs."""

    downloader = downloader or (lambda url: urllib.request.urlopen(url).read())
    requested = {str(block) for block in blocks}
    by_state: dict[str, set[str]] = {}
    for block in requested:
        by_state.setdefault(block[:2], set()).add(block)

    assignments: dict[str, str] = {}
    sources: list[dict] = []
    for state_fips in sorted(by_state):
        state_usps = STATE_USPS.get(state_fips)
        if state_usps is None:
            raise ValueError(f"unsupported state FIPS in Microcosm blocks: {state_fips}")
        url = BAF2020_URL.format(state_fips=state_fips, state_usps=state_usps)
        payload = downloader(url)
        state_assignments = extract_state_assignments(
            payload,
            state_fips=state_fips,
            state_usps=state_usps,
            requested_blocks=by_state[state_fips],
        )
        assignments.update(state_assignments)
        sources.append(
            {
                "state_fips": state_fips,
                "url": url,
                "sha256": _sha256_bytes(payload),
                "requested_block_count": len(by_state[state_fips]),
                "matched_block_count": len(state_assignments),
            }
        )

    missing = sorted(requested - set(assignments))
    if missing:
        raise ValueError(f"Census BAFs did not assign Microcosm blocks: {missing[:3]}")

    destination = Path(output_path)
    destination.parent.mkdir(parents=True, exist_ok=True)
    with destination.open("w", newline="") as stream:
        writer = csv.writer(stream)
        writer.writerow(["block_geoid", "congressional_district_geoid_117th"])
        writer.writerows((block, assignments[block]) for block in sorted(assignments))
    manifest = {
        "schema_version": "microcosm_old_cd_assignments.v1",
        "geography": "117th Congress",
        "source_geography": (
            "Census 2020 Block Assignment Files congressional-district layer; "
            "116th and 117th district boundaries are identical"
        ),
        "block_count": len(assignments),
        "assignment_file": destination.name,
        "assignment_sha256": hashlib.sha256(destination.read_bytes()).hexdigest(),
        "sources": sources,
    }
    manifest_path = destination.with_suffix(".manifest.json")
    manifest_path.write_text(json.dumps(manifest, indent=2, sort_keys=True) + "\n")
    return manifest
