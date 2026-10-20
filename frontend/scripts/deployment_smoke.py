"""Validate a deployed calculation route before or after Vercel promotion."""

from __future__ import annotations

import argparse
import json
import math
import time
from collections.abc import Callable
from pathlib import Path
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode
from urllib.request import Request, urlopen

RELEASE_PATH = Path(__file__).with_name("hosted_release.json")
NATIONAL_VARIABLE = "spm_unit_spm_threshold"
STATE_VARIABLE = "ca_income_tax"
# Socket timeout for one request. The Vercel route allows 800 s and its proxy
# answers 504 after waiting 780 s for Modal, so a slow backend produces an HTTP
# error with a body before this timeout.
REQUEST_TIMEOUT_SECONDS = 790
# The backend runs one request at a time and finishes a calculation whose
# client has gone, so a retried full check waits until the backend answers a
# metadata request. backend/modal_app.py stops a call after 800 s; the other
# 60 s allow for container start. Counted from the first full-check request.
BACKEND_FREE_DEADLINE_SECONDS = 860
BACKEND_PROBE_PAUSE_SECONDS = 10
# Failures that leave no complete HTTP response: RemoteDisconnected is a
# ConnectionResetError. HTTPError, a URLError, is handled before these.
_CONNECTION_FAILURES = (ConnectionResetError, URLError, TimeoutError)


class ConnectionFailedError(RuntimeError):
    """The connection closed, reset, failed or timed out without a response."""


def _record(value: Any, name: str) -> dict[str, Any]:
    if not isinstance(value, dict):
        raise TypeError(f"{name} must be a JSON object.")
    return value


def _release() -> dict[str, Any]:
    return json.loads(RELEASE_PATH.read_text())


def _validate_runtime(body: dict[str, Any], source_commit: str) -> None:
    expected = _release()
    runtime = _record(body.get("runtime"), "runtime")
    if runtime.get("source_commit") != source_commit:
        raise ValueError("The deployed backend source commit does not match the build.")
    packages = _record(runtime.get("packages"), "runtime.packages")
    for package, version in expected["packages"].items():
        if packages.get(package) != version:
            raise ValueError(f"The deployed {package} version is not reviewed.")


def _validate_release_identity(identity: Any, *, verified: bool) -> None:
    expected = _release()
    actual = _record(identity, "data identity")
    for field in (
        "repo",
        "hf_revision",
        "release_id",
        "filename",
        "sha256",
        "data_year",
    ):
        if actual.get(field) != expected[field]:
            raise ValueError(f"The deployed data identity has an unexpected {field}.")
    if verified and actual.get("verified") is not True:
        raise ValueError("The calculation did not report verified input bytes.")


def validate_metadata(body: Any, source_commit: str) -> None:
    document = _record(body, "response")
    _validate_runtime(document, source_commit)
    _validate_release_identity(document.get("data_configuration"), verified=False)
    expected = _release()
    environment = _record(
        document.get("environment_configuration"), "environment_configuration"
    )
    if environment != {
        "repo": expected["repo"],
        "revision": expected["hf_revision"],
        "filename": expected["filename"],
    }:
        raise ValueError("The backend environment selects an unreviewed dataset.")


def _finite_number(value: Any) -> bool:
    return (
        isinstance(value, (int, float))
        and not isinstance(value, bool)
        and math.isfinite(value)
    )


