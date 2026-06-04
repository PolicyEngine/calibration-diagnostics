from __future__ import annotations

import json
import math

from backend.routes import microplex


def test_microplex_overview_shapes_public_artifacts(monkeypatch):
    monkeypatch.delenv("MICROPLEX_ARTIFACT_ROOTS", raising=False)
    monkeypatch.delenv("MICROPLEX_ARTIFACT_ROOT", raising=False)
    parity = {
        "artifactId": "artifact-1",
        "verdict": {"candidateBeatsHarnessMeanAbsRelativeError": True},
        "baselineSlice": {
            "baselineLabel": "policyengine_us_data",
            "candidateLabel": "microplex",
            "calibrationTargetProfile": "pe_native_broad",
            "comparisonMetadata": {"n_synthetic": 2000},
            "targetPeriod": 2024,
        },
        "comparison": {
            "policyengineHarness": {
                "isPolicyEngineComparison": True,
                "baseline_composite_parity_loss": 10.0,
                "candidate_composite_parity_loss": 8.0,
                "composite_parity_loss_delta": -2.0,
                "baseline_mean_abs_relative_error": 1.5,
                "candidate_mean_abs_relative_error": 1.0,
                "mean_abs_relative_error_delta": -0.5,
                "slice_win_rate": 0.75,
                "supported_target_rate": 0.5,
                "tag_summaries": {
                    "all_targets": {
                        "target_win_rate": 0.25,
                        "candidate_micro_mean_abs_relative_error": math.inf,
                    }
                },
            },
            "policyengineNativeScores": {
                "available": True,
                "metric": "enhanced_cps_native_loss",
                "period": 2024,
                "baseline_enhanced_cps_native_loss": 0.2,
                "candidate_enhanced_cps_native_loss": 0.1,
                "enhanced_cps_native_loss_delta": -0.1,
                "candidate_beats_baseline": True,
                "n_targets_total": 10,
                "n_targets_kept": 9,
                "n_national_targets": 4,
                "n_state_targets": 5,
                "n_targets_bad_dropped": 1,
                "n_targets_zero_dropped": 0,
            },
        },
    }
    regression = {
        "totalScoredRuns": 2,
        "totalAuditedRuns": 1,
        "bestRuns": [{"artifactPath": "best"}],
        "worstRuns": [{"artifactPath": "worst"}],
        "largestFamilyCounts": [{"family": "state_agi_distribution", "count": 1}],
        "top3FamilyCounts": [{"family": "national_irs_other", "top3Count": 2}],
        "targetCountsFromAudits": [{"target": "target-a", "count": 1}],
    }
    drilldown = {
        "family": "national_irs_other",
        "auditsWhereFamilyLeads": 1,
        "auditsWithMatchingTargets": 1,
        "leadAudits": [{"artifactPath": "audit", "matchingTargets": []}],
        "leadTargetCounts": [{"target": "target-a", "count": 1}],
        "leadFilingStatusGapSummary": [{"filingStatus": "SINGLE"}],
        "leadMFSAgiGapSummary": [{"agiBin": "500k_plus"}],
    }

    payloads = {
        microplex._PARITY_PATH: parity,
        microplex._REGRESSION_SUMMARY_PATH: regression,
        microplex._IRS_DRILLDOWN_PATH: drilldown,
    }
    monkeypatch.setattr(microplex, "_fetch_json", lambda path: payloads[path])

    result = microplex.microplex_overview()

    assert result["artifact_id"] == "artifact-1"
    assert result["headline"]["target_win_rate"] == 0.25
    assert (
        result["headline"]["tag_summaries"]["all_targets"][
            "candidate_micro_mean_abs_relative_error"
        ]
        is None
    )
    assert result["regression_summary"]["target_counts_from_audits"] == [
        {"target": "target-a", "count": 1}
    ]
    assert result["native_scores"]["candidate_enhanced_cps_native_loss"] == 0.1
    assert result["native_scores"]["n_targets_kept"] == 9
    assert result["native_scores"]["target_rows_available"] is False
    assert (
        result["repo_structure"]["full_target_diagnostics"]["expected_path"]
        == "pe_native_target_diagnostics.json"
    )
    assert (
        result["repo_structure"]["full_target_diagnostics"]["manifest_key"]
        == "policyengine_native_target_diagnostics"
    )
    assert (
        result["newer_runs"]["run_bundle_path_hint"]
        == "pe_native_target_diagnostics.json"
    )
    assert "microplex_vs_target_oracle" in result["repo_structure"]["analysis_modes"]
    assert (
        "Standalone Microplex aggregate-vs-target diagnostics"
        in result["repo_structure"]["full_target_diagnostics"]["primary_use"]
    )
    assert "run_index.duckdb" == result["repo_structure"]["run_index"]["path_hint"]
    assert result["irs_drilldown"]["lead_filing_status_gap_summary"] == [
        {"filingStatus": "SINGLE"}
    ]
    assert [artifact["name"] for artifact in result["source_artifacts"]] == [
        "parity",
        "regression_summary",
        "irs_drilldown",
    ]
    assert "Microplex target-oracle" in result["limitations"][2]


