import { describe, expect, test } from "bun:test";

import {
  createExplorerState,
  selectExplorerNode,
  type ExplorerNodeSelection,
} from "./calibration-explorer";
import { buildCalibrationTree, type CalibrationTreeResponse } from "./calibration-tree";
import {
  buildCalibration,
  latestMicrocosmCalibrationSummary,
  latestMicrocosmTargetDiagnosticsPage,
} from "./latest-artifact";
import { schema9Diagnostics } from "./test-support/schema-9-diagnostics";

// The ED Federal Student Aid family that PolicyEngine/microcosm#1357 adds to
// a US release, written as schema 8 rows in the shape of the US rows in
// schema-9-diagnostics.test.ts. Its provider and category labels are the ones
// #1357 registers. Each target is one state, with either an age band or a
// debt-size band as its one dimension. Chronicle supplies the dimension IDs
// and value labels, so the ones here are illustrative.
type JsonObject = Record<string, unknown>;

const RELEASE_ID = "populace-us-2024-ed-fsa-family-test";
const PROVIDER = { id: "ed_fsa", label: "ED · Federal Student Aid" };
const CATEGORIES = [
  { id: "ed_fsa.federal_student_loan_balance", label: "Federal student loan balance" },
  { id: "ed_fsa.federal_student_loan_borrowers", label: "Federal student loan borrowers" },
  { id: "ed_fsa.parent_plus_loan_balance", label: "Parent PLUS loan balance" },
  {
    id: "ed_fsa.loan_balance_excluding_parent_plus",
    label: "Federal student loan balance excluding Parent PLUS",
  },
];
const STATES = [
  { id: "0400000US06", label: "California", code: "ca" },
  { id: "0400000US48", label: "Texas", code: "tx" },
];
const AGE_BAND = {
  id: "ed_fsa.borrower_age_band",
  label: "Age band",
  name: "age",
  values: [
    { id: "24_and_younger", label: "24 and younger" },
    { id: "25_to_34", label: "25 to 34" },
    { id: "35_to_49", label: "35 to 49" },
    { id: "50_to_61", label: "50 to 61" },
    { id: "62_and_older", label: "62 and older" },
  ],
};
const DEBT_SIZE_BAND = {
  id: "ed_fsa.debt_size_band",
  label: "Debt size band",
  name: "debt_size",
  values: [
    { id: "under_5k", label: "Less than $5,000" },
    { id: "5k_to_10k", label: "$5,000 to $10,000" },
    { id: "10k_to_20k", label: "$10,000 to $20,000" },
    { id: "20k_to_40k", label: "$20,000 to $40,000" },
    { id: "40k_to_60k", label: "$40,000 to $60,000" },
    { id: "60k_to_80k", label: "$60,000 to $80,000" },
    { id: "80k_to_100k", label: "$80,000 to $100,000" },
    { id: "100k_to_200k", label: "$100,000 to $200,000" },
    { id: "200k_plus", label: "$200,000 or more" },
  ],
};
const BANDS = [AGE_BAND, DEBT_SIZE_BAND];
// 2 states x (5 age bands + 9 debt-size bands).
const TARGETS_PER_CATEGORY = 28;
// Texas's nine debt-size targets miss by 15%; every other target fits within 2%.
const WITHIN_10PCT_PER_CATEGORY = 19;

function targetName(
  category: (typeof CATEGORIES)[number],
  state: (typeof STATES)[number],
  band: (typeof BANDS)[number],
  valueId: string,
): string {
  const statistic = category.id.slice(`${PROVIDER.id}.`.length);
  return `${PROVIDER.id}.fy2024.${statistic}.${state.code}.${band.name}.${valueId}`;
}

function edFsaRows(): JsonObject[] {
  const rows: JsonObject[] = [];
  CATEGORIES.forEach((category, categoryIndex) => {
    STATES.forEach((state) => {
      BANDS.forEach((band) => {
        band.values.forEach((value, valueIndex) => {
          const name = targetName(category, state, band, value.id);
          const target = 1_000_000 * (categoryIndex + 1) + 10_000 * (valueIndex + 1);
          const misses = state.code === "tx" && band === DEBT_SIZE_BAND;
          rows.push({
            name: `${name}@2024`,
            target_name: name,
            source: "ED Federal Student Aid citation",
            target,
            initial_estimate: target * 0.8,
            final_estimate: target * (misses ? 1.15 : 1.02),
            hierarchy: {
              provider: PROVIDER,
              category: { ...category, provider_id: PROVIDER.id },
              geography: { id: state.id, label: state.label, level: "state" },
              dimensions: [
                {
                  id: band.id,
                  label: band.label,
                  value_id: value.id,
                  value_label: value.label,
                },
              ],
              target: {
                id: name,
                label: `${category.label}, ${state.label}, ${value.label}`,
              },
            },
          });
        });
      });
    });
  });
  return rows;
}

