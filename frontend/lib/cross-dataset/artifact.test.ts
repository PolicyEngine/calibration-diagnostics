import { createHash } from "node:crypto";

import { expect, test } from "bun:test";

import {
  ArtifactError,
  CrossDatasetArtifactReader,
  type CrossDatasetBundleManifest,
} from "./artifact";
import { crossDatasetApiResponse } from "./query";

const SCHEMA = "cross_dataset.frontend_bundle.v1";
const RUN_ID = "evaluation-test-run";
const SNAPSHOT_ID = "chronicle-test-snapshot";

function serialized(value: unknown): string {
  return `${JSON.stringify(value)}\n`;
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function fixture() {
  const summary = {
    schema_version: SCHEMA,
    run_id: RUN_ID,
    snapshot_id: SNAPSHOT_ID,
    fact_count: 3,
    matrix_complete: true,
    sources: [
      {
        source_id: "microcosm",
        label: "Microcosm + PolicyEngine-US",
        source_type: "model_dataset_pair",
        capability_count: 3,
        result_count: 2,
        score: { covered: 2, scored: 2, display_score: "95", loss: "0.1" },
        capability_statuses: { evaluable_direct: 2, unsupported_period: 1 },
        reason_codes: { period_not_supported: 1 },
        period_treatments: { native: 2, unsupported: 1 },
      },
      {
        source_id: "cps",
        label: "Public CPS + Tax-Calculator",
        source_type: "model_dataset_pair",
        capability_count: 3,
        result_count: 1,
        score: { covered: 1, scored: 1, display_score: "90", loss: "0.2" },
        capability_statuses: { evaluable_via_model: 1, unsupported_geography: 2 },
        reason_codes: { geography_not_supported: 2 },
        period_treatments: { advanced_population: 1, unsupported: 2 },
      },
    ],
  };
  const groups = {
    schema_version: SCHEMA,
    run_id: RUN_ID,
    snapshot_id: SNAPSHOT_ID,
    groups: [
      {
        dimension: "ledger_source",
        key: "irs_soi",
        label: "IRS SOI",
        fact_count: 2,
        sources: {
          microcosm: { evaluable: 1, scored: 1, display_score: "95", reason_codes: { period_not_supported: 1 } },
          cps: { evaluable: 1, scored: 1, display_score: "90", reason_codes: { geography_not_supported: 1 } },
        },
      },
      {
        dimension: "geography",
        key: "state",
        label: "State",
        fact_count: 1,
        sources: {
          microcosm: { evaluable: 1, scored: 1, display_score: "96", reason_codes: {} },
          cps: { evaluable: 0, scored: 0, display_score: null, reason_codes: { geography_not_supported: 1 } },
        },
      },
    ],
  };
  const pages = [
    {
      schema_version: SCHEMA,
      run_id: RUN_ID,
      snapshot_id: SNAPSHOT_ID,
      page: 1,
      page_size: 2,
      total: 3,
      rows: [
        {
          fact_key: "fact-a",
          label: "National AGI",
          ledger_source: "irs_soi",
          measure: "adjusted_gross_income",
          unit: "usd",
          observed_period: "tax_year:2024",
          observed_value: "100",
          geography_level: "country",
          geography_id: "0100000US",
          entity: "tax_unit",
          dimensions: { filing_status: "all" },
          sources: {
            microcosm: { status: "evaluable_direct", period_treatment: "native", calibration_exposure: "external_validation", estimate: "101", absolute_relative_error: "0.01" },
            cps: { status: "evaluable_via_model", period_treatment: "advanced_population", calibration_exposure: "external_validation", estimate: "90", absolute_relative_error: "0.1" },
          },
        },
        {
          fact_key: "fact-b",
          label: "State population",
          ledger_source: "census_acs",
          measure: "population",
          unit: "count",
          observed_period: "calendar_year:2024",
          observed_value: "200",
          geography_level: "state",
          geography_id: "0400000US06",
          entity: "person",
          dimensions: {},
          sources: {
            microcosm: { status: "evaluable_direct", estimate: "198", absolute_relative_error: "0.02" },
            cps: { status: "unsupported_geography", reason_code: "geography_not_supported" },
          },
        },
      ],
    },
    {
      schema_version: SCHEMA,
      run_id: RUN_ID,
      snapshot_id: SNAPSHOT_ID,
      page: 2,
      page_size: 2,
      total: 3,
      rows: [
        {
          fact_key: "fact-c",
          label: "Historic dividends",
          ledger_source: "irs_soi",
          measure: "ordinary_dividends",
          unit: "usd",
          observed_period: "tax_year:2023",
          observed_value: "300",
          geography_level: "country",
          geography_id: "0100000US",
          entity: "tax_unit",
          dimensions: {},
          sources: {
            microcosm: { status: "unsupported_period", reason_code: "period_not_supported" },
            cps: { status: "unsupported_geography", reason_code: "geography_not_supported" },
          },
        },
      ],
    },
  ];
  const index = {
    schema_version: SCHEMA,
    run_id: RUN_ID,
    snapshot_id: SNAPSHOT_ID,
    facts: { "fact-a": 1, "fact-b": 1, "fact-c": 2 },
    facets: {
      ledger_source: { irs_soi: [1, 2], census_acs: [1] },
      measure: {
        adjusted_gross_income: [1],
        population: [1],
        ordinary_dividends: [2],
      },
      period: { "tax_year:2024": [1], "calendar_year:2024": [1], "tax_year:2023": [2] },
      geography: { country: [1, 2], state: [1] },
      source_status: {
        microcosm: { evaluable_direct: [1], unsupported_period: [2] },
        cps: { evaluable_via_model: [1], unsupported_geography: [1, 2] },
      },
      source_period_treatment: {
        microcosm: { native: [1], unsupported: [2] },
        cps: { advanced_population: [1], unsupported: [1, 2] },
      },
      source_calibration_exposure: {
        microcosm: { external_validation: [1], unknown_exposure: [2] },
        cps: { external_validation: [1], unknown_exposure: [1, 2] },
      },
    },
  };

  const files: Record<string, string> = {
    "summary.json": serialized(summary),
    "groups.json": serialized(groups),
    "fact-index.json": serialized(index),
    "facts/00001.json": serialized(pages[0]),
    "facts/00002.json": serialized(pages[1]),
  };
  const manifest: CrossDatasetBundleManifest = {
    schema_version: SCHEMA,
    run_id: RUN_ID,
    snapshot_id: SNAPSHOT_ID,
    fact_count: 3,
    source_ids: ["microcosm", "cps"],
    page_size: 2,
    page_count: 2,
    partitions: {
      summary: { path: "summary.json", sha256: sha256(files["summary.json"]) },
      groups: { path: "groups.json", sha256: sha256(files["groups.json"]) },
      fact_index: { path: "fact-index.json", sha256: sha256(files["fact-index.json"]) },
      facts: pages.map((page, index) => ({
        page: index + 1,
        path: `facts/${String(index + 1).padStart(5, "0")}.json`,
        count: page.rows.length,
        sha256: sha256(files[`facts/${String(index + 1).padStart(5, "0")}.json`]),
      })),
    },
  };
  files["manifest.json"] = serialized(manifest);
  const reads: string[] = [];
  const reader = new CrossDatasetArtifactReader({
    expectedRunId: RUN_ID,
    readText: async (path) => {
      reads.push(path);
      const value = files[path];
      if (value == null) throw Object.assign(new Error(`missing ${path}`), { code: "ENOENT" });
      return value;
    },
  });
  return { files, reads, reader };
}

test("summary validates immutable IDs and keeps score beside coverage", async () => {
  const { reader } = fixture();
  const summary = await reader.summary();
  expect(summary.run_id).toBe(RUN_ID);
  expect(summary.fact_count).toBe(3);
  expect(summary.sources[1].label).toBe("Public CPS + Tax-Calculator");
  expect(summary.sources[1].result_count).toBe(1);
  expect(summary.sources[1].score.display_score).toBe("90");
});

test("group and source responses filter without loading fact pages", async () => {
  const { reader, reads } = fixture();
  const groups = await crossDatasetApiResponse(
    "http://example.test/api?view=groups&dimension=geography&source=cps",
    reader,
  );
  expect(groups.status).toBe(200);
  expect((groups.body as { groups: unknown[] }).groups).toHaveLength(1);
  expect(JSON.stringify(groups.body)).not.toContain("microcosm");

  const source = await crossDatasetApiResponse(
    "http://example.test/api?view=source&source=cps",
    reader,
  );
  expect(source.status).toBe(200);
  expect((source.body as { source: { result_count: number } }).source.result_count).toBe(1);
  expect(reads.some((path) => path.startsWith("facts/"))).toBe(false);
});

test("facts paginate and support source/status and catalog filters", async () => {
  const { reader, reads } = fixture();
  const unfiltered = await crossDatasetApiResponse(
    "http://example.test/api?view=facts&page=2&page_size=2",
    reader,
  );
  expect(unfiltered.status).toBe(200);
  expect((unfiltered.body as { rows: { fact_key: string }[] }).rows[0].fact_key).toBe("fact-c");
  reads.length = 0;

  const filtered = await crossDatasetApiResponse(
    "http://example.test/api?view=facts&source=cps&status=evaluable_via_model&period_treatment=advanced_population&calibration_exposure=external_validation&ledger_source=irs_soi&search=agi",
    reader,
  );
  expect(filtered.status).toBe(200);
  const body = filtered.body as { total: number; rows: { fact_key: string }[] };
  expect(body.total).toBe(1);
  expect(body.rows[0].fact_key).toBe("fact-a");
  expect(reads).not.toContain("facts/00002.json");
});

test("source selection alone keeps direct partition pagination", async () => {
  const { reader, reads } = fixture();
  const page = await reader.facts({ source: "cps", page: 1, pageSize: 2 });
  expect(page.total).toBe(3);
  expect(page.rows).toHaveLength(2);
  expect(reads).toContain("facts/00001.json");
  expect(reads).not.toContain("fact-index.json");
  expect(reads).not.toContain("facts/00002.json");
});

test("fact catalog sorting is stable and invalid sort values fail closed", async () => {
  const sorted = fixture();
  const response = await crossDatasetApiResponse(
    "http://example.test/api?view=facts&source=microcosm&status=evaluable_direct&sort=error_desc",
    sorted.reader,
  );
  expect(response.status).toBe(200);
  expect(
    (response.body as { rows: { fact_key: string }[] }).rows.map((row) => row.fact_key),
  ).toEqual(["fact-b", "fact-a"]);

  const invalid = fixture();
  expect(
    (
      await crossDatasetApiResponse(
        "http://example.test/api?view=facts&sort=drop_table",
        invalid.reader,
      )
    ).status,
  ).toBe(400);
});

test("fact detail reads only its indexed partition and preserves sparse cells", async () => {
  const { reader, reads } = fixture();
  const response = await crossDatasetApiResponse(
    "http://example.test/api?view=fact&fact_key=fact-b",
    reader,
  );
  expect(response.status).toBe(200);
  const fact = (response.body as { fact: { sources: Record<string, { status: string; reason_code?: string }> } }).fact;
  expect(fact.sources.microcosm.status).toBe("evaluable_direct");
  expect(fact.sources.cps).toEqual({
    status: "unsupported_geography",
    reason_code: "geography_not_supported",
  });
  expect(reads).toContain("fact-index.json");
  expect(reads).toContain("facts/00001.json");
  expect(reads).not.toContain("facts/00002.json");
});

test("missing query inputs and unknown records return stable client errors", async () => {
  const { reader } = fixture();
  expect((await crossDatasetApiResponse("http://x/api?view=source", reader)).status).toBe(400);
  expect((await crossDatasetApiResponse("http://x/api?view=fact", reader)).status).toBe(400);
  expect((await crossDatasetApiResponse("http://x/api?view=source&source=nope", reader)).status).toBe(404);
  expect((await crossDatasetApiResponse("http://x/api?view=fact&fact_key=nope", reader)).status).toBe(404);
  expect((await crossDatasetApiResponse("http://x/api?view=facts&page_size=1000", reader)).status).toBe(400);
});

test("stale, malformed, partial, and hash-mismatched bundles fail closed", async () => {
  const stale = fixture();
  const staleReader = new CrossDatasetArtifactReader({
    expectedRunId: "another-run",
    readText: async (path) => stale.files[path],
  });
  await expect(staleReader.summary()).rejects.toMatchObject({ code: "stale_artifact" });

  const malformed = fixture();
  malformed.files["manifest.json"] = serialized({ schema_version: "wrong" });
  await expect(malformed.reader.summary()).rejects.toBeInstanceOf(ArtifactError);

  const partial = fixture();
  delete partial.files["facts/00002.json"];
  await expect(partial.reader.facts({ page: 2, pageSize: 2 })).rejects.toMatchObject({
    code: "partial_artifact",
  });

  const tampered = fixture();
  tampered.files["summary.json"] = serialized({ tampered: true });
  await expect(tampered.reader.summary()).rejects.toMatchObject({ code: "hash_mismatch" });
});