def test_microplex_overview_discovers_configured_run_bundles(
    monkeypatch,
    tmp_path,
):
    root = tmp_path / "runs"
    bundle = root / "run-1"
    bundle.mkdir(parents=True)
    (bundle / "pe_native_target_diagnostics.json").write_text(
        json.dumps(
            {
                "diagnostic_schema_version": 1,
                "metric": "enhanced_cps_native_loss_target_delta",
                "period": 2024,
                "summary": {"n_targets": 1},
                "targets": [
                    {
                        "target_id": "nation/irs/example",
                        "family": "national_irs_other",
                        "target_value": 100.0,
                        "us_data_aggregate": 90.0,
                        "microplex_aggregate": 95.0,
                        "delta_absolute_error": -5.0,
                    }
                ],
            }
        )
    )
    (bundle / "policyengine_native_scores.json").write_text(
        json.dumps(
            {
                "metric": "enhanced_cps_native_loss",
                "period": 2024,
                "summary": {
                    "baseline_enhanced_cps_native_loss": 0.9,
                    "candidate_enhanced_cps_native_loss": 0.8,
                    "enhanced_cps_native_loss_delta": -0.1,
                    "candidate_beats_baseline": True,
                    "n_targets_total": 2,
                    "n_targets_kept": 1,
                },
            }
        )
    )
    (bundle / "pe_us_data_rebuild_native_audit.json").write_text("{}")
    (bundle / "policyengine_us.h5").write_bytes(b"h5")
    (bundle / "manifest.json").write_text(
        json.dumps(
            {
                "artifact_id": "run-1",
                "artifacts": {
                    "policyengine_native_target_diagnostics": (
                        "pe_native_target_diagnostics.json"
                    ),
                    "policyengine_native_scores": "policyengine_native_scores.json",
                    "policyengine_native_audit": "pe_us_data_rebuild_native_audit.json",
                    "policyengine_dataset": "policyengine_us.h5",
                },
            }
        )
    )

    parity = {
        "baselineSlice": {},
        "comparison": {"policyengineHarness": {}, "policyengineNativeScores": {}},
    }
    payloads = {
        microplex._PARITY_PATH: parity,
        microplex._REGRESSION_SUMMARY_PATH: {},
        microplex._IRS_DRILLDOWN_PATH: {},
    }
    monkeypatch.setattr(microplex, "_fetch_json", lambda path: payloads[path])
    monkeypatch.setenv("MICROPLEX_ARTIFACT_ROOTS", str(root))

    result = microplex.microplex_overview()

    discovery = result["newer_runs"]["configured_run_discovery"]
    assert discovery["detected_run_bundle_count"] == 1
    assert discovery["detected_target_diagnostics_count"] == 1
    assert discovery["latest_run_bundle"]["artifact_id"] == "run-1"
    assert discovery["latest_run_bundle"]["native_audit_exists"] is True
    assert discovery["latest_run_bundle"]["policyengine_dataset_exists"] is True
    assert result["native_scores"]["target_rows_available"] is True
    assert result["native_scores"]["source"] == "configured_run_bundle"
    assert result["native_scores"]["candidate_enhanced_cps_native_loss"] == 0.8
    assert result["native_scores"]["enhanced_cps_native_loss_delta"] == -0.1
    assert result["native_scores"]["full_target_diagnostics_path"].endswith(
        "pe_native_target_diagnostics.json"
    )
    assert result["target_diagnostics"]["available"] is True
    assert result["target_diagnostics"]["total_targets"] == 1
    assert result["target_diagnostics"]["targets"][0]["target_id"] == (
        "nation/irs/example"
    )


