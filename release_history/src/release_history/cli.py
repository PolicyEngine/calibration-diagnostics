"""`release-history`: validate a spec, list a series, name a panel, resolve references, measure,
export.

stdout carries only ids, statuses and timings, never a figure: GitHub Actions
logs are public and the UK data are licensed. During a measurement, library
output goes to a log file that is never printed or uploaded.
"""

from __future__ import annotations

import argparse
import contextlib
import datetime as dt
import importlib
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
import time
from collections.abc import Iterator
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from release_history import ATTEMPT_FORMAT_VERSION, LABELS_FORMAT_VERSION, PRODUCER_VERSION
from release_history.canonical import document_bytes, file_sha256, write_atomic
from release_history.document import measured_point, measurement_id, refused_document
from release_history.engine import EngineMismatchError, engine_identity, environment, panel_document
from release_history.export import export_csv
from release_history.local_store import (
    country_dir,
    panel_dir,
    write_immutable,
    write_once,
    write_replace,
)
from release_history.measure import Measurement, MeasurementError, error_record, measure
from release_history.references import (
    ReferencesError,
    load_lock,
    load_references,
    lock_is_current,
    resolve,
    validate_references,
)
from release_history.reforms import UnknownParameterError, baseline_value, parameter_node
from release_history.releases import (
    HubClient,
    LocalBuildFolder,
    OpenedRelease,
    Point,
    ReleaseRefusedError,
    TransientError,
    download_verified,
    open_release,
    point_provenance,
    release_directory_for,
)
from release_history.series import SeriesError, build_series
from release_history.simulate import PolicyEngineBackend
from release_history.spec import Spec, countries_dir, load_spec

EXIT_TRANSIENT = 75
# A failure the run caused (not the file): nothing immutable is written, and a
# later attempt may succeed.
EXIT_RUN_FAILED = 3
# The only refusals a file itself causes: stored, so the file shows as a gap.
FILE_REFUSALS = frozenset({"disclosure_source_ids_missing", "disclosure_source_ids_misaligned"})
_DIGEST = re.compile(r"^[0-9a-f]{64}$")


def _now() -> str:
    return dt.datetime.now(dt.UTC).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def _emit(payload: dict[str, Any]) -> None:
    print(json.dumps(payload, sort_keys=True), flush=True)


def _producer_commit() -> str | None:
    commit = os.environ.get("GITHUB_SHA")
    if commit:
        return commit
    try:
        return (
            subprocess.run(
                ["git", "rev-parse", "HEAD"],
                capture_output=True,
                text=True,
                check=True,
                cwd=Path(__file__).resolve().parent,
            ).stdout.strip()
            or None
        )
    except (OSError, subprocess.CalledProcessError):
        return None


@contextlib.contextmanager
def quiet(log_path: Path) -> Iterator[None]:
    """Send this process's stdout and stderr to a private log file."""
    log_path.parent.mkdir(parents=True, exist_ok=True)
    sys.stdout.flush()
    sys.stderr.flush()
    saved = os.dup(1), os.dup(2)
    with log_path.open("ab") as log:
        os.dup2(log.fileno(), 1)
        os.dup2(log.fileno(), 2)
        try:
            yield
        finally:
            sys.stdout.flush()
            sys.stderr.flush()
            os.dup2(saved[0], 1)
            os.dup2(saved[1], 2)
            os.close(saved[0])
            os.close(saved[1])


def _lockfile(country: str) -> Path:
    return countries_dir() / country / "uv.lock"


def _model_system(spec: Spec) -> Any:
    package = importlib.import_module(spec.model_package.replace("-", "_"))
    return package.CountryTaxBenefitSystem()


