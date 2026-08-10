import json
from decimal import Decimal
from pathlib import Path

import pytest

from evaluation_harness.contracts import (
    AlignmentQuality,
    CalibrationExposure,
    CapabilityResult,
    CapabilityStatus,
    ExecutionMethod,
    FactContract,
    SourceType,
    TypedPeriod,
)
from evaluation_harness.execution import EvaluationResult
from evaluation_harness.populace_release_targets import (
    apply_release_target_estimates,
    compile_release_target_alignments,
    materialize_release_target_results,
)


def fact(*, fact_key: str = "ledger.aggregate_fact.v2:old") -> FactContract:
    return FactContract(
        fact_key=fact_key,
        source="irs_soi",
        jurisdiction="US",
        period=TypedPeriod.parse("tax_year:2022"),
        geography_level="country",
        geography_id="0100000US",
        entity="tax_unit",
        measure="irs_soi.rental_and_royalty_net_income",
        unit="usd",
        value=Decimal("100"),
        dimensions={"income_range": "all"},
        universe_constraints=({"domain": "all_individual_income_tax_returns"},),
        provenance_class="administrative",
        lineage={"source_record_id": "irs_soi.ty2022.rental_royalty_income_amount"},
    )


def write_diagnostics(
    path: Path, *, source_record_id: str | None = None, source_year: str = "2022"
) -> None:
    source_record_id = source_record_id or fact().lineage["source_record_id"]
    path.write_text(
        json.dumps(
            {
                "targets": [
                    {
                        "name": f"{source_record_id}@2024",
                        "period": 2024,
                        "target": 112.5,
                        "compiled_target": 112.5,
                        "final_estimate": 109.5,
                        "metadata": {
                            "ledger_source_record_id": source_record_id,
                            "ledger_fact_period": source_year,
                            "ledger_period_type": "tax_year",
                            "ledger_measure_unit": "usd",
                            "aging_factor": "1.125",
                            "aging_factor_source": "chained:soi-control+cbo-agi",
                            "alignment_model_id": "cbo_growth_factor_aging",
                            "alignment_model_version": "1.2.0",
                            "target_role": "soi_fiscal_distribution",
                        },
                    }
                ]
            }
        )
    )


def test_exact_compiled_build_target_becomes_a_scored_alignment(tmp_path: Path) -> None:
    diagnostics = tmp_path / "calibration_diagnostics.json"
    write_diagnostics(diagnostics)

    result = compile_release_target_alignments(
        [fact()],
        diagnostics,
        source_id="populace_us_policyengine_us_2024",
        release_id="pinned-release",
    )

    assert result.matched_fact_count == 1
    assert result.aligned_facts[0].observed_value == Decimal("100")
    assert result.aligned_facts[0].aligned_value == Decimal("112.5")
    assert result.aligned_facts[0].factor_sources == ("chained:soi-control+cbo-agi",)
    assert result.aligned_facts[0].method_quality is AlignmentQuality.VALIDATED
    assert result.declarations[0].fact_key == fact().fact_key
    assert result.declarations[0].score_eligible
    assert result.final_estimates_by_fact_key == {
        fact().fact_key: Decimal("109.5")
    }
    assert (
        result.declarations[0].calibration_exposure
        is CalibrationExposure.DIRECT_CALIBRATION_TARGET
    )


def test_release_alignment_rejects_period_or_unit_drift(tmp_path: Path) -> None:
    diagnostics = tmp_path / "calibration_diagnostics.json"
    write_diagnostics(diagnostics)
    wrong_unit = FactContract.from_dict({**fact().to_dict(), "unit": "count"})

    result = compile_release_target_alignments(
        [wrong_unit],
        diagnostics,
        source_id="populace_us_policyengine_us_2024",
        release_id="pinned-release",
    )

    assert result.matched_fact_count == 0
    assert result.rejected_matches == {
        wrong_unit.fact_key: "release target unit usd does not match Chronicle unit count"
    }


