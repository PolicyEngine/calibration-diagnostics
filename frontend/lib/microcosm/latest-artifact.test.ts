import { expect, test } from "bun:test";

import beDiagnosticsFixture from "./fixtures/be-release/calibration_diagnostics.json";
import beReleaseManifestFixture from "./fixtures/be-release/release_manifest.json";

// Deprecated upstream identifiers: fixtures mirror current Microcosm release
// names and its `ledger_*` Chronicle metadata contract.

import {
  buildCalibration,
  buildComparison,
  diagnosticsDimensions,
  MICROCOSM_HF_REPO_ENV,
  MICROCOSM_HF_REVISION_ENV,
  MICROCOSM_BE_HF_REPO_ENV,
  MICROCOSM_BE_HF_REVISION_ENV,
  MICROCOSM_UK_HF_REPO_ENV,
  MICROCOSM_UK_HF_REVISION_ENV,
  hfResolveUrl,
  latestMicrocosmCalibrationHighlights,
  latestMicrocosmCalibrationSummary,
  latestMicrocosmTargetDiagnosticsPage,
  microcosmRepo,
  microcosmRevision,
  microcosmTargetTreemap,
  parseCountry,
  releaseCountry,
  releasePresentation,
  releasePublisherLabels,
  releasePublishedAtFromTree,
  releaseRole,
  type ArtifactCountry,
  type Calibration,
} from "./latest-artifact";
import { buildCalibrationTree } from "./calibration-tree";

test("keeps Microcosm deployment configuration on its published Populace env contract", () => {
  expect([
    MICROCOSM_HF_REPO_ENV,
    MICROCOSM_HF_REVISION_ENV,
    MICROCOSM_UK_HF_REPO_ENV,
    MICROCOSM_UK_HF_REVISION_ENV,
    MICROCOSM_BE_HF_REPO_ENV,
    MICROCOSM_BE_HF_REVISION_ENV,
  ]).toEqual([
    "POPULACE_HF_REPO",
    "POPULACE_HF_REVISION",
    "POPULACE_UK_HF_REPO",
    "POPULACE_UK_HF_REVISION",
    "POPULACE_BE_HF_REPO",
    "POPULACE_BE_HF_REVISION",
  ]);
});

test("coerces supported country parameters and defaults unknown values to US", () => {
  expect(parseCountry("be")).toBe("be");
  expect(parseCountry("uk")).toBe("uk");
  expect(parseCountry("us")).toBe("us");
  expect(parseCountry("BE")).toBe("us");
  expect(parseCountry("fr")).toBe("us");
  expect(parseCountry(null)).toBe("us");
});

test("accepts the conformance fixture country only as a registered code", () => {
  expect(parseCountry("zz")).toBe("zz");
  expect(parseCountry("ZZ")).toBe("us");
});

test("uses the private Belgium repository and country revision", () => {
  expect(microcosmRepo("be")).toBe("policyengine/populace-be-private");
  expect(microcosmRevision("be")).toBe("main");
  expect(hfResolveUrl("latest.json", "be")).toBe(
    "https://huggingface.co/datasets/policyengine/populace-be-private/resolve/main/latest.json",
  );
});

test("loads trimmed Belgium diagnostics without optional US artifact fields", () => {
  expect("loss_trajectory" in beDiagnosticsFixture).toBe(false);
  expect("past_cap_census" in beDiagnosticsFixture).toBe(false);
  expect(beDiagnosticsFixture.targets.every((row) => !("registry" in row))).toBe(true);
  const cal = buildCalibration(
    beDiagnosticsFixture,
    "microcosm-be-2026-chronicle-3cef97b-20260823T134247Z",
    null,
    {},
    beReleaseManifestFixture,
    {},
    "be",
  );

  expect(cal.country).toBe("be");
  expect(cal.diagnostics_status).toBe("ok");
  expect(cal.included_target_count).toBe(3);
  expect(cal.loss_trajectory).toEqual([]);
  expect(cal.description).toBe(
    "Microcosm-BE: synthetic Belgian population calibrated to Belgian administrative and national-accounts targets (sums of Chronicle facts; surveys validation-only). Support records: US survey donor pool, reweighted; a Belgian donor pool is the planned upgrade. Cross-engine agreement is evidence about the encodings.",
  );
  expect(cal.rows.every((row) => row.registry == null)).toBe(true);

  expect(cal.rows[0]).toMatchObject({
    source: "statbel",
    variable: "population",
    family: "statbel/population",
    geography: "Brussels",
    level: "region",
    dimension_adapter: "legacy_filter",
    breakdown: "Male · 0–17",
    target_dimensions: [
      expect.objectContaining({ key: "bd_sex", label: "Sex", value: "Male" }),
      expect.objectContaining({ key: "bd_age_band", label: "Age band", value: "0–17" }),
    ],
  });
  expect(cal.rows[1]).toMatchObject({
    source: "jrc",
    variable: "national income tax amount",
    geography: "Belgium",
    level: "national",
    dimension_adapter: "legacy_name",
  });
  expect(cal.rows[2]).toMatchObject({
    source: "eurostat",
    variable: "taxable movable income analogue",
    geography: "Belgium",
    level: "national",
  });
});

test("derives Belgium population region, sex, and age-band browser facets", () => {
  const first = beDiagnosticsFixture.targets[0];
  const target = (name: string) => ({
    ...first,
    name: `${name}@2026`,
    target_name: name,
    filter: `cell_${name.replace(/^statbel_population_/, "")}`,
  });
  const cal = buildCalibration(
    {
      ...beDiagnosticsFixture,
      targets: [
        target("statbel_population_be1_male_0_17"),
        target("statbel_population_be2_female_18_64"),
        target("statbel_population_be3_male_65_plus"),
      ],
    },
    "be-facets",
    null,
    {},
    beReleaseManifestFixture,
    {},
    "be",
  );
  const result = latestMicrocosmTargetDiagnosticsPage(
    "http://x/api/microcosm/target-diagnostics?variable=statbel%20%2F%20population",
    cal,
  );

  expect(result.sources).toEqual(["statbel"]);
  expect(result.dimensions).toEqual([
    { key: "geography", label: "Region", values: ["Brussels", "Flanders", "Wallonia"] },
    { key: "bd_sex", label: "Sex", values: ["Female", "Male"] },
    { key: "bd_age_band", label: "Age band", values: ["0–17", "18–64", "65+"] },
  ]);
});

test("diagnosticsDimensions drops malformed entries and normalizes optional metadata", () => {
  expect(diagnosticsDimensions({ dimensions: [] })).toEqual({});
  expect(
    diagnosticsDimensions({
      dimensions: {
        region: {
          label: "  Region  ",
          role: "geography",
          level: "  region  ",
          values: { north: "  North  ", south: " ", broken: 3 },
          order: [" south ", 3, "north", " "],
        },
        sex: { label: "Sex", role: "category", values: { female: "Female" } },
        missing_label: { values: { value: "Value" } },
        scalar: "Region",
      },
    }),
  ).toEqual({
    region: {
      label: "Region",
      role: "geography",
      level: "region",
      values: { north: "North" },
      order: ["south", "north"],
    },
    sex: { label: "Sex", values: { female: "Female" } },
  });
});

test("structured dimensions shape rows and honor artifact value order", () => {
  const target = (
    suffix: string,
    dimensions: Record<string, string>,
  ) => ({
    name: `fixture.population.${suffix}@2026`,
    target_name: `fixture.population.${suffix}`,
    source: { id: "novastat_agency", citation: "ZZ official population table" },
    variable: { id: "population", measure: "count" },
    metadata: {
      chronicle_record_ids: [`novastat_agency.population.${suffix}`],
      variable: "population",
      source_measure_id: "population_count",
    },
    dimensions,
    target: 100,
    initial_estimate: 90,
    final_estimate: 100,
  });
  const cal = buildCalibration(
    {
      schema_version: 7,
      dimensions: {
        region: {
          label: "Region",
          role: "geography",
          level: "region",
          values: { north: "North", south: "South" },
        },
        sex: {
          label: "Sex",
          values: { female: "Female", male: "Male" },
          order: ["male", "female"],
        },
        age_band: {
          label: "Age band",
          values: { "65_plus": "65+", "0_17": "0–17", "18_64": "18–64" },
        },
      },
      targets: [
        target("north_female_0_17", {
          region: "north",
          sex: "female",
          age_band: "0_17",
          settlement_type: "urban_core",
        }),
        target("south_male_65_plus", {
          region: "south",
          sex: "male",
          age_band: "65_plus",
          settlement_type: "urban_core",
        }),
        target("north_male_18_64", {
          region: "north",
          sex: "male",
          age_band: "18_64",
          settlement_type: "urban_core",
        }),
      ],
    },
    "structured-dimensions",
  );

  expect(cal.target_schema).toEqual({
    diagnostics_schema_version: 7,
    structured_dimensions: true,
    target_representation: "structured",
  });
  expect(cal.rows.every((row) => row.dimension_adapter === "structured")).toBe(true);
  expect(cal.rows.every((row) => row.target_representation === "structured")).toBe(true);
  expect(cal.rows[0]).toMatchObject({
    family: "novastat_agency/population",
    geography: "North",
    level: "region",
    breakdown: "Female · 0–17 · Urban Core",
    target_dimensions: [
      {
        key: "bd_sex",
        label: "Sex",
        value: "Female",
        source_key: "sex",
        raw_value: "female",
        rank: 1,
      },
      {
        key: "bd_age_band",
        label: "Age band",
        value: "0–17",
        source_key: "age_band",
        raw_value: "0_17",
        rank: 1,
      },
      {
        key: "bd_settlement_type",
        label: "Settlement Type",
        value: "Urban Core",
        source_key: "settlement_type",
        raw_value: "urban_core",
      },
    ],
  });
  const page = latestMicrocosmTargetDiagnosticsPage(
    "http://x/api/microcosm/target-diagnostics?variable=novastat_agency%20%2F%20population%20%C2%B7%20count",
    cal,
  );
  expect(page.target_schema).toEqual(cal.target_schema);
  expect(page.dimensions).toEqual([
    { key: "geography", label: "Region", values: ["North", "South"] },
    { key: "bd_sex", label: "Sex", values: ["Male", "Female"] },
    { key: "bd_age_band", label: "Age band", values: ["65+", "0–17", "18–64"] },
  ]);
});

