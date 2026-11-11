# Release history

Release history measures every published national Microcosm release of a
country on one fixed reference model, so a move between two releases comes
from the data, not the model (calibration-diagnostics#224). This document
covers the backend: what is measured, where it is stored, when it is
regenerated, and how to add a country. The dashboard page is a later PR.

## Concepts

- **Series**: one country's published release builds of the releases its spec
  names, in release order, as the dashboard's release picker lists them (the
  calibration-tree manifest's release entries, each pinned to a Hugging Face
  commit), less builds `releases.json` marks withdrawn.
- **Point**: one build of the series. Its release manifest is re-read at the
  pinned commit; only a default national release with
  `default_datasets.national` is measured, and its national H5 is checked
  against the manifest's sha256 before anything opens it.
- **Reference engine**: the country's pinned policyengine.py bundle (model
  package and policyengine-core), in `release_history/countries/<code>/uv.lock`.
- **Panel**: one country's reference engine, the producer version and the
  country's spec. Its id is the sha256 of exactly those, so a change to any of
  them gives that country, and only that country, a new panel. Old panels stay.
- **Measurement**: one point on one panel, stored once and never replaced.

## Layout

```text
release_history/
  pyproject.toml, uv.lock          the shared producer; pins no engine
  src/release_history/             spec, references, engine, releases, simulate,
                                   measure, disclosure, local_store, export, cli
  tests/                           run on a fake model; no data, no engine
  countries/<code>/
    spec.yaml                      what to compute (its number-changing part is in the panel id)
    references.yaml                official references (not part of the panel id)
    references.lock.json           references resolved from Chronicle (generated)
    pyproject.toml, uv.lock        the country's reference engine
frontend/lib/microcosm/release-history-store.ts   Blob layout, manifest, plan, finalize, timeline
frontend/scripts/release-history.ts               plan | upload | finalize | pull | timeline
.github/workflows/release-history.yml             weekly top-ups and manual runs
```

Python does everything that touches PolicyEngine, an H5 or Chronicle.
TypeScript does everything that touches Blob or the dashboard's release
inventory.

## The spec

`countries/<code>/spec.yaml` holds everything country-specific; no code
branches on a country code. Its main parts:

