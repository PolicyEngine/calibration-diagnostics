# Progress

## State

The typed presentation and publisher-label contracts are implemented. The
legacy name/filter paths remain intact while new adapters are added by artifact
shape.

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
- Added the validated, length-capped `release_manifest.presentation` reader and
  propagated it through calibration, summary, diagnostics-page, and client
  types.
- Enabled the existing ZZ presentation conformance assertion unchanged and
  added reader/response tests.
- Added validated `release_manifest.publisher_labels`, stamped every enriched
  row with `source_label`, and propagated labels through variable summaries,
  target responses, treemap groups, and client types.
- Enabled the existing ZZ publisher-label conformance assertion unchanged.

## Next

- Implement structured dimensions and structured source/variable identifiers
  in separately committed steps.
- Add the artifact → legacy → generic presentation fallbacks to both views.
- Enable and extend conformance tests, add regressions, and document B1-B6.
- Run the full frontend test, type-check, and production-build gates.
