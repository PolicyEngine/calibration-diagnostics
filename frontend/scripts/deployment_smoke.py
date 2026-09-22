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
) -> dict[str, Any]:
    target = f"{url}?{urlencode(query)}"
    last_error: Exception | None = None
    for attempt in range(attempts):
        try:
            request = Request(
                target,
                headers={"Cache-Control": "no-cache", **headers},
            )
            with urlopen(request, timeout=790) as response:
                if response.status != 200:
                    raise ValueError(f"Deployment returned HTTP {response.status}.")
                content_type = response.headers.get("Content-Type", "")
                if "application/json" not in content_type:
                    raise ValueError("Deployment did not return JSON.")
                return _record(json.load(response), "response")
        except HTTPError as exc:
            detail = exc.read(1_000).decode("utf-8", errors="replace")
            last_error = RuntimeError(f"Deployment returned HTTP {exc.code}: {detail}")
        except (URLError, TimeoutError, ValueError, json.JSONDecodeError) as exc:
            last_error = exc
        if attempt + 1 < attempts:
            time.sleep(5 * (attempt + 1))
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
        _request_and_validate(
            args.url,
            query,
            headers,
            lambda body: validate_calculation(
                body,
                args.source_commit,
                variables,
                require_scope_switch=args.check == "full",
            ),
            attempts=1 if args.check == "full" else 6,
        )
    print(f"Validated {args.check} response from {args.url}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