def validate_spec_against_model(spec: Spec, system: Any) -> list[str]:
    """Every name the spec uses exists in the reference model; no data needed."""
    problems: list[str] = []
    variables = system.variables
    entities = {entity.key for entity in system.entities}

    def need(name: str | None, where: str) -> None:
        if name is not None and name not in variables:
            problems.append(f"{where}: variable '{name}' is not in {spec.model_package}")

    need(spec.household_id_variable, "household_entity")
    used_entities = {spec.household_entity, "person"}
    for item in spec.baseline:
        for variable in item.variables:
            need(variable, f"baseline.{item.id}")
            if variable in variables:
                used_entities.add(variables[variable].entity.key)
        need(item.where, f"baseline.{item.id}.where")
        if item.entity:
            used_entities.add(item.entity)
    for reform in spec.reforms:
        for variable in reform.targets:
            need(variable, f"reforms.{reform.id}.targets")
            if variable in variables:
                used_entities.add(variables[variable].entity.key)
        for path in [*reform.add, *reform.scale]:
            try:
                for period in spec.periods:
                    baseline_value(system.parameters, path, period)
            except (UnknownParameterError, TypeError) as error:
                problems.append(f"reforms.{reform.id}: {error}")
        for path in reform.parameters:
            try:
                parameter_node(system.parameters, path)
            except UnknownParameterError as error:
                problems.append(f"reforms.{reform.id}: unknown parameter {error}")
    for path in spec.behaviour:
        try:
            parameter_node(system.parameters, path)
        except UnknownParameterError as error:
            problems.append(f"variables.behaviour: unknown parameter {error}")
    for name in (*spec.budget_plus, *spec.budget_minus):
        need(name, "variables.budget")
    need(spec.household_net_income, "variables.household_net_income")
    need(spec.income_decile, "variables.income_decile")
    for measure_id, variable in spec.poverty.items():
        need(variable, f"variables.poverty.{measure_id}")
    for group, variable in spec.groups.items():
        need(variable, f"variables.groups.{group}")
    for entity in sorted(used_entities):
        if entity not in entities:
            problems.append(f"entity '{entity}' is not in {spec.model_package}")
        else:
            need(spec.weight_variable(entity), f"weights.{entity}")
    return problems


def cmd_validate_spec(args: argparse.Namespace) -> int:
    spec = load_spec(args.country)
    references = load_references(args.country)
    problems = [f"references: {problem}" for problem in validate_references(spec, references)]
    lock = load_lock(args.country)
    if lock is None:
        problems.append("references.lock.json is missing: run resolve-references")
    elif not lock_is_current(references, lock):
        problems.append("references.lock.json is stale: run resolve-references")
    if not args.no_model:
        problems += validate_spec_against_model(spec, _model_system(spec))
    _emit(
        {
            "command": "validate-spec",
            "country": spec.country,
            "ok": not problems,
            "problems": problems,
            "spec_sha256": spec.digest,
            "baseline_items": len(spec.baseline),
            "reforms": len(spec.reforms),
        }
    )
    return 0 if not problems else 1


def labels_document(spec: Spec) -> dict[str, Any]:
    """What the page shows for each reform: replaceable, so a corrected label needs no panel."""
    return {
        "format_version": LABELS_FORMAT_VERSION,
        "kind": "release_history.labels",
        "country": spec.country,
        "reforms": {
            reform.id: {"label": reform.label, "source": reform.source} for reform in spec.reforms
        },
    }


def cmd_identity(args: argparse.Namespace) -> int:
    spec = load_spec(args.country)
    engine = engine_identity(spec)
    panel = panel_document(spec, engine)
    lock = load_lock(spec.country)
    if args.out:
        root = Path(args.out)
        write_once(panel_dir(root, spec.country, panel["panel_id"]) / "panel.json", panel)
        country = country_dir(root, spec.country)
        write_replace(country / "labels.json", labels_document(spec))
        if lock is not None:
            write_replace(country / "references.json", lock)
    _emit(
        {
            "command": "identity",
            "country": spec.country,
            "panel_id": panel["panel_id"],
            "release_repo": spec.release_repo,
            "series": {"releases": list(spec.series_releases), "since": spec.series_since},
            "spec_sha256": spec.digest,
            "engine": {
                "policyengine": engine["policyengine"],
                "model": f"{engine['model']['name']}=={engine['model']['version']}",
                "core": f"{engine['core']['name']}=={engine['core']['version']}",
            },
            "producer_version": PRODUCER_VERSION,
        }
    )
    return 0


