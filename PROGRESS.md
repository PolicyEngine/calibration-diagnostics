# Progress

## State

Pre-edit review is complete on `spec-artifact-contract`, based exactly on
`spec-countries-registry` at `9bf2fd4`. The implementation will preserve the
legacy name/filter paths while selecting new adapters from artifact shape.

## Done

- Read the complete PR B design brief.
- Read `docs/spec-driven-countries.md` and the third-country conformance test.
- Confirmed the worktree was clean and created the requested branch without
  modifying PR A.
- Read every requested artifact reader/shaper, both client views, client response
  types, source-label consumers, existing tests, and the ZZ/BE fixtures.
- Recorded the baseline frontend gate: `240 pass`, `3 todo`, `0 fail`, and
  `983 expect()` calls across 31 files.
- Traced direct and indirect consumers of enriched target rows. GitNexus built a
  local index, but sandboxed home-directory registry access prevented queries;
  repository-wide symbol/import searches supplied the fallback blast-radius
  review, and the generated index was removed.

## Next

- Implement and test the typed `presentation` reader and artifact → legacy →
  generic view-copy fallbacks.
- Implement publisher labels, structured dimensions, and structured
  source/variable identifiers in separately committed steps.
- Enable and extend conformance tests, add regressions, and document B1-B6.
- Run the full frontend test, type-check, and production-build gates.
