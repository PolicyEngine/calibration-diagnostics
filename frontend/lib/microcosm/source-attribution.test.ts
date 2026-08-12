import { expect, test } from "bun:test";

import { microcosmSourceAttribution } from "./source-attribution";

test("does not expose the private UK artifact repository as a dataset link", () => {
  expect(microcosmSourceAttribution("uk", "policyengine/populace-uk-private")).toEqual({
    label: "the selected Microcosm UK release",
    href: null,
  });
});

test("links the public US artifact repository", () => {
  expect(microcosmSourceAttribution("us", "policyengine/populace-us")).toEqual({
    label: "policyengine/populace-us",
    href: "https://huggingface.co/datasets/policyengine/populace-us",
  });
});
