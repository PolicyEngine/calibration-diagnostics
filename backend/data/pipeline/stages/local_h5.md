# Local-area H5 build pathway

## Purpose

This stage materializes the per-area microsimulation datasets that PolicyEngine ships to production: one H5 file per US state (`states/CA.h5`), per congressional district (`districts/TX-15.h5`), per supported city (`cities/NYC.h5`), plus a national `US.h5`. It exists as a separate pathway from `calibration_package` because calibration produces only a single flat clone-weight vector aligned to a cloned source frame; this stage *expands* those weights into many self-contained, geography-filtered H5 files that downstream consumers (the API, app, district analyses) can load independently. It is also intentionally split from `data_build`: `data_build` produces the *source* CPS/PUF/imputed snapshot once, while `local_h5` runs ~480 times per release (50 states + ~436 districts + cities + national), is embarrassingly parallel, must be checkpointable across worker crashes, and ends in a multi-stage HuggingFace staging plus atomic promotion that `data_build` does not need.

## Inputs and outputs

**Inputs** (from upstream stages, consumed by `WorkerSessionFactory` and `build_h5`):
- `source_imputed_stratified_extended_cps.h5` — the imputed/extended CPS source frame from `data_build`.
- `calibration_weights.npy` — flat clone-level weight vector `(n_clones_total * n_hh,)` from `calibration_package`.
- `geography_assignment.npz` — per-clone block-level geography assignment (block GEOID, CD GEOID) recovered via `CalibrationGeographyLoader`.
- `policy_data.db` + `target_config.yaml` / `target_config_full.yaml` — used by `AreaValidationService` for post-build target comparisons.
- Optional `bootstrap/{scope}/worker_bootstrap.json` + `entity_graph.npz` — persisted deterministic worker setup facts, when available.

**Outputs**:
- `states/*.h5`, `districts/*.h5`, `cities/*.h5`, `US.h5` — geography-filtered H5 files with reindexed entity IDs, household weights, derived geography (state/county/tract/PUMA/place), and take-up draws applied.
- Release manifest + HF release tag (after `atomic_promote`).
- Per-area validation diagnostics (sanity checks + target comparisons).

## Key sub-stages

1. **Request enumeration** — `local_h5_area_catalog` (`USAreaCatalog`), `local_h5_area_request` (`AreaBuildRequest`), `local_h5_area_filter` (`AreaFilter`). The catalog walks the unique CD GEOIDs in the geography assignment and emits one typed `AreaBuildRequest` per state, district, supported city (NYC = county-FIPS filter), and the national output. Each request carries an `output_relative_path` and an immutable tuple of `AreaFilter`s.

2. **Worker setup and bootstrap** — `local_h5_worker_session_factory`, `local_h5_worker_session`, `local_h5_worker_bootstrap_bundle`, `local_h5_worker_bootstrap_builder`, `local_h5_partition`. The factory loads the source H5 (via `PolicyEngineDatasetReader`), the calibration weights, the geography (preferring persisted bootstrap artifacts under `bootstrap/{scope}/`, falling back to raw loaders), and the validation context *once per worker process*. `partition_weighted_work_items` uses longest-processing-time scheduling to balance areas across workers and respects a `completed` set for resumability.

3. **In-memory build per area** — `local_h5_dataset_builder` (`LocalAreaDatasetBuilder`), `local_h5_area_selector`, `local_h5_clone_selection`, `local_h5_entity_reindexer`, `local_h5_reindexed_entities`, `local_h5_variable_cloner`, `local_h5_payload`. For one request, `AreaSelector` zeroes out clones outside the geography filter and returns `(clone_indices, source_household_indices, weights, block_geoids)`. `EntityReindexer` produces new contiguous IDs for households/persons/tax units/spm units/families. `VariableCloner` materializes period-grouped arrays into an `H5Payload`.

4. **US postprocessing** — `local_h5_us_entity_postprocessor`, `local_h5_us_geography_postprocessor`, `local_h5_us_takeup_postprocessor`. In order: write the new entity IDs and the calibrated `household_weight`; derive state/county/tract/PUMA/place/district from block GEOIDs (`derive_geography_from_blocks` in `calibration/block_assignment.py`); apply take-up draws for ACA/SNAP/etc. The order is enforced by `PayloadPostProcessorSpec.requires` so geography fields exist before take-up depends on them.

5. **Write + verify** — `local_h5_writer` (`H5Writer`), `local_h5_write_result`. Writes the payload as period-grouped datasets and reads back household/person counts and weight sums for immediate verification.

6. **Validate, stage, promote** — `sanity_checks` (`run_sanity_checks`), `target_validation` (`validate_area`), `local_stage_upload` (`stage`), `atomic_promote` (`promote`). Sanity checks open the H5 and verify weight non-negativity, ID uniqueness, person/household mapping integrity, take-up coherence, and aggregate sanity. Target validation runs a fresh microsim against the H5 and compares to the calibration target table. `stage` uploads to `staging/{run_id}/...` on HF; `promote` runs preflight (`preflight_release_manifest_publish`), moves staging to production, mirrors to GCS, publishes the release manifest, and only creates the version tag when every required area prefix is present.

