# Yale reconstruction integration overview

Status: **standalone precomputed checkpoint integrated**

This source is shown as **Yale Tax-Data + Tax-Simulator (reconstruction)**. It
is not labeled as an official Yale result. The committed numbers were produced
by a local reconstruction of Yale's Tax-Data / Tax-Simulator stack using
rebuilt versions of Yale's unpublished input interfaces.

## What would be connected

The proposed source is a model/dataset pairing:

- Dataset builder: [Budget-Lab-Yale/Tax-Data](https://github.com/Budget-Lab-Yale/Tax-Data),
  pinned for the adapter to commit
  `a3919fd96d87837388f1b8bd588ff6859be391af`.
- Model: [Budget-Lab-Yale/Tax-Simulator](https://github.com/Budget-Lab-Yale/Tax-Simulator),
  pinned to `310870383d24ed3e84b7179ce35860cf177197cc`.
- Population and policy period: tax year 2024.
- Entity and weight: tax unit and `weight`.
- Geography: United States total only, represented by fixed GEOID
  `0100000US`.
- Output interface: Tax-Simulator's `static/detail/2024.csv`.

These pins are the latest upstream commits before the legacy reconstruction
artifact was added to this repository in commit
`37922ec2bc07a3f32cd5e920c0aa06385fa52a56`. That legacy artifact did not record
the exact upstream SHAs used to generate it, so this is a reviewable proposed
pin, not a claim of cryptographic provenance for the old run. The legacy
aggregate JSON itself *is* byte-pinned by SHA-256
`c5eeb17bd62a4efe02e043ac21cbcf96d50c3ef2353100cb650d6c8f048d7861`.

The upstream code supports the intended path. Tax-Data starts with a 2017-base
PUF, builds a projection ledger, and materializes yearly tax-unit files. Its
`process_puf.R` explicitly reads `puf_2015.csv` and
`demographics_2015.csv` through the `IRS-PUF` interface. Tax-Simulator lists
the needed fields—including `weight`, `filer`, `wages`, `txbl_int`, `div_ord`,
`div_pref`, `txbl_kg`, `part_scorp`, `agi`, `txbl_inc`, `eitc`, and
`liab_iit`—in `detail_vars`, then writes them to `static/detail/<year>.csv`.

## Access boundary

There are two different kinds of availability, and the adapter must keep them
separate:

1. The committed aggregate reconstruction is available now. It contains finite
   numerical estimates for all ten checkpoint facts, so the overview does not
   use `N/A` as a substitute for verification.
2. The record-level `static/detail/2024.csv` is not present in this workspace.
   Tax-Data also expects an `IRS-PUF` interface and other model-data interfaces
   that are not shipped as complete runnable inputs in the public repositories.

The source manifest is marked available because the committed reconstruction
checkpoint exists. The harness loads those aggregate outputs through the
`precomputed` execution method, verifies their SHA-256, and exposes their
dataset/model pins on every result. That does **not** mean a fresh record-level
run is currently reproducible here. A future live runner must accept a detail
export by explicit path, never commit it, and report a clear input error if it
is absent.

An official Yale export, if one is obtained later, must receive a separate
source ID. It must not silently replace this reconstruction.

## Implemented checkpoint design

`evaluation_harness/yale_reconstruction_checkpoint.py` implements the current
standalone source:

1. It verifies the 420-row aggregate JSON against SHA-256
   `c5eeb17bd62a4efe02e043ac21cbcf96d50c3ef2353100cb650d6c8f048d7861`.
2. It loads 318 explicit fact-to-row joins from
   `integrations/yale_reconstruction/checkpoint_mappings.json` and rejects
   duplicate facts, reused rows, non-finite values, unsupported periods, or a
   missing ten-fact verification gate.
3. It materializes 86 native 2024 facts and 232 2023 facts aligned to 2024 with
   the already-published Microcosm alignments. It keeps 58 rows tied to 2022
   facts out of scope and leaves 44 unmatched rows unscored.
4. Each result is marked `precomputed`, carries the Tax-Data and Tax-Simulator
   pins, and uses estimate basis
   `yale_reconstruction_aggregate_checkpoint`.

## Future fresh-run adapter

If a record-level detail file becomes available, a
`YaleReconstructionRunner` can implement the shared `SourceRunner` protocol:

1. Accept an explicit path to `static/detail/2024.csv` and record its SHA-256 in
   run metadata.
2. Load the file once and cache column arrays. Reject a missing required column,
   unequal array lengths, non-finite weights, any non-2024 run group, and any
   geography or entity other than national tax units.
3. Expose `weight`, `filer`, and the reviewed Yale expressions as NumPy arrays.
   The fixed geography array is `0100000US` for every record. The two return
   universe masks used by this checkpoint cover the complete tax-unit file,
   matching the existing harness treatment for tax microsimulation files.
4. Let the common harness apply every Chronicle dimension and universe constraint,
   then perform `weighted_sum` or `weighted_count`. The adapter does not contain
   fact-specific aggregation loops.
5. Emit ordinary `EvaluationResult` rows with the Chronicle snapshot, mapping
   release, Tax-Data pin, Tax-Simulator pin, population/policy periods,
   calibration exposure, and any fact alignment ID.

The reviewed field mappings are:

| Chronicle concept | Yale detail expression | Operation |
|---|---:|---|
| Returns with EITC | `eitc` | weighted count where nonzero |
| Adjusted gross income | `agi` | weighted sum |
| Wages and salaries | `wages` | weighted sum |
| Taxable interest | `txbl_int` | weighted sum |
| Qualified dividends | `div_pref` | weighted sum |
| Net capital gains | `txbl_kg` | weighted sum |
| Partnership/S-corporation net income | `part_scorp` | weighted sum |
| Ordinary dividends | `div_ord` | weighted sum |
| Income-tax liability after credits | `liab_iit` | weighted sum |
| Earned income tax credit | `eitc` | weighted sum |

AGI and income components are labeled `related_calibration_family`, not clean
holdouts: Tax-Data is built by reweighting, imputation, and macro projection
against related SOI and macro inputs. Income tax and EITC are labeled external
validation in this checkpoint. We should tighten those labels only when exact
reconstruction-input provenance is available.

## Ten directly testable Chronicle facts

All ten are exact rows from Chronicle snapshot
`ledger-7917ea815df710fb20db076b`. They are national tax-unit facts for tax year
2024, match an explicit Yale detail field, have a reviewed aggregation, and
already have a finite reconstruction estimate in the committed aggregate
artifact.

| Chronicle concept | Chronicle target | Reconstruction estimate | Difference |
|---|---:|---:|---:|
| Returns with EITC | 23,837,149 | 25,753,349 | +8.04% |
| Adjusted gross income | $14.425T | $17.763T | +23.14% |
| Wages and salaries | $10.833T | $10.929T | +0.89% |
| Taxable interest | $123.791B | $187.958B | +51.84% |
| Qualified dividends | $290.613B | $366.575B | +26.14% |
| Net capital gains | $1.157T | $1.680T | +45.19% |
| Partnership/S-corporation net income | $996.633B | $1.486T | +49.13% |
| Ordinary dividends | $385.116B | $476.109B | +23.63% |
| Income-tax liability after credits | $2.051T | $2.668T | +30.12% |
| Earned income tax credit | $69.042B | $70.017B | +1.41% |

These values are a provenance gate and not an official Yale validation. All ten
are now present in the standalone checkpoint, and the broader harness score is
computed over 318 fact-level results. A future fresh-run adapter must recompute
the gate from record-level output before it can supersede this checkpoint.

### Why taxable income is not one of the ten

The earlier plan named taxable income as a desired checkpoint concept. The
pinned Chronicle snapshot has no national U.S. tax-unit taxable-income fact for
2024; its national total is tax year 2022. The legacy reconstruction JSON has a
2024 model estimate keyed to an older target surface that transformed that 2022
fact, but the approved alignment rule covers 2023-to-2024 transformations, not
2022-to-2024 transformations. Using that row here would make the ten-fact gate
look successful by changing the requested period policy.

Ordinary dividends replaces it in this checkpoint because it is a native 2024
Chronicle fact with a direct `div_ord` mapping. Taxable income stays deferred until
Chronicle gains a native 2024 fact or a separate 2022 alignment is explicitly
designed and approved.

## Treatment of 2023 Chronicle facts

The Yale checkpoint uses exactly the same alignment output as Microcosm. Before
materializing a 2023 comparison, the full-run harness applies
`PopulaceAgingPolicy` (`cbo_growth_factor_aging` version `1.2.0`, Populace commit
`cae8640f9e65e274aea65c7916cb37b956978e32`) to U.S. 2023 facts:

- eligible USD sums are transformed to 2024 with Populace's reviewed CBO/SOI
  factor and fallback order;
- counts and non-dollar facts retain their numerical value but receive an
  explicit 2024 alignment;
- publisher projection levels are not compounded;
- a fact with no valid factor is unsupported rather than compared across years.

Scoring compares Yale's 2024 estimate to the transformed 2024 benchmark. The
published result retains the original 2023 value and period, transformed value
and period, factor, factor source, aging model/version, Populace commit, and
alignment ID. The page can therefore state plainly that the displayed score is
against a 2024 transformation of a 2023 Chronicle observation.

The ten facts above are already 2024 facts, so no aging is involved in this
overview checkpoint.

## Implemented gates

The checkpoint tests establish:

1. the exact reconstruction checksum and 420-row input count;
2. 318 unique fact/row joins, split into 232 aligned 2023 facts and 86 native
   2024 facts;
3. an explicit 58-row 2022 holdout and 44-row unmatched remainder;
4. ten finite numerical verification results with zero `N/A` cells;
5. native and aligned period treatment, precomputed execution, and immutable
   dataset/model provenance; and
6. a complete four-source capability matrix and frontend artifact.
