import { expect, test } from "bun:test";
import { createElement, isValidElement, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import MicrocosmOverviewPage from "@/app/microcosm/page";
import MicrocosmTargetsPage from "@/app/microcosm/targets/page";
import { AppShell } from "@/components/layout/app-shell";
import { MicrocosmOverviewView } from "@/components/microcosm/microcosm-overview-view";
import { MicrocosmTargetsView } from "@/components/microcosm/microcosm-targets-view";

import { CountryNotConfiguredState } from "./country-not-configured";

test("an unknown country code reads as having no Microcosm release", () => {
  const markup = renderToStaticMarkup(
    createElement(CountryNotConfiguredState, { requested: "nz" }),
  );
  expect(markup).toContain("No Microcosm release for “nz”");
  expect(markup).toContain("no calibration release configured for the country code “nz”");
  expect(markup).not.toContain("United States");
});

test("a registered country without a published release is named", () => {
  const markup = renderToStaticMarkup(
    createElement(CountryNotConfiguredState, {
      requested: "be",
      reason: "no_published_release",
    }),
  );
  expect(markup).toContain("No published release for Belgium yet");
});

test("a long requested code is truncated in the page", () => {
  const markup = renderToStaticMarkup(
    createElement(CountryNotConfiguredState, { requested: "x".repeat(200) }),
  );
  expect(markup).toContain(`“${"x".repeat(32)}…”`);
  expect(markup).not.toContain("x".repeat(33));
});

type PageProps = { searchParams?: Promise<Record<string, string | string[] | undefined>> };

async function pageChild(
  page: (props: PageProps) => Promise<ReactElement>,
  searchParams: Record<string, string | string[] | undefined>,
): Promise<ReactElement<Record<string, unknown>>> {
  const element = await page({ searchParams: Promise.resolve(searchParams) });
  expect(element.type).toBe(AppShell);
  const child = (element.props as { children: unknown }).children;
  if (!isValidElement(child)) throw new Error("The page renders no element in its shell.");
  return child as ReactElement<Record<string, unknown>>;
}

for (const [name, page, view] of [
  ["overview", MicrocosmOverviewPage, MicrocosmOverviewView],
  ["targets", MicrocosmTargetsPage, MicrocosmTargetsView],
] as const) {
  test(`the ${name} page renders the not-configured state, not the US view, for ?country=nz`, async () => {
    const child = await pageChild(page, { country: "nz" });
    expect(child.type).toBe(CountryNotConfiguredState);
    expect(child.props.requested).toBe("nz");
  });

  test(`the ${name} page serves a configured country's own view`, async () => {
    const child = await pageChild(page, { country: "uk" });
    expect(child.type).toBe(view);
    expect(child.props.initialCountry).toBe("uk");
    const defaulted = await pageChild(page, {});
    expect(defaulted.type).toBe(view);
    expect(defaulted.props.initialCountry).toBe("us");
  });
}
