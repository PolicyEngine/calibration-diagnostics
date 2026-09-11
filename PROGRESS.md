# Progress: land Fable review findings on PR #182

Branch `max/calibration-serving-audit-20260910`, pushed to PR branch
`max/canonical-spm-runtime-20260909`. Starting head
`234f27c58361785d2833ab5528e367d4f8db9f59`; base `main`
`210f8a3f5cfe9cdee888f99820dfe13bad7223ea`.

## State

Worktree verified clean at the starting head. Toolchains being provisioned in
this worktree (`frontend/node_modules` via `bun install --frozen-lockfile`,
`.venv` via the CI recipe in `.github/workflows/ci.yml`).

## Findings to land (all [low], all actionable, each needs a regression test)

1. `backend/variable_endpoint.py:44-47` — runtime_audit 502 discards the
   exception; log it like the calculation branch does.
2. `frontend/lib/api/variable-backend.ts:115-191` — redirect-limit branch is
   unreachable; the seventh consecutive 303 is misreported as non-JSON.
3. `backend/variable_endpoint.py:58-67` + `frontend/lib/api/variable-backend.ts:165-174`
   — `metadata=1` skips `validate_selection`, and the proxy ignores
   `environment_configuration`, so a stale `POPULACE_HF_REPO`/`POPULACE_HF_REVISION`
   override passes the metadata gate and fails every calculation with 503.
4. `frontend/lib/microcosm/latest-artifact.ts:78-96` — `assertReviewedRepository`
   runs for every country at module import, so a US-only override conflict takes
   down UK/BE routes and `next build`. Assert lazily at US request time.

## Done

- [x] Verified clean worktree at `234f27c`.
- [x] Read every file named in the findings and their existing tests.

## Next

- [ ] Baseline both suites (record counts/exit codes before any change).
- [ ] Land fixes 1-4 with regression tests.
- [ ] Full suites: pytest, bun test, typecheck, build.
- [ ] Commit, re-verify remote ref, force-with-lease push, watch CI.