def test_microplex_reform_comparison_uses_configured_h5(monkeypatch, tmp_path):
    bundle = tmp_path / "run-1"
    bundle.mkdir()
    h5 = bundle / "policyengine_us.h5"
    h5.write_bytes(b"h5")
    (bundle / "manifest.json").write_text(
        json.dumps(
            {
                "artifact_id": "run-1",
                "artifacts": {"policyengine_dataset": "policyengine_us.h5"},
            }
        )
    )
    monkeypatch.setenv("MICROPLEX_ARTIFACT_ROOTS", str(tmp_path))
    monkeypatch.setenv("MICROSIM_US_DATASET", "/tmp/us-data.h5")
    monkeypatch.setattr(microplex, "_REFORM_COMPARISON_CACHE", {})

    def fake_run(*, dataset, reform_id, variable, period, entity):
        assert reform_id == "halve_joint_eitc_phase_out_rate"
        assert variable == "eitc"
        assert period == 2024
        assert entity == "tax_unit"
        delta = 10.0 if dataset == "/tmp/us-data.h5" else 2.0
        return {
            "dataset": dataset,
            "baseline": {
                "total": 100.0,
                "unweighted_mean": 1.0,
                "record_count": 5,
                "weight_sum": 5.0,
            },
            "reform": {
                "total": 100.0 + delta,
                "unweighted_mean": 1.1,
                "record_count": 5,
                "weight_sum": 5.0,
            },
            "delta": delta,
        }

    monkeypatch.setattr(microplex, "_run_dataset_reform_comparison", fake_run)

    result = microplex.microplex_reform_comparison(
        reform_id="halve_joint_eitc_phase_out_rate"
    )

    assert result["available"] is True
    assert "available_reforms" in result
    assert result["microplex_bundle"]["artifact_id"] == "run-1"
    outcome = result["outcomes"][0]
    assert outcome["us_data"]["delta"] == 10.0
    assert outcome["microplex"]["delta"] == 2.0
    assert outcome["delta_gap"] == -8.0
    assert outcome["microplex_delta_as_share_of_us_data"] == 0.2


