import { fileURLToPath } from "node:url";

import { expect, test } from "bun:test";

import { GET } from "./route";

const ENV_KEYS = [
  "CROSS_DATASET_ARTIFACT_DIR",
  "CROSS_DATASET_ARTIFACT_BASE_URL",
  "CROSS_DATASET_EXPECTED_RUN_ID",
  "CROSS_DATASET_ARTIFACT_DIR_BE",
  "CROSS_DATASET_ARTIFACT_BASE_URL_BE",
  "CROSS_DATASET_EXPECTED_RUN_ID_BE",
] as const;
const BELGIUM_FIXTURE_DIRECTORY = fileURLToPath(
  new URL("../../../../lib/cross-dataset/fixtures/be-frontend-bundle/", import.meta.url),
);

test("threads country to the configured Cross-dataset reader", async () => {
  const previousEnvironment = Object.fromEntries(
    ENV_KEYS.map((key) => [key, process.env[key]]),
  ) as Record<(typeof ENV_KEYS)[number], string | undefined>;

  try {
    for (const key of ENV_KEYS) delete process.env[key];
    process.env.CROSS_DATASET_ARTIFACT_DIR_BE = BELGIUM_FIXTURE_DIRECTORY;

    const belgiumResponse = await GET(
      new Request("http://example.test/api/microcosm/cross-dataset?view=summary&country=be"),
    );
    expect(belgiumResponse.status).toBe(200);
    expect(await belgiumResponse.json()).toMatchObject({
      jurisdictions: ["BE"],
      fact_count: 726,
      sources: [
        { label: "EUROMOD BE_2025 on EU-SILC (JRC country report 2025)" },
        { label: "Microcosm-BE v0.4 × Axiom rules engine" },
        { label: "Microcosm-BE v0.4 × EUROMOD BE_2025" },
      ],
    });

    for (const url of [
      "http://example.test/api/microcosm/cross-dataset?view=summary",
      "http://example.test/api/microcosm/cross-dataset?view=summary&country=us",
    ]) {
      const response = await GET(new Request(url));
      expect(response.status).toBe(503);
      expect(await response.json()).toMatchObject({ artifact_error: "partial_artifact" });
    }
  } finally {
    for (const key of ENV_KEYS) {
      const value = previousEnvironment[key];
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});
