# Progress: land Fable review findings on PR #182

Branch `max/calibration-serving-audit-20260910`, pushed to PR branch
`max/canonical-spm-runtime-20260909`. Starting head
`234f27c58361785d2833ab5528e367d4f8db9f59`; base `main`
`210f8a3f5cfe9cdee888f99820dfe13bad7223ea`.

## State

All four findings are landed in `2d4d2b2` with a regression test each, and every
test has been shown to fail at `234f27c` with only the test file copied in, and
to pass at `HEAD`. Every suite CI runs passes locally. Nothing pinned, locked or
numeric changed: `git diff --name-only 234f27c..HEAD` touches no
`hosted_release.json`, lockfile, manifest or dependency declaration.

## Findings landed (all [low], all actionable)

1. `backend/variable_endpoint.py:46-52` — the `runtime_audit` 502 discarded the
   cause. `LOGGER.exception("Runtime audit failed")` before returning, matching
   the calculation branch; `import logging` hoisted to module scope.
   Test: `frontend/tests/test_serving_audit.py::test_audit_failure_is_recorded_in_the_backend_log`.
2. `frontend/lib/api/variable-backend.ts:141-145` — the redirect-limit branch was
   unreachable. Leave the loop on the seventh consecutive 303 so it is reported
   as the redirect limit, not as a response without JSON. The number of
   redirects actually followed is unchanged (six).
   Test: `frontend/lib/api/variable-backend.test.ts` "a backend that only
   redirects is reported as exceeding the redirect limit".
3. `backend/variable_endpoint.py:64-71` + `frontend/lib/api/variable-backend.ts:49-59,190-193`
   — `metadata=1` now runs `validate_selection` on the deployment's resolved
   repo/revision/filename (503 on conflict), and the proxy compares the reported
   `environment_configuration` with the reviewed release (409 on mismatch).
   Tests: `frontend/tests/test_modal_endpoint.py::test_metadata_validates_the_deployment_data_configuration`
   and `frontend/lib/api/variable-backend.test.ts` "metadata must match the
   backend deployment's own data selection".
4. `frontend/lib/microcosm/latest-artifact.ts:91-114` — the reviewed-selection
   assertion moved out of the module-scope table build into `countryRepository()`,
   so a US-only override conflict refuses US reads instead of throwing during
   import and taking down UK/BE routes, pages and `next build`. The webhook
   allowlist resolves per request; the two unchecked US repository exports are
   gone.
   Test: `frontend/lib/microcosm/reviewed-repository-import.test.ts` (child-process
   fixture, both the conflicting and the reviewed deployment).

## Verification

Fail-before / pass-after, each test run alone against a detached `234f27c`
worktree carrying only the new test files:

| finding | pre-fix | post-fix |
| --- | --- | --- |
| 1 serving-audit log | exit 1 | exit 0 |
| 2 redirect limit | exit 1 | exit 0 |
| 3 backend metadata | exit 1 | exit 0 |
| 3 proxy environment | exit 1 | exit 0 |
| 4 module import | exit 1 | exit 0 |

Full suites at `HEAD` (exit codes from a non-piped run):

| suite | command | exit | result |
| --- | --- | --- | --- |
| dependencies | `uv pip check` | 0 | 99 packages compatible |
| hosted runtime | `uv run --no-sync python frontend/scripts/verify_hosted_runtime.py` | 0 | `source_api_imports: passed` |
| native Python | `uv run --no-sync python -m pytest frontend/tests -q` | 0 | 46 passed (44 + 2 new) |
| Bun | `bun test` | 0 | 345 pass, 0 fail (341 + 4 new) |
| dev port | `bun run test:dev-port` | 0 | 0 fail |
| typecheck | `bun run lint` (`tsc --noEmit`) | 0 | clean |
| build | `bun run build` (`next build`) | 0 | all routes built |

`pytest tests -q` (the root evaluation harness, not in `.github/workflows/ci.yml`)
needs the evaluation dependencies rather than the Modal backend lock. In a venv
with them it is 440 passed, 1 skipped, exit 0 at both `234f27c` and `HEAD`.

## Done

- [x] Verified clean worktree at `234f27c`.
- [x] Read every file named in the findings and their existing tests.
- [x] Landed fixes 1-4 with a regression test each.
- [x] Proved each regression test fails at `234f27c` and passes at `HEAD`.
- [x] Ran every suite CI runs, plus the root evaluation harness.
- [x] Confirmed no pinned, locked or numeric asset changed.

## Next

- [ ] Independent adversarial review of the landed fixes.
- [ ] Re-verify the remote ref, force-with-lease push, watch `gh pr checks 182`.
