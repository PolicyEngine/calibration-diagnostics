"""Generate a reform_validation.json for a populace-us release, offline.

A release can reach the dashboard without a reform_validation.json (a build
promoted to `latest` that skipped the reform-validation step). This reproduces
the artifact faithfully by running the producer
(populace.build.us_runtime.reform_validation.reform_validation_payload) on the
released populace_us_2024.h5 — the same call the build pipeline makes — and
writes it as a committed dashboard override. Decoupled from the build pipeline,
so the slow simulation can never break a release.

The producer builds ~45 fresh Microsimulations; some (budget_measure=
state_income_tax) compute all 50 states' income taxes and are memory-heavy.
Running them all in one process exhausts memory/disk, so this drives the work in
small batches, each a separate short-lived subprocess whose memory and temp
files are released on exit, checkpointing a partial per batch and merging at the
end (concat + dedup by id — identical to the monolithic payload). OBBBA stays in
one batch because its provisions are scored jointly in JCX-stacked order.

Prereqs (the workflow sets these up): the exact policyengine-us / policyengine-core
versions from the release's release_manifest are installed, and the populace
package tree is importable (PYTHONPATH to packages/*/src of a populace checkout).

Usage:
    # full run: download H5, score every batch, merge, write reform_validation.json
    python backfill.py --release-id <id> --workdir <dir> [--producer-commit <sha>]
    # (blank --release-id resolves to latest.json)
    python backfill.py --workdir <dir> --only <batch>   # one batch (internal)
    python backfill.py --workdir <dir> --merge          # merge partials
    python backfill.py --workdir <dir> --plan           # print batch names
"""

from __future__ import annotations

import argparse
import gc
import hashlib
import json
import math
import os
import re
import subprocess
import sys
import time
import urllib.request
from pathlib import Path

HF_REPO = "policyengine/populace-us"
PERIOD = 2024
CHUNK = 2  # baseline + 2 reforms/batch keeps heavy state_income_tax sims bounded


# --------------------------------------------------------------------------- #
# HTTP / release metadata
# --------------------------------------------------------------------------- #
def _resolve_url(path: str, revision: str = "main") -> str:
    return f"https://huggingface.co/datasets/{HF_REPO}/resolve/{revision}/{path}"


def _get_json(url: str) -> dict:
    with urllib.request.urlopen(url, timeout=60) as r:
        return json.loads(r.read())


def latest_release_id() -> str:
    return _get_json(_resolve_url("latest.json"))["release_id"]


def release_manifest(release_id: str) -> dict:
    return _get_json(_resolve_url(f"releases/{release_id}/release_manifest.json"))


def _download(url: str, dest: Path, expect_sha256: str | None = None) -> None:
    dest.parent.mkdir(parents=True, exist_ok=True)
    h = hashlib.sha256()
    with urllib.request.urlopen(url, timeout=300) as r, open(dest, "wb") as f:
        while True:
            chunk = r.read(1 << 20)
            if not chunk:
                break
            f.write(chunk)
            h.update(chunk)
    if expect_sha256 and h.hexdigest() != expect_sha256:
        raise SystemExit(
            f"sha256 mismatch for {dest.name}: got {h.hexdigest()}, want {expect_sha256}"
        )


# --------------------------------------------------------------------------- #
# Workdir layout
# --------------------------------------------------------------------------- #
def _workdir() -> Path:
    return Path(os.environ["RV_WORKDIR"]).resolve()


def _release_id() -> str:
    return os.environ["RV_RELEASE_ID"]


def _paths():
    wd = _workdir()
    return wd, wd / "populace_us_2024.h5", wd / "calibration_diagnostics.json", wd / "partials"


# --------------------------------------------------------------------------- #
# Producer glue (faithful to tools/build_us_fiscal_refresh_release.py)
# --------------------------------------------------------------------------- #
def cached_simulate_factory(dataset_path: Path):
    """Load the H5 once, reuse for every reform in this (short-lived) process."""
    from policyengine_us import Microsimulation
    from policyengine_us.data import USSingleYearDataset

    dataset = USSingleYearDataset(file_path=str(dataset_path))

    def simulate(reform):
        t0 = time.time()
        sim = (
            Microsimulation(dataset=dataset)
            if reform is None
            else Microsimulation(dataset=dataset, reform=reform)
        )
        print(f"    [sim {time.time() - t0:.0f}s]", flush=True)
        return sim

    return simulate


