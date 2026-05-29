"""Utilities for parsing congressional district GEOIDs and readable names."""

import numpy as np

STATE_FIPS_TO_NAME: dict[int, str] = {
    1: "Alabama", 2: "Alaska", 4: "Arizona", 5: "Arkansas",
    6: "California", 8: "Colorado", 9: "Connecticut", 10: "Delaware",
    11: "District of Columbia", 12: "Florida", 13: "Georgia", 15: "Hawaii",
    16: "Idaho", 17: "Illinois", 18: "Indiana", 19: "Iowa",
    20: "Kansas", 21: "Kentucky", 22: "Louisiana", 23: "Maine",
    24: "Maryland", 25: "Massachusetts", 26: "Michigan", 27: "Minnesota",
    28: "Mississippi", 29: "Missouri", 30: "Montana", 31: "Nebraska",
    32: "Nevada", 33: "New Hampshire", 34: "New Jersey", 35: "New Mexico",
    36: "New York", 37: "North Carolina", 38: "North Dakota", 39: "Ohio",
    40: "Oklahoma", 41: "Oregon", 42: "Pennsylvania", 44: "Rhode Island",
    45: "South Carolina", 46: "South Dakota", 47: "Tennessee", 48: "Texas",
    49: "Utah", 50: "Vermont", 51: "Virginia", 53: "Washington",
    54: "West Virginia", 55: "Wisconsin", 56: "Wyoming",
    60: "American Samoa", 66: "Guam", 69: "Northern Mariana Islands",
    72: "Puerto Rico", 78: "U.S. Virgin Islands",
}

STATE_NAME_TO_FIPS: dict[str, int] = {v: k for k, v in STATE_FIPS_TO_NAME.items()}

# States with a single at-large congressional district
AT_LARGE_STATES: set[int] = {2, 10, 11, 30, 38, 46, 50, 56}

STATE_FIPS_TO_ABBREV: dict[int, str] = {
    1: "AL", 2: "AK", 4: "AZ", 5: "AR", 6: "CA", 8: "CO", 9: "CT",
    10: "DE", 11: "DC", 12: "FL", 13: "GA", 15: "HI", 16: "ID",
    17: "IL", 18: "IN", 19: "IA", 20: "KS", 21: "KY", 22: "LA",
    23: "ME", 24: "MD", 25: "MA", 26: "MI", 27: "MN", 28: "MS",
    29: "MO", 30: "MT", 31: "NE", 32: "NV", 33: "NH", 34: "NJ",
    35: "NM", 36: "NY", 37: "NC", 38: "ND", 39: "OH", 40: "OK",
    41: "OR", 42: "PA", 44: "RI", 45: "SC", 46: "SD", 47: "TN",
    48: "TX", 49: "UT", 50: "VT", 51: "VA", 53: "WA", 54: "WV",
    55: "WI", 56: "WY", 60: "AS", 66: "GU", 69: "MP", 72: "PR",
    78: "VI",
}