def cmd_series(args: argparse.Namespace) -> int:
    """List the country's series from releases.json and write the series record."""
    spec = load_spec(args.country)
    try:
        record = build_series(spec, HubClient(), listed_at=_now(), revision=args.revision)
    except (SeriesError, ReleaseRefusedError) as error:
        _emit(
            {"command": "series", "country": spec.country, "status": "error", "detail": str(error)}
        )
        return 1
    except TransientError as error:
        _emit(
            {
                "command": "series",
                "country": spec.country,
                "status": "transient",
                "class": str(error),
            }
        )
        return EXIT_TRANSIENT
    if args.out:
        write_replace(country_dir(Path(args.out), spec.country) / "series.json", record)
    builds = record["builds"]
    listed = [
        build for build in builds if build["listing_status"] == "ok" and not build["withdrawn"]
    ]
    _emit(
        {
            "command": "series",
            "country": spec.country,
            "record": record["record"]["present"],
            "commit": record["commit"],
            "builds": len(builds),
            "listed": len(listed),
            "files": len({build["digest"] for build in listed}),
            "refused": sorted(
                {build["listing_reason"] for build in builds if build["listing_reason"]}
            ),
        }
    )
    return 0


def cmd_resolve_references(args: argparse.Namespace) -> int:
    spec = load_spec(args.country)
    references = load_references(args.country)
    lock = resolve(
        spec,
        references,
        Path(args.facts) if args.facts else None,
        Path(args.manifest) if args.manifest else None,
        resolved_at=_now(),
        check_digests=not args.no_digest_check,
    )
    path = countries_dir() / spec.country / "references.lock.json"
    write_atomic(path, document_bytes(lock))
    counts: dict[str, int] = {}
    for section in ("baseline", "reforms"):
        for entry in lock[section].values():
            counts[entry["status"]] = counts.get(entry["status"], 0) + 1
    _emit(
        {
            "command": "resolve-references",
            "country": spec.country,
            "lock": str(path),
            "statuses": counts,
        }
    )
    return 0


def dataset_columns(path: Path) -> list[str]:
    """Column names in a dataset file (pandas tables, or h5py groups), never values."""
    names: set[str] = set()
    try:
        import pandas as pd

        with pd.HDFStore(path, "r") as store:
            for key in store.keys():
                try:
                    names.update(
                        str(column) for column in store.select(key, start=0, stop=0).columns
                    )
                except (AttributeError, TypeError, ValueError):
                    continue
        if names:
            return sorted(names)
    except (ImportError, OSError, ValueError):
        pass
    try:
        import h5py

        with h5py.File(path, "r") as handle:
            names.update(handle.keys())
    except (ImportError, OSError):
        pass
    return sorted(names)


def source_ids_for(spec: Spec, path: Path, household_ids: Any) -> Any:
    """Each household's survey source id, aligned with the simulation's households."""
    import numpy as np
    import pandas as pd

    key = f"/{spec.household_entity}"
    id_column = spec.household_id_variable
    with pd.HDFStore(path, "r") as store:
        if key not in store.keys():
            raise ReleaseRefusedError("error", "disclosure_source_ids_missing")
        columns = set(store.select(key, start=0, stop=0).columns)
    chosen = next((column for column in spec.source_id_columns if column in columns), None)
    if chosen is None or id_column not in columns:
        raise ReleaseRefusedError("error", "disclosure_source_ids_missing")
    table = pd.read_hdf(path, key, columns=[id_column, chosen])
    if not np.array_equal(table[id_column].to_numpy(), np.asarray(household_ids)):
        raise ReleaseRefusedError("error", "disclosure_source_ids_misaligned")
    return table[chosen].to_numpy()


