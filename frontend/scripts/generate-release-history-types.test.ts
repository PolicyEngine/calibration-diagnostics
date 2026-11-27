import { expect, test } from "bun:test";
import { readFile, writeFile } from "node:fs/promises";

import { GENERATED_FILE, generateReleaseHistoryTypes, markAnyValue } from "./generate-release-history-types";

test("the release history document types are what the schemas generate", async () => {
  const text = await generateReleaseHistoryTypes();
  if (process.env.UPDATE_GENERATED) await writeFile(GENERATED_FILE, text);
  // Stale after a schema change: run `bun run scripts/generate-release-history-types.ts`.
  expect(await readFile(GENERATED_FILE, "utf8")).toBe(text);
});

test("a schema that only describes its value allows any value, wherever it is nested", () => {
  const marked = markAnyValue({
    type: "object",
    properties: {
      copied: { description: "Copied as the upstream document holds it." },
      // A property named after an annotation keyword is a field, not an annotation.
      description: { type: "string" },
      nested: { anyOf: [{ type: "null" }, { items: { title: "anything" } }] },
    },
    additionalProperties: { description: "any value" },
  });
  expect(marked).toEqual({
    type: "object",
    properties: {
      copied: { description: "Copied as the upstream document holds it.", tsType: "unknown" },
      description: { type: "string" },
      nested: { anyOf: [{ type: "null" }, { items: { title: "anything", tsType: "unknown" } }] },
    },
    additionalProperties: { description: "any value", tsType: "unknown" },
  });
});
