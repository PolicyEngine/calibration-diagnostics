# Release history

Release history measures every published national Microcosm data file of a
country on one fixed reference model, so a move between two releases comes
from the data, not the model (calibration-diagnostics#224). This document
covers the backend (what is measured, where it is stored, when it is
regenerated, and how to add a country) and the dashboard page that reads it.
For a short overview, and the discussion points for what comes next, see
[release-history-roadmap.md](release-history-roadmap.md).

## Concepts

- **Series**: one country's builds, as its release repository's
  `releases.json` lists them: every build the record holds under the release
  lines the spec names, published on or after the spec's `since` date. The
  `series` command reads the record and each build's release manifest at one
  commit of the repository's `main`, and writes the country's series record:
  per build its id (`<release>/<build>`), publish time, `current`, withdrawn,
  role and the sha256 of its national data file. A build with no file to
  measure (no release manifest; no default national file, or one that is not
  microdata or not pinned) is listed with its reason and never planned. A
  repository without `releases.json` has no series, and the plan says so.
- **Point**: one data file measured on one panel. Its id hashes the panel id
  and the file's sha256 only, so a file published under two builds is one
  point, and a file replaced under one build name is a new point. The file's
  release manifest is re-read at the listed commit, the file must be the one
  the series listed, and the H5 is checked against its sha256 before anything
  opens it. A point is written once and never replaced.
- **Reference engine**: the country's pinned policyengine.py bundle (model
  package and policyengine-core), in `release_history/countries/<code>/uv.lock`.
- **Panel**: one country's reference engine, the producer version, the point
  format version and the spec's number-changing part. Its id is the sha256 of
  exactly those (`panel_key`), so a change to any of them gives that country,
  and only that country, a new panel. Old panels stay.
- **Pinned panel**: the panel of the engine the default branch pins. Only runs
  of the default branch pin; the served (current) panel moves only to a
  complete pinned panel.

## Layout

```text
release_history/
  pyproject.toml, uv.lock          the shared producer; pins no engine
  src/release_history/             spec, series, references, engine, releases, simulate,
                                   measure, disclosure, document, local_store, export, cli
  schemas/                         JSON Schemas of the point, panel, series record, labels,
                                   timeline, attempt report and planned point
  tests/                           run on fake and synthetic models; no data, no engine
  tests/fixtures/<code>/           each country's documents, from its spec on a synthetic world
  countries/<code>/
    spec.yaml                      what to compute (its number-changing part is in the panel id)
    references.yaml                official references (not part of the panel id)
    references.lock.json           references resolved from Chronicle (generated)
    pyproject.toml, uv.lock        the country's reference engine
frontend/lib/microcosm/release-history-store.ts   Blob layout, manifest, plan, finalize, timeline
frontend/scripts/release-history.ts               plan | upload | finalize | pull | timeline
.github/workflows/release-history.yml             weekly top-ups and manual runs
frontend/app/api/microcosm/release-history/       the page's read routes: summary, timeline, export
frontend/app/microcosm/release-history/           the page
frontend/lib/microcosm/release-history-*.ts       the page's logic: summary, outputs, chart, moved, builds, url
frontend/components/microcosm/release-history-*   the page's view, chart and step card
frontend/scripts/release-history-dev-store.ts     a synthetic store for local development
```

Python does everything that touches PolicyEngine, an H5, the release
repository or Chronicle. TypeScript does everything that touches Blob.

## The spec

`countries/<code>/spec.yaml` holds everything country-specific; no code
branches on a country code. Its main parts:

- `series.releases`: release line names, exactly as `releases.json` names
  them. `series.since` (optional, `YYYY-MM-DD`) starts the series at a
  publish date, compared in UTC. Patterns and `series.exclude` are refused.
  The UK series starts on 19 October 2026: its 2 Oct and 14 Oct cuts number
  households with 14-digit ids, which overflow the engine's 32-bit integers,
  so the disclosure check cannot match them to their survey households.
- The panel id hashes the spec without the parts that change no number: its
  own `schema_version`, `release_repo`, the series, the runner limits, and the
  label, source, note and description of every baseline item and reform.
  Editing those keeps the panel and its points; any other edit starts a new
  panel. The spec format only grows: a key is added with an absent value
  meaning the old behaviour, and the hashed form is the spec as written, so no
  default ever enters it. Each country's spec digest and panel id are pinned in
  the tests, so an accidental change fails there.
