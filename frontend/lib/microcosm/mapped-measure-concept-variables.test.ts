import { expect, test } from "bun:test";
import { join } from "node:path";

import { MAPPED_MEASURE_CONCEPT_VARIABLES } from "@policyengine/calibration-tree/latest-artifact";

// The calibration-tree package carries the fallback table from Chronicle
// measure concepts to PolicyEngine US variables; the mappings file it must
// agree with belongs to this repository's PolicyEngine US integration, so the
// check stays here rather than in the package.
test("mapped measure concept variables match the PolicyEngine US mappings file", async () => {
  const mappingsPath = join(
    import.meta.dir,
    "../../../integrations/microcosm_policyengine_us/mappings.yaml",
  );
  const { mappings } = Bun.YAML.parse(await Bun.file(mappingsPath).text()) as {
    mappings: {
      chronicle_selector?: { measures?: string[] };
      execution?: string;
      source_expression?: string;
      required_variables?: string[];
    }[];
  };
  for (const [concept, variables] of Object.entries(MAPPED_MEASURE_CONCEPT_VARIABLES)) {
    const matches = mappings.filter((mapping) =>
      mapping.chronicle_selector?.measures?.includes(concept),
    );
    expect(matches.length).toBeGreaterThan(0);
    for (const mapping of matches) {
      expect(mapping.execution).toBe("model");
      expect([mapping.source_expression]).toEqual([...variables]);
      expect(mapping.required_variables).toEqual([...variables]);
    }
  }
});
