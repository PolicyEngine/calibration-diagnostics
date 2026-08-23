import { describe, expect, test } from "bun:test";

import { isCountry as isClientCountry } from "@/components/layout/country-context";
import { navGroupsForCountry } from "@/components/layout/nav-items";
import { countryCapabilities, selectableCountries } from "@/lib/microcosm/countries";
import { sourceAuthorityLabel } from "@/lib/source-labels";

import diagnosticsFixture from "./fixtures/zz-release/calibration_diagnostics.json";
import releaseManifestFixture from "./fixtures/zz-release/release_manifest.json";
import {
  buildCalibration,
  hfResolveUrl,
  latestMicrocosmCalibrationHighlights,
  latestMicrocosmCalibrationSummary,
  latestMicrocosmTargetDiagnosticsPage,
  microcosmRepo,
  microcosmRevision,
  microcosmTargetTreemap,
  parseCountry,
} from "./latest-artifact";

const COUNTRY = "zz" as const;
const RELEASE_ID = "microcosm-zz-2026-conformance";
const DESCRIPTION =
  "Synthetic ZZ release whose dashboard presentation comes from release artifacts.";
const PUBLISHER = "novastat_agency";

// Registration-only contract: production presentation/parsing code must not
// gain a `zz` branch or table entry to make these data-shape assertions pass.
const calibration = buildCalibration(
  diagnosticsFixture,
  RELEASE_ID,
  "2026-08-23T18:00:00Z",
  {},
  releaseManifestFixture,
  {},
  COUNTRY,
);

