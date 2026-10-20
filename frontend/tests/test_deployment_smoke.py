"""Deployment checks reject incorrect source, model, data, and scope."""

from __future__ import annotations

import copy
import http.client
import http.server
import importlib
import io
import json
import sys
import threading
from dataclasses import dataclass
from email.message import Message
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.parse import parse_qs, urlsplit

import pytest


def _module(monkeypatch):
    monkeypatch.syspath_prepend(str(Path(__file__).resolve().parents[1]))
    return importlib.import_module("scripts.deployment_smoke")


def _release():
    path = Path(__file__).resolve().parents[1] / "scripts" / "hosted_release.json"
    return json.loads(path.read_text())


def _runtime(release, source_commit="abc123"):
    return {
        "source_commit": source_commit,
        "packages": release["packages"],
    }


def _metadata_body():
    release = _release()
    return {
        "runtime": _runtime(release),
        "data_configuration": release,
        "environment_configuration": {
            "repo": release["repo"],
            "revision": release["hf_revision"],
            "filename": release["filename"],
        },
    }


def _calculation_body():
    release = _release()
    identity = {**release, "verified": True}
    return {
        "runtime": _runtime(release),
        "data_identity": identity,
        "period": str(release["data_year"]),
        "release_id": release["release_id"],
        "variables": [
            {
                "variable": "spm_unit_spm_threshold",
                "weighted_sum": 123.5,
                "state_filter": None,
            },
            {
                "variable": "ca_income_tax",
                "weighted_sum": 45.0,
                "state_filter": "CA",
            },
        ],
        "execution": {
            "simulation_cache_hits": {"national": False, "CA": False},
            "simulation_cache_evictions": ["national"],
        },
    }


def test_metadata_accepts_exact_deployment_identity(monkeypatch):
    deployment = _module(monkeypatch)
    deployment.validate_metadata(_metadata_body(), "abc123")


def test_metadata_rejects_unreviewed_environment(monkeypatch):
    deployment = _module(monkeypatch)
    body = _metadata_body()
    body["environment_configuration"]["revision"] = "main"

    with pytest.raises(ValueError, match="unreviewed dataset"):
        deployment.validate_metadata(body, "abc123")


def test_calculation_accepts_verified_national_to_state_switch(monkeypatch):
    deployment = _module(monkeypatch)
    deployment.validate_calculation(
        _calculation_body(),
        "abc123",
        ["spm_unit_spm_threshold", "ca_income_tax"],
        require_scope_switch=True,
    )


@pytest.mark.parametrize(
    ("mutate", "message"),
    [
        (
            lambda body: body["runtime"].update(source_commit="wrong"),
            "source commit",
        ),
        (
            lambda body: body["data_identity"].update(verified=False),
            "verified input bytes",
        ),
        (
            lambda body: body["variables"][1].update(state_filter="NY"),
            "California input",
        ),
        (
            lambda body: body["execution"]["simulation_cache_hits"].update(
                national=True
            ),
            "construct both scopes",
        ),
    ],
)
def test_calculation_rejects_mismatched_deployment(monkeypatch, mutate, message):
    deployment = _module(monkeypatch)
    body = copy.deepcopy(_calculation_body())
    mutate(body)

    with pytest.raises(ValueError, match=message):
        deployment.validate_calculation(
            body,
            "abc123",
            ["spm_unit_spm_threshold", "ca_income_tax"],
            require_scope_switch=True,
        )


def test_validated_request_retries_a_stale_promoted_alias(monkeypatch):
    deployment = _module(monkeypatch)
    responses = iter([{"commit": "old"}, {"commit": "new"}])
    monkeypatch.setattr(
        deployment,
        "_request_json",
        lambda url, query, headers, attempts: next(responses),
    )
    monkeypatch.setattr(deployment.time, "sleep", lambda seconds: None)
    observed = []

    def validate(body):
        observed.append(body["commit"])
        if body["commit"] != "new":
            raise ValueError("stale alias")

    deployment._request_and_validate(
        "https://example.test/api",
        [("metadata", "1")],
        {},
        validate,
        attempts=2,
    )

    assert observed == ["old", "new"]


# The full check against a loopback server. Run 39472402849 failed because the
# connection to the staged deployment closed before any response arrived while
# the backend went on to finish the calculation.

CLOSE_WITHOUT_RESPONSE = "close the connection before sending a status line"
HOLD_UNTIL_STOPPED = "keep the connection silent until the test ends"


@dataclass(frozen=True)
class JsonReply:
    status_code: int
    body: dict


class _QuietThreadingServer(http.server.ThreadingHTTPServer):
    daemon_threads = True
    block_on_close = False

    def handle_error(self, request, client_address):
        # A held request ends after its client has gone; nothing to report.
        pass


