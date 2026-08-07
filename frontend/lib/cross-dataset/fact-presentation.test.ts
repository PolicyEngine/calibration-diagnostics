import { expect, test } from "bun:test";

import type {
  CrossDatasetFact,
  SourceSummary,
} from "./artifact";
import {
  buildFactDetailView,
  buildFactRowView,
  factCatalogHref,
  factDetailHref,
  parseFactCatalogParams,
} from "./fact-presentation";

const sources: SourceSummary[] = [
  {
    source_id: "populace",
    label: "Populace + PolicyEngine-US",
    source_type: "model_dataset_pair",
    capability_count: 2,
    result_count: 1,
    score: { covered: 1, scored: 1, display_score: "95", loss: "0.1" },
    capability_statuses: { evaluable_projected: 1, unsupported_concept: 1 },
    reason_codes: { mapping_not_found: 1 },
    period_treatments: { aligned_fact: 1, unsupported: 1 },
    dataset_version: "populace-2024",
    model_version: "policyengine-us==1.0",
  },
  {
    source_id: "cps",
    label: "Tax-Calculator + public CPS",
    source_type: "model_dataset_pair",
    capability_count: 2,
    result_count: 0,
    score: { covered: 0, scored: 0, display_score: null, loss: null },
    capability_statuses: { unsupported_geography: 2 },
    reason_codes: { geography_not_supported: 2 },
    period_treatments: { unsupported: 2 },
  },
];

const fact: CrossDatasetFact = {
  fact_key: "irs-soi-dividends-2023",
  label: "Ordinary dividends",
  ledger_source: "irs_soi",
  measure: "irs_soi.ordinary_dividends",
  unit: "usd",
  observed_period: "tax_year:2023",
  observed_value: "1000000000",
  geography_level: "country",
  geography_id: "0100000US",
  entity: "tax_unit",
  dimensions: { filing_status: "all" },
  universe_constraints: [{ domain: "returns_with_dividends" }],
  provenance: {
    source_record_id: "soi-2023-1.4",
    source_table: "SOI table 1.4",
    url: "https://example.test/soi",
    source_sha256: "a".repeat(64),
  },
  sources: {
    populace: {
      status: "evaluable_projected",
      execution_method: "model",
      mapping_id: "populace-ordinary-dividends",
      mapping_quality: "exact",
      period_treatment: "aligned_fact",
      calibration_exposure: "direct_calibration_target",
      score_eligible: true,
      population_period: "calendar_year:2024",
      policy_period: "tax_year:2024",
      required_variables: ["ordinary_dividends", "household_weight"],
      estimate: "1080000000",
      benchmark_value: "1050000000",
      benchmark_period: "tax_year:2024",
      benchmark_basis: "aligned_fact",
      absolute_relative_error: "0.0285714286",
      alignment: {
        source_period: "tax_year:2023",
        target_period: "tax_year:2024",
        factor: "1.05",
        method: "populace_target_uprating",
      },
      dataset_version: "populace-2024",
      model_version: "policyengine-us==1.0",
    },
    cps: {
      status: "unsupported_geography",
      reason_code: "geography_not_supported",
      reason_detail: "Only national facts can be evaluated.",
      execution_method: "none",
      mapping_quality: "none",
      period_treatment: "unsupported",
      calibration_exposure: "unknown_exposure",
      score_eligible: false,
    },
  },
};

test("catalog query parser accepts supported filters and normalizes unsafe pagination", () => {
  const parsed = parseFactCatalogParams(
    new URLSearchParams(
      "view=facts&source=populace&ledger_source=irs_soi&period=tax_year%3A2023" +
        "&period_treatment=aligned_fact&calibration_exposure=direct_calibration_target" +
        "&status=evaluable_projected&search=dividend&page=-2&page_size=999&sort=error_desc",
    ),
  );
  expect(parsed).toEqual({
    source: "populace",
    status: "evaluable_projected",
    ledgerSource: "irs_soi",
    measure: "",
    period: "tax_year:2023",
    geography: "",
    periodTreatment: "aligned_fact",
    calibrationExposure: "direct_calibration_target",
    search: "dividend",
    page: 1,
    pageSize: 100,
    sort: "error_desc",
  });
});

test("catalog and detail URLs preserve stable filters and encode fact keys", () => {
  const current = parseFactCatalogParams(
    new URLSearchParams("source=cps&ledger_source=irs_soi&search=income&page=3"),
  );
  expect(factCatalogHref(current, { page: 4 })).toBe(
    "/populace/datasets?view=facts&source=cps&ledger_source=irs_soi&search=income&page=4",
  );
  expect(factCatalogHref(current, { search: "", page: 1 })).toBe(
    "/populace/datasets?view=facts&source=cps&ledger_source=irs_soi",
  );
  expect(factDetailHref("irs/soi fact", current)).toBe(
    "/populace/datasets?view=fact&fact_key=irs%2Fsoi+fact&source=cps&ledger_source=irs_soi&search=income&page=3",
  );
});

test("fact rows show sparse supported and unsupported cells accessibly", () => {
  const row = buildFactRowView(fact, sources);
  expect(row.observedValue).toBe("$1.00B");
  expect(row.observedPeriod).toBe("Tax year 2023");
  expect(row.detailHref).toBe(
    "/populace/datasets?view=fact&fact_key=irs-soi-dividends-2023",
  );
  expect(row.sourceCells.populace).toMatchObject({
    statusLabel: "Evaluable · projected",
    estimateLabel: "$1.08B",
    errorLabel: "2.9% error",
    ariaLabel:
      "Populace + PolicyEngine-US: Evaluable, projected; estimate $1.08B; 2.9% error",
  });
  expect(row.sourceCells.cps).toMatchObject({
    statusLabel: "Unsupported · geography",
    estimateLabel: "Not evaluated",
    reasonLabel: "Geography not supported",
    ariaLabel:
      "Tax-Calculator + public CPS: Unsupported, geography; Geography not supported",
  });
});

test("fact detail separates original observation, aligned benchmark, and estimate", () => {
  const detail = buildFactDetailView(fact, sources);
  expect(detail.observation).toMatchObject({
    valueLabel: "$1.00B",
    periodLabel: "Tax year 2023",
    sourceLabel: "Irs Soi",
    geographyLabel: "Country · 0100000US",
  });
  expect(detail.provenance).toContainEqual({
    label: "Source record",
    value: "soi-2023-1.4",
  });
  expect(detail.sourceCells.populace).toMatchObject({
    estimateLabel: "$1.08B",
    benchmarkLabel: "$1.05B",
    benchmarkPeriodLabel: "Tax year 2024",
    benchmarkBasisLabel: "Aligned fact",
    mappingLabel: "populace-ordinary-dividends",
    executionLabel: "Model · exact",
    populationPeriodLabel: "Calendar year 2024",
    policyPeriodLabel: "Tax year 2024",
    calibrationExposureLabel: "Direct calibration target (in-sample)",
  });
  expect(detail.sourceCells.populace.alignment).toContainEqual({
    label: "Method",
    value: "populace_target_uprating",
  });
  expect(detail.sourceCells.cps).toMatchObject({
    benchmarkLabel: "Not available",
    mappingLabel: "Not mapped",
    reasonLabel: "Only national facts can be evaluated.",
  });
});