def in_sample_dicts(diag_path: Path):
    """Reproduce _in_sample_estimates/_in_sample_targets(result) from the published
    calibration_diagnostics.json. Serialized target names carry an @<period> suffix
    the in-memory target.name lacks — strip it to match the JCT in-sample spec ids."""
    diag = json.loads(diag_path.read_text())
    est, tgt = {}, {}
    for t in diag["targets"]:
        name = re.sub(r"@\d+$", "", t["name"])
        fe, tv = t.get("final_estimate"), t.get("target")
        if fe is not None and math.isfinite(float(fe)):
            est[name] = float(fe)
        if tv is not None and math.isfinite(float(tv)):
            tgt[name] = float(tv)
    return est, tgt


def _is_obbba(spec):
    from populace.build.us_runtime.reform_validation import _is_obbba_spec

    return _is_obbba_spec(spec)


def _batches(specs):
    """(name, subset_specs, include_levels). OBBBA scored jointly; in-sample rows
    ride with it (they read the estimates dict, no sim); remaining reforms chunk by
    CHUNK; baseline-levels are one batch (all read one shared baseline)."""
    obbba = [s for s in specs if _is_obbba(s)]
    insample = [s for s in specs if s.in_sample and not _is_obbba(s)]
    rest = [s for s in specs if not _is_obbba(s) and not s.in_sample]
    yield ("levels", [], True)
    yield ("obbba", obbba + insample, False)
    for i in range(0, len(rest), CHUNK):
        yield (f"rest{i // CHUNK}", rest[i : i + CHUNK], False)


def _load_specs():
    from populace.build.us_runtime.reform_validation import load_default_reform_specs

    return load_default_reform_specs(period=PERIOD)


def run_batch(name, subset, include_levels):
    from populace.build.us_runtime.reform_validation import (
        default_baseline_level_specs,
        reform_validation_payload,
    )

    _, h5, diag, part_dir = _paths()
    part_dir.mkdir(exist_ok=True)
    part = part_dir / f"{name}.json"
    if part.exists():
        print(f"[skip] {name}", flush=True)
        return
    est, tgt = in_sample_dicts(diag)
    print(f"[run ] {name}: {len(subset)} specs levels={include_levels}", flush=True)
    payload = reform_validation_payload(
        subset,
        period=PERIOD,
        simulate=cached_simulate_factory(h5),
        in_sample_estimates=est,
        in_sample_targets=tgt,
        baseline_levels=default_baseline_level_specs() if include_levels else (),
        release_id=_release_id(),
    )
    part.write_text(json.dumps(payload, indent=1, allow_nan=False))
    print(f"[done] {name}: {len(payload['reforms'])} rows", flush=True)
    del payload
    gc.collect()


def _backfill_note(manifest: dict, producer_commit: str, h5_sha: str) -> str:
    b = manifest["build"]
    return (
        "Full offline reproduction of reform_validation.json for a release that "
        "shipped without one (the build was promoted to latest with the "
        "reform-validation step skipped). Generated by "
        "tools/reform_validation/backfill.py (scheduled workflow "
        "reform-validation-backfill.yml) running the producer "
        "(populace.build.us_runtime.reform_validation.reform_validation_payload) on "
        f"the released populace_us_2024.h5 (sha256 {h5_sha}) under the EXACT build "
        f"versions policyengine-us {b['built_with_model_package']['version']} / "
        f"policyengine-core {b['built_with_core_package']['version']} (per "
        "release_manifest), so no version drift. In-sample JCT rows come from the "
        "release's own calibration_diagnostics.json (identical to a native build); "
        "out-of-sample rows (OBBBA JCX-stacked, tax-expenditure, state-program and "
        "state-reform repeals) and the baseline-level backtests (IRS SOI actual, "
        "federal-EITC-by-state, state-program actual) were simulated on the H5. "
        f"Producer run at populace {producer_commit}. Computed in small subprocess "
        "batches for memory/disk headroom; scoring is identical to the monolithic "
        "producer (non-OBBBA reforms independent; OBBBA scored jointly stacked)."
    )


