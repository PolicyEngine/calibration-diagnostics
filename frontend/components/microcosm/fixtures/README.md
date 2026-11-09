# Target row label fixtures

`target-row-labels.test.ts` reads these three files. They are copies, unchanged, of
the calibration tree package's own fixtures, which the npm package
`@policyengine/calibration-tree` doesn't include:

| File | Copied from `packages/calibration-tree/src/fixtures/` in PolicyEngine/microcosm-collector | Git blob |
|---|---|---|
| `ed-fsa-family/ed-fsa-family-schema-8.json` | `ed-fsa-family/ed-fsa-family-schema-8.json` | `6c5b104ee97f6b489fc5ac55200dec51126b3dca` |
| `mixed-groupby-storage/hierarchy-probe-targets.json` | `mixed-groupby-storage/hierarchy-probe-targets.json` | `46b4ca5ba99411ba4ade3dfe6cbb783bec81b587` |
| `mixed-groupby-storage/listed-dimension-targets.json` | `mixed-groupby-storage/listed-dimension-targets.json` | `20b7dea514e5d148a726c30e99ce1c7540b81af7` |

The scripts that generate them (`ed-fsa-family/build_fixture.py` and
`mixed-groupby-storage/compile_targets.py`) and the package's tests that read them stay
in the collector. When a fixture is regenerated there, copy it here again.
