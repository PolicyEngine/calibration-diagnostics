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
    load_snapshot_facts,
)
from evaluation_harness.frontend_bundle import publish_frontend_bundle
from evaluation_harness.integration import load_integration_overview
from evaluation_harness.mappings import MappingRegistry
from evaluation_harness.populace_aging import (
    PopulaceAgingPolicy,
    transform_ledger_facts_to_populace_year,
    transform_ledger_facts_to_populace_years,
)
from evaluation_harness.populace_old_cd import load_old_cd_assignments
from evaluation_harness.populace_release_targets import (
    compile_release_target_alignments,
)
from evaluation_harness.publisher import publish_run


ROOT = Path(__file__).resolve().parents[1]
POPULACE_INTEGRATION = ROOT / "integrations" / "populace_policyengine_us"
CPS_INTEGRATION = ROOT / "integrations" / "taxcalc_cps"
ACS_PUMS_INTEGRATION = ROOT / "integrations" / "census_acs_pums"


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
    facts, snapshot_manifest = load_snapshot_facts(snapshot)
    snapshot_id = snapshot_manifest["snapshot_id"]
    print(
        f"Loaded {len(facts):,} facts from immutable snapshot {snapshot_id}.",
        flush=True,
    )

    populace_overview = load_integration_overview(
        POPULACE_INTEGRATION / "overview.yaml"
    )
    cps_overview = load_integration_overview(CPS_INTEGRATION / "overview.yaml")
    acs_pums_overview = load_integration_overview(
        ACS_PUMS_INTEGRATION / "overview.yaml"
    )
    for overview in (populace_overview, cps_overview, acs_pums_overview):
        if overview.ledger_snapshot_id != snapshot_id:
            raise ValueError(
                f"integration {overview.integration_id} was reviewed against "
                f"{overview.ledger_snapshot_id}, not {snapshot_id}"
            )

    aging_policy = PopulaceAgingPolicy.from_facts(facts)
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
    diagnostics_path = populace_calibration_diagnostics
    if diagnostics_path is None:
        diagnostics_path = resolve_release_calibration_diagnostics(
            POPULACE_RELEASE, populace_dataset.parent
        )
    release_target_alignments = compile_release_target_alignments(
        facts,
        diagnostics_path,
        source_id=populace_overview.source.source_id,
        release_id=POPULACE_RELEASE.release_id,
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
    comparable_aging = tuple(
        row
        for row in aging_results
        if row.comparable and row.source_fact.fact_key not in exact_release_fact_keys
    )
    aligned_facts = tuple(
        [
            *release_target_alignments.aligned_facts,
            *(row.to_aligned_fact() for row in comparable_aging),
        ]
    )
    populace_plan = SourcePlan(
        source=populace_overview.source,
        mappings=MappingRegistry.from_yaml(POPULACE_INTEGRATION / "mappings.yaml"),
        alignments=tuple(
            [
                *release_target_alignments.declarations,
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
    )
    acs_pums_plan = SourcePlan(
        source=acs_pums_overview.source,
        mappings=MappingRegistry.from_yaml(
            ACS_PUMS_INTEGRATION / "mappings.yaml"
        ),
    )
    capabilities = build_full_capability_matrix(
        facts,
        [populace_plan, cps_plan, acs_pums_plan],
        snapshot_id=snapshot_id,
    )
    expected_capabilities = len(facts) * 3
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
    populace_results = execute_groups(
        populace_groups,
        populace_capabilities,
        {populace_plan.source.source_id: populace_runner},
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
        f"Tax-Calculator/public-CPS capability cells in {len(cps_groups)} groups.",
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

    results = tuple([*populace_results, *cps_results, *acs_pums_results])
    scores = build_scored_results(facts, capabilities, results, aligned_facts)
    summary = build_run_summary(facts, capabilities, results, scores)
    summary["populace_prior_years_to_2024_alignment"] = {
        "policy": "Exact Populace cbo_growth_factor_aging@1.2.0 semantics",
        "observed_years": list(source_years),
        "evaluation_year": build_year,
        "fact_count": len(aging_results),
        "comparable_count": len(aligned_facts),
        "exact_release_target_count": len(
            release_target_alignments.aligned_facts
        ),
        "fallback_policy_count": len(comparable_aging),
        "fallback_policy_status_counts": dict(
            sorted(Counter(row.status.value for row in aging_results).items())
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
        "benchmark_basis": (
            "Cross-period Chronicle facts that were direct targets in the pinned "
            "Microcosm build use the exact compiled target values and recorded "
            "aging/uprating lineage from that release."
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
        "benchmark_basis": (
            "Direct build targets use their exact compiled release values. Other "
            "executable rows use the pinned aging policy, while retaining the "
            "observed 2023 value."
        ),
    }
    summary["acs_pums_2024_inputs"] = {
        **acs_pums_input_manifest,
        "interpretation": (
            "Native 2024 public-use ACS subsample compared with published "
            "full-sample ACS facts; not independent external validation."
        ),
        "uncertainty": (
            "Every estimate carries SDR standard error and 90 percent margin "
            "of error from all 80 PUMS replicate weights."
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