test("structured facet ordering falls back when any displayed value lacks a rank", () => {
  const target = (suffix: string, category: string) => ({
    name: `fixture.population.${suffix}@2026`,
    source: { id: "novastat_agency", citation: "Citation" },
    variable: { id: "population", measure: "count" },
    metadata: {
      chronicle_record_ids: ["novastat_agency.population.total"],
      variable: "population",
      source_measure_id: "population_count",
    },
    dimensions: { category },
    target: 1,
    initial_estimate: 1,
    final_estimate: 1,
  });
  const cal = buildCalibration(
    {
      dimensions: {
        category: {
          label: "Category",
          values: { zeta: "Zeta" },
          order: ["zeta"],
        },
      },
      targets: [target("zeta", "zeta"), target("beta", "beta")],
    },
    "partial-dimension-order",
  );
  const page = latestMicrocosmTargetDiagnosticsPage(
    "http://x/api/microcosm/target-diagnostics?variable=novastat_agency%20%2F%20population%20%C2%B7%20count",
    cal,
  );

  expect(page.dimensions).toEqual([
    { key: "bd_category", label: "Category", values: ["Beta", "Zeta"] },
  ]);
});

test("mixed files select the dimension adapter from each complete row representation", () => {
  const base = {
    source: "ZZ official population table",
    metadata: {
      chronicle_record_ids: ["novastat_agency.population.total"],
      variable: "population",
      source_measure_id: "population_count",
    },
    target: 100,
    initial_estimate: 90,
    final_estimate: 100,
  };
  const cal = buildCalibration(
    {
      schema_version: 7,
      dimensions: {
        region: {
          label: "Region",
          role: "geography",
          values: { north: "North", south: "South" },
        },
        sex: { label: "Sex" },
        age_band: { label: "Age band" },
      },
      targets: [
        {
          ...base,
          name: "fixture_population_north_female_0_17@2026",
          source: { id: "novastat_agency", citation: "ZZ official population table" },
          variable: { id: "population", measure: "count" },
          filter: "cell_south_male_65_plus",
          dimensions: { region: "north", sex: "female", age_band: "0_17" },
        },
        {
          ...base,
          name: "fixture_population_south_male_18_64@2026",
          filter: "cell_south_male_18_64",
        },
        {
          ...base,
          name: "novastat_agency.population.total@2026",
          filter: null,
        },
      ],
    },
    "mixed-dimension-adapters",
  );

  expect(cal.rows.map((row) => row.dimension_adapter)).toEqual([
    "structured",
    "legacy_filter",
    "legacy_name",
  ]);
  expect(cal.rows[0]).toMatchObject({
    geography: "North",
    level: "region",
    breakdown: "Female · 0–17",
  });
  expect(latestMicrocosmCalibrationSummary(cal).target_schema).toEqual(
    cal.target_schema,
  );
});

test("structured rows do not require a dimensions dictionary, including empty objects", () => {
  const base = {
    source: { id: "novastat_agency", citation: "Citation" },
    variable: { id: "population", measure: "count" },
    metadata: { variable: "population", source_measure_id: "population_count" },
    filter: "cell_south_male_18_64",
    target: 1,
    initial_estimate: 1,
    final_estimate: 1,
  };
  const cal = buildCalibration(
    {
      targets: [
        {
          ...base,
          name: "fixture_population_age@2026",
          dimensions: { age_band: "65_plus" },
        },
        {
          ...base,
          name: "fixture_population_total@2026",
          dimensions: {},
        },
      ],
    },
    "dictionary-free-dimensions",
  );

  expect(cal.target_schema.structured_dimensions).toBe(false);
  expect(cal.rows[0]).toMatchObject({
    dimension_adapter: "structured",
    geography: "United States",
    breakdown: "65+",
    target_dimensions: [
      expect.objectContaining({
        key: "bd_age_band",
        label: "Age Band",
        value: "65+",
      }),
    ],
  });
  expect(cal.rows[1]).toMatchObject({
    dimension_adapter: "structured",
    geography: "United States",
    breakdown: "",
    target_dimensions: [],
  });
});

test("structured dimensions prevent whole-population estimate-scope warnings", () => {
  const target = (recordSet: string, category: string, targetValue: number) => ({
    name: `source.example.${category}.amount@2026`,
    source: { id: "source", citation: "Citation" },
    variable: { id: "example", measure: "amount" },
    metadata: {
      variable: "example",
      source_measure_id: "example_amount",
      ledger_layout_record_set_id: recordSet,
    },
    dimensions: { category },
    target: targetValue,
    initial_estimate: 100,
    final_estimate: 80,
  });
  const cal = buildCalibration(
    {
      dimensions: { category: { label: "Category" } },
      targets: [
        target("source.example.slice_a", "a", 10),
        target("source.example.slice_b", "b", 20),
      ],
    },
    "structured-scope",
  );

  expect(cal.rows.every((row) => row.estimate_warning == null)).toBe(true);
});

test("keeps legacy US dotted target families when Chronicle publisher metadata is present", () => {
  const cal = buildCalibration(
    {
      targets: [
        {
          name: "irs.population.total@2024",
          target_name: "irs.population.total",
          period: 2024,
          entity: "person",
          measure: { kind: "column", name: "person" },
          source: "IRS SOI",
          metadata: {
            chronicle_record_ids: ["irs.population.cy2024.total"],
            variable: "population",
          },
          target: 100,
          initial_estimate: 95,
          final_estimate: 99,
          relative_error: -0.01,
          within_tolerance: true,
        },
      ],
    },
    "us-dotted-family",
  );

  expect(cal.rows[0]).toMatchObject({
    source: "irs",
    variable: "population",
    family: "irs.population.total",
  });
});

test("live-US-shaped schema 5 rows preserve the legacy dotted contract", () => {
  const sourceCitation =
    "Bureau of Economic Analysis, National Income and Product Accounts, Table 1.12";
  const cal = buildCalibration(
    {
      schema_version: 5,
      targets: [
        {
          name: "bea_nipa.cy2023.proprietors_income.a041rc.amount@2024",
          filter: null,
          source: sourceCitation,
          metadata: {
            chronicle_record_ids: [
              "bea_nipa.cy2023.proprietors_income.a041rc.amount",
            ],
            variable: "proprietors_income",
            source_measure_id: "proprietors_income_amount",
            ledger_geography_level: "country",
            ledger_geography_id: "0100000US",
            ledger_layout_groupby_dimension: "bea_nipa.line_code",
            ledger_layout_groupby_value_id: "a041rc",
            ledger_measure_unit: "usd",
          },
          target: 100,
          initial_estimate: 90,
          final_estimate: 99,
          relative_error: -0.01,
          within_tolerance: true,
        },
      ],
    },
    "live-us-shaped",
  );
  const responseRow = latestMicrocosmTargetDiagnosticsPage(
    "http://x/api/microcosm/target-diagnostics",
    cal,
  ).targets[0];

  // JSON round-tripping matches the API boundary and locks every legacy field;
  // the additional contract fields are strictly additive.
  expect(JSON.parse(JSON.stringify(responseRow))).toEqual({
    name: "bea_nipa.cy2023.proprietors_income.a041rc.amount@2024",
    target: 100,
    initial_estimate: 90,
    final_estimate: 99,
    relative_error: -0.01,
    within_tolerance: true,
    base_name: "bea_nipa.cy2023.proprietors_income.a041rc.amount",
    family: "bea_nipa.cy2023.proprietors_income.a041rc.amount",
    state: null,
    geography: "United States",
    level: "national",
    source: "bea_nipa",
    source_label: "BEA Nipa",
    variable: "proprietors income",
    variable_label: null,
    measure: "total",
    target_role: null,
    source_measure_id: "proprietors_income_amount",
    policyengine_variables: [],
    policyengine_map_to: null,
    policyengine_filter_variable: null,
    materializer: null,
    measure_mode: null,
    error_kind: "relative",
    initial_error: -0.1,
    final_error: -0.01,
    initial_miss: -10,
    final_miss: -1,
    abs_final_miss: 1,
    absolute_improvement: 9,
    abs_error: 0.01,
    breakdown: "a041rc",
    dims: ["a041rc"],
    target_dimensions: [
      {
        key: "bd_line_code",
        label: "Line Code",
        value: "a041rc",
        source_key: "ledger_layout_groupby_value_id",
        raw_value: "a041rc",
      },
    ],
    dimension_adapter: "legacy_name",
    target_representation: "legacy",
    variable_key: "bea_nipa / proprietors income · total",
    source_citation: sourceCitation,
    source_url: null,
    entity: null,
    aggregation: null,
    measure_name: null,
    period: null,
    chronicle: {
      fact_key: null,
      source_record_id: null,
      semantic_fact_key: null,
      aggregate_fact_key: null,
      legacy_fact_key: null,
      period_type: null,
      source_period: null,
      target_period: null,
      geography_level: "country",
      geography_id: "0100000US",
      geography_vintage: null,
      domain: null,
      entity_name: null,
      entity_role: null,
      measure_concept: null,
      source_concept: null,
      concept_relation: null,
      concept_authority: null,
      measure_unit: "usd",
      value_operation: null,
      layout_record_set_id: null,
      layout_groupby_dimension: "bea_nipa.line_code",
      layout_groupby_value_id: "a041rc",
      layout_measure_id: null,
      dimension_set_key: null,
      universe_constraint_set_key: null,
      universe_constraint_count: null,
      filters: [],
    },
    calibration_status: "included",
    calibration_status_label: "Included",
    calibration_status_reason: null,
    initial_relative_error: -0.1,
    abs_relative_error: 0.01,
    improvement: 0.09000000000000001,
    direction: "under",
  });
});

// A v2-shaped target: AGI bracket × return type × filing status, with @period.
function agiTarget(band: string, ret: string, filing: string, rel: number) {
  return {
    name: `nation/irs/adjusted gross income/total/${band}/${ret}/${filing}@2024`,
    target_name: `nation/irs/adjusted gross income/total/${band}/${ret}/${filing}`,
    period: 2024,
    entity: "household",
    aggregation: "sum",
    measure: { kind: "column", name: "adjusted_gross_income" },
    source: "IRS SOI Table 1.1",
    target: 100,
    initial_estimate: 140,
    final_estimate: 100 * (1 + rel),
    relative_error: rel,
    within_tolerance: Math.abs(rel) <= 0.1,
  };
}

function calibration(targets: object[], releaseId = "rel-a"): Calibration {
  return buildCalibration({ targets, final_loss: 0.02, fraction_within_10pct: 0.9 }, releaseId);
}

