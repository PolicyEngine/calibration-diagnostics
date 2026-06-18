"""Vercel Python function for hosted Populace variable lookup."""

from __future__ import annotations

import json
import os
import re
from http.server import BaseHTTPRequestHandler
from urllib.parse import parse_qs, urlparse

from scripts.populace_variable_core import (
    DEFAULT_FILENAME,
    DEFAULT_REPO,
    DEFAULT_REVISION,
    VariableCalculationError,
    calculate_variables,
    resolve_release_id,
)


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
        params = parse_qs(parsed.query)
        variables = []
        for key in ("variables", "variable"):
            for value in params.get(key, []):
                variables.extend(v.strip() for v in re.split(r"[,\s]+", value) if v.strip())
        variables = list(dict.fromkeys(variables))
        period = (params.get("period", ["2024"])[0] or "2024").strip()
        requested_release = (params.get("release", ["latest"])[0] or "latest").strip()
        repo = os.environ.get("POPULACE_HF_REPO", DEFAULT_REPO)
        hf_revision = os.environ.get("POPULACE_HF_REVISION", DEFAULT_REVISION)

        if not variables:
            _json_response(self, 400, {"detail": "Enter at least one PolicyEngine variable name."})
            return
        if len(variables) > 12:
            _json_response(self, 400, {"detail": "Run at most 12 variables at a time."})
            return
        invalid = next((variable for variable in variables if not VARIABLE_RE.match(variable)), None)
        if invalid:
            _json_response(self, 400, {"detail": f"Invalid PolicyEngine variable name: {invalid}"})
            return
        if not re.match(r"^\d{4}$", period):
            _json_response(self, 400, {"detail": "Period must be a four-digit year."})
            return

        try:
            release = resolve_release_id(repo, hf_revision, requested_release)
            result = calculate_variables(
                variables=variables,
                period=period,
                repo=repo,
                revision=release,
                filename=DEFAULT_FILENAME,
            )
            _json_response(self, 200, result)
        except VariableCalculationError as exc:
            _json_response(self, 502, {"detail": str(exc)})
        except Exception as exc:
            _json_response(self, 502, {"detail": f"Variable calculation failed: {exc}"})
