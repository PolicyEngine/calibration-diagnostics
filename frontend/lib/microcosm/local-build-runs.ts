import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";

import type { BuildRunDocuments } from "@/lib/microcosm/build-monitor";
import {
  parseStagingCalibrationProgress,
  parseStagingEvents,
  parseStagingManifest,
  parseStagingProgress,
  validateStagingRunConsistency,
} from "@/lib/microcosm/staging-contract";

// Local build runs: the `runs/<run_id>/` telemetry folders a Microcosm build
// writes on the machine it runs on (the US release writes them under
// `<release_root>/staging/runs/` or `--staging-dir`; UK builds under their
// local staging directory). Reading them needs no network or token.
//
// Enabled only when MICROCOSM_LOCAL_RUNS_DIR names one or more directories
// (separated by the platform path delimiter), so a hosted deployment never
// reads its own filesystem.
export const LOCAL_RUNS_DIR_ENV = "MICROCOSM_LOCAL_RUNS_DIR";

const MAX_DEPTH = 6;
const MAX_DIRECTORIES = 20_000;
const SKIP_DIRECTORIES = new Set([
  "node_modules",
  ".git",
  ".venv",
  "__pycache__",
  "checkpoints",
  ".cache",
]);

export interface LocalRunLocation {
  run_id: string;
  directory: string;
}

export function localRunRoots(
  environment: Record<string, string | undefined> = process.env,
): string[] {
  const raw = environment[LOCAL_RUNS_DIR_ENV]?.trim();
  if (!raw) return [];
  return raw
    .split(path.delimiter)
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry) => path.resolve(entry));
}

export function localRunsEnabled(
  environment: Record<string, string | undefined> = process.env,
): boolean {
  return localRunRoots(environment).length > 0;
}

// A run folder holds progress.json and events.ndjson. Search breadth-first so
// shallow layouts are found quickly, skip the heavy checkpoint trees a build
// leaves behind, and never follow symbolic links.
export async function discoverLocalRuns(roots: string[]): Promise<LocalRunLocation[]> {
  const found = new Map<string, LocalRunLocation>();
  let visited = 0;
  const queue: { directory: string; depth: number }[] = roots.map((directory) => ({
    directory,
    depth: 0,
  }));
  while (queue.length && visited < MAX_DIRECTORIES) {
    const { directory, depth } = queue.shift()!;
    visited += 1;
    let entries;
    try {
      entries = await readdir(directory, { withFileTypes: true });
    } catch {
      continue;
    }
    const names = new Set(entries.filter((entry) => entry.isFile()).map((entry) => entry.name));
    if (names.has("progress.json") && names.has("events.ndjson")) {
      const runId = path.basename(directory);
      const existing = found.get(runId);
      // The same run can be mirrored in two places; keep the fresher copy.
      if (!existing || (await newer(directory, existing.directory))) {
        found.set(runId, { run_id: runId, directory });
      }
      continue;
    }
    if (depth >= MAX_DEPTH) continue;
    for (const entry of entries) {
      if (!entry.isDirectory() || entry.isSymbolicLink()) continue;
      if (SKIP_DIRECTORIES.has(entry.name) || entry.name.startsWith(".")) continue;
      queue.push({ directory: path.join(directory, entry.name), depth: depth + 1 });
    }
  }
  return [...found.values()];
}

async function newer(a: string, b: string): Promise<boolean> {
  try {
    const [left, right] = await Promise.all([
      stat(path.join(a, "progress.json")),
      stat(path.join(b, "progress.json")),
    ]);
    return left.mtimeMs > right.mtimeMs;
  } catch {
    return false;
  }
}

async function readText(file: string): Promise<string | null> {
  try {
    return await readFile(file, "utf8");
  } catch {
    return null;
  }
}

async function readJson(file: string): Promise<unknown | null> {
  const text = await readText(file);
  if (text == null) return null;
  try {
    return JSON.parse(text);
  } catch {
    // A file caught mid-write reads as truncated JSON; the next poll gets it.
    return null;
  }
}

export async function loadLocalRunDocuments(
  location: LocalRunLocation,
  country: string,
): Promise<BuildRunDocuments> {
  const file = (name: string) => path.join(location.directory, name);
  const [progressRaw, manifestRaw, calibrationRaw, eventsText] = await Promise.all([
    readJson(file("progress.json")),
    readJson(file("run_manifest.json")),
    readJson(file("calibration_progress.json")),
    readText(file("events.ndjson")),
  ]);
  const progress = progressRaw == null ? null : parseStagingProgress(progressRaw);
  const runManifest = manifestRaw == null ? null : parseStagingManifest(manifestRaw);
  const calibrationProgress =
    calibrationRaw == null ? null : parseStagingCalibrationProgress(calibrationRaw);
  // An events file is appended while the build runs; drop a partial last line.
  const events = parseStagingEvents(completeLines(eventsText));
  validateStagingRunConsistency(location.run_id, {
    progress,
    runManifest,
    calibrationProgress,
    events,
  });
  return {
    run_id: location.run_id,
    source: "local",
    country,
    progress,
    run_manifest: runManifest,
    calibration_progress: calibrationProgress,
    events,
  };
}

export function completeLines(text: string | null): string | null {
  if (text == null || text.endsWith("\n")) return text;
  const cut = text.lastIndexOf("\n");
  return cut < 0 ? "" : text.slice(0, cut + 1);
}

// Which country a local run belongs to: its own country code when it records
// one, otherwise the US (version 1 runs come from the US release build).
export function localRunCountry(documents: BuildRunDocuments): string {
  const identity = documents.progress ?? documents.run_manifest;
  const code = typeof identity?.country_code === "string" ? identity.country_code : null;
  if (code === "GB") return "uk";
  if (code === "BE") return "be";
  if (code === "AM") return "am";
  return code ? code.toLowerCase() : "us";
}