## Common failure modes

- **"No active clones after filtering"** — raised in `AreaSelector.select` (`selection.py:67`). The geography filter for the area matched zero clones with positive weight. Usually means the calibration weight vector and `geography_assignment.npz` are misaligned (different clone counts), or a stale `state_filter` / wrong CD GEOID list. Check `CalibrationGeographyLoader` resolution first — it has saved/package/legacy fallback paths and may have loaded the wrong one.

- **"N active clones have empty block GEOIDs"** — also in `AreaSelector.select` (`selection.py:81`). The geography assignment has unassigned blocks for clones that survived filtering. Indicates upstream block assignment is incomplete; look at `calibration/block_assignment.py` and the source of `stacked_blocks.npy`.

- **Bootstrap fingerprint mismatch / `bootstrap_status == "fallback"`** — `WorkerSessionFactory.create` validates `expected_scope_fingerprint` against the persisted bootstrap bundle and silently falls back to raw loaders if it disagrees. Builds will succeed but much more slowly. Check `FingerprintingService` and the `PublishingInputBundle` artifact hashes; usually the source H5 or weights were rebuilt without invalidating bootstrap.

- **Sanity-check WARN/FAIL on hourly wage or weights** — `run_sanity_checks` in `sanity_checks.py:327` checks weight non-negativity, person→household weight propagation, and hourly-wage-vs-income consistency. Failures here typically point at the take-up postprocessor or at a person→household weight broadcast mismatch in `USEntityPostProcessor` (entity ID arrays out of sync with the cloned variable arrays).

- **Atomic promote refuses to tag** — `preflight_release_manifest_publish` reports `missing_prefixes` (e.g., `cities/` not yet built). `promote()` still copies staged files but logs a warning and leaves the release untagged. Recover by running the missing area type and re-invoking `promote`.

## Why this exists / design notes

The original pathway (`build_h5` in `publish_local_area.py`, still tagged `status="transitional"`) was a single monolithic function that loaded the source simulation, filtered clones, reindexed entities, cloned variables, applied US-specific augmentations, and wrote H5 — all in one call. That worked for the national output but became a bottleneck once PolicyEngine started shipping ~500 area-specific files per release: each call re-loaded the source dataset, there was no clean seam for tests, and worker crashes lost all in-flight work.

The `build_outputs/` package is a refactor that pulls each concern into a typed seam — `AreaSelector`, `EntityReindexer`, `VariableCloner`, the three `USPostProcessor`s, `H5Writer` — coordinated by `LocalAreaDatasetBuilder`. `WorkerSession`/`WorkerSessionFactory` amortize the expensive setup (source H5 read, weight load, geography load, validation target prep) across many area builds in the same worker. `WorkerBootstrap*` persists those setup facts so a restarted worker can skip re-deriving the entity graph. `partition_weighted_work_items` ensures that a worker dying mid-shard does not stall the longest build.

Subtle points for reviewers:
- The `status` field is meaningful: `build_h5` is `transitional`, the `publish_local_area.py` `compute_input_fingerprint` and `load_calibration_geography` are `legacy` — the new equivalents live in `build_outputs/fingerprinting.py` and `build_outputs/geography_loader.py`.
- Postprocessor ordering is enforced via `PayloadPostProcessorSpec.requires` and validated in `LocalAreaDatasetBuilder.__post_init__`. Take-up depends on geography (it filters by block), so adding a postprocessor that reads geography before geography is applied will silently get pre-geography data unless declared.
- The pathway is dual-keyed in the registry: `derive_geography_from_blocks` (`geo_derive`) is shared with `calibration_package` because both pathways need to translate blocks to higher geography levels.
- Promotion is intentionally non-atomic across files but atomic on the *tag*: partial promotes are recoverable, but a release is only "real" once the tag exists.

## Source map