def merge(manifest: dict, producer_commit: str, h5_sha: str) -> Path:
    from populace.build.us_runtime.reform_validation import write_reform_validation

    wd, _, _, part_dir = _paths()
    names = [n for n, _, _ in _batches(_load_specs())]
    seen, rows, header = set(), [], None
    for name in names:
        p = json.loads((part_dir / f"{name}.json").read_text())
        if header is None:
            header = {k: v for k, v in p.items() if k != "reforms"}
        for r in p["reforms"]:
            rid = r.get("id")
            if rid is not None and rid in seen:
                continue
            if rid is not None:
                seen.add(rid)
            rows.append(r)
    header["reforms"] = rows
    header["_backfill_note"] = _backfill_note(manifest, producer_commit, h5_sha)
    out = wd / "reform_validation.json"
    write_reform_validation(header, out)
    print(f"MERGED {len(rows)} rows -> {out}", flush=True)
    return out


# --------------------------------------------------------------------------- #
# Orchestration (default mode): download, batch-in-subprocesses, merge
# --------------------------------------------------------------------------- #
def _cleanup_temp() -> None:
    """pe-us leaves small tmp*.h5 in TMPDIR; sweep the ones no longer in use."""
    import glob
    import tempfile

    for f in glob.glob(os.path.join(tempfile.gettempdir(), "tmp*.h5")):
        try:
            if time.time() - os.path.getmtime(f) > 120:
                os.remove(f)
        except OSError:
            pass


def orchestrate(release_id: str, producer_commit: str) -> Path:
    wd, h5, diag, _ = _paths()
    manifest = release_manifest(release_id)
    art = manifest["artifacts"]["populace_us_2024"]
    if not h5.exists():
        print(f"downloading H5 ({art['sha256'][:12]}…)…", flush=True)
        _download(_resolve_url(art["path"], art["revision"]), h5, art["sha256"])
    if not diag.exists():
        _download(
            _resolve_url(f"releases/{release_id}/calibration_diagnostics.json"), diag
        )
    plan = [n for n, _, _ in _batches(_load_specs())]
    for name in plan:
        part = wd / "partials" / f"{name}.json"
        for attempt in range(1, 7):
            if part.exists():
                break
            print(f"=== batch {name} attempt {attempt} ===", flush=True)
            subprocess.run(
                [sys.executable, __file__, "--workdir", str(wd), "--only", name],
                env={**os.environ, "RV_WORKDIR": str(wd), "RV_RELEASE_ID": release_id},
            )
            _cleanup_temp()
            if not part.exists():
                print(f"--- {name} produced no partial; settling 20s ---", flush=True)
                time.sleep(20)
        if not part.exists():
            raise SystemExit(f"batch {name} failed after 6 attempts")
    return merge(manifest, producer_commit, art["sha256"])


# --------------------------------------------------------------------------- #
def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--release-id", default="")
    ap.add_argument("--workdir", default=os.environ.get("RV_WORKDIR", "."))
    ap.add_argument("--producer-commit", default=os.environ.get("RV_PRODUCER_COMMIT", "unknown"))
    ap.add_argument("--only")
    ap.add_argument("--merge", action="store_true")
    ap.add_argument("--plan", action="store_true")
    args = ap.parse_args()

    os.environ["RV_WORKDIR"] = str(Path(args.workdir).resolve())
    release_id = args.release_id or os.environ.get("RV_RELEASE_ID") or latest_release_id()
    os.environ["RV_RELEASE_ID"] = release_id

    if args.plan:
        print(" ".join(n for n, _, _ in _batches(_load_specs())))
        return
    if args.only:
        name, subset, lv = next(b for b in _batches(_load_specs()) if b[0] == args.only)
        run_batch(name, subset, lv)
        return
    if args.merge:
        merge(release_manifest(release_id), args.producer_commit, "unknown")
        return
    orchestrate(release_id, args.producer_commit)


if __name__ == "__main__":
    main()