const SAMPLE = calibration([
  agiTarget("AGI in 200k-500k", "taxable", "All", -0.086),
  agiTarget("AGI in 200k-500k", "taxable", "Married Filing Jointly", -0.102),
  agiTarget("AGI in 30k-40k", "taxable", "All", 0.236),
  { name: "US06/snap-cost", target: 100, initial_estimate: 90, final_estimate: 99, relative_error: -0.01, within_tolerance: true },
]);

function page(url: string, cal = SAMPLE) {
  return latestMicrocosmTargetDiagnosticsPage(`http://x/api/microcosm/target-diagnostics${url}`, cal);
}

test("v2 metadata and parsing survive enrichment", () => {
  const row = SAMPLE.rows[0];
  expect(row.variable_key).toBe("irs / adjusted gross income · total");
  expect(row.variable).toBe("adjusted gross income"); // @2024 stripped via target_name
  expect(row.geography).toBe("United States");
  expect(row.entity).toBe("household");
  expect(row.aggregation).toBe("sum");
  expect(row.period).toBe(2024);
  expect(row.source_citation).toBe("IRS SOI Table 1.1");
});

test("legacy Ledger metadata populates the complete Chronicle contract", () => {
  const cal = calibration([
    {
      name: "irs_soi.ty2022.historic_table_2.state_agi.ak.1_to_10k.taxable_interest_amount@2024",
      target_name: "irs_soi.ty2022.historic_table_2.state_agi.ak.1_to_10k.taxable_interest_amount",
      target: 100,
      initial_estimate: 90,
      final_estimate: 99,
      registry: { family: "irs_soi" },
      metadata: {
        ledger_fact_key: "fact-key",
        ledger_source_record_id: "source-record",
        ledger_semantic_fact_key: "semantic-key",
        ledger_aggregate_fact_key: "aggregate-key",
        ledger_legacy_fact_key: "legacy-key",
        ledger_period_type: "tax_year",
        source_period: "2022",
        target_period: "2024",
        ledger_geography_level: "state",
        ledger_geography_id: "0400000US02",
        ledger_geography_vintage: "2020_census",
        ledger_domain: "all_returns",
        ledger_entity_name: "tax_unit",
        ledger_entity_role: "filing_unit",
        ledger_measure_concept: "irs_soi.taxable_interest",
        ledger_source_concept: "irs_soi.taxable_interest",
        ledger_concept_relation: "identical",
        ledger_concept_authority: "IRS",
        ledger_measure_unit: "usd",
        ledger_value_operation: "identity",
        ledger_layout_record_set_id: "irs_soi.ty2022.historic_table_2.state_agi.ak",
        ledger_layout_groupby_dimension: "us:statutes/26/62#adjusted_gross_income",
        ledger_layout_groupby_value_id: "1_to_10k",
        ledger_layout_measure_id: "taxable_interest_amount",
        ledger_dimension_set_key: "dimension-set",
        ledger_universe_constraint_set_key: "universe-set",
        ledger_universe_constraint_count: 2,
        ledger_filter_income_range: "1_to_10k",
        ledger_filter_filing_status: "all",
        source_measure_id: "taxable_interest_amount",
        variable: "taxable_interest_income",
        filing_status: "All",
      },
    },
  ]);
  const row = cal.rows[0];

  expect(row.geography).toBe("AK");
  expect(row.level).toBe("state");
  expect(row.state).toBe("AK");
  expect(row.measure).toBe("total");
  expect(row.target_dimensions).toEqual([
    expect.objectContaining({ label: "Income band", value: "1 to 10k" }),
    expect.objectContaining({ label: "Filing status", value: "All" }),
  ]);
  expect(row.chronicle).toMatchObject({
    fact_key: "fact-key",
    source_record_id: "source-record",
    semantic_fact_key: "semantic-key",
    aggregate_fact_key: "aggregate-key",
    legacy_fact_key: "legacy-key",
    period_type: "tax_year",
    source_period: "2022",
    target_period: "2024",
    geography_level: "state",
    geography_id: "0400000US02",
    geography_vintage: "2020_census",
    domain: "all_returns",
    entity_name: "tax_unit",
    entity_role: "filing_unit",
    measure_concept: "irs_soi.taxable_interest",
    source_concept: "irs_soi.taxable_interest",
    concept_relation: "identical",
    concept_authority: "IRS",
    measure_unit: "usd",
    value_operation: "identity",
    layout_record_set_id: "irs_soi.ty2022.historic_table_2.state_agi.ak",
    layout_groupby_dimension: "us:statutes/26/62#adjusted_gross_income",
    layout_groupby_value_id: "1_to_10k",
    layout_measure_id: "taxable_interest_amount",
    dimension_set_key: "dimension-set",
    universe_constraint_set_key: "universe-set",
    universe_constraint_count: 2,
    filters: expect.arrayContaining([
      expect.objectContaining({ label: "Income band", value: "1 to 10k" }),
      expect.objectContaining({ label: "Filing status", value: "All" }),
    ]),
  });
});

test("legacy geography and income metadata drive the explorer hierarchy", () => {
  const legacyTarget = (state: "ak" | "ca", geoId: string, band: string) => ({
    name: `irs_soi.ty2022.historic_table_2.state_agi.${state}.${band}.taxable_interest_amount@2024`,
    target: 100,
    initial_estimate: 100,
    final_estimate: 100,
    registry: { family: "irs_soi" },
    metadata: {
      ledger_geography_level: "state",
      ledger_geography_id: geoId,
      ledger_layout_groupby_dimension: "us:statutes/26/62#adjusted_gross_income",
      ledger_layout_groupby_value_id: band,
      ledger_filter_income_range: band,
      ledger_filter_filing_status: "all",
      source_measure_id: "taxable_interest_amount",
      variable: "taxable_interest_income",
      filing_status: "All",
    },
  });
  const cal = calibration([
    legacyTarget("ak", "0400000US02", "1_to_10k"),
    legacyTarget("ak", "0400000US02", "10k_to_25k"),
    legacyTarget("ca", "0400000US06", "1_to_10k"),
  ]);
  const filters = {
    geographyLevels: [],
    geographies: [],
    fitBands: [],
    calibrationStatuses: [],
  };
  const program = buildCalibrationTree(cal.rows, {
    breakdown: "program",
    path: {
      source: "irs_soi",
      program: "taxable interest income",
      dimensions: [],
    },
    filters,
  });

  expect(program.currentLevel).toEqual({ kind: "geography", label: "Geography" });
  expect(program.groups[0].nodes.map((node) => node.id)).toEqual(["AK", "CA"]);

  const alaska = buildCalibrationTree(cal.rows, {
    breakdown: "program",
    path: {
      source: "irs_soi",
      program: "taxable interest income",
      geography: "AK",
      dimensions: [],
    },
    filters,
  });
  expect(alaska.currentLevel).toEqual({
    kind: "dimension",
    key: "bd_income_band",
    label: "Income band",
  });
  expect(alaska.groups[0].nodes.map((node) => node.label)).toEqual([
    "1 to 10k",
    "10k to 25k",
  ]);
});

test("release publish date prefers the release manifest commit date", () => {
  expect(
    releasePublishedAtFromTree([
      {
        type: "file",
        path: "releases/rel/calibration_diagnostics.json",
        lastCommit: { date: "2026-07-23T02:08:36.000Z" },
      },
      {
        type: "file",
        path: "releases/rel/release_manifest.json",
        lastCommit: { date: "2026-07-23T02:08:37.000Z" },
      },
    ]),
  ).toBe("2026-07-23T02:08:37.000Z");
});

test("FIPS admin target collapses to a measure family", () => {
  const snap = SAMPLE.rows.find((r) => r.variable === "snap-cost")!;
  expect(snap.geography).toBe("CA");
  expect(snap.source).toBe("admin");
  expect(snap.family).toBe("snap-cost");
});

test("variable filter isolates a variable's breakdowns", () => {
  const result = page("?variable=irs%20%2F%20adjusted%20gross%20income%20%C2%B7%20total");
  expect(result.filtered_total).toBe(3);
  for (const row of result.targets) expect(row.variable_key).toBe("irs / adjusted gross income · total");
});

test("program filter includes both count and amount targets", () => {
  const cal = calibration([
    {
      name: "irs_soi.ty2022.historic_table_2.us.all.taxable_interest_amount@2024",
      target_name: "irs_soi.ty2022.historic_table_2.us.all.taxable_interest_amount",
      target: 100,
      initial_estimate: 100,
      final_estimate: 90,
      relative_error: -0.1,
      registry: { family: "irs_soi" },
      metadata: {
        variable: "taxable_interest_income",
        source_measure_id: "taxable_interest_amount",
        ledger_geography_level: "country",
        ledger_geography_id: "0100000US",
        ledger_measure_unit: "usd",
        ledger_layout_groupby_value_id: "all",
      },
    },
    {
      name: "irs_soi.ty2022.historic_table_2.us.all.taxable_interest_returns@2024",
      target_name: "irs_soi.ty2022.historic_table_2.us.all.taxable_interest_returns",
      target: 100,
      initial_estimate: 100,
      final_estimate: 95,
      relative_error: -0.05,
      registry: { family: "irs_soi" },
      metadata: {
        variable: "taxable_interest_income",
        source_measure_id: "taxable_interest_returns",
        ledger_geography_level: "country",
        ledger_geography_id: "0100000US",
        ledger_measure_unit: "count",
        ledger_layout_groupby_value_id: "all",
      },
    },
    {
      name: "irs_soi.ty2022.historic_table_2.us.all.eitc_returns@2024",
      target_name: "irs_soi.ty2022.historic_table_2.us.all.eitc_returns",
      target: 100,
      initial_estimate: 100,
      final_estimate: 100,
      relative_error: 0,
      registry: { family: "irs_soi" },
      metadata: {
        variable: "eitc",
        source_measure_id: "eitc_returns",
        ledger_geography_level: "country",
        ledger_geography_id: "0100000US",
        ledger_measure_unit: "count",
        ledger_layout_groupby_value_id: "all",
      },
    },
  ]);
  const result = latestMicrocosmTargetDiagnosticsPage(
    "http://x/api/microcosm/target-diagnostics?program=irs_soi%20%2F%20taxable%20interest%20income",
    cal,
  );
  expect(result.filtered_total).toBe(2);
  expect(result.targets.map((row) => row.measure).sort()).toEqual(["count", "total"]);

  const countOnly = latestMicrocosmTargetDiagnosticsPage(
    "http://x/api/microcosm/target-diagnostics?program=irs_soi%20%2F%20taxable%20interest%20income&measure=count",
    cal,
  );
  expect(countOnly.filtered_total).toBe(1);
  expect(countOnly.targets[0].measure).toBe("count");
  expect(countOnly.filters?.measure).toBe("count");
});