class ScriptedBackend:
    """Answer requests on 127.0.0.1 from a fixed sequence of replies, in order."""

    def __init__(self, replies):
        self.pending_replies = list(replies)
        self.request_kinds: list[str] = []
        self.released = threading.Event()
        backend = self

        class ScriptedHandler(http.server.BaseHTTPRequestHandler):
            def do_GET(self):
                query = parse_qs(urlsplit(self.path).query)
                backend.request_kinds.append(
                    "metadata" if query.get("metadata") == ["1"] else "full"
                )
                reply = (
                    backend.pending_replies.pop(0)
                    if backend.pending_replies
                    else JsonReply(500, {"detail": "The test did not expect this."})
                )
                if reply == HOLD_UNTIL_STOPPED:
                    backend.released.wait()
                    reply = CLOSE_WITHOUT_RESPONSE
                if reply == CLOSE_WITHOUT_RESPONSE:
                    self.close_connection = True
                    return
                payload = json.dumps(reply.body).encode()
                self.send_response(reply.status_code)
                self.send_header("Content-Type", "application/json")
                self.send_header("Content-Length", str(len(payload)))
                self.end_headers()
                self.wfile.write(payload)

            def log_message(self, *log_arguments):
                pass

        self.server = _QuietThreadingServer(("127.0.0.1", 0), ScriptedHandler)
        port = self.server.server_address[1]
        self.url = (
            f"http://127.0.0.1:{port}/calibration/dashboard/api/microcosm_variable"
        )
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()

    def stop(self):
        self.released.set()
        self.server.shutdown()
        self.server.server_close()


@pytest.fixture
def start_backend():
    started_backends = []

    def start(*replies):
        backend = ScriptedBackend(replies)
        started_backends.append(backend)
        return backend

    yield start
    for backend in started_backends:
        backend.stop()


def _skip_pauses(monkeypatch, deployment):
    monkeypatch.setattr(deployment.time, "sleep", lambda seconds: None)


def _run_check(monkeypatch, deployment, backend, check="full"):
    monkeypatch.setattr(
        sys,
        "argv",
        [
            "deployment_smoke.py",
            "--url",
            backend.url,
            "--source-commit",
            "abc123",
            "--check",
            check,
        ],
    )
    return deployment.main()


def _warm_container_retry_body():
    """A full calculation in a container whose cache still holds California.

    The abandoned request built national and then California. The cache keeps
    one simulation, so a retry releases California to build national, then
    releases national to build California.
    """
    body = _calculation_body()
    body["execution"]["simulation_cache_evictions"] = ["CA", "national"]
    return body


def test_full_check_retries_once_after_the_connection_closes_without_a_response(
    monkeypatch, start_backend
):
    deployment = _module(monkeypatch)
    _skip_pauses(monkeypatch, deployment)
    backend = start_backend(
        CLOSE_WITHOUT_RESPONSE,
        JsonReply(200, _metadata_body()),
        JsonReply(200, _warm_container_retry_body()),
    )

    assert _run_check(monkeypatch, deployment, backend) == 0
    assert backend.request_kinds == ["full", "metadata", "full"]


def test_full_check_keeps_waiting_while_backend_probe_connections_close(
    monkeypatch, start_backend
):
    deployment = _module(monkeypatch)
    _skip_pauses(monkeypatch, deployment)
    backend = start_backend(
        CLOSE_WITHOUT_RESPONSE,
        CLOSE_WITHOUT_RESPONSE,
        JsonReply(200, _metadata_body()),
        JsonReply(200, _warm_container_retry_body()),
    )

    assert _run_check(monkeypatch, deployment, backend) == 0
    assert backend.request_kinds == ["full", "metadata", "metadata", "full"]


@pytest.mark.parametrize(
    ("change_cache_state", "message"),
    [
        (
            lambda execution: execution.update(
                simulation_cache_hits={"national": True, "CA": False},
                simulation_cache_evictions=["national"],
            ),
            "construct both scopes",
        ),
        (
            lambda execution: execution.update(simulation_cache_evictions=["CA"]),
            "release the national scope",
        ),
    ],
    ids=["national-simulation-reused", "national-simulation-kept"],
)
def test_full_check_rejects_a_retry_that_does_not_prove_both_scope_builds(
    monkeypatch, start_backend, change_cache_state, message
):
    deployment = _module(monkeypatch)
    _skip_pauses(monkeypatch, deployment)
    retry_body = _warm_container_retry_body()
    change_cache_state(retry_body["execution"])
    backend = start_backend(
        CLOSE_WITHOUT_RESPONSE,
        JsonReply(200, _metadata_body()),
        JsonReply(200, retry_body),
    )

    with pytest.raises(RuntimeError, match=message):
        _run_check(monkeypatch, deployment, backend)
    assert backend.request_kinds == ["full", "metadata", "full"]


