import { expect, test } from "bun:test";

import {
  microcosmPublicationUrl,
  microcosmSourceAttribution,
} from "./source-attribution";

test("links a Microcosm release to its exact Hugging Face tag", () => {
  expect(
    microcosmPublicationUrl(
      "policyengine/populace-us",
      "populace-us-2024-buildp-sparse-rmloss100-cae8640-20260728T011454Z",
    ),
  ).toBe(
    "https://huggingface.co/datasets/policyengine/populace-us/tree/populace-us-2024-buildp-sparse-rmloss100-cae8640-20260728T011454Z",
  );
});

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

test("does not expose the private Belgium Hugging Face dataset", () => {
  expect(microcosmSourceAttribution("be", "policyengine/populace-be-private")).toEqual({
    label: "Microcosm",
    href: null,
  });
});