test("targets without geography metadata default to the national geography", () => {
  const cal = calibration([
    {
      name: "selection_mass_protection.keogh_distributions@2024",
      target_name: "selection_mass_protection.keogh_distributions",
      target: 100,
      initial_estimate: 100,
      final_estimate: 100,
      relative_error: 0,
      registry: { family: "unspecified" },
      metadata: {
        variable: "keogh_distributions",
        source_measure_id: "keogh_distributions",
      },
    },
  ]);
  expect(cal.rows[0].geography).toBe("United States");
  expect(cal.rows[0].level).toBe("national");

  const result = latestMicrocosmTargetDiagnosticsPage(
    "http://x/api/microcosm/target-diagnostics?level=national&geography=United%20States",
    cal,
  );
  expect(result.filtered_total).toBe(1);
  expect(result.targets[0].name).toBe("selection_mass_protection.keogh_distributions@2024");
});

test("dimensions are the axes that vary; constants drop", () => {
  const result = page("?variable=irs%20%2F%20adjusted%20gross%20income%20%C2%B7%20total");
  const labels = result.dimensions.map((d) => d.label);
  expect(labels).toContain("Income band");
  expect(labels).toContain("Filing status");
  expect(labels).not.toContain("Return type"); // all "taxable" -> constant
});

test("income band facets sort total first, then descending numeric bands", () => {
  const rows = ["total", "under_1", "1_to_10k", "50k_plus", "500k_to_1m", "1m_plus"]
    .map((band) => ({
      name: `irs_soi.ty2022.historic_table_2.us.${band}.adjusted_gross_income@2024`,
      target_name: `irs_soi.ty2022.historic_table_2.us.${band}.adjusted_gross_income`,
      target: 100,
      initial_estimate: 100,
      final_estimate: 100,
      relative_error: 0,
      registry: { family: "irs_soi" },
      metadata: {
        variable: "adjusted_gross_income",
        source_measure_id: "adjusted_gross_income",
        ledger_geography_level: "country",
        ledger_geography_id: "0100000US",
        ledger_measure_unit: "usd",
        ledger_layout_groupby_dimension: "us:statutes/26/62#adjusted_gross_income",
        ledger_layout_groupby_value_id: band,
        ledger_filter_income_range: band === "total" ? "all" : band,
        filing_status: "All",
      },
    }));
  const cal = calibration(rows);
  const result = latestMicrocosmTargetDiagnosticsPage(
    "http://x/api/microcosm/target-diagnostics?variable=irs_soi%20%2F%20adjusted%20gross%20income%20%C2%B7%20total",
    cal,
  );
  const incomeBand = result.dimensions.find((dim) => dim.label === "Income band");

  expect(incomeBand?.values).toEqual([
    "Total",
    "1m plus",
    "500k to 1m",
    "50k plus",
    "1 to 10k",
    "under 1",
  ]);
});

test("facet filter narrows to a single breakdown", () => {
  const income = page("?variable=irs%20%2F%20adjusted%20gross%20income%20%C2%B7%20total").dimensions.find(
    (d) => d.label === "Income band",
  )!;
  const result = page(
    `?variable=irs%20%2F%20adjusted%20gross%20income%20%C2%B7%20total&facet=${income.key}:AGI in 30k-40k`,
  );
  expect(result.filtered_total).toBe(1);
  expect(result.targets[0].dims).toContain("AGI in 30k-40k");
});

test("calibration summary reports per-family fit", () => {
  const summary = latestMicrocosmCalibrationSummary(SAMPLE);
  expect(summary.total_targets).toBe(4);
  expect(summary.included_target_count).toBe(4);
  expect(summary.family_fit.length).toBeGreaterThan(0);
});

test("release highlights split bounded percent fit from absolute miss magnitude", () => {
  const cal = calibration([
    {
      name: "source.us.total.relative-bounded@2024",
      target_name: "source.us.total.relative-bounded",
      target: 100,
      initial_estimate: 1000,
      final_estimate: 900,
      relative_error: 8,
      within_tolerance: false,
    },
    {
      name: "source.us.total.relative-extreme@2024",
      target_name: "source.us.total.relative-extreme",
      target: 1,
      initial_estimate: 120,
      final_estimate: 100,
      relative_error: 99,
      within_tolerance: false,
    },
    {
      name: "source.us.total.absolute-large@2024",
      target_name: "source.us.total.absolute-large",
      target: 1_000_000_000,
      initial_estimate: 1_600_000_000,
      final_estimate: 1_400_000_000,
      relative_error: 0.4,
      within_tolerance: false,
    },
  ]);
  const highlights = latestMicrocosmCalibrationHighlights(cal, 10);

  expect(highlights.extreme_relative_outlier_count).toBe(1);
  expect(highlights.worst_bounded_relative_fit.map((row) => row.base_name)).toContain(
    "source.us.total.relative-bounded",
  );
  expect(highlights.worst_bounded_relative_fit.map((row) => row.base_name)).not.toContain(
    "source.us.total.relative-extreme",
  );
  expect(highlights.extreme_relative_outliers[0].base_name).toBe(
    "source.us.total.relative-extreme",
  );
  expect(highlights.largest_absolute_misses[0].base_name).toBe(
    "source.us.total.absolute-large",
  );
  expect(highlights.largest_absolute_misses[0].abs_final_miss).toBe(400_000_000);
  expect(highlights.biggest_absolute_improvements[0].absolute_improvement).toBe(200_000_000);
});

test("calibration inclusion status uses skipped and dropped metadata", () => {
  const cal = buildCalibration(
    {
      targets: [
        { name: "included@2024", target: 1, initial_estimate: 1, final_estimate: 1 },
        { name: "skipped@2024", target_name: "skipped", target: 1 },
        { name: "dropped@2024", target_name: "dropped", target: 1 },
      ],
      skipped: [{ name: "skipped", reason: "No support." }],
    },
    "rel-a",
    null,
    {
      gates: {
        target_compilation: {
          declared_targets: 3,
          compiled_candidate_targets: 2,
          dropped_target_names: ["dropped"],
        },
      },
    },
  );

  expect(cal.included_target_count).toBe(1);
  expect(cal.dropped_target_names).toEqual(["dropped"]);
  expect(cal.rows.map((row) => row.calibration_status)).toEqual([
    "included",
    "skipped",
    "not_materialized",
  ]);
  const page = latestMicrocosmTargetDiagnosticsPage(
    "http://x/api/microcosm/target-diagnostics",
    cal,
  );
  expect(page.summary.included_target_count).toBe(1);
  expect(page.summary.skipped_target_count).toBe(1);
  expect(page.summary.dropped_target_count).toBe(1);
  expect(page.targets[1].calibration_status_reason).toBe("No support.");
});

test("healthcare scope includes ACA, Medicaid, Medicare, and PTC targets", () => {
  const cal = calibration([
    {
      name: "cms_aca.oep2024.state_marketplace.ca.aptc_recipients@2024",
      target_name: "cms_aca.oep2024.state_marketplace.ca.aptc_recipients",
      target: 100,
      initial_estimate: 50,
      final_estimate: 80,
      relative_error: -0.2,
      registry: { family: "cms_aca" },
      metadata: {
        target_role: "aca_ptc_recipients",
        base_variable: "assigned_aca_ptc",
        count_map_to: "person",
        count_filter_variable: "is_aca_ptc_eligible",
        measure_mode: "positive_count",
        materializer: "policyengine_variable",
        source_measure_id: "aptc_recipients",
        ledger_geography_level: "state",
        ledger_geography_id: "0400000US06",
      },
    },
    {
      name: "US06/cms_medicaid/total_medicaid_enrollment@2024",
      target: 100,
      initial_estimate: 90,
      final_estimate: 95,
      relative_error: -0.05,
      metadata: {
        target_role: "medicaid_enrollment",
        base_variable: "medicaid_enrolled",
        measure_mode: "positive_count",
      },
    },
    {
      name: "nation/cms_medicare/part_b_premium_income@2024",
      target: 100,
      initial_estimate: 100,
      final_estimate: 101,
      relative_error: 0.01,
      metadata: {
        target_role: "medicare_part_b_premium_total",
        base_variable: "gross_medicare_part_b_premium",
        measure_mode: "sum",
      },
    },
    {
      name: "irs_soi.ty2022.historic_table_2.us.all.premium_tax_credit_amount@2024",
      target_name: "irs_soi.ty2022.historic_table_2.us.all.premium_tax_credit_amount",
      target: 100,
      initial_estimate: 60,
      final_estimate: 70,
      relative_error: -0.3,
      registry: { family: "irs_soi" },
      metadata: {
        target_role: "aca_spending",
        base_variable: "assigned_aca_ptc",
        measure_mode: "sum",
        source_measure_id: "premium_tax_credit_amount",
        ledger_geography_level: "country",
        ledger_geography_id: "0100000US",
      },
    },
    agiTarget("AGI in 30k-40k", "taxable", "All", 0.01),
  ]);

  const result = latestMicrocosmTargetDiagnosticsPage(
    "http://x/api/microcosm/target-diagnostics?scope=healthcare",
    cal,
  );

  expect(result.total_targets).toBe(4);
  expect(result.filtered_total).toBe(4);
  expect(result.scope_counts).toEqual({ healthcare: 4 });
  expect(
    latestMicrocosmTargetDiagnosticsPage("http://x/api/microcosm/target-diagnostics", cal)
      .scope_counts,
  ).toEqual({ healthcare: 4 });
  expect(result.summary.fraction_within_10pct).toBe(0.5);
  expect(result.targets.map((row) => row.name)).not.toContain(
    "nation/irs/adjusted gross income/total/AGI in 30k-40k/taxable/All@2024",
  );
  const aptc = result.targets.find((row) => row.source_measure_id === "aptc_recipients");
  expect(aptc?.policyengine_variables).toEqual(["assigned_aca_ptc"]);
  expect(aptc?.policyengine_map_to).toBe("person");
  expect(aptc?.policyengine_filter_variable).toBe("is_aca_ptc_eligible");
  expect(aptc?.measure_mode).toBe("positive_count");
  const ptcAmount = result.targets.find(
    (row) => row.source_measure_id === "premium_tax_credit_amount",
  );
  expect(ptcAmount?.policyengine_variables).toEqual(["assigned_aca_ptc"]);
  expect(result.variables.map((row) => row.source)).toContain("cms_aca");
  expect(result.variables.map((row) => row.source)).toContain("irs_soi");
  expect(result.variables.find((row) => row.source === "cms_aca")?.policyengine_variables).toEqual([
    "assigned_aca_ptc",
  ]);
});