- `series.releases`: release names (a build folder `<release>/<build>` counts
  as its release) or `^` regular expressions. `series.exclude` holds regular
  expressions matched against each build's release folder and its release id, so
  a pattern can drop a whole release or a single build (the UK series leaves out
  its 2 Oct and 14 Oct 2026 cuts, whose 14-digit household ids overflow the
  engine's 32-bit integers).
- The panel id hashes the spec without the parts that change no number: the
  series, the schedule, the runner limits, and each reform's label and source.
  Editing those keeps the panel and its points; any other edit starts a new panel.
- `engine.module` (`policyengine.<module>.managed_microsimulation`) and
  `engine.model_package`.
- `periods`, `period_label` (`fiscal_year` labels 2026 as 2026-27).
- `variables`: the names the fixed output vocabulary needs: household net
  income, the budget (`plus` and `minus` variables; it must measure the
  government balance, so a tax rise is positive), the income decile, poverty
  flags and person groups (`all: null` plus any boolean).
- `baseline`: the variables list. Each item is a `sum`, a `count` (weighted
  count where positive), a `mean` (a rate for booleans) or a `population`
  (weighted count of an `entity`), optionally `where` a group and `by:
  income_decile`. Plain `tax` and `benefit` sums are programmes: reforms report
  the change in each.
- `reforms`: `add` puts a delta on the reference model's own baseline value in
  each period (HMRC's "baseline plus illustrative change", as the scorecard's
  reckoner lane does), `scale` multiplies it, `parameters` sets a value.
  `targets` names the variables whose change is reported.
- `outputs`: the output levels (`targets`, `budget`, `distribution`,
  `poverty`); a reform may narrow them.
- `disclosure`, `runner.max_dataset_bytes`, `schedule` (`weekly` or `manual`).

### What a measurement holds

A flat list of cells, each with an output id, a period, a unit, a value and a
status:

- `baseline/<item>` and `baseline/<item>/decile_<d>`;
- `reform/<id>/target/<variable>`;
- `reform/<id>/budgetary_impact` and `reform/<id>/programme/<item>`;
- `reform/<id>/households_gaining|households_losing|people_gaining|people_losing`
  (a change of at least one unit of currency, as policyengine.py's
  `ChangeAggregate` counts it);
- `reform/<id>/net_income_change_pct` and
  `reform/<id>/decile_relative_change/decile_<d>`;
- `reform/<id>/poverty/<measure>/<group>`.

A reform that crashes contributes no cells and records its error class and
stage: a gap, never a zero. Values are unrounded. Each point also records its
provenance (below), the H5's column digest and the columns the model does not
define (pe-uk drops those silently), the warning classes raised, and each
simulation's seconds and peak memory.

## References

`countries/<code>/references.yaml` gives every baseline item and reform one
reference: `chronicle_records` (Chronicle source-record ids, summed), a
`citation` for a source Chronicle does not hold yet, or `none` with a reason.
`sign` maps an official figure onto PolicyEngine's sign (a cost is negative),
and `basis` says how comparable it is (`forecast`, `outturn`,
`post_behavioural`, `partial`, `approximation`, `mechanical`).

Chronicle's consumer artifacts are large and built locally, so references are
resolved once into a committed lock:

```bash
uv run --project release_history/countries/uk release-history resolve-references --country uk \
  --facts <consumer_facts.jsonl> --manifest <manifest.json>
```

The command checks the artifact against the pinned digests, requires each
record to match exactly one fact, and writes every value with its record id,
semantic fact key and period. Publisher figures are never typed by hand.
`validate-spec` fails while the lock is stale. References are not part of the
panel id: updating them rebuilds the timeline and re-measures nothing.

The UK references pin the Chronicle commit Microcosm's UK calibration feed
uses. Its receipts and spending come from the OBR EFO of October 2026 and its
caseloads from DWP's spring 2026 tables (Great Britain). HMRC's ready reckoner
is not in Chronicle yet, so the reforms cite its rows and the scorecard
registry entries that map them.

## Adding a country

1. Register the country in `@policyengine/calibration-tree`'s `countries.ts`
   (see [spec-driven countries](spec-driven-countries.md)) and publish a
   release with calibration diagnostics, so the release picker lists it.
2. Add `release_history/countries/<code>/` with `spec.yaml`,
   `references.yaml`, and a `pyproject.toml` pinning
   `policyengine[<code>]==<version>`; run `uv lock` there.
3. Run `resolve-references`, then `validate-spec`, which checks every
   variable, entity and parameter path against the reference model.
4. Measure one release locally (below), then dispatch the workflow with
   `mode=backfill`. Set `schedule: weekly` once the numbers look right.

## Local runs

```bash
cd release_history/countries/uk
uv run release-history validate-spec --country uk
uv run release-history measure --country uk \
  --revision microcosm-uk-2024-25-national-20261107T020434Z-eeb6093e --out <dir>
uv run release-history export --country uk --dir <dir> --output panel.csv
```

`measure` writes the same layout as the Blob store; `--h5` reuses a local copy
of the national file, still checked against the manifest. With access to the
`policy-engine/calibration-diagnostics` Vercel project, the store can be read
in its Storage tab, or pulled with the project's `BLOB_READ_WRITE_TOKEN`:

```bash
cd frontend
bun run scripts/release-history.ts pull --country uk --out <dir>
bun run scripts/release-history.ts timeline --country uk --root <dir> --panel <panel-id>
```

## Storage

Private Vercel Blob, laid out like the calibration trees:

```text
release-history/manifest.json                                 one entry per country; ETag-conditional
release-history/<country>/<panel-id>/panel.json               engine, environment, producer, full spec
release-history/<country>/<panel-id>/<measurement-id>.json    one point; immutable
release-history/<country>/<panel-id>/references.json          the references lock; replaced each run
release-history/<country>/<panel-id>/timeline.json            every number in release order; rebuilt
```

The manifest holds each country's pinned and current panel and, per panel, its
points (state, measurement status, attempts, withdrawn). Every manifest write
is conditional on the version read, re-applied on a lost race, and never
unconditional; a country's run touches only its own entry.

`timeline.json` holds, for each output and period, its values in release
order, the change from the nearest earlier release that has the cell
(relative for money and counts, in percentage points for rates), and the
output's official reference. It is rebuilt from the stored points on every
run, with no simulation, so a definition change never re-measures. Pooled
summaries (typical and 1-in-10 revisions, windows, floors) belong to the page.

## Regeneration

- **New release**: the weekly run (Mondays, for `schedule: weekly` specs)
  measures builds the country's complete panel lacks. A manual `topup` does
  the same at any time; `release` measures one build.
- **Engine bump**: a PR bumps one country's `pyproject.toml` and `uv.lock`,
  typically when policyengine.py changes that country's model or core pin or a
  model fix matters. Only that country's panel id changes. Its backfill runs
  only on a manual `backfill` dispatch; until it completes, the country keeps
  serving its current panel and the weekly run skips it with a note. When the
  new panel is complete it becomes current; the old one is kept, which gives an
  engine-axis comparison for every point.
- **Spec change**: the same, for that country only.
- **Producer change**: bump `PRODUCER_VERSION` for any change that can alter a
  stored number (never for a refactor). Every country gets a new panel id;
  each backfill is still dispatched on its own.
- **Reference change**: no re-measurement; the next run rebuilds the timeline.
- **Never redone**: a finished point. A run that writes no point (a download
  failure, a killed runner) counts an attempt; after three the point is
  `failed`. Deterministic outcomes (not a default national release, a sha256
  mismatch, a file the model cannot load) are stored and show as gaps.

## Cost

Cost is set by the number of simulations: one baseline plus one per reform,
each covering every period, one alive at a time. Reading many outputs from one
simulation is close to free, so specs stay small on reforms and periods and
generous on outputs. The simulations use the lazy country-package path, which
computes only what is asked for. A `targets`-only reform computes its target's
dependency chain and nothing else. Points over `runner.max_dataset_bytes` are
recorded as `skipped: exceeds_runner_budget`, never half-run. Runs use
GitHub-hosted runners, free for this public repository.

Measured on 2026-11-09, for one UK point (the national cut of 7 November,
78,181 households) on a laptop. The baseline took 43 seconds and each of the
seven reforms 80 to 95 seconds, so the point took 11 minutes in all. Each
simulation peaked at 5.4 to 7.8 GB, inside a 16 GB runner. Expect a standard
runner to take about one and a half to two times as long. A weekly top-up is
then two or three points, and a backfill of the series about 13, run six at
a time.

The US trial spec, on the certified release of 15 September (57,240
households, targets-only reforms), took about three minutes per simulation
and peaked at 7.0 GB. The dense national releases are about six times larger,
which is what the US trial on a runner, and `runner.max_dataset_bytes`, are
for.

## Disclosure

The policy runs inside the producer, before anything leaves the runner.
`none` checks nothing (public microdata). `source_household_small_cells` (the
UK) withholds any cell resting on one or two distinct survey households
(`household_source_id`; Microcosm clones count once), and inside each table
(deciles and their total; poverty groups; programme changes and the
budgetary impact) also withholds partners so that nothing derivable from a
published total rests on one or two. A rate needs its numerator and its
complement each at zero or at least three. Changes between releases compare
different datasets; a change beside a withheld cell is withheld. Differences
across poverty measures, periods and reforms are not checked. Stored: a
status and reason per cell, never a support count. A UK file without source
ids is refused.

## Provenance kept for later

Each point records the release id, build or cut tag, publication time,
repository and commit, the release and build manifests' paths and digests,
the H5's path, digest and size, the release's built-with model and declared
compatible range (and whether the reference model is inside it), and from the
build manifest the Microcosm code commit, target surface digest and size,
target registry version and household weight basis. Each panel records the
engine (bundle digest, model and core versions), the resolved environment,
the producer version and commit, and the full spec. This is what a later view
needs to explain a move: diffs between consecutive points joined to their
build manifests (the data axis), and the same point across panels (the engine
axis, including probe panels for any engine version).

## Workflow safety

The repository is public and the UK data are licensed. The workflow runs only
on `workflow_dispatch` and its weekly schedule, never on pull requests. Logs
carry ids, statuses and timings; library output goes to a private file that
is never printed or uploaded; nothing is stored as an Actions artifact or
cache; points go straight to private Blob. The repository variable
`RELEASE_HISTORY_ENABLED=FALSE` stops it.
