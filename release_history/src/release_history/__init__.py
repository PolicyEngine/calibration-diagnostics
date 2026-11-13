"""Release history: measure each published Microcosm release on a fixed reference model.

See docs/release-history.md. A point is one data file measured on one panel (a
country's reference engine, this producer's version and the country's spec).
"""

# Bump for any change that can alter a stored number; never for a refactor.
# A bump gives every country a new panel id, and each country's backfill is
# then dispatched on its own.
PRODUCER_VERSION = "1"

# Each kind of document has its own format version. A version moves only when a
# field's meaning changes or a field goes; an added field never moves one. Only
# the point's format is in the panel key, because a point is what is measured.
POINT_FORMAT_VERSION = 1
PANEL_FORMAT_VERSION = 1
SERIES_FORMAT_VERSION = 1
LABELS_FORMAT_VERSION = 1
ATTEMPT_FORMAT_VERSION = 1
# references.yaml and references.lock.json.
REFERENCES_FORMAT_VERSION = 1
# A spec's own `schema_version`; outside the panel key. Spec keys are only ever
# added, an absent key means the old behaviour, and no default is written into
# the hashed form.
SPEC_FORMAT_VERSION = 1

__all__ = [
    "ATTEMPT_FORMAT_VERSION",
    "LABELS_FORMAT_VERSION",
    "PANEL_FORMAT_VERSION",
    "POINT_FORMAT_VERSION",
    "PRODUCER_VERSION",
    "REFERENCES_FORMAT_VERSION",
    "SERIES_FORMAT_VERSION",
    "SPEC_FORMAT_VERSION",
]