def _point_from_args(args: argparse.Namespace, spec: Spec, hub: HubClient) -> Point:
    if args.build_dir:
        # A Microcosm post-build step: the build is not published, so there is no commit.
        return Point(
            build_id=args.build_id,
            release_directory=args.build_id,
            hf_repo=spec.release_repo,
            hf_commit=None,
        )
    if args.point:
        source = Path(args.point).read_text() if Path(args.point).is_file() else args.point
        return Point.from_json(json.loads(source))
    if not args.revision:
        raise SystemExit("measure needs --point or --revision")
    repo = args.repo or spec.release_repo
    commit = hub.resolve_revision(repo, args.revision)
    directory = args.release_directory or release_directory_for(args.revision, spec.series_releases)
    return Point(
        build_id=args.revision, release_directory=directory, hf_repo=repo, hf_commit=commit
    )


class AttemptReport:
    """`<panel>/attempts/<digest>.json`: how the latest attempt at a file ended, when it stored
    nothing. It is written as `interrupted` before each stage (opening the release, the
    download, each simulation), so a run killed mid-way (out of memory, a step timeout) still
    leaves one; rewritten as `failed` on a handled failure; removed once the point or a stored
    gap is written. Replaced at each attempt, never a point: finalize reads it into the
    manifest's state for the file."""

    def __init__(self, folder: Path, country: str, panel_id: str, commit: str | None) -> None:
        self.folder = folder / "attempts"
        self.country = country
        self.panel_id = panel_id
        self.commit = commit
        self.point: Point | None = None
        self.digest: str | None = None

    def bind(self, point: Point, digest: str | None) -> None:
        self.point = point
        if digest and _DIGEST.match(digest):
            self.digest = digest

    @property
    def path(self) -> Path | None:
        return self.folder / f"{self.digest}.json" if self.digest else None

    def write(self, status: str, stage: str, reason: str, error_class: str | None = None) -> None:
        if self.path is None or self.point is None:
            return
        write_replace(
            self.path,
            {
                "format_version": ATTEMPT_FORMAT_VERSION,
                "kind": "release_history.attempt",
                "country": self.country,
                "panel_id": self.panel_id,
                "digest": self.digest,
                "build_id": self.point.build_id,
                "attempt": self.point.attempt,
                "last_attempt": self.point.last_attempt,
                "status": status,
                "stage": stage,
                "reason": reason,
                "error_class": error_class,
                "at": _now(),
                "producer": {"version": PRODUCER_VERSION, "commit": self.commit},
            },
        )

    def started(self, stage: str) -> None:
        self.write("interrupted", stage, "interrupted")

    def clear(self) -> None:
        if self.path is not None:
            self.path.unlink(missing_ok=True)


def _run_failed(
    report: AttemptReport, stage: str, reason: str, point: Point | None, **extra: Any
) -> int:
    """A failure the run caused, not the file: no point is written, only the attempt report,
    and a later attempt may succeed."""
    report.write("failed", stage, reason, extra.get("error_class"))
    _emit(
        {
            "command": "measure",
            "status": "run_failed",
            "stage": stage,
            "reason": reason,
            "build_id": point.build_id if point else None,
            "attempt": point.attempt if point else None,
            **extra,
        }
    )
    return EXIT_RUN_FAILED


class _AttemptFailedError(Exception):
    """A failure the run causes, raised by a step of `measure` and turned into the attempt
    report and the exit code by `cmd_measure`."""

    def __init__(self, stage: str, reason: str, **extra: Any) -> None:
        super().__init__(f"{stage}: {reason}")
        self.stage = stage
        self.reason = reason
        self.extra = extra


