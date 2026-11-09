# Staging contract fixtures for the build monitor's tests

`build-monitor.test.ts` ("version 3 outcomes") reads these three runs. They are copies,
unchanged, of the calibration tree package's staging contract fixtures, which the npm
package `@policyengine/calibration-tree` doesn't include. The package's fixtures are in
turn byte-identical copies of Microcosm's canonical producer fixtures.

| File under `v3/` | Git blob |
|---|---|
| `blocked/runs/uk-blocked-v3-fixture/progress.json` | `108e65248d67d09aff6dd35b0cd0b3c0b34203bc` |
| `blocked/runs/uk-blocked-v3-fixture/run_manifest.json` | `b00455782c161f9cb2e3ae9916f64b763ff0ea54` |
| `blocked/runs/uk-blocked-v3-fixture/events.ndjson` | `4de9633b4e765670148901778c4656a5675b4778` |
| `completed-spine/runs/uk-spine-v3-fixture/progress.json` | `073aea4cd0c7b1f1b22b2ce0852bf045c10b2536` |
| `completed-spine/runs/uk-spine-v3-fixture/run_manifest.json` | `e630819b84b81e5e951ab6f8dbf65fa7b2d253c4` |
| `completed-spine/runs/uk-spine-v3-fixture/events.ndjson` | `13336defdbfb41862d3abfff45e5b5c65e8c267e` |
| `failed/runs/uk-failed-v3-fixture/progress.json` | `a33052ed8b7595a88966796f690840e595230bf2` |
| `failed/runs/uk-failed-v3-fixture/run_manifest.json` | `285d33f81db11e23dc7395c22d92b71c8ebebeb8` |
| `failed/runs/uk-failed-v3-fixture/events.ndjson` | `a17c2837e2c2e7e8fd06e97c4fb687896a4d1cd4` |

Each equals the same path under `packages/calibration-tree/src/fixtures/staging-contract/v3/`
in PolicyEngine/microcosm-collector. The full set, its `SHA256SUMS` and the contract tests
that check them stay there. When a contract change updates these runs there, copy them here
again.
