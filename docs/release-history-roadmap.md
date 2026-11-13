# Release history: how the backend works, and what comes next

This document goes with [release-history.md](release-history.md), the reference for the release history
backend (calibration-diagnostics#224).

- **PR 1 is the backend** (#304). **PR 2 is the page.**
- **Section 1** is a short overview of how PR 1 works.
- **Section 2** lists discussion points for PR 2.
- **Section 3** lists longer-term improvement points.
- **Only section 1 is decided.** Each point of sections 2 and 3 is a start for a discussion.
- **This document holds no build result and no survey figure.**

## 1. How PR 1 works

**The idea.** Release history measures every published national data file of a country on one fixed
engine. A move between two builds then comes from the data, not from the model.

**Five terms**

- **Series:** a country's builds, as its release repository's `releases.json` lists them. The spec names
  the release lines and can give a start date. A country with no `releases.json` has no series.
- **Engine:** one pinned policyengine.py bundle per country (the model package and policyengine-core).
- **Definition:** the part of the country's spec that can change a number: periods, baseline items,
  reforms, outputs and the disclosure policy.
- **Panel:** one definition on one engine with one producer version. Its id is a hash of those. A change to
  any of them starts a new panel for that country only. Old panels stay.
- **Point:** one data file measured on one panel. Its id hashes the panel id and the file's digest only. A
  file published under two build names is one point. A point is written once and never replaced.

**What a point holds**

- **Cells:** one per output and period, with a value, a unit and a status. The outputs are the baseline
  items (also by income decile) and each reform's results: budget impact, programme changes, households
  and people that gain or lose, the net income change (also by decile), and poverty.
- **Facts for later:** the file's digest; where it was fetched from; what its build declared (the Microcosm
  code commit, the model and core that built it, the digest and number of its targets, the target registry
  version); the environment and the digest of the engine lock.
- **No listing fact.** Publish time, `current` and withdrawn are in the series record. A corrected publish
  time re-orders the timeline with no re-run.

**The store** (a private Vercel Blob store, with the same layout for every country)

- **Per country:** the series record, the references and the labels. A run that pins replaces them.
- **Per panel:** `panel.json` (written once), the points (immutable), one attempt report per failed file
  (replaced), and `timeline.json` (rebuilt from the points and the series record, with no simulation).
- **One manifest:** per country, the pinned panel and the served panel. Per panel: its engine, when it was
  pinned, its coverage of the series, and the state of each file.
- **Checked shapes:** one JSON Schema each for the point, the panel, the series record and the timeline.
  Each country has test fixtures, made from its spec on a synthetic world.

**A run** has three jobs: plan, measure (one file per job, in parallel), finalize.

- **Modes:** `topup` (files that no pinned engine measured), `backfill` (the whole series), `release` (one
  build) and `retry` (failed files).
- **Split:** Python does everything that touches PolicyEngine, a data file, the release repository or
  Chronicle. TypeScript does everything that touches the store.

**What is automatic, and what is manual**

- **A new build: automatic,** once the weekly switch names the country. On Sundays at 05:00 UTC a top-up
  measures it on the engine that the default branch pins.
- **A country's first panel: manual.** One `backfill` dispatch on the default branch.
- **An engine bump: a pull request, then a backfill.** The pull request changes the country's engine lock.
  The next top-up measures the new builds on the new engine, plus the last build of the earlier engine, so
  that the first new build has a step. The served panel stays on the earlier engine until a manual
  backfill completes the new one. The earlier panel is kept.
- **A change to the definition or to the producer version:** the same steps as an engine bump.
- **One build on another engine: manual,** from a git ref that pins that engine.
- **A change to a label or to a reference:** no re-measurement. The next run rebuilds the timelines.
- **Two switches, with no pull request:** `RELEASE_HISTORY_WEEKLY` lists the countries with weekly runs. It
  is empty today. `RELEASE_HISTORY_ENABLED=FALSE` stops every run.

**Failures**

- **Stored for good:** results, and the refusals that a file itself causes.
- **Kept as states:** every failure that the run causes (an unreadable repository, a failed download, low
  memory, a failed reform). The file is `retrying`. After its third attempt it is `failed`. A file over the
  size budget fails at once. `retry` starts a failed file over.
- **A file's states:** measured, gap, retrying, failed, or never run.

**Disclosure**

- **The policy is in the spec, and it runs in the producer,** before anything leaves the runner.
- **The UK policy** withholds a cell that rests on one or two distinct survey households. Inside a table it
  also withholds a partner cell, so that a total gives nothing back. **The US policy is `none`.**
- **Stored:** a status and a reason per cell, never a support count. The timeline carries a withheld mark
  and no reason.
- **Not checked:** differences across poverty measures, periods and reforms; differences between two
  releases; and differences between two engines' figures for one file. Every country takes the same steps
  at an engine move.

**What is measured today**

- **UK:** seven tax reforms from HMRC's ready reckoner, and baseline items with official references. The
  series starts at the cut of 19 October 2026.
- **US:** a small trial spec with two reforms.
- **References:** every output has a Chronicle fact, a citation, or "none" with a reason. The references
  are in no panel id.

**What later work can rely on**

- **Every engine's panel stays,** with its coverage. An engine toggle needs no new stored data.
- **Each point keeps its build's facts.** They are the base for "what moved".
- **The timeline is derived.** Its shape can change at any time, at no cost to stored data.
- **The cost rule.** Ids and the content of a point are frozen. A change there costs a re-run or a
  migration. Everything else is free to change.

**Rules that later work keeps**

- No code branches on a country code. The storage is the same for every country.
- Every measured output carries an official reference.
- The page uses neutral words: "moved", "nearer to", "further from".
- Experimental schedules are weekly or manual. Backfills are manual.
- The UK data are licensed. The disclosure policy binds everything that people read.

**Next for PR 1, each a manual step:** after the merge, a UK dry run, one UK point and the UK backfill;
then the weekly switch.

## 2. Discussion points for PR 2: the page

A preview page exists, and the pull request links to it.

**P1. The first page**

- **Blocks to choose from:** a header; what moved; reform effects beside the official costing; baseline
  totals beside official figures; poverty rates; the table of builds.
- **Needs:** two read routes (the manifest summary, and one panel's timeline). The state lives in the URL.
- **To discuss:** which blocks come first.

**P2. The engine toggle**

- **What it does:** the same series under another engine. Every engine's runs are stored.
- **To discuss:**
  - Which engines the toggle lists. A start: those under the current definition.
  - Which panel opens after an engine bump. The served panel is the earlier engine, with no new build
    until the backfill. The pinned panel is the new engine, with a short series.
  - How a build with no run on the chosen engine shows. A start: a notice that names the missing builds.

**P3. What moved: the list**

- **What it does:** a short list of the outputs that moved most at the latest build.
- **To discuss:** the yardstick. A start: each output's own typical step, which needs no outside threshold.

**P4. What moved: the step card**

- **What it does:** a click on a step opens a card with the stored facts of its two builds: the Microcosm
  commit, the model and core that built each file, the number of targets and whether the target set
  changed, the registry version, and the withheld status.
- **It also links** to the dashboard's comparison of the two releases.
- **Needs:** no new stored data. L1 adds a summary of the code changes to this card.

**P5. Scales and references**

- **To discuss:** the default scale (absolute, indexed to the first build, or percent from the reference),
  and how the page labels the basis of a reference.

**P6. Marks on the time axis**

- **Candidates:** a new build engine; the same file published again; a withdrawn build; a file outside its
  declared range. The last one is the rule for most builds today, so it is a weak mark.
- **A start:** publish time on the x-axis, from the series record.

**P7. Small ones**

- **Gating:** reachable by URL once the manifest holds data; a registered capability when the page joins
  the navigation. Never a country code.
- **Serving:** the whole `timeline.json` until its size matters.
- **Export:** the CSV command exists. A button needs one route.

## 3. Longer-term improvement points

**L1. "What moved": a summary of what changed in the code**

- **The idea:** beside a step, say what changed in the data build: new targets, a better imputation, new
  variables. The Claude API writes it from Microcosm's changelog, as Teamverse does for GitHub activity.
- **The source exists.**
  - Each point keeps the Microcosm code commit of its build. Two neighbours on the series give a commit
    range.
  - Microcosm keeps one changelog fragment per change in `changelog.d/`, named by issue and by kind
    (`added`, `changed`, `fixed`, `removed`). It keeps them after a release. So the fragments added in a
    commit range are the changes between two builds.
  - For an engine bump, the source is the country model's changelog between the two pinned versions.
- **Facts first, text second.** Part of "what changed" is countable with no model: targets added and
  removed, a new registry version, changed columns. The summary covers what facts cannot say: changes to
  imputations and methods.
- **Small and structured, so that text does not fill the page.**
  - One record per step, with a fixed shape: one headline of about ten words, at most five items, and a
    count of the rest.
  - Each item has one category from a short fixed list (for example targets, imputation, variables, source
    data, calibration method, fix), one sentence, and a link to its issue.
  - On the chart: nothing. On the step: category chips with counts. In the step card (P4): the items. The
    full list is a link to GitHub.
  - A step with no change for the country says so in one line.
- **Made once and stored, never at view time.**
  - A job after finalize, or a manual one, writes one document per pair of commits into the store. The
    page only reads it.
  - The document keeps its inputs (fragment names and digests), the prompt version and the model id. A new
    prompt version makes it again.
  - It is in no panel id, so it costs no re-measurement. It is the same for every country.
  - One API call per step, with a JSON Schema for the answer, so the shape cannot drift. A backfill of
    past steps fits the batch endpoint. The inputs are short, so the cost is small.
- **Guardrails**
  - The inputs are public repository text only. No data file, no diagnostic and no figure from the private
    store goes to the API.
  - The summary says what changed in the code. It does not say why a number moved. That needs a
    measurement (L5).
  - The summary carries no figures. It is marked as machine-written, and each item links to its source. A
    person can hide or correct an item.
- **To discuss**
  - The category list.
  - One Microcosm repository serves both countries, so each item needs a country or "shared".
  - Where it runs: in this dashboard's workflow, or in Microcosm's release step. The second one could
    write "changes since the previous build" into the build folder, for every consumer.
  - Whether every Microcosm pull request adds a fragment. Not checked yet.
  - The model, and who owns the API key and its cost. A short test on a few known steps can choose the
    model.

**L2. Uncertainty from the history of changes**

- **The idea:** use the changes between builds to say how uncertain a figure is.
- **What the history measures:** how much an output moves when the build changes, on one engine. That is
  revision variability: how much the next build can move the number. It is not the survey's sampling
  error, and it is not model error.
- **Candidate measures, cheapest first**
  1. **A revision band per output:** its typical step and its 1-in-10 step across the series. It needs
     only the stored points.
  2. **The distance from the official reference across builds:** does it narrow, or does it wander? It is
     stored already.
  3. **Movement by kind of change:** join each step to its change categories (L1). It is descriptive only:
     a step often holds several changes, and the series is short.
  4. **The engine axis:** one file on two engines shows the model's share of a difference (L4).
  5. **Designed builds:** the same code with other seeds gives the noise floor of a build. One change at a
     time gives the effect of that change. These are Microcosm builds, so the compute is there, not here.
- **To discuss**
  - Which question comes first: "how stable is this output across builds" (1 and 2, from stored data), or
    "how much does one kind of change move it" (3 and 5).
  - How to show a band, and what to call it. It is not a confidence interval.
  - How long a series must be before a band means something.
  - How to keep a method change apart from a new data year, so that a band does not mix them.

**L3. The definition: which reforms and baselines** (always open)

- **The cost rule:** a change to periods, baseline items, reforms or outputs starts a new panel and needs
  a backfill. That is runner time only, and the earlier panel stays. Labels and references cost nothing.
- **Candidates so far:** baseline items for the calibration year, so that a build's own fit and the
  fixed-engine value share a period; a full US spec (L7).
- **Later, when a full re-run is slow:** reuse by block. A new panel copies the baseline block and each
  reform block whose definition did not change, and measures only the others.
- **The measured period:** when it becomes the past, add a period (a new panel each year) or keep one.

**L4. More from the engine axis**

- **Runs on demand for another engine:** fill a past engine's panel for chosen builds. Ways: a git tag per
  engine pin, an engine input on the workflow, or a local run with an upload.
- **"What the bump did":** one file on two engines. Each bump gives one such pair, the overlap build.
- **History across a bump:** a stitched view that joins two panels at the overlap build, a full backfill,
  or a sampled backfill.
- **Other paths:** each build on its own build engine (an as-built series).
- **An engine that is no published bundle:** a relaxed environment check in the producer. No id changes.
- **Old panels:** keep them. The objects are small.

**L5. Explaining a step with measurements**

- **The as-built fit beside the fixed-engine value.** It needs a map from each baseline item to its
  calibration target, and the same period on both sides (L3).
- **A facts record per file:** a `describe` command that reads a file without PolicyEngine, and one object
  per file digest. Counts and totals only: never a minimum, a maximum or a per-record value.
- **A probe:** one build on a second engine (L4).
- **A formal decomposition:** it needs designed builds (L2). Not now.

**L6. Operations**

- **A top-up when a build is published.** The dashboard's Hugging Face webhook already reacts to a changed
  `releases.json`. Weekly or manual stays the default for an experimental feature.
- **Notices:** a Slack note on a failed file or a large step. It links to the page and carries no figure.
- **Dense US files:** their memory need on a standard runner is not measured. The record's national line
  names none today.

**L7. Countries**

- **The US production spec:** outputs, references, a stated disclosure policy, and an owner.
- **A new country** needs a spec, an engine lock, references, and a `releases.json`. It needs no code.

**L8. Disclosure for finer views**

- **Timelines below the national level** need an explicit disclosure check below region level first.
  Keyed noise is one way.
- **Keyed noise in the producer:** a new policy name in the spec is hashed, so it starts a new panel. The
  key is a runner secret.

## Sources

- **The reference for PR 1:** [release-history.md](release-history.md).
- **For L1:** the build facts that a point keeps (`build_provenance` in
  `release_history/src/release_history/releases.py`), and `changelog.d/` in PolicyEngine/microcosm.
- **No simulation ran for this document.**