def test_microplex_budget_benchmarks_include_live_and_external_rows(
    monkeypatch,
    tmp_path,
):
    bundle = tmp_path / "run-1"
    bundle.mkdir()
    h5 = bundle / "policyengine_us.h5"
    h5.write_bytes(b"h5")
    (bundle / "manifest.json").write_text(
        json.dumps(
            {
                "artifact_id": "run-1",
                "artifacts": {"policyengine_dataset": "policyengine_us.h5"},
            }
        )
    )
    monkeypatch.setenv("MICROPLEX_ARTIFACT_ROOTS", str(tmp_path))
    monkeypatch.setenv("MICROSIM_US_DATASET", "/tmp/us-data.h5")
    monkeypatch.setattr(microplex, "_BUDGET_BENCHMARK_CACHE", {})

    def fake_run(*, dataset, reform_id, variable, period, entity):
        assert entity == "tax_unit"
        assert reform_id in {
            "wyden_smith_ctc_2024",
            "kypa_ctc_2026",
            "kypa_childless_eitc_2026",
            "obbba_no_tax_on_tips_repeal_2026",
            "obbba_no_tax_on_overtime_repeal_2026",
            "obbba_senior_deduction_repeal_2026",
        }
        if reform_id == "wyden_smith_ctc_2024":
            assert variable == "ctc"
            assert period == 2024
        elif reform_id == "kypa_ctc_2026":
            assert variable == "ctc"
            assert period == 2026
        elif reform_id == "kypa_childless_eitc_2026":
            assert variable == "eitc"
            assert period == 2026
        else:
            assert variable == "income_tax"
            assert period == 2026
        delta = 120.0 if dataset == "/tmp/us-data.h5" else 60.0
        return {
            "dataset": dataset,
            "baseline": {
                "total": 1_000.0,
                "unweighted_mean": 10.0,
                "record_count": 100,
                "weight_sum": 100.0,
            },
            "reform": {
                "total": 1_000.0 + delta,
                "unweighted_mean": 11.0,
                "record_count": 100,
                "weight_sum": 100.0,
            },
            "delta": delta,
        }

    monkeypatch.setattr(microplex, "_run_dataset_reform_comparison", fake_run)

    result = microplex.microplex_budget_benchmarks(compute_live=True)

    assert result["available"] is True
    assert result["microplex_bundle"]["artifact_id"] == "run-1"
    live_rows = [row for row in result["rows"] if row["live"]["available"]]
    assert len(live_rows) == 6
    afa = next(row for row in result["rows"] if row["id"] == "american_family_act_2025")
    assert afa["live"]["available"] is False
    assert afa["comparison_status"] == "model_context_no_third_party_score"

    wyden_smith = next(row for row in live_rows if row["id"] == "wyden_smith_ctc_2024")
    assert wyden_smith["comparison_status"] == "live_model_with_third_party_score"
    assert wyden_smith["external_estimates"][0]["source"] == (
        "Joint Committee on Taxation"
    )
    assert wyden_smith["external_estimates"][0]["estimate"] == 10_700_000_000
    assert wyden_smith["external_estimates"][0]["us_data_gap"] == -10_699_999_880.0
    assert wyden_smith["external_estimates"][0]["comparable_to_live_annual_result"] is True

    kypa_ctc = next(row for row in live_rows if row["id"] == "kypa_ctc_2026")
    assert kypa_ctc["comparison_status"] == "live_model_with_third_party_score"
    assert kypa_ctc["external_estimates"][0]["source"] == (
        "Penn Wharton Budget Model"
    )
    assert kypa_ctc["external_estimates"][0]["estimate"] == 140_500_000_000
    assert kypa_ctc["external_estimates"][0]["comparable_to_live_annual_result"] is True
    assert kypa_ctc["external_estimates"][1]["estimate"] == 2_500_000_000
    assert kypa_ctc["external_estimates"][1]["comparable_to_live_annual_result"] is False
    assert kypa_ctc["external_estimates"][2]["estimate"] == 1_261_600_000_000

    kypa_eitc = next(
        row for row in live_rows if row["id"] == "kypa_childless_eitc_2026"
    )
    assert kypa_eitc["live"]["outcome_variable"] == "eitc"
    assert kypa_eitc["external_estimates"][0]["source"] == (
        "Penn Wharton Budget Model"
    )
    assert kypa_eitc["external_estimates"][0]["estimate"] == 7_200_000_000
    assert kypa_eitc["external_estimates"][1]["estimate"] == 800_000_000
    assert kypa_eitc["external_estimates"][2]["estimate"] == 63_800_000_000

    tips = next(
        row for row in live_rows if row["id"] == "obbba_no_tax_on_tips_repeal_2026"
    )
    assert tips["live"]["outcome_variable"] == "income_tax"
    assert tips["live"]["us_data"]["budget_effect"] == 120.0
    assert tips["live"]["microplex"]["budget_effect"] == 60.0
    assert tips["live"]["budget_effect_gap"] == -60.0
    assert tips["live"]["microplex_budget_effect_as_share_of_us_data"] == 0.5
    assert tips["external_estimates"][0]["source"] == (
        "Joint Committee on Taxation JCX-35-25"
    )
    assert tips["external_estimates"][0]["estimate"] == 10_121_000_000
    assert tips["comparison_status"] == "waterfall_external_score_context"
    assert tips["external_estimates"][0]["comparable_to_live_annual_result"] is False

    external_only = next(
        row for row in result["rows"] if row["id"] == "tcja_extension_2026_2035"
    )
    assert external_only["live"]["available"] is False
    assert external_only["external_estimates"][0]["source"] == "CBO/JCT"
    assert external_only["external_estimates"][0]["estimate"] == 3_877_600_000_000