| Node ID | Source file | Role |
|---|---|---|
| local_h5_area_catalog | build_outputs/area_catalog.py | Build typed `AreaBuildRequest`s from US geography (states, CDs, NYC) |
| local_h5_area_request | build_outputs/requests.py | Typed contract for one H5 output request |
| local_h5_area_filter | build_outputs/requests.py | Geography predicate (`field op value`) |
| local_h5_worker_bootstrap_bundle | build_outputs/bootstrap.py | Persisted deterministic worker setup facts |
| local_h5_worker_bootstrap_store | build_outputs/bootstrap.py | Run-scoped path adapter for bootstrap artifacts |
| local_h5_worker_bootstrap_builder | build_outputs/bootstrap.py | Materialize bootstrap JSON + entity-graph NPZ |
| local_h5_worker_session | build_outputs/worker_session.py | Per-worker reusable state (source, weights, geography) |
| local_h5_worker_session_factory | build_outputs/worker_session.py | Construct `WorkerSession` from bootstrap or raw loaders |
| local_h5_worker_calibration_inputs | build_outputs/worker_inputs.py | Normalized worker-input payload |
| local_h5_partition | build_outputs/partitioning.py | LPT scheduling of weighted area work across workers |
| local_h5_publishing_input_bundle | build_outputs/fingerprinting.py | Input artifact + run metadata bundle |
| local_h5_artifact_identity | build_outputs/fingerprinting.py | Content-addressed identity for one input artifact |
| local_h5_traceability_bundle | build_outputs/fingerprinting.py | Provenance + resumability material |
| local_h5_traceability | build_outputs/fingerprinting.py | `FingerprintingService` — compute scope fingerprints |
| local_h5_input_fingerprint | calibration/publish_local_area.py | Legacy wrapper to `FingerprintingService` |
| local_h5_resolved_geography_source | build_outputs/geography_loader.py | Resolved physical geography source |
| calibration_geography_loader | build_outputs/geography_loader.py | Resolve saved/package/legacy geography |
| load_calibration_geography | calibration/publish_local_area.py | Legacy wrapper to `CalibrationGeographyLoader` |
| geo_derive | calibration/block_assignment.py | Derive state/county/tract/PUMA/place from block GEOIDs |
| local_h5_entity_graph | build_outputs/source_dataset.py | Source-dataset entity spine |
| local_h5_microsimulation_variable_provider | build_outputs/source_dataset.py | Lazy variable accessor over source snapshot |
| local_h5_source_dataset_snapshot | build_outputs/source_dataset.py | In-memory source H5 contract |
| local_h5_policyengine_dataset_reader | build_outputs/source_dataset.py | PolicyEngine H5 adapter |
| clone_weight_matrix | build_outputs/weights.py | Shape contract for clone-level weights |
| local_h5_area_selector | build_outputs/selection.py | Apply geography filters; emit active clone rows |
| local_h5_clone_selection | build_outputs/selection.py | Selected clones + their block/CD GEOIDs |
| local_h5_entity_reindexer | build_outputs/reindexing.py | Reindex households/persons/subentities |
| local_h5_reindexed_entities | build_outputs/reindexing.py | New IDs and source-row indices |
| local_h5_variable_cloner | build_outputs/variables.py | Clone source variables into period groups |
| local_h5_variable_clone_payload | build_outputs/variables.py | Period-grouped cloned-variable payload |
| local_h5_payload | build_outputs/payload.py | Validated period-grouped H5 payload |
| local_h5_payload_build_context | build_outputs/payload.py | Context passed to postprocessors |
| local_h5_dataset_builder | build_outputs/builder.py | Coordinate select → reindex → clone → postprocess |
| local_h5_build_result | build_outputs/builder.py | In-memory build output + diagnostics |
| local_h5_us_entity_postprocessor | build_outputs/us_augmentations.py | Apply entity IDs + calibrated `household_weight` |
| local_h5_us_entity_postprocessor_result | build_outputs/us_augmentations.py | Result wrapper for entity postprocessor |
| local_h5_us_geography_postprocessor | build_outputs/us_augmentations.py | Apply state/county/tract/PUMA/etc. |
| local_h5_us_geography_postprocessor_result | build_outputs/us_augmentations.py | Result wrapper for geography postprocessor |
| local_h5_us_takeup_postprocessor | build_outputs/us_augmentations.py | Apply ACA/SNAP/etc. take-up draws |
| local_h5_us_takeup_postprocessor_result | build_outputs/us_augmentations.py | Result wrapper for take-up postprocessor |
| local_h5_validation_policy | build_outputs/validation.py | Worker-scoped validation policy |
| local_h5_validation_context | build_outputs/validation.py | Prepared per-worker validation target context |
| local_h5_area_validation_service | build_outputs/validation.py | Prepare targets once per worker session |
| local_h5_writer | build_outputs/writer.py | Write payload to disk |
| local_h5_write_result | build_outputs/writer.py | Post-write verification summary |
| build_h5 | calibration/publish_local_area.py | Transitional monolithic single-area build entry |
| build_states | calibration/publish_local_area.py | Build all state H5s with checkpointing |
| build_districts | calibration/publish_local_area.py | Build all congressional-district H5s |
| build_cities | calibration/publish_local_area.py | Build supported city H5s with county filter |
| sanity_checks | calibration/sanity_checks.py | Structural integrity checks on a written H5 |
| target_validation | calibration/validate_staging.py | Microsim target comparison for one area |
| local_stage_upload | calibration/promote_local_h5s.py | Upload built H5s to HF `staging/{run_id}/` |
| atomic_promote | calibration/promote_local_h5s.py | Promote staging to production + publish manifest + tag |