def validate_calculation(
    body: Any,
    source_commit: str,
    expected_variables: list[str],
    *,
    require_scope_switch: bool,
) -> None:
    document = _record(body, "response")
    expected = _release()
    _validate_runtime(document, source_commit)
    _validate_release_identity(document.get("data_identity"), verified=True)
    if str(document.get("period")) != str(expected["data_year"]):
        raise ValueError("The calculation period is not the reviewed data year.")
    if document.get("release_id") != expected["release_id"]:
        raise ValueError("The calculation release is not reviewed.")

    results = document.get("variables")
    if not isinstance(results, list) or len(results) != len(expected_variables):
        raise ValueError("The calculation returned an unexpected result count.")
    for result, variable in zip(results, expected_variables):
        item = _record(result, f"result for {variable}")
        if item.get("variable") != variable or not _finite_number(
            item.get("weighted_sum")
        ):
            raise ValueError(f"The calculation result for {variable} is invalid.")
    state_result = next(
        (result for result in results if result.get("variable") == STATE_VARIABLE),
        None,
    )
    if state_result is not None and state_result.get("state_filter") != "CA":
        raise ValueError("The California calculation did not use California input.")

    if require_scope_switch:
        execution = _record(document.get("execution"), "execution")
        hits = _record(execution.get("simulation_cache_hits"), "cache hits")
        if hits.get("national") is not False or hits.get("CA") is not False:
            raise ValueError("The staged calculation did not construct both scopes.")
        evictions = execution.get("simulation_cache_evictions")
        if not isinstance(evictions, list) or "national" not in evictions:
            raise ValueError(
                "The state calculation did not release the national scope."
            )


def _request_json(
    url: str,
    query: list[tuple[str, str]],
    headers: dict[str, str],
    *,
    attempts: int,
    timeout: float = REQUEST_TIMEOUT_SECONDS,
) -> dict[str, Any]:
    target = f"{url}?{urlencode(query)}"
    last_error: Exception | None = None
    for attempt in range(attempts):
        try:
            request = Request(
                target,
                headers={"Cache-Control": "no-cache", **headers},
            )
            with urlopen(request, timeout=timeout) as response:
                if response.status != 200:
                    raise ValueError(f"Deployment returned HTTP {response.status}.")
                content_type = response.headers.get("Content-Type", "")
                if "application/json" not in content_type:
                    raise ValueError("Deployment did not return JSON.")
                return _record(json.load(response), "response")
        except HTTPError as exc:
            detail = exc.read(1_000).decode("utf-8", errors="replace")
            last_error = RuntimeError(f"Deployment returned HTTP {exc.code}: {detail}")
        except (*_CONNECTION_FAILURES, ValueError, json.JSONDecodeError) as exc:
            last_error = exc
        if attempt + 1 < attempts:
            time.sleep(5 * (attempt + 1))
    if isinstance(last_error, _CONNECTION_FAILURES):
        raise ConnectionFailedError(
            "Deployment check failed: the connection ended before a complete "
            f"response arrived ({type(last_error).__name__}: {last_error})."
        ) from last_error
    raise RuntimeError(f"Deployment check failed: {last_error}") from last_error


def _request_and_validate(
    url: str,
    query: list[tuple[str, str]],
    headers: dict[str, str],
    validate: Callable[[dict[str, Any]], None],
    *,
    attempts: int,
) -> None:
    last_error: Exception | None = None
    for attempt in range(attempts):
        try:
            body = _request_json(url, query, headers, attempts=1)
            validate(body)
            return
        except (RuntimeError, TypeError, ValueError) as exc:
            last_error = exc
        if attempt + 1 < attempts:
            time.sleep(5 * (attempt + 1))
    raise RuntimeError(f"Deployment validation failed: {last_error}") from last_error


def _validate_body(
    body: dict[str, Any], validate: Callable[[dict[str, Any]], None]
) -> None:
    try:
        validate(body)
    except (TypeError, ValueError) as exc:
        raise RuntimeError(f"Deployment validation failed: {exc}") from exc


