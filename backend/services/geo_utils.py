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