def test_release_alignment_ignores_native_year_and_unmatched_facts(tmp_path: Path) -> None:
    diagnostics = tmp_path / "calibration_diagnostics.json"
    write_diagnostics(diagnostics, source_year="2024")
    native = FactContract.from_dict(
        {
            **fact(fact_key="ledger.aggregate_fact.v2:native").to_dict(),
            "period": "tax_year:2024",
        }
    )
    unmatched = FactContract.from_dict(
        {
            **fact(fact_key="ledger.aggregate_fact.v2:unmatched").to_dict(),
            "lineage": {"source_record_id": "not-in-build"},
        }
    )

    result = compile_release_target_alignments(
        [native, unmatched],
        diagnostics,
        source_id="populace_us_policyengine_us_2024",
        release_id="pinned-release",
    )

    assert result.matched_fact_count == 0
    assert result.native_target_fact_keys == (native.fact_key,)
    assert result.final_estimates_by_fact_key == {
        native.fact_key: Decimal("109.5")
    }


def test_release_final_estimate_replaces_only_matching_executed_results(
    tmp_path: Path,
) -> None:
    diagnostics = tmp_path / "calibration_diagnostics.json"
    write_diagnostics(diagnostics)
    release = compile_release_target_alignments(
        [fact()],
        diagnostics,
        source_id="populace_us_policyengine_us_2024",
        release_id="pinned-release",
    )
    result = EvaluationResult(
        snapshot_id="ledger-test",
        mapping_release="mapping-v1",
        source_id="populace_us_policyengine_us_2024",
        fact_key=fact().fact_key,
        estimate=Decimal("999"),
        dataset_version="pinned-release",
        model_version="policyengine-us==1",
        population_period="calendar_year:2024",
        policy_period="tax_year:2024",
        period_treatment="aligned_fact",
        alignment_id="alignment",
        calibration_exposure="direct_calibration_target",
        mapping_id="mapping",
        execution_method="model",
    )

    replaced = apply_release_target_estimates((result,), release)

    assert replaced[0].estimate == Decimal("109.5")
    assert replaced[0].estimate_basis == "microcosm_release_final_estimate"


def test_release_diagnostic_materializes_target_without_a_generic_query(
    tmp_path: Path,
) -> None:
    diagnostics = tmp_path / "calibration_diagnostics.json"
    jct_fact = FactContract.from_dict(
        {
            **fact().to_dict(),
            "measure": "jct.individual_tax_expenditure_revenue_loss",
            "lineage": {"source_record_id": "jct.tax_expenditure.traditional_ira"},
        }
    )
    write_diagnostics(
        diagnostics,
        source_record_id="jct.tax_expenditure.traditional_ira",
    )
    release = compile_release_target_alignments(
        [jct_fact],
        diagnostics,
        source_id="populace_us_policyengine_us_2024",
        release_id="pinned-release",
    )
    unsupported = CapabilityResult.unsupported(
        snapshot_id="ledger-test",
        fact=jct_fact,
        source_id="populace_us_policyengine_us_2024",
        source_type=SourceType.MODEL_DATASET_PAIR,
        mapping_release="mapping-v1",
        status=CapabilityStatus.UNSUPPORTED_CONCEPT,
        reason_code="mapping_not_found",
        reason_detail="No generic aggregate query exists for this JCT concept.",
    )

    capabilities, results = materialize_release_target_results(
        (unsupported,),
        release,
        source_id="populace_us_policyengine_us_2024",
        dataset_version="pinned-release",
        model_version="policyengine-us==1",
        population_period=TypedPeriod.parse("calendar_year:2024"),
        policy_period=TypedPeriod.parse("tax_year:2024"),
    )

    capability = capabilities[0]
    assert capability.status is CapabilityStatus.CALIBRATION_TARGET
    assert capability.execution_method is ExecutionMethod.PRECOMPUTED
    assert capability.query is None
    assert capability.reason_code is None
    assert capability.alignment_id == release.declarations[0].alignment_id
    assert capability.score_eligible
    assert results[0].estimate == Decimal("109.5")
    assert results[0].estimate_basis == "microcosm_release_final_estimate"


def test_release_target_without_a_final_estimate_is_rejected(tmp_path: Path) -> None:
    diagnostics = tmp_path / "calibration_diagnostics.json"
    write_diagnostics(diagnostics)
    payload = json.loads(diagnostics.read_text())
    del payload["targets"][0]["final_estimate"]
    diagnostics.write_text(json.dumps(payload))

    with pytest.raises(ValueError, match="final_estimate"):
        compile_release_target_alignments(
            [fact()],
            diagnostics,
            source_id="populace_us_policyengine_us_2024",
            release_id="pinned-release",
        )
