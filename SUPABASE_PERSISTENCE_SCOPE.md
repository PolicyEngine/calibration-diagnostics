# Supabase Persistence Layer Scope

## Goal

Add a small persistence layer for shared, queryable diagnostics state without
moving large immutable artifacts out of Hugging Face.

Supabase should make the dashboard and API more usable when evaluations become
async, shared across users, or deployed across multiple backend instances.

## Current State

The app does not currently store anything in Supabase.

Current storage paths:

- Hugging Face stores source artifacts: `policy_data.db`, H5 datasets,
  diagnostics CSVs, and staging/root bundle trees.
- Local `.artifacts/` stores downloaded artifacts and computed pickle caches.
- Backend memory stores loaded runs and bundle simulations for one process.
- Downloaded `policy_data.db` is read as SQLite for target metadata.

## Non-Goals

- Do not store H5 files in Supabase.
- Do not store full `policy_data.db` copies in Supabase.
- Do not store sparse matrices, household-level matrices, or large result
  frames in Postgres.
- Do not make Supabase the source of truth for immutable published artifacts.
- Do not require Supabase for local development.

## What Belongs In Supabase

### Evaluation Jobs

Track synchronous-now, async-later API work:

- `job_id`
- `status`: `queued`, `running`, `complete`, `failed`, `cancelled`
- `dataset_id`
- `run_id`
- `bundle`
- request filters as `jsonb`
- `created_at`, `started_at`, `finished_at`
- `elapsed_ms`
- `error_message`
- result metadata: target counts, computed counts, result URL or object key

This is the first table to implement.

### Bundle Evaluation Cache Metadata

Track whether a bundle has already been evaluated and where results live:

- `dataset_id`
- `run_id`
- `bundle`
- artifact revision or digest where available
- `target_count`
- `computed_target_count`
- `cache_status`
- `cache_key`
- `created_at`, `updated_at`

The computed result body can remain in local `.artifacts` for dev. In deployed
environments, store result files in object storage and put only the object key
in Supabase.

### Summary Snapshots

Persist small aggregate summaries:

- dataset/run/bundle/filter signature
- target universe count
- included target count
- computed target count
- median/mean/p95 absolute relative error
- total loss when meaningful
- provenance metadata

These can power fast dashboard landing states and CI checks.

### Saved Comparisons

Optional after jobs exist:

- comparison side A/B identifiers
- matched target count
- computed pair count
- improved/regressed counts
- top movers object key or compact JSON

## Proposed Schema

### `diagnostics_evaluation_jobs`

```sql
create table diagnostics_evaluation_jobs (
  job_id uuid primary key default gen_random_uuid(),
  status text not null check (
    status in ('queued', 'running', 'complete', 'failed', 'cancelled')
  ),
  dataset_id text not null,
  run_id text not null,
  bundle text,
  filters jsonb not null default '{}'::jsonb,
  request_hash text not null,
  target_count integer,
  computed_target_count integer,
  result_url text,
  result_object_key text,
  error_message text,
  elapsed_ms double precision,
  created_at timestamptz not null default now(),
  started_at timestamptz,
  finished_at timestamptz
);

create index diagnostics_evaluation_jobs_lookup
  on diagnostics_evaluation_jobs (dataset_id, run_id, bundle, request_hash);

create index diagnostics_evaluation_jobs_status
  on diagnostics_evaluation_jobs (status, created_at desc);
```

### `diagnostics_bundle_cache`

```sql
create table diagnostics_bundle_cache (
  dataset_id text not null,
  run_id text not null,
  bundle text not null,
  artifact_revision text,
  cache_key text not null,
  cache_status text not null,
  target_count integer,
  computed_target_count integer,
  result_object_key text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (dataset_id, run_id, bundle, cache_key)
);
```

### `diagnostics_summary_snapshots`

```sql
create table diagnostics_summary_snapshots (
  summary_id uuid primary key default gen_random_uuid(),
  dataset_id text not null,
  run_id text not null,
  bundle text not null,
  filter_hash text not null,
  filters jsonb not null default '{}'::jsonb,
  target_universe_count integer not null,
  included_target_count integer not null,
  computed_target_count integer not null,
  loss_contribution_available boolean not null,
  metrics jsonb not null default '{}'::jsonb,
  provenance jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create unique index diagnostics_summary_snapshots_key
  on diagnostics_summary_snapshots (dataset_id, run_id, bundle, filter_hash);
```

## API Changes

### Phase 1: Optional Persistence Client

- Add optional Supabase settings:
  - `SUPABASE_URL`
  - `SUPABASE_SERVICE_ROLE_KEY`
  - `DIAGNOSTICS_PERSISTENCE=disabled|supabase`
- Add a backend persistence interface with a no-op implementation.
- Add Supabase implementation behind the interface.
- Local development defaults to no-op.

### Phase 2: Evaluation Job Recording

- Keep `POST /api/v1/evaluate` synchronous initially.
- Record one job row per request when Supabase is configured.
- Update the job row to `complete` or `failed`.
- Return `job_id` in the response when persistence is enabled.

### Phase 3: Async Evaluation

- Promote `POST /api/v1/evaluate` to optionally return `202 Accepted`.
- Add:
  - `GET /api/v1/jobs/{job_id}`
  - `GET /api/v1/jobs/{job_id}/result`
- Worker can be in-process first, then moved to a separate worker.

### Phase 4: Shared Cache Metadata

- Write bundle evaluation cache metadata after bundle evaluation completes.
- Use Supabase metadata to show cache status before loading a run.
- Keep the actual heavy result file outside Postgres.

## Security

- Backend uses service role key only server-side.
- Frontend never receives Supabase service credentials.
- Public read policies are not required for Phase 1 because the FastAPI layer
  mediates access.
- If direct client reads are added later, expose only aggregate metadata and
  saved views, not raw job errors or internal paths.

## Open Questions

- Which object store should hold deployed result files: Supabase Storage,
  Vercel Blob, S3, or Hugging Face artifacts?
- Do we need user identity for saved comparisons, or are all saved objects
  workspace-global?
- Should repeated identical evaluate requests reuse an existing complete job
  by `request_hash`, or create a new audit row every time?
- What retention policy should apply to result objects and job rows?
- Should production disable local `.artifacts` writes entirely or keep them as
  a node-local warm cache?

## Recommended First Implementation

Implement only Phase 1 and Phase 2 first:

- Add no-op and Supabase persistence adapters.
- Add migrations for `diagnostics_evaluation_jobs`.
- Add `job_id` to `POST /api/v1/evaluate` when persistence is enabled.
- Keep all existing API behavior synchronous and backward compatible.

This gives us durable observability without forcing async worker design or
large-object storage decisions yet.
