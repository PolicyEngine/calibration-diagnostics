"""Decide whether a Modal backfill run is in flight, dead, or missing — and
spawn (or re-spawn) it when needed.

The app writes ``rv_<sha8>/started`` when a run begins, and the spawner
records the Modal call id at ``rv_<sha8>/call_id``. A marker alone is not
proof of life: if the producer dies after the marker is written, every later
tick would see "in flight" and nothing would ever retry (PR #112 review). So
``check`` asks Modal for the recorded call's status first, and only falls
back to the marker's age (24h, comfortably past the 8h function timeout)
when no call id is readable. Re-spawning is always safe: the Volume-backed
workdir checkpoints batch partials, so a re-spawn resumes rather than
restarts.

Usage (from the repo root, Modal credentials in the environment):
    python3 tools/reform_validation/spawn_or_wait.py check <release_id>
        prints WAIT or SPAWN on stdout (reasons go to stderr)
    python3 tools/reform_validation/spawn_or_wait.py spawn <release_id> <producer_ref>
        spawns the backfill and records its call id on the Volume
"""

import hashlib
import sys
import tempfile
import time
from pathlib import Path

import modal

from modal_backfill_app import APP_NAME, VOLUME_NAME

STALE_AFTER_SECONDS = 24 * 3600


def _sha8(release_id: str) -> str:
    return hashlib.sha256(release_id.encode()).hexdigest()[:8]


def _read(vol: modal.Volume, path: str) -> str | None:
    try:
        return b"".join(vol.read_file(path)).decode()
    except Exception:
        return None


def check(release_id: str) -> tuple[str, str]:
    vol = modal.Volume.from_name(VOLUME_NAME, create_if_missing=True)
    prefix = f"rv_{_sha8(release_id)}"
    marker = _read(vol, f"{prefix}/started")
    if marker is None:
        return "SPAWN", "no run recorded for this release"

    call_id = _read(vol, f"{prefix}/call_id")
    if call_id:
        call_id = call_id.strip()
        try:
            modal.FunctionCall.from_id(call_id).get(timeout=0)
        except TimeoutError:
            return "WAIT", f"call {call_id} is still running"
        except Exception as e:
            return (
                "SPAWN",
                f"call {call_id} failed ({type(e).__name__}: {e}) — "
                "re-spawning; the workdir checkpoints make this a resume",
            )
        return (
            "SPAWN",
            f"call {call_id} finished but no artifact was published — re-spawning",
        )

    started_at = None
    for line in marker.splitlines():
        if line.startswith("started_at "):
            started_at = float(line.split()[1])
    age = None if started_at is None else time.time() - started_at
    if age is not None and age < STALE_AFTER_SECONDS:
        return "WAIT", f"no call id readable; marker is {age / 3600:.1f}h old"
    return (
        "SPAWN",
        "no call id readable and the marker is stale (>24h or unstamped) — "
        "re-spawning; the workdir checkpoints make this a resume",
    )


def spawn(release_id: str, producer_ref: str) -> None:
    fn = modal.Function.from_name(APP_NAME, "backfill")
    call = fn.spawn(release_id, producer_ref)
    vol = modal.Volume.from_name(VOLUME_NAME, create_if_missing=True)
    with tempfile.TemporaryDirectory() as tmp:
        p = Path(tmp, "call_id")
        p.write_text(call.object_id)
        with vol.batch_upload(force=True) as batch:
            batch.put_file(p, f"rv_{_sha8(release_id)}/call_id")
    print(
        f"spawned Modal backfill {call.object_id} for {release_id} "
        f"at populace {producer_ref[:9]}",
        file=sys.stderr,
    )


def main() -> None:
    mode = sys.argv[1]
    if mode == "check":
        decision, reason = check(sys.argv[2])
        print(reason, file=sys.stderr)
        print(decision)
    elif mode == "spawn":
        spawn(sys.argv[2], sys.argv[3])
    else:
        raise SystemExit(f"unknown mode {mode!r}; use check or spawn")


if __name__ == "__main__":
    main()