// A family the dashboard already shows, in the same states, so the file spans
// providers the way a release does.
function censusRows(): JsonObject[] {
  return STATES.map((state, index) => {
    const name = `census_population.resident_population.${state.code}`;
    return {
      name: `${name}@2024`,
      target_name: name,
      source: "Census population citation",
      target: 10_000_000 * (index + 1),
      initial_estimate: 9_000_000 * (index + 1),
      final_estimate: 10_050_000 * (index + 1),
      hierarchy: {
        provider: { id: "census_population", label: "Census population" },
        category: {
          id: "census_population.resident_population",
          label: "Resident population",
          provider_id: "census_population",
        },
        geography: { id: state.id, label: state.label, level: "state" },
        dimensions: [],
        target: { id: name, label: `Resident population, ${state.label}` },
      },
    };
  });
}

function schema8(): JsonObject {
  return { schema_version: 8, targets: [...censusRows(), ...edFsaRows()] };
}

function calibrationOf(document: JsonObject) {
  return buildCalibration(document, RELEASE_ID, null, {}, {}, {}, "us");
}

function targetsPage(query: Record<string, string>) {
  const url = new URL("https://dashboard.test/api/microcosm/target-diagnostics");
  url.searchParams.set("limit", "500");
  for (const [key, value] of Object.entries(query)) url.searchParams.set(key, value);
  return latestMicrocosmTargetDiagnosticsPage(url.toString(), calibrationOf(schema8()));
}

const sorted = (values: readonly string[]) =>
  [...values].sort((left, right) => left.localeCompare(right));

function nodeLabels(response: CalibrationTreeResponse, groupId: string): string[] {
  return sorted(
    response.groups.find((group) => group.id === groupId)?.nodes.map((node) => node.label) ?? [],
  );
}

function selection(
  response: CalibrationTreeResponse,
  label: string,
): ExplorerNodeSelection {
  const node = response.groups.flatMap((group) => group.nodes).find((candidate) =>
    candidate.label === label
  );
  if (!node) throw new Error(`No node is labelled ${label}.`);
  return node.selection;
}

