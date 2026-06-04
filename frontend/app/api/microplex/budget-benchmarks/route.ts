import { NextResponse } from "next/server";

const ROWS = [
  {
    id: "american_family_act_2025",
    title: "American Family Act 2025 CTC expansion",
    policy_area: "Child Tax Credit",
    benchmark_period: "2026 annual",
    comparison_status: "live_model_no_third_party_score",
    budget_effect_rule: "credit_delta_is_cost",
    notes:
      "No independent public budget score is attached for this bill. PolicyEngine has a published static analysis, but that is not a third-party benchmark and is intentionally excluded from the external comparison slot.",
    external_estimates: [
      {
        source: "CBO/JCT",
        source_type: "official_score",
        url: "https://www.congress.gov/bill/119th-congress/house-bill/2763",
        estimate: null,
        estimate_label: "No public CBO/JCT score found for H.R.2763 / S.1393.",
        period: "not available",
      },
    ],
  },
  {
    id: "working_parents_tax_relief_act_2026",
    title: "Working Parents Tax Relief Act EITC enhancement",
    policy_area: "Earned Income Tax Credit",
    benchmark_period: "2026 annual",
    comparison_status: "live_model_partial_external_context",
    budget_effect_rule: "credit_delta_is_cost",
    notes:
      "Live microsim rows require the Python backend and a configured Microplex H5 artifact root.",
    external_estimates: [
      {
        source: "Thomson Reuters coverage",
        source_type: "third_party_context",
        url: "https://tax.thomsonreuters.com/news/bill-seeks-earned-income-tax-credit-boost-per-child-for-working-parents/",
        estimate: null,
        estimate_label:
          "Third-party coverage found; no single budget score is attached in this catalog.",
        period: "not available",
      },
      {
        source: "PolicyEngine policy page",
        source_type: "published_model_result",
        url: "https://www.policyengine.org/us/working-parents-tax-relief-act",
        estimate: null,
        estimate_label: "PolicyEngine analysis; not a CBO/JCT comparator.",
        period: "2026+",
      },
    ],
  },
  {
    id: "wyden_smith_ctc_2024",
    title: "Wyden-Smith / TRAFWA CTC provisions",
    policy_area: "Child Tax Credit",
    benchmark_period: "2024 annual",
    comparison_status: "live_model_with_third_party_score",
    budget_effect_rule: "credit_delta_is_cost",
    notes:
      "This is a true third-party benchmark row when connected to the Python backend. The static fallback cannot run the live us-data and Microplex microsims.",
    external_estimates: [
      {
        source: "Joint Committee on Taxation",
        source_type: "jct",
        url: "https://waysandmeans.house.gov/wp-content/uploads/2024/01/Estimated-Revenue-Effects-of-H.R.-7024.pdf",
        estimate: 10_700_000_000,
        estimate_label:
          "$10.7B 2024 cost for the combined CTC provisions, as reported in PolicyEngine's JCT comparison table.",
        period: "2024",
        comparable_to_live_annual_result: true,
      },
      {
        source: "Joint Committee on Taxation",
        source_type: "jct",
        url: "https://waysandmeans.house.gov/wp-content/uploads/2024/01/Estimated-Revenue-Effects-of-H.R.-7024.pdf",
        estimate: 33_493_000_000,
        estimate_label:
          "$33.493B 2024-2033 revenue effect for the Tax Relief for Working Families line in JCX-3-24.",
        period: "2024-2033",
        comparable_to_live_annual_result: false,
      },
    ],
  },
  {
    id: "kypa_ctc_2026",
    title: "Keep Your Pay Act expanded CTC",
    policy_area: "Child Tax Credit",
    benchmark_period: "2026 annual",
    comparison_status: "live_model_with_third_party_score",
    budget_effect_rule: "credit_delta_is_cost",
    notes:
      "PWBM provides separable KYPA CTC estimates. Live dashboard comparison uses the 2026 annual CTC delta against PWBM's FY2027 line as a full-year fiscal proxy. PWBM's FY2026 line is much smaller because refundable credit timing shifts most TY2026 cost into FY2027. The PolicyEngine-US reform is an AFA-style approximation, so the newborn-bonus mechanics may not match PWBM exactly.",
    external_estimates: [
      {
        source: "Penn Wharton Budget Model",
        source_type: "pwbm",
        url: "https://budgetmodel.wharton.upenn.edu/p/2026-03-11-the-keep-your-pay-act-budgetary-and-distributional-effects/",
        estimate: 140_500_000_000,
        estimate_label:
          "$140.5B FY2027 revenue loss for KYPA's expanded Child Tax Credit provision. This is the closest full-year fiscal proxy for a calendar-year 2026 microsim.",
        period: "FY2027 proxy for TY2026",
        comparable_to_live_annual_result: true,
      },
      {
        source: "Penn Wharton Budget Model",
        source_type: "pwbm",
        url: "https://budgetmodel.wharton.upenn.edu/p/2026-03-11-the-keep-your-pay-act-budgetary-and-distributional-effects/",
        estimate: 2_500_000_000,
        estimate_label:
          "$2.5B FY2026 revenue loss. Included as timing context; not comparable to a full calendar-year 2026 tax microsim.",
        period: "FY2026 timing context",
        comparable_to_live_annual_result: false,
      },
      {
        source: "Penn Wharton Budget Model",
        source_type: "pwbm",
        url: "https://budgetmodel.wharton.upenn.edu/p/2026-03-11-the-keep-your-pay-act-budgetary-and-distributional-effects/",
        estimate: 1_261_600_000_000,
        estimate_label:
          "$1.2616T FY2026-2035 revenue loss for KYPA's expanded Child Tax Credit provision.",
        period: "FY2026-2035",
        comparable_to_live_annual_result: false,
      },
    ],
  },
  {
    id: "kypa_childless_eitc_2026",
    title: "Keep Your Pay Act childless-worker EITC",
    policy_area: "Earned Income Tax Credit",
    benchmark_period: "2026 annual",
    comparison_status: "live_model_with_third_party_score",
    budget_effect_rule: "credit_delta_is_cost",
    notes:
      "PWBM provides a separable childless-worker EITC estimate. The live comparison applies the same 2026 parameters described by PWBM and compares to the FY2027 line as a full-year fiscal proxy: minimum age 19, no maximum age, 15.3% phase-in and phase-out rates, about a $1,502 maximum credit, and about an $11,610 phase-out start.",
    external_estimates: [
      {
        source: "Penn Wharton Budget Model",
        source_type: "pwbm",
        url: "https://budgetmodel.wharton.upenn.edu/p/2026-03-11-the-keep-your-pay-act-budgetary-and-distributional-effects/",
        estimate: 7_200_000_000,
        estimate_label:
          "$7.2B FY2027 revenue loss for KYPA's childless-worker EITC expansion. This is the closest full-year fiscal proxy for a calendar-year 2026 microsim.",
        period: "FY2027 proxy for TY2026",
        comparable_to_live_annual_result: true,
      },
      {
        source: "Penn Wharton Budget Model",
        source_type: "pwbm",
        url: "https://budgetmodel.wharton.upenn.edu/p/2026-03-11-the-keep-your-pay-act-budgetary-and-distributional-effects/",
        estimate: 800_000_000,
        estimate_label:
          "$0.8B FY2026 revenue loss. Included as timing context; not comparable to a full calendar-year 2026 tax microsim.",
        period: "FY2026 timing context",
        comparable_to_live_annual_result: false,
      },
      {
        source: "Penn Wharton Budget Model",
        source_type: "pwbm",
        url: "https://budgetmodel.wharton.upenn.edu/p/2026-03-11-the-keep-your-pay-act-budgetary-and-distributional-effects/",
        estimate: 63_800_000_000,
        estimate_label:
          "$63.8B FY2026-2035 revenue loss for KYPA's childless-worker EITC expansion.",
        period: "FY2026-2035",
        comparable_to_live_annual_result: false,
      },
    ],
  },
  {
    id: "tcja_extension_2026_2035",
    title: "TCJA individual provisions extension",
    policy_area: "Federal individual income tax",
    benchmark_period: "2026-2035",
    comparison_status: "external_score_available_reform_not_wired",
    budget_effect_rule: "full_budget_score",
    notes:
      "External benchmark is strong, but a matching live TCJA-extension reform preset is not wired yet.",
    external_estimates: [
      {
        source: "CBO/JCT",
        source_type: "cbo_jct",
        url: "https://www.policyengine.org/us/research/tcja-extension",
        estimate: 3_877_600_000_000,
        estimate_label: "$3.8776T cost over 2026-2035",
        period: "2026-2035",
      },
      {
        source: "CRFB",
        source_type: "third_party_score",
        url: "https://www.policyengine.org/us/research/tcja-extension",
        estimate: 3_830_000_000_000,
        estimate_label: "$3.83T cost over 2026-2035",
        period: "2026-2035",
      },
      {
        source: "PolicyEngine dynamic",
        source_type: "published_model_result",
        url: "https://www.policyengine.org/us/research/tcja-extension",
        estimate: 3_885_500_000_000,
        estimate_label: "$3.8855T cost over 2026-2035",
        period: "2026-2035",
      },
    ],
  },
  {
    id: "final_2025_reconciliation_tax",
    title: "Final 2025 reconciliation individual income tax provisions",
    policy_area: "Federal individual income tax",
    benchmark_period: "2026-2035",
    comparison_status: "external_score_available_reform_not_wired",
    budget_effect_rule: "full_budget_score",
    notes:
      "PolicyEngine-US baseline now contains many OBBBA provisions, so live comparison needs an explicit counterfactual reform branch.",
    external_estimates: [
      {
        source: "PolicyEngine static analysis",
        source_type: "published_model_result",
        url: "https://www.policyengine.org/us/research/final-2025-reconciliation-tax",
        estimate: 3_785_000_000_000,
        estimate_label: "$3.785T cost over 2026-2035",
        period: "2026-2035",
      },
      {
        source: "JCT JCX-26-25",
        source_type: "jct",
        url: "https://www.jct.gov/publications/2025/jcx-26-25/",
        estimate: null,
        estimate_label:
          "Official JCT revenue estimate available; row-level match not wired.",
        period: "2025 budget reconciliation",
      },
    ],
  },
];

export const revalidate = 300;

function liveUnavailable() {
  return {
    available: false,
    reason:
      "The deployed static fallback cannot run PolicyEngine microsims. Set NEXT_PUBLIC_API_URL to a Python backend for live us-data and Microplex values.",
    reform: null,
    period: null,
    outcome_variable: null,
    outcome_entity: null,
    unit: null,
    us_data: null,
    microplex: null,
    microplex_budget_effect_as_share_of_us_data: null,
    budget_effect_gap: null,
  };
}

export async function GET() {
  return NextResponse.json({
    available: true,
    runtime_seconds: 0,
    generated_at_unix: Date.now() / 1000,
    sign_convention:
      "Positive budget effect means higher federal cost or lower federal revenue. For current live CTC/EITC rows, this equals the aggregate credit increase.",
    comparison_caveat:
      "This is the deployed static fallback. External benchmark rows are visible, but live us-data and Microplex microsim values require the Python backend.",
    us_data_dataset: "not connected",
    microplex_bundle: {
      available: false,
      artifact_id: null,
      artifact_dir: null,
      policyengine_dataset_path: null,
    },
    rows: ROWS.map((row) => ({ ...row, live: liveUnavailable() })),
    errors: [],
  });
}