describe("synthetic third-country conformance", () => {
  test("one country registration supplies repository, national geography, and country block behavior", () => {
    expect(parseCountry(COUNTRY)).toBe(COUNTRY);
    expect(microcosmRepo(COUNTRY)).toBe("policyengine/microcosm-zz-fixture");
    expect(microcosmRevision(COUNTRY)).toBe("main");
    expect(hfResolveUrl("latest.json", COUNTRY)).toBe(
      "https://huggingface.co/datasets/policyengine/microcosm-zz-fixture/resolve/main/latest.json",
    );

    const nationalTarget = calibration.rows.find(
      (row) => row.base_name === "fixture_revenue_personal_income_tax",
    );
    expect(nationalTarget).toMatchObject({
      geography: "Zedland",
      level: "national",
    });

    // The summary's typed country block comes from the registration alone.
    expect(latestMicrocosmCalibrationSummary(calibration).country).toEqual({
      code: COUNTRY,
      label: "Zedland",
      geography_id: null,
      geography_label: "Zedland",
      repository_visibility: "private",
      capabilities: [...countryCapabilities(COUNTRY)],
    });

    // A release_manifest.country block overrides the registration's labels and
    // flows through buildCalibration into the summary and the row geography.
    const overridden = buildCalibration(
      diagnosticsFixture,
      RELEASE_ID,
      "2026-08-23T18:00:00Z",
      {},
      {
        ...releaseManifestFixture,
        country: {
          code: "zz",
          label: "Republic of Zedland",
          geography_label: "Zedland (national)",
        },
      },
      {},
      COUNTRY,
    );
    expect(latestMicrocosmCalibrationSummary(overridden).country).toMatchObject({
      code: COUNTRY,
      label: "Republic of Zedland",
      geography_label: "Zedland (national)",
      capabilities: [...countryCapabilities(COUNTRY)],
    });
    const overriddenPage = latestMicrocosmTargetDiagnosticsPage(
      "http://x/api/microcosm/target-diagnostics?level=national",
      overridden,
    );
    expect(overriddenPage.country?.label).toBe("Republic of Zedland");
    expect(overriddenPage.targets.map((row) => row.geography)).toEqual(["Zedland (national)"]);
    expect(
      overridden.rows.find((row) => row.base_name === "fixture_revenue_personal_income_tax"),
    ).toMatchObject({ geography: "Zedland (national)", level: "national" });
    expect(
      overridden.rows
        .filter((row) => row.level === "region")
        .map((row) => row.geography)
        .sort(),
    ).toEqual(["North", "North", "South"]);
  });

  test("release artifacts produce the common overview response shape", () => {
    const overview = latestMicrocosmCalibrationSummary(calibration);
    const highlights = latestMicrocosmCalibrationHighlights(calibration);

    expect(overview).toMatchObject({
      available: true,
      description: DESCRIPTION,
      diagnostics_status: "ok",
      is_default: true,
      release_id: RELEASE_ID,
      total_targets: 4,
      included_target_count: 4,
      within_tolerance_count: 3,
      fraction_within_10pct: 0.75,
    });
    expect(overview.family_fit).toHaveLength(2);
    expect(highlights.worst_bounded_relative_fit).toHaveLength(4);
    expect(highlights.extreme_relative_outlier_count).toBe(0);
  });

  test("Chronicle publisher prefixes drive source keys and readable labels", () => {
    expect(calibration.rows.every((row) => row.source === PUBLISHER)).toBe(true);
    expect(sourceAuthorityLabel(PUBLISHER)).toBe("Novastat Agency");

    const treemap = microcosmTargetTreemap(
      calibration.rows,
      calibration.release_id,
      "program",
      false,
    );
    expect(treemap.groups).toEqual([
      expect.objectContaining({
        source: PUBLISHER,
        label: "Novastat Agency",
        n_targets: 4,
      }),
    ]);
  });

  test("filter-coded targets produce generic region, sex, and age-band facets", () => {
    const variableKey = `${PUBLISHER} / population · count`;
    const page = latestMicrocosmTargetDiagnosticsPage(
      `http://x/api/microcosm/target-diagnostics?variable=${encodeURIComponent(variableKey)}`,
      calibration,
    );

    expect(page).toMatchObject({
      available: true,
      description: DESCRIPTION,
      diagnostics_status: "ok",
      release_id: RELEASE_ID,
      sources: [PUBLISHER],
      filtered_total: 3,
      returned: 3,
    });
    expect(page.dimensions).toEqual([
      { key: "geography", label: "Region", values: ["North", "South"] },
      { key: "bd_sex", label: "Sex", values: ["Female", "Male"] },
      { key: "bd_age_band", label: "Age band", values: ["0–17", "18–64", "65+"] },
    ]);
    expect(page.targets).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          source: PUBLISHER,
          source_citation: "ZZ official population table",
          variable: "population",
          geography: "North",
          level: "region",
          target_dimensions: expect.arrayContaining([
            expect.objectContaining({
              key: "bd_sex",
              label: "Sex",
              value: "Female",
              source_key: "filter",
              raw_value: "female",
            }),
            expect.objectContaining({
              key: "bd_age_band",
              label: "Age band",
              value: "0–17",
              source_key: "filter",
              raw_value: "0_17",
            }),
          ]),
        }),
      ]),
    );
  });

  test("zz can enter the shared client views through the registry without being selectable", () => {
    expect(isClientCountry(COUNTRY)).toBe(true);
    expect(selectableCountries()).not.toContain(COUNTRY);
    // Navigation is gated by the registration's capabilities, not a country code.
    expect(
      navGroupsForCountry(COUNTRY)
        .flatMap((group) => group.items)
        .map((item) => item.href),
    ).toEqual(["/microcosm", "/microcosm/targets", "/microcosm/compare"]);
  });
  test(
    "zz overview data can carry artifact-provided intro copy: the summary omits a typed presentation contract",
    () => {
      const presentation = {
        overview_intro: "Zedland overview copy from the release artifact.",
        targets_intro: "Zedland target-browser copy from the release artifact.",
      };
      const futureCalibration = buildCalibration(
        diagnosticsFixture,
        RELEASE_ID,
        "2026-08-23T18:00:00Z",
        {},
        { ...releaseManifestFixture, presentation },
        {},
        COUNTRY,
      );
      const overview = latestMicrocosmCalibrationSummary(futureCalibration) as {
        presentation?: typeof presentation;
      };

      expect(overview.presentation).toEqual(presentation);
    },
  );
  test.todo(
    "zz can override a publisher display name: treemap shaping ignores release_manifest.publisher_labels",
    () => {
      const futureCalibration = buildCalibration(
        diagnosticsFixture,
        RELEASE_ID,
        "2026-08-23T18:00:00Z",
        {},
        {
          ...releaseManifestFixture,
          publisher_labels: { [PUBLISHER]: "Nova Statistics Agency" },
        },
        {},
        COUNTRY,
      );
      const treemap = microcosmTargetTreemap(
        futureCalibration.rows,
        futureCalibration.release_id,
        "program",
        false,
      );

      expect(treemap.groups[0]?.label).toBe("Nova Statistics Agency");
    },
  );
  test.todo(
    "zz can supply structured facets: target shaping ignores calibration_diagnostics dimensions blocks",
    () => {
      const facetValues = [
        { region: "north", sex: "female", age_band: "0_17" },
        { region: "south", sex: "male", age_band: "18_64" },
        { region: "north", sex: "male", age_band: "65_plus" },
      ];
      const futureDiagnostics = {
        ...diagnosticsFixture,
        dimensions: {
          region: {
            label: "Region",
            role: "geography",
            level: "region",
            values: { north: "North", south: "South" },
          },
          sex: {
            label: "Sex",
            values: { female: "Female", male: "Male" },
          },
          age_band: {
            label: "Age band",
            values: { "0_17": "0–17", "18_64": "18–64", "65_plus": "65+" },
          },
        },
        targets: diagnosticsFixture.targets.map((target, index) =>
          index < facetValues.length
            ? { ...target, filter: null, dimensions: facetValues[index] }
            : target,
        ),
      };
      const futureCalibration = buildCalibration(
        futureDiagnostics,
        RELEASE_ID,
        "2026-08-23T18:00:00Z",
        {},
        releaseManifestFixture,
        {},
        COUNTRY,
      );
      const page = latestMicrocosmTargetDiagnosticsPage(
        `http://x/api/microcosm/target-diagnostics?variable=${encodeURIComponent(`${PUBLISHER} / population · count`)}`,
        futureCalibration,
      );

      expect(page.dimensions).toEqual([
        { key: "geography", label: "Region", values: ["North", "South"] },
        { key: "bd_sex", label: "Sex", values: ["Female", "Male"] },
        { key: "bd_age_band", label: "Age band", values: ["0–17", "18–64", "65+"] },
      ]);
    },
  );
});