@dataclass
class _MeasureRun:
    """What one `measure` command works with: its arguments, the spec and panel, where it
    writes, and the file it is measuring once that is known."""

    args: argparse.Namespace
    spec: Spec
    engine: dict[str, Any]
    panel_id: str
    folder: Path
    env: dict[str, Any]
    producer_commit: str | None
    hub: HubClient | LocalBuildFolder
    report: AttemptReport
    workdir: Path
    log_path: Path
    started: str
    clock: float
    point: Point | None = None
    h5_path: Path | None = None

    def runtime(self) -> dict[str, Any]:
        return {
            "started_at": self.started,
            "finished_at": _now(),
            "seconds": round(time.monotonic() - self.clock, 1),
            "runner": os.environ.get("RUNNER_NAME") or os.environ.get("RUNNER_OS") or "local",
        }

    def failed(self, stage: str, reason: str, **extra: Any) -> int:
        return _run_failed(self.report, stage, reason, self.point, **extra)


def cmd_measure(args: argparse.Namespace) -> int:
    """Measure one file on the country's panel. A result, or a refusal the file causes, is
    stored as its point; a failure the run causes leaves only the file's attempt report."""
    started = _now()
    clock = time.monotonic()
    spec = load_spec(args.country)
    try:
        engine = engine_identity(spec)
    except EngineMismatchError as error:
        _emit({"command": "measure", "status": "engine_mismatch", "detail": str(error)})
        return 1
    root = Path(args.out)
    panel = panel_document(spec, engine)
    folder = panel_dir(root, spec.country, panel["panel_id"])
    write_once(folder / "panel.json", panel)
    env = environment(_lockfile(spec.country))
    producer_commit = _producer_commit()
    if args.build_dir and not args.build_id:
        raise SystemExit("measure --build-dir needs --build-id <release>/<build>")
    run = _MeasureRun(
        args=args,
        spec=spec,
        engine=engine,
        panel_id=panel["panel_id"],
        folder=folder,
        env=env,
        producer_commit=producer_commit,
        hub=LocalBuildFolder(Path(args.build_dir), args.build_id)
        if args.build_dir
        else HubClient(),
        report=AttemptReport(folder, spec.country, panel["panel_id"], producer_commit),
        workdir=Path(args.workdir) if args.workdir else Path(tempfile.mkdtemp(prefix="rh-")),
        log_path=Path(args.log)
        if args.log
        else root / ".logs" / f"{spec.country}-{int(clock)}.log",
        started=started,
        clock=clock,
    )
    try:
        return _measure_point(run)
    except _AttemptFailedError as failure:
        return run.failed(failure.stage, failure.reason, **failure.extra)
    except MeasurementError as failure:
        record = error_record(failure.stage, failure.error)
        return run.failed(failure.stage, f"{failure.stage}_failed", error_class=record["class"])
    except ReleaseRefusedError as refusal:
        return run.failed("open", refusal.reason)
    except TransientError as error:
        run.report.write("failed", "transient", "transient", str(error))
        _emit({"command": "measure", "status": "transient", "class": str(error)})
        return EXIT_TRANSIENT
    except Exception as error:  # noqa: BLE001 - the class name only, never the message
        # An unexpected error's message or traceback could carry a figure into the public
        # log, so only its class is printed.
        return run.failed("unexpected", "unexpected_error", error_class=type(error).__name__)
    finally:
        _clean_up(run)


def _clean_up(run: _MeasureRun) -> None:
    # Never delete a file the run did not download: a --h5 copy or a build folder's own file.
    args = run.args
    if run.h5_path is not None and not args.h5 and not args.keep_h5 and not args.build_dir:
        run.h5_path.unlink(missing_ok=True)
    if not args.workdir:
        shutil.rmtree(run.workdir, ignore_errors=True)