def parse_cd_geoids(cd_geoid: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    """Extract state FIPS codes from congressional district GEOID strings.

    CD GEOIDs are stored as strings like '4213' (state 42, district 13)
    or '621' (state 6, district 21). The state FIPS is everything except
    the last two characters (the district number is always two digits,
    but may lack a leading zero in the string representation).

    Args:
        cd_geoid: String array of CD GEOIDs (e.g., ['4213', '621', '104']).

    Returns:
        Tuple of (cd_geoid_int, state_fips) as integer arrays.
        cd_geoid_int: The GEOID as an integer (e.g., 4213, 621, 104).
        state_fips: The state FIPS code (e.g., 42, 6, 1).
    """
    if len(cd_geoid) == 0:
        return np.array([], dtype=np.int64), np.array([], dtype=np.int32)

    cd_geoid_int = np.array([int(x) for x in cd_geoid], dtype=np.int64)
    state_fips = (cd_geoid_int // 100).astype(np.int32)

    return cd_geoid_int, state_fips


def state_name(fips: int) -> str:
    """Return the state name for a FIPS code."""
    return STATE_FIPS_TO_NAME.get(fips, f"Unknown ({fips})")


def state_abbrev(fips: int) -> str:
    """Return the state abbreviation for a FIPS code."""
    return STATE_FIPS_TO_ABBREV.get(fips, f"?{fips}")


def runtime_dataset_bundle_for(
    geo_level: str | None,
    geographic_id,
    *,
    available: "frozenset[str] | None" = None,
    federal_fallback: str = "enhanced_cps_2024.h5",
) -> str:
    """Like ``dataset_bundle_for`` but aware of what the run actually
    publishes. If the conventional bundle (e.g. ``states/CA.h5``) isn't
    in ``available``, fall back to the federal bundle so the dashboard
    label matches the file that actually holds this target's weights.

    When ``available`` is None the function behaves like the raw
    canonical mapping; pass a set from ``published_bundles`` to make it
    run-aware.
    """
    proposed = dataset_bundle_for(geo_level, geographic_id)
    if not available:
        return proposed
    if proposed in available:
        return proposed
    if federal_fallback in available:
        return federal_fallback
    return proposed


def dataset_bundle_for(geo_level: str | None, geographic_id) -> str:
    """Map a target's geography to the calibrated dataset file that holds
    its calibrated weights, mirroring the per-state / per-district pipeline
    builds in policyengine-us-data.

    Examples:
        national, US   → 'national/US.h5'
        state, '6'     → 'states/CA.h5'
        district, 612  → 'districts/CA-12.h5'

    Used both for display (the existing 'Dataset' column on /targets) and
    for the dataset_file filter — different bundles include different
    target subsets, and the per-state h5 builds are calibrated against
    their own slice of the targets table.
    """
    if not geo_level or geo_level == "national":
        return "national/US.h5"
    gid_str = "" if geographic_id is None else str(geographic_id)
    if not gid_str or gid_str == "nan":
        return "—"
    try:
        n = int(float(gid_str))
    except (TypeError, ValueError):
        n = None
    if geo_level == "state":
        if n is not None and n in STATE_FIPS_TO_ABBREV:
            return f"states/{STATE_FIPS_TO_ABBREV[n]}.h5"
        return f"states/{gid_str}.h5"
    if geo_level == "district":
        if n is not None:
            state_fips = n // 100
            dist = n % 100
            code = STATE_FIPS_TO_ABBREV.get(state_fips, str(state_fips))
            return f"districts/{code}-{dist:02d}.h5"
        return f"districts/{gid_str}.h5"
    return str(geo_level)


def _ordinal(n: int) -> str:
    """Return ordinal string for an integer (1 -> '1st', 2 -> '2nd', etc.)."""
    if 11 <= n % 100 <= 13:
        return f"{n}th"
    suffix = {1: "st", 2: "nd", 3: "rd"}.get(n % 10, "th")
    return f"{n}{suffix}"


def cd_display_name(cd_geoid_int: int) -> str:
    """Return a readable name for a congressional district GEOID.

    Examples:
        4213 -> "Pennsylvania's 13th congressional district"
        621  -> "California's 21st congressional district"
        101  -> "Alabama's at-large congressional district"
        1101 -> "District of Columbia's at-large congressional district"
    """
    fips = cd_geoid_int // 100
    district_num = cd_geoid_int % 100
    sname = STATE_FIPS_TO_NAME.get(fips, f"State {fips}")

    if fips in AT_LARGE_STATES or district_num == 1 and fips in AT_LARGE_STATES:
        return f"{sname}'s at-large congressional district"

    return f"{sname}'s {_ordinal(district_num)} congressional district"


def geo_display_name(geo_level: str, geographic_id: str) -> str:
    """Return a readable name for any geographic level + ID.

    Args:
        geo_level: 'national', 'state', or 'district'
        geographic_id: 'US', state FIPS string, or CD GEOID string

    Returns:
        Readable name like 'National', 'California', or
        "California's 21st congressional district"
    """
    if geo_level == "national":
        return "National"

    if geo_level == "state":
        try:
            fips = int(geographic_id)
            return state_name(fips)
        except (ValueError, TypeError):
            return f"State {geographic_id}"

    if geo_level == "district":
        try:
            cd_int = int(geographic_id)
            return cd_display_name(cd_int)
        except (ValueError, TypeError):
            return f"District {geographic_id}"

    return str(geographic_id)


def list_states() -> list[dict]:
    """Return all states with FIPS, name, and abbreviation."""
    return [
        {"fips": fips, "name": name, "abbrev": STATE_FIPS_TO_ABBREV.get(fips, "")}
        for fips, name in sorted(STATE_FIPS_TO_NAME.items())
        if fips <= 56  # exclude territories
    ]


def list_districts_for_state(state_fips: int) -> list[dict]:
    """Return all congressional districts for a state.

    Note: this returns a generic list based on known at-large states.
    For actual district enumeration, query the calibration package's cd_geoid array.
    """
    sname = state_name(state_fips)
    if state_fips in AT_LARGE_STATES:
        cd_int = state_fips * 100 + 1
        return [{"cd_geoid": cd_int, "name": f"{sname}'s at-large congressional district"}]
    return []