def _wait_until_backend_is_free(
    url: str,
    headers: dict[str, str],
    validate_metadata_body: Callable[[dict[str, Any]], None],
    deadline: float,
) -> None:
    """Return once the backend answers a valid metadata request.

    The backend serves one request at a time, so this answer arrives only after
    the calculation whose connection was lost has finished. Only another lost
    connection is retried; any HTTP error or invalid metadata fails at once.
    """
    last_probe_failure: Exception | None = None
    while (remaining := deadline - time.monotonic()) > 0:
        try:
            body = _request_json(
                url,
                [("metadata", "1")],
                headers,
                attempts=1,
                timeout=min(REQUEST_TIMEOUT_SECONDS, remaining),
            )
        except ConnectionFailedError as probe_failure:
            last_probe_failure = probe_failure
            print(f"Backend metadata request: {probe_failure}", flush=True)
            pause = min(BACKEND_PROBE_PAUSE_SECONDS, deadline - time.monotonic())
            time.sleep(max(0.0, pause))
            continue
        _validate_body(body, validate_metadata_body)
        return
    raise RuntimeError(
        "The backend was still busy or unreachable "
        f"{BACKEND_FREE_DEADLINE_SECONDS} s after the full check was sent, so it "
        f"was not retried. Last metadata request: {last_probe_failure}"
    )


def _run_full_check(
    url: str,
    query: list[tuple[str, str]],
    headers: dict[str, str],
    validate_calculation_body: Callable[[dict[str, Any]], None],
    validate_metadata_body: Callable[[dict[str, Any]], None],
) -> None:
    """Run the national and state calculation, retrying once after a lost connection.

    Each response, first or retried, must pass the same validation on its own.
    A response that fails validation and an HTTP error are never retried.
    """
    deadline = time.monotonic() + BACKEND_FREE_DEADLINE_SECONDS
    try:
        body = _request_json(url, query, headers, attempts=1)
    except ConnectionFailedError as first_failure:
        print(
            f"::warning::{first_failure} Waiting for the backend to finish that "
            "calculation, then sending the full check once more.",
            flush=True,
        )
        _wait_until_backend_is_free(url, headers, validate_metadata_body, deadline)
        print("The backend is free; sending the full check once more.", flush=True)
        try:
            body = _request_json(url, query, headers, attempts=1)
        except RuntimeError as retry_failure:
            raise RuntimeError(
                f"The retried full check failed: {retry_failure}"
            ) from retry_failure
    _validate_body(body, validate_calculation_body)


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--url", required=True)
    parser.add_argument("--source-commit", required=True)
    parser.add_argument("--check", choices=("metadata", "full", "state"), required=True)
    parser.add_argument("--modal-key")
    parser.add_argument("--modal-secret")
    parser.add_argument("--vercel-bypass-secret")
    args = parser.parse_args()

    headers = {}
    if args.modal_key or args.modal_secret:
        if not args.modal_key or not args.modal_secret:
            parser.error("Both Modal proxy credential fields are required.")
        headers.update({"Modal-Key": args.modal_key, "Modal-Secret": args.modal_secret})
    if args.vercel_bypass_secret:
        headers["x-vercel-protection-bypass"] = args.vercel_bypass_secret

    if args.check == "metadata":
        _request_and_validate(
            args.url,
            [("metadata", "1")],
            headers,
            lambda body: validate_metadata(body, args.source_commit),
            attempts=6,
        )
    else:
        variables = (
            [NATIONAL_VARIABLE, STATE_VARIABLE]
            if args.check == "full"
            else [STATE_VARIABLE]
        )
        expected = _release()
        query = [("variables", variable) for variable in variables]
        query.extend(
            [
                ("period", str(expected["data_year"])),
                ("release", expected["release_id"]),
            ]
        )

        def validate_calculation_body(body: dict[str, Any]) -> None:
            validate_calculation(
                body,
                args.source_commit,
                variables,
                require_scope_switch=args.check == "full",
            )

        if args.check == "full":
            _run_full_check(
                args.url,
                query,
                headers,
                validate_calculation_body,
                lambda body: validate_metadata(body, args.source_commit),
            )
        else:
            _request_and_validate(
                args.url, query, headers, validate_calculation_body, attempts=6
            )
    print(f"Validated {args.check} response from {args.url}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
