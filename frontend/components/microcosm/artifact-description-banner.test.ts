import { expect, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { ArtifactDescriptionBanner } from "./artifact-description-banner";

test("renders artifact provenance as a quiet generic note", () => {
  const markup = renderToStaticMarkup(
    createElement(ArtifactDescriptionBanner, {
      description: "Producer-authored provenance.",
    }),
  );

  expect(markup).toContain('role="note"');
  expect(markup).toContain("Provenance");
  expect(markup).toContain("Producer-authored provenance.");
  expect(markup).toContain("border-border/80");
  expect(markup).not.toContain("var(--warn)");
});

test("renders nothing when the artifact has no description", () => {
  expect(
    renderToStaticMarkup(
      createElement(ArtifactDescriptionBanner, { description: "  " }),
    ),
  ).toBe("");
});
