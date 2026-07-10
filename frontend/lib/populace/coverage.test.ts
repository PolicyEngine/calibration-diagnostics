import { expect, test } from "bun:test";

import {
  buildInputColumnCoverage,
  buildReformSmoke,
  buildSourceCoverage,
} from "./coverage";

// A trimmed slice of a real releases/<id>/us_source_coverage.json (the buildi
// release) so the parser is pinned to the shape actually on Hugging Face.
const SOURCE_FIXTURE = {
  schema_version: 1,
  classification: "release_gate",
  source_contract: { name: "us_source_coverage", ledger_commit: "e2fc882c35f9203c" },
  gate: { name: "us_source_coverage", passed: true, failures: [] },
  coverage_summary: {
    hard_target: {
      families: 2,
      package_aliases: 6,
      covered_package_aliases: 3,
      missing_package_aliases: 0,
      reviewed_excluded_package_aliases: 3,
    },
    validation_only: { families: 1, activated_families: 0 },
    source_gap: { families: 1, missing_source_packages: 2 },
  },
  hard_target_families: {
    population_age_sex: {
      label: "Population by age and sex",
      package_aliases: ["census-pep-national", "census-acs-national", "census-acs-cd"],
      covered_package_aliases: ["census-pep-national"],
      missing_package_aliases: [],
      reviewed_exclusions: {
        "census-acs-national":
          "Reviewed fiscal-refresh exclusion: recalibrates the Issue #40 fiscal surface only.",
        "census-acs-cd":
          "Reviewed fiscal-refresh exclusion: recalibrates the Issue #40 fiscal surface only.",
      },
    },
    irs_soi: {
      label: "SOI filer income",
      package_aliases: ["soi-1-1", "soi-1-2", "soi-2-1"],
      covered_package_aliases: ["soi-1-1", "soi-1-2"],
      missing_package_aliases: [],
      reviewed_exclusions: {
        "soi-2-1": "Reviewed fiscal-refresh exclusion tracked in populace#359.",
      },
    },
  },
  validation_only_families: {
    snap_local_proxy: {
      label: "SNAP CD proxy",
      package_aliases: ["census-acs-snap-cd"],
      activated_as_hard_target: false,
    },
  },
  source_gap_families: {
    hud_assisted_housing: {
      label: "Housing assistance controls",
      missing_source_packages: ["HUD Picture of Subsidized Households", "HUD unit-count tables"],
    },
  },
  reviewed_exclusions: {
    "census-acs-national": "Reviewed fiscal-refresh exclusion: Issue #40.",
  },
  fiscal_target_support_exclusions: [
    {
      source_record_id: "census_stc.fy2024.individual_income_tax.tn",
      reason: "Tennessee has no modeled 2024 state income tax; cannot estimate. See #359.",
    },
  ],
};

test("buildSourceCoverage parses families, exclusions, and their issues", () => {
  const cov = buildSourceCoverage(SOURCE_FIXTURE, "rel-1", "us");
  expect(cov.available).toBe(true);
  expect(cov.summary.hard_target_families).toBe(2);
  expect(cov.summary.covered_aliases).toBe(3);
  expect(cov.summary.reviewed_excluded_aliases).toBe(3);

  const pop = cov.hard_target_families.find((f) => f.key === "population_age_sex")!;
  expect(pop.required).toHaveLength(3);
  expect(pop.covered).toEqual(["census-pep-national"]);
  // Covered one alias + reviewed-excluded the rest, none missing → "partial".
  expect(pop.state).toBe("partial");
  expect(pop.reviewed_exclusions).toHaveLength(2);
  // Every reviewed exclusion carries its tracking issue (#40).
  expect(pop.reviewed_exclusions[0].issues[0].number).toBe(40);
});

test("a family with a missing required alias is state=missing", () => {
  const withMissing = {
    ...SOURCE_FIXTURE,
    hard_target_families: {
      broken: {
        label: "Broken",
        package_aliases: ["a", "b"],
        covered_package_aliases: ["a"],
        missing_package_aliases: ["b"],
        reviewed_exclusions: {},
      },
    },
  };
  const cov = buildSourceCoverage(withMissing, "rel-1", "us");
  expect(cov.hard_target_families[0].state).toBe("missing");
});

test("fiscal-support exclusions parse their record id, reason, and issue", () => {
  const cov = buildSourceCoverage(SOURCE_FIXTURE, "rel-1", "us");
  expect(cov.fiscal_support_exclusions).toHaveLength(1);
  const first = cov.fiscal_support_exclusions[0];
  expect(first.subject).toContain("census_stc");
  expect(first.issues[0].number).toBe(359);
});

test("the source-coverage artifact path is bound to the release id", () => {
  const cov = buildSourceCoverage(SOURCE_FIXTURE, "rel-xyz", "us");
  expect(cov.artifact.path).toBe("releases/rel-xyz/us_source_coverage.json");
});

test("buildReformSmoke derives 'scores $0' from a zero scored value", () => {
  const smoke = buildReformSmoke(
    {
      enforced: true,
      gate: { passed: false, failures: ["ssi_asset_limits scored $0"] },
      probes: [
        { name: "SSI asset limits $10k/$20k", reform: "ssi_asset_limits", scored_value: 0, issue: "populace#368" },
        { name: "EITC repeal", reform: "eitc_repeal", scored_value: 71_000_000_000 },
      ],
    },
    "rel-1",
    "us",
  );
  expect(smoke.summary.probes).toBe(2);
  expect(smoke.summary.zero).toBe(1);
  expect(smoke.summary.scored).toBe(1);
  const ssi = smoke.probes.find((p) => p.reform === "ssi_asset_limits")!;
  expect(ssi.verdict).toBe("zero");
  expect(ssi.issues[0].number).toBe(368);
  expect(smoke.enforced).toBe(true);
});

test("buildReformSmoke honours an explicit passed flag and a 'reforms' array", () => {
  const smoke = buildReformSmoke(
    { reforms: [{ name: "probe", passed: true }] },
    "rel-1",
    "us",
  );
  expect(smoke.probes[0].verdict).toBe("scored");
});

test("buildInputColumnCoverage flags absent and degenerate required columns", () => {
  const cov = buildInputColumnCoverage(
    {
      enforced: true,
      required: [
        { column: "bank_account_assets", present: false },
        { column: "employment_income", present: true, degenerate: false },
        { column: "stock_assets", present: true, degenerate: true },
      ],
      reviewed_exclusions: [
        { column: "s_corp_income", reason: "Carried in partnership_income, see #359." },
      ],
    },
    "rel-1",
    "us",
  );
  expect(cov.summary.required).toBe(3);
  expect(cov.summary.reviewed_exclusion).toBe(1);
  // absent + degenerate both count as failing.
  expect(cov.summary.failing).toBe(2);
  expect(cov.reviewed_exclusions[0].issues[0].number).toBe(359);
});
