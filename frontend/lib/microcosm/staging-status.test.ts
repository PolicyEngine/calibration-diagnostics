import { expect, test } from "bun:test";

import { formatStagingCurrentStatus, formatStagingStatus } from "./staging-status";

test("sentence-cases status values", () => {
  expect(formatStagingStatus("running")).toBe("Running");
  expect(formatStagingStatus("waiting_for_input")).toBe("Waiting for input");
  expect(formatStagingStatus(null)).toBe("Unknown");
});

test("formats ordinary progress stages as readable current statuses", () => {
  expect(
    formatStagingCurrentStatus({
      status: "running",
      stage: "base_population_repair",
    }),
  ).toBe("Base population repair");
});

test("formats calibration progress with the current and total epochs", () => {
  expect(
    formatStagingCurrentStatus({
      status: "running",
      stage: "calibrating",
      calibration: { epoch: 125, epochs: 6000 },
    }),
  ).toBe("Calibration, epoch 125 of 6000");
});

test("falls back safely when stage details are incomplete", () => {
  expect(formatStagingCurrentStatus({ stage: "calibrating" })).toBe("Calibration");
  expect(formatStagingCurrentStatus({ status: "queued" })).toBe("Queued");
  expect(formatStagingCurrentStatus({})).toBe("Unknown");
});
