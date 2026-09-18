import { describe, expect, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import type { MicrocosmTargetRow } from "@/lib/api/hooks/use-microcosm";
import {
  MicrocosmTargetDetail,
  type MicrocosmTargetDetailProps,
} from "./microcosm-target-detail";

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

function render(
  row: MicrocosmTargetRow = TARGET,
  presentation: Partial<
    Pick<
      MicrocosmTargetDetailProps,
      | "eyebrow"
      | "fitHeading"
      | "fitDescription"
      | "metrics"
      | "afterCalibrationSeries"
      | "fitSummary"
    >
  > = {},
): string {
  return renderToStaticMarkup(
    createElement(MicrocosmTargetDetail, {
      row,
      dimensions: [],
      onClose: () => undefined,
      ...presentation,
    }),
  );
}

describe("MicrocosmTargetDetail", () => {
  test("accepts presentation labels without changing its target data contract", () => {
    const markup = render(TARGET, {
      eyebrow: "Candidate calibration target",
      fitHeading: "Candidate fit",
      fitDescription: "Candidate estimate relative to its benchmark.",
    });

    expect(markup).toContain("Candidate calibration target");
    expect(markup).toContain("Candidate fit");
    expect(markup).toContain("Candidate estimate relative to its benchmark.");
    expect(markup).toContain("99");
  });

  test("keeps the three findings together and balances the wrapped fit-line spacing", () => {
    const markup = render();

    expect(markup).toContain("mt-4 grid md:grid-cols-2");
    expect(markup).toContain('data-metric-count="3"');
    expect(markup).toContain("mx-2 my-6 md:my-0 md:self-center");
    expect(markup).not.toContain("sm:grid-cols-3");
    expect(markup).not.toContain("data-align-to-metric-midline");
  });

  test("shows the official target before the final estimate and omits the hover instruction", () => {
    const markup = render();

    expect(markup.indexOf("Official target")).toBeLessThan(markup.indexOf("Final estimate"));
    expect(markup).not.toContain("Hover for values");
  });

  test("accepts a six-metric staging layout, staging summary, and distinct blue candidate series", () => {
    const labels = [
      "Official target",
      "Current release estimate",
      "Candidate estimate",
      "Current release error",
      "Candidate release error",
      "Weighted target error change",
    ];
    const markup = render(TARGET, {
      metrics: labels.map((label, index) => ({ label, value: String(index + 1) })),
      afterCalibrationSeries: [
        {
          label: "Current release after calibration",
          shortLabel: "Current release",
          value: -0.02,
          tone: "primary",
        },
        {
          label: "Candidate after calibration",
          shortLabel: "Candidate",
          value: -0.01,
          tone: "secondary",
        },
      ],
      fitSummary: {
        text: "Candidate dataset decreased absolute error by 1.00 percentage points relative to the current release dataset.",
        tone: "positive",
      },
    });

    expect(markup).toContain('data-metric-count="6"');
    for (let index = 1; index < labels.length; index += 1) {
      expect(markup.indexOf(labels[index - 1])).toBeLessThan(markup.indexOf(labels[index]));
    }
    expect(markup).toContain("Current release after calibration");
    expect(markup).toContain("Candidate after calibration");
    expect(markup).toContain("bg-blue-500");
    expect(markup).not.toContain("bg-[var(--chart-3)]");
    expect(markup).not.toContain("swatch-info");
    expect(markup).not.toContain("data-chart-outcome-background");
    expect(markup).toContain(
      "Candidate dataset decreased absolute error by 1.00 percentage points relative to the current release dataset.",
    );
    expect(markup).not.toContain("Calibration reduced the absolute error");
    expect(markup).toContain("flex h-full min-w-0 flex-col");
    expect(markup).toContain("mt-auto pt-2");
    expect(markup).toContain('data-align-to-metric-midline="true"');
    expect(markup).toContain("md:top-1/2 md:-translate-y-1/2");
  });

  test("publishes plot values and consolidated target details in the markup", () => {
    const markup = render();

    expect(markup).toContain("aria-label=\"Before calibration:");
    expect(markup).toContain("After calibration:");
    expect(markup).toContain(
      "href=\"https://chronicle.institute/sources/soi-table-2-5-eitc-agi-children-2023\"",
    );
    expect(markup).toContain("Target details");
    expect(markup).toContain("Measure, source, geography, and period");
    for (const section of [
      "Target definition",
      "Scope",
      "Official source",
    ]) {
      expect(markup).toContain(`>${section}</h3>`);
    }
    expect(markup).toContain(
      'class="text-xs font-semibold uppercase tracking-[0.12em] text-primary"',
    );
    expect(markup).not.toContain(">Implementation</h3>");
    expect(markup).not.toContain(">Model representation</h3>");
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

  test("prefers artifact labels and direct source URLs", () => {
    const markup = render({
      ...TARGET,
      source: "novastat_agency",
      source_label: "Nova Statistics Agency",
      source_url: "https://stats.example/zz/pop",
      variable: "population",
      variable_label: "Resident population",
    });

    expect(markup).toContain(">Resident population</h2>");
    expect(markup).toContain("Nova Statistics Agency");
    expect(markup).toContain("Source link</dt><dd");
    expect(markup).toContain('href="https://stats.example/zz/pop"');
    expect(markup).toContain("View official source");
  });

  test("renders the geography level in sentence case", () => {
    const markup = render({
      ...TARGET,
      level: "congressional_district",
      chronicle: { geography_level: "congressional_district" },
    });

    expect(markup).toContain(
      'Geography level</dt><dd class="mt-0.5 break-words text-sm text-foreground">Congressional district</dd>',
    );
  });

  test("omits the generated PolicyEngine formula summary", () => {
    const markup = render({
      ...TARGET,
      measure_mode: "sum",
    });

    expect(markup).not.toContain("sum(taxable_interest_income)");
    expect(markup).not.toContain("aggregated across calibrated weights");
    expect(markup).not.toContain("Model variables</dt><dd");
    expect(markup).toContain("Entity</dt><dd");
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
