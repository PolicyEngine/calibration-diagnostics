// scripts/microcosm-investigation-packet.mjs, at the repository root, reads its
// diagnostics base URL from MICROCOSM_DIAGNOSTICS_BASE_URL and falls back to
// the variable's former name, which existing callers set.
// These tests live in the frontend so CI's `bun test` runs them. Each one runs
// the script in a child Bun process whose preload replaces fetch, so no
// request leaves the machine, and checks which base URL it uses.
import { afterAll, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const SCRIPT = resolve(import.meta.dir, "../../scripts/microcosm-investigation-packet.mjs");
const PRODUCTION = "https://calibration-diagnostics.vercel.app";
const LOCAL_FALLBACKS = ["http://localhost:3000", "http://localhost:3001", "http://localhost:3002"];
const CURRENT = "https://current.diagnostics.example";
const FORMER = "https://former.diagnostics.example";
const CLI = "https://cli.diagnostics.example";
const FORMER_ENV = "POPULACE_DIAGNOSTICS_BASE_URL"; // compat: populace alias, remove after 0.2.0

const workDir = mkdtempSync(join(tmpdir(), "investigation-packet-"));
const preload = join(workDir, "fetch-stub.mjs");
// Answers each request with the origin it reached, or, when the environment
// provides PACKET_TEST_FETCH_FAILS, with an error, so the script lists every
// base URL it tried.
writeFileSync(
  preload,
  `globalThis.fetch = async (input) => {
  const url = new URL(String(input));
  if (process.env.PACKET_TEST_FETCH_FAILS) {
    return new Response(JSON.stringify({ available: false, detail: "stubbed failure" }), { status: 503 });
  }
  return new Response(JSON.stringify({ available: true, origin: url.origin, target: url.searchParams.get("target") }));
};
`,
);
afterAll(() => rmSync(workDir, { recursive: true, force: true }));

function runPacket(environment: Record<string, string>, args: string[] = []) {
  const result = Bun.spawnSync([process.execPath, "--preload", preload, SCRIPT, ...args, "target.a"], {
    cwd: workDir,
    env: { PATH: process.env.PATH ?? "", HOME: workDir, ...environment },
    stdout: "pipe",
    stderr: "pipe",
  });
  return {
    exitCode: result.exitCode,
    stdout: result.stdout.toString(),
    stderr: result.stderr.toString(),
  };
}

// The base URL the script fetched from when the request succeeds.
function selectedOrigin(environment: Record<string, string>, args: string[] = []): string {
  const result = runPacket(environment, args);
  expect(result.exitCode).toBe(0);
  const packet = JSON.parse(result.stdout);
  expect(packet.target).toBe("target.a");
  return packet.origin;
}

// Every base URL the script tried, in order, when each request fails.
function triedBaseUrls(environment: Record<string, string>, args: string[] = []): string[] {
  const result = runPacket({ ...environment, PACKET_TEST_FETCH_FAILS: "1" }, args);
  expect(result.exitCode).toBe(1);
  return [...result.stderr.matchAll(/^(\S+): stubbed failure$/gm)].map((match) => match[1]);
}

test("when callers provide neither variable, the packet script tries production and then the local servers", () => {
  expect(selectedOrigin({})).toBe(PRODUCTION);
  expect(triedBaseUrls({})).toEqual([PRODUCTION, ...LOCAL_FALLBACKS]);
});

test("the packet script uses MICROCOSM_DIAGNOSTICS_BASE_URL alone when callers provide only that variable", () => {
  expect(selectedOrigin({ MICROCOSM_DIAGNOSTICS_BASE_URL: CURRENT })).toBe(CURRENT);
  expect(triedBaseUrls({ MICROCOSM_DIAGNOSTICS_BASE_URL: CURRENT })).toEqual([CURRENT]);
});

test("the packet script falls back to the former variable alone when callers provide only that variable", () => {
  const former = { [FORMER_ENV]: FORMER };
  expect(selectedOrigin(former)).toBe(FORMER);
  expect(triedBaseUrls(former)).toEqual([FORMER]);
});

test("the packet script prefers MICROCOSM_DIAGNOSTICS_BASE_URL when callers provide both variables", () => {
  const both = {
    MICROCOSM_DIAGNOSTICS_BASE_URL: CURRENT,
    [FORMER_ENV]: FORMER,
  };
  expect(selectedOrigin(both)).toBe(CURRENT);
  expect(triedBaseUrls(both)).toEqual([CURRENT]);
});

test("--base-url overrides both variables", () => {
  const both = {
    MICROCOSM_DIAGNOSTICS_BASE_URL: CURRENT,
    [FORMER_ENV]: FORMER,
  };
  expect(selectedOrigin(both, ["--base-url", CLI])).toBe(CLI);
  expect(triedBaseUrls(both, ["--base-url", CLI])).toEqual([CLI]);
});

test("an empty base URL variable stops the packet script before any request", () => {
  const environments: Record<string, string>[] = [
    { MICROCOSM_DIAGNOSTICS_BASE_URL: "" },
    { [FORMER_ENV]: "" },
    {
      MICROCOSM_DIAGNOSTICS_BASE_URL: "",
      [FORMER_ENV]: FORMER,
    },
  ];
  for (const environment of environments) {
    const result = runPacket(environment);
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("--base-url requires a value");
    expect(result.stderr).not.toContain("stubbed failure");
    expect(result.stdout).toBe("");
  }
});