test("comparison matches on base_name across the @period boundary", () => {
  // B drops one target, changes one fit, adds a new one.
  const b = calibration(
    [
      agiTarget("AGI in 200k-500k", "taxable", "All", -0.02), // improved (|−0.02| < |−0.086|)
      agiTarget("AGI in 30k-40k", "taxable", "All", 0.30), // regressed
      { name: "nation/cbo/individual_income_tax@2024", target_name: "nation/cbo/individual_income_tax", target: 1, initial_estimate: 1, final_estimate: 1, relative_error: 0, within_tolerance: true },
    ],
    "rel-b",
  );
  const cmp = buildComparison(SAMPLE, b);
  expect(cmp.summary.common).toBe(2);
  expect(cmp.summary.improved).toBe(1);
  expect(cmp.summary.regressed).toBe(1);
  expect(cmp.summary.added).toBe(1); // cbo income tax, only in B
  expect(cmp.summary.removed).toBe(2); // the MFJ AGI row and snap-cost, only in A
  expect(cmp.summary.losses_comparable).toBe(false);
  expect(cmp.variables[0].variable_key).toBe("irs / adjusted gross income · total");
  expect(cmp.variables[0].common_targets).toBe(2);
  expect(cmp.variables[0].relative_targets).toBe(2);
  expect(cmp.variables[0].improved).toBe(1);
  expect(cmp.variables[0].regressed).toBe(1);
  expect(Array.isArray(cmp.rows[0].target_dimensions)).toBe(true);
});

test("comparison exposes each release's weighted target-error aggregate", () => {
  const current = {
    ...SAMPLE,
    final_loss: 0.91,
    target_loss_attribution: {
      ...SAMPLE.target_loss_attribution,
      status: "reported" as const,
      aggregate: 0.123,
    },
  };
  const candidate = {
    ...SAMPLE,
    release_id: "weighted-candidate",
    final_loss: 0.82,
    target_loss_attribution: {
      ...SAMPLE.target_loss_attribution,
      status: "reported" as const,
      aggregate: 0.087,
    },
  };

  const cmp = buildComparison(current, candidate);

  expect(cmp.a.weighted_target_error).toBe(0.123);
  expect(cmp.b.weighted_target_error).toBe(0.087);
  expect(cmp.a.weighted_target_error).not.toBe(cmp.a.final_loss);
  expect(cmp.b.weighted_target_error).not.toBe(cmp.b.final_loss);
});

test("comparison matches renamed legacy and structured targets by Chronicle fact key", () => {
  const current = calibration([
    {
      name: "legacy.population.total@2024",
      target_name: "legacy.population.total",
      metadata: { ledger_fact_key: "agency.population.total" },
      target: 100,
      initial_estimate: 90,
      final_estimate: 95,
    },
  ], "legacy-current");
  const candidate = calibration([
    {
      name: "resident-population@2024",
      source: { id: "agency", label: "Statistical agency" },
      variable: { id: "resident_population", measure: "count" },
      dimensions: {},
      metadata: { ledger_fact_key: "agency.population.total" },
      target: 100,
      initial_estimate: 90,
      final_estimate: 99,
    },
  ], "structured-candidate");

  const cmp = buildComparison(current, candidate);
  expect(cmp.summary).toMatchObject({
    common: 1,
    added: 0,
    removed: 0,
    improved: 1,
    matching: {
      current_representation: "legacy",
      candidate_representation: "structured",
      matched_by: { chronicle_fact_key: 1 },
    },
  });
  expect(cmp.rows[0]).toMatchObject({
    match_kind: "chronicle_fact_key",
    current_name: "legacy.population.total@2024",
    candidate_name: "resident-population@2024",
    current_representation: "legacy",
    candidate_representation: "structured",
  });
});

test("comparison preserves duplicate names and resolves them by unique fallback keys", () => {
  const row = (name: string, targetName: string, factKey: string) => ({
    name,
    target_name: targetName,
    metadata: { ledger_fact_key: factKey },
    target: 100,
    initial_estimate: 100,
    final_estimate: 100,
  });
  const current = calibration([
    row("same@2024", "same", "fact-a"),
    row("same@2025", "same", "fact-b"),
  ], "duplicate-current");
  const candidate = calibration([
    row("renamed-a@2026", "renamed-a", "fact-a"),
    row("renamed-b@2026", "renamed-b", "fact-b"),
  ], "duplicate-candidate");

  const cmp = buildComparison(current, candidate);
  expect(cmp.summary).toMatchObject({
    common: 2,
    added: 0,
    removed: 0,
    matching: {
      matched_by: { chronicle_fact_key: 2 },
      ambiguous_key_groups: { base_name: 0 },
    },
  });
  expect(new Set(cmp.rows.map((comparison) => comparison.comparison_id)).size).toBe(2);
});

test("new target loss weighting metadata marks loss as normalized", () => {
  const normalized = buildCalibration(
    {
      targets: [],
      initial_loss: 0.42,
      final_loss: 0.39,
      options: {
        target_loss_scales: { wages: 1 },
        target_loss_weights: { wages: 1 },
      },
    },
    "normalized-release",
  );
  const raw = buildCalibration(
    { targets: [], initial_loss: 752_000_000_000, final_loss: 751_000_000_000 },
    "raw-release",
  );

  expect(latestMicrocosmCalibrationSummary(normalized).loss_kind).toBe("normalized_target_loss");
  expect(latestMicrocosmCalibrationSummary(raw).loss_kind).toBe("raw_optimizer_objective");
  expect(buildComparison(raw, normalized).summary.losses_comparable).toBe(false);
  expect(buildComparison(raw, normalized).summary.loss_kind).toBe("mixed");
});

test("dotted chronicle zero targets use structural-zero percentage errors", () => {
  const cal = calibration([
    {
      name: "irs_soi.ty2022.historic_table_2.us.under_1.real_estate_taxes_amount@2024",
      target_name: "irs_soi.ty2022.historic_table_2.us.under_1.real_estate_taxes_amount",
      target: 0,
      initial_estimate: 100,
      final_estimate: 90,
      relative_error: 90,
      registry: { family: "irs_soi" },
      metadata: {
        variable: "real_estate_taxes",
        source_measure_id: "real_estate_taxes_amount",
        ledger_geography_level: "country",
        ledger_geography_id: "0100000US",
        ledger_layout_groupby_value_id: "under_1",
        filing_status: "All",
      },
    },
  ]);
  expect(cal.rows[0].source).toBe("irs_soi");
  expect(cal.rows[0].variable).toBe("real estate taxes");
  expect(cal.rows[0].measure).toBe("total");
  expect(cal.rows[0].geography).toBe("United States");
  expect(cal.rows[0].breakdown).toBe("under 1 · All");
  expect(cal.rows[0].error_kind).toBe("relative");
  expect(cal.rows[0].initial_error).toBe(1);
  expect(cal.rows[0].final_error).toBe(1);
  expect(cal.rows[0].initial_relative_error).toBe(1);
  expect(cal.rows[0].abs_relative_error).toBe(1);
});

test("dotted chronicle zero targets accept numerical zero noise", () => {
  const cal = calibration([
    {
      name: "irs_soi.zero_target@2024",
      target: 0,
      initial_estimate: 0,
      final_estimate: 1e-4,
      registry: { family: "irs_soi" },
      metadata: {
        variable: "zero_target",
        source_measure_id: "zero_target_amount",
        ledger_geography_level: "country",
        ledger_geography_id: "0100000US",
      },
    },
  ]);
  expect(cal.rows[0].error_kind).toBe("relative");
  expect(cal.rows[0].initial_relative_error).toBe(0);
  expect(cal.rows[0].abs_relative_error).toBe(0);
});

test("dotted chronicle zero targets reject values above the structural-zero tolerance", () => {
  const cal = calibration([
    {
      name: "irs_soi.zero_target@2024",
      target: 0,
      initial_estimate: 0,
      final_estimate: 1.0001e-4,
      registry: { family: "irs_soi" },
      metadata: {
        variable: "zero_target",
        source_measure_id: "zero_target_amount",
        ledger_geography_level: "country",
        ledger_geography_id: "0100000US",
      },
    },
  ]);
  expect(cal.rows[0].error_kind).toBe("relative");
  expect(cal.rows[0].abs_relative_error).toBe(1);
});

test("source measure details become breakdown dimensions", () => {
  const cal = calibration([
    {
      name: "irs_soi.ty2022.historic_table_2.state_eitc.az.az.eitc_amount@2024",
      target_name: "irs_soi.ty2022.historic_table_2.state_eitc.az.az.eitc_amount",
      target: 100,
      initial_estimate: 100,
      final_estimate: 90,
      relative_error: -0.1,
      registry: { family: "irs_soi" },
      metadata: {
        variable: "eitc",
        source_measure_id: "eitc_amount",
        ledger_geography_level: "state",
        ledger_geography_id: "0400000US04",
        ledger_layout_groupby_value_id: "az",
        filing_status: "All",
      },
    },
    {
      name: "irs_soi.ty2022.historic_table_2.state_eitc.az.az.eitc_no_children_amount@2024",
      target_name: "irs_soi.ty2022.historic_table_2.state_eitc.az.az.eitc_no_children_amount",
      target: 100,
      initial_estimate: 100,
      final_estimate: 90,
      relative_error: -0.1,
      registry: { family: "irs_soi" },
      metadata: {
        variable: "eitc",
        source_measure_id: "eitc_no_children_amount",
        ledger_geography_level: "state",
        ledger_geography_id: "0400000US04",
        ledger_layout_groupby_value_id: "az",
        filing_status: "All",
      },
    },
  ]);
  expect(cal.rows[0].variable).toBe("eitc");
  expect(cal.rows[0].measure).toBe("total");
  expect(cal.rows[0].breakdown).toBe("all qualifying children · All");
  expect(cal.rows[0].dims).toEqual(["all qualifying children", "All"]);
  expect(cal.rows[0].variable_key).toBe("irs_soi / eitc · total");
  expect(cal.rows[1].breakdown).toBe("no qualifying children · All");
  const result = latestMicrocosmTargetDiagnosticsPage(
    "http://x/api/microcosm/target-diagnostics?variable=irs_soi%20%2F%20eitc%20%C2%B7%20total",
    cal,
  );
  expect(result.dimensions.map((dim) => dim.label)).toContain("Qualifying children");
});

