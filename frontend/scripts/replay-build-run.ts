// Replay a recorded Microcosm build run as if it were running now, so the
// Build progress tab can be exercised without starting a build.
//
//   bun run replay:build-run --from <run folder> [--to <dir>] [--speed 10] [--run-id <id>]
//
// <run folder> holds a run's telemetry (progress.json, events.ndjson, and
// optionally run_manifest.json and calibration_progress.json), as a build
// writes under <out>/staging/runs/<run_id>/. The replay writes the same files
// under <dir>/runs/<new run id>/ (default <dir>: MICROCOSM_LOCAL_RUNS_DIR),
// releasing each event when its original time comes round, compressed by
// --speed, and finishes with the run's real outcome. Point the dashboard at
// the same directory and open Staging candidates → Build progress.

import { existsSync, mkdirSync, readFileSync, renameSync, appendFileSync, writeFileSync } from "node:fs";
import path from "node:path";

type Json = Record<string, unknown>;

function argument(name: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function fail(message: string): never {
  console.error(message);
  process.exit(2);
}

const from = argument("from") ?? fail("Give the recorded run folder with --from.");
const to = argument("to") ?? process.env.MICROCOSM_LOCAL_RUNS_DIR ?? fail("Give --to or set MICROCOSM_LOCAL_RUNS_DIR.");
const speed = Number(argument("speed") ?? "10");
if (!Number.isFinite(speed) || speed <= 0) fail("--speed must be a positive number.");

function readJson(file: string): Json | null {
  const full = path.join(from, file);
  return existsSync(full) ? (JSON.parse(readFileSync(full, "utf8")) as Json) : null;
}

const progress = readJson("progress.json") ?? fail(`${from} has no progress.json.`);
const manifest = readJson("run_manifest.json");
const calibration = readJson("calibration_progress.json");
const eventsPath = path.join(from, "events.ndjson");
if (!existsSync(eventsPath)) fail(`${from} has no events.ndjson.`);
const events = readFileSync(eventsPath, "utf8")
  .split("\n")
  .filter((line) => line.trim())
  .map((line) => JSON.parse(line) as Json);

const v2 = progress.schema_version === 2;
const originalId = String(progress.run_id);
const stamp = new Date().toISOString().replace(/[-:]/g, "").slice(0, 15);
const runId = argument("run-id") ?? `${originalId}-replay-${stamp}`;

// Rename the run everywhere it appears (ids, manifest paths, artifact paths).
function renamed<T>(value: T): T {
  return JSON.parse(JSON.stringify(value).split(originalId).join(runId)) as T;
}

const timeOf = (item: Json) => Date.parse(String(item.timestamp ?? item.time));
const eventTimes = events.map(timeOf).filter(Number.isFinite);
const t0 = Math.min(Date.parse(String(progress.started_at)), ...eventTimes);
const now0 = Date.now();
const mapped = (t: number) => now0 + (t - t0) / speed;
const iso = (ms: number) => new Date(ms).toISOString().replace(/\.\d{3}Z$/, "+00:00");
const remap = (value: unknown) => iso(mapped(Date.parse(String(value))));

// Shift every timestamp field of a document onto the replay clock.
function retimed<T>(value: T): T {
  if (Array.isArray(value)) return value.map(retimed) as T;
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Json).map(([key, item]) => [
        key,
        ["time", "timestamp", "started_at", "updated_at"].includes(key) && typeof item === "string"
          ? remap(item)
          : retimed(item),
      ]),
    ) as T;
  }
  return value;
}

const finalProgress = retimed(renamed(progress));
const finalManifest = manifest ? retimed(renamed(manifest)) : null;
const replayEvents = events.map((event) => retimed(renamed(event)));
const calibrationRows = ((calibration?.events as Json[] | undefined) ?? []).map((row) => retimed(row));
const calibrationBase = calibration ? retimed(renamed(calibration)) : null;

const runDir = path.join(to, "runs", runId);
mkdirSync(runDir, { recursive: true });
const write = (file: string, payload: Json) => {
  // Write then rename, so a reader never sees half a file.
  const target = path.join(runDir, file);
  writeFileSync(`${target}.tmp`, JSON.stringify(payload, null, 2));
  renameSync(`${target}.tmp`, target);
};
writeFileSync(path.join(runDir, "events.ndjson"), "");

let nextEvent = 0;
let nextRow = 0;
let currentStage = "created";

function running(updatedAt: string): Json {
  const base: Json = { ...finalProgress, status: "running", updated_at: updatedAt };
  if (v2) return { ...base, current_stage: currentStage, message: null, failure: null };
  const latest = calibrationRows[nextRow - 1];
  const { calibration: _final, ...rest } = base;
  return {
    ...rest,
    stage: latest && currentStage === "calibrating" ? "calibrating" : currentStage,
    message: null,
    details: {},
    ...(latest ? { calibration: latest } : {}),
  };
}

function tick(): boolean {
  const now = Date.now();
  let changed = false;
  while (nextEvent < replayEvents.length && timeOf(replayEvents[nextEvent]) <= now) {
    const event = replayEvents[nextEvent++];
    appendFileSync(path.join(runDir, "events.ndjson"), `${JSON.stringify(event)}\n`);
    const stage = String(event.stage_id ?? event.stage ?? currentStage);
    if (event.event_type !== "calibration" && stage !== "complete" && stage !== "failed") currentStage = stage;
    changed = true;
  }
  while (nextRow < calibrationRows.length && timeOf(calibrationRows[nextRow]) <= now) {
    nextRow += 1;
    changed = true;
  }
  const done = nextEvent >= replayEvents.length && nextRow >= calibrationRows.length;
  if (changed || done) {
    if (calibrationBase) {
      write("calibration_progress.json", {
        ...calibrationBase,
        updated_at: iso(now),
        events: calibrationRows.slice(0, nextRow),
      });
    }
    if (done) {
      write("progress.json", finalProgress);
      if (finalManifest) write("run_manifest.json", finalManifest);
    } else {
      const progressNow = running(iso(now));
      write("progress.json", progressNow);
      if (finalManifest) {
        write("run_manifest.json", {
          ...finalManifest,
          status: "running",
          current_stage: currentStage,
          updated_at: iso(now),
          failure: null,
        });
      }
    }
  }
  return done;
}

const lastTime = Math.max(...replayEvents.map(timeOf), ...calibrationRows.map(timeOf));
console.log(
  `Replaying ${originalId} as ${runId} at ${speed}× into ${runDir}; finishes in about ${Math.ceil((lastTime - Date.now()) / 1000)} s.`,
);
write("progress.json", running(iso(now0)));
const timer = setInterval(() => {
  if (tick()) {
    clearInterval(timer);
    console.log(`Done: ${String(finalProgress.status)}.`);
  }
}, 250);