- When a country runs is not in the spec (a `schedule` key is refused): the
  repository variable `RELEASE_HISTORY_WEEKLY` switches weekly top-ups on per
  country, with no pull request.
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
- `disclosure`.
- `runner`: `max_dataset_bytes`, `max_seconds` (the measure step's time limit)
  and `max_memory_bytes` (the runner's memory). A file over the size budget
  fails at once; a file that uses 80% of any of the three is flagged. The
  runner block is outside the panel id.

### What a point holds

A flat list of cells, each with an output id, a period, a unit, a value, a
status and a reason (null unless withheld):

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
simulation's seconds and peak memory. A point holds no listing fact: no
publish time, no `current`, no withdrawn flag.

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
panel id: they are held once per country, and updating them rebuilds every
panel's timeline and re-measures nothing.

The UK references pin the Chronicle commit Microcosm's UK calibration feed
uses. Its receipts and spending come from the OBR EFO of October 2026 and its
caseloads from DWP's spring 2026 tables (Great Britain). HMRC's ready reckoner
is not in Chronicle yet, so the reforms cite its rows and the scorecard
registry entries that map them.

## Adding a country

1. Register the country in `@policyengine/calibration-tree`'s `countries.ts`
   (see [spec-driven countries](spec-driven-countries.md)), with the release
   repository the spec names, and publish its releases with a `releases.json`
   (microcosm-emitter's release writer), so the series has a record to read.
2. Add `release_history/countries/<code>/` with `spec.yaml`,
   `references.yaml`, and a `pyproject.toml` pinning
   `policyengine[<code>]==<version>`; run `uv lock` there.
3. Run `resolve-references`, then `validate-spec`, which checks every
   variable, entity and parameter path against the reference model, then
   `series` to see the builds it lists. The tests make the country's fixtures
   from its spec on a synthetic world (`UPDATE_FIXTURES=1`), and pin its spec
   digest and panel id.
4. Measure one file locally (below), then dispatch the workflow with
   `mode=backfill` on the default branch, which pins the country's first
   panel. Add the country's code to `RELEASE_HISTORY_WEEKLY` once the numbers
   look right.

## Local runs

```bash
cd release_history/countries/uk
uv run release-history validate-spec --country uk
uv run release-history series --country uk --out <dir>
uv run release-history measure --country uk --point '<planned point>' --out <dir>
uv run release-history export --country uk --dir <dir> --output panel.csv
```

`series --out` writes the country's `series.json` into the store folder.
`measure --point` takes a planned point, as `bun run scripts/release-history.ts
plan --plan-out <file>` writes them: `build_id` and `release_directory`
(`<release>/<build>`), `hf_repo`, `hf_commit` (the series record's commit),
`digest` (the build's file), `attempt` and `last_attempt`. `--revision` instead
takes a cut tag or commit and measures whatever file its manifest names; `--h5`
reuses a local copy of the national file, still checked against the manifest.
A failure the run causes writes the file's attempt report and exits 3; a
transient one exits 75. A run that uses 80% of a runner limit prints a GitHub
Actions warning.

`--build-dir <folder> --build-id <release>/<build>` measures a build folder
before it is published, as a Microcosm post-build step would: it reads the
folder's `release_manifest.json`, `build_manifest.json` and national file with
no Hugging Face read, records no commit, and never deletes the folder's file.
The point is written to `--out` like any other. Nothing calls it today: the
workflow measures published builds, and handing a post-build point to the
collector is not built.

`export` reads the panel's `timeline.json` when there is one (the document the
TypeScript side writes, in camelCase): one row per build and output, with the
change from the build before it on the series, in percentage points for rates,
and the official reference. Without one, it reads the stored points, joined to
the builds of `series.json` by file. With access to the
`policy-engine/calibration-diagnostics` Vercel project, the store can be read
in its Storage tab, or pulled with the project's `BLOB_READ_WRITE_TOKEN`:

```bash
cd frontend
bun run scripts/release-history.ts pull --country uk --out <dir>
bun run scripts/release-history.ts timeline --country uk --root <dir> --panel <panel-id>
```

`pull` brings the manifest, the country's series record, references and
labels, and one panel's folder. `timeline` needs the country's `series.json`
under `--root`.

## Storage

Private Vercel Blob, laid out like the calibration trees:

```text
release-history/manifest.json                                 one entry per country; ETag-conditional
release-history/<country>/series.json                         the series record; replaced by runs that pin
release-history/<country>/references.json                     the references lock; replaced by runs that pin
release-history/<country>/labels.json                         reform labels and sources; replaced by runs that pin
release-history/<country>/<panel-id>/panel.json               the panel key, the hashed spec, the engine; written once
release-history/<country>/<panel-id>/<measurement-id>.json    one point; immutable
release-history/<country>/<panel-id>/attempts/<sha256>.json   a file's latest failed attempt; replaced
release-history/<country>/<panel-id>/timeline.json            every number on the series axis; rebuilt
```

The manifest holds each country's pinned and current panel and, per panel, its
engine, when it was created and last pinned (`pinnedAt`), its coverage of the
series (builds, files, and files measured, gaps, retrying, failed and never
run) and its points, keyed by file sha256: state, measurement id and status,
attempts, last error and stage, last build, and the runner limits its stored
point came within 20% of. Every panel ever filled stays
listed with its engine, so a page can offer each engine's timeline and say
which builds an engine has no point for. Every manifest write is conditional on
the version read, re-applied on a lost race, and never unconditional; a
country's run touches only its own entry.

Only a run of the default branch's engine (the workflow passes `--pin` to
`plan`, `upload` and `finalize` on the default branch) pins: it moves the
pinned panel, and the current (served) panel once that panel is complete,
replaces the country's series record, references and labels, and rebuilds
every panel's timeline. A country's first panel is pinned only by a run that
measures its whole series, a top-up or a backfill. A run dispatched from
another ref fills the panel of the engine
that ref pins, rebuilds only that panel's timeline, and leaves the country's
files and both pointers as they are, so an unmerged spec never reaches the
served page.

`timeline.json` holds, for each build of the series record in publish order,
its file, state and point, whether the reference model is inside the range the
build declares, the file's columns the model does not define (it drops
them), and what the build its point was fetched through declares (`declared`:
its built-at time, the model and core it was built with, the range of models
it declares, its Microcosm repository and commit, its target set's digest and
size, the target registry version and the household weight year; null where
the panel holds no point, and absent from a timeline written before the page
needed it); and for each output and period, one value per
build, the change from the previous build on the series when both hold the
cell (relative for money and counts, in percentage points for rates), and the
output's official reference. A withdrawn build is listed but is never a
neighbour; a point whose file the series no longer lists never plots; a
withheld value carries its status and no reason (the point keeps the reason).
The timeline is rebuilt from the stored points and the series record on every
run, with no simulation, so a corrected publish time or a definition change
never re-measures. Pooled summaries (typical and 1-in-10 revisions, windows,
floors) belong to the page.

## The page

`/microcosm/release-history?country=<code>` draws one panel's `timeline.json`.
It is reachable by URL and has no navigation entry yet: that needs a
capability in `@policyengine/calibration-tree`'s `countries.ts`, a change in
PolicyEngine/microcosm-collector. Nothing in the page or its routes branches
on a country code. A country the dashboard does not serve gets the
not-configured state, and one with no measured file an empty state.

Three routes read the store on the server, so the browser never receives a
Blob URL or a token. Each requires `?country=`.

- `GET /api/microcosm/release-history`: the country's panels from the
  manifest, one per reference engine that holds a measured file, with engine,
  coverage and whether the definition equals the default panel's, and the
  panel the page opens. It leaves the per-file entries out.
- `GET /api/microcosm/release-history/timeline?panel=<id>`: one panel's
  summary, its whole `timeline.json`, and what its `panel.json` says about
  presenting its outputs (currency, period labels, the baseline items and
  reforms in spec order, the disclosure policy). Without `panel` it serves the
  panel the page opens. Only a panel the country's manifest entry lists is
  read.
- `GET /api/microcosm/release-history/export?panel=<id>`: the same timeline
  as a CSV download, with the columns of `release-history export`.

A timeline grows with every build and a function's response is capped at
4.5 MB, which an uncompressed UK timeline reaches at about 70 builds, so the
timeline and the CSV are sent gzipped to a client that accepts it. A compact
encoding is the next step if a compressed timeline nears the cap.

**Which panel opens.** The served panel: the last pinned one that was
complete. After an engine bump the pinned panel fills first, a notice links
to it, and the page moves to it once it is complete. The engine toggle lists
every panel that holds a measured file, including one a run from another ref
filled, and says when a panel's definition differs from the default one's.

**State in the URL.** `panel` (the engine's panel), `output`, `period` (when
the panel measures more than one), `scale=absolute`, `step` (the build whose
step card is open) and `moved=all`. A default is never written, and a value
the page cannot use (a panel of another country, an output the panel does not
hold) falls back to its default.

**What it shows**, in order: notices about the engine on screen and the
builds it has no value for; the series facts; what moved at the latest build;
the builds of the series; and the outputs, with the selected output's chart,
official reference, step card and table. Its words are neutral: an output
"moved", and is "nearer to" or "further from" its official figure. It labels
every output and never prints an output's id.

- The chart has one column per build in publish order. Relative, the default,
  places each value as a percentage above or below the output's official
  figure (the timeline's `reference.modelSignValue`); Absolute places the
  values. An output with no official figure is drawn in values under both,
  with a note. A line joins two builds only where the timeline has a step.
- A build with no value keeps its column, shaded and labelled with why: not
  measured on this engine, retrying, out of attempts (the store's `failed`),
  file refused (the store's `gap`), withheld, or withdrawn. The builds an
  engine has no value for are also named in a notice.
- A withdrawn build is listed and marked. A value measured before the
  withdrawal is a hollow marker that no line joins.
- Marks under the axis: a new build engine (the file was built with another
  model version than the build before it), the same file published again, and
  a withdrawn build.
- What moved ranks outputs by their step beside their own typical step, the
  median of their earlier steps on the panel. A build that republishes a file
  is left out of that median, and an output with fewer than three earlier
  steps is ranked after the others by the size of its step.
- The step card sets what a step's two builds declare side by side (from the
  timeline's `declared` block), with links to their Microcosm commits and to
  each build's Calibration fit page.

**Withheld cells.** The page shows a withheld cell as "Withheld" and never as
a number. It removes every number from a cell or a step that is not `ok`
before anything is drawn, ranked or exported, and it computes nothing across
outputs: no sum of deciles, no total less its parts. What it does compute is
per output: the distance from the official figure, which is public, and the
typical step, from that output's published steps.

**Local development.** No production data is needed. `bun run
scripts/release-history-dev-store.ts --out <folder>` writes a synthetic store
(each country's committed fixtures and a seeded generator, through the real
finalize and timeline code), and the routes read a local folder in the
store's layout when `RELEASE_HISTORY_LOCAL_DIR` names it, in place of Blob:

```bash
cd frontend
bun run scripts/release-history-dev-store.ts --out ../.tmp/release-history-store
RELEASE_HISTORY_LOCAL_DIR=../.tmp/release-history-store bun run dev
```

The same variable opens a panel fetched with `pull`. It is unset on a hosted
deployment, which never reads its own filesystem.

## Document formats

Each stored document has its own format version: the point, the panel, the
series record, the labels, the attempt report and the references lock on the
Python side; the manifest and the timeline on the TypeScript side. Only the
point's is part of the panel id. An added field never moves a version: the
schemas in `release_history/schemas/` require version 1's keys, allow no
other, and declare a later key without requiring it. Maps copied from
upstream manifests, or keyed by reform ids, stay open. The tests check every
document of each country's fixtures against its schema, and every attempt
report and planned point the producer's tests write or read; the TypeScript
tests build each country's timeline fixture from the producer's. Both languages
type the documents from the same schemas: the producer's TypedDicts
(`release_history/documents.py`) are compared with them key by key
(`tests/test_documents.py`), and the TypeScript types are generated from them
(`frontend/scripts/generate-release-history-types.ts`), with a test that fails
while the generated file is stale. CI runs Pyright in strict mode on the producer.

## Regeneration

- **New release**: the weekly run (Sundays at 05:00 UTC, for each country
  listed in the repository variable `RELEASE_HISTORY_WEEKLY`) dispatches a
  top-up on the default branch: it measures every file the default branch's
  panel lacks. On the served panel that is the new builds; on a panel the page
  does not show yet (a country's first, or one after an engine, spec or
  producer change) it is the whole series, and the page moves to that panel
  once it is complete. A manual `topup` does the same at any time; `release`
  measures one build. A top-up dispatched from another ref is skipped. Weekly
  runs are off for every country while the variable is unset or empty.
- **The same release on another engine**: never automatic. Dispatch `release`
  (one build) or `backfill` from a ref whose country folder pins that engine,
  or run `measure` locally with that engine installed. The point lands in that
  engine's panel, and the pinned and served panels don't move.
- **Engine bump**: a PR bumps one country's `pyproject.toml` and `uv.lock`,
  typically when policyengine.py changes that country's model or core pin or a
  model fix matters. Only that country's panel id changes. The first top-up on
  the default branch after the merge pins the new panel and measures its whole
  series, at most 200 files a run (the rest the next week). The served panel
  stays on the earlier engine until the new panel is complete, then moves; the
  old panel is kept, which gives an engine-axis comparison for every file.
  Every country goes through the same steps.
- **Spec change**: the same, for that country only.
- **Producer change**: bump `PRODUCER_VERSION` for any change that can alter a
  stored number (never for a refactor), and the point format version for a
  change to what a point holds. Every country gets a new panel id; each
  backfill is still dispatched on its own.
- **Reference or label change**: no re-measurement; the next run that pins
  rebuilds every timeline.
- **Failures**: only results and the refusals a file itself causes (its source
  ids missing or misaligned) are stored. A failure the run causes (an
  unreadable repository, a download or digest failure, a model that cannot
  load, a reform that fails before the last attempt, a killed runner) stores
  no point: the leg uploads the file's attempt report, written before each
  stage and updated on a handled failure, and the file stays `retrying`. After
  its third attempt, or at once when the file is over the runner's budget, it
  is `failed`; a top-up or backfill never plans it again, and `retry` (all
  failed files, or one build's) starts it over. A cancelled run charges no
  attempt to a file whose leg left no report. A file's states: `measured`,
  `gap` (a stored refusal), `retrying`, `failed`, or never run.

## Cost

Cost is set by the number of simulations: one baseline plus one per reform,
each covering every period, one alive at a time. Reading many outputs from one
simulation is close to free, so specs stay small on reforms and periods and
generous on outputs. The simulations use the lazy country-package path, which
computes only what is asked for. A `targets`-only reform computes its target's
dependency chain and nothing else. A file over `runner.max_dataset_bytes` is
never opened: it fails at once (`exceeds_runner_budget`), and a `retry` after
raising the budget frees it. A run measures at most 200 files; the rest wait
for the next. Runs use GitHub-hosted runners, free for this public repository.

A file that uses 80% of a runner limit (20% short of it) is flagged: the
measure step's time (`runner.max_seconds`), the peak memory of its largest
simulation (`runner.max_memory_bytes`) or the file's size
(`runner.max_dataset_bytes`). The flag is a warning on the run's page, a
column in finalize's summary, and `nearLimits` on the file's manifest entry.
Each point records the limits it ran under (`runtime.limits`) and the ones it
came near, with the share used (`runtime.near_limits`): the producer computes
them once and finalize reads them. A plan of 160 files or more (80% of the
cap) is flagged the same way.

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
across poverty measures, periods and reforms are not checked, and neither
are differences between two engines' figures for one file: every country
takes the same steps at an engine move. Stored: a status and reason per cell,
never a support count. A UK file without source ids is stored as a gap.

## Provenance kept for later

Each point records the file (its sha256 and size), where it was fetched from
(the build id, repository and commit, the release and build manifests' paths
and digests, the file's path), what that build declared about the file (its
build name or cut tag, `migrated_from`, built-at time, built-with model and
core, declared compatible range and whether the reference model is inside it,
description, and from the build manifest the Microcosm code commit, target
surface digest and size, target registry version and household weight basis),
the environment it ran on (Python, platform, packages and the engine lock's
digest), the runner limits it ran under, and the producer version and commit;
a build folder measured before it is published has no commit. Publish times,
`current` and
withdrawn flags are listing facts and live in the series record, so a
corrected publish time re-orders the timeline with no re-run. Each panel
records its key, the hashed spec and the engine (bundle digest, model and core
versions). This is what a later view needs to explain a move: diffs between
consecutive points joined to their build manifests (the data axis), and the
same file across panels (the engine axis, including probe panels for any
engine version).

## Workflow safety

The repository is public and the UK data are licensed. The workflow runs only
on `workflow_dispatch` and its weekly schedule, never on pull requests. Logs
carry ids, statuses, counts and timings; an unexpected error prints its class
only; a near-limit warning names a build and a share of its limit; library output goes to a private file that is never printed or
uploaded; nothing is stored as an Actions artifact or cache; points and
attempt reports go straight to private Blob. Two repository variables control
it without a pull request: `RELEASE_HISTORY_WEEKLY` lists the countries whose
weekly top-ups run (space- or comma-separated codes, for example `uk us`;
unset runs none), and `RELEASE_HISTORY_ENABLED=FALSE` stops every run, manual
ones included.

It reads two repository secrets. `HF_RELEASE_READ_TOKEN` is the fine-grained
read-only token for the private release repositories that the deploy workflow
also reads; the US release repository is public. `RELEASE_HISTORY_BLOB_READ_WRITE_TOKEN`
is a read-write token for the Blob store the dashboard reads, and has to be
added before the first run. The workflow reads neither of the former tree
publisher's secrets, `HF_TOKEN` and `BLOB_READ_WRITE_TOKEN`.