def test_full_check_fails_when_the_retried_connection_also_closes(
    monkeypatch, start_backend
):
    deployment = _module(monkeypatch)
    _skip_pauses(monkeypatch, deployment)
    backend = start_backend(
        CLOSE_WITHOUT_RESPONSE,
        JsonReply(200, _metadata_body()),
        CLOSE_WITHOUT_RESPONSE,
    )

    with pytest.raises(RuntimeError, match="Remote end closed connection"):
        _run_check(monkeypatch, deployment, backend)
    assert backend.request_kinds == ["full", "metadata", "full"]


def test_full_check_fails_at_once_when_the_backend_probe_reports_another_build(
    monkeypatch, start_backend
):
    deployment = _module(monkeypatch)
    _skip_pauses(monkeypatch, deployment)
    probe_body = _metadata_body()
    probe_body["runtime"]["source_commit"] = "another-commit"
    backend = start_backend(CLOSE_WITHOUT_RESPONSE, JsonReply(200, probe_body))

    with pytest.raises(RuntimeError, match="source commit"):
        _run_check(monkeypatch, deployment, backend)
    assert backend.request_kinds == ["full", "metadata"]


def test_full_check_stops_waiting_when_the_backend_stays_busy_past_the_deadline(
    monkeypatch, start_backend
):
    deployment = _module(monkeypatch)
    _skip_pauses(monkeypatch, deployment)
    monkeypatch.setattr(deployment, "BACKEND_FREE_DEADLINE_SECONDS", 0.5)
    backend = start_backend(CLOSE_WITHOUT_RESPONSE, HOLD_UNTIL_STOPPED)

    with pytest.raises(RuntimeError, match="still busy"):
        _run_check(monkeypatch, deployment, backend)
    assert backend.request_kinds == ["full", "metadata"]


def test_full_check_does_not_retry_a_response_that_fails_validation(
    monkeypatch, start_backend
):
    deployment = _module(monkeypatch)
    _skip_pauses(monkeypatch, deployment)
    body = _calculation_body()
    body["execution"]["simulation_cache_hits"]["national"] = True
    backend = start_backend(JsonReply(200, body))

    with pytest.raises(RuntimeError, match="construct both scopes"):
        _run_check(monkeypatch, deployment, backend)
    assert backend.request_kinds == ["full"]


def test_full_check_does_not_retry_an_http_error_with_a_body(
    monkeypatch, start_backend
):
    deployment = _module(monkeypatch)
    _skip_pauses(monkeypatch, deployment)
    backend = start_backend(JsonReply(502, {"detail": "Variable calculation failed."}))

    with pytest.raises(RuntimeError, match="HTTP 502"):
        _run_check(monkeypatch, deployment, backend)
    assert backend.request_kinds == ["full"]


def test_metadata_check_retries_a_connection_closed_without_a_response(
    monkeypatch, start_backend
):
    deployment = _module(monkeypatch)
    _skip_pauses(monkeypatch, deployment)
    backend = start_backend(CLOSE_WITHOUT_RESPONSE, JsonReply(200, _metadata_body()))

    assert _run_check(monkeypatch, deployment, backend, check="metadata") == 0
    assert backend.request_kinds == ["metadata", "metadata"]


@pytest.mark.parametrize(
    "connection_error",
    [
        http.client.RemoteDisconnected("Remote end closed connection without response"),
        ConnectionResetError(54, "Connection reset by peer"),
        URLError(ConnectionRefusedError(61, "Connection refused")),
        TimeoutError("timed out"),
    ],
    ids=["remote-disconnected", "connection-reset", "url-error", "timeout"],
)
def test_request_reports_a_failure_before_any_response_as_a_connection_failure(
    monkeypatch, connection_error
):
    deployment = _module(monkeypatch)

    def fail_before_any_response(request, timeout):
        raise connection_error

    monkeypatch.setattr(deployment, "urlopen", fail_before_any_response)

    with pytest.raises(deployment.ConnectionFailedError):
        deployment._request_json(
            "https://example.test/api", [("metadata", "1")], {}, attempts=1
        )


def test_request_does_not_report_an_http_error_as_a_connection_failure(monkeypatch):
    deployment = _module(monkeypatch)

    def answer_with_bad_gateway(request, timeout):
        raise HTTPError(
            request.full_url,
            502,
            "Bad Gateway",
            Message(),
            io.BytesIO(b'{"detail": "Variable calculation failed."}'),
        )

    monkeypatch.setattr(deployment, "urlopen", answer_with_bad_gateway)

    with pytest.raises(RuntimeError, match="HTTP 502") as raised:
        deployment._request_json(
            "https://example.test/api", [("metadata", "1")], {}, attempts=1
        )
    # An HTTP response arrived, so this must not be a retried connection failure.
    assert type(raised.value) is RuntimeError
