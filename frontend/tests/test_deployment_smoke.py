"""Deployment checks reject incorrect source, model, data, and scope."""

from __future__ import annotations

import copy
import http.client
import http.server
import importlib
import io
import json
import re
import socket
import ssl
import sys
import threading
import types
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
        self.client_addresses: list[tuple[str, int]] = []
        self.bypass_headers: list[str | None] = []
        self.released = threading.Event()
        backend = self

        class ScriptedHandler(http.server.BaseHTTPRequestHandler):
            def do_GET(self):
                query = parse_qs(urlsplit(self.path).query)
                backend.request_kinds.append(
                    "metadata" if query.get("metadata") == ["1"] else "full"
                )
                backend.client_addresses.append(self.client_address)
                backend.bypass_headers.append(
                    self.headers.get("x-vercel-protection-bypass")
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


def _run_check(monkeypatch, deployment, backend, check="full", extra_arguments=()):
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
            *extra_arguments,
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


# A Modal preemption. In deploy run 42093437237 Modal preempted the container
# 306 s into the full check and logged that it would run the function again with
# the same input. The backend's response was an HTTP 500 without a JSON body, so
# the route answered with this reply.

NON_JSON_BACKEND_DETAIL = "The calculation backend did not return JSON."
NON_JSON_BACKEND_REPLY = JsonReply(502, {"detail": NON_JSON_BACKEND_DETAIL})
VARIABLE_BACKEND_SOURCE = (
    Path(__file__).resolve().parents[1] / "lib" / "api" / "variable-backend.ts"
)


def _full_check_failure(monkeypatch, deployment, backend):
    """Run the full check; return the error it raised, or None if it passed."""
    try:
        _run_check(monkeypatch, deployment, backend)
    except RuntimeError as failure:
        return failure
    return None


def test_the_route_answers_502_with_this_detail_when_the_backend_is_not_json():
    route_source = VARIABLE_BACKEND_SOURCE.read_text()

    assert re.search(
        r"detail:\s*"
        + re.escape(json.dumps(NON_JSON_BACKEND_DETAIL))
        + r"\s*\},\s*502",
        route_source,
    )


def test_full_check_retries_once_after_the_route_reports_a_non_json_backend_response(
    monkeypatch, start_backend
):
    deployment = _module(monkeypatch)
    _skip_pauses(monkeypatch, deployment)
    backend = start_backend(
        NON_JSON_BACKEND_REPLY,
        JsonReply(200, _metadata_body()),
        JsonReply(200, _calculation_body()),
    )

    failure = _full_check_failure(monkeypatch, deployment, backend)

    # The metadata request waits behind Modal's rerun of the preempted input.
    assert backend.request_kinds == ["full", "metadata", "full"]
    assert failure is None


def test_full_check_keeps_waiting_after_a_non_json_backend_response_while_probes_close(
    monkeypatch, start_backend
):
    deployment = _module(monkeypatch)
    _skip_pauses(monkeypatch, deployment)
    backend = start_backend(
        NON_JSON_BACKEND_REPLY,
        CLOSE_WITHOUT_RESPONSE,
        JsonReply(200, _metadata_body()),
        JsonReply(200, _warm_container_retry_body()),
    )

    failure = _full_check_failure(monkeypatch, deployment, backend)

    assert backend.request_kinds == ["full", "metadata", "metadata", "full"]
    assert failure is None


@pytest.mark.parametrize(
    ("first_failure", "retry_failure", "message"),
    [
        (NON_JSON_BACKEND_REPLY, NON_JSON_BACKEND_REPLY, "did not return JSON"),
        (NON_JSON_BACKEND_REPLY, CLOSE_WITHOUT_RESPONSE, "Remote end closed"),
        (CLOSE_WITHOUT_RESPONSE, NON_JSON_BACKEND_REPLY, "did not return JSON"),
    ],
    ids=["non-json-twice", "non-json-then-closed", "closed-then-non-json"],
)
def test_full_check_retries_at_most_once_after_a_non_json_backend_response(
    monkeypatch, start_backend, first_failure, retry_failure, message
):
    deployment = _module(monkeypatch)
    _skip_pauses(monkeypatch, deployment)
    backend = start_backend(
        first_failure, JsonReply(200, _metadata_body()), retry_failure
    )

    failure = _full_check_failure(monkeypatch, deployment, backend)

    assert backend.request_kinds == ["full", "metadata", "full"]
    assert failure is not None
    assert "The retried full check failed" in str(failure)
    assert message in str(failure)


def test_full_check_validates_the_retry_after_a_non_json_backend_response(
    monkeypatch, start_backend
):
    deployment = _module(monkeypatch)
    _skip_pauses(monkeypatch, deployment)
    retry_body = _calculation_body()
    retry_body["execution"]["simulation_cache_hits"]["national"] = True
    backend = start_backend(
        NON_JSON_BACKEND_REPLY,
        JsonReply(200, _metadata_body()),
        JsonReply(200, retry_body),
    )

    failure = _full_check_failure(monkeypatch, deployment, backend)

    assert backend.request_kinds == ["full", "metadata", "full"]
    assert failure is not None
    assert "construct both scopes" in str(failure)


@pytest.mark.parametrize(
    "error_reply",
    [
        JsonReply(504, {"detail": "Variable calculation timed out."}),
        JsonReply(502, {"detail": "The calculation backend request failed."}),
        JsonReply(500, {"detail": NON_JSON_BACKEND_DETAIL}),
    ],
    ids=["route-timeout", "backend-request-failed", "same-detail-other-status"],
)
def test_full_check_does_not_retry_other_http_errors(
    monkeypatch, start_backend, error_reply
):
    deployment = _module(monkeypatch)
    _skip_pauses(monkeypatch, deployment)
    backend = start_backend(error_reply)

    with pytest.raises(RuntimeError, match=f"HTTP {error_reply.status_code}"):
        _run_check(monkeypatch, deployment, backend)
    assert backend.request_kinds == ["full"]


def test_full_check_fails_at_once_when_the_probe_after_a_non_json_response_fails(
    monkeypatch, start_backend
):
    deployment = _module(monkeypatch)
    _skip_pauses(monkeypatch, deployment)
    backend = start_backend(
        NON_JSON_BACKEND_REPLY,
        JsonReply(504, {"detail": "Variable calculation timed out."}),
    )

    failure = _full_check_failure(monkeypatch, deployment, backend)

    assert backend.request_kinds == ["full", "metadata"]
    assert failure is not None
    assert "HTTP 504" in str(failure)


# Seconds into the full check at which Modal preempted the container in deploy
# run 42093437237.
OBSERVED_PREEMPTION_SECONDS = 306


class SimulatedClock:
    """A monotonic clock that moves only when the test advances it."""

    def __init__(self):
        self.seconds = 0.0

    def __call__(self):
        return self.seconds


def test_the_metadata_request_after_a_preemption_gets_the_full_request_timeout(
    monkeypatch, start_backend
):
    deployment = _module(monkeypatch)
    clock = SimulatedClock()
    monkeypatch.setattr(
        deployment,
        "time",
        types.SimpleNamespace(monotonic=clock, sleep=lambda seconds: None),
    )
    open_request = deployment.urlopen
    request_timeouts = []

    def open_request_and_advance_the_clock(request, timeout):
        request_timeouts.append(timeout)
        try:
            return open_request(request, timeout=timeout)
        finally:
            if len(request_timeouts) == 1:
                clock.seconds += OBSERVED_PREEMPTION_SECONDS

    monkeypatch.setattr(deployment, "urlopen", open_request_and_advance_the_clock)
    backend = start_backend(
        NON_JSON_BACKEND_REPLY,
        JsonReply(200, _metadata_body()),
        JsonReply(200, _calculation_body()),
    )

    failure = _full_check_failure(monkeypatch, deployment, backend)

    assert backend.request_kinds == ["full", "metadata", "full"]
    assert failure is None
    # Modal runs the preempted input again, and the metadata request waits
    # behind it. With the full timeout, that request ends with the route's own
    # answer, which comes within 780 s, instead of timing out first.
    assert request_timeouts == [deployment.REQUEST_TIMEOUT_SECONDS] * 3


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


def _certificate_verification_failure():
    return URLError(
        ssl.SSLCertVerificationError(
            1, "[SSL: CERTIFICATE_VERIFY_FAILED] certificate verify failed"
        )
    )


@pytest.mark.parametrize(
    "setup_failure",
    [
        _certificate_verification_failure(),
        URLError(socket.gaierror(8, "nodename nor servname provided, or not known")),
        URLError("no host given"),
    ],
    ids=["tls-certificate", "dns-lookup", "no-host"],
)
def test_request_does_not_report_a_tls_dns_or_url_error_as_a_connection_failure(
    monkeypatch, setup_failure
):
    deployment = _module(monkeypatch)

    def fail_before_connecting(request, timeout):
        raise setup_failure

    monkeypatch.setattr(deployment, "urlopen", fail_before_connecting)

    with pytest.raises(RuntimeError) as raised:
        deployment._request_json(
            "https://example.test/api", [("metadata", "1")], {}, attempts=1
        )
    # No connection was made, so no calculation is running to wait for.
    assert type(raised.value) is RuntimeError


def test_request_reports_an_aborted_connection_as_a_connection_failure(monkeypatch):
    deployment = _module(monkeypatch)

    def abort_before_any_response(request, timeout):
        raise ConnectionAbortedError(53, "Software caused connection abort")

    monkeypatch.setattr(deployment, "urlopen", abort_before_any_response)

    with pytest.raises(deployment.ConnectionFailedError):
        deployment._request_json(
            "https://example.test/api", [("metadata", "1")], {}, attempts=1
        )


@dataclass(frozen=True)
class UnreachableBackend:
    url: str = (
        "https://staged.example.test/calibration/dashboard/api/microcosm_variable"
    )


def test_full_check_fails_at_once_when_the_first_request_fails_tls_verification(
    monkeypatch,
):
    deployment = _module(monkeypatch)
    # Real pauses, and a short wait limit, keep a regression from looping.
    monkeypatch.setattr(deployment, "BACKEND_FREE_DEADLINE_SECONDS", 0.2)
    request_kinds = []

    def fail_tls_verification(request, timeout):
        query = parse_qs(urlsplit(request.full_url).query)
        request_kinds.append("metadata" if query.get("metadata") == ["1"] else "full")
        raise _certificate_verification_failure()

    monkeypatch.setattr(deployment, "urlopen", fail_tls_verification)

    with pytest.raises(RuntimeError, match="CERTIFICATE_VERIFY_FAILED"):
        _run_check(monkeypatch, deployment, UnreachableBackend())
    assert request_kinds == ["full"]


# TCP keepalive on every connection. In deploy run 42093437237 the full check's
# connection carried no data while the calculation ran, and it was closed about
# 266 s in, twice, while the route and the backend both completed.

EXPECTED_TCP_KEEPALIVE_TIMINGS = {
    "TCP_KEEPIDLE": 60,
    "TCP_KEEPINTVL": 30,
    "TCP_KEEPCNT": 5,
}
TEST_BYPASS_VALUE = "test-bypass-value"


def _expected_keepalive_settings():
    """SO_KEEPALIVE on, and each timing this platform defines.

    Linux defines all three timings; macOS has no TCP_KEEPIDLE.
    """
    return {
        "SO_KEEPALIVE": True,
        **{
            option_name: option_value
            for option_name, option_value in EXPECTED_TCP_KEEPALIVE_TIMINGS.items()
            if hasattr(socket, option_name)
        },
    }


def _keepalive_settings(connection):
    # Linux reports SO_KEEPALIVE as 1 and macOS as the option's flag value.
    settings = {
        "SO_KEEPALIVE": connection.getsockopt(socket.SOL_SOCKET, socket.SO_KEEPALIVE)
        != 0
    }
    for option_name in EXPECTED_TCP_KEEPALIVE_TIMINGS:
        if hasattr(socket, option_name):
            settings[option_name] = connection.getsockopt(
                socket.IPPROTO_TCP, getattr(socket, option_name)
            )
    return settings


@pytest.fixture
def opened_connections(monkeypatch):
    """Duplicates of the client sockets that requests open, in order.

    http.client opens each connection with socket.create_connection. A duplicate
    refers to the same kernel socket, so it reports the options set on that
    connection after the request has closed its own handle, and after TLS has
    taken the handle over.
    """
    duplicates = []
    create_connection = socket.create_connection

    def create_and_record_connection(*connection_arguments, **connection_options):
        connection = create_connection(*connection_arguments, **connection_options)
        duplicates.append(connection.dup())
        return connection

    monkeypatch.setattr(socket, "create_connection", create_and_record_connection)
    yield duplicates
    for duplicate in duplicates:
        duplicate.close()


@pytest.fixture
def port_that_closes_its_first_connection():
    """A port on 127.0.0.1 that accepts one connection and closes it unanswered."""
    listener = socket.create_server(("127.0.0.1", 0))
    listener.settimeout(10)

    def close_first_connection():
        try:
            connection, _ = listener.accept()
        except OSError:
            return
        connection.close()

    closer = threading.Thread(target=close_first_connection, daemon=True)
    closer.start()
    yield listener.getsockname()[1]
    closer.join(timeout=10)
    listener.close()


def test_every_full_check_request_uses_a_tcp_keepalive_connection(
    monkeypatch, start_backend, opened_connections
):
    deployment = _module(monkeypatch)
    _skip_pauses(monkeypatch, deployment)
    backend = start_backend(
        CLOSE_WITHOUT_RESPONSE,
        JsonReply(200, _metadata_body()),
        JsonReply(200, _warm_container_retry_body()),
    )

    assert (
        _run_check(
            monkeypatch,
            deployment,
            backend,
            extra_arguments=["--vercel-bypass-secret", TEST_BYPASS_VALUE],
        )
        == 0
    )
    assert backend.request_kinds == ["full", "metadata", "full"]
    # Each recorded socket is the client end of a request the backend received.
    assert [
        connection.getsockname() for connection in opened_connections
    ] == backend.client_addresses
    assert backend.bypass_headers == [TEST_BYPASS_VALUE] * 3
    assert [connection.gettimeout() for connection in opened_connections] == [
        deployment.REQUEST_TIMEOUT_SECONDS
    ] * 3
    assert [_keepalive_settings(connection) for connection in opened_connections] == [
        _expected_keepalive_settings()
    ] * 3


def test_an_https_request_sets_tcp_keepalive_before_the_tls_handshake(
    monkeypatch, opened_connections, port_that_closes_its_first_connection
):
    deployment = _module(monkeypatch)
    port = port_that_closes_its_first_connection

    # The port closes the connection instead of answering the TLS handshake,
    # so the request fails after its TCP connection was made.
    with pytest.raises(RuntimeError):
        deployment._request_json(
            f"https://127.0.0.1:{port}/calibration/dashboard/api/microcosm_variable",
            [("metadata", "1")],
            {},
            attempts=1,
            timeout=10,
        )
    assert len(opened_connections) == 1
    assert _keepalive_settings(opened_connections[0]) == _expected_keepalive_settings()
