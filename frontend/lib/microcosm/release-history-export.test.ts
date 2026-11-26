import { expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

import {
  TIMELINE_CSV_COLUMNS,
  timelineCsv,
  timelineCsvFileName,
  timelineCsvRows,
} from "./release-history-export";
import type { Timeline } from "./release-history-store";
import { readCountryFixture } from "./test-support/release-history-fixture-store";

const PRODUCER_EXPORT = join(
  import.meta.dir, "..", "..", "..", "release_history", "src", "release_history", "export.py",
);

test("the table has the columns of the producer's export command", async () => {
  const source = await readFile(PRODUCER_EXPORT, "utf8");
  const block = /TIMELINE_COLUMNS = \[([^\]]*)\]/.exec(source)?.[1] ?? "";
  const columns = [...block.matchAll(/"([a-z_]+)"/g)].map((match) => match[1]);
  expect(columns.length).toBeGreaterThan(0);
  expect([...TIMELINE_CSV_COLUMNS] as string[]).toEqual(columns);
});

test("one row per build and output, with the step and the official reference", async () => {
  const { timeline } = await readCountryFixture("uk");
  const rows = timelineCsvRows(timeline);
  expect(rows).toHaveLength(timeline.builds.length * timeline.outputs.length);
  const row = rows.find((candidate) =>
    candidate.output === "baseline/income_tax" && String(candidate.build_id).endsWith("synthetic-build-3"))!;
  const output = timeline.outputs.find((candidate) => candidate.output === "baseline/income_tax")!;
  const value = output.values.find((candidate) => candidate.buildId === row.build_id)!;
  expect(row).toMatchObject({
    published_at: "2026-10-24T09:00:00+00:00",
    current: true,
    withdrawn: false,
    state: "measured",
    period: 2026,
    unit: "currency",
    value: value.value,
    status: "ok",
    compared_with: "microcosm-uk-2024-25-national/synthetic-build-2",
    change: value.change,
    relative_change: value.relativeChange,
    change_status: "ok",
    reference_status: "resolved",
    reference_value: output.reference?.modelSignValue,
    reference_basis: "forecast",
  });
  // The second build publishes the first one's file.
  expect(rows.find((candidate) => String(candidate.build_id).endsWith("synthetic-build-2"))).toMatchObject({
    same_file_as: "microcosm-uk-2024-25-national/synthetic-build-1",
  });
});

test("a withheld value is an empty cell with its status, and no step beside it carries a number", async () => {
  const { timeline } = await readCountryFixture("uk");
  const rows = timelineCsvRows(timeline);
  const withheld = rows.filter((row) => row.status === "withheld");
  expect(withheld.length).toBeGreaterThan(0);
  for (const row of withheld) expect(row.value).toBeNull();
  const withheldSteps = rows.filter((row) => row.change_status === "withheld");
  expect(withheldSteps.length).toBeGreaterThan(0);
  for (const row of withheldSteps) {
    expect([row.change, row.relative_change, row.change_points]).toEqual([null, null, null]);
  }
  expect(Object.keys(rows[0])).not.toContain("reason");

  // A document that carried a number beside a withheld status would still export none.
  const leaking: Timeline = structuredClone(timeline);
  const cell = leaking.outputs.flatMap((output) => output.values).find((value) => value.status === "withheld")!;
  cell.value = 12345.678;
  cell.change = 1;
  cell.changeStatus = "withheld";
  expect(timelineCsv(leaking)).not.toContain("12345.678");
});

test("the text is RFC 4180: a header, CRLF rows, and quotes around a field that needs them", async () => {
  const { timeline } = await readCountryFixture("us");
  const quoted: Timeline = structuredClone(timeline);
  quoted.builds[0].unknownColumns = ['a "quoted" column', "one,two"];
  const lines = timelineCsv(quoted).split("\r\n");
  expect(lines[0]).toBe(TIMELINE_CSV_COLUMNS.join(","));
  expect(lines.at(-1)).toBe("");
  expect(lines).toHaveLength(1 + quoted.builds.length * quoted.outputs.length + 1);
  expect(lines[1]).toContain('"a ""quoted"" column;one,two"');
  // A build the panel never measured: empty cells, never the text "null".
  expect(timelineCsv(quoted)).not.toContain("null");
});

test("a download is named by its country and panel", () => {
  expect(timelineCsvFileName("uk", "af35ceddec5f".padEnd(64, "0"))).toBe("release-history-uk-af35ceddec5f.csv");
});
