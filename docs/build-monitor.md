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

## Testing

Unit tests cover both telemetry schemas, forecasts, validation failures, and
hosted-source precedence in `frontend/lib/microcosm/build-monitor.test.ts` and
`frontend/lib/microcosm/build-runs.test.ts`.

## Forecast

The forecast compares the run with finished hosted runs of the same pipeline
(version 2 runs by pipeline id; version 1 US runs as one release pipeline), up
to the 12 most recent.

- The rest of the current stage comes from past durations of that stage that
  ran longer than this one has so far. When a stage reports progress (the
  calibration epoch counter, or `done`/`total`, `batch`/`batches` and similar
  detail pairs on its events), the measured rate sets a floor.
- Everything after the current stage comes from the time between that stage's
  end and the run's end in each past run, so gaps between stages count.
- Both scale by the run's pace: how long its finished stages took against
  their typical durations.
- The 90% bound adds the two parts' spreads and stays at least 30% above the
  median, because a handful of runs understates the spread.

Replaying the 18 staging runs recorded by 2026-10-01 at 20%, 40%, 60% and 80%
of each finished run gave a median error of 21% of run time for UK national
calibration (20 checkpoints, 80% inside the 90% bound) and 17% for UK FRS
spine builds (12 checkpoints, 67% inside). UK candidate builds vary in how many
solver passes they run, so their forecasts are poor until a pipeline has more
runs.

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
  the run manifest's `identity` (commit, runtime, CPU count, memory). "Why runs
  stop" counts runs by failure class with the compute each class threw away.

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