def test_microplex_target_diagnostics_paginates_and_filters(monkeypatch, tmp_path):
    root = tmp_path / "runs"
    bundle = root / "run-1"
    bundle.mkdir(parents=True)
    rows = [
        {
            "target_id": "state/CA/agi/count/0_10k",
            "family": "state_agi_distribution",
            "state": "CA",
            "geo_level": "state",
            "supported_by_microplex": True,
            "in_loss": True,
            "target_value": 10.0,
            "us_data_aggregate": 8.0,
            "microplex_aggregate": 9.0,
        },
        {
            "target_id": "state/MT/snap/households",
            "family": "state_snap_households",
            "state": "MT",
            "geo_level": "state",
            "supported_by_microplex": False,
            "in_loss": True,
            "target_value": 20.0,
            "us_data_aggregate": 19.0,
            "microplex_aggregate": math.inf,
        },
        {
            "target_id": "nation/irs/dividends",
            "family": "national_irs_other",
            "state": None,
            "geo_level": "national",
            "supported_by_microplex": True,
            "in_loss": False,
            "target_value": 30.0,
            "us_data_aggregate": 29.0,
            "microplex_aggregate": 31.0,
            "us_data_relative_error": -0.0001,
            "microplex_relative_error": 0.0001,
        },
    ]
    (bundle / "pe_native_target_diagnostics.json").write_text(
        json.dumps(
            {
                "diagnostic_schema_version": 1,
                "metric": "enhanced_cps_native_loss_target_delta",
                "period": 2024,
                "baseline_dataset": "us-data.h5",
                "candidate_dataset": "microplex.h5",
                "dataset_labels": {"from": "us-data", "to": "microplex"},
                "summary": {"n_targets": 3},
                "targets": rows,
            }
        )
    )
    (bundle / "manifest.json").write_text(
        json.dumps(
            {
                "artifact_id": "run-1",
                "artifacts": {
                    "policyengine_native_target_diagnostics": (
                        "pe_native_target_diagnostics.json"
                    ),
                    "policyengine_dataset": "policyengine_us.h5",
                },
            }
        )
    )
    monkeypatch.setenv("MICROPLEX_ARTIFACT_ROOTS", str(root))

    page = microplex.microplex_target_diagnostics(limit=1, offset=1)

    assert page["available"] is True
    assert page["microplex_bundle"]["artifact_id"] == "run-1"
    assert page["total_targets"] == 3
    assert page["filtered_total"] == 3
    assert page["limit"] == 1
    assert page["offset"] == 1
    assert page["has_next"] is True
    assert page["targets"][0]["target_id"] == "state/MT/snap/households"
    assert page["targets"][0]["microplex_aggregate"] is None

    filtered = microplex.microplex_target_diagnostics(
        family="state_agi_distribution",
        state="ca",
        supported=True,
        in_loss=True,
        search="agi",
    )

    assert filtered["filtered_total"] == 1
    assert filtered["has_next"] is False
    assert filtered["targets"][0]["target_id"] == "state/CA/agi/count/0_10k"
    assert filtered["filters"]["state"] == "ca"

    sorted_desc = microplex.microplex_target_diagnostics(
        sort_by="microplex_vs_target_relative",
        sort_dir="desc",
    )
    assert [row["target_id"] for row in sorted_desc["targets"]] == [
        "nation/irs/dividends",
        "state/CA/agi/count/0_10k",
        "state/MT/snap/households",
    ]
    assert sorted_desc["targets"][0]["microplex_vs_target_relative"] == (
        1.0 / 30.0
    )
    assert sorted_desc["targets"][0]["us_data_vs_target_relative"] == (
        -1.0 / 30.0
    )
    assert sorted_desc["targets"][-1]["microplex_vs_target_relative"] is None

    sorted_asc = microplex.microplex_target_diagnostics(
        sort_by="target_value",
        sort_dir="asc",
    )
    assert [row["target_id"] for row in sorted_asc["targets"]] == [
        "state/CA/agi/count/0_10k",
        "state/MT/snap/households",
        "nation/irs/dividends",
    ]

    family_desc = microplex.microplex_target_diagnostics(
        sort_by="family",
        sort_dir="desc",
    )
    assert [row["target_id"] for row in family_desc["targets"]] == [
        "state/MT/snap/households",
        "state/CA/agi/count/0_10k",
        "nation/irs/dividends",
    ]

    aggregate_desc = microplex.microplex_target_diagnostics(
        sort_by="microplex_aggregate",
        sort_dir="desc",
    )
    assert [row["target_id"] for row in aggregate_desc["targets"]] == [
        "nation/irs/dividends",
        "state/CA/agi/count/0_10k",
        "state/MT/snap/households",
    ]

    above_target = microplex.microplex_target_diagnostics(
        microplex_target_direction="above"
    )
    assert [row["target_id"] for row in above_target["targets"]] == [
        "nation/irs/dividends"
    ]

    below_target = microplex.microplex_target_diagnostics(
        microplex_target_direction="below"
    )
    assert [row["target_id"] for row in below_target["targets"]] == [
        "state/CA/agi/count/0_10k"
    ]


def test_microplex_target_diagnostics_unavailable_without_sidecar(
    monkeypatch,
    tmp_path,
):
    bundle = tmp_path / "run-1"
    bundle.mkdir()
    (bundle / "manifest.json").write_text(
        json.dumps(
            {
                "artifact_id": "run-1",
                "artifacts": {"policyengine_dataset": "policyengine_us.h5"},
            }
        )
    )
    monkeypatch.setenv("MICROPLEX_ARTIFACT_ROOTS", str(tmp_path))

    result = microplex.microplex_target_diagnostics()

    assert result["available"] is False
    assert result["filtered_total"] == 0
    assert "No readable" in result["reason"]