def _measure_point(run: _MeasureRun) -> int:
    """Open the planned file, measure it once, and store what the file itself gives."""
    spec = run.spec
    point = run.point = _point_from_args(run.args, spec, run.hub)
    run.report.bind(point, point.digest)
    run.report.started("open")
    opened = _open(run, point)
    run.report.bind(point, opened.artifact.sha256)
    model = run.engine["model"]
    provenance = point_provenance(opened, model["name"], model["version"])
    measurement = measurement_id(run.panel_id, opened.artifact.sha256)
    target = run.folder / f"{measurement}.json"
    if target.exists():
        run.report.clear()
        _emit({"command": "measure", "status": "exists", "measurement_id": measurement})
        return 0
    if spec.max_dataset_bytes and (opened.size_bytes or 0) > spec.max_dataset_bytes:
        # Fails at once: no later attempt fits a file over the runner's budget.
        raise _AttemptFailedError("open", "exceeds_runner_budget")
    run.report.started("download")
    h5_path = run.h5_path = _fetch(run, opened)
    columns = dataset_columns(h5_path)
    backend = PolicyEngineBackend(spec.engine_module, str(h5_path), spec.simulation_options)
    try:
        with quiet(run.log_path):
            result = measure(spec, backend, on_progress=run.report.started)
            source_ids = None
            if spec.disclosure_policy != "none":
                source_ids = source_ids_for(spec, h5_path, result.household_ids)
    except ReleaseRefusedError as refusal:
        if refusal.reason not in FILE_REFUSALS:
            raise _AttemptFailedError("measure", refusal.reason) from refusal
        return _store_gap(run, provenance, target, refusal.reason)
    if result.status != "ok" and not point.last_attempt:
        failed = sorted(
            reform_id for reform_id, record in result.reforms.items() if record["status"] != "ok"
        )
        raise _AttemptFailedError("reform", "reform_failed", reforms=failed)
    return _store_point(run, provenance, target, result, source_ids, columns)


def _open(run: _MeasureRun, point: Point) -> OpenedRelease:
    """The release as the plan named it: the file must still be the one the series listed."""
    try:
        opened = open_release(run.hub, point, run.workdir)
    except ReleaseRefusedError as refusal:
        # Before the file is known there is no digest, so there is no point to store.
        # A plan never names such a build: the series record keeps the reason.
        raise _AttemptFailedError("open", refusal.reason) from refusal
    if point.digest is not None and opened.artifact.sha256 != point.digest:
        raise _AttemptFailedError("open", "planned_file_changed")
    return opened


def _fetch(run: _MeasureRun, opened: OpenedRelease) -> Path:
    """The file on disk: the `--h5` copy, checked against its digest, or a verified download."""
    if run.args.h5:
        path = Path(run.args.h5)
        if file_sha256(path) != opened.artifact.sha256:
            raise _AttemptFailedError("download", "sha256_mismatch")
        return path
    try:
        return download_verified(run.hub, opened, run.workdir)
    except ReleaseRefusedError as refusal:
        raise _AttemptFailedError("download", refusal.reason) from refusal


def _store_gap(run: _MeasureRun, provenance: dict[str, Any], target: Path, reason: str) -> int:
    """The file's own source ids are missing or misaligned: the file causes it, so it is
    stored, and shows as a gap."""
    document = refused_document(
        spec=run.spec,
        panel_id=run.panel_id,
        provenance=provenance,
        reason=reason,
        env=run.env,
        producer_commit=run.producer_commit,
        runtime=run.runtime(),
    )
    write_immutable(target, document)
    run.report.clear()
    _emit(
        {
            "command": "measure",
            "status": "refused",
            "reason": reason,
            "measurement_id": document["measurement_id"],
        }
    )
    return 0


def _store_point(
    run: _MeasureRun,
    provenance: dict[str, Any],
    target: Path,
    result: Measurement,
    source_ids: Any,
    columns: list[str],
) -> int:
    """The measured point, after the spec's disclosure policy, and a warning on the run's
    page for each runner limit it came near."""
    document, withheld = measured_point(
        spec=run.spec,
        panel_id=run.panel_id,
        provenance=provenance,
        result=result,
        source_ids=source_ids,
        columns=columns,
        env=run.env,
        producer_commit=run.producer_commit,
        runtime=run.runtime(),
    )
    write_immutable(target, document)
    run.report.clear()
    build_id = run.point.build_id if run.point else None
    near = document["runtime"]["near_limits"]
    for near_limit in near:
        # A GitHub Actions warning on the run's page: ids and shares only.
        print(
            f"::warning title=Release history near a runner limit::{run.spec.country} "
            f"{build_id}: {near_limit['limit']} at "
            f"{round(100 * near_limit['share'])}% of its limit",
            flush=True,
        )
    peak = max(simulation["peak_rss_bytes"] for simulation in result.simulations)
    _emit(
        {
            "command": "measure",
            "near_limits": near,
            "status": document["status"],
            "measurement_id": document["measurement_id"],
            "panel_id": run.panel_id,
            "build_id": build_id,
            "cells": len(result.cells),
            "withheld": withheld,
            "seconds": document["runtime"]["seconds"],
            "peak_rss_gb": round(peak / 1e9, 2),
            "reforms": {
                reform_id: record["status"] for reform_id, record in result.reforms.items()
            },
        }
    )
    return 0


