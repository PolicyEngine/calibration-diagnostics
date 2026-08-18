import { expect, test } from "bun:test";

import { microcosmSourceAttribution } from "./source-attribution";

test("links Microcosm to the public US Hugging Face dataset", () => {
  expect(microcosmSourceAttribution("us", "policyengine/populace-us")).toEqual({
    label: "Microcosm",
    href: "https://huggingface.co/datasets/policyengine/populace-us",
  });
});

test("does not expose the private UK Hugging Face dataset", () => {
  expect(microcosmSourceAttribution("uk", "policyengine/populace-uk-private")).toEqual({
    label: "Microcosm",
    href: null,
  });
});
