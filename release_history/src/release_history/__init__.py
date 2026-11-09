"""Release history: measure each published Microcosm release on a fixed reference model.

See docs/release-history.md. One measurement is one release build on one panel
(a country's reference engine, this producer's version and the country's spec).
"""

# Bump for any change that can alter a stored number; never for a refactor.
# A bump gives every country a new panel id, and each country's backfill is
# then dispatched on its own.
PRODUCER_VERSION = "1"

# The version of the JSON documents this package writes (spec, references,
# panel, measurement, references lock).
SCHEMA_VERSION = 1

__all__ = ["PRODUCER_VERSION", "SCHEMA_VERSION"]
