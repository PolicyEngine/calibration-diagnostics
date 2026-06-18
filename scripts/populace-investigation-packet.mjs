#!/usr/bin/env node

const PRODUCTION_BASE_URL = "https://calibration-diagnostics.vercel.app";
const DEFAULT_BASE_URL = process.env.POPULACE_DIAGNOSTICS_BASE_URL ?? PRODUCTION_BASE_URL;
const LOCAL_FALLBACK_BASE_URLS = [
  "http://localhost:3000",
  "http://localhost:3001",
  "http://localhost:3002",
];
const FETCH_TIMEOUT_MS = 10_000;

function usage() {
  console.error(
    [
      "Usage:",
      "  node scripts/populace-investigation-packet.mjs [--release RELEASE_ID] TARGET_ID [--out FILE] [--base-url URL]",
      "",
      "Examples:",
      "  node scripts/populace-investigation-packet.mjs irs_soi.ty2022.historic_table_2.us.under_1.ctc_amount",
      "  node scripts/populace-investigation-packet.mjs --release populace-us-2024-incumbent-improved-996401a-20260618 TARGET --out investigations/target.json",
    ].join("\n"),
  );
}

function parseArgs(argv) {
  const args = [...argv];
  let release = "latest";
  let out = "";
  let baseUrl = DEFAULT_BASE_URL;
  let explicitBaseUrl = false;
  const positional = [];

  while (args.length) {
    const arg = args.shift();
    if (arg === "--release") {
      release = args.shift();
    } else if (arg === "--out") {
      out = args.shift();
    } else if (arg === "--base-url") {
      baseUrl = args.shift();
      explicitBaseUrl = true;
    } else if (arg === "--help" || arg === "-h") {
      usage();
      process.exit(0);
    } else if (arg?.startsWith("--")) {
      throw new Error(`Unknown option: ${arg}`);
    } else if (arg) {
      positional.push(arg);
    }
  }

  if (!release) throw new Error("--release requires a value");
  if (!out && out !== "") throw new Error("--out requires a value");
  if (!baseUrl) throw new Error("--base-url requires a value");
  if (positional.length !== 1) throw new Error("Expected exactly one TARGET_ID");

  return {
    release,
    out,
    baseUrl: baseUrl.replace(/\/$/, ""),
    explicitBaseUrl,
    target: positional[0],
  };
}

function investigationUrl(baseUrl, release, target) {
  const url = new URL("/api/populace/target-investigation", baseUrl);
  url.searchParams.set("target", target);
  if (release) url.searchParams.set("release", release);
  return url;
}

async function fetchPacket(baseUrl, release, target) {
  const url = investigationUrl(baseUrl, release, target);
  const response = await fetch(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
  const text = await response.text();
  let payload;
  try {
    payload = JSON.parse(text);
  } catch {
    throw new Error(`Expected JSON from ${url}, got: ${text.slice(0, 500)}`);
  }
  if (!response.ok || payload.available === false) {
    throw new Error(payload.detail ?? `Request failed with status ${response.status}`);
  }
  return payload;
}

async function main() {
  const { release, out, baseUrl, explicitBaseUrl, target } = parseArgs(process.argv.slice(2));
  const candidates = explicitBaseUrl || process.env.POPULACE_DIAGNOSTICS_BASE_URL
    ? [baseUrl]
    : [baseUrl, ...LOCAL_FALLBACK_BASE_URLS];
  const errors = [];
  let payload;
  for (const candidate of candidates) {
    try {
      payload = await fetchPacket(candidate, release, target);
      if (candidate !== baseUrl) {
        console.error(`Using local diagnostics API at ${candidate}`);
      }
      break;
    } catch (error) {
      errors.push(`${candidate}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  if (!payload) {
    throw new Error(`Could not fetch target investigation packet.\n${errors.join("\n")}`);
  }

  const formatted = `${JSON.stringify(payload, null, 2)}\n`;
  if (out) {
    const { writeFile, mkdir } = await import("node:fs/promises");
    const { dirname } = await import("node:path");
    await mkdir(dirname(out), { recursive: true });
    await writeFile(out, formatted);
    console.error(`Wrote ${out}`);
  } else {
    process.stdout.write(formatted);
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  usage();
  process.exit(1);
});
