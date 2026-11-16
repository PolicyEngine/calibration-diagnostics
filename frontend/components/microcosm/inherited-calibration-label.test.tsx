import { expect, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { InheritedCalibrationLabel } from "@/components/microcosm/inherited-calibration-label";
import { buildProgressHref } from "@/lib/microcosm/inherited-calibration";

const PARENT_BUILD = "populace-us-2024-b5db384-8b0c1950b65f-20261024T083103Z";

// The links in rendered markup, with the attribute escaping undone.
function linkTargets(markup: string): string[] {
  return [...markup.matchAll(/<a\b[^>]*\bhref="([^"]*)"/g)].map((match) =>
    match[1].replaceAll("&amp;", "&"),
  );
}

test("the calibration map names the parent build and links to the parent's build progress", () => {
  const href = buildProgressHref("us", PARENT_BUILD);
  const markup = renderToStaticMarkup(
    createElement(InheritedCalibrationLabel, {
      parentBuildId: PARENT_BUILD,
      buildProgressHref: href,
    }),
  );

  expect(markup).toContain("Calibration inherited from parent build");
  expect(markup).toContain(PARENT_BUILD);
  expect(markup).toContain("Build progress");
  expect(linkTargets(markup)).toEqual([href]);
});

test("without a staging run for the parent, the map names the parent with no build progress link", () => {
  const markup = renderToStaticMarkup(
    createElement(InheritedCalibrationLabel, {
      parentBuildId: PARENT_BUILD,
      buildProgressHref: null,
    }),
  );

  expect(markup).toContain("Calibration inherited from parent build");
  expect(markup).toContain(PARENT_BUILD);
  expect(markup).not.toContain("Build progress");
  expect(linkTargets(markup)).toEqual([]);
});
