import { expect, test } from "bun:test";

import {
  formatCandidateCurrentStatus,
  formatStagingCurrentStatus,
  formatStagingStatus,
  formatStateSource,
} from "./staging-status";

test("sentence-cases status values", () => {
  expect(formatStagingStatus("running")).toBe("Running");
  expect(formatStagingStatus("waiting_for_input")).toBe("Waiting for input");
  expect(formatStagingStatus("passed")).toBe("Finished");
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

test("names the stage where a failed or refused candidate stopped", () => {
  expect(
    formatCandidateCurrentStatus({
      status: "failed",
      stage: "release_gates",
      failure: { stage: "release_gates", message: "Release gates failed" },
      calibration: null,
    }),
  ).toBe("Failed during Release gates");
  expect(
    formatCandidateCurrentStatus({
      status: "blocked",
      stage: "gate_battery",
      failure: { stage: "gate_battery", message: null },
      calibration: null,
    }),
  ).toBe("Refused at Gate battery");
  expect(
    formatCandidateCurrentStatus({
      status: "failed",
      stage: "failed",
      failure: { stage: null, message: "The build failed." },
      calibration: null,
    }),
  ).toBe("Failed");
});

test("formats a running candidate's stage the way the Hugging Face progress did", () => {
  expect(
    formatCandidateCurrentStatus({
      status: "running",
      stage: "reform_validation",
      failure: null,
      calibration: null,
    }),
  ).toBe("Reform validation");
  expect(
    formatCandidateCurrentStatus({
      status: "running",
      stage: "calibrating",
      failure: null,
      calibration: { epoch: 273, epochs: 1500 },
    }),
  ).toBe("Calibration, epoch 273 of 1500");
});

test("names where a candidate's state came from", () => {
  expect(formatStateSource("collector")).toBe("Telemetry collector");
  expect(formatStateSource("hugging_face")).toBe("Hugging Face staging repository");
});
