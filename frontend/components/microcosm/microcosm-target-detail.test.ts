import { describe, expect, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import type { MicrocosmTargetRow } from "@/lib/api/hooks/use-microcosm";
import { MicrocosmTargetDetail } from "./microcosm-target-detail";

const TARGET: MicrocosmTargetRow = {
  name: "irs_soi.taxable_interest",
  target: 100,
  initial_estimate: 90,
  final_estimate: 99,
  initial_relative_error: -0.1,
  relative_error: -0.01,
  abs_relative_error: 0.01,
  improvement: 0.09,
  error_kind: "relative",
  geography: "DC",
  period: 2024,
  source: "irs_soi",
  source_citation:
    "irs_soi | Publication 1304 Table 2.5 EITC by AGI and qualifying children | 23in25ic.xls",
  policyengine_variables: ["taxable_interest_income"],
  entity: "tax_unit",
  aggregation: "sum",
  calibration_status: "included",
};

function render(row: MicrocosmTargetRow = TARGET): string {
  return renderToStaticMarkup(
    createElement(MicrocosmTargetDetail, {
      row,
      dimensions: [],
      onClose: () => undefined,
    }),
  );
}

describe("MicrocosmTargetDetail", () => {
  test("keeps the three findings together and balances the wrapped fit-line spacing", () => {
    const markup = render();

    expect(markup).toContain("mt-4 grid md:grid-cols-2");
    expect(markup).toContain("grid grid-cols-3 divide-x");
    expect(markup).toContain("mx-2 my-6 md:my-0 md:self-center");
    expect(markup).not.toContain("sm:grid-cols-3");
  });

  test("publishes plot values and consolidated target details in the markup", () => {
    const markup = render();

    expect(markup).toContain("aria-label=\"Before calibration:");
    expect(markup).toContain("After calibration:");
    expect(markup).toContain(
      "href=\"https://chronicle.institute/sources/soi-table-2-5-eitc-agi-children-2023\"",
    );
    expect(markup).toContain("Target details");
    expect(markup).toContain("Measure, source, geography, period, and model mapping");
    for (const section of [
      "Target definition",
      "Scope",
      "Official source",
      "Model representation",
    ]) {
      expect(markup).toContain(`>${section}</h3>`);
    }
    expect(markup).toContain(
      'class="text-xs font-semibold uppercase tracking-[0.12em] text-[var(--accent-deep)]"',
    );
    expect(markup).not.toContain(">Implementation</h3>");
    expect(markup).not.toContain("PolicyEngine calculation");
    expect(markup).not.toContain("Source and calculation details");
  });

  test("renders an explicit Chronicle fallback when optional metadata is absent", () => {
    const markup = render({
      ...TARGET,
      source_citation: "ssa | SSI Monthly Statistics, December 2024, Table 1",
      policyengine_variables: [],
    });

    expect(markup).toContain("Chronicle entry</dt><dd");
    expect(markup).toContain("Not available");
  });

  test("omits the generated PolicyEngine formula summary", () => {
    const markup = render({
      ...TARGET,
      measure_mode: "sum",
    });

    expect(markup).not.toContain("sum(taxable_interest_income)");
    expect(markup).not.toContain("aggregated across calibrated weights");
    expect(markup).toContain("Model variables</dt><dd");
  });

  test("omits retired calculation and lineage content", () => {
    const markup = render({
      ...TARGET,
      measure_mode: "indicator_sum",
      source_measure_id: "returns_count",
      metadata: {
        chronicle_fact_key: "fact-key",
        chronicle_semantic_fact_key: "semantic-fact-key",
        chronicle_aggregate_fact_key: "aggregate-fact-key",
        chronicle_legacy_fact_key: "legacy-fact-key",
        chronicle_layout_measure_id: "layout-measure",
        chronicle_geography_id: "11",
        chronicle_value_operation: "sum",
      },
    });

    for (const label of [
      "Operation",
      "Aggregation",
      "Measure concept",
      "Source concept",
      "Geography ID",
      "Source measure ID",
      "Layout measure",
      "Semantic fact key",
      "Aggregate fact key",
      "Legacy fact key",
      "Fact key",
    ]) {
      expect(markup).not.toContain(`>${label}</dt>`);
    }
    expect(markup).not.toContain("Technical identifiers and lineage");
  });
});
