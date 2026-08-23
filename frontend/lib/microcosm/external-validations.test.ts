import { describe, expect, test } from "bun:test";

import diagnosticsFixture from "./fixtures/be-release/calibration_diagnostics.json";
import releaseManifestFixture from "./fixtures/be-release/release_manifest.json";
import {
  chroniclePublisher,
  shapeExternalValidations,
} from "./external-validations";

const DISCLAIMER =
  "Microcosm-BE: synthetic Belgian population calibrated to Belgian administrative and national-accounts targets (sums of Chronicle facts; surveys validation-only). Support records: US survey donor pool, reweighted; a Belgian donor pool is the planned upgrade. Cross-engine agreement is evidence about the encodings.";

describe("external validation shaping", () => {
  test("shapes the real BE EUROMOD headline without losing producer labels or zeroes", () => {
    const [validation] = shapeExternalValidations(releaseManifestFixture);

    expect(validation.key).toBe("euromod");
    expect(validation.comparator).toBe("EUROMOD BE_2025 (JRC), plain baseline run");
    expect(validation.description).toBe(
      "Cross-engine column ledger: every EUROMOD BE_2025 output column computed on this population by both EUROMOD and the Axiom rules engine, classified matched / explained (named mechanism) / gap (named owner). " +
        DISCLAIMER,
    );
    expect(validation.columnLedger).toMatchObject({
      totalColumns: 558,
      substantiveColumns: 182,
      matched: 10,
      explained: 143,
      gap: 29,
      unclassified: 0,
      toleranceEur: 0.01,
    });
    expect(validation.columnLedger?.keyRows).toEqual([
      {
        column: "tin_s",
        label: "income tax",
        euromodEur: 68393536598.46828,
        axiomEur: 68581762491.69119,
        deltaAxiomMinusEuromodEur: 188225893.22291565,
        classification: "GAP",
        explanationClass: "unencoded_corpus_blocked",
      },
      {
        column: "ils_origy",
        label: null,
        euromodEur: 236840063794.08032,
        axiomEur: 236840063794.08026,
        deltaAxiomMinusEuromodEur: -0.00006103515625,
        classification: "MATCHED",
        explanationClass: null,
      },
      {
        column: "bsa_s",
        label: "Income support",
        euromodEur: 20866361321.659664,
        axiomEur: 11063297817.463074,
        deltaAxiomMinusEuromodEur: -9803063504.19659,
        classification: "EXPLAINED",
        explanationClass: "population_basis_construct",
      },
    ]);
  });

  test("derives every validation-surface publisher from its first Chronicle id", () => {
    const [validation] = shapeExternalValidations(releaseManifestFixture);

    expect(validation.validationSurface.map((row) => row.publisher)).toEqual([
      "onem_rva",
      "jrc",
      "eurostat",
      "nbb",
    ]);
    expect(validation.validationSurface[0]).toEqual({
      name: "onem_complete_unemployment_recipients",
      concept: "complete-unemployment monthly-average recipients",
      value: 323029,
      year: 2024,
      role: "validation",
      chronicleRecordIds: [
        "onem_rva.unemployment.cy2024.complete_unemployment.country.country_total.receives_unemployment_benefit",
      ],
      publisher: "onem_rva",
    });
  });

  test("iterates arbitrary validator names and preserves their strings verbatim", () => {
    const [validation] = shapeExternalValidations({
      external_validations: {
        independent_engine: {
          comparator: "  Published comparator label  ",
          description: "Producer-authored description / classification labels.",
          column_ledger: {
            matched: 0,
            key_rows: [{ column: "x", classification: "Producer Label" }],
          },
        },
      },
    });

    expect(validation.key).toBe("independent_engine");
    expect(validation.comparator).toBe("  Published comparator label  ");
    expect(validation.description).toBe(
      "Producer-authored description / classification labels.",
    );
    expect(validation.columnLedger?.matched).toBe(0);
    expect(validation.columnLedger?.keyRows[0].classification).toBe("Producer Label");
  });

  test("degrades partial and malformed blocks to nullable fields and empty rows", () => {
    expect(shapeExternalValidations(null)).toEqual([]);
    expect(shapeExternalValidations({ external_validations: [] })).toEqual([]);
    expect(chroniclePublisher([null, " jrc.fact.id "])).toBe("jrc");

    expect(
      shapeExternalValidations({
        external_validations: {
          ignored: null,
          partial: {
            column_ledger: {
              matched: Number.NaN,
              unclassified: 0,
              key_rows: [null, { column: "" }, { column: "kept" }],
            },
            validation_surface: [42, { name: "" }, { name: "kept" }],
          },
        },
      }),
    ).toEqual([
      {
        key: "partial",
        comparator: null,
        description: null,
        columnLedger: {
          totalColumns: null,
          substantiveColumns: null,
          matched: null,
          explained: null,
          gap: null,
          unclassified: 0,
          toleranceEur: null,
          keyRows: [
            {
              column: "kept",
              label: null,
              euromodEur: null,
              axiomEur: null,
              deltaAxiomMinusEuromodEur: null,
              classification: null,
              explanationClass: null,
            },
          ],
        },
        validationSurface: [
          {
            name: "kept",
            concept: null,
            value: null,
            year: null,
            role: null,
            chronicleRecordIds: [],
            publisher: null,
          },
        ],
      },
    ]);
  });
});

test("trimmed BE fixture keeps representative targets and the exact demo disclaimer", () => {
  expect(diagnosticsFixture.targets).toHaveLength(3);
  expect(diagnosticsFixture.targets.map((row) => row.name)).toEqual([
    "statbel_population_be1_male_0_17@2026",
    "jrc_national_income_tax_amount@2023",
    "nasa_taxable_movable_income_analogue@2024",
  ]);
  expect(diagnosticsFixture.description).toBe(DISCLAIMER);
  expect(diagnosticsFixture.targets.every((row) => row.metadata.disclaimer === DISCLAIMER)).toBe(
    true,
  );
});
