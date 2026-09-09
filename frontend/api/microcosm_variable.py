"""Vercel Python function for hosted Microcosm variable lookup."""

from __future__ import annotations

import json
import os
import re
from http.server import BaseHTTPRequestHandler
from urllib.parse import parse_qs, urlparse

from scripts.microcosm_variable_core import (
    DEFAULT_FILENAME,
    DEFAULT_PERIOD,
    DEFAULT_RELEASE,
    DEFAULT_REPO,
    DEFAULT_REVISION,
    VariableCalculationError,
    calculate_variables,
)
from scripts.hosted_release import reviewed_release, validate_selection
from scripts.runtime_identity import runtime_identity


VARIABLE_RE = re.compile(r"^[A-Za-z_][A-Za-z0-9_]*$")


def _json_response(handler: BaseHTTPRequestHandler, status: int, body: dict) -> None:
    payload = json.dumps(body, allow_nan=False).encode("utf-8")
    handler.send_response(status)
    handler.send_header("Content-Type", "application/json; charset=utf-8")
    handler.send_header("Cache-Control", "no-store")
    handler.send_header("Content-Length", str(len(payload)))
    handler.end_headers()
    handler.wfile.write(payload)


class handler(BaseHTTPRequestHandler):
    def do_GET(self) -> None:
        parsed = urlparse(self.path)
        params = parse_qs(parsed.query, keep_blank_values=True)
        variables = []
        for key in ("variables", "variable"):
            for value in params.get(key, []):
                variables.extend(
                    v.strip() for v in re.split(r"[,\s]+", value) if v.strip()
                )
        variables = list(dict.fromkeys(variables))
        period = params.get("period", [DEFAULT_PERIOD])[0].strip()
        requested_release = (params.get("release", [DEFAULT_RELEASE])[0]).strip()
        # Deprecated upstream identifiers: deployment configuration retains the
        # former Populace names until Microcosm migrates the published contract.
        repo = os.environ.get("POPULACE_HF_REPO", DEFAULT_REPO)
        hf_revision = os.environ.get("POPULACE_HF_REVISION", DEFAULT_REVISION)

        if params.get("metadata") == ["1"]:
            _json_response(
                self,
                200,
                {
                    "runtime": runtime_identity(),
                    # Configuration is not evidence of a loaded data release.
                    "data_configuration": reviewed_release(),
                    "environment_configuration": {
                        "repo": repo,
                        "revision": hf_revision,
                        "filename": DEFAULT_FILENAME,
                    },
                },
            )
            return

        if not variables:
            _json_response(
                self, 400, {"detail": "Enter at least one PolicyEngine variable name."}
            )
            return
        if len(variables) > 12:
            _json_response(self, 400, {"detail": "Run at most 12 variables at a time."})
            return
        invalid = next(
            (variable for variable in variables if not VARIABLE_RE.match(variable)),
            None,
        )
        if invalid:
            _json_response(
                self, 400, {"detail": f"Invalid PolicyEngine variable name: {invalid}"}
            )
            return
        if not re.match(r"^\d{4}$", period):
            _json_response(self, 400, {"detail": "Period must be a four-digit year."})
            return
        # release flows into an HF URL path and a /tmp sentinel filename; reject
        # traversal/injection before it reaches either.
        if not re.match(r"^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$", requested_release):
            _json_response(self, 400, {"detail": "Invalid release id."})
            return

        try:
            config = validate_selection(
                requested_release=requested_release,
                repo=repo,
                hf_revision=hf_revision,
                filename=DEFAULT_FILENAME,
                period=period,
            )
            result = calculate_variables(
                variables=variables,
                period=period,
                repo=repo,
                revision=config["release_id"],
                hf_revision=config["hf_revision"],
                filename=DEFAULT_FILENAME,
            )
            _json_response(self, 200, result)
        except VariableCalculationError as exc:
            _json_response(self, getattr(exc, "status_code", 502), {"detail": str(exc)})
        except Exception as exc:
            _json_response(self, 502, {"detail": f"Variable calculation failed: {exc}"})
