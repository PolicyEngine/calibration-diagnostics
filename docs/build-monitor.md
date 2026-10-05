# Build progress

The **Build progress** tab of Staging candidates
(`/microcosm/staging?view=progress`) shows a Microcosm build as it runs,
predicts when it will finish, and summarizes where build time goes and which
checks stop builds. The run selected on either tab carries over to the other.

## Sources

- **Local runs.** Every Microcosm build writes telemetry to a run folder on
  the machine it runs on, whether or not it uploads to staging. The US release
  writes `<release_root>/staging/runs/<run_id>/` (or `--staging-dir`); the UK
  builds write their local staging directory. Point the dashboard at the
  folder that holds them and run it on that machine:

  ```bash
  MICROCOSM_LOCAL_RUNS_DIR=/path/to/build/output make dev
  ```

  The server searches up to six levels below each directory (separate several
  with `:`) for folders that hold `progress.json` and `events.ndjson`, skipping
  checkpoint trees and hidden folders. Local runs are off unless the variable
  is set, so a hosted deployment never reads its own filesystem.
- **Staging repository.** The same views over the runs a build uploaded to the
  country's staging repository. A US build uploads unless it runs with
  `--no-staging` or without a Hugging Face token.

## Testing without a build

- **Replay a recorded run.** Any run folder (a build's local
  `staging/runs/<run_id>/`, or one downloaded from the staging repository)
  can be played back as a live run, compressed in time:

  ```bash
  cd frontend
  bun run replay:build-run --from <run folder> --to /tmp/replays --speed 4
  MICROCOSM_LOCAL_RUNS_DIR=/tmp/replays make -C .. dev
  ```

  At `--speed` above 1 the run outpaces the history its forecast compares
  against, so the expected finish runs long; use `--speed 1` to check the
  forecast itself.
- **Run a real UK smoke build.** The UK spine build runs end to end on
  Microcosm's synthetic fixture, with no licensed data or token, and writes
  real version 2 telemetry locally (the same command Microcosm's
  `integration-uk` CI job runs):

  ```bash
  cd <microcosm checkout>
  uv sync --all-packages --locked --extra uk
  uv run python tools/build_uk_frs_spine.py \
    --synthetic-fixture-dir packages/microcosm-graph/tests/fixtures/parity/uk_spine/sources \
    --spine-h5 /tmp/smoke/uk-smoke.h5 --sample-fraction 1.0 --sample-seed 42 \
    --smoke --staging-local-only --staging-dir /tmp/smoke/staging
  ```

  With `MICROCOSM_LOCAL_RUNS_DIR=/tmp/smoke` the run appears on the UK
  Build progress tab as it builds.
- **Unit tests** cover both telemetry schemas, the forecast, gate refusals and
  local discovery: `frontend/lib/microcosm/build-monitor.test.ts` and
  `local-build-runs.test.ts`.

## Forecast

The forecast compares the run with finished runs of the same pipeline from
the same source (version 2 runs by pipeline id; version 1 US runs as one
release pipeline), up to the 12 most recent.

Runs of one pipeline can still differ in what they do: UK local candidates kept
the pipeline id `uk-local-candidate` 0.1.0 when cloning and surface resolution
moved into target compilation (September against October 2026). So a past run
counts only when it went through the same stages as this run over the stretch
both reached; more than one stage, and more than a fifth of the stages, found in
only one of them mark a different stage sequence. Those runs are left out of the
forecast and the "Where build time goes" and "Checks and gates" statistics, and
the time budget says how many were left out. A stage added to a long pipeline
(the FRS spine gains one every few weeks) does not split its history. Until a
run reaches the stage where the sequences part, older runs still count; a new
pipeline version from the producer is the reliable fix.

- The rest of the current stage comes from past durations of that stage that
  ran longer than this one has so far. When a stage reports progress (the
  calibration epoch counter, or `done`/`total`, `batch`/`batches` and similar
  detail pairs on its events), the measured rate sets a floor.
- Everything after the current stage comes from the time between that stage's
  end and the run's end in each past run, so gaps between stages count.
- Both scale by the run's pace: how long its finished stages took against
  their typical durations. Typical durations come only from runs that finished
  the stage; a stage that failed, or the last stage of a stalled run, stopped
  early and does not count.
- During calibration, the solver passes come from the epoch counter: it
  restarts at each pass, and each row names its phase (`size_search`,
  `size_refit`). The remaining solve is the rest of the current pass at its
  epoch rate, plus the size-search passes past runs needed beyond this run's
  count, each as long as this run's own search passes. Pass counts come from
  runs with the same stage sequence; when none has finished the solve, runs of
  the pipeline with another sequence stand in and the note says so.
- The 90% bound adds the two parts' spreads and stays at least 30% above the
  median, because a handful of runs understates the spread.

Replaying the 18 staging runs recorded by 2026-10-01 at 20%, 40%, 60% and 80%
of each finished run gave a median error of 21% of run time for UK national
calibration (20 checkpoints, 80% inside the 90% bound) and 17% for UK FRS
spine builds (12 checkpoints, 67% inside). UK local candidates vary in how many solver passes they run, so
their forecasts are poor until a pipeline has more runs.

The timeline splits a calibration stage into its solver passes, each with its
epochs and seconds per epoch, and shows time with no epochs logged (before the
first epoch, between passes, after the last) as faint bars. In the UK candidate
run of 2026-10-05, that showed a 41-minute setup, a 2-hour stretch with no
epochs after the first pass, and passes at 4.1–5.1 s per epoch against 1.8 in
September.

## Process telemetry

When a run reports it (US release builds with microcosm's process telemetry
on), the tab also reads:

- `resources` on each stage event and in the progress document: cores a stage
  kept busy (CPU seconds over wall seconds) and memory at its start and end,
  shown per stage and as medians across runs;
- `heartbeat_at`: a run that sends heartbeats is marked stalled after five
  minutes without one, instead of six hours;
- `work` in the progress document (batches done of the stage's total, with the
  time they took): the current stage's remaining time comes from this measured
  rate rather than from past runs;
- `failure_class`, `failed_during` and `elapsed_seconds` on a failed run, and
  the run manifest's `identity` (commit, runtime, CPU count, memory). "Why runs
  stop" counts runs by failure class with the compute each class threw away.

## Limits

- A stage that reports no progress is silent until it ends. The US target
  compilation runs for hours this way; until it emits batch progress, a slow
  compilation and a killed process look alike until the stage overruns.
- A process killed by the operating system writes no final event. The run
  shows as stalled after six hours without telemetry.
- Passing gates write no telemetry, so the gate statistics count failures
  only. The US gate catalog in `frontend/lib/microcosm/build-gate-catalog.ts`
  lists every check the US release runs and where it sits; it is pinned to the
  Microcosm commit it was read from.
- The base population build (`build_us_puf_support_base.py`) writes only
  `stage_profile.json`, not run telemetry, so it does not appear here.
- The staging source shows a notice when its newest run is more than 14 days
  old: builds run with `--no-staging`, or whose uploads failed, never reach
  it. The hosted dashboard offers only the staging repository; the local
  source appears where `MICROCOSM_LOCAL_RUNS_DIR` is set.
