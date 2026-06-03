import { NextResponse } from "next/server";

const AVAILABLE_REFORMS = [
  {
    id: "american_family_act_2025",
    label: "American Family Act 2025 CTC expansion",
    description:
      "CTC expansion preset used for local us-data versus Microplex microsim checks.",
    variable: "ctc",
    entity: "tax_unit",
    period: 2026,
    unit: "USD",
    source_url: "https://www.congress.gov/bill/119th-congress/house-bill/2763",
  },
  {
    id: "working_parents_tax_relief_act_2026",
    label: "Working Parents Tax Relief Act EITC enhancement",
    description:
      "EITC enhancement preset used for local reform-sensitivity checks.",
    variable: "eitc",
    entity: "tax_unit",
    period: 2026,
    unit: "USD",
    source_url:
      "https://tax.thomsonreuters.com/news/bill-seeks-earned-income-tax-credit-boost-per-child-for-working-parents/",
  },
  {
    id: "halve_joint_eitc_phase_out_rate",
    label: "Halve joint-filer EITC phase-out rate",
    description:
      "Small EITC policy perturbation for comparing dataset sensitivity.",
    variable: "eitc",
    entity: "tax_unit",
    period: 2026,
    unit: "USD",
  },
];

export const revalidate = 300;

export async function GET(request: Request) {
  const url = new URL(request.url);
  const reformId =
    url.searchParams.get("reform_id") ?? AVAILABLE_REFORMS[0]?.id ?? null;
  const reform =
    AVAILABLE_REFORMS.find((item) => item.id === reformId) ??
    AVAILABLE_REFORMS[0] ??
    null;

  return NextResponse.json({
    available: false,
    reason:
      "The deployed Vercel frontend is using static public Microplex artifacts. Live us-data versus Microplex microsim comparisons require a hosted Python backend with NEXT_PUBLIC_API_URL configured, or a local dashboard opened from the local frontend.",
    runtime_seconds: 0,
    period: reform?.period ?? 2026,
    available_reforms: AVAILABLE_REFORMS,
    reform,
    microplex_bundle: {
      artifact_id: null,
      artifact_dir: null,
      policyengine_dataset_path: null,
    },
    us_data_dataset: "not connected",
    outcomes: [],
  });
}