test("metadata dimensions skip geography repeated as layout breakdown", () => {
  const cal = calibration([
    {
      name: "irs_soi.ty2022.historic_table_2.state_broad.az.all.ctc_amount@2024",
      target_name: "irs_soi.ty2022.historic_table_2.state_broad.az.all.ctc_amount",
      target: 100,
      initial_estimate: 100,
      final_estimate: 90,
      relative_error: -0.1,
      registry: { family: "irs_soi" },
      metadata: {
        variable: "ctc",
        source_measure_id: "ctc_amount",
        ledger_geography_level: "state",
        ledger_geography_id: "0400000US04",
        ledger_layout_record_set_id: "irs_soi.ty2022.historic_table_2.state_broad.az",
        ledger_layout_groupby_dimension: "state",
        ledger_layout_groupby_value_id: "all",
        ledger_filter_income_range: "all",
        filing_status: "All",
      },
    },
    {
      name: "irs_soi.ty2022.historic_table_2.state_broad.ca.all.ctc_amount@2024",
      target_name: "irs_soi.ty2022.historic_table_2.state_broad.ca.all.ctc_amount",
      target: 100,
      initial_estimate: 100,
      final_estimate: 90,
      relative_error: -0.1,
      registry: { family: "irs_soi" },
      metadata: {
        variable: "ctc",
        source_measure_id: "ctc_amount",
        ledger_geography_level: "state",
        ledger_geography_id: "0400000US06",
        ledger_layout_record_set_id: "irs_soi.ty2022.historic_table_2.state_broad.ca",
        ledger_layout_groupby_dimension: "state",
        ledger_layout_groupby_value_id: "all",
        ledger_filter_income_range: "all",
        filing_status: "All",
      },
    },
  ]);
  expect(cal.rows[0].geography).toBe("AZ");
  expect(cal.rows[0].breakdown).toBe("All · All");
  const result = latestMicrocosmTargetDiagnosticsPage(
    "http://x/api/microcosm/target-diagnostics?variable=irs_soi%20%2F%20ctc%20%C2%B7%20total",
    cal,
  );
  expect(result.dimensions.map((dim) => dim.label)).toEqual(["Geography"]);
});

test("EITC table 2.5 child groups come from record set ids", () => {
  const cal = calibration([
    {
      name: "irs_soi.ty2022.table_2_5.eitc_by_agi_children.no_qualifying_children.25k_to_30k.eitc_total@2024",
      target_name: "irs_soi.ty2022.table_2_5.eitc_by_agi_children.no_qualifying_children.25k_to_30k.eitc_total",
      target: 535000,
      initial_estimate: 1995625464.431402,
      final_estimate: 910866264.4027674,
      relative_error: 1701.5537652388175,
      filter: null,
      registry: { family: "irs_soi" },
      metadata: {
        variable: "eitc",
        source_measure_id: "eitc_total",
        ledger_geography_level: "country",
        ledger_geography_id: "0100000US",
        ledger_layout_record_set_id:
          "irs_soi.ty2022.table_2_5.eitc_by_agi_children.no_qualifying_children",
        ledger_layout_groupby_value_id: "25k_to_30k",
        filing_status: "All",
      },
    },
    {
      name: "irs_soi.ty2022.table_2_5.eitc_by_agi_children.one_qualifying_child.25k_to_30k.eitc_total@2024",
      target_name: "irs_soi.ty2022.table_2_5.eitc_by_agi_children.one_qualifying_child.25k_to_30k.eitc_total",
      target: 2717219000,
      initial_estimate: 1995625464.431402,
      final_estimate: 910866264.4027674,
      relative_error: -0.6647799590674262,
      filter: null,
      registry: { family: "irs_soi" },
      metadata: {
        variable: "eitc",
        source_measure_id: "eitc_total",
        ledger_geography_level: "country",
        ledger_geography_id: "0100000US",
        ledger_layout_record_set_id:
          "irs_soi.ty2022.table_2_5.eitc_by_agi_children.one_qualifying_child",
        ledger_layout_groupby_value_id: "25k_to_30k",
        filing_status: "All",
      },
    },
  ]);
  expect(cal.rows[0].breakdown).toBe("25k to 30k · no qualifying children · All");
  expect(cal.rows[0].dims).toEqual(["25k to 30k", "no qualifying children", "All"]);
  expect(cal.rows[0].estimate_warning).toContain("compiled model filter");
});

test("repeated unfiltered sibling estimates get generic scope warnings", () => {
  const cal = calibration([
    {
      name: "source.example.slice_a.under_50.amount@2024",
      target_name: "source.example.slice_a.under_50.amount",
      target: 10,
      initial_estimate: 100,
      final_estimate: 80,
      relative_error: 7,
      filter: null,
      registry: { family: "example" },
      metadata: {
        variable: "example",
        source_measure_id: "amount",
        ledger_geography_id: "0100000US",
        ledger_layout_record_set_id: "source.example.slice_a",
        ledger_layout_groupby_dimension: "age",
        ledger_layout_groupby_value_id: "under_50",
        ledger_layout_measure_id: "amount",
      },
    },
    {
      name: "source.example.slice_b.under_50.amount@2024",
      target_name: "source.example.slice_b.under_50.amount",
      target: 20,
      initial_estimate: 100,
      final_estimate: 80,
      relative_error: 3,
      filter: null,
      registry: { family: "example" },
      metadata: {
        variable: "example",
        source_measure_id: "amount",
        ledger_geography_id: "0100000US",
        ledger_layout_record_set_id: "source.example.slice_b",
        ledger_layout_groupby_dimension: "age",
        ledger_layout_groupby_value_id: "under_50",
        ledger_layout_measure_id: "amount",
      },
    },
  ]);
  expect(cal.rows[0].estimate_warning).toContain("sibling slices share the same estimate");
  expect(cal.rows[1].estimate_warning).toContain("sibling slices share the same estimate");
});

test("zero targets compare as structural-zero relative-error movers", () => {
  const target = {
    name: "irs_soi.ty2022.historic_table_2.us.under_1.real_estate_taxes_amount@2024",
    target_name: "irs_soi.ty2022.historic_table_2.us.under_1.real_estate_taxes_amount",
    target: 0,
    registry: { family: "irs_soi" },
    metadata: {
      variable: "real_estate_taxes",
      source_measure_id: "real_estate_taxes_amount",
      ledger_geography_level: "country",
      ledger_geography_id: "0100000US",
      ledger_layout_groupby_value_id: "under_1",
      filing_status: "All",
    },
  };
  const a = calibration([{ ...target, final_estimate: 100, relative_error: 100 }], "a");
  const b = calibration([{ ...target, final_estimate: 0, relative_error: 0 }], "b");
  const cmp = buildComparison(a, b);
  expect(cmp.summary.improved).toBe(1);
  expect(cmp.rows[0].error_kind).toBe("relative");
  expect(cmp.rows[0].a_error).toBe(1);
  expect(cmp.rows[0].b_error).toBe(0);
  expect(cmp.rows[0].abs_rel_delta).toBe(-1);
});

test("count and total measures split into distinct variables", () => {
  const cal = calibration([
    { name: "nation/irs/capital gains gross/total/AGI in 1m-inf/taxable/All@2024", target_name: "nation/irs/capital gains gross/total/AGI in 1m-inf/taxable/All", target: 100, initial_estimate: 90, final_estimate: 100, relative_error: 0, within_tolerance: true },
    { name: "nation/irs/capital gains gross/count/AGI in 1m-inf/taxable/All@2024", target_name: "nation/irs/capital gains gross/count/AGI in 1m-inf/taxable/All", target: 10, initial_estimate: 9, final_estimate: 10, relative_error: 0, within_tolerance: true },
  ]);
  const keys = new Set(cal.rows.map((r) => r.variable_key));
  expect(keys.has("irs / capital gains gross · total")).toBe(true);
  expect(keys.has("irs / capital gains gross · count")).toBe(true);
  expect(cal.rows.find((r) => r.measure === "count")).toBeTruthy();
  expect(cal.rows.find((r) => r.measure === "total")).toBeTruthy();
});

// A Build L ACS local-area row as published: the custom driver names the target
// value and post-calibration estimate `value`/`estimate`, with no canonical
// `target`/`final_estimate`/`initial_estimate`/`within_tolerance` (microcosm#398).
function localAreaTarget(name: string, value: number, estimate: number, rel: number) {
  return {
    name: `${name}@2024`,
    target_name: name,
    period: 2024,
    entity: "household",
    measure: { kind: "column", name },
    filter: null,
    source: "USDA SNAP FY2024",
    metadata: {},
    value,
    estimate,
    relative_error: rel,
  };
}

test("local-area diagnostics (value/estimate schema) render as included targets", () => {
  const cal = buildCalibration(
    {
      schema_version: 4,
      targets: [
        localAreaTarget("usda_snap.fy2024.state.ct.average_monthly_households", 229620.25, 243424.57, 0.0601),
        localAreaTarget("usda_snap.fy2024.state.me.average_monthly_households", 100000, 90000, -0.1),
      ],
      final_loss: 0.058,
      fraction_within_10pct: 0.87,
    },
    "populace-us-2024-buildl-acs-local-36de5d9a-20260712T104640Z",
    null,
    {},
    { dataset_role: "non_default_local_area", is_default: false, default_datasets: {} },
  );

  // The bug: without alias normalization every row read as "no estimate" and the
  // dashboard reported zero calibrated targets. All rows are now included.
  expect(cal.diagnostics_status).toBe("ok");
  expect(cal.included_target_count).toBe(2);
  expect(cal.rows.every((row) => row.calibration_status === "included")).toBe(true);
  // Aliases are mapped onto the canonical fit fields.
  expect(cal.rows[0].target).toBe(229620.25);
  expect(cal.rows[0].final_estimate).toBe(243424.57);
  // Relative-error-derived fit survives (used by the "within 10%" metrics).
  expect(cal.rows[0].abs_relative_error).toBeCloseTo(0.0601, 4);

  const summary = latestMicrocosmCalibrationSummary(cal);
  expect(summary.total_targets).toBe(2);
  expect(summary.included_target_count).toBe(2);
  expect(summary.diagnostics_status).toBe("ok");
  expect(summary.dataset_role).toBe("non_default_local_area");
  expect(summary.is_default).toBe(false);
  expect(summary.is_local_area).toBe(true);

  const page = latestMicrocosmTargetDiagnosticsPage(
    "http://x/api/microcosm/target-diagnostics",
    cal,
  );
  expect(page.summary.total_targets).toBe(2);
  expect(page.summary.included_target_count).toBe(2);
  expect(page.summary.diagnostics_status).toBe("ok");
  expect(page.is_local_area).toBe(true);
});