def cmd_export(args: argparse.Namespace) -> int:
    text = export_csv(Path(args.dir), args.country, args.panel)
    if args.output:
        Path(args.output).write_text(text, encoding="utf-8")
    else:
        sys.stdout.write(text)
    return 0


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="release-history", description=__doc__)
    commands = parser.add_subparsers(dest="command", required=True)

    command = commands.add_parser(
        "validate-spec", help="check a spec and its references against the model"
    )
    command.add_argument("--country", required=True)
    command.add_argument("--no-model", action="store_true", help="skip the model check (no engine)")
    command.set_defaults(func=cmd_validate_spec)

    command = commands.add_parser(
        "identity", help="print the pinned panel id; write panel.json, references and labels"
    )
    command.add_argument("--country", required=True)
    command.add_argument(
        "--out", help="store root to write panel.json, references.json, labels.json"
    )
    command.set_defaults(func=cmd_identity)

    command = commands.add_parser("series", help="list the country's series from releases.json")
    command.add_argument("--country", required=True)
    command.add_argument("--out", help="store root to write the country's series.json into")
    command.add_argument(
        "--revision", default="main", help="the release repository's branch or commit"
    )
    command.set_defaults(func=cmd_series)

    command = commands.add_parser(
        "resolve-references", help="write references.lock.json from Chronicle"
    )
    command.add_argument("--country", required=True)
    command.add_argument(
        "--facts", help="a Chronicle consumer_facts.jsonl (when references name records)"
    )
    command.add_argument("--manifest", help="the artifact's manifest.json")
    command.add_argument("--no-digest-check", action="store_true")
    command.set_defaults(func=cmd_resolve_references)

    command = commands.add_parser(
        "measure", help="measure one build's data file on the pinned panel"
    )
    command.add_argument("--country", required=True)
    command.add_argument("--out", required=True, help="store root (same layout as Blob)")
    command.add_argument(
        "--point", help="planned point JSON, or a file holding it, from the plan step"
    )
    command.add_argument("--revision", help="a release tag, branch or commit, for local runs")
    command.add_argument("--repo", help="release repository (defaults to the spec's)")
    command.add_argument(
        "--release-directory", help="folder under releases/ (derived from a cut tag)"
    )
    command.add_argument("--h5", help="a local copy of the national H5 (still sha256-checked)")
    command.add_argument(
        "--build-dir",
        help="a build folder before it is published (a Microcosm post-build step; off by default)",
    )
    command.add_argument("--build-id", help="with --build-dir: the build's <release>/<build> name")
    command.add_argument("--workdir")
    command.add_argument("--log", help="private log for library output (never uploaded)")
    command.add_argument("--keep-h5", action="store_true")
    command.set_defaults(func=cmd_measure)

    command = commands.add_parser("export", help="flatten a panel to CSV")
    command.add_argument("--country", required=True)
    command.add_argument("--dir", required=True, help="store root")
    command.add_argument("--panel")
    command.add_argument("--output")
    command.set_defaults(func=cmd_export)
    return parser


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    try:
        return int(args.func(args) or 0)
    except ReferencesError as error:
        _emit({"command": args.command, "status": "references_error", "detail": str(error)})
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
