"""Classify and execute the full pinned Ledger snapshot for approved adapters."""

from __future__ import annotations

import argparse
import gc
import json
from collections import Counter
from pathlib import Path

from evaluation_harness.adapters.acs_pums import ACSPUMSRunner, execute_acs_pums
from evaluation_harness.adapters.populace import (
    POPULACE_RELEASE,
    PopulacePolicyEngineRunner,
    resolve_release_calibration_diagnostics,
)
from evaluation_harness.adapters.taxcalc_cps import TaxCalcCPSRunner
from evaluation_harness.contracts import CalibrationExposure
from evaluation_harness.execution import build_run_groups, execute_groups
from evaluation_harness.full_run import (
    SourcePlan,
    build_full_capability_matrix,
    build_run_summary,
    build_scored_results,
    exclude_facts_with_geography_ids,
    load_snapshot_facts,
    scope_facts_to_jurisdictions,
)
from evaluation_harness.frontend_bundle import publish_frontend_bundle
from evaluation_harness.integration import load_integration_overview
from evaluation_harness.mappings import MappingRegistry
from evaluation_harness.populace_aging import (
    PopulaceAgingPolicy,
    transform_ledger_facts_to_populace_year,
    transform_ledger_facts_to_populace_years,
)
from evaluation_harness.populace_age_topcodes import (
    build_cps_asec_age_topcode_comparisons,
)
from evaluation_harness.populace_bea_wages import (
    transform_chronicle_bea_wage_facts,
)
from evaluation_harness.populace_old_cd import load_old_cd_assignments
from evaluation_harness.populace_release_targets import (
    compile_release_target_alignments,
    materialize_release_target_results,
)
from evaluation_harness.publisher import publish_run
from evaluation_harness.yale_reconstruction_checkpoint import (
    ESTIMATE_BASIS as YALE_ESTIMATE_BASIS,
    load_yale_reconstruction_checkpoint,
    materialize_yale_reconstruction_results,
)


ROOT = Path(__file__).resolve().parents[1]
POPULACE_INTEGRATION = ROOT / "integrations" / "populace_policyengine_us"
CPS_INTEGRATION = ROOT / "integrations" / "taxcalc_cps"
ACS_PUMS_INTEGRATION = ROOT / "integrations" / "census_acs_pums"
YALE_INTEGRATION = ROOT / "integrations" / "yale_reconstruction"
YALE_RECONSTRUCTION = (
    ROOT
    / "frontend"
    / "lib"
    / "populace"
    / "external-datasets"
    / "yale-national-2024.json"
)
EVALUATION_JURISDICTIONS = frozenset({"US"})
EVALUATION_EXCLUDED_GEOGRAPHY_IDS = frozenset(
    {
        # The pinned Microcosm population has no Guam or US Virgin Islands
        # households. Chronicle labels these SNAP rows with jurisdiction=US,
        # so geography IDs are the authoritative scope boundary.
        "0400000US66",
        "0400000US78",
    }
)


def _source_counts(capabilities, source_id: str) -> dict[str, int]:
    return dict(
        sorted(
            Counter(
                row.status.value
                for row in capabilities
                if row.source_id == source_id
            ).items()
        )
    )


