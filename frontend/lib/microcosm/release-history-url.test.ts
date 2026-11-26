import { expect, test } from "bun:test";

import { releaseHistoryUrlState, withReleaseHistoryState } from "./release-history-url";

const PAGE = "https://dashboard.example/calibration/dashboard/microcosm/release-history";

test("a bare URL is the default view: the default panel, the first output, Relative, no step", () => {
  expect(releaseHistoryUrlState(new URLSearchParams("country=uk"))).toEqual({
    panel: null,
    output: null,
    period: null,
    scale: "relative",
    step: null,
    moved: "headline",
  });
});

test("the URL names the engine's panel, the output, the scale and the open step", () => {
  const search = new URLSearchParams({
    country: "uk",
    panel: "a".repeat(64),
    output: "baseline/income_tax",
    period: "2027",
    scale: "absolute",
    step: "microcosm-uk-2024-25-national/attempt-20261107T020434Z-eeb6093e",
    moved: "all",
  });
  expect(releaseHistoryUrlState(search)).toEqual({
    panel: "a".repeat(64),
    output: "baseline/income_tax",
    period: 2027,
    scale: "absolute",
    step: "microcosm-uk-2024-25-national/attempt-20261107T020434Z-eeb6093e",
    moved: "all",
  });
  // Anything else for the scale, the scope or the period is the default.
  expect(releaseHistoryUrlState(new URLSearchParams("scale=log&moved=some&period=soon&panel=%20"))).toMatchObject({
    panel: null,
    period: null,
    scale: "relative",
    moved: "headline",
  });
});

test("writing the state keeps every other parameter and leaves the defaults out", () => {
  const chosen = withReleaseHistoryState(`${PAGE}?country=uk&utm=x`, {
    output: "reform/basic_rate_plus_1p/budgetary_impact",
    scale: "absolute",
    step: "line/build-1",
  });
  const url = new URL(chosen);
  expect(url.searchParams.get("country")).toBe("uk");
  expect(url.searchParams.get("utm")).toBe("x");
  expect(releaseHistoryUrlState(url.searchParams)).toMatchObject({
    output: "reform/basic_rate_plus_1p/budgetary_impact",
    scale: "absolute",
    step: "line/build-1",
  });
  // Back to the defaults: the parameters go.
  const cleared = withReleaseHistoryState(chosen, { output: null, scale: "relative", step: null });
  expect(cleared).toBe(`${PAGE}?country=uk&utm=x`);
  // One part changes; the rest stays as the URL had it.
  const panel = withReleaseHistoryState(chosen, { panel: "b".repeat(64) });
  expect(releaseHistoryUrlState(new URL(panel).searchParams)).toMatchObject({
    panel: "b".repeat(64),
    output: "reform/basic_rate_plus_1p/budgetary_impact",
    scale: "absolute",
  });
});
