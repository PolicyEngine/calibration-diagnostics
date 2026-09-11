import { describe, expect, test } from "bun:test";

import {
  readHierarchyTarget,
  validateHierarchyTargets,
} from "./hierarchy-target-reader";

function row() {
  return {
    name: "obr.income_tax@2025",
    target_name: "obr.income_tax",
    hierarchy: {
      provider: { id: "obr", label: "Office for Budget Responsibility" },
      category: {
        id: "obr.efo_receipts",
        label: "Economic and fiscal outlook receipts",
        provider_id: "obr",
      },
      geography: {
        id: "K02000001",
        label: "United Kingdom",
        level: "country",
      },
      dimensions: [
        {
          id: "obr.efo_line",
          label: "Economic and fiscal outlook line",
          value_id: "income_tax",
          value_label: "Income tax (gross of tax credits)",
        },
      ],
      target: { id: "obr.income_tax", label: "Income tax receipts" },
    },
  };
}

describe("schema 8 hierarchy target reader", () => {
  test("preserves every producer identifier and label", () => {
    expect(readHierarchyTarget(row())).toEqual({
      source: "obr",
      sourceLabel: "Office for Budget Responsibility",
      variable: "obr.efo_receipts",
      variableLabel: "Economic and fiscal outlook receipts",
      geography: "United Kingdom",
      geographyId: "K02000001",
      level: "country",
      dimensions: [
        {
          key: "obr.efo_line",
          label: "Economic and fiscal outlook line",
          value: "Income tax (gross of tax credits)",
          value_id: "income_tax",
          source_key: "obr.efo_line",
          raw_value: "income_tax",
          rank: 0,
        },
      ],
      targetId: "obr.income_tax",
      targetLabel: "Income tax receipts",
      breakdown: "Income tax (gross of tax credits)",
    });
  });

  test("rejects missing labels and inconsistent relationships", () => {
    expect(() =>
      readHierarchyTarget({
        ...row(),
        hierarchy: { ...row().hierarchy, provider: { id: "obr" } },
      }),
    ).toThrow("hierarchy.provider.label");
    expect(() =>
      readHierarchyTarget({
        ...row(),
        hierarchy: {
          ...row().hierarchy,
          category: { ...row().hierarchy.category, provider_id: "hmrc" },
        },
      }),
    ).toThrow("expected obr");
    expect(() =>
      readHierarchyTarget({
        ...row(),
        hierarchy: { ...row().hierarchy, dimensions: {} },
      }),
    ).toThrow("dimensions must be an array");
    expect(() =>
      readHierarchyTarget({
        ...row(),
        hierarchy: {
          ...row().hierarchy,
          category: { ...row().hierarchy.category, label: "" },
        },
      }),
    ).toThrow("hierarchy.category.label");
    expect(() =>
      readHierarchyTarget({
        ...row(),
        hierarchy: {
          ...row().hierarchy,
          geography: { ...row().hierarchy.geography, label: "" },
        },
      }),
    ).toThrow("hierarchy.geography.label");
    expect(() =>
      readHierarchyTarget({
        ...row(),
        hierarchy: {
          ...row().hierarchy,
          dimensions: [{ ...row().hierarchy.dimensions[0], label: "" }],
        },
      }),
    ).toThrow("hierarchy.dimensions[0].label");
    expect(() =>
      readHierarchyTarget({
        ...row(),
        hierarchy: {
          ...row().hierarchy,
          dimensions: [{ ...row().hierarchy.dimensions[0], value_label: "" }],
        },
      }),
    ).toThrow("hierarchy.dimensions[0].value_label");
    expect(() =>
      readHierarchyTarget({
        ...row(),
        hierarchy: {
          ...row().hierarchy,
          target: { ...row().hierarchy.target, label: "" },
        },
      }),
    ).toThrow("hierarchy.target.label");
  });

  test("rejects conflicting labels for repeated ids across a file", () => {
    expect(() =>
      validateHierarchyTargets([
        row(),
        {
          ...row(),
          hierarchy: {
            ...row().hierarchy,
            provider: { id: "obr", label: "Conflicting OBR label" },
          },
        },
      ]),
    ).toThrow("provider obr has inconsistent labels");
  });

  test("rejects a category reused under a different provider", () => {
    const second = row();
    second.hierarchy.provider = { id: "hmrc", label: "HMRC" };
    second.hierarchy.category.provider_id = "hmrc";
    expect(() => validateHierarchyTargets([row(), second])).toThrow(
      "category obr.efo_receipts references inconsistent providers",
    );
  });

  test("rejects conflicting Chronicle-owned labels across rows", () => {
    const geography = row();
    geography.hierarchy.geography.label = "Conflicting geography";
    expect(() => validateHierarchyTargets([row(), geography])).toThrow(
      "geography country",
    );

    const dimension = row();
    dimension.hierarchy.dimensions[0].label = "Conflicting dimension";
    expect(() => validateHierarchyTargets([row(), dimension])).toThrow(
      "dimension obr.efo_line",
    );

    const dimensionValue = row();
    dimensionValue.hierarchy.dimensions[0].value_label = "Conflicting value";
    expect(() => validateHierarchyTargets([row(), dimensionValue])).toThrow(
      "dimension value obr.efo_line",
    );

    const target = row();
    target.hierarchy.target.label = "Conflicting target";
    expect(() => validateHierarchyTargets([row(), target])).toThrow(
      "target obr.income_tax",
    );
  });
});
