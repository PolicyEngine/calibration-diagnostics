# Progress

## State

All server-side B1-B4 artifact readers and adapters are implemented. The legacy
US name and UK/BE filter paths remain intact and are selected per row.

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
- Added the defensive diagnostics-dimension reader, structured geography and
  breakdown shaping, dictionary value labels/order, unknown-id humanization,
  rank-aware facet sorting, and dimensioned-scope handling.
- Recorded `dimension_adapter` per row and `target_schema` per calibration and
  response, with matching client types.
- Enabled the existing ZZ structured-facet conformance assertion unchanged;
  the focused artifact/conformance suite now has `67 pass`, `0 todo`, and
  `0 fail`.
- Added structured source/variable object readers with Chronicle/source/name
  and variable/metadata/name precedence, plus source citation/URL and variable
  label/measure propagation.
- Added the fifth ZZ conformance test (`9 pass`, `0 todo`) and an exact
  JSON-shaped schema-5 US regression for the dotted BEA NIPA row.
- The focused artifact/conformance suite now has `70 pass`, `0 fail`, and
  `267 expect()` calls.

## Next

- Add the artifact → legacy → generic presentation fallbacks to both views.
- Make every row-aware publisher/variable display prefer artifact labels.
- Enable and extend conformance tests, add regressions, and document B1-B6.
- Run the full frontend test, type-check, and production-build gates.
