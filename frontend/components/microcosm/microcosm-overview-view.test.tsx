import { expect, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { fmtLoss, MicrocosmReleaseHeader } from "./microcosm-overview-view";

test("formats calibration loss as a percentage", () => {
  expect(fmtLoss(0.015491)).toBe("1.55%");
  expect(fmtLoss(0)).toBe("0.00%");
  expect(fmtLoss(null)).toBe("—");
});

test("keeps the release selector available without selected release data", () => {
  const markup = renderToStaticMarkup(
    createElement(MicrocosmReleaseHeader, {
      country: "us",
      release: "unavailable-release",
      releaseOptions: [
        { value: "", label: "Latest" },
        { value: "unavailable-release", label: "Unavailable release" },
        { value: "working-release", label: "Working release" },
      ],
      onReleaseChange: () => {},
    }),
  );

  expect(markup).toContain("What the data is anchored to");
  expect(markup).toContain("Release:");
  expect(markup).toContain("Unavailable release");
  expect(markup).toContain("Working release");
  expect(markup).toContain(
    "Select a published Microcosm release to review its calibration fit.",
  );
  expect(markup).not.toContain("View on Hugging Face");
});