test("canonical target/final_estimate are never overwritten by value/estimate aliases", () => {
  const cal = buildCalibration(
    {
      targets: [
        {
          name: "nation/irs/agi/total@2024",
          target_name: "nation/irs/agi/total",
          target: 100,
          initial_estimate: 90,
          final_estimate: 110,
          value: 999,
          estimate: 999,
          relative_error: 0.1,
        },
      ],
    },
    "rel",
  );
  expect(cal.diagnostics_status).toBe("ok");
  expect(cal.rows[0].target).toBe(100);
  expect(cal.rows[0].final_estimate).toBe(110);
  expect(cal.rows[0].calibration_status).toBe("included");
});

test("unreadable diagnostics rows report an explicit incompatible status, not a silent zero", () => {
  const cal = buildCalibration(
    {
      targets: [
        { name: "source.us.total.mystery-a@2024", target_name: "source.us.total.mystery-a", metadata: {}, unknown_metric: 1 },
        { name: "source.us.total.mystery-b@2024", target_name: "source.us.total.mystery-b", metadata: {} },
      ],
    },
    "rel",
  );
  expect(cal.diagnostics_status).toBe("incompatible");
  expect(cal.included_target_count).toBe(0);

  const page = latestMicrocosmTargetDiagnosticsPage(
    "http://x/api/microcosm/target-diagnostics",
    cal,
  );
  expect(page.summary.diagnostics_status).toBe("incompatible");
  // The rows are still counted — the zero-included is now explained, not silent.
  expect(page.summary.total_targets).toBe(2);
});

test("diagnostics with an empty targets list report an explicit empty status", () => {
  const cal = buildCalibration({ targets: [] }, "rel");
  expect(cal.diagnostics_status).toBe("empty");
  expect(latestMicrocosmCalibrationSummary(cal).diagnostics_status).toBe("empty");
});

test("diagnostics missing the targets array report incompatible", () => {
  const cal = buildCalibration({ final_loss: 0.1 }, "rel");
  expect(cal.diagnostics_status).toBe("incompatible");
});

test("releaseRole classifies national default vs non-default local-area", () => {
  expect(releaseRole({ default_datasets: { national: "populace_us_2024" } })).toEqual({
    dataset_role: null,
    is_default: true,
    is_local_area: false,
  });
  expect(
    releaseRole({
      dataset_role: "non_default_local_area",
      is_default: false,
      default_datasets: {},
    }),
  ).toEqual({
    dataset_role: "non_default_local_area",
    is_default: false,
    is_local_area: true,
  });
});

test("releasePresentation keeps only trimmed, capped intro slots", () => {
  const longIntro = `  ${"x".repeat(610)}  `;
  expect(
    releasePresentation({
      presentation: {
        overview_intro: "  Artifact overview.  ",
        targets_intro: longIntro,
        arbitrary_section: "Ignored",
      },
    }),
  ).toEqual({
    overview_intro: "Artifact overview.",
    targets_intro: "x".repeat(600),
  });
});

test("releasePresentation returns null when no valid intro slot exists", () => {
  expect(releasePresentation({})).toBeNull();
  expect(releasePresentation({ presentation: [] })).toBeNull();
  expect(releasePresentation({ presentation: "copy" })).toBeNull();
  expect(
    releasePresentation({
      presentation: {
        overview_intro: "   ",
        targets_intro: 12,
        unknown: "Ignored",
      },
    }),
  ).toBeNull();
});

test("presentation flows through calibration, summary, and target responses", () => {
  const presentation = {
    overview_intro: "Artifact overview.",
    targets_intro: "Artifact target prompt.",
  };
  const cal = buildCalibration(
    { targets: [] },
    "presentation-release",
    null,
    {},
    { presentation },
  );

  expect(cal.presentation).toEqual(presentation);
  expect(latestMicrocosmCalibrationSummary(cal).presentation).toEqual(presentation);
  expect(
    latestMicrocosmTargetDiagnosticsPage(
      "http://x/api/microcosm/target-diagnostics",
      cal,
    ).presentation,
  ).toEqual(presentation);
});

test("releasePublisherLabels keeps valid keys and trimmed non-empty labels", () => {
  expect(releasePublisherLabels({})).toEqual({});
  expect(releasePublisherLabels({ publisher_labels: [] })).toEqual({});
  expect(releasePublisherLabels({ publisher_labels: "labels" })).toEqual({});
  expect(
    releasePublisherLabels({
      publisher_labels: {
        novastat_agency: "  Nova Statistics Agency  ",
        IRS2: "IRS second series",
        "bad-key": "Dropped",
        _bad: "Dropped",
        blank: "  ",
        numeric: 12,
      },
    }),
  ).toEqual({
    novastat_agency: "Nova Statistics Agency",
    IRS2: "IRS second series",
  });
});

test("publisher labels flow through rows, variables, target responses, and treemaps", () => {
  const cal = buildCalibration(
    {
      targets: [
        {
          name: "fixture_population@2026",
          target_name: "fixture_population",
          source: "ZZ official population table",
          metadata: {
            chronicle_record_ids: ["novastat_agency.population.cy2026.total"],
            variable: "population",
            source_measure_id: "population_count",
          },
          target: 100,
          initial_estimate: 90,
          final_estimate: 100,
        },
      ],
    },
    "publisher-labels",
    null,
    {},
    { publisher_labels: { novastat_agency: "Nova Statistics Agency" } },
  );

  expect(cal.publisher_labels).toEqual({
    novastat_agency: "Nova Statistics Agency",
  });
  expect(cal.rows[0].source_label).toBe("Nova Statistics Agency");
  const page = latestMicrocosmTargetDiagnosticsPage(
    "http://x/api/microcosm/target-diagnostics",
    cal,
  );
  expect(page.targets[0].source_label).toBe("Nova Statistics Agency");
  expect(page.variables[0].source_label).toBe("Nova Statistics Agency");
  expect(microcosmTargetTreemap(cal.rows, cal.release_id).groups[0].label).toBe(
    "Nova Statistics Agency",
  );
});

test("publisher label lookup does not read inherited object properties", () => {
  const cal = buildCalibration(
    {
      targets: [
        {
          name: "constructor.population.total@2026",
          source: "Citation",
          metadata: { chronicle_record_ids: ["constructor.population.total"] },
          target: 1,
          initial_estimate: 1,
          final_estimate: 1,
        },
      ],
    },
    "publisher-prototype",
  );

  expect(cal.rows[0].source_label).toBe("Constructor");
});

test("fully structured targets ignore conflicting legacy identity fields", () => {
  const cal = buildCalibration(
    {
      dimensions: {
        region: {
          label: "Region",
          role: "geography",
          level: "region",
          values: { north: "North" },
        },
        sex: { label: "Sex", values: { female: "Female" } },
      },
      targets: [
        {
          name: "legacy.publisher.incorrect_variable.total@2026",
          source: {
            id: "novastat_agency",
            citation: "Official population table",
            label: "Nova Statistics Agency",
            url: "https://stats.example/population",
          },
          variable: {
            id: "resident_population",
            label: "Resident population",
            measure: "count",
          },
          dimensions: { region: "north", sex: "female" },
          filter: "cell_be1_male_65_plus",
          metadata: {
            chronicle_record_ids: ["legacy_agency.incorrect.total"],
            variable: "incorrect_variable",
            ledger_geography_level: "state",
            ledger_geography_id: "0400000US06",
            ledger_layout_groupby_value_id: "incorrect_breakdown",
          },
          target: 100,
          initial_estimate: 90,
          final_estimate: 100,
        },
      ],
    },
    "structured-only",
  );

  expect(cal.target_schema.target_representation).toBe("structured");
  expect(cal.rows[0]).toMatchObject({
    family: "novastat_agency/resident_population",
    source: "novastat_agency",
    source_label: "Nova Statistics Agency",
    source_citation: "Official population table",
    source_url: "https://stats.example/population",
    variable: "resident_population",
    variable_label: "Resident population",
    measure: "count",
    geography: "North",
    level: "region",
    state: null,
    breakdown: "Female",
    dimension_adapter: "structured",
    variable_key: "novastat_agency / resident_population · count",
    target_dimensions: [
      expect.objectContaining({ key: "bd_sex", label: "Sex", value: "Female" }),
    ],
  });
  const map = microcosmTargetTreemap(cal.rows, cal.release_id);
  expect(map.groups[0]).toMatchObject({
    source: "novastat_agency",
    label: "Nova Statistics Agency",
  });
  expect(map.groups[0].children[0]).toMatchObject({
    variable: "resident_population",
    label: "Resident population",
  });
  const tree = buildCalibrationTree(cal.rows, {
    breakdown: "program",
    path: { dimensions: [] },
    filters: {
      geographyLevels: [],
      geographies: [],
      fitBands: [],
      calibrationStatuses: [],
    },
  });
  expect(tree.groups[0].nodes[0]).toMatchObject({
    id: "resident_population",
    label: "Resident population",
  });
});

