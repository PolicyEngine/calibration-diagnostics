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

test("links a build in its own folder to that folder at its pinned commit", () => {
  // A build folder has no tag of its own: `/tree/<release>%2F<build>` would
  // name a revision that does not exist.
  const commitSha = "0123456789abcdef0123456789abcdef01234567";
  const buildFolder =
    "microcosm-uk-2024-25-national/uk-frs-calibration-attempt-20261019T083323Z-6cba5d71";
  expect(
    microcosmPublicationUrl("policyengine/populace-uk-private", buildFolder, commitSha),
  ).toBe(
    "https://huggingface.co/datasets/policyengine/populace-uk-private/tree/" +
      `${commitSha}/releases/${buildFolder}`,
  );
  // A tagged release still opens at its tag.
  expect(
    microcosmPublicationUrl(
      "policyengine/populace-uk-private",
      "microcosm-uk-2024-25-national-20261019T083323Z-6cba5d71",
      commitSha,
    ),
  ).toBe(
    "https://huggingface.co/datasets/policyengine/populace-uk-private/tree/" +
      "microcosm-uk-2024-25-national-20261019T083323Z-6cba5d71",
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

test("the release artifact's repository visibility overrides the registration", () => {
  expect(
    microcosmSourceAttribution("be", "policyengine/populace-be", "public"),
  ).toEqual({
    label: "Microcosm",
    href: "https://huggingface.co/datasets/policyengine/populace-be",
  });
  expect(
    microcosmSourceAttribution("us", "policyengine/populace-us", "private"),
  ).toEqual({
    label: "Microcosm",
    href: null,
  });
  expect(microcosmSourceAttribution("us", "policyengine/populace-us", undefined)).toEqual({
    label: "Microcosm",
    href: "https://huggingface.co/datasets/policyengine/populace-us",
  });
});
