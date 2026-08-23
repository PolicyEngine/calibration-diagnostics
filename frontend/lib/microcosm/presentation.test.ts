import { expect, test } from "bun:test";

import { microcosmOverviewIntro, microcosmTargetsIntro } from "./presentation";

test("artifact presentation takes precedence over legacy country copy", () => {
  const presentation = {
    overview_intro: "Artifact overview.",
    targets_intro: "Artifact target prompt.",
  };

  expect(microcosmOverviewIntro("us", presentation)).toBe("Artifact overview.");
  expect(microcosmTargetsIntro("us", presentation)).toBe("Artifact target prompt.");
});

test("legacy presentation copy remains the fallback for existing countries", () => {
  expect(microcosmOverviewIntro("us")).toBe(
    "Microcosm reweights survey microdata so it matches official statistics from agencies like the IRS, the Census Bureau, and CMS. Each tile in the Calibration fit explorer below is a category we calibrate to, including EITC statistics, population, and Medicaid enrollment.",
  );
  expect(microcosmTargetsIntro("us")).toBe(
    "Pick a measure like EITC, population, or AGI and see how each breakdown is calibrated.",
  );
});

test("unpublished countries receive the generic presentation copy", () => {
  expect(microcosmOverviewIntro("zz")).toBe(
    "Microcosm reweights survey microdata so it matches official statistics from national statistical agencies and administrative sources. Each tile in the Calibration fit explorer below is a category we calibrate to.",
  );
  expect(microcosmTargetsIntro("zz")).toBe(
    "Pick a measure and see how each breakdown is calibrated.",
  );
});