def run(
    snapshot: Path,
    populace_dataset: Path,
    acs_pums_aggregates: Path,
    output: Path,
    populace_calibration_diagnostics: Path | None = None,
    populace_old_cd_assignments: Path | None = None,
) -> dict:
    snapshot_facts, snapshot_manifest = load_snapshot_facts(snapshot)
    jurisdiction_facts = scope_facts_to_jurisdictions(
        snapshot_facts, EVALUATION_JURISDICTIONS
    )
    facts = exclude_facts_with_geography_ids(
        jurisdiction_facts, EVALUATION_EXCLUDED_GEOGRAPHY_IDS
    )
    snapshot_id = snapshot_manifest["snapshot_id"]
    print(
        f"Loaded {len(facts):,} US facts from immutable snapshot {snapshot_id}; "
        f"excluded {len(snapshot_facts) - len(jurisdiction_facts):,} non-US facts "
        f"and {len(jurisdiction_facts) - len(facts):,} explicitly out-of-scope "
        "territory facts.",
        flush=True,
    )

    populace_overview = load_integration_overview(
        POPULACE_INTEGRATION / "overview.yaml"
    )
    cps_overview = load_integration_overview(CPS_INTEGRATION / "overview.yaml")
    acs_pums_overview = load_integration_overview(
        ACS_PUMS_INTEGRATION / "overview.yaml"
    )
    yale_overview = load_integration_overview(YALE_INTEGRATION / "overview.yaml")
    for overview in (
        populace_overview,
        cps_overview,
        acs_pums_overview,
        yale_overview,
    ):
        if overview.ledger_snapshot_id != snapshot_id:
            raise ValueError(
                f"integration {overview.integration_id} was reviewed against "
                f"{overview.ledger_snapshot_id}, not {snapshot_id}"
            )

    diagnostics_path = populace_calibration_diagnostics
    if diagnostics_path is None:
        diagnostics_path = resolve_release_calibration_diagnostics(
            POPULACE_RELEASE, populace_dataset.parent
        )
    aging_policy = PopulaceAgingPolicy.from_facts(
        facts,
        release_diagnostics_path=diagnostics_path,
    )
    source_years = tuple(
        int(year) for year in populace_overview.alignment_policy["source_years"]
    )
    build_year = int(populace_overview.alignment_policy["build_year"])
    aging_results = transform_ledger_facts_to_populace_years(
        facts,
        aging_policy,
        source_years=source_years,
        build_year=build_year,
    )
    release_target_alignments = compile_release_target_alignments(
        facts,
        diagnostics_path,
        source_id=populace_overview.source.source_id,
        release_id=POPULACE_RELEASE.release_id,
    )
    bea_wage_transformations = transform_chronicle_bea_wage_facts(
        facts,
        source_id=populace_overview.source.source_id,
    )
    taxcalc_bea_wage_transformations = transform_chronicle_bea_wage_facts(
        facts,
        source_id=cps_overview.source.source_id,
        national_calibration_exposure=(
            CalibrationExposure.EXTERNAL_VALIDATION
        ),
    )
    acs_pums_bea_wage_transformations = transform_chronicle_bea_wage_facts(
        facts,
        source_id=acs_pums_overview.source.source_id,
        national_calibration_exposure=(
            CalibrationExposure.EXTERNAL_VALIDATION
        ),
    )
    age_topcode_comparisons = build_cps_asec_age_topcode_comparisons(
        facts,
        source_id=populace_overview.source.source_id,
    )
    exact_release_fact_keys = {
        row.source_fact_key for row in release_target_alignments.aligned_facts
    }
    release_target_fact_keys = exact_release_fact_keys | set(
        release_target_alignments.native_target_fact_keys
    )
    calibration_exposures = {
        fact.fact_key: CalibrationExposure.EXTERNAL_VALIDATION for fact in facts
    }
    calibration_exposures.update(
        {
            fact_key: CalibrationExposure.DIRECT_CALIBRATION_TARGET
            for fact_key in release_target_fact_keys
        }
    )
    calibration_exposures.update(
        {
            declaration.fact_key: declaration.calibration_exposure
            for declaration in bea_wage_transformations.declarations
            if declaration.fact_key is not None
            and declaration.calibration_exposure is not None
        }
    )
    comparable_aging = tuple(
        row
        for row in aging_results
        if row.comparable and row.source_fact.fact_key not in exact_release_fact_keys
    )
    aligned_facts = tuple(
        [
            *release_target_alignments.aligned_facts,
            *(row.to_aligned_fact() for row in comparable_aging),
            *bea_wage_transformations.aligned_facts,
            *taxcalc_bea_wage_transformations.aligned_facts,
            *acs_pums_bea_wage_transformations.aligned_facts,
            *age_topcode_comparisons.aligned_facts,
        ]
    )
    populace_plan = SourcePlan(
        source=populace_overview.source,
        mappings=MappingRegistry.from_yaml(POPULACE_INTEGRATION / "mappings.yaml"),
        alignments=tuple(
            [
                *release_target_alignments.declarations,
                *bea_wage_transformations.declarations,
                *age_topcode_comparisons.declarations,
                *(
                    row.to_alignment_declaration(populace_overview.source.source_id)
                    for row in comparable_aging
                ),
            ]
        ),
        calibration_exposures=calibration_exposures,
    )
    cps_plan = SourcePlan(
        source=cps_overview.source,
        mappings=MappingRegistry.from_yaml(CPS_INTEGRATION / "mappings.yaml"),
        alignments=taxcalc_bea_wage_transformations.declarations,
    )
    acs_pums_plan = SourcePlan(
        source=acs_pums_overview.source,
        mappings=MappingRegistry.from_yaml(
            ACS_PUMS_INTEGRATION / "mappings.yaml"
        ),
        alignments=acs_pums_bea_wage_transformations.declarations,
    )
    yale_plan = SourcePlan(
        source=yale_overview.source,
        mappings=MappingRegistry.from_yaml(YALE_INTEGRATION / "mappings.yaml"),
    )
    capabilities = build_full_capability_matrix(
        facts,
        [populace_plan, cps_plan, yale_plan, acs_pums_plan],
        snapshot_id=snapshot_id,
    )
    capabilities, release_target_results = materialize_release_target_results(
        capabilities,
        release_target_alignments,
        source_id=populace_plan.source.source_id,
        dataset_version=POPULACE_RELEASE.release_id,
        model_version=f"policyengine-us=={POPULACE_RELEASE.model_version}",
        population_period=populace_plan.source.population_period,
        policy_period=populace_plan.source.policy_period,
    )
    yale_checkpoint = load_yale_reconstruction_checkpoint(
        YALE_RECONSTRUCTION,
        YALE_INTEGRATION / "checkpoint_mappings.json",
    )
    capabilities, yale_results = materialize_yale_reconstruction_results(
        capabilities,
        facts,
        yale_checkpoint,
        aligned_facts=aligned_facts,
        source=yale_plan.source,
    )
    expected_capabilities = len(facts) * 4
    if len(capabilities) != expected_capabilities:
        raise RuntimeError(
            f"classification produced {len(capabilities)} cells, "
            f"expected {expected_capabilities}"
        )
    print(
        "Classified every fact/source pair: "
        + json.dumps(
            {
                populace_plan.source.source_id: _source_counts(
                    capabilities, populace_plan.source.source_id
                ),
                cps_plan.source.source_id: _source_counts(
                    capabilities, cps_plan.source.source_id
                ),
                yale_plan.source.source_id: _source_counts(
                    capabilities, yale_plan.source.source_id
                ),
                acs_pums_plan.source.source_id: _source_counts(
                    capabilities, acs_pums_plan.source.source_id
                ),
            },
            sort_keys=True,
        ),
        flush=True,
    )

    populace_capabilities = tuple(
        row
        for row in capabilities
        if row.source_id == populace_plan.source.source_id
    )
    populace_groups = build_run_groups(populace_capabilities)
    print(
        f"Executing {sum(len(group.fact_keys) for group in populace_groups):,} "
        f"Populace/PolicyEngine capability cells in {len(populace_groups)} groups.",
        flush=True,
    )
    old_cd_path = populace_old_cd_assignments
    if old_cd_path is None:
        old_cd_path = populace_dataset.with_name(
            "old_congressional_district_assignments.csv"
        )
    old_cd_assignments = load_old_cd_assignments(old_cd_path)
    populace_runner = PopulacePolicyEngineRunner(
        dataset_path=populace_dataset,
        old_congressional_district_assignments=old_cd_assignments,
    )
    populace_results = tuple(
        [
            *release_target_results,
            *execute_groups(
                populace_groups,
                populace_capabilities,
                {populace_plan.source.source_id: populace_runner},
            ),
        ]
    )
    del populace_runner
    gc.collect()
    print(f"Completed {len(populace_results):,} Populace estimates.", flush=True)

    cps_capabilities = tuple(
        row for row in capabilities if row.source_id == cps_plan.source.source_id
    )
    cps_groups = build_run_groups(cps_capabilities)
    print(
        f"Executing {sum(len(group.fact_keys) for group in cps_groups):,} "
        f"Public CPS + Tax-Calculator capability cells in {len(cps_groups)} groups.",
        flush=True,
    )
    cps_runner = TaxCalcCPSRunner()
    cps_results = execute_groups(
        cps_groups,
        cps_capabilities,
        {cps_plan.source.source_id: cps_runner},
    )
    del cps_runner
    gc.collect()
    print(f"Completed {len(cps_results):,} CPS estimates.", flush=True)

    print(
        f"Loaded {len(yale_results):,} precomputed Yale reconstruction estimates.",
        flush=True,
    )

    acs_pums_capabilities = tuple(
        row
        for row in capabilities
        if row.source_id == acs_pums_plan.source.source_id
    )
    acs_pums_groups = build_run_groups(acs_pums_capabilities)
    print(
        f"Executing {sum(len(group.fact_keys) for group in acs_pums_groups):,} "
        f"raw ACS PUMS capability cells in {len(acs_pums_groups)} groups.",
        flush=True,
    )
    acs_pums_runner = ACSPUMSRunner(acs_pums_aggregates)
    acs_pums_input_manifest = acs_pums_runner.input_manifest
    acs_pums_results = execute_acs_pums(
        acs_pums_groups,
        acs_pums_capabilities,
        acs_pums_runner,
    )
    del acs_pums_runner
    gc.collect()
    print(f"Completed {len(acs_pums_results):,} raw ACS estimates.", flush=True)

    results = tuple(
        [*populace_results, *cps_results, *yale_results, *acs_pums_results]
    )
    scores = build_scored_results(facts, capabilities, results, aligned_facts)
    summary = build_run_summary(facts, capabilities, results, scores)
    summary["evaluation_scope"] = {
        "jurisdictions": sorted(EVALUATION_JURISDICTIONS),
        "source_snapshot_fact_count": len(snapshot_facts),
        "included_fact_count": len(facts),
        "excluded_fact_count": len(snapshot_facts) - len(facts),
        "excluded_non_us_fact_count": len(snapshot_facts) - len(jurisdiction_facts),
        "excluded_geography_ids": sorted(EVALUATION_EXCLUDED_GEOGRAPHY_IDS),
        "excluded_geography_fact_count": len(jurisdiction_facts) - len(facts),
    }
    summary["populace_prior_years_to_2024_alignment"] = {
        "policy": "Exact Populace cbo_growth_factor_aging@1.2.0 semantics",
        "observed_years": list(source_years),
        "evaluation_year": build_year,
        "fact_count": len(aging_results),
        "comparable_count": (
            len(release_target_alignments.aligned_facts)
            + len(comparable_aging)
        ),
        "exact_release_target_count": len(
            release_target_alignments.aligned_facts
        ),
        "fallback_policy_count": len(comparable_aging),
        "fallback_policy_status_counts": dict(
            sorted(Counter(row.status.value for row in aging_results).items())
        ),
        "fallback_factor_basis_counts": dict(
            sorted(
                Counter(
                    row.factor_basis
                    for row in comparable_aging
                    if row.factor_basis != "not_applicable"
                ).items()
            )
        ),
        "benchmark_basis": (
            "Direct build targets use their exact compiled release values. Other "
            "executable rows use the pinned aging policy. Both retain each "
            "prior-year observed value."
        ),
    }
    summary["microcosm_exact_release_targets"] = {
        "release_id": POPULACE_RELEASE.release_id,
        "diagnostics_sha256": POPULACE_RELEASE.calibration_diagnostics_sha256,
        "compiled_target_count": release_target_alignments.target_count,
        "cross_period_fact_count": release_target_alignments.matched_fact_count,
        "native_period_fact_count": len(
            release_target_alignments.native_target_fact_keys
        ),
        "rejected_match_count": len(release_target_alignments.rejected_matches),
        "final_estimate_result_count": sum(
            row.estimate_basis == "microcosm_release_final_estimate"
            for row in populace_results
        ),
        "estimate_basis": "microcosm_release_final_estimate",
        "benchmark_basis": (
            "Cross-period Chronicle facts that were direct targets in the pinned "
            "Microcosm build use the exact compiled target values and recorded "
            "aging/uprating lineage from that release."
        ),
        "estimate_interpretation": (
            "Direct targets use the exact post-calibration final_estimate stored "
            "in the pinned release diagnostics. Chronicle holdouts are still "
            "executed from the HDF5 population and PolicyEngine-US model."
        ),
    }
    summary["microcosm_bea_wage_benchmarks"] = {
        "transformation": "BEA state wages residence-adjusted and scaled to NIPA",
        "archived_policyengine_us_data_pr": 1034,
        "archived_policyengine_us_data_commit": (
            "af806026d0885e15275593f5ea42aa74937ff9af"
        ),
        "state_fact_count": bea_wage_transformations.state_count,
        "national_fact_count": 1,
        "transformed_fact_count": len(
            bea_wage_transformations.aligned_facts
        ),
        "input_fact_count": len(bea_wage_transformations.input_fact_keys),
        "national_wage_total": str(bea_wage_transformations.national_total),
        "national_scaling_factor": str(
            bea_wage_transformations.scale_factor
        ),
        "state_calibration_exposure": "external_validation",
        "national_calibration_exposure": "direct_calibration_target",
        "benchmark_basis": (
            "Chronicle place-of-work wages transformed to residence basis using "
            "Chronicle supplements, social-insurance contributions, and residence "
            "adjustments; state values are then scaled to the archived 2024 BEA "
            "NIPA national wage target."
        ),
    }
    summary["microcosm_cps_asec_age_topcodes"] = {
        "source_variable": "A_AGE",
        "age_80_code_represents": "80-84",
        "age_80_84_input_fact_count": 5,
        "age_80_84_independent_score_count": 1,
        "age_80_84_benchmark": str(
            age_topcode_comparisons.age_80_84_benchmark
        ),
        "age_85_code_represents": "85+",
        "age_85_plus_fact_key": (
            age_topcode_comparisons.age_85_plus_fact_key
        ),
        "benchmark_basis": (
            "CPS ASEC public-use code 80 is compared once with the sum of "
            "Chronicle single-year ages 80 through 84. Code 85 is compared "
            "with Chronicle's existing age-85-plus fact."
        ),
    }
    summary["microcosm_old_congressional_district_geography"] = {
        "assignment_file": str(old_cd_path),
        "assigned_block_count": len(old_cd_assignments),
        "chronicle_geography_prefix": "5001700US",
        "method": (
            "Exact household-block assignment to 117th-Congress districts using "
            "official Census 2020 Block Assignment Files."
        ),
        "calibration_interpretation": (
            "The pinned release did not activate congressional-district facts as "
            "hard targets; these results are out-of-sample validation."
        ),
    }
    aging_2023 = transform_ledger_facts_to_populace_year(
        facts,
        aging_policy,
        source_year=2023,
        build_year=build_year,
    )
    exact_release_2023 = tuple(
        row
        for row in release_target_alignments.aligned_facts
        if row.observed_period.value.split("-", 1)[0] == "2023"
    )
    comparable_2023 = tuple(
        row
        for row in aging_2023
        if row.comparable and row.source_fact.fact_key not in exact_release_fact_keys
    )
    summary["populace_2023_to_2024_alignment"] = {
        "policy": "Exact Populace cbo_growth_factor_aging@1.2.0 semantics",
        "observed_year": 2023,
        "evaluation_year": build_year,
        "fact_count": len(aging_2023),
        "comparable_count": len(exact_release_2023) + len(comparable_2023),
        "exact_release_target_count": len(exact_release_2023),
        "fallback_policy_count": len(comparable_2023),
        "fallback_policy_status_counts": dict(
            sorted(Counter(row.status.value for row in aging_2023).items())
        ),
        "fallback_factor_basis_counts": dict(
            sorted(
                Counter(
                    row.factor_basis
                    for row in comparable_2023
                    if row.factor_basis != "not_applicable"
                ).items()
            )
        ),
        "benchmark_basis": (
            "Direct build targets use their exact compiled release values. Other "
            "executable rows use the pinned aging policy, while retaining the "
            "observed 2023 value."
        ),
    }
    summary["acs_pums_2024_inputs"] = {
        **acs_pums_input_manifest,
        "interpretation": (
            "Native 2024 public-use ACS PUMS. Published ACS and Population "
            "Estimates comparisons are related to the survey weighting "
            "surface; population projections and BEA wages are external "
            "validation."
        ),
        "uncertainty": (
            "Every estimate carries SDR standard error and 90 percent margin "
            "of error from all 80 PUMS replicate weights."
        ),
        "bea_wage_benchmarks": {
            "transformation": (
                "BEA state wages residence-adjusted and scaled to NIPA"
            ),
            "state_fact_count": (
                acs_pums_bea_wage_transformations.state_count
            ),
            "national_regional_fact_count": 1,
            "national_nipa_fact_count": 1,
            "calibration_exposure": "external_validation",
            "national_wage_total": str(
                acs_pums_bea_wage_transformations.national_total
            ),
            "national_scaling_factor": str(
                acs_pums_bea_wage_transformations.scale_factor
            ),
        },
    }
    summary["yale_reconstruction_checkpoint"] = {
        "official_yale_output": False,
        "reconstruction_sha256": yale_checkpoint.reconstruction_sha256,
        "reconstruction_row_count": yale_checkpoint.reconstruction_row_count,
        "evaluated_mapping_count": len(yale_checkpoint.entries),
        "native_2024_fact_count": sum(
            entry.observed_period.value == "2024"
            for entry in yale_checkpoint.entries
        ),
        "aligned_2023_fact_count": sum(
            entry.observed_period.value == "2023"
            for entry in yale_checkpoint.entries
        ),
        "held_out_2022_row_count": yale_checkpoint.held_out_2022_row_count,
        "unmatched_row_count": yale_checkpoint.unmatched_row_count,
        "estimate_basis": YALE_ESTIMATE_BASIS,
        "dataset_version": yale_plan.source.dataset_version,
        "model_version": yale_plan.source.model_version,
        "interpretation": (
            "Precomputed output from the repository's pinned reconstruction of "
            "Yale Tax-Data and Tax-Simulator. This is not official Yale output."
        ),
        "period_policy": (
            "Native 2024 Chronicle facts are compared directly. Eligible 2023 "
            "facts use the same exact Microcosm 2023-to-2024 alignments already "
            "published in this run. Reconstruction rows tied to 2022 facts remain "
            "held out."
        ),
    }
    manifest = publish_run(
        output,
        capabilities,
        results,
        aligned_facts,
        scores=scores,
        summary=summary,
    )
    frontend_manifest = publish_frontend_bundle(
        snapshot,
        output,
        output / "frontend",
    )
    print(
        f"Published immutable run {manifest['run_id']} to {output}.",
        flush=True,
    )
    print(
        "Published Cross-dataset frontend bundle "
        f"({frontend_manifest['page_count']} fact partitions) to "
        f"{output / 'frontend'}.",
        flush=True,
    )
    print(json.dumps(summary, indent=2, sort_keys=True), flush=True)
    return manifest


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--snapshot", required=True, type=Path)
    parser.add_argument("--populace-dataset", required=True, type=Path)
    parser.add_argument("--populace-calibration-diagnostics", type=Path)
    parser.add_argument("--populace-old-cd-assignments", type=Path)
    parser.add_argument("--acs-pums-aggregates", required=True, type=Path)
    parser.add_argument("--output", required=True, type=Path)
    arguments = parser.parse_args()
    run(
        arguments.snapshot,
        arguments.populace_dataset,
        arguments.acs_pums_aggregates,
        arguments.output,
        arguments.populace_calibration_diagnostics,
        arguments.populace_old_cd_assignments,
    )


if __name__ == "__main__":
    main()