test("structured dimension ids remain independent when display labels repeat", () => {
  const structuredTargets = [
    ["north", "east"],
    ["north", "west"],
    ["south", "east"],
    ["south", "west"],
  ].map(([origin, destination], index) => ({
    name: `population-${index}`,
    source: { id: "agency" },
    variable: { id: "population", measure: "count" },
    dimensions: { origin, destination },
    target: 100,
    initial_estimate: 90,
    final_estimate: 100,
  }));
  const diagnostics = {
    dimensions: {
      origin: {
        label: "Region",
        values: { north: "North", south: "South" },
      },
      destination: {
        label: "Region",
        values: { east: "East", west: "West" },
      },
    },
    targets: structuredTargets,
  };
  const cal = buildCalibration(diagnostics, "repeated-dimension-labels");

  expect(cal.rows[0].target_dimensions).toEqual([
    expect.objectContaining({ key: "bd_origin", label: "Region", value: "North" }),
    expect.objectContaining({ key: "bd_destination", label: "Region", value: "East" }),
  ]);

  const requestUrl = new URL("http://x/api/microcosm/target-diagnostics");
  requestUrl.searchParams.set("variable", "agency / population · count");
  requestUrl.searchParams.append("facet", "bd_origin:North");
  requestUrl.searchParams.append("facet", "bd_destination:East");
  const page = latestMicrocosmTargetDiagnosticsPage(requestUrl.toString(), cal);
  expect(page.dimensions).toEqual([
    { key: "bd_origin", label: "Region", values: ["North", "South"] },
    { key: "bd_destination", label: "Region", values: ["East", "West"] },
  ]);
  expect(page.filtered_total).toBe(1);

  const treeState = {
    breakdown: "program" as const,
    path: {
      source: "agency",
      program: "population",
      geography: "United States",
      dimensions: [],
    },
    filters: {
      geographyLevels: [],
      geographies: [],
      fitBands: [],
      calibrationStatuses: [],
    },
  };
  const tree = buildCalibrationTree(cal.rows, treeState);
  expect(tree.dimensionOrder).toEqual([
    { key: "bd_destination", label: "Region" },
    { key: "bd_origin", label: "Region" },
  ]);
  expect(tree.groups[0]?.id).toBe("bd_destination");
  const destinationTree = buildCalibrationTree(cal.rows, {
    ...treeState,
    path: {
      ...treeState.path,
      dimensions: [{ key: "bd_destination", label: "Region", value: "East" }],
    },
  });
  expect(destinationTree.groups[0]?.id).toBe("bd_origin");

  const mixed = buildCalibration(
    {
      ...diagnostics,
      targets: [
        ...structuredTargets,
        {
          name: "nation/legacy/population",
          target: 1,
          initial_estimate: 1,
          final_estimate: 1,
        },
      ],
    },
    "mixed-repeated-dimension-labels",
  );
  expect(mixed.target_schema.target_representation).toBe("mixed");
  expect(mixed.rows[0].target_dimensions).toEqual(cal.rows[0].target_dimensions);
});

test("mixed diagnostics dispatch complete legacy and structured rows independently", () => {
  const cal = buildCalibration(
    {
      targets: [
        {
          name: "bea_nipa.cy2023.proprietors_income.a041rc.amount@2024",
          source: "BEA citation",
          metadata: {
            chronicle_record_ids: ["bea.nipa.proprietors_income.amount"],
            source_measure_id: "amount",
            ledger_geography_level: "country",
          },
          target: 100,
          initial_estimate: 90,
          final_estimate: 99,
        },
        {
          name: "legacy.publisher.population.total@2026",
          source: {
            id: "artifact_agency",
            citation: "Official population table",
            label: "Artifact agency",
          },
          variable: {
            id: "resident_population",
            label: "Resident population",
            measure: "count",
          },
          dimensions: {},
          metadata: {
            chronicle_record_ids: ["chronicle_agency.population.total"],
            variable: "legacy_population",
          },
          target: 100,
          initial_estimate: 90,
          final_estimate: 100,
        },
      ],
    },
    "mixed-identities",
  );

  expect(cal.target_schema.target_representation).toBe("mixed");
  expect(cal.rows[0]).toMatchObject({
    source: "bea",
    variable: "amount",
    dimension_adapter: "legacy_name",
    target_representation: "legacy",
  });
  expect(cal.rows[1]).toMatchObject({
    source: "artifact_agency",
    source_label: "Artifact agency",
    source_citation: "Official population table",
    variable: "resident_population",
    variable_label: "Resident population",
    measure: "count",
    dimension_adapter: "structured",
    target_representation: "structured",
  });
});

test("structured source and variable fields remain authoritative", () => {
  const target = {
    name: "legacy.publisher.population.total@2026",
    source: {
      id: "artifact_agency",
      citation: "Official population table",
      label: "Row agency label",
      url: "https://stats.example/population",
    },
    variable: {
      id: "resident_population",
      label: "Resident population",
      measure: "mean",
    },
    dimensions: {},
    metadata: {
      chronicle_record_ids: ["chronicle_agency.population.total"],
      variable: "legacy_population",
      source_measure_id: "legacy_population_count",
    },
    target: 100,
    initial_estimate: 90,
    final_estimate: 100,
  };
  const cal = buildCalibration(
    { targets: [target] },
    "structured-identifiers",
    null,
    {},
    { publisher_labels: { artifact_agency: "Manifest agency label" } },
  );

  expect(cal.rows[0]).toMatchObject({
    source: "artifact_agency",
    source_label: "Manifest agency label",
    source_citation: "Official population table",
    source_url: "https://stats.example/population",
    variable: "resident_population",
    variable_label: "Resident population",
    measure: "mean",
    variable_key: "artifact_agency / resident_population · mean",
  });
  const response = latestMicrocosmTargetDiagnosticsPage(
    "http://x/api/microcosm/target-diagnostics",
    cal,
  );
  expect(response.targets[0]).toMatchObject({
    source_url: "https://stats.example/population",
    variable_label: "Resident population",
  });
  expect(response.variables[0].variable_label).toBe("Resident population");

  const withoutChronicle = buildCalibration(
    {
      targets: [
        {
          ...target,
          metadata: {
            variable: "legacy_population",
            source_measure_id: "legacy_population_count",
          },
        },
      ],
    },
    "structured-source-fallback",
  );
  expect(withoutChronicle.rows[0]).toMatchObject({
    source: "artifact_agency",
    source_label: "Row agency label",
  });
});

const BE_COUNTRY_DEFAULTS: ArtifactCountry = {
  code: "be",
  label: "Belgium",
  geography_id: null,
  geography_label: "Belgium",
  repository_visibility: "private",
  capabilities: ["calibration", "targets", "compare", "cross_dataset"],
};

test("releaseCountry falls back to the registration when the manifest has no country block", () => {
  expect(releaseCountry({}, "be")).toEqual(BE_COUNTRY_DEFAULTS);
  expect(releaseCountry({ country: "BE" }, "be")).toEqual(BE_COUNTRY_DEFAULTS);
  expect(releaseCountry({}, "us")).toEqual({
    code: "us",
    label: "United States",
    geography_id: "0100000US",
    geography_label: "United States",
    repository_visibility: "public",
    capabilities: [
      "calibration",
      "targets",
      "compare",
      "cross_dataset",
      "staging",
      "model_coverage",
      "pipeline",
      "variables",
      "external_checks",
    ],
  });
});

test("releaseCountry lets well-typed string fields override the registration", () => {
  expect(
    releaseCountry(
      {
        country: {
          code: "BE",
          label: "Kingdom of Belgium",
          geography_id: "BE",
          geography_label: "Belgium (national)",
          repository_visibility: "public",
          presentation: { ignored: true },
        },
      },
      "be",
    ),
  ).toEqual({
    ...BE_COUNTRY_DEFAULTS,
    label: "Kingdom of Belgium",
    geography_id: "BE",
    geography_label: "Belgium (national)",
    repository_visibility: "public",
  });
});

test("releaseCountry ignores a block whose code names another country", () => {
  expect(
    releaseCountry(
      { country: { code: "us", label: "United States", repository_visibility: "public" } },
      "be",
    ),
  ).toEqual(BE_COUNTRY_DEFAULTS);
  expect(releaseCountry({ country: { code: 7, label: "Seven" } }, "be")).toEqual(
    BE_COUNTRY_DEFAULTS,
  );
  // An explicit `code: null` is a present, malformed field — the whole block
  // is ignored, exactly like a mismatched code.
  expect(
    releaseCountry(
      { country: { code: null, label: "Wrong label", geography_label: "Wrong geography" } },
      "be",
    ),
  ).toEqual(BE_COUNTRY_DEFAULTS);
});

test("releaseCountry narrows capabilities to the registration and never widens them", () => {
  expect(
    releaseCountry(
      { country: { code: "be", capabilities: ["targets", "staging", "calibration", "bogus", 3] } },
      "be",
    ).capabilities,
  ).toEqual(["calibration", "targets"]);
  expect(releaseCountry({ country: { capabilities: [] } }, "be").capabilities).toEqual([]);
  expect(releaseCountry({ country: { capabilities: "all" } }, "be").capabilities).toEqual(
    BE_COUNTRY_DEFAULTS.capabilities,
  );
});

test("releaseCountry ignores malformed field values", () => {
  expect(
    releaseCountry(
      {
        country: {
          label: "",
          geography_label: 12,
          geography_id: { id: "x" },
          repository_visibility: "open",
        },
      },
      "be",
    ),
  ).toEqual(BE_COUNTRY_DEFAULTS);
});

test("the calibration summary and target page carry the typed country block", () => {
  const cal = buildCalibration(
    beDiagnosticsFixture,
    "be-country",
    null,
    {},
    { ...beReleaseManifestFixture, country: { code: "be", label: "Kingdom of Belgium" } },
    {},
    "be",
  );
  expect(cal.country_info).toEqual({ ...BE_COUNTRY_DEFAULTS, label: "Kingdom of Belgium" });
  expect(latestMicrocosmCalibrationSummary(cal).country).toEqual(cal.country_info);
  expect(
    latestMicrocosmTargetDiagnosticsPage("http://x/api/microcosm/target-diagnostics", cal).country,
  ).toEqual(cal.country_info);
});

test("the artifact's national geography label shapes rows without a geography", () => {
  const cal = buildCalibration(
    beDiagnosticsFixture,
    "be-geography",
    null,
    {},
    { ...beReleaseManifestFixture, country: { geography_label: "Belgium (national)" } },
    {},
    "be",
  );
  const national = cal.rows.filter((row) => row.level === "national");
  expect(national.length).toBeGreaterThan(0);
  expect(national.every((row) => row.geography === "Belgium (national)")).toBe(true);
  expect(cal.rows[0]).toMatchObject({ geography: "Brussels", level: "region" });
});

test("the target page reports scope target counts for the release", () => {
  expect(page("").scope_counts).toEqual({ healthcare: 0 });
  expect(page("?scope=healthcare").scope_counts).toEqual({ healthcare: 0 });
});
