"""HTTP-independent request boundary shared by the hosted service and tests."""

from __future__ import annotations

import os
import re
import threading
from urllib.parse import parse_qs

from scripts.hosted_release import reviewed_release, validate_selection
from scripts.microcosm_variable_core import (
    DEFAULT_FILENAME,
    DEFAULT_PERIOD,
    DEFAULT_RELEASE,
    DEFAULT_REPO,
    DEFAULT_REVISION,
    VariableCalculationError,
    calculate_variables,
)
from scripts.runtime_identity import runtime_identity

VARIABLE_RE = re.compile(r"^[A-Za-z_][A-Za-z0-9_]*$")
# The native simulation and its cache are mutable. Serialize their use even
# when a local ASGI server is configured with multiple request threads.
_CALCULATION_LOCK = threading.Lock()


def handle_query(query: str) -> tuple[int, dict]:
    """Validate a lookup, then execute the unchanged shared calculation."""
    params = parse_qs(query, keep_blank_values=True)
    variables = []
    for key in ("variables", "variable"):
        for value in params.get(key, []):
            variables.extend(v.strip() for v in re.split(r"[,\s]+", value) if v.strip())
    variables = list(dict.fromkeys(variables))
    period = params.get("period", [DEFAULT_PERIOD])[0].strip()
    requested_release = params.get("release", [DEFAULT_RELEASE])[0].strip()
    repo = os.environ.get("POPULACE_HF_REPO", DEFAULT_REPO)
    revision = os.environ.get("POPULACE_HF_REVISION", DEFAULT_REVISION)

    if params.get("metadata") == ["1"]:
        return 200, {
            "runtime": runtime_identity(),
            "data_configuration": reviewed_release(),
            "environment_configuration": {
                "repo": repo,
                "revision": revision,
                "filename": DEFAULT_FILENAME,
            },
        }
    if not variables:
        return 400, {"detail": "Enter at least one PolicyEngine variable name."}
    if len(variables) > 12:
        return 400, {"detail": "Run at most 12 variables at a time."}
    invalid = next((v for v in variables if not VARIABLE_RE.fullmatch(v)), None)
    if invalid:
        return 400, {"detail": f"Invalid PolicyEngine variable name: {invalid}"}
    if not re.fullmatch(r"\d{4}", period):
        return 400, {"detail": "Period must be a four-digit year."}
    if not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9._-]{0,127}", requested_release):
        return 400, {"detail": "Invalid release id."}
    try:
        config = validate_selection(
            requested_release=requested_release,
            repo=repo,
            hf_revision=revision,
            filename=DEFAULT_FILENAME,
            period=period,
        )
        with _CALCULATION_LOCK:
            result = calculate_variables(
                variables=variables,
                period=period,
                repo=repo,
                revision=config["release_id"],
                hf_revision=config["hf_revision"],
                filename=DEFAULT_FILENAME,
            )
        return 200, result
    except VariableCalculationError as exc:
        return exc.status_code, {"detail": str(exc)}
    except Exception:
        # Internal tracebacks belong in the backend logs, not public JSON.
        import logging

        logging.getLogger(__name__).exception("Variable calculation failed")
        return 502, {"detail": "Variable calculation failed."}