describe("the ED Federal Student Aid target family", () => {
  test("reads from its schema 8 hierarchy, and from schema 9 the same way", () => {
    const calibration = calibrationOf(schema8());

    expect(calibration.target_schema).toEqual({
      diagnostics_schema_version: 8,
      structured_dimensions: false,
      target_representation: "hierarchy",
    });
    expect(calibration.diagnostics_status).toBe("ok");
    expect(calibration.hierarchy_label_variants).toEqual([]);
    expect(calibration.rows).toHaveLength(STATES.length + CATEGORIES.length * TARGETS_PER_CATEGORY);
    expect(calibration.included_target_count).toBe(calibration.rows.length);

    const row = calibration.rows.find((candidate) =>
      candidate.target_name === targetName(CATEGORIES[0], STATES[1], DEBT_SIZE_BAND, "under_5k")
    )!;
    expect({
      source: row.source,
      source_label: row.source_label,
      variable: row.variable,
      variable_label: row.variable_label,
      geography: row.geography,
      geography_id: row.geography_id,
      level: row.level,
      breakdown: row.breakdown,
      target_label: row.target_label,
      calibration_status: row.calibration_status,
    }).toEqual({
      source: "ed_fsa",
      source_label: "ED · Federal Student Aid",
      variable: "ed_fsa.federal_student_loan_balance",
      variable_label: "Federal student loan balance",
      geography: "Texas",
      geography_id: "0400000US48",
      level: "state",
      breakdown: "Less than $5,000",
      target_label: "Federal student loan balance, Texas, Less than $5,000",
      calibration_status: "included",
    });

    const fromSchema9 = calibrationOf(schema9Diagnostics(schema8()));
    expect(fromSchema9.target_schema.diagnostics_schema_version).toBe(9);
    expect(fromSchema9.rows).toEqual(calibration.rows);
  });

  test("the release summary counts each category's targets and fit", () => {
    const summary = latestMicrocosmCalibrationSummary(calibrationOf(schema8()));

    expect(summary.total_targets).toBe(STATES.length + CATEGORIES.length * TARGETS_PER_CATEGORY);
    expect(
      Object.fromEntries(
        summary.family_fit
          .filter((family) => family.family.startsWith(`${PROVIDER.id}/`))
          .map((family) => [family.family, [family.n_targets, family.within_10pct]]),
      ),
    ).toEqual(
      Object.fromEntries(
        CATEGORIES.map((category) => [
          `${PROVIDER.id}/${category.id}`,
          [TARGETS_PER_CATEGORY, WITHIN_10PCT_PER_CATEGORY],
        ]),
      ),
    );
  });

  test("the targets page lists its statistics under its provider, by state", () => {
    const page = targetsPage({});

    expect(page.sources).toEqual(["census_population", "ed_fsa"]);
    expect(page.levels).toEqual(["state"]);
    expect(page.geographies).toEqual(["California", "Texas"]);
    expect(
      page.variables
        .filter((variable) => variable.source === PROVIDER.id)
        .map((variable) => ({
          variable_key: variable.variable_key,
          source_label: variable.source_label,
          variable_label: variable.variable_label,
          level: variable.level,
          n_targets: variable.n_targets,
          within_10pct: variable.within_10pct,
        })),
    ).toEqual(
      CATEGORIES.map((category) => ({
        variable_key: `${PROVIDER.id} / ${category.id}`,
        source_label: PROVIDER.label,
        variable_label: category.label,
        level: "state",
        n_targets: TARGETS_PER_CATEGORY,
        within_10pct: WITHIN_10PCT_PER_CATEGORY,
      })),
    );
    expect(targetsPage({ source: PROVIDER.id }).filtered_total).toBe(
      CATEGORIES.length * TARGETS_PER_CATEGORY,
    );
  });

  test("a statistic's facets are its states and both band dimensions", () => {
    const variable = `${PROVIDER.id} / ${CATEGORIES[0].id}`;
    const page = targetsPage({ variable });

    expect(page.filtered_total).toBe(TARGETS_PER_CATEGORY);
    // Membership only: the order of facet values is not part of this test.
    expect(
      page.dimensions.map((dimension) => ({ ...dimension, values: sorted(dimension.values) })),
    ).toEqual([
      { key: "geography", label: "Geography", values: ["California", "Texas"] },
      ...BANDS.map((band) => ({
        key: band.id,
        label: band.label,
        values: sorted(band.values.map((value) => value.label)),
      })),
    ]);

    const url = new URL("https://dashboard.test/api/microcosm/target-diagnostics");
    url.searchParams.set("variable", variable);
    url.searchParams.set("geography", "Texas");
    url.searchParams.append("facet", `${DEBT_SIZE_BAND.id}:Less than $5,000`);
    const facet = latestMicrocosmTargetDiagnosticsPage(url.toString(), calibrationOf(schema8()));
    expect(facet.targets.map((target) => target.name)).toEqual([
      `${targetName(CATEGORIES[0], STATES[1], DEBT_SIZE_BAND, "under_5k")}@2024`,
    ]);
  });

  test("the calibration map nests provider, category, state and band", () => {
    const rows = calibrationOf(schema8()).rows;
    const tree = (state: ReturnType<typeof createExplorerState>) =>
      buildCalibrationTree(rows, state, RELEASE_ID);

    const root = createExplorerState();
    const programs = tree(root);
    expect(programs.groups.find((group) => group.id === PROVIDER.id)?.label).toBe(PROVIDER.label);
    expect(nodeLabels(programs, PROVIDER.id)).toEqual(
      sorted(CATEGORIES.map((category) => category.label)),
    );

    const balance = selectExplorerNode(root, selection(programs, CATEGORIES[0].label));
    const states = tree(balance);
    expect(states.pathLabels).toEqual({ source: PROVIDER.label, program: CATEGORIES[0].label });
    expect(nodeLabels(states, CATEGORIES[0].id)).toEqual(["California", "Texas"]);

    const texas = selectExplorerNode(balance, selection(states, "Texas"));
    const bands = tree(texas);
    expect(bands.groups.map((group) => [group.id, group.label])).toEqual(
      BANDS.map((band) => [band.id, band.label]),
    );
    for (const band of BANDS) {
      expect(nodeLabels(bands, band.id)).toEqual(sorted(band.values.map((value) => value.label)));
    }

    const smallest = selectExplorerNode(texas, selection(bands, "Less than $5,000"));
    const targets = tree(smallest);
    expect(targets.pathLabels.dimensions).toEqual(["Less than $5,000"]);
    expect(targets.groups.flatMap((group) => group.nodes.map((node) => node.label))).toEqual([
      "Federal student loan balance, Texas, Less than $5,000",
    ]);
  });
});
