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
import shutil
import subprocess
import sys
import tempfile
import time
from collections.abc import Iterator
from pathlib import Path
from typing import Any

from release_history import LABELS_FORMAT_VERSION, PRODUCER_VERSION
from release_history.canonical import document_bytes, file_sha256, write_atomic
from release_history.disclosure import apply_policy
from release_history.document import measurement_document, measurement_id, refused_document
from release_history.engine import EngineMismatch, engine_identity, environment, panel_document
from release_history.export import export_csv
from release_history.local_store import (
    country_dir,
    panel_dir,
    write_immutable,
    write_once,
    write_replace,
)
from release_history.measure import MeasurementError, error_record, measure
from release_history.references import (
    ReferenceError_,
    load_lock,
    load_references,
    lock_is_current,
    resolve,
    validate_references,
)
from release_history.reforms import UnknownParameterError, baseline_value, parameter_node
from release_history.releases import (
    HubClient,
    Point,
    ReleaseRefused,
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
    problems = [f"references: {p}" for p in validate_references(spec, references)]
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
    except (SeriesError, ReleaseRefused) as error:
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
    listed = [b for b in builds if b["listing_status"] == "ok" and not b["withdrawn"]]
    _emit(
        {
            "command": "series",
            "country": spec.country,
            "record": record["record"]["present"],
            "commit": record["commit"],
            "builds": len(builds),
            "listed": len(listed),
            "files": len({b["digest"] for b in listed}),
            "refused": sorted({b["listing_reason"] for b in builds if b["listing_reason"]}),
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
                    names.update(str(c) for c in store.select(key, start=0, stop=0).columns)
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
            raise ReleaseRefused("error", "disclosure_source_ids_missing")
        columns = set(store.select(key, start=0, stop=0).columns)
    chosen = next((c for c in spec.source_id_columns if c in columns), None)
    if chosen is None or id_column not in columns:
        raise ReleaseRefused("error", "disclosure_source_ids_missing")
    table = pd.read_hdf(path, key, columns=[id_column, chosen])
    if not np.array_equal(table[id_column].to_numpy(), np.asarray(household_ids)):
        raise ReleaseRefused("error", "disclosure_source_ids_misaligned")
    return table[chosen].to_numpy()


def _point_from_args(args: argparse.Namespace, spec: Spec, hub: HubClient) -> Point:
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


def _run_failed(stage: str, reason: str, point: Point | None, **extra: Any) -> int:
    """A failure the run caused, not the file: nothing immutable is written, and a later
    attempt may succeed."""
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


def cmd_measure(args: argparse.Namespace) -> int:
    started = _now()
    clock = time.monotonic()
    spec = load_spec(args.country)
    try:
        engine = engine_identity(spec)
    except EngineMismatch as error:
        _emit({"command": "measure", "status": "engine_mismatch", "detail": str(error)})
        return 1
    root = Path(args.out)
    panel = panel_document(spec, engine)
    panel_id = panel["panel_id"]
    folder = panel_dir(root, spec.country, panel_id)
    write_once(folder / "panel.json", panel)
    env = environment(_lockfile(spec.country))
    producer_commit = _producer_commit()
    hub = HubClient()
    workdir = Path(args.workdir) if args.workdir else Path(tempfile.mkdtemp(prefix="rh-"))
    log_path = Path(args.log) if args.log else root / ".logs" / f"{spec.country}-{int(clock)}.log"
    point: Point | None = None
    h5_path: Path | None = None

    def runtime() -> dict[str, Any]:
        return {
            "started_at": started,
            "finished_at": _now(),
            "seconds": round(time.monotonic() - clock, 1),
            "runner": os.environ.get("RUNNER_NAME") or os.environ.get("RUNNER_OS") or "local",
        }

    try:
        point = _point_from_args(args, spec, hub)
        try:
            opened = open_release(hub, point, workdir)
        except ReleaseRefused as refusal:
            # Before the file is known there is no digest, so there is no point to store.
            # A plan never names such a build: the series record keeps the reason.
            return _run_failed("open", refusal.reason, point)
        if point.digest is not None and opened.artifact.sha256 != point.digest:
            return _run_failed("open", "planned_file_changed", point)
        provenance = point_provenance(opened, engine["model"]["name"], engine["model"]["version"])
        h5_sha = opened.artifact.sha256
        measurement = measurement_id(panel_id, h5_sha)
        target = folder / f"{measurement}.json"
        if target.exists():
            _emit({"command": "measure", "status": "exists", "measurement_id": measurement})
            return 0
        if spec.max_dataset_bytes and (opened.size_bytes or 0) > spec.max_dataset_bytes:
            return _run_failed("open", "exceeds_runner_budget", point)
        if args.h5:
            h5_path = Path(args.h5)
            if file_sha256(h5_path) != h5_sha:
                return _run_failed("download", "sha256_mismatch", point)
        else:
            try:
                h5_path = download_verified(hub, opened, workdir)
            except ReleaseRefused as refusal:
                return _run_failed("download", refusal.reason, point)
        columns = dataset_columns(h5_path)
        backend = PolicyEngineBackend(spec.engine_module, str(h5_path), spec.simulation_options)
        try:
            with quiet(log_path):
                result = measure(spec, backend)
                source_ids = None
                if spec.disclosure_policy != "none":
                    source_ids = source_ids_for(spec, h5_path, result.household_ids)
                withheld = apply_policy(
                    spec.disclosure_policy,
                    result.cells,
                    result.tables,
                    source_ids=source_ids,
                    floor=spec.min_source_households,
                )
        except ReleaseRefused as refusal:
            if refusal.reason not in FILE_REFUSALS:
                return _run_failed("measure", refusal.reason, point)
            # The file's own source ids are missing or misaligned: the file causes it, so
            # it is stored and shows as a gap.
            document = refused_document(
                spec=spec,
                panel_id=panel_id,
                provenance=provenance,
                reason=refusal.reason,
                env=env,
                producer_commit=producer_commit,
                runtime=runtime(),
            )
            write_immutable(target, document)
            _emit(
                {
                    "command": "measure",
                    "status": "refused",
                    "reason": refusal.reason,
                    "measurement_id": measurement,
                }
            )
            return 0
        if result.status != "ok" and not point.last_attempt:
            failed = sorted(k for k, v in result.reforms.items() if v.get("status") != "ok")
            return _run_failed("reform", "reform_failed", point, reforms=failed)
        document = measurement_document(
            spec=spec,
            panel_id=panel_id,
            provenance=provenance,
            result=result,
            columns=columns,
            withheld=withheld,
            env=env,
            producer_commit=producer_commit,
            runtime=runtime(),
        )
        write_immutable(target, document)
        _emit(
            {
                "command": "measure",
                "status": document["status"],
                "measurement_id": measurement,
                "panel_id": panel_id,
                "build_id": point.build_id,
                "cells": len(result.cells),
                "withheld": withheld,
                "seconds": document["runtime"]["seconds"],
                "peak_rss_gb": round(max(s["peak_rss_bytes"] for s in result.simulations) / 1e9, 2),
                "reforms": {k: v["status"] for k, v in result.reforms.items()},
            }
        )
        return 0
    except MeasurementError as failure:
        record = error_record(failure.stage, failure.error)
        return _run_failed(
            failure.stage, f"{failure.stage}_failed", point, error_class=record["class"]
        )
    except ReleaseRefused as refusal:
        return _run_failed("open", refusal.reason, point)
    except TransientError as error:
        _emit({"command": "measure", "status": "transient", "class": str(error)})
        return EXIT_TRANSIENT
    except Exception as error:  # noqa: BLE001 - the class name only, never the message
        # An unexpected error's message or traceback could carry a figure into the public
        # log, so only its class is printed.
        return _run_failed(
            "unexpected", "unexpected_error", point, error_class=type(error).__name__
        )
    finally:
        if h5_path is not None and not args.h5 and not args.keep_h5:
            h5_path.unlink(missing_ok=True)
        if not args.workdir:
            shutil.rmtree(workdir, ignore_errors=True)


def cmd_export(args: argparse.Namespace) -> int:
    text = export_csv(Path(args.dir), args.country, args.panel)
    if args.output:
        Path(args.output).write_text(text, encoding="utf-8")
    else:
        sys.stdout.write(text)
    return 0


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="release-history", description=__doc__)
    sub = parser.add_subparsers(dest="command", required=True)

    p = sub.add_parser("validate-spec", help="check a spec and its references against the model")
    p.add_argument("--country", required=True)
    p.add_argument("--no-model", action="store_true", help="skip the model check (no engine)")
    p.set_defaults(func=cmd_validate_spec)

    p = sub.add_parser(
        "identity", help="print the pinned panel id; write panel.json, references and labels"
    )
    p.add_argument("--country", required=True)
    p.add_argument("--out", help="store root to write panel.json, references.json, labels.json")
    p.set_defaults(func=cmd_identity)

    p = sub.add_parser("series", help="list the country's series from releases.json")
    p.add_argument("--country", required=True)
    p.add_argument("--out", help="store root to write the country's series.json into")
    p.add_argument("--revision", default="main", help="the release repository's branch or commit")
    p.set_defaults(func=cmd_series)

    p = sub.add_parser("resolve-references", help="write references.lock.json from Chronicle")
    p.add_argument("--country", required=True)
    p.add_argument(
        "--facts", help="a Chronicle consumer_facts.jsonl (when references name records)"
    )
    p.add_argument("--manifest", help="the artifact's manifest.json")
    p.add_argument("--no-digest-check", action="store_true")
    p.set_defaults(func=cmd_resolve_references)

    p = sub.add_parser("measure", help="measure one build's data file on the pinned panel")
    p.add_argument("--country", required=True)
    p.add_argument("--out", required=True, help="store root (same layout as Blob)")
    p.add_argument("--point", help="planned point JSON, or a file holding it, from the plan step")
    p.add_argument("--revision", help="a release tag, branch or commit, for local runs")
    p.add_argument("--repo", help="release repository (defaults to the spec's)")
    p.add_argument("--release-directory", help="folder under releases/ (derived from a cut tag)")
    p.add_argument("--h5", help="a local copy of the national H5 (still sha256-checked)")
    p.add_argument("--workdir")
    p.add_argument("--log", help="private log for library output (never uploaded)")
    p.add_argument("--keep-h5", action="store_true")
    p.set_defaults(func=cmd_measure)

    p = sub.add_parser("export", help="flatten a panel to CSV")
    p.add_argument("--country", required=True)
    p.add_argument("--dir", required=True, help="store root")
    p.add_argument("--panel")
    p.add_argument("--output")
    p.set_defaults(func=cmd_export)
    return parser


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    try:
        return int(args.func(args) or 0)
    except ReferenceError_ as error:
        _emit({"command": args.command, "status": "references_error", "detail": str(error)})
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
