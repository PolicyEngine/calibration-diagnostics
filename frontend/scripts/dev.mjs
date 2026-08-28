#!/usr/bin/env node

import { spawn } from "node:child_process";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import process from "node:process";

import { findAvailablePort } from "./available-port.mjs";

const DEFAULT_START_PORT = 3000;
const APP_PATH = "/calibration/dashboard";
const DEV_PORT_FILE = new URL("../.next/dev-port", import.meta.url);

function startPort() {
  const configured = process.env.PORT?.trim();
  if (!configured) return DEFAULT_START_PORT;

  const parsed = Number(configured);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 65_535) {
    throw new Error("PORT must be an integer between 1 and 65535");
  }
  return parsed;
}

async function recordPort(port) {
  await mkdir(new URL("../.next", import.meta.url), { recursive: true });
  await writeFile(DEV_PORT_FILE, `${port}\n`, "utf8");
}

async function removePortRecord(port) {
  try {
    const recordedPort = (await readFile(DEV_PORT_FILE, "utf8")).trim();
    if (recordedPort === String(port)) await rm(DEV_PORT_FILE);
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
}

const port = await findAvailablePort(startPort());
await recordPort(port);

const origin = `http://127.0.0.1:${port}`;
console.log(`Starting calibration dashboard at ${origin}${APP_PATH}`);

const child = spawn(
  "next",
  ["dev", "--turbopack", "--hostname", "127.0.0.1", "--port", String(port)],
  {
    env: { ...process.env, PORT: String(port) },
    stdio: "inherit",
  },
);

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.once(signal, () => child.kill(signal));
}

child.once("error", async (error) => {
  await removePortRecord(port);
  console.error(`Unable to start Next.js: ${error.message}`);
  process.exitCode = 1;
});

child.once("exit", async (code) => {
  await removePortRecord(port);
  process.exitCode = code ?? 1;
});
