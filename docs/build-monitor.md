# Build progress

The **Build progress** tab of Staging candidates
(`/microcosm/staging?view=progress`) shows a Microcosm build as it runs,
predicts when it will finish, and summarizes where build time goes and which
checks stop builds. The run selected on either tab carries over to the other.

## Sources

- **Hosted collector.** Current Microcosm builds automatically start a local
  telemetry emitter service. The build sends events to its private local
  socket; that service samples the build process tree, stores unsent events in
  a bounded SQLite retry queue, authenticates with the ambient Hugging Face
  credential, and delivers events to the hosted collector. The dashboard
  server receives the collector address and its independent read credential
  from the deployment environment. Neither value belongs in documentation or
  browser-visible configuration.

  A missing credential, a user outside the PolicyEngine Hugging Face
  organization, or an unavailable network does not stop a build. Events remain
  in the local retry queue for a later Microcosm run to deliver.
- **Historical Hugging Face telemetry.** During migration, the hosted view also
  reads version 1 and version 2 run documents from each country's Hugging Face
  staging repository. A collector record replaces a historical record with the
  same run id.
- **Local run folders.** The dashboard can still inspect legacy or diagnostic
  run folders on the same machine. Point it at the directory that holds them:

  ```bash
  MICROCOSM_LOCAL_RUNS_DIR=/path/to/build/output make dev
  ```

  The server searches up to six levels below each directory (separate several
  with `:`) for folders that hold `progress.json` and `events.ndjson`, skipping
  checkpoint trees and hidden folders. Local runs are off unless the variable
  is set, so a hosted deployment never reads its own filesystem.

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
  early and does not count. "Where build time goes" uses the same rule, counts
  the stages a running run has finished, shows "stopped early in N runs" for
  the rest, and splits a typical run by phase only once a run has finished.
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

The local telemetry emitter service reports:

- `resources` on each stage event and in the progress document: cores a stage
  kept busy (CPU seconds over wall seconds) and memory at its start and end,
  shown per stage and as medians across runs;
- `heartbeat_at`: a run that sends heartbeats is marked stalled after five
  minutes without one, instead of six hours;
- `work` in the progress document (batches done of the stage's total, with the
  time they took): the current stage's remaining time comes from this measured
  rate rather than from past runs;
- `failure_class`, `failed_during` and `elapsed_seconds` on a failed run, and
  the run manifest's `identity` (commit, runtime, CPU count, memory).

"Why runs stop" groups the runs that did not finish by how they ended
(failed, refused by gates, went silent) and the stage they stopped in, with
the median run time spent by then and what the runs recorded: error types and
codes, failure classes, and messages or gate failure lines. It shows recorded
values only. A run that recorded nothing says so, and a run that went silent
wrote no final event, so it has nothing about the cause. "Run history" lists
every run of the pipeline, newest first, on one time scale; selecting a row
opens that run, and runs with a different stage sequence are listed apart.

The US release reports each engine batch during target compilation and each
batch during post-export scoring. UK graph builds report each completed graph
node through the executor's read-only observer hook. Network delivery is never
performed by the build process.

## Limits

- Work inside a library call that exposes neither batch progress nor graph-node
  completion remains silent between heartbeats.
- If the build process exits without a final event while the local telemetry
  emitter service survives, the service records an unexpected-process-exit
  failure. If the operating system kills both processes, the dashboard marks
  the run stalled after its heartbeat expires.
- Some passing validation checks do not produce individual events. The US
  validation catalog in `frontend/lib/microcosm/build-gate-catalog.ts` lists
  every check the release runs and where it sits; it is pinned to the
  Microcosm commit it was read from.
- The base population build (`build_us_puf_support_base.py`) writes only
  `stage_profile.json`, not run telemetry, so it does not appear here.
- The staging source shows a notice when its newest run is more than 14 days
  old: builds run with `--no-staging`, or whose uploads failed, never reach
  it. The hosted dashboard offers only the staging repository; the local
  source appears where `MICROCOSM_LOCAL_RUNS_DIR` is set.
