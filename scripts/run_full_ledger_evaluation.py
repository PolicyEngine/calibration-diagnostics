"""Classify and execute the full pinned Ledger snapshot for approved adapters."""

from __future__ import annotations

import argparse
import gc
import json
from collections import Counter
from pathlib import Path

from evaluation_harness.adapters.acs_pums import ACSPUMSRunner, execute_acs_pums
from evaluation_harness.adapters.populace import PopulacePolicyEngineRunner
from evaluation_harness.adapters.taxcalc_cps import TaxCalcCPSRunner
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
    comparable_aging = tuple(row for row in aging_results if row.comparable)
    aligned_facts = tuple(row.to_aligned_fact() for row in comparable_aging)
    populace_plan = SourcePlan(
        source=populace_overview.source,
        mappings=MappingRegistry.from_yaml(POPULACE_INTEGRATION / "mappings.yaml"),
        alignments=tuple(
            row.to_alignment_declaration(populace_overview.source.source_id)
            for row in comparable_aging
        ),
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
    populace_runner = PopulacePolicyEngineRunner(dataset_path=populace_dataset)
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
        "comparable_count": len(comparable_aging),
        "status_counts": dict(
            sorted(Counter(row.status.value for row in aging_results).items())
        ),
        "benchmark_basis": (
            "Executable aligned rows compare the 2024 model estimate with the "
            "published 2024 transformation, while retaining each prior-year "
            "observed value."
        ),
    }
    aging_2023 = transform_ledger_facts_to_populace_year(
        facts,
        aging_policy,
        source_year=2023,
        build_year=build_year,
    )
    comparable_2023 = tuple(row for row in aging_2023 if row.comparable)
    summary["populace_2023_to_2024_alignment"] = {
        "policy": "Exact Populace cbo_growth_factor_aging@1.2.0 semantics",
        "observed_year": 2023,
        "evaluation_year": build_year,
        "fact_count": len(aging_2023),
        "comparable_count": len(comparable_2023),
        "status_counts": dict(
            sorted(Counter(row.status.value for row in aging_2023).items())
        ),
        "benchmark_basis": (
            "Executable aligned rows compare the 2024 model estimate with the "
            "published 2024 transformation, while retaining the observed 2023 value."
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
    parser.add_argument("--acs-pums-aggregates", required=True, type=Path)
    parser.add_argument("--output", required=True, type=Path)
    arguments = parser.parse_args()
    run(
        arguments.snapshot,
        arguments.populace_dataset,
        arguments.acs_pums_aggregates,
        arguments.output,
    )


if __name__ == "__main__":
    main()
