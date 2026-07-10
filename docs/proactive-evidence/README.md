# Proactive-diagnostics evidence (#101)

Verification artifacts for the "buildable now" slice of the proactive-diagnostics
epic ([#101](https://github.com/PolicyEngine/calibration-diagnostics/issues/101)).
All screenshots and outputs are from a local `next start` reading the **live**
`policyengine/populace-us` release resolved through `latest.json`
(`populace-us-2024-buildi-sparse-rmloss100-6e8e929-20260709T034135Z`).

## Screenshots

| File | View |
|---|---|
| `coverage-board.png` | New **Coverage** view — source coverage manifest (10 hard-target families, 25/41 aliases covered, 16 reviewed exclusions each linking its issue), with the input-column (populace#369) and reform-smoke (populace#368) sections in their graceful "not published for this release" state. |
| `certification-panel.png` | New **Certification** view — 13 gates (10 build-manifest + 3 side files), per-gate outcome / enforcement / evidence sha, forward-compatible with populace#381's `passed\|failed\|skipped\|waived` schema. |
| `overview-delta-banner.png` | Overview with the **"since you last looked"** banner (localStorage seeded to the prior release): 4 beyond-band flags, top-mover chips, and the flag bullets. |

## Delta script (two real releases)

`delta-alert-output.txt` — `bun run scripts/populace-delta-alert.ts` computing
latest vs the previous registry release, with the Slack webhook **unset** (the
no-op log path). It flags the +12.4pp within-10% jump, the −83% targets-included
drop, the changed target surface, and a real 27→25 source-coverage shrink.

## Badge endpoints

`badge-endpoints.txt` — the three shields.io endpoints served live:
`default-release → buildi`, `gates → 11/11 (brightgreen)`,
`within10 → 88.9% (brightgreen)`.

## Verification (exit codes)

```
bun run lint   (tsc --noEmit)   → exit 0
bun test                        → exit 0   (80 pass, 0 fail, 10 files)
bun run build  (next build)     → exit 0   (all new routes + pages emitted)
```
