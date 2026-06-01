from __future__ import annotations

import math

from backend.routes import microplex


def test_microplex_overview_shapes_public_artifacts(monkeypatch):
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
            }
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
    assert result["irs_drilldown"]["lead_filing_status_gap_summary"] == [
        {"filingStatus": "SINGLE"}
    ]
    assert [artifact["name"] for artifact in result["source_artifacts"]] == [
        "parity",
        "regression_summary",
        "irs_drilldown",
    ]
    assert "not a target-by-target" in result["limitations"][2]
